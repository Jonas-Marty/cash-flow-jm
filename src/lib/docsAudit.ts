/**
 * Readers for the documentation surfaces, shared by `docsParity.test.ts`.
 *
 * These parse Markdown and TypeScript as *text* on purpose. Importing
 * `privacy.tsx` or `openapi-spec.ts` would tie the audit to whatever those
 * modules happen to export today; reading the bytes means the test keeps
 * checking the thing a human actually reads, and keeps working when the
 * shape of the module changes.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const REPO_ROOT = process.cwd();
export const DOCS_DE = path.join(REPO_ROOT, "help-site/docs");
export const DOCS_EN = path.join(DOCS_DE, "en");

export interface DocSection {
  /** Heading text with the `[#anchor]` marker stripped. */
  title: string;
  /** The pinned anchor. Blume requires these to match across locales. */
  anchor: string;
  /** Paragraphs, list runs and fenced blocks — the unit check 3 counts. */
  blocks: string[];
}

export interface DocPage {
  slug: string;
  file: string;
  frontmatter: Record<string, string>;
  /** Prose before the first `##`, if any. */
  lede: string;
  sections: DocSection[];
  raw: string;
}

/** Content pages are `.md`; `index.mdx` is hand-written and checked separately. */
export function listDocPages(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

/**
 * Frontmatter is a flat `key: value` map plus a one-level `sidebar:` block,
 * which is all these pages use. Nested keys are flattened to `sidebar.icon`
 * so the parity check can compare key sets directly.
 */
function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { frontmatter: {}, body: raw };
  const frontmatter: Record<string, string> = {};
  let prefix = "";
  for (const line of m[1].split("\n")) {
    if (!line.trim()) continue;
    const indented = /^\s+/.test(line);
    const kv = line.trim().match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    if (!indented && rawValue === "") {
      prefix = `${key}.`;
      continue;
    }
    if (!indented) prefix = "";
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      try {
        value = JSON.parse(value.startsWith("'") ? `"${value.slice(1, -1)}"` : value);
      } catch {
        value = value.slice(1, -1);
      }
    }
    frontmatter[`${indented ? prefix : ""}${key}`] = value;
  }
  return { frontmatter, body: raw.slice(m[0].length) };
}

/**
 * Splits a body into blocks. A fenced code block counts as one block however
 * many blank lines it contains, otherwise a snippet with paragraph breaks
 * would inflate the count and make check 3 noisy.
 */
function splitBlocks(body: string): string[] {
  const blocks: string[] = [];
  let buffer: string[] = [];
  let inFence = false;
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) blocks.push(text);
    buffer = [];
  };
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      buffer.push(line);
      if (!inFence) flush();
      continue;
    }
    if (inFence) {
      buffer.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

export function readDocPage(dir: string, file: string): DocPage {
  const raw = readFileSync(path.join(dir, file), "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);

  const sections: DocSection[] = [];
  let lede = "";
  let current: { title: string; anchor: string; lines: string[] } | null = null;
  let inFence = false;
  const ledeLines: string[] = [];

  const close = () => {
    if (!current) return;
    sections.push({
      title: current.title,
      anchor: current.anchor,
      blocks: splitBlocks(current.lines.join("\n")),
    });
    current = null;
  };

  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = !inFence && line.match(/^##\s+(.*?)(?:\s*\[#([a-z0-9-]+)\])?\s*$/);
    if (heading) {
      close();
      current = { title: heading[1].trim(), anchor: heading[2] ?? "", lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else ledeLines.push(line);
  }
  close();
  lede = ledeLines.join("\n").trim();

  return {
    slug: file.replace(/^\d+-/, "").replace(/\.md$/, ""),
    file,
    frontmatter,
    lede,
    sections,
    raw,
  };
}

export function readAllDocPages(dir: string): DocPage[] {
  return listDocPages(dir).map((f) => readDocPage(dir, f));
}

/** Every source file the egress and phrase checks scan. */
export function listSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(REPO_ROOT, "src"));
  return out.sort();
}

/**
 * Hosts reached over the network from application code.
 *
 * Deliberately literal-only: a host assembled at runtime from a user-supplied
 * base URL (an AI endpoint, a Nextcloud server) is the user's own choice and
 * is disclosed as a category rather than a name. What this finds is the set
 * *we* hard-coded, which is exactly the set a privacy notice has to list.
 */
export function collectLiteralHosts(): Map<string, string[]> {
  const hosts = new Map<string, string[]>();
  for (const file of listSourceFiles()) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      // Skip line comments: a URL in prose is documentation, not a request.
      const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, "");
      for (const m of code.matchAll(/https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)) {
        const host = m[1].toLowerCase();
        const where = `${path.relative(REPO_ROOT, file)}:${i + 1}`;
        const seen = hosts.get(host) ?? [];
        if (!seen.includes(where)) seen.push(where);
        hosts.set(host, seen);
      }
    });
  }
  return hosts;
}

/**
 * Splits `privacy.tsx` into its two `Content` objects. The notice is the
 * canonical statement of data flows, and it only counts as stated if it is
 * stated in both languages.
 */
export function readPrivacyLocales(): { en: string; de: string } {
  const raw = readFileSync(path.join(REPO_ROOT, "src/routes/privacy.tsx"), "utf8");
  const deStart = raw.indexOf("const DE: Content");
  const enStart = raw.indexOf("const EN: Content");
  if (deStart < 0 || enStart < 0) throw new Error("privacy.tsx: EN/DE Content objects not found");
  return { en: raw.slice(enStart, deStart), de: raw.slice(deStart) };
}

/** Public API route files, as the paths they serve. */
export function listApiRoutePaths(): string[] {
  return readdirSync(path.join(REPO_ROOT, "src/routes"))
    .filter((f) => /^api\.public\.[a-z-]+\.ts$/.test(f))
    .map((f) => `/api/public/${f.replace(/^api\.public\./, "").replace(/\.ts$/, "")}`)
    .sort();
}

/** Path keys declared in the OpenAPI YAML template literal. */
export function listOpenApiPaths(): string[] {
  const raw = readFileSync(path.join(REPO_ROOT, "src/lib/openapi-spec.ts"), "utf8");
  const body = raw.slice(raw.indexOf("\npaths:"));
  return [...body.matchAll(/^\s{2}(\/api\/public\/[a-z-]+):/gm)].map((m) => m[1]).sort();
}

export function readRepoFile(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}
