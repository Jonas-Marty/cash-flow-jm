import { beforeEach, describe, expect, it } from "vitest";
import { forgetCounts, recallCount, rememberCount } from "@/hooks/use-progressive-count";

describe("progressive count memory", () => {
  beforeEach(() => forgetCounts());

  it("starts at the initial count and restores the depth reached for the same view", () => {
    expect(recallCount("q=coop", 100)).toBe(100);
    rememberCount("q=coop", 500);
    expect(recallCount("q=coop", 100)).toBe(500);
    expect(recallCount("q=other", 100)).toBe(100);
  });

  it("never goes below the initial count", () => {
    rememberCount("k", 20);
    expect(recallCount("k", 100)).toBe(100);
  });

  it("keeps only the 20 most recently used views", () => {
    for (let i = 0; i < 25; i++) rememberCount(`k${i}`, 300);
    rememberCount("k5", 300); // used again: stays
    expect(recallCount("k0", 100)).toBe(100);
    expect(recallCount("k5", 100)).toBe(300);
    expect(recallCount("k24", 100)).toBe(300);
  });
});
