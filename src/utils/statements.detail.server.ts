// Server-only orchestration for statement imports: extraction, matching, decisions.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  StatementImport,
  StatementImportDetail,
  StatementLine,
  UnmatchedAppTransaction,
} from "@/lib/ai/statementTypes";
import { resolveEndpoint } from "./ai.server";
import {
  base64ToBytes,
  extractPdfText,
  extractStatementFromImagesWithAI,
  extractStatementWithAI,
  loadAppEntries,
  matchLines,
} from "./statements.server";

const IMPORT_COLS =
  "id, account_id, file_name, period_from, period_to, closing_balance, currency_code, status, model, match_window_days, created_at";
const LINE_COLS =
  "id, line_no, booking_date, value_date, description, amount, raw_text, match_status, matched_transaction_id, match_score, decision";

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function periodOf(imp: StatementImport, lines: { booking_date: string | null; value_date: string | null }[]) {
  const dates = lines.map((l) => l.booking_date || l.value_date).filter(Boolean) as string[];
  dates.sort();
  const from = imp.period_from || dates[0] || null;
  const to = imp.period_to || dates[dates.length - 1] || null;
  return { from, to };
}

async function loadImport(sb: SupabaseClient, id: string): Promise<StatementImport> {
  const { data, error } = await sb.from("statement_imports").select(IMPORT_COLS).eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as StatementImport;
}

async function loadLines(sb: SupabaseClient, importId: string): Promise<StatementLine[]> {
  const { data, error } = await sb
    .from("statement_import_lines")
    .select(LINE_COLS)
    .eq("import_id", importId)
    .order("line_no", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((r: any) => ({ ...r, amount: Number(r.amount) })) as StatementLine[];
}

export async function buildImportDetail(sb: SupabaseClient, id: string): Promise<StatementImportDetail> {
  const imp = await loadImport(sb, id);
  const lines = await loadLines(sb, id);
  const { from, to } = periodOf(imp, lines);
  const w = imp.match_window_days ?? 3;

  let entries: Awaited<ReturnType<typeof loadAppEntries>> = [];
  if (from && to) entries = await loadAppEntries(sb, imp.account_id, addDays(from, -w), addDays(to, w));

  const matchedIds = new Set(lines.map((l) => l.matched_transaction_id).filter(Boolean) as string[]);
  const matched: StatementImportDetail["matched"] = {};
  for (const e of entries) {
    if (matchedIds.has(e.transaction_id)) {
      matched[e.transaction_id] = { occurred_on: e.occurred_on, amount: e.amount, description: e.description };
    }
  }
  const unmatched_app: UnmatchedAppTransaction[] = entries
    .filter((e) => !matchedIds.has(e.transaction_id))
    .filter((e) => !from || !to || (e.occurred_on >= from && e.occurred_on <= to))
    .map((e) => ({
      key: e.key,
      transaction_id: e.transaction_id,
      split_group_id: e.split_group_id,
      occurred_on: e.occurred_on,
      amount: e.amount,
      description: e.description,
    }))
    .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));

  return { import: imp, lines, matched, unmatched_app };
}

export async function runStatementExtraction(
  sb: SupabaseClient,
  userId: string,
  input: {
    account_id: string;
    file_name: string;
    file_base64: string;
    invert_amounts?: boolean;
    window_days?: number;
    endpoint_id?: string | null;
  },
): Promise<{ import_id: string }> {
  const { data: account, error: accErr } = await sb
    .from("accounts")
    .select("id, name, currency_code")
    .eq("id", input.account_id)
    .single();
  if (accErr) throw new Error(accErr.message);

  const { text } = await extractPdfText(base64ToBytes(input.file_base64));
  if (text.replace(/--- page \d+ ---/g, "").trim().length < 40) {
    throw new Error(
      "This PDF has no readable text layer (it looks scanned). Please use the digital statement from your bank.",
    );
  }

  const resolved = await resolveEndpoint(userId, "statement_extract", input.endpoint_id ?? null);
  const extracted = await extractStatementWithAI(resolved.creds, text, {
    currency_code: account.currency_code || "CHF",
    today: new Date().toISOString().slice(0, 10),
  });
  if (extracted.lines.length === 0) throw new Error("The AI could not find any transaction rows in this PDF.");

  const sign = input.invert_amounts ? -1 : 1;
  const windowDays = input.window_days ?? 3;

  const { data: imp, error: impErr } = await sb
    .from("statement_imports")
    .insert({
      user_id: userId,
      account_id: input.account_id,
      file_name: input.file_name,
      period_from: extracted.period_from,
      period_to: extracted.period_to,
      closing_balance: extracted.closing_balance,
      currency_code: extracted.currency_code || account.currency_code,
      model: resolved.endpoint.model,
      match_window_days: windowDays,
      status: "extracted",
    })
    .select("id")
    .single();
  if (impErr) throw new Error(impErr.message);

  const rows = extracted.lines.map((l, i) => ({
    import_id: imp.id,
    user_id: userId,
    line_no: i + 1,
    booking_date: l.booking_date,
    value_date: l.value_date,
    description: l.description,
    amount: Number((l.amount * sign).toFixed(2)),
    raw_text: l.raw_text ?? null,
    match_status: "unmatched",
  }));
  const { error: linesErr } = await sb.from("statement_import_lines").insert(rows);
  if (linesErr) throw new Error(linesErr.message);

  await rematchImport(sb, imp.id, windowDays);
  return { import_id: imp.id };
}

export async function rematchImport(
  sb: SupabaseClient,
  importId: string,
  windowDays: number,
): Promise<StatementImportDetail> {
  const imp = await loadImport(sb, importId);
  const lines = await loadLines(sb, importId);
  const { from, to } = periodOf(imp, lines);
  if (from && to) {
    const entries = await loadAppEntries(sb, imp.account_id, addDays(from, -windowDays), addDays(to, windowDays));
    // Lines the user already decided on stay untouched.
    const open = lines.filter((l) => l.match_status !== "ignored" && l.match_status !== "resolved");
    const taken = new Set(
      lines
        .filter((l) => l.match_status === "resolved" && l.matched_transaction_id)
        .map((l) => l.matched_transaction_id as string),
    );
    const outcomes = matchLines(
      open.map((l) => ({
        id: l.id,
        booking_date: l.booking_date,
        value_date: l.value_date,
        description: l.description,
        amount: l.amount,
      })),
      entries.filter((e) => !taken.has(e.transaction_id)),
      windowDays,
    );
    for (const o of outcomes) {
      await sb
        .from("statement_import_lines")
        .update({
          match_status: o.match_status,
          matched_transaction_id: o.matched_transaction_id,
          match_score: o.match_score,
        })
        .eq("id", o.id);
    }
  }
  await sb
    .from("statement_imports")
    .update({ match_window_days: windowDays, status: "matched" })
    .eq("id", importId);
  return buildImportDetail(sb, importId);
}

export async function applyLineDecision(
  sb: SupabaseClient,
  input: { line_id: string; decision: "ignore" | "confirm" | "reset" | "link"; transaction_id?: string | null },
): Promise<{ line: StatementLine }> {
  const patch: Record<string, unknown> = { decision: input.decision };
  if (input.decision === "ignore") {
    patch.match_status = "ignored";
    patch.matched_transaction_id = null;
  } else if (input.decision === "confirm") {
    patch.match_status = "resolved";
  } else if (input.decision === "link") {
    if (!input.transaction_id) throw new Error("transaction_id is required to link a line");
    patch.match_status = "resolved";
    patch.matched_transaction_id = input.transaction_id;
  } else {
    patch.match_status = "unmatched";
    patch.matched_transaction_id = null;
    patch.decision = null;
  }
  const { data, error } = await sb
    .from("statement_import_lines")
    .update(patch)
    .eq("id", input.line_id)
    .select(LINE_COLS)
    .single();
  if (error) throw new Error(error.message);
  return { line: { ...(data as any), amount: Number((data as any).amount) } as StatementLine };
}