import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { RuleDocumentResult } from "./recurringAi.server";

const common = {
  hint: z.string().trim().max(500).nullable().optional(),
  endpoint_id: z.string().uuid().nullable().optional(),
};

/** Settings ✨: read an invoice and propose a recurring rule. Saves nothing. */
export const analyseRuleDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        file_name: z.string().trim().min(1).max(200),
        file_type: z.string().max(120).nullable().optional(),
        file_base64: z.string().min(8).max(21_000_000),
        ...common,
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<RuleDocumentResult> => {
    const { analyseDocumentForRule } = await import("./recurringAi.server");
    const { base64ToBytes } = await import("./statements.server");
    return analyseDocumentForRule(context.supabase, context.userId, {
      file_name: data.file_name,
      file_type: data.file_type ?? null,
      bytes: base64ToBytes(data.file_base64),
      base64: data.file_base64,
      hint: data.hint ?? null,
      endpoint_id: data.endpoint_id ?? null,
    });
  });

/** Same, for a file picked from the user's Nextcloud (fetched server-side). */
export const analyseRuleDocumentFromNextcloud = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ path: z.string().min(1).max(1000), ...common }).parse(d),
  )
  .handler(async ({ data, context }): Promise<RuleDocumentResult> => {
    const { downloadFile } = await import("./nextcloud.server");
    const { analyseDocumentForRule } = await import("./recurringAi.server");
    const file = await downloadFile(context.userId, data.path);
    const bytes = new Uint8Array(file.bytes);
    return analyseDocumentForRule(context.supabase, context.userId, {
      file_name: file.name.slice(0, 200),
      file_type: file.mime,
      bytes,
      base64: Buffer.from(bytes).toString("base64"),
      hint: data.hint ?? null,
      endpoint_id: data.endpoint_id ?? null,
    });
  });
