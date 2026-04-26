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
}
export interface AccountBalance {
  id: string;
  name: string;
  type: AccountType;
  archived: boolean;
  opening_balance: number;
  balance: number;
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
export interface CategoryBudget {
  category_id: string;
  month: string; // YYYY-MM-01
  amount: number;
}
export interface Transaction {
  id: string;
  occurred_on: string;
  amount: number;
  payee: string | null;
  note: string | null;
  type: TxType;
  source_account_id: string;
  destination_account_id: string | null;
  category_id: string | null;
  created_at: string;
}
export type RecurringFrequency = "monthly";
export type RecurringDayRule = "fixed_day" | "end_of_month" | "first_of_month";
export type WeekendAdjust = "none" | "before" | "after";
export type OccurrenceStatus = "pending" | "posted" | "skipped";

export interface RecurringRule {
  id: string;
  name: string;
  type: TxType;
  amount: number;
  source_account_id: string;
  destination_account_id: string | null;
  category_id: string | null;
  payee: string | null;
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
}

export const fmtMoney = (n: number, symbol = "CHF") => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}${symbol} ${abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

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
      .insert({ currency_code: "CHF", currency_symbol: "CHF", day_heatmap_threshold: 100, date_format: "dd.MM.yyyy" })
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

export async function postOccurrence(occ: RecurringOccurrence & { rule: RecurringRule }, overrides?: { amount?: number; payee?: string | null; note?: string | null; occurred_on?: string }): Promise<void> {
  const r = occ.rule;
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert({
      occurred_on: overrides?.occurred_on ?? occ.effective_on,
      amount: overrides?.amount ?? r.amount,
      type: r.type,
      source_account_id: r.source_account_id,
      destination_account_id: r.destination_account_id,
      category_id: r.category_id,
      payee: overrides?.payee ?? r.payee,
      note: overrides?.note ?? r.note,
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

export function describeSchedule(r: RecurringRule, t: (k: string, v?: Record<string, string | number>) => string): string {
  const parts: string[] = [];
  if (r.day_rule === "first_of_month") parts.push(t("recurring.sched.first"));
  else if (r.day_rule === "end_of_month") parts.push(t("recurring.sched.end"));
  else parts.push(t("recurring.sched.day", { d: r.day_of_month ?? 1 }));
  if (r.weekend_adjust === "before") parts.push(t("recurring.sched.weekend_before"));
  else if (r.weekend_adjust === "after") parts.push(t("recurring.sched.weekend_after"));
  return parts.join(" · ");
}
