import { describe, it, expect } from "vitest";
import {
  pickOccurrenceForBill,
  proposalDeviates,
  recurringProposalInputSchema,
} from "./recurringProposal";

const RULE = "22222222-2222-2222-2222-222222222222";

const occ = (effective_on: string, status = "pending") => ({ effective_on, status });

describe("pickOccurrenceForBill", () => {
  const monthEnd = [occ("2026-08-31", "posted"), occ("2026-09-30"), occ("2026-10-30")];

  it("takes the next occurrence when the bill arrives ahead of its due date", () => {
    // The "one" bill: notification on 15.09., rule due at the end of the month.
    expect(pickOccurrenceForBill(monthEnd, "2026-09-15", 1)?.effective_on).toBe("2026-09-30");
  });

  it("still finds the occurrence when the bill arrives a few days late", () => {
    const tenth = [occ("2026-09-10"), occ("2026-10-10")];
    expect(pickOccurrenceForBill(tenth, "2026-09-12", 1)?.effective_on).toBe("2026-09-10");
  });

  it("returns a late bill's occurrence even when it is already posted", () => {
    // Refusing is the caller's job; silently filling October would be wrong.
    const posted = [occ("2026-09-10", "posted"), occ("2026-10-10")];
    expect(pickOccurrenceForBill(posted, "2026-09-12", 1)).toEqual(occ("2026-09-10", "posted"));
  });

  it("finds nothing when the schedule has no entry anywhere near the bill", () => {
    expect(pickOccurrenceForBill([occ("2027-03-31")], "2026-09-15", 1)).toBeNull();
    expect(pickOccurrenceForBill([], "2026-09-15", 1)).toBeNull();
  });

  it("looks one whole interval ahead for quarterly rules", () => {
    expect(pickOccurrenceForBill([occ("2026-11-30")], "2026-09-15", 3)?.effective_on).toBe(
      "2026-11-30",
    );
  });

  it("does not depend on the input order", () => {
    const shuffled = [occ("2026-10-30"), occ("2026-09-30"), occ("2026-08-31", "posted")];
    expect(pickOccurrenceForBill(shuffled, "2026-09-15", 1)?.effective_on).toBe("2026-09-30");
  });
});

describe("recurringProposalInputSchema", () => {
  const base = {
    recurring_rule_id: RULE,
    amount: 2691.72,
    occurred_on: "2026-09-15",
    external_source: "FinReader",
    external_ref: "abc123",
  };

  it("accepts a bill proposal and rounds the amount", () => {
    const r = recurringProposalInputSchema.safeParse({ ...base, amount: "2691.724" });
    expect(r.success).toBe(true);
    expect(r.data!.amount).toBe(2691.72);
    expect(r.data!.external_info).toBeNull();
  });

  it("requires the date, the source and the ref", () => {
    for (const key of ["occurred_on", "external_source", "external_ref"] as const) {
      const { [key]: _drop, ...rest } = base;
      expect(recurringProposalInputSchema.safeParse(rest).success).toBe(false);
    }
    expect(recurringProposalInputSchema.safeParse({ ...base, external_source: "  " }).success).toBe(
      false,
    );
  });

  it("rejects a zero amount", () => {
    expect(recurringProposalInputSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
  });
});

describe("proposalDeviates", () => {
  it("flags an amount far from the estimate", () => {
    expect(proposalDeviates(2691.72, 80)).toBe(true);
    expect(proposalDeviates(20, 80)).toBe(true);
  });

  it("accepts ordinary variation, or no estimate at all", () => {
    expect(proposalDeviates(95.4, 80)).toBe(false);
    expect(proposalDeviates(95.4, null)).toBe(false);
  });
});
