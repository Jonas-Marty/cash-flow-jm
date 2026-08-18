// Server-only helpers for statement (PDF) import and matching.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FullAICreds } from "./ai.server";
import { preview, providerHost, writeAudit } from "./ai.server";

// ---------------------------------------------------------------------------
// PDF text extraction (pure JS, worker-safe)
// ---------------------------------------------------------------------------

export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text, totalPages } = await extractText(pdf, { mergePages: false });
  const pageTexts = Array.isArray(text) ? text : [String(text)];
  return {
    text: pageTexts.map((p, i) => `--- page ${i + 1} ---\n${p}`).join("\n"),
    pages: totalPages ?? pageTexts.length,
  };
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// CSV statements (e-banking exports) — deterministic parsing, no AI needed
// ---------------------------------------------------------------------------

export function decodeTextFile(bytes: Uint8Array): string {
  // Strip a UTF-8 BOM, and fall back to latin1 when the file is not valid UTF-8.
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
  if (utf8.includes("\uFFFD")) {
    return new TextDecoder("windows-1252").decode(bytes).replace(/^\uFEFF/, "");
  }
  return utf8;
}

function sniffDelimiter(sample: string): string {
  const candidates = [";", ",", "\t", "|"];
  let best = ";";
  let bestScore = -1;
  for (const d of candidates) {
    const counts = sample
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(0, 20)
      .map((l) => l.split(d).length - 1);
    if (counts.length === 0) continue;
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    if (avg > bestScore) {
      bestScore = avg;
      best = d;
    }
  }
  return bestScore > 0 ? best : ";";
}

/** RFC4180-ish parser with quote support. */
export function parseCsvRows(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? sniffDelimiter(text.slice(0, 8000));
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === d) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else if (ch === "\r") {
      // ignore
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function parseCsvDate(v: string): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let y = m[3]!;
    if (y.length === 2) y = Number(y) > 70 ? `19${y}` : `20${y}`;
    return `${y}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Parse amounts in both "1'234.56" / "1,234.56" and "1.234,56" notations. */
export function parseCsvAmount(v: string): number | null {
  let s = (v || "").trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-\s*$/.test(s)) {
    negative = true;
    s = s.replace(/-\s*$/, "");
  }
  s = s.replace(/[^\d,.\-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

const HEADER_HINTS = {
  bookingDate: ["buchungsdatum", "booking date", "buchung", "datum", "date", "valutadatum ", "transaction date", "data"],
  valueDate: ["valuta", "value date", "valutadatum", "wertstellung"],
  description: [
    "beschreibung",
    "buchungstext",
    "text",
    "description",
    "verwendungszweck",
    "details",
    "zahlungsempfänger",
    "empfänger",
    "payee",
    "merchant",
    "narrative",
    "mitteilung",
    "purpose",
  ],
  amount: ["betrag", "amount", "montant", "importo", "umsatz"],
  debit: ["belastung", "debit", "soll", "ausgang", "withdrawal", "abgang"],
  credit: ["gutschrift", "credit", "haben", "eingang", "deposit", "zugang"],
  currency: ["währung", "waehrung", "currency", "wä", "ccy"],
};

function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = rows[i]!.map((c) => c.trim().toLowerCase());
    const hasDate = cells.some((c) => HEADER_HINTS.bookingDate.some((h) => c.includes(h.trim())));
    const hasAmount = cells.some((c) =>
      [...HEADER_HINTS.amount, ...HEADER_HINTS.debit, ...HEADER_HINTS.credit].some((h) => c.includes(h)),
    );
    if (hasDate && hasAmount) return i;
  }
  return -1;
}

function pickColumn(header: string[], hints: string[]): number {
  for (const [i, raw] of header.entries()) {
    const c = raw.trim().toLowerCase();
    if (!c) continue;
    if (hints.some((h) => c === h.trim())) return i;
  }
  for (const [i, raw] of header.entries()) {
    const c = raw.trim().toLowerCase();
    if (!c) continue;
    if (hints.some((h) => c.includes(h.trim()))) return i;
  }
  return -1;
}

/**
 * Parse an e-banking CSV export into the same shape the AI extractor returns.
 * Returns null when the file has no recognisable header — the caller can then
 * fall back to the AI text extractor.
 */
export function parseCsvStatement(text: string): ExtractedStatement | null {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return null;
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) return null;
  const header = rows[headerIdx]!;

  const cBooking = pickColumn(header, HEADER_HINTS.bookingDate);
  const cValue = pickColumn(header, HEADER_HINTS.valueDate);
  const cDesc = pickColumn(header, HEADER_HINTS.description);
  const cAmount = pickColumn(header, HEADER_HINTS.amount);
  const cDebit = pickColumn(header, HEADER_HINTS.debit);
  const cCredit = pickColumn(header, HEADER_HINTS.credit);
  const cCurrency = pickColumn(header, HEADER_HINTS.currency);
  if (cBooking < 0 && cValue < 0) return null;
  if (cAmount < 0 && cDebit < 0 && cCredit < 0) return null;

  const out: ExtractedStatement = {
    lines: [],
    period_from: null,
    period_to: null,
    closing_balance: null,
    currency_code: null,
  };

  for (const r of rows.slice(headerIdx + 1)) {
    const at = (i: number) => (i >= 0 && i < r.length ? r[i]! : "");
    const booking = parseCsvDate(at(cBooking)) ?? parseCsvDate(at(cValue));
    if (!booking) continue;

    let amount: number | null = null;
    if (cAmount >= 0) amount = parseCsvAmount(at(cAmount));
    if (amount === null || amount === 0) {
      const debit = cDebit >= 0 ? parseCsvAmount(at(cDebit)) : null;
      const credit = cCredit >= 0 ? parseCsvAmount(at(cCredit)) : null;
      if (debit !== null && debit !== 0) amount = -Math.abs(debit);
      else if (credit !== null && credit !== 0) amount = Math.abs(credit);
    }
    if (amount === null || amount === 0) continue;

    const description =
      cDesc >= 0
        ? at(cDesc).trim()
        : r
            .filter((_, i) => i !== cBooking && i !== cValue && i !== cAmount && i !== cDebit && i !== cCredit)
            .map((c) => c.trim())
            .filter(Boolean)
            .join(" ");

    if (!out.currency_code && cCurrency >= 0) {
      const cur = at(cCurrency).trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(cur)) out.currency_code = cur;
    }

    out.lines.push({
      booking_date: booking,
      value_date: parseCsvDate(at(cValue)),
      description: description.slice(0, 300),
      amount,
      raw_text: r.join(" | ").slice(0, 500),
    });
  }

  if (out.lines.length === 0) return null;
  const dates = out.lines.map((l) => l.booking_date!).filter(Boolean).sort();
  out.period_from = dates[0] ?? null;
  out.period_to = dates[dates.length - 1] ?? null;
  return out;
}

// ---------------------------------------------------------------------------
// AI extraction
// ---------------------------------------------------------------------------

export interface ExtractedLine {
  booking_date: string | null;
  value_date: string | null;
  description: string;
  amount: number;
  raw_text?: string | null;
}

export interface ExtractedStatement {
  lines: ExtractedLine[];
  period_from: string | null;
  period_to: string | null;
  closing_balance: number | null;
  currency_code: string | null;
}

const EXTRACT_SYSTEM = `You extract transaction rows from bank and credit-card statements.
Return ONLY JSON matching this shape:
{"period_from":"YYYY-MM-DD|null","period_to":"YYYY-MM-DD|null","closing_balance":number|null,"currency_code":"CHF|EUR|...|null",
 "lines":[{"booking_date":"YYYY-MM-DD","value_date":"YYYY-MM-DD|null","description":"string","amount":number,"raw_text":"string"}]}
Rules:
- amount is SIGNED from the account holder's perspective: money leaving the account is negative, money arriving is positive.
- For foreign-currency card rows use the settled amount in the statement currency, never the original-currency amount.
- Never invent rows, dates or amounts. Skip balance carry-forward, subtotal, interest-summary and header rows.
- Dates must be ISO (YYYY-MM-DD). Infer the year from the statement period when the row shows only day/month.
- raw_text is the original line as printed.`;

function chunkText(text: string, size = 12000): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  const lines = text.split("\n");
  let cur = "";
  for (const l of lines) {
    if (cur.length + l.length + 1 > size && cur) {
      chunks.push(cur);
      cur = "";
    }
    cur += l + "\n";
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

function parseJsonLoose(s: string): any {
  const trimmed = s.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("AI returned no parseable JSON");
  }
}

function normDate(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function normAmount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d,.\-+]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Response-format variants, tried in order until the provider accepts one. */
const RESPONSE_FORMATS: (Record<string, unknown> | null)[] = [
  { type: "json_object" },
  {
    type: "json_schema",
    json_schema: {
      name: "extraction",
      strict: false,
      schema: {
        type: "object",
        properties: { result: { type: "string", description: "JSON encoded result" } },
        additionalProperties: true,
      },
    },
  },
  {
    type: "json_schema",
    json_schema: { name: "extraction", schema: { type: "object", additionalProperties: true } },
  },
  null,
];

/**
 * Providers differ in which response_format variants they accept (e.g. Infomaniak
 * rejects `json_object`). Remember the first variant a host accepted so later calls
 * don't burn a failing request each time.
 */
const FORMAT_CACHE = new Map<string, number>();

/** Audit context so document analysis shows up in the AI activity log. */
export interface ExtractAudit {
  userId: string;
  fileName?: string | null;
  source: "pdf" | "image" | "csv";
  part?: string | null;
}

export async function callJsonModel(
  creds: FullAICreds,
  system: string,
  user: string | unknown[],
  audit?: ExtractAudit | null,
): Promise<any> {
  let lastError = "";
  const cacheKey = `${providerHost(creds.base_url)}|${creds.model}`;
  const preferred = FORMAT_CACHE.get(cacheKey) ?? 0;
  const order = [
    ...RESPONSE_FORMATS.slice(preferred),
    ...RESPONSE_FORMATS.slice(0, preferred),
  ];
  for (const format of order) {
    const started = Date.now();
    const resp = await fetch(`${creds.base_url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.api_token}` },
      body: JSON.stringify({
        model: creds.model,
        temperature: 0,
        ...(format ? { response_format: format } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (resp.ok) {
      FORMAT_CACHE.set(cacheKey, RESPONSE_FORMATS.indexOf(format));
      const json = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: Record<string, unknown>;
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      if (audit) {
        const u = json.usage ?? {};
        const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
        const p = num(u["prompt_tokens"] ?? u["input_tokens"]);
        const c = num(u["completion_tokens"] ?? u["output_tokens"]);
        await writeAudit({
          user_id: audit.userId,
          kind: "document_extract",
          model: creds.model,
          provider_host: providerHost(creds.base_url),
          duration_ms: Date.now() - started,
          ok: true,
          prompt_tokens: p,
          completion_tokens: c,
          total_tokens: num(u["total_tokens"]) ?? ((p ?? 0) + (c ?? 0) || null),
          payload: {
            file_name: audit.fileName ?? null,
            source: audit.source,
            part: audit.part ?? null,
            response_format: format ? (format as any).type : "none",
            usage: json.usage ?? null,
            content_preview: preview(content, 1000),
          },
        });
      }
      return parseJsonLoose(content);
    }
    const body = await resp.text();
    lastError = `AI provider error (${resp.status}): ${body.slice(0, 800)}`;
    // Only a rejected response_format is worth retrying with another variant.
    const retryable =
      (resp.status === 400 || resp.status === 422) &&
      /response_format|json_object|json_schema|structured output/i.test(body);
    // Don't spam the activity log with attempts that are just format probing.
    if (audit && !retryable) {
      await writeAudit({
        user_id: audit.userId,
        kind: "document_extract",
        model: creds.model,
        provider_host: providerHost(creds.base_url),
        duration_ms: Date.now() - started,
        ok: false,
        error_message: lastError.slice(0, 500),
        payload: {
          file_name: audit.fileName ?? null,
          source: audit.source,
          part: audit.part ?? null,
          response_format: format ? (format as any).type : "none",
          status: resp.status,
          response_body_preview: preview(body, 1000),
        },
      });
    }
    if (!retryable) throw new Error(lastError);
  }
  if (audit) {
    await writeAudit({
      user_id: audit.userId,
      kind: "document_extract",
      model: creds.model,
      provider_host: providerHost(creds.base_url),
      duration_ms: 0,
      ok: false,
      error_message: lastError.slice(0, 500),
      payload: {
        file_name: audit.fileName ?? null,
        source: audit.source,
        part: audit.part ?? null,
        response_format: "all_variants_rejected",
      },
    });
  }
  throw new Error(lastError);
}

export async function extractStatementWithAI(
  creds: FullAICreds,
  text: string,
  hint: { currency_code: string; today: string },
  audit?: ExtractAudit | null,
): Promise<ExtractedStatement> {
  const chunks = chunkText(text);
  const out: ExtractedStatement = {
    lines: [],
    period_from: null,
    period_to: null,
    closing_balance: null,
    currency_code: null,
  };
  for (const [i, chunk] of chunks.entries()) {
    const user = `Account currency: ${hint.currency_code}. Today: ${hint.today}.
Statement text part ${i + 1} of ${chunks.length}:

${chunk}`;
    const parsed = await callJsonModel(
      creds,
      EXTRACT_SYSTEM,
      user,
      audit ? { ...audit, part: `${i + 1}/${chunks.length}` } : null,
    );
    out.period_from = out.period_from ?? normDate(parsed?.period_from);
    out.period_to = normDate(parsed?.period_to) ?? out.period_to;
    const bal = normAmount(parsed?.closing_balance);
    if (bal !== null) out.closing_balance = bal;
    if (!out.currency_code && typeof parsed?.currency_code === "string") {
      out.currency_code = parsed.currency_code.trim().toUpperCase().slice(0, 8) || null;
    }
    for (const r of Array.isArray(parsed?.lines) ? parsed.lines : []) {
      const amount = normAmount(r?.amount);
      if (amount === null || amount === 0) continue;
      out.lines.push({
        booking_date: normDate(r?.booking_date) ?? normDate(r?.date),
        value_date: normDate(r?.value_date),
        description: String(r?.description ?? "").trim().slice(0, 300),
        amount,
        raw_text: typeof r?.raw_text === "string" ? r.raw_text.slice(0, 500) : null,
      });
    }
  }
  return out;
}

/**
 * Extract statement rows from a photo/scan (PNG, JPEG, WebP, …) using a
 * vision-capable model. The image is passed inline as a base64 data URL.
 */
export async function extractStatementFromImagesWithAI(
  creds: FullAICreds,
  images: { mime: string; base64: string }[],
  hint: { currency_code: string; today: string },
  audit?: ExtractAudit | null,
): Promise<ExtractedStatement> {
  const content = [
    {
      type: "text",
      text: `Account currency: ${hint.currency_code}. Today: ${hint.today}.
Read every transaction row from this statement image and return the JSON described in the system prompt.`,
    },
    ...images.map((img) => ({
      type: "image_url",
      image_url: { url: `data:${img.mime};base64,${img.base64}` },
    })),
  ];
  const parsed = await callJsonModel(creds, EXTRACT_SYSTEM, content, audit ?? null);
  const out: ExtractedStatement = {
    lines: [],
    period_from: normDate(parsed?.period_from),
    period_to: normDate(parsed?.period_to),
    closing_balance: normAmount(parsed?.closing_balance),
    currency_code:
      typeof parsed?.currency_code === "string"
        ? parsed.currency_code.trim().toUpperCase().slice(0, 8) || null
        : null,
  };
  for (const r of Array.isArray(parsed?.lines) ? parsed.lines : []) {
    const amount = normAmount(r?.amount);
    if (amount === null || amount === 0) continue;
    out.lines.push({
      booking_date: normDate(r?.booking_date) ?? normDate(r?.date),
      value_date: normDate(r?.value_date),
      description: String(r?.description ?? "").trim().slice(0, 300),
      amount,
      raw_text: typeof r?.raw_text === "string" ? r.raw_text.slice(0, 500) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic matching
// ---------------------------------------------------------------------------

export interface AppEntry {
  key: string;
  transaction_id: string;
  split_group_id: string | null;
  occurred_on: string;
  amount: number; // signed from the account's perspective
  description: string;
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(da) || Number.isNaN(db)) return 9999;
  return Math.abs(Math.round((da - db) / 86400000));
}

function tokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

export function descSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) {
    if (tb.has(w)) inter++;
    else {
      for (const v of tb) {
        if (v.startsWith(w) || w.startsWith(v)) {
          inter += 0.6;
          break;
        }
      }
    }
  }
  return Math.min(1, inter / Math.min(ta.size, tb.size));
}

export interface MatchInputLine {
  id: string;
  booking_date: string | null;
  value_date: string | null;
  description: string;
  amount: number;
}

export interface MatchOutcome {
  id: string;
  match_status: "exact" | "probable" | "unmatched";
  matched_transaction_id: string | null;
  match_score: number | null;
}

/**
 * One-to-one greedy matcher. Amount must agree to the cent; the date must be
 * inside the window. Description similarity only ranks candidates and decides
 * exact vs probable — it never creates a match on its own. Because repeated
 * identical amounts are common (e.g. several CHF 5 beers), every app entry can
 * be consumed by at most one statement line.
 */
export function matchLines(
  lines: MatchInputLine[],
  entries: AppEntry[],
  windowDays: number,
): MatchOutcome[] {
  interface Pair {
    lineId: string;
    entryKey: string;
    sim: number;
    dateDiff: number;
  }
  const pairs: Pair[] = [];
  for (const l of lines) {
    const ld = l.booking_date || l.value_date;
    if (!ld) continue;
    for (const e of entries) {
      if (Math.abs(e.amount - l.amount) > 0.005) continue;
      const dd = daysBetween(ld, e.occurred_on);
      if (dd > windowDays) continue;
      pairs.push({ lineId: l.id, entryKey: e.key, sim: descSimilarity(l.description, e.description), dateDiff: dd });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim || a.dateDiff - b.dateDiff);

  const usedLines = new Set<string>();
  const usedEntries = new Set<string>();
  const byLine = new Map<string, { entry: AppEntry; sim: number; dateDiff: number }>();
  const entryByKey = new Map(entries.map((e) => [e.key, e]));
  for (const p of pairs) {
    if (usedLines.has(p.lineId) || usedEntries.has(p.entryKey)) continue;
    usedLines.add(p.lineId);
    usedEntries.add(p.entryKey);
    const entry = entryByKey.get(p.entryKey);
    if (entry) byLine.set(p.lineId, { entry, sim: p.sim, dateDiff: p.dateDiff });
  }

  return lines.map((l): MatchOutcome => {
    const hit = byLine.get(l.id);
    if (!hit) return { id: l.id, match_status: "unmatched", matched_transaction_id: null, match_score: null };
    const strong = hit.sim >= 0.4 || (hit.dateDiff === 0 && hit.sim > 0);
    return {
      id: l.id,
      match_status: strong ? "exact" : "probable",
      matched_transaction_id: hit.entry.transaction_id,
      match_score: Number(hit.sim.toFixed(3)),
    };
  });
}

/** Load app-side entries for an account in a date range, splits summed per group. */
export async function loadAppEntries(
  sb: SupabaseClient,
  accountId: string,
  from: string,
  to: string,
): Promise<AppEntry[]> {
  const { data, error } = await sb
    .from("transactions")
    .select(
      "id, occurred_on, amount, destination_amount, description, type, source_account_id, destination_account_id, split_group_id",
    )
    .gte("occurred_on", from)
    .lte("occurred_on", to)
    .or(`source_account_id.eq.${accountId},destination_account_id.eq.${accountId}`);
  if (error) throw new Error(error.message);

  const rows = (data || []) as any[];
  const groups = new Map<string, AppEntry>();
  const out: AppEntry[] = [];
  for (const r of rows) {
    let signed: number;
    if (r.type === "expense") signed = -Number(r.amount);
    else if (r.type === "income") signed = Number(r.amount);
    else if (r.source_account_id === accountId) signed = -Number(r.amount);
    else signed = Number(r.destination_amount ?? r.amount);

    const desc = String(r.description ?? "");
    if (r.split_group_id) {
      const g = groups.get(r.split_group_id);
      if (g) {
        g.amount = Number((g.amount + signed).toFixed(2));
        if (r.occurred_on < g.occurred_on) g.occurred_on = r.occurred_on;
        if (desc && !g.description.includes(desc)) g.description += " " + desc;
      } else {
        const entry: AppEntry = {
          key: `g:${r.split_group_id}`,
          transaction_id: r.id,
          split_group_id: r.split_group_id,
          occurred_on: r.occurred_on,
          amount: Number(signed.toFixed(2)),
          description: desc,
        };
        groups.set(r.split_group_id, entry);
        out.push(entry);
      }
    } else {
      out.push({
        key: `t:${r.id}`,
        transaction_id: r.id,
        split_group_id: null,
        occurred_on: r.occurred_on,
        amount: Number(signed.toFixed(2)),
        description: desc,
      });
    }
  }
  return out;
}