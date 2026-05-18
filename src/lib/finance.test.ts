import { describe, it, expect } from "vitest";
import {
  groupSumByCurrency,
  formatPerCurrency,
  buildPendingMap,
  pendingDeltaForRow,
  fmtMoney,
  extractTags,
  monthKey,
  endOfMonthISO,
  endOfYearISO,
  type PendingCategoryImpact,
} from "./finance";

describe("fmtMoney", () => {
  it("formats positive and zero amounts with two decimals", () => {
    expect(fmtMoney(0, "CHF")).toMatch(/^CHF\s0\.00$/);
    expect(fmtMoney(1234.5, "CHF")).toMatch(/CHF\s1[,.\u00A0\u202F]?234\.50/);
  });
  it("prefixes a minus sign for negative amounts", () => {
    expect(fmtMoney(-50, "EUR").startsWith("-")).toBe(true);
  });
  it("rounds bank-style to two decimals via toLocaleString", () => {
    // 0.005 may round up/down depending on engine — we only assert two decimals are present
    expect(fmtMoney(1.234, "$")).toMatch(/\$\s1\.23$/);
  });
});

describe("groupSumByCurrency", () => {
  type Tx = { currency: string; amount: number };
  const items: Tx[] = [
    { currency: "CHF", amount: 10 },
    { currency: "CHF", amount: 5 },
    { currency: "EUR", amount: -3 },
    { currency: "", amount: 2 }, // defaults to CHF
  ];

  it("sums per currency code", () => {
    const m = groupSumByCurrency(items, (i) => i.currency, (i) => i.amount);
    expect(m.get("CHF")).toBe(17); // 10 + 5 + 2
    expect(m.get("EUR")).toBe(-3);
    expect(m.size).toBe(2);
  });

  it("returns an empty map for an empty input", () => {
    expect(groupSumByCurrency<Tx>([], (i) => i.currency, (i) => i.amount).size).toBe(0);
  });
});

describe("formatPerCurrency", () => {
  const sym = (c: string) => c;

  it("returns CHF 0.00 for an empty map", () => {
    expect(formatPerCurrency(new Map(), sym)).toMatch(/CHF\s0\.00$/);
  });

  it("omits zero-balance currencies by default", () => {
    const m = new Map([["CHF", 0], ["EUR", 10]]);
    const out = formatPerCurrency(m, sym);
    expect(out).not.toContain("CHF");
    expect(out).toContain("EUR");
  });

  it("keeps zero balances when keepZero is true", () => {
    const out = formatPerCurrency(new Map([["CHF", 0]]), sym, { keepZero: true });
    expect(out).toContain("CHF");
  });

  it("sorts entries alphabetically and joins with separator", () => {
    const m = new Map([["USD", 1], ["EUR", 2], ["CHF", 3]]);
    const out = formatPerCurrency(m, sym);
    expect(out.indexOf("CHF")).toBeLessThan(out.indexOf("EUR"));
    expect(out.indexOf("EUR")).toBeLessThan(out.indexOf("USD"));
    expect(out).toContain("·");
  });

  it("forces a minus sign in expense mode and a plus sign in income mode", () => {
    const m = new Map([["CHF", 10]]);
    expect(formatPerCurrency(m, sym, { sign: "expense" }).startsWith("-")).toBe(true);
    expect(formatPerCurrency(m, sym, { sign: "income" }).startsWith("+")).toBe(true);
  });
});

describe("extractTags", () => {
  it("returns empty for null/empty", () => {
    expect(extractTags(null)).toEqual([]);
    expect(extractTags("")).toEqual([]);
    expect(extractTags("no tags here")).toEqual([]);
  });

  it("extracts simple hashtags lowercased", () => {
    expect(extractTags("buy #Food and #travel")).toEqual(["food", "travel"]);
  });

  it("deduplicates and supports umlauts / digits / hyphens", () => {
    expect(extractTags("#Über #über #2024 #my-tag #my-tag")).toEqual([
      "über",
      "2024",
      "my-tag",
    ]);
  });

  it("ignores tags starting with - or punctuation", () => {
    expect(extractTags("#-bad #good")).toEqual(["good"]);
  });
});

describe("pending helpers", () => {
  const impacts: PendingCategoryImpact[] = [
    { category_id: "food", type: "expense", amount: 30, count: 1 },
    { category_id: "food", type: "expense", amount: 20, count: 1 },
    { category_id: "food", type: "income", amount: 5, count: 1 }, // refund
    { category_id: "salary", type: "income", amount: 5000, count: 1 },
  ];

  it("buildPendingMap sums signed buckets per category", () => {
    const m = buildPendingMap(impacts);
    expect(m.get("food")).toEqual({ expense: 50, income: 5 });
    expect(m.get("salary")).toEqual({ expense: 0, income: 5000 });
  });

  it("pendingDeltaForRow income kind returns income", () => {
    const m = buildPendingMap(impacts);
    expect(pendingDeltaForRow(m.get("salary"), "income")).toBe(5000);
  });

  it("pendingDeltaForRow expense kind returns expense minus income", () => {
    const m = buildPendingMap(impacts);
    expect(pendingDeltaForRow(m.get("food"), "expense")).toBe(45);
  });

  it("pendingDeltaForRow returns 0 when category has no pending entry", () => {
    expect(pendingDeltaForRow(undefined, "expense")).toBe(0);
    expect(pendingDeltaForRow(undefined, "income")).toBe(0);
  });
});

describe("date helpers", () => {
  it("monthKey is YYYY-MM-01 in local time", () => {
    expect(monthKey(new Date(2024, 0, 15))).toBe("2024-01-01");
    expect(monthKey(new Date(2024, 11, 31))).toBe("2024-12-01");
  });

  it("endOfMonthISO handles 28/30/31-day months", () => {
    expect(endOfMonthISO(new Date(2024, 1, 15))).toBe("2024-02-29"); // leap Feb
    expect(endOfMonthISO(new Date(2023, 1, 15))).toBe("2023-02-28");
    expect(endOfMonthISO(new Date(2024, 3, 15))).toBe("2024-04-30");
    expect(endOfMonthISO(new Date(2024, 0, 1))).toBe("2024-01-31");
  });

  it("endOfYearISO is always Dec 31 of the reference year", () => {
    expect(endOfYearISO(new Date(2024, 5, 15))).toBe("2024-12-31");
    expect(endOfYearISO(new Date(2030, 11, 31))).toBe("2030-12-31");
  });
});