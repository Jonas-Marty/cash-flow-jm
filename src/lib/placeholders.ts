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
    default: return undefined as unknown as Date | null;
  }
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

    if (info.kind === "date") {
      const d = dateValue(name, ctx);
      if (!d) return ""; // e.g. nextDate unknown
      const f = fmt && fmt.length > 0 ? normalizeDateFormat(fmt) : "yyyy-MM-dd";
      try {
        return fmtDate(d, f, { locale: ctx.locale });
      } catch {
        return match;
      }
    }
    const v = numberValue(name, ctx);
    if (v == null) return match;
    return padNumber(v, fmt);
  });
}
