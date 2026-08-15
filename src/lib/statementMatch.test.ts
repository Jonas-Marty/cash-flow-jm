import { describe, expect, it } from "vitest";
import { matchLines, type AppEntry } from "@/utils/statements.server";

function entry(id: string, on: string, amount: number, description: string): AppEntry {
  return { key: `t:${id}`, transaction_id: id, split_group_id: null, occurred_on: on, amount, description };
}

describe("matchLines", () => {
  it("matches one-to-one when several rows share the same amount", () => {
    const lines = [
      { id: "l1", booking_date: "2026-07-01", value_date: null, description: "Bar Beer", amount: -5 },
      { id: "l2", booking_date: "2026-07-01", value_date: null, description: "Bar Beer", amount: -5 },
      { id: "l3", booking_date: "2026-07-02", value_date: null, description: "Bar Beer", amount: -5 },
    ];
    const entries = [entry("a", "2026-07-01", -5, "Beer"), entry("b", "2026-07-01", -5, "Beer")];
    const res = matchLines(lines, entries, 3);
    const matched = res.filter((r) => r.matched_transaction_id);
    expect(matched).toHaveLength(2);
    expect(new Set(matched.map((m) => m.matched_transaction_id)).size).toBe(2);
    expect(res.filter((r) => r.match_status === "unmatched")).toHaveLength(1);
  });

  it("does not match outside the date window or on differing amounts", () => {
    const lines = [{ id: "l1", booking_date: "2026-07-10", value_date: null, description: "Coop", amount: -19.95 }];
    expect(matchLines(lines, [entry("a", "2026-07-20", -19.95, "Coop")], 3)[0].match_status).toBe("unmatched");
    expect(matchLines(lines, [entry("a", "2026-07-10", -19.55, "Coop")], 3)[0].match_status).toBe("unmatched");
  });

  it("flags weak description overlap as probable", () => {
    const lines = [{ id: "l1", booking_date: "2026-07-10", value_date: null, description: "SIX PMT 4711", amount: -42 }];
    const res = matchLines(lines, [entry("a", "2026-07-12", -42, "Kino Tickets")], 3);
    expect(res[0].match_status).toBe("probable");
    expect(res[0].matched_transaction_id).toBe("a");
  });
});