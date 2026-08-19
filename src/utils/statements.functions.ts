import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StatementImport, StatementImportDetail, StatementLine } from "@/lib/ai/statementTypes";

export const listStatementImports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ imports: StatementImport[] }> => {
    const { data, error } = await context.supabase
      .from("statement_imports")
      .select(
        "id, account_id, file_name, period_from, period_to, closing_balance, currency_code, status, model, match_window_days, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { imports: (data || []) as StatementImport[] };
  });

export const getStatementImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<StatementImportDetail> => {
    const { buildImportDetail } = await import("./statements.detail.server");
    return buildImportDetail(context.supabase, data.id);
  });

export const extractStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        account_id: z.string().uuid(),
        file_name: z.string().max(200).default("statement.pdf"),
        file_base64: z.string().min(100),
        file_type: z.string().max(100).nullable().optional(),
        invert_amounts: z.boolean().optional(),
        window_days: z.number().int().min(0).max(30).optional(),
        endpoint_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ import_id: string }> => {
    const { runStatementExtraction } = await import("./statements.detail.server");
    const res = await runStatementExtraction(context.supabase, context.userId, data);
    try {
      const { classifyOpenStatementLines } = await import("./statements.classify.server");
      await classifyOpenStatementLines(context.supabase, context.userId, res.import_id);
    } catch {
      // Field guessing is best effort; the import itself already succeeded.
    }
    return res;
  });

export const rematchStatementImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        window_days: z.number().int().min(0).max(30),
        period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<StatementImportDetail> => {
    const { rematchImport } = await import("./statements.detail.server");
    const detail = await rematchImport(context.supabase, data.id, data.window_days, {
      from: data.period_from,
      to: data.period_to,
    });
    try {
      const { classifyOpenStatementLines } = await import("./statements.classify.server");
      const { classified } = await classifyOpenStatementLines(context.supabase, context.userId, data.id);
      if (classified > 0) {
        const { buildImportDetail } = await import("./statements.detail.server");
        return buildImportDetail(context.supabase, data.id);
      }
    } catch {
      // ignore: re-analysis of matches already happened
    }
    return detail;
  });

export const resolveStatementLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        line_id: z.string().uuid(),
        decision: z.enum(["ignore", "confirm", "reset", "link"]),
        transaction_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ line: StatementLine }> => {
    const { applyLineDecision } = await import("./statements.detail.server");
    return applyLineDecision(context.supabase, data);
  });

export const deleteStatementImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("statement_imports").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });