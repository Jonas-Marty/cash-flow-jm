import { format as fmtDate, getISOWeek, addDays } from "date-fns";
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

export interface PlaceholderContext {
  /** Effective transaction date (= occurred_on at post time). */
  date: Date;
  /** Original due date before weekend adjustment. */
  dueDate: Date;
  /** Effective date of previous occurrence (or starts_on for first). */
  prevDate: Date;
  /** Effective date of next scheduled occurrence (null if none / unknown). */
  nextDate: Date | null;
  /** Real "now" at posting time. */
  today: Date;
  /** 1-based count of this occurrence within its rule. */
  runNumber: number;
  /** Locale for month/day name rendering — independent of UI language. */
  locale: Locale;
  /** Rule frequency. Drives the reporting-period length. */
  frequency?: "monthly" | "quarterly" | "yearly";
  /** Anchor month of the rule (1-12, from `starts_on`). Drives quarterly/yearly period alignment. */
  anchorMonth?: number;
  /** How many months back the reporting period sits relative to `date`. 0 = same period. */
  reportingOffsetMonths?: number;
}

export interface TokenInfo {
  token: string;
  kind: "date" | "number";
  help: string;
  example: string;
}

export const TOKENS: TokenInfo[] = [
  { token: "date",        kind: "date",   help: "Transaction date", example: "${date:dd.MM.yyyy}" },
  { token: "dueDate",     kind: "date",   help: "Original due date (before weekend shift)", example: "${dueDate:yyyy-MM-dd}" },
  { token: "prevDate",    kind: "date",   help: "Previous occurrence's date", example: "${prevDate:dd.MM.yyyy}" },
  { token: "nextDate",    kind: "date",   help: "Next scheduled occurrence", example: "${nextDate:dd.MM.yyyy}" },
  { token: "periodStart", kind: "date",   help: "Day after prevDate (start of the period)", example: "${periodStart:dd.MM.yyyy}" },
  { token: "periodEnd",   kind: "date",   help: "Same as date (end of the period)", example: "${periodEnd:dd.MM.yyyy}" },
  { token: "today",       kind: "date",   help: "Real current date at post time", example: "${today:yyyy-MM-dd}" },
  { token: "runNumber",   kind: "number", help: "1-based occurrence counter", example: "${runNumber:000}" },
  { token: "quarter",     kind: "number", help: "Calendar quarter 1-4", example: "Q${quarter}" },
  { token: "semester",    kind: "number", help: "Half year 1-2", example: "H${semester}" },
  { token: "trimester",   kind: "number", help: "Third of year 1-3", example: "T${trimester}" },
  { token: "weekOfYear",  kind: "number", help: "ISO week number", example: "W${weekOfYear:00}" },
  { token: "monthOfYear", kind: "number", help: "Month 1-12", example: "${monthOfYear:00}" },
  { token: "year",        kind: "number", help: "Full year", example: "${year}" },
  // Reporting period tokens — derived from the rule's frequency, anchor and offset.
  { token: "periodFrom",      kind: "date",   help: "First day of the reporting period", example: "${periodFrom:dd.MM.yyyy}" },
  { token: "periodTo",        kind: "date",   help: "Last day of the reporting period", example: "${periodTo:dd.MM.yyyy}" },
  { token: "periodQuarter",   kind: "number", help: "Quarter (1-4) of the reporting period", example: "Q${periodQuarter}" },
  { token: "periodMonth",     kind: "number", help: "Month (1-12) of the reporting period", example: "${periodMonth:00}" },
  { token: "periodYear",      kind: "number", help: "Year of the reporting period", example: "${periodYear}" },
  { token: "periodSemester",  kind: "number", help: "Half year (1-2) of the reporting period", example: "H${periodSemester}" },
  { token: "periodTrimester", kind: "number", help: "Third of year (1-3) of the reporting period", example: "T${periodTrimester}" },
  { token: "periodLabel",     kind: "date",   help: "Friendly period label (e.g. \"Q1 2026\", \"März 2026\", \"2026\")", example: "${periodLabel}" },
];

export function describeTokens(): TokenInfo[] {
  return TOKENS;
}

function dateValue(token: string, ctx: PlaceholderContext): Date | null {
  switch (token) {
    case "date": return ctx.date;
    case "dueDate": return ctx.dueDate;
    case "prevDate": return ctx.prevDate;
    case "nextDate": return ctx.nextDate;
    case "periodStart": return addDays(ctx.prevDate, 1);
    case "periodEnd": return ctx.date;
    case "today": return ctx.today;
    case "periodFrom": return computeReportingPeriod(ctx).from;
    case "periodTo": return computeReportingPeriod(ctx).to;
    default: return undefined as unknown as Date | null;
  }
}

/**
 * Compute [from, to] for the reporting period:
 *  - shift `date` back by `reportingOffsetMonths`
 *  - snap to the period bucket of the rule (monthly / quarterly / yearly)
 *    aligned to the anchor month (= `starts_on`'s month)
 */
export function computeReportingPeriod(ctx: PlaceholderContext): { from: Date; to: Date } {
  const freq = ctx.frequency ?? "monthly";
  const offset = ctx.reportingOffsetMonths ?? 0;
  const m0 = ((ctx.anchorMonth ?? 1) - 1 + 12) % 12; // 0-11

  const anchor = new Date(ctx.date.getFullYear(), ctx.date.getMonth() - offset, 1);

  let from: Date;
  let to: Date;
  if (freq === "monthly") {
    from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  } else if (freq === "quarterly") {
    const diff = ((anchor.getMonth() - m0) % 3 + 3) % 3;
    from = new Date(anchor.getFullYear(), anchor.getMonth() - diff, 1);
    to = new Date(from.getFullYear(), from.getMonth() + 3, 0);
  } else {
    // yearly — period starts on month m0
    const startYear = anchor.getMonth() < m0 ? anchor.getFullYear() - 1 : anchor.getFullYear();
    from = new Date(startYear, m0, 1);
    to = new Date(from.getFullYear() + 1, m0, 0);
  }
  return { from, to };
}

function numberValue(token: string, ctx: PlaceholderContext): number | null | undefined {
  const m = ctx.date.getMonth(); // 0-11
  switch (token) {
    case "runNumber": return ctx.runNumber;
    case "quarter": return Math.floor(m / 3) + 1;
    case "semester": return m < 6 ? 1 : 2;
    case "trimester": return Math.floor(m / 4) + 1;
    case "weekOfYear": return getISOWeek(ctx.date);
    case "monthOfYear": return m + 1;
    case "year": return ctx.date.getFullYear();
    case "periodQuarter": { const pm = computeReportingPeriod(ctx).from.getMonth(); return Math.floor(pm / 3) + 1; }
    case "periodSemester": { const pm = computeReportingPeriod(ctx).from.getMonth(); return pm < 6 ? 1 : 2; }
    case "periodTrimester": { const pm = computeReportingPeriod(ctx).from.getMonth(); return Math.floor(pm / 4) + 1; }
    case "periodMonth": return computeReportingPeriod(ctx).from.getMonth() + 1;
    case "periodYear": return computeReportingPeriod(ctx).from.getFullYear();
    default: return undefined;
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

export function interpolate(template: string | null | undefined, ctx: PlaceholderContext): string {
  if (!template) return "";
  return template.replace(TOKEN_RE, (match, name?: string, fmt?: string) => {
    if (match === "$$") return "$";
    if (!name) return match;

    const info = TOKENS.find((tok) => tok.token === name);
    if (!info) return match; // unknown → leave as-is to surface typo

    // Special: periodLabel — frequency-driven friendly label.
    if (name === "periodLabel") {
      const { from } = computeReportingPeriod(ctx);
      const freq = ctx.frequency ?? "monthly";
      if (freq === "quarterly") {
        return `Q${Math.floor(from.getMonth() / 3) + 1} ${from.getFullYear()}`;
      }
      if (freq === "yearly") {
        return String(from.getFullYear());
      }
      const f = fmt && fmt.length > 0 ? normalizeDateFormat(fmt) : "MMMM yyyy";
      try { return formatRespectingMMM(from, f, ctx.locale); } catch { return match; }
    }

    if (info.kind === "date") {
      const d = dateValue(name, ctx);
      if (!d) return ""; // e.g. nextDate unknown
      const f = fmt && fmt.length > 0 ? normalizeDateFormat(fmt) : "yyyy-MM-dd";
      try {
        return formatRespectingMMM(d, f, ctx.locale);
      } catch {
        return match;
      }
    }
    const v = numberValue(name, ctx);
    if (v == null) return match;
    return padNumber(v, fmt);
  });
}
