import { describe, expect, it } from "vitest";
import {
  bucketUnit,
  cachedTokens,
  buckets,
  groupRows,
  niceAxis,
  nextDay,
  periodFor,
  totals,
  type UsageRow,
} from "./aiUsage";

function row(p: Partial<UsageRow>): UsageRow {
  return {
    day: "2026-09-05",
    endpoint_id: "e1",
    connection: "Infomaniak",
    connection_exists: true,
    model: "qwen",
    model_configured: true,
    kind: "chat_request",
    requests: 1,
    prompt_tokens: 100,
    completion_tokens: 10,
    cached_tokens: 0,
    without_usage: 0,
    failed: 0,
    duration_ms: 1000,
    timed: 1,
    fallback: 0,
    ...p,
  };
}

describe("totals", () => {
  it("adds up and averages over the requests that reported", () => {
    const t = totals([
      row({ requests: 3, prompt_tokens: 300, completion_tokens: 30, duration_ms: 6000, timed: 3 }),
      row({
        requests: 2,
        prompt_tokens: 0,
        completion_tokens: 0,
        without_usage: 2,
        timed: 0,
        duration_ms: 0,
      }),
    ]);
    expect(t.requests).toBe(5);
    expect(t.total).toBe(330);
    expect(t.withoutUsage).toBe(2);
    expect(t.avgTokens).toBe(110);
    expect(t.avgMs).toBe(2000);
  });
  it("has no averages without data", () => {
    const t = totals([]);
    expect(t.avgMs).toBeNull();
    expect(t.avgTokens).toBeNull();
  });
});

describe("groupRows", () => {
  const rows = [
    row({ endpoint_id: "e1", model: "qwen", kind: "chat_request", prompt_tokens: 500 }),
    row({ endpoint_id: "e2", connection: "Jonas-PC", model: "llama", kind: "chat_request" }),
    row({ endpoint_id: null, connection: "old.host", model: "qwen", kind: "pending_enrich" }),
  ];
  it("groups by connection, unmatched hosts by name, largest first", () => {
    expect(groupRows(rows, "connection").map((g) => g.key)).toEqual(["e1", "e2", "name:old.host"]);
  });
  it("groups by model and by feature", () => {
    expect(groupRows(rows, "model").map((g) => g.key)).toEqual(["qwen", "llama"]);
    expect(groupRows(rows, "kind").map((g) => g.key)).toEqual(["chat_request", "pending_enrich"]);
  });
});

describe("periods", () => {
  const today = new Date(2026, 0, 15);
  it("knows this month, last month across a year and this year", () => {
    expect(periodFor("month", today)).toEqual({
      kind: "month",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(periodFor("last", today)).toEqual({
      kind: "last",
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(periodFor("year", today)).toEqual({
      kind: "year",
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });
  it("steps days across month ends", () => {
    expect(nextDay("2026-02-28")).toBe("2026-03-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
  it("uses days for a month and months for a year", () => {
    expect(bucketUnit(periodFor("month", today))).toBe("day");
    expect(bucketUnit(periodFor("year", today))).toBe("month");
  });
});

describe("buckets", () => {
  it("lists every day, empty ones included", () => {
    const b = buckets(
      [row({ day: "2026-09-05" })],
      { kind: "custom", from: "2026-09-04", to: "2026-09-06" },
      "connection",
    );
    expect(b.map((x) => x.key)).toEqual(["2026-09-04", "2026-09-05", "2026-09-06"]);
    expect(b[1].values.get("e1")).toBe(110);
  });
  it("sums months for a year", () => {
    const b = buckets(
      [row({ day: "2026-09-05" }), row({ day: "2026-09-20" })],
      { kind: "year", from: "2026-01-01", to: "2026-12-31" },
      "model",
    );
    expect(b).toHaveLength(12);
    expect(b[8].values.get("qwen")).toBe(220);
  });
});

describe("niceAxis", () => {
  it("rounds up to a 1-2-5 step", () => {
    expect(niceAxis(298_992)).toEqual({ top: 300_000, step: 100_000 });
    expect(niceAxis(140_000)).toEqual({ top: 150_000, step: 50_000 });
    expect(niceAxis(3)).toEqual({ top: 3, step: 1 });
    expect(niceAxis(0)).toEqual({ top: 1, step: 1 });
  });
});

describe("cachedTokens", () => {
  it("reads the cache count wherever the provider reports it", () => {
    expect(
      cachedTokens({ prompt_tokens: 900, prompt_tokens_details: { cached_tokens: 800 } }),
    ).toBe(800);
    expect(cachedTokens({ input_tokens_details: { cached_tokens: 12 } })).toBe(12);
    expect(cachedTokens({ cache_read_input_tokens: 5 })).toBe(5);
    expect(cachedTokens({ prompt_tokens: 10 })).toBeNull();
    expect(cachedTokens(null)).toBeNull();
  });
});
