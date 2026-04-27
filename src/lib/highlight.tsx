import * as React from "react";

export const normalize = (s: string): string =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function tokenize(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^#/, ""))
    .filter(Boolean);
}

export function highlightTokens(text: string, tokens: string[]): React.ReactNode {
  if (!text || tokens.length === 0) return text;
  const norm = normalize(text);
  // Find non-overlapping matches across all tokens; merge ranges
  type R = [number, number];
  const ranges: R[] = [];
  for (const tok of tokens) {
    if (!tok) continue;
    const ntok = normalize(tok);
    if (!ntok) continue;
    let i = 0;
    while (i < norm.length) {
      const idx = norm.indexOf(ntok, i);
      if (idx === -1) break;
      ranges.push([idx, idx + ntok.length]);
      i = idx + ntok.length;
    }
  }
  if (ranges.length === 0) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: R[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([start, end], i) => {
    if (cursor < start) out.push(text.slice(cursor, start));
    out.push(
      <mark key={i} className="rounded-sm bg-yellow-200/70 px-0.5 text-foreground dark:bg-yellow-500/30">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return <>{out}</>;
}

export function textMatchesAll(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const norm = normalize(text);
  return tokens.every((t) => norm.includes(normalize(t)));
}

/** Parse a localized number like "1.234,56" or "1,234.56" or "80". */
export function parseLooseNumber(s: string): number | null {
  const cleaned = s.trim().replace(/[^\d,.\-]/g, "");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) normalized = cleaned.replace(/\./g, "").replace(",", ".");
    else normalized = cleaned.replace(/,/g, "");
  } else if (lastComma > -1) {
    normalized = cleaned.replace(",", ".");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
