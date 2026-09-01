// Server-only orchestration for statement imports: extraction, matching, decisions.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  StatementImport,
  StatementImportDetail,
  StatementLine,
  StatementRef,
  UnmatchedAppTransaction,
} from "@/lib/ai/statementTypes";
import { resolveEndpoint } from "./ai.server";
import {
  base64ToBytes,
  decodeTextFile,
  extractPdfText,
  extractStatementFromImagesWithAI,
  extractStatementWithAI,
  loadAppEntries,
  matchLines,
  parseCsvStatement,
} from "./statements.server";

const IMPORT_COLS =
  "id, account_id, file_name, file_source, storage_path, external_url, file_type, period_from, period_to, closing_balance, currency_code, status, model, match_window_days, created_at";

export const STATEMENT_BUCKET = "statement-files";

function storageExt(fileName: string, mime: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(fileName);
  if (m) return m[1].toLowerCase();
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("csv")) return "csv";
  if (mime.startsWith("image/")) return mime.slice(6).split(";")[0];
  return "bin";
}
const LINE_COLS =
  "id, line_no, booking_date, value_date, description, amount, raw_text, match_status, matched_transaction_id, match_score, decision, suggested_description, suggested_category_id, suggested_tags";

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
    file_type?: string | null;
    invert_amounts?: boolean;
    window_days?: number;
    endpoint_id?: string | null;
    /** Set when the document stays on an external provider (e.g. Nextcloud). */
    external_url?: string | null;
    external_source?: string | null;
  },
): Promise<{ import_id: string }> {
  const { data: account, error: accErr } = await sb
    .from("accounts")
    .select("id, name, currency_code")
    .eq("id", input.account_id)
    .single();
  if (accErr) throw new Error(accErr.message);

  const mime = (input.file_type || "").toLowerCase();
  const isImage = mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(input.file_name);
  const isCsv =
    mime.includes("csv") ||
    mime === "text/plain" ||
    mime === "text/tab-separated-values" ||
    /\.(csv|tsv|txt)$/i.test(input.file_name);
  const hint = {
    currency_code: account.currency_code || "CHF",
    today: new Date().toISOString().slice(0, 10),
  };

  let text = "";
  let csvParsed: Awaited<ReturnType<typeof extractStatementWithAI>> | null = null;
  if (isCsv && !isImage) {
    text = decodeTextFile(base64ToBytes(input.file_base64));
    if (text.trim().length < 10) throw new Error("This CSV file appears to be empty.");
    csvParsed = parseCsvStatement(text);
  } else if (!isImage) {
    text = (await extractPdfText(base64ToBytes(input.file_base64))).text;
    if (text.replace(/--- page \d+ ---/g, "").trim().length < 40) {
      throw new Error(
        "This PDF has no readable text layer (it looks scanned). Upload a photo/screenshot of it instead, or use the digital statement from your bank.",
      );
    }
  }

  // A recognised CSV needs no AI at all.
  const resolved = csvParsed
    ? null
    : await resolveEndpoint(userId, "statement_extract", input.endpoint_id ?? null);
  const extracted = csvParsed
    ? csvParsed
    : isImage
    ? await extractStatementFromImagesWithAI(
        resolved!.creds,
        [{ mime: mime || "image/png", base64: input.file_base64 }],
        hint,
        { userId, fileName: input.file_name, source: "image" },
      )
    : await extractStatementWithAI(resolved!.creds, text, hint, {
        userId,
        fileName: input.file_name,
        source: isCsv ? "csv" : "pdf",
      });
  if (extracted.lines.length === 0) throw new Error("The AI could not find any transaction rows in this file.");

  const sign = input.invert_amounts ? -1 : 1;
  const windowDays = input.window_days ?? 3;

  // Keep a reference to the source document. Uploaded bytes go into our own
  // private bucket; externally hosted files are only referenced.
  let fileSource = input.external_url ? input.external_source || "external" : "internal";
  let storagePath: string | null = null;
  if (!input.external_url) {
    const bytes = base64ToBytes(input.file_base64);
    const path = `${userId}/${crypto.randomUUID()}.${storageExt(input.file_name, mime)}`;
    const { error: upErr } = await sb.storage.from(STATEMENT_BUCKET).upload(path, bytes, {
      contentType: mime || "application/octet-stream",
      upsert: false,
    });
    if (upErr) fileSource = "none";
    else storagePath = path;
  }

  const { data: imp, error: impErr } = await sb
    .from("statement_imports")
    .insert({
      user_id: userId,
      account_id: input.account_id,
      file_name: input.file_name,
      file_source: fileSource,
      storage_path: storagePath,
      external_url: input.external_url ?? null,
      file_type: mime || null,
      period_from: extracted.period_from,
      period_to: extracted.period_to,
      closing_balance: extracted.closing_balance,
      currency_code: extracted.currency_code || account.currency_code,
      model: resolved ? resolved.endpoint.model : "csv-parser",
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
  period?: { from?: string | null; to?: string | null },
): Promise<StatementImportDetail> {
  if (period && (period.from !== undefined || period.to !== undefined)) {
    const patch: Record<string, unknown> = {};
    if (period.from !== undefined) patch.period_from = period.from;
    if (period.to !== undefined) patch.period_to = period.to;
    await sb.from("statement_imports").update(patch).eq("id", importId);
  }
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
/** A short-lived URL for the statement document, or the external link. */
export async function getStatementFileLink(
  sb: SupabaseClient,
  importId: string,
): Promise<{ url: string | null; file_name: string; source: string }> {
  const imp = await loadImport(sb, importId);
  if (imp.file_source === "internal" && imp.storage_path) {
    const { data, error } = await sb.storage.from(STATEMENT_BUCKET).createSignedUrl(imp.storage_path, 300);
    if (error) throw new Error(error.message);
    return { url: data.signedUrl, file_name: imp.file_name, source: imp.file_source };
  }
  return { url: imp.external_url ?? null, file_name: imp.file_name, source: imp.file_source };
}

/** Delete an import; the stored object goes only when we own it. */
export async function deleteImportWithFile(sb: SupabaseClient, importId: string): Promise<void> {
  const imp = await loadImport(sb, importId);
  const { error } = await sb.from("statement_imports").delete().eq("id", importId);
  if (error) throw new Error(error.message);
  if (imp.file_source === "internal" && imp.storage_path) {
    // Never touch files hosted by an external provider.
    await sb.storage.from(STATEMENT_BUCKET).remove([imp.storage_path]);
  }
}

/** Reverse lookup: which statement (if any) covers each of these transactions. */
export async function statementRefsFor(
  sb: SupabaseClient,
  transactionIds: string[],
): Promise<StatementRef[]> {
  if (transactionIds.length === 0) return [];
  const { data, error } = await sb
    .from("statement_import_lines")
    .select("line_no, matched_transaction_id, statement_imports!inner(id, file_name, file_source, period_from, period_to)")
    .in("matched_transaction_id", transactionIds);
  if (error) throw new Error(error.message);
  const out: StatementRef[] = [];
  const seen = new Set<string>();
  for (const r of (data || []) as any[]) {
    const imp = r.statement_imports;
    if (!imp || !r.matched_transaction_id || seen.has(r.matched_transaction_id)) continue;
    seen.add(r.matched_transaction_id);
    out.push({
      transaction_id: r.matched_transaction_id,
      import_id: imp.id,
      file_name: imp.file_name,
      file_source: imp.file_source,
      period_from: imp.period_from,
      period_to: imp.period_to,
      line_no: r.line_no,
    });
  }
  return out;
}

/**
 * Book several statement lines as real transactions in one go (tabular entry).
 * Each row is inserted independently so one failure does not block the rest;
 * the matching line is then linked to the created transaction.
 */
export async function commitStatementLines(
  sb: SupabaseClient,
  userId: string,
  input: {
    import_id: string;
    rows: Array<{
      line_id: string;
      occurred_on: string;
      amount: number;
      type: "expense" | "income";
      description: string | null;
      note: string | null;
      category_id: string | null;
      latitude?: number | null;
      longitude?: number | null;
      location_label?: string | null;
      location_source?: string | null;
    }>;
  },
): Promise<{
  results: Array<{ line_id: string; ok: boolean; transaction_id?: string; error?: string }>;
  detail: StatementImportDetail;
}> {
  const imp = await loadImport(sb, input.import_id);
  const results: Array<{ line_id: string; ok: boolean; transaction_id?: string; error?: string }> = [];

  for (const row of input.rows) {
    try {
      const { data, error } = await sb
        .from("transactions")
        .insert({
          user_id: userId,
          occurred_on: row.occurred_on,
          amount: Math.abs(row.amount),
          type: row.type,
          source_account_id: imp.account_id,
          destination_account_id: null,
          category_id: row.category_id,
          description: row.description,
          note: row.note,
          latitude: row.latitude ?? null,
          longitude: row.longitude ?? null,
          location_accuracy_m: null,
          location_label: row.location_label ?? null,
          location_source: row.latitude != null ? (row.location_source ?? "search") : null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const txId = (data as { id: string }).id;
      await applyLineDecision(sb, { line_id: row.line_id, decision: "link", transaction_id: txId });
      results.push({ line_id: row.line_id, ok: true, transaction_id: txId });
    } catch (e) {
      results.push({ line_id: row.line_id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const detail = await buildImportDetail(sb, input.import_id);
  return { results, detail };
}
