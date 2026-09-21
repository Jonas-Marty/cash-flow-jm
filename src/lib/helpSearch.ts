/**
 * The assistant's view of the user guide.
 *
 * This used to be `HELP_INDEX`, a hand-written array of seven answers inside
 * `ai.server.ts`. Being a fourth copy of content that lives elsewhere, it
 * went stale exactly the way a fourth copy does: it offered an IOU action
 * that had been removed months earlier, and told people the public API uses
 * a header no route reads.
 *
 * The help site already publishes `llms-full.txt` for precisely this purpose,
 * so the assistant now reads the same pages a human does. It is fetched once
 * per process and held in memory; a docs outage degrades the tool to its last
 * good copy rather than breaking the chat.
 */
import { HELP_BASE } from "@/lib/helpUrl";

export interface HelpSection {
  /** Page heading, e.g. "Grundkonzepte". */
  title: string;
  /** Absolute URL of the page the section came from. */
  url: string;
  /** The page's prose, trimmed. */
  body: string;
}

/** Roughly one page; keeps a hit readable without flooding the context. */
const MAX_BODY = 4000;
const FETCH_TIMEOUT_MS = 5000;
/** Long enough that a chat turn never waits on the network twice. */
const TTL_MS = 30 * 60 * 1000;

let cache: { at: number; sections: HelpSection[] } | null = null;
let inFlight: Promise<HelpSection[]> | null = null;

/**
 * `llms-full.txt` is one document per page, each introduced by a `Source:`
 * line carrying the canonical URL. Splitting on that gives back the pages.
 */
export function parseLlmsFull(text: string): HelpSection[] {
  const sections: HelpSection[] = [];
  // A page starts at a heading line immediately followed by `Source: <url>`.
  const re = /^#{1,2} (.+)\nSource: (\S+)\n/gm;
  const marks: Array<{ title: string; url: string; from: number }> = [];
  for (const m of text.matchAll(re)) {
    marks.push({ title: m[1].trim(), url: m[2].trim(), from: m.index! + m[0].length });
  }
  for (const [i, mark] of marks.entries()) {
    const end = i + 1 < marks.length ? text.lastIndexOf("\n#", marks[i + 1].from) : text.length;
    const body = text.slice(mark.from, end > mark.from ? end : undefined).trim();
    if (body) sections.push({ title: mark.title, url: mark.url, body: body.slice(0, MAX_BODY) });
  }
  return sections;
}

async function load(): Promise<HelpSection[]> {
  const res = await fetch(`${HELP_BASE}/llms-full.txt`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "text/plain" },
  });
  if (!res.ok) throw new Error(`help site returned ${res.status}`);
  const sections = parseLlmsFull(await res.text());
  if (!sections.length) throw new Error("help site returned no parseable sections");
  return sections;
}

/** Cached sections, refreshing past the TTL but never discarding a good copy. */
export async function getHelpSections(): Promise<HelpSection[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.sections;
  if (!inFlight) {
    inFlight = load()
      .then((sections) => {
        cache = { at: Date.now(), sections };
        return sections;
      })
      .catch((err) => {
        // Stale-while-error: an unreachable docs site must not take the
        // assistant down with it, and stale help beats no help.
        if (cache) return cache.sections;
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/**
 * Scores a section against the query: every term that appears anywhere counts,
 * and a term in the title counts for more, since page titles are the topic
 * names a reader would have searched for.
 */
export function rankHelpSections(sections: HelpSection[], query: string, limit = 4): HelpSection[] {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2);
  // No usable term means no answer. Handing back the first few pages instead
  // would invite the model to summarise whatever it was given as though it
  // were relevant to the question.
  if (!terms.length) return [];
  return sections
    .map((s) => {
      const title = s.title.toLowerCase();
      const body = s.body.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 3;
        if (body.includes(t)) score += 1;
      }
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

/** Reset between tests; the cache is module state by design. */
export function __resetHelpCache() {
  cache = null;
  inFlight = null;
}
