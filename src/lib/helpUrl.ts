import type { Lang } from "@/i18n";

/**
 * Where the guide is published. A separate static site built from help-site/
 * by Blume, deliberately outside the app's auth gate: signing in is one of the
 * things it has to be able to explain.
 *
 * The origin lives in deployment configuration — `.env.example`,
 * `docker-compose.yml` — not here, so the app and the docs deployment can be
 * moved without touching source. `vite.requireEnv.ts` fails the build when it
 * is missing, because the failure is otherwise invisible: an absent VITE_ var
 * inlines as an empty string, every link below turns root-relative, and the
 * browser silently resolves it against the app's own host.
 */
export const HELP_BASE = (import.meta.env.VITE_HELP_URL ?? "").replace(/\/$/, "");

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
