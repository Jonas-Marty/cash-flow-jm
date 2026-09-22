import { describe, expect, it } from "vitest";
import { duplicateDraft, ruleToDraft, todayStr } from "./recurringDraft";
import type { RecurringRule, RecurringRuleSlice } from "@/lib/finance";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CATEGORY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** A monthly subscription that has been running since spring. */
function rule(over: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: "rule-1",
    name: "Spotify",
    type: "expense",
    amount: 12.95,
    is_variable_amount: false,
    estimated_amount: null,
    source_account_id: ACCOUNT,
    destination_account_id: null,
    category_id: CATEGORY,
    description: "Spotify Familie",
    note: "Abo",
    recurrence_interval: 1,
    execution_day_rule: "FixedDay",
    execution_day_of_month: 4,
    execution_weekend_adjustment: "None",
    period_day_rule: "FixedDay",
    period_day_of_month: 1,
    period_offset: 0,
    starts_on: "2026-03-04",
    ends_on: null,
    auto_post: true,
    archived: false,
    ...over,
  };
}

function slice(over: Partial<RecurringRuleSlice> = {}): RecurringRuleSlice {
  return {
    id: "slice-1",
    rule_id: "rule-1",
    sort_order: 0,
    amount: 6.5,
    amount_ratio: null,
    category_id: CATEGORY,
    description: "Anteil",
    note: null,
    is_reimbursable: false,
    reimbursable_counterparty: null,
    reimbursable_reason: null,
    ...over,
  };
}

describe("duplicateDraft", () => {
  it("carries over everything that says what is paid", () => {
    const d = duplicateDraft(rule());
    expect(d.name).toBe("Spotify");
    expect(d.amount).toBe("12.95");
    expect(d.source_account_id).toBe(ACCOUNT);
    expect(d.category_id).toBe(CATEGORY);
    expect(d.description).toBe("Spotify Familie");
    expect(d.note).toBe("Abo");
    expect(d.auto_post).toBe(true);
    expect(d.recurrence_interval).toBe(1);
    expect(d.execution_day_of_month).toBe("4");
  });

  it("drops the id, so saving creates a rule instead of overwriting the original", () => {
    // `save()` branches on `isNew = !draft.id`. Keep the id and the copy button
    // silently edits the rule it was supposed to copy — the user ends up with
    // one rule where they wanted two, and the old schedule is gone.
    expect(ruleToDraft(rule()).id).toBe("rule-1");
    expect(duplicateDraft(rule()).id).toBeUndefined();
  });

  it("clears the end date of a rule that has already been ended", () => {
    // The exact flow this exists for: the old cycle was closed with an end
    // date, then copied. Carrying `ends_on` over makes a rule that is already
    // over — it sorts into Ended, generates no occurrences, and looks like the
    // button did nothing at all.
    const ended = rule({ ends_on: "2026-09-30" });
    expect(ruleToDraft(ended).ends_on).toBe("2026-09-30");
    expect(duplicateDraft(ended).ends_on).toBe("");
  });

  it("starts today rather than inheriting a start months in the past", () => {
    // A past `starts_on` puts the dialog in backfill mode, and an auto-post
    // rule copied that way offers to post every occurrence since March as real
    // transactions.
    expect(ruleToDraft(rule()).starts_on).toBe("2026-03-04");
    expect(duplicateDraft(rule()).starts_on).toBe(todayStr());
  });

  it("takes an explicit start date for the new cycle", () => {
    expect(duplicateDraft(rule(), "2026-11-01").starts_on).toBe("2026-11-01");
  });

  it("never asks to backfill", () => {
    expect(duplicateDraft(rule(), "2026-01-01").backfill).toBe("none");
  });

  it("copies split slices but not their ids", () => {
    // Slices are inserted fresh under the new rule id; an id pointing at the
    // original's rows belongs to a different rule.
    const split = rule({
      is_split: true,
      slices: [slice(), slice({ id: "slice-2", sort_order: 1, description: "Rest" })],
    });
    const d = duplicateDraft(split);
    expect(d.is_split).toBe(true);
    expect(d.slices.map((s) => s.description)).toEqual(["Anteil", "Rest"]);
    expect(d.slices.map((s) => s.id)).toEqual([undefined, undefined]);
  });

  it("leaves the original rule untouched", () => {
    const original = rule({ ends_on: "2026-09-30" });
    duplicateDraft(original);
    expect(original.ends_on).toBe("2026-09-30");
    expect(original.starts_on).toBe("2026-03-04");
  });
});
