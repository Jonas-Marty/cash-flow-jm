import { supabase } from "@/integrations/supabase/client";

export type AccountType = "asset" | "liability";
export type TxType = "expense" | "income" | "transfer";
export type GroupKind = "income" | "expense" | "savings";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  opening_balance: number;
  archived: boolean;
  icon?: string | null;
  emoji?: string | null;
  image_url?: string | null;
  color?: string | null;
  pinned?: boolean;
  pin_order?: number | null;
  currency_code: string;
  currency_symbol: string;
}
export interface AccountBalance {
  id: string;
  name: string;
  type: AccountType;
  archived: boolean;
  opening_balance: number;
  balance: number;
  currency_code?: string;
  currency_symbol?: string;
}
export interface Category {
  id: string;
  name: string;
  allocated_budget: number;
  sort_order: number;
  archived: boolean;
  group_id: string | null;
  is_savings: boolean;
  icon?: string | null;
  emoji?: string | null;
  image_url?: string | null;
  color?: string | null;
  pinned?: boolean;
  pin_order?: number | null;
}
export interface CategoryGroup {
  id: string;
  name: string;
  kind: GroupKind;
  sort_order: number;
  archived: boolean;
}
export interface CategoryMonthRow {
  category_id: string;
  name: string;
  group_id: string | null;
  group_name: string | null;
  kind: GroupKind;
  is_savings: boolean;
  sort_order: number;
  group_sort_order: number;
  allocated: number;
  spent_or_received: number;
  variance: number;
}
export interface CategorySavingsBalance {
  category_id: string;
  name: string;
  group_id: string | null;
  allocated_total: number;
  spent_total: number;
  balance: number;
}

export interface CategorySavingsBalanceV2 {
  category_id: string;
  name: string;
  archived: boolean;
  cumulative_balance: number;
  month_activity: number;
  from_transactions: number;
  from_reallocations: number;
  from_sweeps: number;
}

export interface ReconciliationSummary {
  accounts_total: number;
  savings_total: number;
  unswept_current_month: number;
  drift: number;
}

export interface CategoryReallocation {
  id: string;
  from_category_id: string;
  to_category_id: string;
  amount: number;
  occurred_on: string;
  note: string | null;
  created_at: string;
}
export interface PendingCategoryImpact {
  category_id: string;
  type: "expense" | "income";
  amount: number; // positive value of the rule's impact (sign decoded by type)
  count: number;
}
export interface CategoryBudget {
  category_id: string;
  month: string; // YYYY-MM-01
  amount: number;
}
export interface Transaction {
  id: string;
  occurred_on: string;
  amount: number;
  description: string | null;
  note: string | null;
  type: TxType;
  source_account_id: string;
  destination_account_id: string | null;
  category_id: string | null;
  created_at: string;
  recurring_rule_id?: string | null;
  split_group_id?: string | null;
  destination_amount?: number | null;
}
export type RecurringFrequency = "monthly" | "quarterly" | "yearly";
export type RecurringDayRule = "fixed_day" | "end_of_month" | "first_of_month";
export type WeekendAdjust = "none" | "before" | "after";
export type OccurrenceStatus = "pending" | "posted" | "skipped";

export interface RecurringRule {
  id: string;
  name: string;
  type: TxType;
  amount: number | null;
  is_variable_amount: boolean;
  estimated_amount: number | null;
  source_account_id: string;
  destination_account_id: string | null;
  category_id: string | null;
  description: string | null;
  note: string | null;
  frequency: RecurringFrequency;
  day_rule: RecurringDayRule;
  day_of_month: number | null;
  weekend_adjust: WeekendAdjust;
  starts_on: string;
  ends_on: string | null;
  auto_post: boolean;
  archived: boolean;
}
export interface RecurringOccurrence {
  id: string;
  rule_id: string;
  due_on: string;
  effective_on: string;
  status: OccurrenceStatus;
  transaction_id: string | null;
  posted_at: string | null;
}

export interface Settings {
  id: string;
  currency_code: string;
  currency_symbol: string;
  language: string;
  day_heatmap_threshold: number;
  date_format: string;
  net_worth_show_converted: boolean;
  theme: "light" | "dark" | "system";
  format_locale: "de" | "en";
}

export const fmtMoney = (n: number, symbol = "CHF") => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}${symbol} ${abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

/**
 * Group amounts by currency code. Each entry is the signed sum in that
 * currency. Used by transaction lists and net-worth widgets to avoid
 * incorrectly summing across currencies.
 */
export function groupSumByCurrency<T>(
  items: T[],
  getCurrency: (item: T) => string,
  getAmount: (item: T) => number,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const cur = getCurrency(it) || "CHF";
    m.set(cur, (m.get(cur) ?? 0) + getAmount(it));
  }
  return m;
}

/**
 * Format a per-currency total map as e.g. `-CHF 120.00 · -EUR 40.00`.
 * Currencies with a zero balance are omitted unless `keepZero` is true.
 * `symbolByCode` lets the caller render the user's preferred symbol per code.
 */
export function formatPerCurrency(
  totals: Map<string, number>,
  symbolByCode: (code: string) => string,
  opts: { sign?: "auto" | "expense" | "income" | "transfer"; keepZero?: boolean } = {},
): string {
  const entries = Array.from(totals.entries()).filter(([, v]) =>
    opts.keepZero ? true : Math.abs(v) > 0.005,
  );
  if (entries.length === 0) return fmtMoney(0, symbolByCode("CHF"));
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries
    .map(([code, v]) => {
      const sym = symbolByCode(code);
      if (opts.sign === "expense") return "-" + fmtMoney(Math.abs(v), sym).replace("-", "");
      if (opts.sign === "income") return "+" + fmtMoney(Math.abs(v), sym).replace("-", "");
      return fmtMoney(v, sym);
    })
    .join(" · ");
}

export const extractTags = (note: string | null | undefined): string[] => {
  if (!note) return [];
  const matches = note.match(/#([A-Za-z0-9_]+)/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1).toLowerCase())));
};

export async function fetchSettings(): Promise<Settings> {
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: created, error: cErr } = await supabase
      .from("settings")
      .insert({ currency_code: "CHF", currency_symbol: "CHF", day_heatmap_threshold: 100, date_format: "dd.MM.yyyy", net_worth_show_converted: false, format_locale: "de" })
      .select()
      .single();
    if (cErr) throw cErr;
    return created as Settings;
  }
  return data as Settings;
}

export async function fetchAccounts(): Promise<Account[]> {
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .order("type")
    .order("name");
  if (error) throw error;
  return (data || []) as Account[];
}

export async function fetchAccountBalances(): Promise<AccountBalance[]> {
  const { data, error } = await supabase
    .from("account_balances")
    .select("*")
    .order("type")
    .order("name");
  if (error) throw error;
  return (data || []) as AccountBalance[];
}

export async function fetchAccountBalancesAsOf(date: string): Promise<AccountBalance[]> {
  const { data, error } = await supabase.rpc("account_balances_as_of", { p_date: date });
  if (error) throw error;
  return (data || []) as AccountBalance[];
}

export const todayISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const endOfMonthISO = (ref: Date = new Date()): string => {
  const d = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const endOfYearISO = (ref: Date = new Date()): string => {
  return `${ref.getFullYear()}-12-31`;
};

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data || []) as Category[];
}

export async function fetchCategoryGroups(): Promise<CategoryGroup[]> {
  const { data, error } = await supabase
    .from("category_groups")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data || []) as CategoryGroup[];
}

export const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

export async function ensureMonthBudgets(month: string): Promise<void> {
  const { error } = await supabase.rpc("ensure_month_budgets", { p_month: month });
  if (error) throw error;
}

export async function fetchCategoryMonthRows(month: string): Promise<CategoryMonthRow[]> {
  await ensureMonthBudgets(month);
  const { data, error } = await supabase.rpc("category_month_spending", { p_month: month });
  if (error) throw error;
  return (data || []) as CategoryMonthRow[];
}

export async function fetchSavingsBalances(): Promise<CategorySavingsBalance[]> {
  const { data, error } = await supabase
    .from("category_savings_balance")
    .select("*");
  if (error) throw error;
  return (data || []) as CategorySavingsBalance[];
}

export async function fetchPendingImpactsForMonth(month: string): Promise<PendingCategoryImpact[]> {
  // month is 'YYYY-MM-01'
  const start = month;
  const d = new Date(month);
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
  const { data, error } = await supabase
    .from("recurring_occurrences")
    .select("effective_on, status, rule:recurring_rules!inner(category_id, type, amount, estimated_amount, is_variable_amount)")
    .eq("status", "pending")
    .gte("effective_on", start)
    .lt("effective_on", end);
  if (error) throw error;
  const map = new Map<string, PendingCategoryImpact>();
  for (const row of (data || []) as Array<{ rule: { category_id: string | null; type: "expense" | "income" | "transfer"; amount: number | null; estimated_amount: number | null; is_variable_amount: boolean } }>) {
    const r = row.rule;
    if (!r || !r.category_id) continue;
    if (r.type === "transfer") continue;
    const v = Number((r.is_variable_amount ? r.estimated_amount : r.amount) ?? 0);
    if (!Number.isFinite(v) || v <= 0) continue;
    const key = `${r.category_id}:${r.type}`;
    const existing = map.get(key);
    if (existing) {
      existing.amount += v;
      existing.count += 1;
    } else {
      map.set(key, { category_id: r.category_id, type: r.type, amount: v, count: 1 });
    }
  }
  return Array.from(map.values());
}

/** Aggregated pending impact for a single category, signed like `category_month_spending.spent_or_received`. */
export interface PendingCategorySigned {
  expense: number; // positive sum of pending expenses
  income: number;  // positive sum of pending incomes
}
export function buildPendingMap(impacts: PendingCategoryImpact[]): Map<string, PendingCategorySigned> {
  const m = new Map<string, PendingCategorySigned>();
  for (const i of impacts) {
    const cur = m.get(i.category_id) ?? { expense: 0, income: 0 };
    if (i.type === "expense") cur.expense += i.amount;
    else cur.income += i.amount;
    m.set(i.category_id, cur);
  }
  return m;
}
/**
 * Compute the pending delta to add to `spent_or_received` for a category row,
 * matching the sign convention from `category_month_spending`.
 * - For income groups: pending = pending_income (positive received).
 * - For expense/savings: pending = pending_expense - pending_income (refunds reduce spend).
 */
export function pendingDeltaForRow(
  pending: PendingCategorySigned | undefined,
  kind: "income" | "expense" | "savings",
): number {
  if (!pending) return 0;
  if (kind === "income") return pending.income;
  return pending.expense - pending.income;
}

export async function fetchCategoryBudgets(categoryId: string): Promise<CategoryBudget[]> {
  const { data, error } = await supabase
    .from("category_budgets")
    .select("*")
    .eq("category_id", categoryId)
    .order("month", { ascending: false });
  if (error) throw error;
  return (data || []) as CategoryBudget[];
}

export async function upsertCategoryBudget(categoryId: string, month: string, amount: number): Promise<void> {
  const { error } = await supabase
    .from("category_budgets")
    .upsert({ category_id: categoryId, month, amount }, { onConflict: "category_id,month" });
  if (error) throw error;
}

export async function fetchTransactions(limit?: number): Promise<Transaction[]> {
  let q = supabase
    .from("transactions")
    .select("*")
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as Transaction[];
}

export async function fetchTransactionTags(): Promise<{ transaction_id: string; tag: string }[]> {
  const { data, error } = await supabase.from("transaction_tags").select("*");
  if (error) throw error;
  return (data || []) as { transaction_id: string; tag: string }[];
}

export async function processRecurringRules(today?: string): Promise<void> {
  const t = today ?? new Date().toISOString().slice(0, 10);
  const { error } = await supabase.rpc("process_recurring_rules", { p_today: t });
  if (error) throw error;
}

export async function fetchRecurringRules(): Promise<RecurringRule[]> {
  const { data, error } = await supabase
    .from("recurring_rules")
    .select("*")
    .order("archived")
    .order("name");
  if (error) throw error;
  return (data || []) as RecurringRule[];
}

export async function fetchPendingOccurrences(): Promise<(RecurringOccurrence & { rule: RecurringRule })[]> {
  const { data, error } = await supabase
    .from("recurring_occurrences")
    .select("*, rule:recurring_rules(*)")
    .eq("status", "pending")
    .order("effective_on", { ascending: true });
  if (error) throw error;
  return (data || []) as (RecurringOccurrence & { rule: RecurringRule })[];
}

export async function postOccurrence(occ: RecurringOccurrence & { rule: RecurringRule }, overrides?: { amount?: number; description?: string | null; note?: string | null; occurred_on?: string }): Promise<void> {
  const r = occ.rule;
  // Determine final amount
  let finalAmount: number;
  if (overrides?.amount !== undefined) {
    finalAmount = overrides.amount;
  } else if (r.is_variable_amount) {
    throw new Error("Amount is required for variable-amount rules");
  } else {
    finalAmount = Number(r.amount ?? 0);
  }
  if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
    throw new Error("Amount must be greater than zero");
  }
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert({
      occurred_on: overrides?.occurred_on ?? occ.effective_on,
      amount: finalAmount,
      type: r.type,
      source_account_id: r.source_account_id,
      destination_account_id: r.destination_account_id,
      category_id: r.category_id,
      description: overrides?.description ?? r.description,
      note: overrides?.note ?? r.note,
      recurring_rule_id: r.id,
    })
    .select()
    .single();
  if (txErr) throw txErr;
  const { error } = await supabase
    .from("recurring_occurrences")
    .update({ status: "posted", transaction_id: tx.id, posted_at: new Date().toISOString() })
    .eq("id", occ.id);
  if (error) throw error;
}

export async function skipOccurrence(id: string): Promise<void> {
  const { error } = await supabase.from("recurring_occurrences").update({ status: "skipped" }).eq("id", id);
  if (error) throw error;
}

export interface RecurringPreviewRow {
  due_on: string;
  effective_on: string;
  in_past: boolean;
}

export async function previewRecurringRule(input: {
  day_rule: RecurringDayRule;
  day_of_month: number | null;
  weekend_adjust: WeekendAdjust;
  starts_on: string;
  ends_on: string | null;
  from: string;
  to: string;
  frequency?: RecurringFrequency;
}): Promise<RecurringPreviewRow[]> {
  const { data, error } = await supabase.rpc("preview_recurring_rule", {
    p_day_rule: input.day_rule,
    p_day_of_month: input.day_of_month,
    p_weekend_adjust: input.weekend_adjust,
    p_starts_on: input.starts_on,
    p_ends_on: input.ends_on,
    p_from: input.from,
    p_to: input.to,
    p_frequency: input.frequency ?? "monthly",
  } as never);
  if (error) throw error;
  return (data || []) as RecurringPreviewRow[];
}

export async function archiveRecurringRule(id: string, deletePending = true): Promise<void> {
  const { error } = await supabase.rpc("archive_recurring_rule", { p_id: id, p_delete_pending: deletePending });
  if (error) throw error;
}

export async function applyRecurringRuleBackfill(ruleId: string, mode: "none" | "post" | "pending"): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.rpc("apply_recurring_rule_backfill", {
    p_rule_id: ruleId,
    p_mode: mode,
    p_today: today,
  });
  if (error) throw error;
}

export function describeSchedule(r: RecurringRule, t: (k: string, v?: Record<string, string | number>) => string): string {
  const parts: string[] = [];
  parts.push(
    r.frequency === "quarterly"
      ? t("recurring.freq.quarterly")
      : r.frequency === "yearly"
        ? t("recurring.freq.yearly")
        : t("recurring.freq.monthly")
  );
  if (r.day_rule === "first_of_month") parts.push(t("recurring.sched.first"));
  else if (r.day_rule === "end_of_month") parts.push(t("recurring.sched.end"));
  else parts.push(t("recurring.sched.day", { d: r.day_of_month ?? 1 }));
  if (r.weekend_adjust === "before") parts.push(t("recurring.sched.weekend_before"));
  else if (r.weekend_adjust === "after") parts.push(t("recurring.sched.weekend_after"));
  return parts.join(" · ");
}
