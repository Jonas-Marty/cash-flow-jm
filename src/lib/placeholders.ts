import { format as fmtDate, getISOWeek } from "date-fns";
import type { Locale } from "date-fns";
import { de as deLocale, enUS as enLocale } from "date-fns/locale";

export type FormatLocale = "de" | "en";

export const formatLocaleMap: Record<FormatLocale, Locale> = {
  de: deLocale,
  en: enLocale,
};

export function resolveFormatLocale(code: string | null | undefined): Locale {
  if (code === "en") return enLocale;
  return deLocale;
}

/**
 * Recurrence engine v2 context. All dates are pre-computed by the caller;
 * this module never derives period bounds itself — that's `recurrence.ts`.
 */
export interface PlaceholderContext {
  /** Effective transaction date (= occurred_on at post time, after weekend shift). */
  date: Date;
  /** Pre-weekend-shift due date. */
  dueDate: Date;
  /** First day of the reporting period. */
  periodFrom: Date;
  /** Last day of the reporting period. */
  periodTo: Date;
  /** 1-based count of this occurrence within its rule. */
  runNumber: number;
  /** Locale for month/day name rendering. */
  locale: Locale;
}

export interface TokenInfo {
  token: string;
  kind: "date" | "number";
  help: string;
  example: string;
}

export const TOKENS: TokenInfo[] = [
  { token: "date",       kind: "date",   help: "Effective transaction date (after weekend shift).", example: "${date:dd.MM.yyyy}" },
  { token: "dueDate",    kind: "date",   help: "Original due date (before weekend shift).",         example: "${dueDate:dd.MM.yyyy}" },
  { token: "periodFrom", kind: "date",   help: "First day of the reporting period.",                example: "${periodFrom:dd.MM.yyyy}" },
  { token: "periodTo",   kind: "date",   help: "Last day of the reporting period.",                 example: "${periodTo:dd.MM.yyyy}" },
  { token: "runNumber",  kind: "number", help: "1-based occurrence counter.",                        example: "${runNumber:000}" },
];

/** Tokens the v2 engine no longer supports. Kept only so the UI can warn. */
export const DROPPED_TOKENS: readonly string[] = Object.freeze([
  "periodStart", "periodEnd", "periodLabel", "periodMonth", "periodQuarter", "periodYear",
  "periodSemester", "periodTrimester", "quarter", "semester", "trimester", "today",
  "prevDate", "nextDate", "monthOfYear", "year", "weekOfYear",
]);

export function describeTokens(): TokenInfo[] {
  return TOKENS;
}

export function findDroppedTokens(template: string | null | undefined): string[] {
  if (!template) return [];
  const found = new Set<string>();
  const re = /\$\{([a-zA-Z]+)(?::[^}]*)?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (DROPPED_TOKENS.includes(m[1])) found.add(m[1]);
  }
  return [...found];
}

function dateValue(token: string, ctx: PlaceholderContext): Date | null {
  switch (token) {
    case "date":       return ctx.date;
    case "dueDate":    return ctx.dueDate;
    case "periodFrom": return ctx.periodFrom;
    case "periodTo":   return ctx.periodTo;
    default:           return null;
  }
}

function normalizeDateFormat(fmt: string): string {
  // Map ddd/dddd → EEE/EEEE outside of date-fns literal escapes [...].
  let out = "";
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch === "[") {
      const close = fmt.indexOf("]", i);
      if (close === -1) { out += fmt.slice(i); break; }
      out += fmt.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    // longest match first
    if (fmt.startsWith("dddd", i)) { out += "EEEE"; i += 4; continue; }
    if (fmt.startsWith("ddd", i))  { out += "EEE";  i += 3; continue; }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Format a date with date-fns but post-process so that the short month token
 * `MMM` never emits a trailing period (date-fns/locale data appends "." for
 * abbreviated German months like "Jan." / "Feb." — we want plain "Jan", "Feb").
 * Long months (`MMMM`) are unaffected.
 *
 * Implementation: split the format string into segments at every `MMM` token
 * (skipping `MMMM` which uses the full name and is left intact), format each
 * piece independently, strip a single trailing `.` from each MMM rendering,
 * then concatenate. Bracket-escaped literals `[...]` are kept opaque so an
 * MMM inside them is treated as literal text by date-fns.
 */
function formatRespectingMMM(d: Date, fmt: string, locale: Locale): string {
  const parts: { text: string; isMMM: boolean }[] = [];
  let buf = "";
  let i = 0;
  while (i < fmt.length) {
    if (fmt[i] === "[") {
      const close = fmt.indexOf("]", i);
      if (close === -1) { buf += fmt.slice(i); break; }
      buf += fmt.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    // Detect MMMM (long) — leave intact, do NOT split.
    if (fmt.startsWith("MMMM", i)) {
      buf += "MMMM";
      i += 4;
      continue;
    }
    // Detect MMM (short) — split here.
    if (fmt.startsWith("MMM", i)) {
      if (buf.length > 0) { parts.push({ text: buf, isMMM: false }); buf = ""; }
      parts.push({ text: "MMM", isMMM: true });
      i += 3;
      continue;
    }
    buf += fmt[i];
    i += 1;
  }
  if (buf.length > 0) parts.push({ text: buf, isMMM: false });

  return parts
    .map((p) => {
      const rendered = fmtDate(d, p.text, { locale });
      return p.isMMM ? rendered.replace(/\.$/, "") : rendered;
    })
    .join("");
}

function padNumber(n: number, fmt: string | undefined): string {
  if (!fmt) return String(n);
  // Treat fmt of zeros as zero-padding width.
  if (/^0+$/.test(fmt)) {
    return String(n).padStart(fmt.length, "0");
  }
  return String(n);
}

const TOKEN_RE = /\$\$|\$\{([a-zA-Z]+)(?::([^}]*))?\}/g;

/**
 * Extended date-token formatter: supports `Q` (quarter 1-4), `S`
 * (semester 1-2), `T` (trimester 1-3) and `ww`/`w` (ISO week) on top of
 * the standard date-fns tokens. Everything else defers to date-fns.
 */
function formatDateExtended(d: Date, fmt: string | undefined, locale: Locale): string {
  const f = fmt && fmt.length > 0 ? normalizeDateFormat(fmt) : "yyyy-MM-dd";
  // Replace Q/S/T/ww/w as pre-computed literals wrapped in `[]` so date-fns
  // treats them as escaped literals. Also need to respect existing `[...]`
  // literals — walk the string.
  const m = d.getMonth(); // 0-11
  const q = Math.floor(m / 3) + 1;
  const s = m < 6 ? 1 : 2;
  const t = Math.floor(m / 4) + 1;
  const ww = String(getISOWeek(d)).padStart(2, "0");
  const w = String(getISOWeek(d));
  let out = "";
  let i = 0;
  while (i < f.length) {
    if (f[i] === "[") {
      const close = f.indexOf("]", i);
      if (close === -1) { out += f.slice(i); break; }
      out += f.slice(i, close + 1); i = close + 1; continue;
    }
    if (f.startsWith("ww", i)) { out += "[" + ww + "]"; i += 2; continue; }
    if (f[i] === "w")          { out += "[" + w  + "]"; i += 1; continue; }
    if (f[i] === "Q")          { out += "[" + q  + "]"; i += 1; continue; }
    if (f[i] === "S")          { out += "[" + s  + "]"; i += 1; continue; }
    if (f[i] === "T")          { out += "[" + t  + "]"; i += 1; continue; }
    out += f[i]; i += 1;
  }
  return formatRespectingMMM(d, out, locale);
}

export function interpolate(template: string | null | undefined, ctx: PlaceholderContext): string {
  if (!template) return "";
  return template.replace(TOKEN_RE, (match, name?: string, fmt?: string) => {
    if (match === "$$") return "$";
    if (!name) return match;
    // Dropped v1 tokens: strip so old templates don't leak `${...}` literals.
    if (DROPPED_TOKENS.includes(name)) return "";
    if (name === "runNumber") return padNumber(ctx.runNumber, fmt);
    const d = dateValue(name, ctx);
    if (!d) return match; // unknown token → surface for typo detection
    try { return formatDateExtended(d, fmt, ctx.locale); }
    catch { return match; }
  });
}
