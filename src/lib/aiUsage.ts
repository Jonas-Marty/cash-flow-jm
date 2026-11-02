/**
 * The figures behind the AI usage page, from `ai_usage` rows (one per day,
 * connection, model and feature): totals, a grouping, chart buckets and the
 * period the page shows.
 */

export interface UsageRow {
  day: string;
  endpoint_id: string | null;
  connection: string;
  connection_exists: boolean;
  model: string;
  model_configured: boolean;
  kind: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  without_usage: number;
  failed: number;
  duration_ms: number;
  timed: number;
  fallback: number;
}

export interface UsageTotals {
  requests: number;
  prompt: number;
  completion: number;
  total: number;
  cached: number;
  withoutUsage: number;
  failed: number;
  /** Mean duration in ms over the requests that recorded one; null when none did. */
  avgMs: number | null;
  /** Mean tokens per request that reported tokens; null when none did. */
  avgTokens: number | null;
  fallback: number;
}

export function totals(rows: UsageRow[]): UsageTotals {
  let requests = 0,
    prompt = 0,
    completion = 0,
    cached = 0,
    withoutUsage = 0,
    failed = 0,
    duration = 0,
    timed = 0,
    fallback = 0;
  for (const r of rows) {
    requests += r.requests;
    prompt += Number(r.prompt_tokens);
    completion += Number(r.completion_tokens);
    cached += Number(r.cached_tokens);
    withoutUsage += r.without_usage;
    failed += r.failed;
    duration += Number(r.duration_ms);
    timed += r.timed;
    fallback += r.fallback;
  }
  const total = prompt + completion;
  const counted = requests - withoutUsage;
  return {
    requests,
    prompt,
    completion,
    total,
    cached,
    withoutUsage,
    failed,
    avgMs: timed > 0 ? duration / timed : null,
    avgTokens: counted > 0 ? total / counted : null,
    fallback,
  };
}

export type GroupBy = "connection" | "model" | "kind";

/** A connection is keyed by id; rows that never matched one, by name (the host). */
export function connectionKey(r: UsageRow): string {
  return r.endpoint_id ?? `name:${r.connection}`;
}

export function groupKey(r: UsageRow, by: GroupBy): string {
  if (by === "connection") return connectionKey(r);
  if (by === "model") return r.model;
  return r.kind;
}

export interface UsageGroup {
  key: string;
  rows: UsageRow[];
  totals: UsageTotals;
}

/** Groups, largest total first; ties keep the name order stable. */
export function groupRows(rows: UsageRow[], by: GroupBy): UsageGroup[] {
  const map = new Map<string, UsageRow[]>();
  for (const r of rows) {
    const k = groupKey(r, by);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return [...map.entries()]
    .map(([key, list]) => ({ key, rows: list, totals: totals(list) }))
    .sort(
      (a, b) =>
        b.totals.total - a.totals.total ||
        b.totals.requests - a.totals.requests ||
        a.key.localeCompare(b.key),
    );
}

export type PeriodKind = "month" | "last" | "year" | "custom";

export interface Period {
  kind: PeriodKind;
  /** First day, inclusive, `YYYY-MM-DD`. */
  from: string;
  /** Last day, inclusive, `YYYY-MM-DD`. */
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

export function periodFor(kind: Exclude<PeriodKind, "custom">, today = new Date()): Period {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  if (kind === "month") return { kind, from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)) };
  if (kind === "last") {
    const ly = m === 1 ? y - 1 : y;
    const lm = m === 1 ? 12 : m - 1;
    return { kind, from: iso(ly, lm, 1), to: iso(ly, lm, lastDay(ly, lm)) };
  }
  return { kind, from: iso(y, 1, 1), to: iso(y, 12, 31) };
}

/** Day after `day`, for an exclusive upper bound. */
export function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  return n.toISOString().slice(0, 10);
}

/** Days for a range up to about two months, months beyond that. */
export function bucketUnit(p: Period): "day" | "month" {
  const days = (Date.parse(nextDay(p.to)) - Date.parse(p.from)) / 86_400_000;
  return days <= 62 ? "day" : "month";
}

export interface Bucket {
  key: string;
  /** Total tokens per group key. */
  values: Map<string, number>;
}

/** Every day or month of the period, empty ones included, so the axis is even. */
export function buckets(rows: UsageRow[], p: Period, by: GroupBy): Bucket[] {
  const unit = bucketUnit(p);
  const keys: string[] = [];
  if (unit === "day") {
    for (let d = p.from; d <= p.to; d = nextDay(d)) keys.push(d);
  } else {
    let [y, m] = p.from.split("-").map(Number);
    const end = p.to.slice(0, 7);
    for (;;) {
      const k = `${y}-${pad(m)}`;
      keys.push(k);
      if (k >= end) break;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  const out = new Map(keys.map((k) => [k, new Map<string, number>()]));
  for (const r of rows) {
    const k = unit === "day" ? r.day : r.day.slice(0, 7);
    const b = out.get(k);
    if (!b) continue;
    const g = groupKey(r, by);
    b.set(g, (b.get(g) ?? 0) + Number(r.prompt_tokens) + Number(r.completion_tokens));
  }
  return keys.map((key) => ({ key, values: out.get(key)! }));
}

/**
 * The top of the y axis and its step: 1-2-5 steps, about four grid lines, so the
 * axis follows the largest bar on screen.
 */
export function niceAxis(max: number): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Tokens are whole numbers: never a fractional step.
  const step = Math.max(1, [1, 2, 5, 10].map((f) => f * mag).find((x) => x >= raw)!);
  return { top: Math.ceil(max / step) * step, step };
}

/**
 * Prompt tokens the provider served from its cache, wherever it reports them:
 * OpenAI-style `prompt_tokens_details.cached_tokens`, the Responses API's
 * `input_tokens_details`, or Anthropic-style `cache_read_input_tokens`.
 */
export function cachedTokens(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const v =
    u.prompt_tokens_details?.cached_tokens ??
    u.input_tokens_details?.cached_tokens ??
    u.cache_read_input_tokens ??
    u.cached_tokens;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
