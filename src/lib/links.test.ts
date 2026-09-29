import { describe, expect, it } from "vitest";
import { linkTotals } from "@/lib/links";

describe("linkTotals", () => {
  const sym = (id: string) => (id === "eur" ? "€" : "CHF");

  it("sums per currency, expenses negative, transfers left out", () => {
    expect(
      linkTotals(
        [
          { type: "expense", amount: "120.50", source_account_id: "chf" },
          { type: "income", amount: 20, source_account_id: "chf" },
          { type: "transfer", amount: 999, source_account_id: "chf" },
          { type: "expense", amount: 30, source_account_id: "eur" },
        ],
        sym,
      ),
    ).toEqual([
      ["CHF", -100.5],
      ["€", -30],
    ]);
  });

  it("is empty for a link with only transfers", () => {
    expect(linkTotals([{ type: "transfer", amount: 5, source_account_id: "chf" }], sym)).toEqual([]);
  });
});
