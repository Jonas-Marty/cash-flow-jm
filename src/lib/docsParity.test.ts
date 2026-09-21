/**
 * The documentation guardrail.
 *
 * Seven documentation surfaces exist in this repo and, until this file, none
 * was checked by anything. They drifted independently and in both languages —
 * including a privacy notice that claimed no third parties were contacted
 * while six were.
 *
 * These checks are deliberately structural. No parser can tell that a sentence
 * is untrue of the code, so each one picks a property that *is* mechanical and
 * that a human error reliably breaks: a file that exists in one locale and not
 * the other, a host reached in code but absent from the notice, an action id
 * with no prose. `help-site/known-issues.json` records what is wrong today, so
 * each stage of the audit asserts itself by deleting an entry from it.
 */
import { describe, it, expect } from "vitest";
import {
  DOCS_DE,
  DOCS_EN,
  collectLiteralHosts,
  listApiRoutePaths,
  listDocPages,
  listOpenApiPaths,
  readAllDocPages,
  readDocPage,
  readPrivacyLocales,
  readRepoFile,
  type DocPage,
} from "./docsAudit";

const known = JSON.parse(readRepoFile("help-site/known-issues.json"));

const de = readAllDocPages(DOCS_DE);
const en = readAllDocPages(DOCS_EN);
const byFile = (pages: DocPage[]) => new Map(pages.map((p) => [p.file, p]));
const deByFile = byFile(de);
const enByFile = byFile(en);
const pairs = de
  .filter((p) => enByFile.has(p.file))
  .map((p) => [p, enByFile.get(p.file)!] as const);

// ---------------------------------------------------------------------------
// 1-5: the two locales say the same things in the same shape
// ---------------------------------------------------------------------------

describe("locale parity", () => {
  it("has the same set of files in both locales", () => {
    // The sharp edge this guards: blume.config.ts sets `fallbackLocale: "de"`,
    // so a missing English page renders the GERMAN text at /en/... — fully
    // pre-rendered, no 404, and clean under `blume validate`. Nothing else
    // catches it.
    expect(listDocPages(DOCS_EN)).toEqual(listDocPages(DOCS_DE));
  });

  it("pins the same anchors in the same order on every page", () => {
    // Order, not set: a section inserted into one locale only still produces
    // matching sets if it reuses an anchor elsewhere on the page.
    for (const [d, e] of pairs) {
      expect(
        e.sections.map((s) => s.anchor),
        `anchors differ in ${d.file}`,
      ).toEqual(d.sections.map((s) => s.anchor));
    }
  });

  it("pins an anchor on every heading", () => {
    // Auto-generated ids differ per language, so an unpinned heading silently
    // breaks every #fragment link into it from the other locale.
    for (const page of [...de, ...en]) {
      const unpinned = page.sections.filter((s) => !s.anchor).map((s) => s.title);
      expect(unpinned, `unpinned headings in ${page.file}`).toEqual([]);
    }
  });

  it("carries a comparable amount of prose per section in both locales", () => {
    const allowed = new Set(
      known.localeParity.blockCountMismatch.map(
        (e: { file: string; anchor: string }) => `${e.file}#${e.anchor}`,
      ),
    );
    const failures: string[] = [];
    for (const [d, e] of pairs) {
      if (!allowed.has(`${d.file}#`)) {
        const deLede = d.lede ? 1 : 0;
        const enLede = e.lede ? 1 : 0;
        if (Math.abs(deLede - enLede) > 0)
          failures.push(`${d.file}# lede DE=${deLede} EN=${enLede}`);
      }
      for (const [i, section] of d.sections.entries()) {
        const other = e.sections[i];
        if (!other || allowed.has(`${d.file}#${section.anchor}`)) continue;
        // ±1 absorbs a translator splitting or joining one paragraph; a whole
        // missing block is what this is looking for.
        if (Math.abs(section.blocks.length - other.blocks.length) > 1) {
          failures.push(
            `${d.file}#${section.anchor} DE=${section.blocks.length} EN=${other.blocks.length}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("uses the same frontmatter keys and the same sidebar icon", () => {
    for (const [d, e] of pairs) {
      expect(Object.keys(e.frontmatter).sort(), `frontmatter keys differ in ${d.file}`).toEqual(
        Object.keys(d.frontmatter).sort(),
      );
      expect(e.frontmatter["sidebar.icon"], `sidebar icon differs in ${d.file}`).toBe(
        d.frontmatter["sidebar.icon"],
      );
    }
  });

  it("writes descriptions that read as prose, not as a list of the page's own headings", () => {
    // The whole class of defect the migration's generator produced: padding a
    // short description by appending heading text, which ships into <meta>,
    // OG images, the sidebar, the search index and llms.txt.
    const allowed: string[] = known.localeParity.badDescriptions.files;
    const failures: string[] = [];
    for (const [dir, pages, prefix] of [
      [DOCS_DE, de, ""],
      [DOCS_EN, en, "en/"],
    ] as const) {
      void dir;
      for (const page of pages) {
        if (allowed.includes(`${prefix}${page.file}`)) continue;
        const description = page.frontmatter.description ?? "";
        if (!description) {
          failures.push(`${prefix}${page.file}: no description`);
          continue;
        }
        if (description.endsWith("…") || description.endsWith("...")) {
          failures.push(`${prefix}${page.file}: description is truncated mid-thought`);
        }
        // Two or more of the page's own headings means the description was
        // assembled by concatenating them. One is just prose naming its
        // topic, which is what a description is supposed to do.
        const echoed = page.sections
          .map((s) => s.title)
          .filter((t) => t.length > 12 && description.includes(t));
        if (echoed.length > 1) {
          failures.push(
            `${prefix}${page.file}: description is a list of its own headings (${echoed.join(", ")})`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6: the privacy notice names every third party the code actually contacts
// ---------------------------------------------------------------------------

describe("privacy notice covers the code's network egress", () => {
  it("discloses every hard-coded external host, in both languages", () => {
    // The highest-value check here. `privacy.tsx` claimed "No subprocessors
    // are used" while the code called six external hosts. A structural test
    // cannot know that sentence is false — but it can know that a host in the
    // code appears nowhere in the notice, which is the same failure.
    const permanent: Record<string, string> = known.egressAllowlist.permanent;
    const undisclosed: Record<string, string> = known.egressAllowlist.undisclosed;
    const { en: privacyEn, de: privacyDe } = readPrivacyLocales();

    const failures: string[] = [];
    for (const [host, locations] of collectLiteralHosts()) {
      if (host in permanent) continue;
      if (host in undisclosed) continue;
      const inEn = privacyEn.includes(host);
      const inDe = privacyDe.includes(host);
      if (!inEn || !inDe) {
        failures.push(
          `${host} (${locations[0]}) missing from privacy.tsx ${!inEn ? "EN" : ""}${!inEn && !inDe ? " and " : ""}${!inDe ? "DE" : ""}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps the allowlist honest — every entry still corresponds to a real host", () => {
    // Stops the allowlist outliving the code it excuses, which is how an
    // allowlist quietly becomes a lie of its own.
    const hosts = collectLiteralHosts();
    const stale = [
      ...Object.keys(known.egressAllowlist.permanent),
      ...Object.keys(known.egressAllowlist.undisclosed).filter((k) => !k.startsWith("$")),
    ].filter((h) => !hosts.has(h));
    expect(stale, "allowlisted hosts no longer present in src/").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7-11: documentation matches the code it describes
// ---------------------------------------------------------------------------

describe("code and docs agree", () => {
  it("documents every AI action the code can dispatch", () => {
    const source = readRepoFile("src/lib/ai/types.ts");
    const block = source.slice(source.indexOf("export const AI_ACTIONS"));
    const actions = [...block.slice(0, block.indexOf("]")).matchAll(/"([a-z_]+)"/g)].map(
      (m) => m[1],
    );
    expect(actions.length, "AI_ACTIONS not parsed").toBeGreaterThan(0);

    // An action is "documented" when the AI page names the thing it does, in
    // that locale's own words — so the check maps ids to phrases rather than
    // grepping for the identifier, which would never appear in prose.
    const phrases: Record<string, { de: RegExp; en: RegExp }> = {
      chat: { de: /Assistent|Chat/i, en: /assistant|chat/i },
      statement_extract: { de: /Auszug|Auszüge/i, en: /statement/i },
      statement_classify: {
        de: /Kategorisier|Zuordnung.*Zeilen|Zeilen.*kategorisier/i,
        en: /classif/i,
      },
      pending_enrich: { de: /Vorschlag|Vorschläge|unbestätigt/i, en: /suggest|pending/i },
      transcribe: { de: /Sprache|Spracheingabe|Diktat|Aufnahme/i, en: /voice|transcri/i },
    };
    const skip: string[] = known.aiActionsUndocumented.ids;
    const aiDe = readDocPage(DOCS_DE, "08-ai.md").raw;
    const aiEn = readDocPage(DOCS_EN, "08-ai.md").raw;

    const failures: string[] = [];
    for (const action of actions) {
      if (skip.includes(action)) continue;
      const phrase = phrases[action];
      if (!phrase) {
        failures.push(`${action}: no phrase mapping — add one when adding an action`);
        continue;
      }
      if (!phrase.de.test(aiDe)) failures.push(`${action}: not described in 08-ai.md (DE)`);
      if (!phrase.en.test(aiEn)) failures.push(`${action}: not described in en/08-ai.md`);
    }
    expect(failures).toEqual([]);
  });

  it("declares every public API route in the OpenAPI spec", () => {
    const permanent: Record<string, string> = known.openApiUndocumentedRoutes.permanent;
    const routes = listApiRoutePaths().filter((p) => !(p in permanent));
    const declared = listOpenApiPaths();
    expect(declared.length, "no paths parsed from openapi-spec.ts").toBeGreaterThan(0);
    expect(
      routes.filter((r) => !declared.includes(r)),
      "routes missing from the spec",
    ).toEqual([]);
    expect(
      declared.filter((d) => !listApiRoutePaths().includes(d)),
      "spec declares paths with no route file",
    ).toEqual([]);
  });

  it("names every exposed metric in the README", () => {
    const names = [
      ...readRepoFile("src/lib/metrics.ts").matchAll(/counter\("([a-z_0-9]+)"/g),
      ...readRepoFile("src/routes/api.public.metrics.ts").matchAll(/# HELP ([a-z_0-9]+)/g),
    ].map((m) => m[1]);
    expect(names.length, "no metric names parsed").toBeGreaterThan(0);

    const readme = readRepoFile("README.md");
    const skip: string[] = known.metricsUndocumented.names;
    const missing = [...new Set(names)].filter((n) => !skip.includes(n) && !readme.includes(n));
    expect(missing, "metrics exposed but not documented in README section 6").toEqual([]);
  });

  it("can build a help URL for every page on the site", () => {
    // Every new page needs a HelpPage entry, or the app cannot deep-link to it
    // and `helpUrl` silently loses the type guarantee it exists.
    const helpUrl = readRepoFile("src/lib/helpUrl.ts");
    const missing = de.map((p) => p.slug).filter((slug) => !new RegExp(`"${slug}"`).test(helpUrl));
    expect(missing, "slugs on the help site with no HelpPage entry in helpUrl.ts").toEqual([]);
  });

  it("has retired every phrase that describes something the code no longer does", () => {
    const pending: Record<string, string> = known.bannedPhrases.pending;
    const banned: Record<string, string> = {
      "X-API-Token": "every route reads `authorization`",
      "lovable.app": "stale production host",
      "Mark settled": "removed IOU action",
      "Mark as settled": "removed IOU action",
      "Book as loss": "the app says write off",
      "abgegolten markier": "removed IOU action",
      "Als Verlust buchen": "the app says Abschreiben",
    };

    const targets: Array<[string, string]> = [
      ...de.map((p) => [p.file, p.raw] as [string, string]),
      ...en.map((p) => [`en/${p.file}`, p.raw] as [string, string]),
      ["src/utils/ai.server.ts", readRepoFile("src/utils/ai.server.ts")],
      ["src/lib/openapi-spec.ts", readRepoFile("src/lib/openapi-spec.ts")],
    ];

    const failures: string[] = [];
    for (const [phrase, why] of Object.entries(banned)) {
      if (phrase in pending) continue;
      for (const [name, text] of targets) {
        if (text.includes(phrase)) failures.push(`"${phrase}" in ${name} — ${why}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("calls each IOU action what the buttons call it", () => {
    // The guide said "Stornieren" while the button said "Verwerfen", so a
    // reader following the instructions was hunting for a word that is not
    // in the app. Button labels win; the guide follows them.
    const i18n = readRepoFile("src/i18n/index.tsx");
    const label = (key: string, nth: number) => {
      const hits = [...i18n.matchAll(new RegExp(`"${key}":\\s*"([^"]+)"`, "g"))];
      return hits[nth]?.[1];
    };
    const pages = {
      de: { page: readDocPage(DOCS_DE, "04-iou-actions.md"), nth: 0 },
      en: { page: readDocPage(DOCS_EN, "04-iou-actions.md"), nth: 1 },
    };
    const keys = ["iou.add_repayment", "iou.writeoff.action", "dash.reimb.mark_cancelled"];

    const failures: string[] = [];
    for (const [locale, { page, nth }] of Object.entries(pages)) {
      const headings = page.sections.map((s) => s.title);
      for (const key of keys) {
        const wanted = label(key, nth);
        expect(wanted, `${key} not found in i18n`).toBeTruthy();
        if (!headings.some((h) => h.includes(wanted!))) {
          failures.push(`${locale}: no heading matches the button "${wanted}" (${key})`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps the reconciliation anchor even as the wording moves on", () => {
    // `#why-is-my-reconciliation-drift-not-zero` is linked from outside. The
    // prose above it changes in stage 2; the anchor must not, which is why the
    // banned-phrase check reads prose and this one reads anchors.
    for (const page of [readDocPage(DOCS_DE, "06-faq.md"), readDocPage(DOCS_EN, "06-faq.md")]) {
      expect(page.sections.map((s) => s.anchor)).toContain(
        "why-is-my-reconciliation-drift-not-zero",
      );
    }
  });
});
