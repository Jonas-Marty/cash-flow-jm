import { describe, it, expect } from "vitest";
import { helpUrl, helpUrlFromLegacyHash, HELP_BASE } from "./helpUrl";

describe("helpUrl", () => {
  it("leaves German unprefixed, matching blume.config.ts defaultLocale", () => {
    expect(helpUrl("de")).toBe(`${HELP_BASE}/`);
    expect(helpUrl("de", "oidc")).toBe(`${HELP_BASE}/oidc`);
  });

  it("prefixes every other locale with its code", () => {
    expect(helpUrl("en")).toBe(`${HELP_BASE}/en/`);
    expect(helpUrl("en", "oidc")).toBe(`${HELP_BASE}/en/oidc`);
  });

  it("appends a fragment when one is given", () => {
    expect(helpUrl("de", "concepts", "account")).toBe(`${HELP_BASE}/concepts#account`);
  });

  it("never emits a double slash", () => {
    for (const url of [helpUrl("de"), helpUrl("en"), helpUrl("de", "faq"), helpUrl("en", "faq")]) {
      expect(url.replace(/^https?:\/\//, "")).not.toContain("//");
    }
  });
});

describe("helpUrlFromLegacyHash", () => {
  // Each section of the old in-app guide became a page of the same slug, so a
  // bookmarked /help#<section> has to land on /<section>.
  it.each([
    "getting-started", "concepts", "screens", "iou-actions", "workflows",
    "faq", "data-storage", "ai", "statements", "webhooks", "links", "oidc",
  ])("maps #%s onto its page", (id) => {
    expect(helpUrlFromLegacyHash("de", `#${id}`)).toBe(`${HELP_BASE}/${id}`);
    expect(helpUrlFromLegacyHash("en", `#${id}`)).toBe(`${HELP_BASE}/en/${id}`);
  });

  it("falls back to the index for an empty or unknown fragment", () => {
    expect(helpUrlFromLegacyHash("de", "")).toBe(`${HELP_BASE}/`);
    expect(helpUrlFromLegacyHash("de", "#does-not-exist")).toBe(`${HELP_BASE}/`);
    expect(helpUrlFromLegacyHash("en", "#does-not-exist")).toBe(`${HELP_BASE}/en/`);
  });

  it("tolerates a fragment given without its leading hash", () => {
    expect(helpUrlFromLegacyHash("de", "oidc")).toBe(`${HELP_BASE}/oidc`);
  });
});
