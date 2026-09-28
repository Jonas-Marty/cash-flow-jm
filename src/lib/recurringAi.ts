import * as z from "zod";
import { enUS } from "date-fns/locale";
import type { DayRule, RecurringRule, TxType, WeekendAdjust } from "@/lib/finance";
import { DROPPED_TOKENS, TOKENS, interpolate } from "@/lib/placeholders";
import { emptyDraft, todayStr, type Draft } from "@/lib/recurringDraft";

/**
 * AI-proposed recurring rules: the model's loose JSON, how it becomes an
 * editor `Draft`, and the guide the model reads before proposing one.
 *
 * Shared by the ✨ button in Settings (document → JSON in one call) and the
 * chat tools (`list_recurring_rules` / `prepare_recurring_rule`). Nothing here
 * saves anything: the draft always opens in the normal rule dialog.
 */

// ---------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------

const looseNum = z.union([z.number(), z.string()]).nullish();
const looseStr = z.string().nullish();
const looseBool = z.union([z.boolean(), z.string()]).nullish();

/**
 * Everything is optional and loosely typed on purpose: models quote numbers,
 * leave fields out, or send `null`. `suggestionToDraft` is what enforces the
 * rules. Accounts, category and the similar rule may be given as id or name.
 */
export const ruleSuggestionSchema = z
  .object({
    name: looseStr,
    type: looseStr,
    amount: looseNum,
    is_variable_amount: looseBool,
    estimated_amount: looseNum,
    source_account: looseStr,
    destination_account: looseStr,
    category: looseStr,
    description: looseStr,
    note: looseStr,
    recurrence_interval: looseNum,
    execution_day_rule: looseStr,
    execution_day_of_month: looseNum,
    execution_weekend_adjustment: looseStr,
    period_day_rule: looseStr,
    period_day_of_month: looseNum,
    /** Start of the period the FIRST payment covers (the invoice's billing period). Preferred. */
    first_period_from: looseStr,
    period_offset_months: looseNum,
    /** Legacy, in whole intervals. */
    period_offset: looseNum,
    starts_on: looseStr,
    ends_on: looseStr,
    auto_post: looseBool,
    is_variable_date: looseBool,
    similar_rule: looseStr,
    notes: z.union([z.array(z.string()), z.string()]).nullish(),
  })
  .passthrough();

export type RuleSuggestion = z.infer<typeof ruleSuggestionSchema>;

export interface NamedRow {
  id: string;
  name: string;
  archived?: boolean;
}

export interface SuggestionContext {
  accounts: NamedRow[];
  categories: NamedRow[];
  rules: Pick<RecurringRule, "id" | "name">[];
  /** Defaults to today; injectable for tests. */
  today?: string;
}

export interface SuggestionResult {
  draft: Draft;
  /** Things the user should check: dropped ids, invalid tokens, clamped values. */
  warnings: string[];
  /** The model's own remarks (what it was unsure about). */
  notes: string[];
  /** An existing rule the document seems to belong to. */
  similar_rule: { id: string; name: string } | null;
}

function toNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v
      .trim()
      .replace(/[’'\s]/g, "")
      .replace(/[^\d.,-]/g, "")
      .replace(/,(?=\d{3}\b)/g, "")
      .replace(",", ".");
    if (s !== "" && !Number.isNaN(Number(s))) return Number(s);
  }
  return undefined;
}

function toBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "yes", "1", "ja"].includes(s)) return true;
    if (["false", "no", "0", "nein"].includes(s)) return false;
  }
  return undefined;
}

function toStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function toIsoDate(v: unknown): string | undefined {
  const s = toStr(v);
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const ch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (ch) return `${ch[3]}-${ch[2].padStart(2, "0")}-${ch[1].padStart(2, "0")}`;
  return undefined;
}

function clampInt(v: number | undefined, min: number, max: number): number | undefined {
  if (v === undefined) return undefined;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  const s = toStr(v);
  if (!s) return undefined;
  return allowed.find((a) => a.toLowerCase() === s.toLowerCase());
}

/** Find a row by exact id, then by name (exact, contains, contained). Archived rows never match. */
export function matchRow<T extends NamedRow>(rows: T[], query: string | undefined): T | undefined {
  if (!query) return undefined;
  const active = rows.filter((r) => !r.archived);
  const byId = active.find((r) => r.id === query);
  if (byId) return byId;
  const q = query.toLowerCase().trim();
  return (
    active.find((r) => r.name.toLowerCase() === q) ||
    active.find((r) => r.name.toLowerCase().includes(q)) ||
    active.find((r) => q.includes(r.name.toLowerCase()))
  );
}

const TOKEN_RE = /\$\{([a-zA-Z]+)(?::([^}]*))?\}/g;
const KNOWN_TOKENS = new Set(TOKENS.map((t) => t.token));
const SAMPLE_DATE = new Date(2026, 5, 30);

/**
 * Remove placeholders that would stay as raw `${…}` text in real
 * transactions: unknown names, dropped v1 names, and formats the formatter
 * rejects. Returns the cleaned template and the removed tokens.
 */
export function sanitizeTemplate(template: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const text = template.replace(TOKEN_RE, (match, name: string) => {
    if (!KNOWN_TOKENS.has(name) || DROPPED_TOKENS.includes(name)) {
      removed.push(match);
      return "";
    }
    const out = interpolate(match, {
      date: SAMPLE_DATE,
      dueDate: SAMPLE_DATE,
      periodFrom: SAMPLE_DATE,
      periodTo: SAMPLE_DATE,
      runNumber: 1,
      locale: enUS,
    });
    if (out === match) {
      removed.push(match);
      return "";
    }
    return match;
  });
  return { text: removed.length ? text.replace(/\s{2,}/g, " ").trim() : text, removed };
}

const TX_TYPES: readonly TxType[] = ["expense", "income", "transfer"];
const DAY_RULES: readonly DayRule[] = ["FixedDay", "LastDay", "FirstDay"];
const WEEKEND: readonly WeekendAdjust[] = ["None", "PreviousBusinessDay", "NextBusinessDay"];

/**
 * Turn the model's suggestion into an editor draft. Every value is checked:
 * ids must exist, numbers are clamped to what the editor allows, and
 * templates lose tokens that would not render. What had to be changed is
 * reported in `warnings` so the dialog can show it.
 */
export function suggestionToDraft(raw: unknown, ctx: SuggestionContext): SuggestionResult {
  const parsed = ruleSuggestionSchema.safeParse(raw ?? {});
  const s: RuleSuggestion = parsed.success ? parsed.data : {};
  const warnings: string[] = [];
  const d = emptyDraft();
  const today = ctx.today ?? todayStr();

  const name = toStr(s.name);
  if (name) d.name = name.slice(0, 120);

  const type = pickEnum(s.type, TX_TYPES);
  if (type) d.type = type;

  const variable = toBool(s.is_variable_amount) ?? false;
  const amount = toNum(s.amount);
  const estimate = toNum(s.estimated_amount);
  d.is_variable_amount = variable;
  if (variable) {
    const est = estimate ?? amount;
    if (est !== undefined && est > 0) d.estimated_amount = String(Math.abs(est));
    d.amount = "0";
  } else if (amount !== undefined && amount !== 0) {
    d.amount = String(Math.abs(amount));
  } else {
    warnings.push("amount_missing");
  }

  const src = matchRow(ctx.accounts, toStr(s.source_account));
  if (src) d.source_account_id = src.id;
  else if (toStr(s.source_account)) warnings.push(`account_unknown:${toStr(s.source_account)}`);

  if (d.type === "transfer") {
    const dst = matchRow(ctx.accounts, toStr(s.destination_account));
    if (dst && dst.id !== d.source_account_id) d.destination_account_id = dst.id;
    else if (toStr(s.destination_account)) warnings.push(`account_unknown:${toStr(s.destination_account)}`);
  } else {
    const cat = matchRow(ctx.categories, toStr(s.category));
    if (cat) d.category_id = cat.id;
    else if (toStr(s.category)) warnings.push(`category_unknown:${toStr(s.category)}`);
  }

  for (const field of ["description", "note"] as const) {
    const v = toStr(s[field]);
    if (!v) continue;
    const { text, removed } = sanitizeTemplate(v.slice(0, 500));
    d[field] = text;
    for (const r of removed) warnings.push(`token_removed:${r}`);
  }

  const interval = clampInt(toNum(s.recurrence_interval), 1, 12);
  if (interval !== undefined) d.recurrence_interval = interval;

  d.execution_day_rule = pickEnum(s.execution_day_rule, DAY_RULES) ?? d.execution_day_rule;
  const execDay = clampInt(toNum(s.execution_day_of_month), 1, 31);
  if (execDay !== undefined) d.execution_day_of_month = String(execDay);
  d.execution_weekend_adjustment = pickEnum(s.execution_weekend_adjustment, WEEKEND) ?? d.execution_weekend_adjustment;

  const starts = toIsoDate(s.starts_on);
  if (starts) {
    d.starts_on = starts;
    if (starts < today) warnings.push("starts_in_past");
  }

  d.period_day_rule = pickEnum(s.period_day_rule, DAY_RULES) ?? "FirstDay";
  const periodDay = clampInt(toNum(s.period_day_of_month), 1, 31);
  if (periodDay !== undefined) d.period_day_of_month = String(periodDay);

  // The period offset in months, from the most reliable thing the model gave:
  // the billing period it read off the invoice, then an explicit month
  // offset, then the legacy interval offset.
  const firstPeriod = toIsoDate(s.first_period_from);
  let offsetMonths: number | undefined;
  if (firstPeriod) {
    const [fy, fm, fd] = firstPeriod.split("-").map(Number);
    const [sy, sm] = d.starts_on.split("-").map(Number);
    offsetMonths = (fy - sy) * 12 + (fm - sm);
    if (fd > 1 && !pickEnum(s.period_day_rule, DAY_RULES)) {
      d.period_day_rule = "FixedDay";
      d.period_day_of_month = String(fd);
    }
  } else if (toNum(s.period_offset_months) !== undefined) {
    offsetMonths = Math.round(toNum(s.period_offset_months)!);
  } else if (toNum(s.period_offset) !== undefined) {
    offsetMonths = Math.round(toNum(s.period_offset)!) * d.recurrence_interval;
  }
  if (offsetMonths !== undefined) {
    const clamped = clampInt(offsetMonths, -36, 36)!;
    if (clamped !== offsetMonths) warnings.push("offset_clamped");
    d.period_offset_months = clamped;
  }
  const ends = toIsoDate(s.ends_on);
  if (ends && ends >= d.starts_on) d.ends_on = ends;

  d.is_variable_date = toBool(s.is_variable_date) ?? false;
  const autoPost = toBool(s.auto_post);
  if (autoPost !== undefined) d.auto_post = autoPost;
  // Same coupling the dialog's switches apply: something the user has to
  // confirm each time cannot also post itself.
  if (d.is_variable_amount || d.is_variable_date) d.auto_post = false;
  d.backfill = "none";

  const notes = Array.isArray(s.notes)
    ? s.notes.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim())
    : toStr(s.notes)
      ? [toStr(s.notes)!]
      : [];

  const similar = matchRow(ctx.rules, toStr(s.similar_rule));

  return {
    draft: d,
    warnings,
    notes: notes.slice(0, 8),
    similar_rule: similar ? { id: similar.id, name: similar.name } : null,
  };
}

// ---------------------------------------------------------------------------
// Guide for the model
// ---------------------------------------------------------------------------

export interface GuideRule {
  name: string;
  type: TxType;
  amount: number | null;
  is_variable_amount: boolean;
  estimated_amount: number | null;
  source_account_id: string;
  destination_account_id: string | null;
  category_id: string | null;
  description: string | null;
  recurrence_interval: number;
  execution_day_rule: DayRule;
  execution_day_of_month: number | null;
  period_offset_months: number;
  starts_on: string;
  ends_on: string | null;
  archived: boolean;
  id: string;
}

export interface GuideContext {
  rules: GuideRule[];
  accounts: NamedRow[];
  categories: NamedRow[];
  today: string;
  currency: string;
  language: string;
}

function dayLabel(rule: DayRule, dom: number | null): string {
  if (rule === "LastDay") return "last day";
  if (rule === "FirstDay") return "1st";
  return `day ${dom ?? 1}`;
}

/** YYYY-MM of the first period a rule reports, from its start month and offset. */
function firstPeriodOf(r: Pick<GuideRule, "starts_on" | "period_offset_months">): string {
  const [y, m] = r.starts_on.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + (r.period_offset_months ?? 0), 1));
  return d.toISOString().slice(0, 7);
}

/** One line per rule, cheap enough to send every rule the user has. */
export function describeRules(ctx: Pick<GuideContext, "rules" | "accounts" | "categories" | "today">): string {
  const name = (rows: NamedRow[], id: string | null) => (id ? rows.find((r) => r.id === id)?.name ?? "?" : null);
  const active = ctx.rules.filter((r) => !r.archived && (!r.ends_on || r.ends_on >= ctx.today));
  if (active.length === 0) return "(the user has no recurring rules yet)";
  return active
    .map((r) => {
      const amount = r.is_variable_amount
        ? `variable, ~${r.estimated_amount ?? "?"}`
        : String(r.amount ?? "?");
      const target =
        r.type === "transfer"
          ? `${name(ctx.accounts, r.source_account_id)} → ${name(ctx.accounts, r.destination_account_id)}`
          : `${name(ctx.accounts, r.source_account_id)}, category ${name(ctx.categories, r.category_id) ?? "-"}`;
      return `- id ${r.id} | "${r.name}" | ${r.type} ${amount} | ${target} | every ${r.recurrence_interval} mo, ${dayLabel(r.execution_day_rule, r.execution_day_of_month)}, starts ${r.starts_on}, first period ${firstPeriodOf(r)} | description "${r.description ?? ""}"`;
    })
    .join("\n");
}

/**
 * The rules of the recurrence engine and six worked examples, verified
 * against `previewOccurrences` (see recurringAi.test.ts). Plain text so it
 * works both as a system prompt and inside a tool result.
 */
export const RECURRING_RULE_GUIDE = `HOW A RECURRING RULE WORKS
- recurrence_interval: months between payments (1 monthly, 2 every two months, 3 quarterly, 6 half-yearly, 12 yearly).
- starts_on (YYYY-MM-DD): the 1st of the month of the FIRST payment. Payments then fall every interval months from that month.
- execution_day_rule: "FixedDay" (with execution_day_of_month 1-31, short months snap to their last day), "LastDay" or "FirstDay". Use the due date / payment deadline of the invoice.
- execution_weekend_adjustment: "None", "PreviousBusinessDay" or "NextBusinessDay" (shifts only the payment date).
- first_period_from (YYYY-MM-DD): the first day of the period the FIRST payment covers — the invoice's billing period / "Leistungszeitraum" / "Abrechnungsperiode". It may lie before the payment (bill paid in arrears), in the same month (paid in advance) or after it (paid ahead). Each later payment covers the next period of interval months. Just copy it from the invoice; do not calculate anything.
- is_variable_amount: true when the amount changes each time (electricity, phone usage). Then set estimated_amount to the invoice amount; amount is ignored. Such rules are never auto-posted.
- is_variable_date: true when the payment date is not predictable.
- auto_post: true only for fixed amounts that are debited automatically (standing order / direct debit). Otherwise false.
- type: "expense" (money out), "income" (money in) or "transfer" (between two of the user's own accounts; then set destination_account and no category).

PLACEHOLDERS in description and note
Tokens: \${date} (payment date after weekend shift), \${dueDate} (before the shift), \${periodFrom}, \${periodTo} (the reporting period), \${runNumber} (1, 2, 3 …).
Date format after a colon, e.g. \${periodFrom:MMMM yyyy}:
  yyyy / yy year, MM / M month number, MMM short and MMMM long month name, dd / d day, ddd / dddd weekday,
  Q quarter (1-4), S half-year (1-2), T trimester (1-3), ww / w ISO week.
  Any other letters inside the format are read as tokens too, so keep words OUTSIDE the braces ("Quartal \${periodTo:Q}")
  or put them in square brackets (\${periodTo:[Q]Q yyyy} → "Q2 2026").
Only use these tokens; anything else is removed.

WORKED EXAMPLES (JSON fields you return)
1. Monthly rent, CHF 1'850, due on the 1st for that month, standing order:
   {"name":"Miete","type":"expense","amount":1850,"recurrence_interval":1,"execution_day_rule":"FixedDay","execution_day_of_month":1,"starts_on":"2026-11-01","first_period_from":"2026-11-01","auto_post":true,"description":"Miete \${periodFrom:MMMM yyyy}"}
   → 1 Nov 2026 reports November 2026 → "Miete November 2026".
2. Invoice for LAST month, e.g. a cleaning service billing September on 10 October, same amount every month:
   {"name":"Reinigung","type":"expense","amount":240,"recurrence_interval":1,"execution_day_rule":"FixedDay","execution_day_of_month":10,"starts_on":"2026-10-01","first_period_from":"2026-09-01","auto_post":false,"description":"Reinigung \${periodFrom:MMMM}"}
   → 10 Oct reports 1–30 Sep → "Reinigung September".
3. Electricity every two months, amount varies, invoice for September–October due 20 November:
   {"name":"Strom","type":"expense","is_variable_amount":true,"estimated_amount":132.4,"recurrence_interval":2,"execution_day_rule":"FixedDay","execution_day_of_month":20,"starts_on":"2026-11-01","first_period_from":"2026-09-01","description":"Strom \${periodFrom:MM}–\${periodTo:MM.yyyy}"}
   → 20 Nov reports 1 Sep–31 Oct → "Strom 09–10.2026".
4. Quarterly, paid in arrears: invoice for Q3 (July–September) due 15 October:
   {"name":"BSZ Wohnheim","type":"expense","amount":1350,"recurrence_interval":3,"execution_day_rule":"FixedDay","execution_day_of_month":15,"starts_on":"2026-10-01","first_period_from":"2026-07-01","description":"BSZ Wohnheim, Ingenbohl Quartal \${periodTo:Q}"}
   → 15 Oct reports 1 Jul–30 Sep → "BSZ Wohnheim, Ingenbohl Quartal 3".
5. Yearly insurance premium for the calendar year, due 31 January:
   {"name":"Hausrat","type":"expense","amount":312.6,"recurrence_interval":12,"execution_day_rule":"FixedDay","execution_day_of_month":31,"starts_on":"2027-01-01","first_period_from":"2027-01-01","description":"Hausratversicherung \${periodFrom:yyyy}"}
   → 31 Jan 2027 reports 2027 → "Hausratversicherung 2027".
6. Quarterly electricity paid a month after the quarter: invoice for July–September, due 4 November:
   {"name":"Enertech Strom","type":"expense","is_variable_amount":true,"estimated_amount":272.45,"recurrence_interval":3,"execution_day_rule":"FixedDay","execution_day_of_month":4,"starts_on":"2026-11-01","first_period_from":"2026-07-01","description":"Strom Q\${periodTo:Q} \${periodTo:yyyy}"}
   → 4 Nov reports 1 Jul–30 Sep → "Strom Q3 2026".

STYLE
- Match the user's existing rules below: same language, naming, capitalisation, and the same account and category for the same kind of bill.
- If the document is a new invoice for one of those rules (same provider), set similar_rule to that rule's id and still fill every field from the document, so the user can compare.
- Keep name short (the provider or what it is). The description is what each transaction will be called.
- When unsure about a field, leave it out and say why in notes (short strings). Never invent account or category names: use one from the lists.`;

/** Full guide: rules of the engine, examples, and this user's data. */
export function buildRecurringGuide(ctx: GuideContext): string {
  const accounts = ctx.accounts
    .filter((a) => !a.archived)
    .map((a) => `- ${a.id} | ${a.name}`)
    .join("\n");
  const categories = ctx.categories
    .filter((c) => !c.archived)
    .map((c) => `- ${c.id} | ${c.name}`)
    .join("\n");
  return `${RECURRING_RULE_GUIDE}

CONTEXT
Today is ${ctx.today}. Currency: ${ctx.currency}. Write names and descriptions in the user's language (UI language: ${ctx.language}) unless their existing rules use another.

The user's recurring rules:
${describeRules(ctx)}

Accounts (id | name):
${accounts || "(none)"}

Categories (id | name):
${categories || "(none)"}`;
}

/** System prompt for the one-shot document → rule extraction (Settings ✨). */
export function buildRuleExtractSystemPrompt(ctx: GuideContext): string {
  return `You turn an invoice, bill or contract into a recurring-rule draft for a personal-finance app.

First decide what the document is:
- "invoice": a bill, invoice, premium notice or contract with a repeating payment → fill "rule".
- "statement": a bank or card statement listing many transactions → no rule.
- "other": anything else → no rule, explain in notes.

Return ONLY a JSON object:
{"document_kind":"invoice"|"statement"|"other","rule":{…fields as in the examples…,"source_account":"<account id>","category":"<category id>","similar_rule":"<rule id or null>","notes":["…"]}}

Work out the interval from the period the invoice covers (a month, two months, a quarter, a year), and copy that period's first day into first_period_from. If the document states the user's hint differently, follow the hint.

${buildRecurringGuide(ctx)}`;
}
