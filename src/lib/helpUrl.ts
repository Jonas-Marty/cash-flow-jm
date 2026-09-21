import type { Lang } from "@/i18n";

/**
 * The guide lives at help.cash-flow.wi-wo.ch as a separate static site, built
 * from help-site/ by Blume. It is deliberately outside the app's auth gate:
 * signing in is one of the things it has to be able to explain.
 *
 * Overridable at build time so a dev deployment can point at its own copy;
 * there is only one docs deployment today, and both app environments use it.
 */
export const HELP_BASE = (
  import.meta.env.VITE_HELP_URL ?? "https://help.cash-flow.wi-wo.ch"
).replace(/\/$/, "");

/** Pages in the guide that the app links into directly. */
export type HelpPage =
  | "getting-started"
  | "concepts"
  | "screens"
  | "iou-actions"
  | "workflows"
  | "faq"
  | "data-storage"
  | "ai"
  | "statements"
  | "webhooks"
  | "links"
  | "oidc"
  | "location"
  | "api"
  | "finreader";

const PAGES: ReadonlySet<string> = new Set<HelpPage>([
  "getting-started",
  "concepts",
  "screens",
  "iou-actions",
  "workflows",
  "faq",
  "data-storage",
  "ai",
  "statements",
  "webhooks",
  "links",
  "oidc",
  "location",
  "api",
  "finreader",
]);

/**
 * German owns the unprefixed URLs on the docs site, matching blume.config.ts.
 * Any other locale is a path prefix.
 */
export function helpUrl(lang: Lang, page?: HelpPage, hash?: string): string {
  const locale = lang === "de" ? "" : `/${lang}`;
  const path = page ? `/${page}` : "";
  const frag = hash ? `#${hash}` : "";
  return `${HELP_BASE}${locale}${path || "/"}${frag}`;
}

/**
 * Maps a legacy `/help#section` fragment onto the page that replaced it, so
 * bookmarks taken while the guide was a single in-app page keep working. The
 * section ids became page slugs one-for-one; anything else lands on the index.
 */
export function helpUrlFromLegacyHash(lang: Lang, hash: string): string {
  const id = hash.replace(/^#/, "");
  return PAGES.has(id) ? helpUrl(lang, id as HelpPage) : helpUrl(lang);
}
