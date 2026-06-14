import { describe, expect, it } from "vitest";
import { readDashboardPrivacy } from "./DashboardPrivacy";

describe("dashboard privacy persistence", () => {
  it("restores a hidden dashboard", () => {
    expect(readDashboardPrivacy({ getItem: () => "true" })).toBe(true);
  });

  it("defaults safely for absent, malformed, or unavailable storage", () => {
    expect(readDashboardPrivacy(null)).toBe(false);
    expect(readDashboardPrivacy({ getItem: () => "invalid" })).toBe(false);
    expect(readDashboardPrivacy({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
  });
});