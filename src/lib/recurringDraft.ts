import type { DayRule, RecurringRule, TxType, WeekendAdjust } from "@/lib/finance";

/**
 * The editor state behind the recurring-rule dialog, and the two ways of
 * seeding it: from nothing, or from an existing rule.
 *
 * It lives here rather than in the card so the seeding rules can be tested —
 * they decide what a saved rule looks like, and getting one of them wrong
 * writes real transactions.
 */
export type Draft = {
  id?: string;
  name: string;
  type: TxType;
  amount: string;
  is_variable_amount: boolean;
  estimated_amount: string;
  source_account_id: string;
  destination_account_id: string;
  category_id: string;
  description: string;
  note: string;
  recurrence_interval: number; // 1..12
  execution_day_rule: DayRule;
  execution_day_of_month: string;
  execution_weekend_adjustment: WeekendAdjust;
  period_day_rule: DayRule;
  period_day_of_month: string;
  period_offset: number; // -3..3
  starts_on: string;
  ends_on: string;
  auto_post: boolean;
  backfill: "none" | "post" | "pending";
  is_variable_date: boolean;
  is_split: boolean;
  slices: SliceDraft[];
};

export type SliceDraft = {
  id?: string;
  amount: string;        // used when !is_variable_amount
  amount_ratio: string;  // used when is_variable_amount (decimal, e.g. "0.5")
  category_id: string;
  description: string;
  note: string;
  is_reimbursable: boolean;
  reimbursable_counterparty: string;
  reimbursable_reason: string;
};

export function emptySlice(): SliceDraft {
  return {
    amount: "",
    amount_ratio: "",
    category_id: "",
    description: "",
    note: "",
    is_reimbursable: false,
    reimbursable_counterparty: "",
    reimbursable_reason: "",
  };
}

export const todayStr = () => new Date().toISOString().slice(0, 10);

export function emptyDraft(): Draft {
  return {
    name: "", type: "expense", amount: "0",
    is_variable_amount: false, estimated_amount: "",
    source_account_id: "", destination_account_id: "", category_id: "",
    description: "", note: "",
    recurrence_interval: 1,
    execution_day_rule: "FixedDay", execution_day_of_month: "1",
    execution_weekend_adjustment: "None",
    period_day_rule: "FixedDay", period_day_of_month: "1",
    period_offset: 0,
    starts_on: todayStr(), ends_on: "",
    auto_post: true,
    backfill: "none",
    is_variable_date: false,
    is_split: false,
    slices: [emptySlice(), emptySlice()],
  };
}

export function ruleToDraft(r: RecurringRule): Draft {
  return {
    id: r.id, name: r.name, type: r.type,
    amount: r.amount != null ? String(r.amount) : "0",
    is_variable_amount: !!r.is_variable_amount,
    estimated_amount: r.estimated_amount != null ? String(r.estimated_amount) : "",
    source_account_id: r.source_account_id,
    destination_account_id: r.destination_account_id ?? "",
    category_id: r.category_id ?? "",
    description: r.description ?? "", note: r.note ?? "",
    recurrence_interval: r.recurrence_interval ?? 1,
    execution_day_rule: r.execution_day_rule,
    execution_day_of_month: String(r.execution_day_of_month ?? 1),
    execution_weekend_adjustment: r.execution_weekend_adjustment,
    period_day_rule: r.period_day_rule,
    period_day_of_month: String(r.period_day_of_month ?? 1),
    period_offset: r.period_offset ?? 0,
    starts_on: r.starts_on, ends_on: r.ends_on ?? "",
    auto_post: r.auto_post,
    backfill: "none",
    is_variable_date: !!r.is_variable_date,
    is_split: !!r.is_split,
    slices: r.slices && r.slices.length >= 2
      ? r.slices.map((s) => ({
          id: s.id,
          amount: s.amount != null ? String(s.amount) : "",
          amount_ratio: s.amount_ratio != null ? String(s.amount_ratio) : "",
          category_id: s.category_id ?? "",
          description: s.description ?? "",
          note: s.note ?? "",
          is_reimbursable: !!s.is_reimbursable,
          reimbursable_counterparty: s.reimbursable_counterparty ?? "",
          reimbursable_reason: s.reimbursable_reason ?? "",
        }))
      : [emptySlice(), emptySlice()],
  };
}

/**
 * A copy of an existing rule, ready to be saved as a new one.
 *
 * Written for the billing-cycle change: end the old rule, copy it, adjust the
 * dates. Everything that describes *what* is paid comes along — amount,
 * accounts, category, description, split slices. Everything that describes
 * *when it ran* is reset, because it belongs to the rule that ran:
 *
 *  - `id`, or `save()` takes its update path and overwrites the original
 *    instead of creating anything.
 *  - `ends_on`, or copying the rule you just ended produces one that is
 *    already over — it lands in the Ended section, generates nothing, and
 *    looks like the button did nothing.
 *  - `starts_on`, or the copy inherits a start months in the past, opens in
 *    backfill mode, and offers to post every occurrence since then as real
 *    transactions.
 *
 * Slice ids go too: `save()` inserts slices fresh under the new rule id, so an
 * id pointing at the original's rows has nothing to say here.
 */
export function duplicateDraft(r: RecurringRule, startsOn: string = todayStr()): Draft {
  const d = ruleToDraft(r);
  return {
    ...d,
    id: undefined,
    starts_on: startsOn,
    ends_on: "",
    backfill: "none",
    slices: d.slices.map((s) => ({ ...s, id: undefined })),
  };
}
