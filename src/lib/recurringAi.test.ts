import { describe, expect, it } from "vitest";
import { de } from "date-fns/locale";
import { interpolate } from "@/lib/placeholders";
import { previewOccurrences, toISODate } from "@/lib/recurrence";
import {
  RECURRING_RULE_GUIDE,
  buildRecurringGuide,
  buildRuleExtractSystemPrompt,
  sanitizeTemplate,
  suggestionToDraft,
  type GuideRule,
} from "@/lib/recurringAi";

const accounts = [
  { id: "acc-ubs", name: "UBS Privatkonto" },
  { id: "acc-old", name: "Altes Konto", archived: true },
  { id: "acc-sav", name: "Sparkonto" },
];
const categories = [
  { id: "cat-home", name: "Wohnen" },
  { id: "cat-energy", name: "Energie" },
];
const rules = [{ id: "rule-rent", name: "Miete" }];
const ctx = { accounts, categories, rules, today: "2026-09-27" };

describe("suggestionToDraft", () => {
  it("maps a complete suggestion by name and by id", () => {
    const r = suggestionToDraft(
      {
        name: "BSZ Wohnheim",
        type: "expense",
        amount: "1'350.00",
        source_account: "ubs",
        category: "cat-home",
        description: "BSZ Wohnheim, Ingenbohl Quartal ${periodTo:Q}",
        recurrence_interval: 3,
        execution_day_rule: "fixedday",
        execution_day_of_month: "15",
        period_offset: -1,
        starts_on: "01.10.2026",
        notes: "Due date read from the payment slip",
      },
      ctx,
    );
    expect(r.draft).toMatchObject({
      name: "BSZ Wohnheim",
      type: "expense",
      amount: "1350",
      source_account_id: "acc-ubs",
      category_id: "cat-home",
      description: "BSZ Wohnheim, Ingenbohl Quartal ${periodTo:Q}",
      recurrence_interval: 3,
      execution_day_rule: "FixedDay",
      execution_day_of_month: "15",
      period_day_rule: "FirstDay",
      period_offset: -1,
      starts_on: "2026-10-01",
      backfill: "none",
    });
    expect(r.warnings).toEqual([]);
    expect(r.notes).toEqual(["Due date read from the payment slip"]);
    expect(r.similar_rule).toBeNull();
  });

  it("drops unknown and archived ids and says so", () => {
    const r = suggestionToDraft(
      { amount: 10, source_account: "acc-old", category: "Hobbies" },
      ctx,
    );
    expect(r.draft.source_account_id).toBe("");
    expect(r.draft.category_id).toBe("");
    expect(r.warnings).toContain("account_unknown:acc-old");
    expect(r.warnings).toContain("category_unknown:Hobbies");
  });

  it("clamps interval, days and offset", () => {
    const r = suggestionToDraft(
      { amount: 5, recurrence_interval: 24, execution_day_of_month: 40, period_offset: -7 },
      ctx,
    );
    expect(r.draft.recurrence_interval).toBe(12);
    expect(r.draft.execution_day_of_month).toBe("31");
    expect(r.draft.period_offset).toBe(-3);
    expect(r.warnings).toContain("offset_clamped");
  });

  it("variable amount uses the estimate and never auto-posts", () => {
    const r = suggestionToDraft(
      { is_variable_amount: true, amount: 132.4, auto_post: true },
      ctx,
    );
    expect(r.draft.is_variable_amount).toBe(true);
    expect(r.draft.estimated_amount).toBe("132.4");
    expect(r.draft.auto_post).toBe(false);
  });

  it("transfer takes a destination account and no category", () => {
    const r = suggestionToDraft(
      { type: "transfer", amount: 500, source_account: "UBS", destination_account: "Sparkonto", category: "Wohnen" },
      ctx,
    );
    expect(r.draft.destination_account_id).toBe("acc-sav");
    expect(r.draft.category_id).toBe("");
  });

  it("warns about a start in the past and a missing amount", () => {
    const r = suggestionToDraft({ starts_on: "2026-01-01" }, ctx);
    expect(r.warnings).toEqual(expect.arrayContaining(["amount_missing", "starts_in_past"]));
    expect(r.draft.backfill).toBe("none");
  });

  it("finds the similar rule by id or name", () => {
    expect(suggestionToDraft({ similar_rule: "rule-rent" }, ctx).similar_rule).toEqual({ id: "rule-rent", name: "Miete" });
    expect(suggestionToDraft({ similar_rule: "miete" }, ctx).similar_rule?.id).toBe("rule-rent");
  });

  it("survives garbage", () => {
    expect(() => suggestionToDraft(null, ctx)).not.toThrow();
    expect(() => suggestionToDraft({ amount: { nested: 1 } }, ctx)).not.toThrow();
  });
});

describe("sanitizeTemplate", () => {
  it("keeps valid tokens including Q", () => {
    expect(sanitizeTemplate("Quartal ${periodTo:Q} ${periodFrom:MMMM yyyy} #${runNumber}")).toEqual({
      text: "Quartal ${periodTo:Q} ${periodFrom:MMMM yyyy} #${runNumber}",
      removed: [],
    });
  });

  it("removes unknown and dropped tokens", () => {
    const r = sanitizeTemplate("Rechnung ${quarter} ${invoiceNo} ${periodTo:yyyy}");
    expect(r.removed).toEqual(["${quarter}", "${invoiceNo}"]);
    expect(r.text).toBe("Rechnung ${periodTo:yyyy}");
  });
});

describe("guide", () => {
  const guideRules: GuideRule[] = [
    {
      id: "rule-rent", name: "Miete", type: "expense", amount: 1850, is_variable_amount: false, estimated_amount: null,
      source_account_id: "acc-ubs", destination_account_id: null, category_id: "cat-home",
      description: "Miete ${periodFrom:MMMM yyyy}", recurrence_interval: 1, execution_day_rule: "FixedDay",
      execution_day_of_month: 1, period_offset: 0, starts_on: "2024-01-01", ends_on: null, archived: false,
    },
    {
      id: "rule-old", name: "Altes Abo", type: "expense", amount: 9, is_variable_amount: false, estimated_amount: null,
      source_account_id: "acc-ubs", destination_account_id: null, category_id: null,
      description: null, recurrence_interval: 1, execution_day_rule: "LastDay",
      execution_day_of_month: null, period_offset: 0, starts_on: "2024-01-01", ends_on: "2025-01-01", archived: false,
    },
  ];
  const g = buildRecurringGuide({ rules: guideRules, accounts, categories, today: "2026-09-27", currency: "CHF", language: "de" });

  it("lists active rules with names instead of ids", () => {
    expect(g).toContain('"Miete" | expense 1850 | UBS Privatkonto, category Wohnen | every 1 mo, day 1, offset 0');
    expect(g).not.toContain("Altes Abo");
  });

  it("lists only active accounts", () => {
    expect(g).toContain("acc-ubs | UBS Privatkonto");
    expect(g).not.toContain("Altes Konto");
  });

  it("contains all five examples", () => {
    for (let i = 1; i <= 5; i++) expect(RECURRING_RULE_GUIDE).toContain(`\n${i}. `);
  });

  it("extraction prompt embeds the guide", () => {
    expect(buildRuleExtractSystemPrompt({ rules: guideRules, accounts, categories, today: "2026-09-27", currency: "CHF", language: "de" }))
      .toContain('"document_kind"');
  });

  // The worked examples teach the model how offset and starts_on line up with
  // the reporting period. If the engine's semantics ever change, these break
  // before the model starts proposing wrong rules.
  const examples = [...RECURRING_RULE_GUIDE.matchAll(/^\d\. .*\n\s+(\{.*\})\n\s+→ (\d{1,2} \w{3}(?: \d{4})?) reports .* → "(.*)"\./gm)];

  it("parses every example", () => expect(examples).toHaveLength(5));

  it.each(examples.map((m, i) => [i + 1, m[1], m[3]]))(
    "example %i renders what the guide promises",
    (_n, json, expected) => {
      const s = JSON.parse(json as string);
      const { draft, warnings } = suggestionToDraft(s, { ...ctx, today: "2026-01-01" });
      expect(warnings.filter((w) => w !== "amount_missing")).toEqual([]);
      const [first] = previewOccurrences(
        {
          starts_on: draft.starts_on,
          ends_on: null,
          recurrence_interval: draft.recurrence_interval,
          execution_day_rule: draft.execution_day_rule,
          execution_day_of_month: Number(draft.execution_day_of_month),
          execution_weekend_adjustment: "None",
          period_day_rule: draft.period_day_rule,
          period_day_of_month: 1,
          period_offset: draft.period_offset,
        },
        1,
        new Date(2026, 0, 1),
      );
      const text = interpolate(draft.description, {
        date: first.effective,
        dueDate: first.due,
        periodFrom: first.periodFrom,
        periodTo: first.periodTo,
        runNumber: 1,
        locale: de,
      });
      expect(text).toBe(expected);
      expect(toISODate(first.due) >= draft.starts_on).toBe(true);
    },
  );
});
