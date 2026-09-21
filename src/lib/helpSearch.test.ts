import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseLlmsFull, rankHelpSections, type HelpSection } from "./helpSearch";

const SAMPLE = `# Cashflow Hilfe

> Anleitung und Nachschlagewerk.

# Hilfe & Anleitung
Source: https://help.cash-flow.wi-wo.ch/

Alles, was du zum Einstieg brauchst.

## Grundkonzepte
Source: https://help.cash-flow.wi-wo.ch/concepts

Konten, Umschläge und Sweeps.

## Core concepts
Source: https://help.cash-flow.wi-wo.ch/en/concepts

Accounts, envelopes and sweeps.
`;

describe("parseLlmsFull", () => {
  it("splits on the Source line that introduces each page", () => {
    const sections = parseLlmsFull(SAMPLE);
    expect(sections.map((s) => s.url)).toEqual([
      "https://help.cash-flow.wi-wo.ch/",
      "https://help.cash-flow.wi-wo.ch/concepts",
      "https://help.cash-flow.wi-wo.ch/en/concepts",
    ]);
    expect(sections[1].title).toBe("Grundkonzepte");
    expect(sections[1].body).toBe("Konten, Umschläge und Sweeps.");
  });

  it("does not treat the site preamble as a page", () => {
    // The file opens with a title and a blockquote and no Source line; only
    // real pages carry one, which is what makes the split reliable.
    expect(parseLlmsFull(SAMPLE).some((s) => s.title === "Cashflow Hilfe")).toBe(false);
  });

  it("returns nothing for text with no Source lines", () => {
    expect(parseLlmsFull("# Just a heading\n\nSome prose.\n")).toEqual([]);
  });
});

describe("rankHelpSections", () => {
  const sections: HelpSection[] = [
    { title: "Webhooks", url: "/webhooks", body: "Outbound webhooks notify a service." },
    {
      title: "Core concepts",
      url: "/concepts",
      body: "Accounts, envelopes, a sweep at month end.",
    },
    { title: "FAQ", url: "/faq", body: "Why is the last line not zero?" },
  ];

  it("puts a title match above a body-only match", () => {
    const [first] = rankHelpSections(sections, "webhooks");
    expect(first.url).toBe("/webhooks");
  });

  it("finds a page by a word that only appears in its body", () => {
    expect(rankHelpSections(sections, "sweep").map((s) => s.url)).toEqual(["/concepts"]);
  });

  it("returns nothing rather than everything when no term matches", () => {
    // A tool that answers "here are 4 random pages" invites the model to
    // summarise whatever it was handed as if it were relevant.
    expect(rankHelpSections(sections, "quantum chromodynamics")).toEqual([]);
  });

  it("ignores one- and two-letter noise", () => {
    // The cut-off is deliberately at two, not three: "IOU", "FX" and "tag"
    // are all real search terms a reader would type.
    expect(rankHelpSections(sections, "is a of")).toEqual([]);
  });

  it("caps how many pages it hands back", () => {
    expect(rankHelpSections(sections, "a e", 2).length).toBeLessThanOrEqual(2);
  });
});

describe("against the real built guide", () => {
  // Runs only after `npm run build` in help-site/, so a clean checkout does
  // not fail. When it can run, it is the check that matters: the parser has
  // to survive whatever Blume actually emits, not just the fixture above.
  const built = path.join(process.cwd(), "help-site/dist/llms-full.txt");

  it.skipIf(!existsSync(built))("parses every published page", () => {
    const sections = parseLlmsFull(readFileSync(built, "utf8"));
    expect(sections.length).toBeGreaterThanOrEqual(26);
    expect(sections.every((s) => s.url.startsWith("http") && s.body.length > 0)).toBe(true);

    // Both locales must be reachable, or the assistant answers German
    // readers from English pages and vice versa.
    expect(sections.some((s) => s.url.includes("/en/"))).toBe(true);
    expect(sections.some((s) => !s.url.includes("/en/"))).toBe(true);
  });

  it.skipIf(!existsSync(built))("finds the IOU page, and it names three exits", () => {
    const sections = parseLlmsFull(readFileSync(built, "utf8"));
    const hit = rankHelpSections(sections, "close an IOU repayment write off")[0];
    expect(hit, "no page matched an IOU question").toBeDefined();
    expect(hit.body.toLowerCase()).not.toContain("mark settled");
  });
});
