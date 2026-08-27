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
  sweep_target_category_id?: string | null;
  is_scope?: boolean;
  funding_category_id?: string | null;
  closed_at?: string | null;
}
export interface CategoryGroup {
  id: string;
  name: string;
  kind: GroupKind;
  sort_order: number;
  archived: boolean;
  sweep_target_category_id?: string | null;
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
  is_reimbursable?: boolean;
  reimbursable_status?: "open" | "settled" | "cancelled" | null;
  reimbursable_counterparty?: string | null;
  reimbursable_reason?: string | null;
  reimbursable_cancel_reason?: string | null;
  reimbursable_writeoff_category_id?: string | null;
  reimbursable_writeoff_transaction_id?: string | null;
  fee_amount?: number | null;
  fee_transaction_id?: string | null;
  fee_category_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_accuracy_m?: number | null;
  location_label?: string | null;
  location_source?: string | null;
}

export type PendingTransactionStatus = "pending" | "confirmed" | "rejected";
export interface PendingTransaction {
  id: string;
  status: PendingTransactionStatus;
  source_account_id: string;
  amount: number;
  type: TxType;
  occurred_on: string;
  destination_account_id: string | null;
  destination_amount: number | null;
  category_id: string | null;
  description: string | null;
  note: string | null;
  external_source: string | null;
  external_ref: string | null;
  external_info: string | null;
  confirmed_transaction_id: string | null;
  confirmed_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchPendingTransactions(
  status?: PendingTransactionStatus,
): Promise<PendingTransaction[]> {
  let q = supabase
    .from("pending_transactions")
    .select("*")
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as PendingTransaction[];
}

export async function confirmPendingTransaction(
  pendingId: string,
  overrides: {
    source_account_id: string;
    amount: number;
    type: TxType;
    occurred_on: string;
    destination_account_id?: string | null;
    destination_amount?: number | null;
    category_id?: string | null;
    description?: string | null;
    note?: string | null;
  },
): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) throw new Error("Not authenticated");
  const insertPayload = {
    user_id: userId,
    source_account_id: overrides.source_account_id,
    amount: overrides.amount,
    type: overrides.type,
    occurred_on: overrides.occurred_on,
    destination_account_id:
      overrides.type === "transfer" ? overrides.destination_account_id ?? null : null,
    destination_amount:
      overrides.type === "transfer" ? overrides.destination_amount ?? null : null,
    category_id: overrides.type === "transfer" ? null : overrides.category_id ?? null,
    description: overrides.description ?? null,
    note: overrides.note ?? null,
  };
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert(insertPayload)
    .select("id")
    .single();
  if (txErr) throw txErr;
  const { error: upErr } = await supabase
    .from("pending_transactions")
    .update({
      status: "confirmed",
      confirmed_transaction_id: tx.id,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", pendingId);
  if (upErr) throw upErr;
  return tx.id;
}

export async function rejectPendingTransaction(
  pendingId: string,
  reason?: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("pending_transactions")
    .update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      reject_reason: (reason ?? "").trim() || null,
    })
    .eq("id", pendingId);
  if (error) throw error;
}

export async function restorePendingTransaction(pendingId: string): Promise<void> {
  const { error } = await supabase
    .from("pending_transactions")
    .update({ status: "pending", rejected_at: null, reject_reason: null })
    .eq("id", pendingId);
  if (error) throw error;
}
export type DayRule = "FixedDay" | "LastDay" | "FirstDay";
export type WeekendAdjust = "None" | "PreviousBusinessDay" | "NextBusinessDay";
/** @deprecated use `DayRule` — kept only for backwards imports. */
export type DayRuleV2 = DayRule;
/** @deprecated use `WeekendAdjust` — kept only for backwards imports. */
export type WeekendAdjustV2 = WeekendAdjust;
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
  // Recurrence engine v2 fields
  recurrence_interval: number; // 1..12 (months)
  execution_day_rule: DayRuleV2;
  execution_day_of_month: number | null;
  execution_weekend_adjustment: WeekendAdjustV2;
  period_day_rule: DayRuleV2;
  period_day_of_month: number | null;
  period_offset: number; // -3..3
  starts_on: string;
  ends_on: string | null;
  auto_post: boolean;
  archived: boolean;
  is_split?: boolean;
  is_variable_date?: boolean;
  slices?: RecurringRuleSlice[];
}

export interface RecurringRuleSlice {
  id: string;
  rule_id: string;
  sort_order: number;
  amount: number | null;
  amount_ratio: number | null;
  category_id: string | null;
  description: string | null;
  note: string | null;
  is_reimbursable: boolean;
  reimbursable_counterparty: string | null;
  reimbursable_reason: string | null;
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
  active_scope_id: string | null;
  currency_code: string;
  currency_symbol: string;
  language: string;
  day_heatmap_threshold: number;
  date_format: string;
  net_worth_show_converted: boolean;
  theme: "light" | "dark" | "system";
  format_locale: "de" | "en";
  default_sweep_category_id?: string | null;
  capture_location?: boolean;
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
  // Allow unicode letters (umlauts, accents, etc.), digits, underscore and hyphen.
  // First char must be a letter/digit/underscore so `#-foo` isn't treated as a tag.
  const matches = note.match(/#([\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1).toLowerCase())));
};

export async function fetchSettings(): Promise<Settings> {
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: created, error: cErr } = await supabase
      .from("settings")
      .insert({ currency_code: "CHF", currency_symbol: "CHF", day_heatmap_threshold: 100, date_format: "dd.MM.yyyy", net_worth_show_converted: false, format_locale: "de" })
      .select()
      .single();
    if (cErr) {
      // Another tab may have created the row concurrently (unique on user_id).
      const { data: existing, error: rErr } = await supabase
        .from("settings")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (rErr || !existing) throw cErr;
      return existing as Settings;
    }
    return created as Settings;
  }
  return data as Settings;
}

export async function updateActiveScope(activeScopeId: string | null): Promise<void> {
  const settings = await fetchSettings();
  const { error } = await supabase
    .from("settings")
    .update({ active_scope_id: activeScopeId })
    .eq("id", settings.id);
  if (error) throw error;
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

/**
 * Fetch transactions within an inclusive date range. Returns up to `limit`
 * (default 5000) rows ordered by occurrence (asc — useful for time series).
 */
export async function fetchTransactionsRange(
  fromISO: string,
  toISO: string,
  limit = 5000,
): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .gte("occurred_on", fromISO)
    .lte("occurred_on", toISO)
    .order("occurred_on", { ascending: true })
    .limit(limit);
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

/**
 * Catch-up sweep (fallback for when no external scheduler runs).
 *
 * Server-side claim: the RPC only processes when `settings.last_recurring_sweep_on`
 * is older than today, so multiple tabs/devices can call it freely — exactly one
 * per day does the work. Returns true when this call performed the sweep.
 */
export async function processRecurringRulesIfStale(today?: string): Promise<boolean> {
  const t = today ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc("process_recurring_rules_if_stale", { p_today: t });
  if (error) throw error;
  return data === true;
}

export async function fetchRecurringRules(): Promise<RecurringRule[]> {
  const { data, error } = await supabase
    .from("recurring_rules")
    .select("*, slices:recurring_rule_slices(*)")
    .order("archived")
    .order("name");
  if (error) throw error;
  const rules = (data || []) as RecurringRule[];
  for (const r of rules) {
    if (r.slices) r.slices.sort((a, b) => a.sort_order - b.sort_order);
  }
  return rules;
}

export async function fetchPendingOccurrences(): Promise<(RecurringOccurrence & { rule: RecurringRule })[]> {
  const { data, error } = await supabase
    .from("recurring_occurrences")
    .select("*, rule:recurring_rules(*, slices:recurring_rule_slices(*))")
    .eq("status", "pending")
    .order("effective_on", { ascending: true });
  if (error) throw error;
  const rows = (data || []) as (RecurringOccurrence & { rule: RecurringRule })[];
  for (const o of rows) {
    if (o.rule?.slices) o.rule.slices.sort((a, b) => a.sort_order - b.sort_order);
  }
  return rows;
}

/** All occurrences of one rule (any status), with the rule + slices joined. */
export async function fetchOccurrencesForRule(
  ruleId: string,
): Promise<(RecurringOccurrence & { rule: RecurringRule })[]> {
  const { data, error } = await supabase
    .from("recurring_occurrences")
    .select("*, rule:recurring_rules(*, slices:recurring_rule_slices(*))")
    .eq("rule_id", ruleId)
    .order("effective_on", { ascending: true });
  if (error) throw error;
  const rows = (data || []) as (RecurringOccurrence & { rule: RecurringRule })[];
  for (const o of rows) {
    if (o.rule?.slices) o.rule.slices.sort((a, b) => a.sort_order - b.sort_order);
  }
  return rows;
}

/**
 * Create a single pending occurrence for a rule/date pair (used by the "create
 * this missing entry" action in the rule preview) and return it with the rule
 * joined so it can be fed straight into PostOccurrenceDialog.
 */
export async function createPendingOccurrence(
  ruleId: string,
  dueOn: string,
  effectiveOn: string,
): Promise<RecurringOccurrence & { rule: RecurringRule }> {
  const { data, error } = await supabase
    .from("recurring_occurrences")
    .insert({ rule_id: ruleId, due_on: dueOn, effective_on: effectiveOn, status: "pending" })
    .select("*, rule:recurring_rules(*, slices:recurring_rule_slices(*))")
    .single();
  if (error) throw error;
  const row = data as RecurringOccurrence & { rule: RecurringRule };
  if (row.rule?.slices) row.rule.slices.sort((a, b) => a.sort_order - b.sort_order);
  return row;
}

/** Delete a still-pending occurrence (e.g. a placeholder the user cancelled). */
export async function deletePendingOccurrence(id: string): Promise<void> {
  const { error } = await supabase
    .from("recurring_occurrences")
    .delete()
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw error;
}

export async function postOccurrence(occ: RecurringOccurrence & { rule: RecurringRule }, overrides?: { amount?: number; description?: string | null; note?: string | null; occurred_on?: string; slices?: Array<{ description?: string | null; note?: string | null }> }): Promise<void> {
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
  const occurredOn = overrides?.occurred_on ?? occ.effective_on;

  // ───── Split path: fan out into N transactions sharing a split_group_id ─────
  if (r.is_split && r.slices && r.slices.length >= 2 && r.type !== "transfer") {
    const { computeSliceAmounts } = await import("./recurringSlices");
    const { interpolate, resolveFormatLocale } = await import("./placeholders");
    const slices = [...r.slices].sort((a, b) => a.sort_order - b.sort_order);
    const sliceAmounts = computeSliceAmounts(
      slices.map((s) => ({ amount: s.amount, amount_ratio: s.amount_ratio })),
      finalAmount,
    );
    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id;
    if (!userId) throw new Error("Not authenticated");
    const groupId = crypto.randomUUID();
    // Build interpolation context for slice description/note using sibling
    // occurrences of this rule (mirrors the SQL auto-post path).
    const { data: sib } = await supabase
      .from("recurring_occurrences")
      .select("effective_on")
      .eq("rule_id", r.id)
      .order("effective_on", { ascending: true });
    const siblings = (sib ?? []).map((x) => x.effective_on as string);
    const prevStr = siblings.filter((d) => d < occ.effective_on).pop() ?? r.starts_on;
    const nextStr = siblings.find((d) => d > occ.effective_on) ?? null;
    const runNumber = siblings.filter((d) => d <= occ.effective_on).length || 1;
    const settingsRow = await supabase.from("settings").select("format_locale").maybeSingle();
    const fmtLocale = resolveFormatLocale(settingsRow.data?.format_locale);
    const { periodBoundsForDue, parseISODate } = await import("./recurrence");
    const { from: periodFrom, to: periodTo } = periodBoundsForDue(
      { ...r } as unknown as import("./recurrence").RuleShape,
      parseISODate(occ.due_on),
    );
    const ctx = {
      date: new Date(occurredOn),
      dueDate: new Date(occ.due_on),
      periodFrom,
      periodTo,
      runNumber,
      locale: fmtLocale,
    };
    // siblings used only for run-number below; keep dead-simple markers to
    // avoid unused-var lint when the block above is inlined.
    void prevStr; void nextStr;
    const rows = slices.map((s, i) => ({
      user_id: userId,
      occurred_on: occurredOn,
      amount: sliceAmounts[i],
      type: r.type,
      source_account_id: r.source_account_id,
      destination_account_id: null,
      category_id: s.category_id ?? null,
      description: s.description ? interpolate(s.description, ctx) : null,
      note: s.note ? interpolate(s.note, ctx) : null,
      recurring_rule_id: r.id,
      split_group_id: groupId,
      is_reimbursable: !!s.is_reimbursable,
      reimbursable_status: s.is_reimbursable ? "open" : null,
      reimbursable_counterparty: s.is_reimbursable ? (s.reimbursable_counterparty ?? null) : null,
      reimbursable_reason: s.is_reimbursable ? (s.reimbursable_reason ?? null) : null,
    }));
    const { data: inserted, error: insErr } = await supabase
      .from("transactions")
      .insert(rows)
      .select("id");
    if (insErr) throw insErr;
    const firstId = inserted?.[0]?.id;
    const { error } = await supabase
      .from("recurring_occurrences")
      .update({ status: "posted", transaction_id: firstId ?? null, posted_at: new Date().toISOString() })
      .eq("id", occ.id);
    if (error) throw error;
    return;
  }

  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert({
      occurred_on: occurredOn,
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
  period_from: string;
  period_to: string;
  in_past: boolean;
}

export async function previewRecurringRule(input: {
  recurrence_interval: number;
  execution_day_rule: DayRuleV2;
  execution_day_of_month: number | null;
  execution_weekend_adjustment: WeekendAdjustV2;
  period_day_rule: DayRuleV2;
  period_day_of_month: number | null;
  period_offset: number;
  starts_on: string;
  ends_on: string | null;
  from: string;
  to: string;
}): Promise<RecurringPreviewRow[]> {
  const { data, error } = await supabase.rpc("preview_recurring_rule", {
    p_recurrence_interval: input.recurrence_interval,
    p_execution_day_rule: input.execution_day_rule,
    p_execution_day_of_month: input.execution_day_of_month as number,
    p_execution_weekend_adjustment: input.execution_weekend_adjustment,
    p_period_day_rule: input.period_day_rule,
    p_period_day_of_month: input.period_day_of_month as number,
    p_period_offset: input.period_offset,
    p_starts_on: input.starts_on,
    p_ends_on: input.ends_on as string,
    p_from: input.from,
    p_to: input.to,
  });
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
  parts.push(t("recurring.sched.every_n_months", { n: r.recurrence_interval }));
  if (r.execution_day_rule === "FirstDay") parts.push(t("recurring.sched.first"));
  else if (r.execution_day_rule === "LastDay") parts.push(t("recurring.sched.end"));
  else parts.push(t("recurring.sched.day", { d: r.execution_day_of_month ?? 1 }));
  if (r.execution_weekend_adjustment === "PreviousBusinessDay") parts.push(t("recurring.sched.weekend_before"));
  else if (r.execution_weekend_adjustment === "NextBusinessDay") parts.push(t("recurring.sched.weekend_after"));
  return parts.join(" · ");
}

// --- Savings reallocations & sweeps ---

export async function fetchSavingsBalancesV2(asOf?: string): Promise<CategorySavingsBalanceV2[]> {
  const date = asOf ?? todayISO();
  const { data, error } = await supabase.rpc("category_savings_balance_v2", { p_as_of: date });
  if (error) throw error;
  return (data || []) as CategorySavingsBalanceV2[];
}

export interface SavingsBalancePoint {
  category_id: string;
  name: string;
  archived: boolean;
  as_of: string;
  cumulative_balance: number;
}

/**
 * Month-end cumulative balances for every savings envelope between two dates.
 * One round trip; the last point is clamped to `toISO` when it is not a month end.
 */
export async function fetchSavingsBalanceSeries(
  fromISO: string,
  toISO: string,
): Promise<SavingsBalancePoint[]> {
  const { data, error } = await supabase.rpc("category_savings_balance_series", {
    p_from: fromISO,
    p_to: toISO,
  });
  if (error) throw error;
  return (data || []) as SavingsBalancePoint[];
}

export async function fetchReconciliationSummary(asOf?: string): Promise<ReconciliationSummary | null> {
  const date = asOf ?? todayISO();
  const { data, error } = await supabase.rpc("reconciliation_summary", { p_as_of: date });
  if (error) throw error;
  const rows = (data || []) as ReconciliationSummary[];
  return rows[0] ?? null;
}

export async function fetchReallocations(): Promise<CategoryReallocation[]> {
  const { data, error } = await supabase
    .from("category_reallocations")
    .select("id, from_category_id, to_category_id, amount, occurred_on, note, created_at")
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as CategoryReallocation[];
}

export async function createReallocation(input: {
  from_category_id: string;
  to_category_id: string;
  amount: number;
  occurred_on?: string;
  note?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("category_reallocations").insert({
    from_category_id: input.from_category_id,
    to_category_id: input.to_category_id,
    amount: input.amount,
    occurred_on: input.occurred_on ?? todayISO(),
    note: input.note ?? null,
  });
  if (error) throw error;
}

export async function updateReallocation(id: string, patch: Partial<{
  from_category_id: string;
  to_category_id: string;
  amount: number;
  occurred_on: string;
  note: string | null;
}>): Promise<void> {
  const { error } = await supabase.from("category_reallocations").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteReallocation(id: string): Promise<void> {
  const { error } = await supabase.from("category_reallocations").delete().eq("id", id);
  if (error) throw error;
}

export async function archiveSavingsEnvelope(id: string, moveRemainingTo: string | null): Promise<void> {
  const { error } = await supabase.rpc("archive_savings_envelope", {
    p_id: id,
    p_move_remaining_to: moveRemainingTo,
  } as never);
  if (error) throw error;
}

export async function setCategorySweepTarget(categoryId: string, targetId: string | null): Promise<void> {
  const { error } = await supabase
    .from("categories")
    .update({ sweep_target_category_id: targetId })
    .eq("id", categoryId);
  if (error) throw error;
}

export async function setGroupSweepTarget(groupId: string, targetId: string | null): Promise<void> {
  const { error } = await supabase
    .from("category_groups")
    .update({ sweep_target_category_id: targetId })
    .eq("id", groupId);
  if (error) throw error;
}

export async function setDefaultSweepTarget(targetId: string | null): Promise<void> {
  // Settings has only one row per user
  const { data: existing, error: selErr } = await supabase
    .from("settings")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) throw new Error("Settings row not found");
  const { error } = await supabase
    .from("settings")
    .update({ default_sweep_category_id: targetId })
    .eq("id", existing.id);
  if (error) throw error;
}

// ───────── Reimbursements (transactions you'll get paid back for) ─────────

export interface ReimbursementLink {
  id: string;
  user_id: string;
  original_transaction_id: string;
  settling_transaction_id: string;
  amount: number;
  created_at: string;
}

export async function fetchOpenReimbursables(): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("is_reimbursable", true)
    .eq("reimbursable_status", "open")
    .order("occurred_on", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Transaction[];
}

export async function fetchReimbursementLinks(): Promise<ReimbursementLink[]> {
  const { data, error } = await supabase
    .from("transaction_reimbursements")
    .select("*");
  if (error) throw error;
  return (data ?? []) as ReimbursementLink[];
}

export async function fetchReimbursementCounterparties(): Promise<string[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("reimbursable_counterparty")
    .eq("is_reimbursable", true)
    .not("reimbursable_counterparty", "is", null)
    .limit(500);
  if (error) throw error;
  const set = new Set<string>();
  (data ?? []).forEach((r) => {
    const v = (r as { reimbursable_counterparty: string | null }).reimbursable_counterparty;
    if (v && v.trim()) set.add(v.trim());
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export async function linkReimbursement(
  originalId: string,
  settlingId: string,
  amount: number,
): Promise<void> {
  const { error } = await supabase
    .from("transaction_reimbursements")
    .insert({ original_transaction_id: originalId, settling_transaction_id: settlingId, amount });
  if (error) throw error;
}

export async function unlinkReimbursement(linkId: string): Promise<void> {
  const { error } = await supabase
    .from("transaction_reimbursements")
    .delete()
    .eq("id", linkId);
  if (error) throw error;
}

export async function setReimbursableStatus(
  txId: string,
  status: "open" | "settled" | "cancelled",
  cancelReason?: string | null,
): Promise<void> {
  const { data, error } = await supabase
    .from("transactions")
    .update({
      reimbursable_status: status,
      reimbursable_cancel_reason: status === "cancelled" ? cancelReason ?? null : null,
    })
    .eq("id", txId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Update affected no rows — check permissions or that the transaction still exists.");
  }
}

// Write off an open reimbursable: creates an offsetting transaction in a chosen
// category and links it to settle the original. No real money moves — the
// offsetting entry is for budgeting/reporting only.
export async function writeOffReimbursable(
  originalTxId: string,
  opts: { categoryId: string; note?: string | null },
): Promise<void> {
  // Load the original
  const { data: orig, error: loadErr } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", originalTxId)
    .single();
  if (loadErr) throw loadErr;
  if (!orig) throw new Error("Original transaction not found");
  const o = orig as Transaction;
  if (!o.is_reimbursable) throw new Error("Transaction is not reimbursable");
  if (o.type === "transfer") throw new Error("Transfers cannot be written off");

  // Determine remaining amount
  const { data: linksData, error: linksErr } = await supabase
    .from("transaction_reimbursements")
    .select("amount")
    .eq("original_transaction_id", originalTxId);
  if (linksErr) throw linksErr;
  const linked = (linksData ?? []).reduce(
    (s, r) => s + Number((r as { amount: number }).amount),
    0,
  );
  const remaining = Math.max(0, Number(o.amount) - linked);
  if (remaining <= 0) throw new Error("Nothing left to write off");

  // Build offsetting transaction
  const today = new Date().toISOString().slice(0, 10);
  const offsetType: TxType = o.type === "expense" ? "income" : "expense";
  const descPrefix = o.type === "expense" ? "Write-off" : "Forgiven";
  const baseNote = (opts.note ?? "").trim();
  const noteParts = ["#writeoff"];
  if (baseNote) noteParts.push(baseNote);

  const { data: inserted, error: insErr } = await supabase
    .from("transactions")
    .insert({
      occurred_on: today,
      amount: remaining,
      type: offsetType,
      source_account_id: o.source_account_id,
      destination_account_id: null,
      category_id: opts.categoryId,
      description: `${descPrefix}: ${o.description ?? ""}`.trim().replace(/:\s*$/, ""),
      note: noteParts.join(" "),
      is_reimbursable: false,
    })
    .select("id")
    .single();
  if (insErr) throw insErr;
  const offsetId = (inserted as { id: string }).id;

  // Link as reimbursement (trigger flips status to settled)
  const { error: linkErr } = await supabase
    .from("transaction_reimbursements")
    .insert({
      original_transaction_id: originalTxId,
      settling_transaction_id: offsetId,
      amount: remaining,
    });
  if (linkErr) throw linkErr;

  // Tag the original with write-off metadata
  const { error: updErr } = await supabase
    .from("transactions")
    .update({
      reimbursable_writeoff_category_id: opts.categoryId,
      reimbursable_writeoff_transaction_id: offsetId,
    })
    .eq("id", originalTxId);
  if (updErr) throw updErr;
}

// =====================================================================
// Account reconciliation: statement balances + optional compensation tx
// =====================================================================

export type StatementStatus = "open" | "matched" | "compensated";

export interface AccountStatement {
  id: string;
  account_id: string;
  as_of: string; // YYYY-MM-DD
  statement_balance: number;
  source: string;
  external_ref: string | null;
  note: string | null;
  status: StatementStatus;
  compensation_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountStatementWithDiff extends AccountStatement {
  computed_balance: number;
  diff: number; // statement - computed
}

const RECONCILE_CATEGORY_NAME = "Reconciliation adjustment";

export async function fetchAccountStatements(
  accountId?: string,
): Promise<AccountStatement[]> {
  let q = supabase
    .from("account_statements")
    .select("*")
    .order("as_of", { ascending: false })
    .order("created_at", { ascending: false });
  if (accountId) q = q.eq("account_id", accountId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as AccountStatement[];
}

export async function fetchAccountBalanceAsOf(
  accountId: string,
  date: string,
): Promise<number> {
  const balances = await fetchAccountBalancesAsOf(date);
  const row = balances.find((b) => b.id === accountId);
  return row ? Number(row.balance) : 0;
}

export async function upsertAccountStatement(input: {
  account_id: string;
  as_of: string;
  statement_balance: number;
  source?: string;
  external_ref?: string | null;
  note?: string | null;
}): Promise<AccountStatement> {
  const row = {
    account_id: input.account_id,
    as_of: input.as_of,
    statement_balance: input.statement_balance,
    source: input.source ?? "manual",
    external_ref: input.external_ref ?? null,
    note: input.note ?? null,
  };
  const { data, error } = await supabase
    .from("account_statements")
    .upsert(row, { onConflict: "account_id,as_of,source" })
    .select("*")
    .single();
  if (error) throw error;
  return data as AccountStatement;
}

export async function updateAccountStatement(
  id: string,
  patch: Partial<Pick<AccountStatement, "as_of" | "statement_balance" | "note" | "external_ref">>,
): Promise<void> {
  const { error } = await supabase
    .from("account_statements")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function matchStatement(id: string): Promise<void> {
  const { data: s, error } = await supabase
    .from("account_statements")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  const stmt = s as AccountStatement;
  const computed = await fetchAccountBalanceAsOf(stmt.account_id, stmt.as_of);
  const diff = Number(stmt.statement_balance) - computed;
  if (Math.abs(diff) > 0.005) {
    throw new Error("Cannot mark as matched: balance still differs");
  }
  const { error: uErr } = await supabase
    .from("account_statements")
    .update({ status: "matched", compensation_transaction_id: null })
    .eq("id", id);
  if (uErr) throw uErr;
}

async function ensureReconcileCategory(userId: string): Promise<string> {
  const { data: existing, error: selErr } = await supabase
    .from("categories")
    .select("id")
    .eq("user_id", userId)
    .eq("name", RECONCILE_CATEGORY_NAME)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing?.id) return existing.id;
  const { data: ins, error: insErr } = await supabase
    .from("categories")
    .insert({ name: RECONCILE_CATEGORY_NAME, user_id: userId })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return ins.id as string;
}

export async function postCompensationForStatement(id: string): Promise<{
  transaction_id: string;
  diff: number;
}> {
  const { data: s, error } = await supabase
    .from("account_statements")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  const stmt = s as AccountStatement;

  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const computed = await fetchAccountBalanceAsOf(stmt.account_id, stmt.as_of);
  const diff = Math.round((Number(stmt.statement_balance) - computed) * 100) / 100;
  if (Math.abs(diff) < 0.005) {
    // Nothing to compensate — mark matched instead.
    await supabase
      .from("account_statements")
      .update({ status: "matched", compensation_transaction_id: null })
      .eq("id", id);
    throw new Error("Balance already matches; marked as matched.");
  }

  // If there's an existing comp tx, delete it first (trigger will reopen, but
  // we're about to overwrite the row anyway).
  if (stmt.compensation_transaction_id) {
    await supabase.from("transactions").delete().eq("id", stmt.compensation_transaction_id);
  }

  const categoryId = await ensureReconcileCategory(userId);
  const type: TxType = diff > 0 ? "income" : "expense";
  const amount = Math.abs(diff);

  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert({
      occurred_on: stmt.as_of,
      amount,
      type,
      source_account_id: stmt.account_id,
      category_id: categoryId,
      description: "Reconciliation adjustment",
      user_id: userId,
    })
    .select("id")
    .single();
  if (txErr) throw txErr;

  const { error: uErr } = await supabase
    .from("account_statements")
    .update({
      status: "compensated",
      compensation_transaction_id: tx.id,
    })
    .eq("id", id);
  if (uErr) throw uErr;

  return { transaction_id: tx.id as string, diff };
}

export async function deleteAccountStatement(
  id: string,
  opts: { deleteCompensation?: boolean } = {},
): Promise<void> {
  if (opts.deleteCompensation) {
    const { data: s } = await supabase
      .from("account_statements")
      .select("compensation_transaction_id")
      .eq("id", id)
      .maybeSingle();
    const compId = (s as { compensation_transaction_id: string | null } | null)?.compensation_transaction_id;
    if (compId) {
      await supabase.from("transactions").delete().eq("id", compId);
    }
  }
  const { error } = await supabase.from("account_statements").delete().eq("id", id);
  if (error) throw error;
}

// ───────── Scopes ─────────
// A "scope" is a normal category row with `is_scope = true`. The active scope
// is persisted in settings and auto-fills the category in /add.
// On close, the total of all transactions on this scope category is
// reallocated from the chosen funding category in one entry.

export interface Scope extends Category {
  is_scope: true;
}

export async function fetchScopes(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("is_scope", true)
    .order("closed_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as Category[];
}

export async function fetchScopeTotal(scopeId: string): Promise<{ spent: number; count: number }> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount,type")
    .eq("category_id", scopeId);
  if (error) throw error;
  const rows = (data || []) as { amount: number; type: TxType }[];
  let spent = 0;
  for (const r of rows) {
    const a = Number(r.amount);
    spent += r.type === "income" ? -a : a;
  }
  return { spent: Math.round(spent * 100) / 100, count: rows.length };
}

export async function createScope(input: {
  name: string;
  funding_category_id: string | null;
  allocated_budget?: number;
  emoji?: string | null;
  color?: string | null;
}): Promise<Category> {
  const { data, error } = await supabase
    .from("categories")
    .insert({
      name: input.name,
      is_scope: true,
      // Scopes are savings envelopes: closing one books a reallocation
      // from the funding envelope, and both endpoints must be savings.
      is_savings: true,
      funding_category_id: input.funding_category_id,
      allocated_budget: input.allocated_budget ?? 0,
      emoji: input.emoji ?? "🎯",
      color: input.color ?? null,
      sort_order: 9000,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Category;
}

export async function updateScope(id: string, patch: Partial<{
  name: string;
  funding_category_id: string | null;
  allocated_budget: number;
  emoji: string | null;
  color: string | null;
}>): Promise<void> {
  const { error } = await supabase.from("categories").update(patch).eq("id", id);
  if (error) throw error;
}

/**
 * Close a scope: insert one reallocation from funding -> scope for the total
 * spent, then mark closed_at. Returns the reallocation id (for undo) and total.
 * If funding_category_id is null, only marks closed_at.
 */
export async function closeScope(scopeId: string): Promise<{ reallocationId: string | null; total: number }> {
  const { data: scope, error: sErr } = await supabase
    .from("categories")
    .select("id,funding_category_id,closed_at")
    .eq("id", scopeId)
    .single();
  if (sErr) throw sErr;
  const s = scope as { id: string; funding_category_id: string | null; closed_at: string | null };
  if (s.closed_at) throw new Error("Scope already closed");
  const { spent } = await fetchScopeTotal(scopeId);
  let reallocationId: string | null = null;
  if (s.funding_category_id && spent > 0) {
    const { data: ins, error: rErr } = await supabase
      .from("category_reallocations")
      .insert({
        from_category_id: s.funding_category_id,
        to_category_id: scopeId,
        amount: spent,
        occurred_on: new Date().toISOString().slice(0, 10),
        note: "Scope close",
      })
      .select("id")
      .single();
    if (rErr) throw rErr;
    reallocationId = (ins as { id: string }).id;
  }
  const { error: uErr } = await supabase
    .from("categories")
    .update({ closed_at: new Date().toISOString() })
    .eq("id", scopeId);
  if (uErr) throw uErr;
  return { reallocationId, total: spent };
}

export async function reopenScope(scopeId: string, reallocationId: string | null): Promise<void> {
  if (reallocationId) {
    await supabase.from("category_reallocations").delete().eq("id", reallocationId);
  }
  const { error } = await supabase.from("categories").update({ closed_at: null }).eq("id", scopeId);
  if (error) throw error;
}

export async function deleteScope(scopeId: string): Promise<void> {
  const { error } = await supabase.from("categories").delete().eq("id", scopeId);
  if (error) throw error;
}
