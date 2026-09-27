// Server-only helpers for the AI assistant.
// Loads BYO provider credentials, runs the tool-call loop, executes tools
// against the user-scoped Supabase client (RLS applies).

import type { SupabaseClient } from "@supabase/supabase-js";
import { HELP_BASE } from "@/lib/helpUrl";
import { getHelpSections, rankHelpSections } from "@/lib/helpSearch";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { buildSystemPrompt } from "@/lib/ai/systemPrompt";
import type {
  AIHealthMode,
  AIHealthProbe,
  AIModelCapabilities,
  AssistantAction,
  ChatNotice,
  AIEndpointOfflinePayload,
} from "@/lib/ai/types";
import { AI_ENDPOINT_OFFLINE_PREFIX } from "@/lib/ai/types";
import { healthBases } from "@/lib/ai/endpointUrls";
import {
  isToolsUnsupportedError,
  isVisionUnsupportedError,
  looksLikeRawJson,
  looksLikeTextToolCall,
  parseToolProbe,
  parseVisionProbe,
} from "@/lib/ai/capabilities";
import type { AttachmentRow } from "./aiAttachments.server";

export interface PingResult {
  ok: boolean;
  latency_ms: number;
  probe: AIHealthProbe;
  degraded?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export function providerHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function preview(v: unknown, max = 1000): string {
  let s: string;
  try {
    s = typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s.length > max) s = s.slice(0, max) + `…[+${s.length - max} chars]`;
  return s;
}

/** Mirrors the CHECK constraint on ai_audit_logs.kind. */
export type AuditKind =
  | "chat_request"
  | "tool_call"
  | "document_extract"
  | "statement_classify"
  | "pending_enrich"
  | "transcribe";

export async function writeAudit(row: {
  user_id: string;
  kind: AuditKind;
  model?: string | null;
  provider_host?: string | null;
  tool_name?: string | null;
  conversation_id?: string | null;
  duration_ms?: number | null;
  ok?: boolean | null;
  error_message?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    // Defensive: never let a token slip into the log.
    const safe = JSON.parse(JSON.stringify(row.payload || {}));
    stripSecrets(safe);
    await supabaseAdmin.from("ai_audit_logs").insert({
      user_id: row.user_id,
      kind: row.kind,
      model: row.model ?? null,
      provider_host: row.provider_host ?? null,
      tool_name: row.tool_name ?? null,
      conversation_id: row.conversation_id ?? null,
      duration_ms: row.duration_ms ?? null,
      ok: row.ok ?? null,
      error_message: row.error_message ?? null,
      prompt_tokens: row.prompt_tokens ?? null,
      completion_tokens: row.completion_tokens ?? null,
      total_tokens: row.total_tokens ?? null,
      payload: safe,
    });
  } catch {
    // Swallow logging errors; they must never break a chat turn.
  }
}

function stripSecrets(obj: unknown): void {
  if (!obj || typeof obj !== "object") return;
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    if (
      lk.includes("token") ||
      lk.includes("authorization") ||
      lk.includes("api_key") ||
      lk === "apikey" ||
      lk.includes("secret") ||
      lk.includes("password")
    ) {
      (obj as Record<string, unknown>)[k] = "[redacted]";
    } else {
      stripSecrets((obj as Record<string, unknown>)[k]);
    }
  }
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface FullAICreds {
  enabled: boolean;
  base_url: string;
  model: string;
  api_token: string;
}

// ---------------------------------------------------------------------------
// Endpoints (multiple connections per user)
// ---------------------------------------------------------------------------

export interface EndpointRow {
  id: string;
  name: string;
  base_url: string;
  model: string;
  api_token: string | null;
  enabled: boolean;
  priority: number;
  context_level: "off" | "compact" | "full" | "xl";
  /** Speech-to-text model for /audio/transcriptions. Null = voice unsupported. */
  transcribe_model: string | null;
  /** How thoroughly availability is probed. */
  health_mode: AIHealthMode;
  /** Probed capabilities per model id. */
  capabilities: Record<string, AIModelCapabilities>;
}

export async function loadEndpointRows(userId: string): Promise<EndpointRow[]> {
  const { data, error } = await supabaseAdmin
    .from("ai_endpoints")
    .select(
      "id, name, base_url, model, api_token, enabled, priority, context_level, transcribe_model, health_mode, capabilities, created_at",
    )
    .eq("user_id", userId)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    base_url: (r.base_url || "").trim().replace(/\/+$/, ""),
    model: r.model,
    api_token: r.api_token,
    enabled: !!r.enabled,
    priority: r.priority ?? 100,
    context_level: (r.context_level ?? "compact") as EndpointRow["context_level"],
    transcribe_model: (r.transcribe_model || "").trim() || null,
    health_mode: (r.health_mode ?? "real") as AIHealthMode,
    capabilities: r.capabilities && typeof r.capabilities === "object" ? r.capabilities : {},
  }));
}

function toCreds(row: EndpointRow, model?: string | null): FullAICreds {
  return {
    enabled: true,
    base_url: row.base_url,
    model: model || row.model,
    api_token: row.api_token || "",
  };
}

// ---------------------------------------------------------------------------
// Model capabilities (tool calling, vision)
// ---------------------------------------------------------------------------

const UNKNOWN_CAPS: AIModelCapabilities = { tools: null, vision: null, checked_at: null };

export function capsFor(row: EndpointRow, model: string): AIModelCapabilities {
  return { ...UNKNOWN_CAPS, ...(row.capabilities?.[model] ?? {}) };
}

/** Merge a finding for one model into the connection's capability map. */
export async function saveCapabilities(
  userId: string,
  endpointId: string,
  model: string,
  patch: Partial<AIModelCapabilities>,
): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("ai_endpoints")
      .select("capabilities")
      .eq("id", endpointId)
      .eq("user_id", userId)
      .maybeSingle();
    const raw = data?.capabilities;
    const all = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as unknown as Record<
      string,
      AIModelCapabilities
    >;
    all[model] = { ...UNKNOWN_CAPS, ...(all[model] ?? {}), ...patch, checked_at: new Date().toISOString() };
    await supabaseAdmin
      .from("ai_endpoints")
      .update({ capabilities: all as unknown as Json })
      .eq("id", endpointId)
      .eq("user_id", userId);
  } catch {
    // A capability note is an optimisation; never fail the request over it.
  }
}

const PROBE_RED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mP4z8BAEmIY1TCqYfhqAACQ+f8B8u7oVwAAAABJRU5ErkJggg==";

/**
 * Two tiny real requests. OpenAI-compatible `/models` lists do not say what a
 * model can do, so asking is the only reliable way. A network error or 5xx
 * leaves the verdict null (unknown) rather than false.
 */
export async function probeCapabilities(
  baseUrl: string,
  token: string | null,
  model: string,
  timeoutMs = 30000,
): Promise<{ tools: boolean | null; vision: boolean | null; errors: string[] }> {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const errors: string[] = [];
  const post = async (body: unknown): Promise<{ status: number; text: string } | null> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        signal: ac.signal,
        body: JSON.stringify(body),
      });
      return { status: resp.status, text: await resp.text() };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const [toolResp, visionResp] = await Promise.all([
    // Generous limits: reasoning models think before they answer, and a reply
    // cut off mid-thought would read as "cannot".
    post({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: "Call the ping tool." }],
      tools: [
        {
          type: "function",
          function: {
            name: "ping",
            description: "Health check. Always call this when asked to.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
      ],
      tool_choice: "auto",
    }),
    post({
      model,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What colour is this image? Answer with one word." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${PROBE_RED_PNG}` } },
          ],
        },
      ],
    }),
  ]);
  const verdict = (r: typeof toolResp, parse: (s: number, b: string) => boolean | null) => {
    if (!r) return null;
    const v = parse(r.status, r.text);
    if (v === null) errors.push(`${r.status} ${r.text.slice(0, 160)}`);
    return v;
  };
  return { tools: verdict(toolResp, parseToolProbe), vision: verdict(visionResp, parseVisionProbe), errors };
}

/**
 * Availability probe.
 *
 * - `fast`         → GET /models only (a proxy answers even when its upstream is down).
 * - `model_listed` → GET /models and require the configured model id in the list.
 * - `real`         → LiteLLM-style GET /health for the model when available, otherwise a
 *                    1-token chat request. This is the only mode that reaches the upstream.
 */
export async function pingEndpoint(
  baseUrl: string,
  token: string | null,
  model: string,
  mode: AIHealthMode = "real",
  timeoutMs = 8000,
): Promise<PingResult> {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const started = Date.now();
  const el = () => Date.now() - started;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const withTimeout = async (fn: (signal: AbortSignal) => Promise<Response>) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await fn(ac.signal);
    } finally {
      clearTimeout(timer);
    }
  };

  // Step 1: the models list — cheap, and tells us whether the endpoint itself answers.
  let listOk = false;
  let listError: string | null = null;
  let listed: string[] = [];
  try {
    const resp = await withTimeout((signal) => fetch(`${base}/models`, { headers, signal }));
    if (resp.ok) {
      listOk = true;
      try {
        const json = (await resp.json()) as any;
        const raw: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
        listed = raw
          .map((m) => (typeof m === "string" ? m : (m?.id ?? m?.name ?? m?.model)))
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim());
      } catch {
        listed = [];
      }
    } else if (resp.status === 401 || resp.status === 403) {
      return { ok: false, latency_ms: el(), probe: "models", error: `${resp.status} unauthorized` };
    } else {
      listError = `${resp.status}`;
    }
  } catch (e) {
    listError = e instanceof Error ? e.message : String(e);
  }

  if (mode === "fast") {
    return listOk
      ? { ok: true, latency_ms: el(), probe: "models" }
      : { ok: false, latency_ms: el(), probe: "models", error: listError ?? "unreachable" };
  }

  if (mode === "model_listed") {
    if (!listOk) return { ok: false, latency_ms: el(), probe: "models", error: listError ?? "unreachable" };
    if (listed.length > 0 && !listed.includes(model)) {
      return {
        ok: false,
        latency_ms: el(),
        probe: "models",
        degraded: true,
        error: `model "${model}" is not offered by this endpoint`,
      };
    }
    return { ok: true, latency_ms: el(), probe: "models" };
  }

  // mode === "real": try a provider health endpoint first (LiteLLM), then a real request.
  //
  // LiteLLM serves /health at the proxy root, not under the OpenAI /v1 prefix,
  // so a base_url of "https://host/v1" has to be probed at "https://host/health"
  // too. Without this the probe 404s and falls through to the chat request
  // below — which reaches the upstream and loads the model on every poll, the
  // exact cost the health endpoint exists to avoid.
  for (const healthBase of healthBases(base)) {
    try {
      const resp = await withTimeout((signal) =>
        fetch(`${healthBase}/health?model=${encodeURIComponent(model)}`, { headers, signal }),
      );
      if (resp.ok) {
        const json = (await resp.json().catch(() => null)) as any;
        const healthy = Array.isArray(json?.healthy_endpoints) ? json.healthy_endpoints.length : null;
        const unhealthy = Array.isArray(json?.unhealthy_endpoints) ? json.unhealthy_endpoints : [];
        if (healthy !== null || unhealthy.length > 0) {
          if (healthy === 0 || unhealthy.length > 0) {
            const detail = JSON.stringify(unhealthy).slice(0, 160);
            return {
              ok: false,
              latency_ms: el(),
              probe: "health",
              degraded: listOk,
              error: `upstream unhealthy ${detail}`,
            };
          }
          return { ok: true, latency_ms: el(), probe: "health" };
        }
      }
    } catch {
      // this base has no usable /health — try the next, then the chat request
    }
  }

  try {
    const resp = await withTimeout((signal) =>
      fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      }),
    );
    if (!resp.ok) {
      const body = await resp.text();
      return {
        ok: false,
        latency_ms: el(),
        probe: "chat",
        degraded: listOk,
        error: `${resp.status} ${body.slice(0, 160)}`,
      };
    }
    return { ok: true, latency_ms: el(), probe: "chat" };
  } catch (e) {
    return {
      ok: false,
      latency_ms: el(),
      probe: "chat",
      degraded: listOk,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Pick the connection for an action:
 *   explicit id → action binding → highest-priority enabled connection.
 * When the preferred one is offline and fallback is allowed, walk the
 * remaining enabled connections by priority and use the first that answers.
 *
 * A binding may also name a model to use on its connection, so one provider
 * serving several models needs one connection (and so one availability probe)
 * rather than one per model. `model_override` is that model, and it is null
 * unless the connection we settled on is the bound one — a model name does not
 * carry over to a connection reached by fallback, which may not serve it.
 */
export async function resolveEndpoint(
  userId: string,
  action: string,
  explicitId?: string | null,
  filter?: (row: EndpointRow, modelOverride: string | null) => boolean,
): Promise<{
  creds: FullAICreds;
  endpoint: EndpointRow;
  fell_back: boolean;
  model_override: string | null;
}> {
  // Read the binding before filtering: a filter that asks whether a connection
  // can serve an action (transcription, say) has to see the model the binding
  // names, not just the connection's own defaults.
  const { data: binding } = await supabaseAdmin
    .from("ai_action_endpoints")
    .select("endpoint_id, allow_fallback, model")
    .eq("user_id", userId)
    .eq("action", action)
    .maybeSingle();

  const overrideFor = (row: EndpointRow): string | null =>
    binding?.endpoint_id === row.id && binding?.model ? binding.model : null;

  const rows = (await loadEndpointRows(userId)).filter(
    (r) => r.enabled && r.base_url && r.model && (!filter || filter(r, overrideFor(r))),
  );
  if (rows.length === 0) throw new Error("No AI connection configured. Add one in Settings.");

  const preferredId = explicitId || binding?.endpoint_id || null;
  const allowFallback = explicitId ? false : binding?.allow_fallback !== false;
  const preferred = preferredId ? rows.find((r) => r.id === preferredId) : rows[0];

  // Explicit user choice: never silently switch to another (possibly paid)
  // connection. Report the offline state plus the reachable alternatives so
  // the UI can ask the user which connection to retry on.
  if (explicitId) {
    if (!preferred) throw new Error("The selected AI connection no longer exists.");
    const health = await pingEndpoint(preferred.base_url, preferred.api_token, preferred.model, preferred.health_mode);
    if (health.ok)
      return {
        creds: toCreds(preferred, overrideFor(preferred)),
        endpoint: preferred,
        fell_back: false,
        model_override: overrideFor(preferred),
      };
    const others = rows.filter((r) => r.id !== preferred.id);
    const probed = await Promise.all(
      others.map(async (r) => ({
        id: r.id,
        name: r.name,
        model: r.model,
        available: (await pingEndpoint(r.base_url, r.api_token, r.model, r.health_mode)).ok,
      })),
    );
    throw new Error(
      AI_ENDPOINT_OFFLINE_PREFIX +
        JSON.stringify({
          endpoint: {
            id: preferred.id,
            name: preferred.name,
            model: overrideFor(preferred) ?? preferred.model,
          },
          error: health.error || "unavailable",
          alternatives: probed,
        } satisfies AIEndpointOfflinePayload),
    );
  }

  if (preferred && !allowFallback)
    return {
      creds: toCreds(preferred, overrideFor(preferred)),
      endpoint: preferred,
      fell_back: false,
      model_override: overrideFor(preferred),
    };

  const ordered = preferred ? [preferred, ...rows.filter((r) => r.id !== preferred.id)] : rows;

  let lastError = "";
  for (const [i, row] of ordered.entries()) {
    const health = await pingEndpoint(row.base_url, row.api_token, row.model, row.health_mode);
    if (health.ok)
      return {
        creds: toCreds(row, overrideFor(row)),
        endpoint: row,
        fell_back: i > 0,
        model_override: overrideFor(row),
      };
    lastError = health.error || "unavailable";
  }
  throw new Error(`No AI connection is reachable right now (last error: ${lastError}).`);
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

type Sb = SupabaseClient;

/** What a tool can see besides its arguments. */
export interface ToolCtx {
  /** Attachments of this conversation (current turn and history), newest last. */
  attachments: AttachmentRow[];
  conversationId: string | null;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  exec: (args: Record<string, unknown>, sb: Sb, userId: string, ctx: ToolCtx) => Promise<ToolResult>;
}

export type ToolResult =
  | { ok: true; data: unknown; action?: AssistantAction }
  | { ok: false; error: string };

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    // Some models return numbers as quoted strings ("\"1.8\"") or with
    // currency symbols / thousand separators. Normalize before parsing.
    const s = v
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[^\d.,-]/g, "")
      .replace(/,(?=\d{3}\b)/g, "")
      .replace(",", ".")
      .trim();
    if (s !== "" && !Number.isNaN(Number(s))) return Number(s);
  }
  return undefined;
}
function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}
function dateStr(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  // Accept YYYY-MM-DD or any Date-parseable string.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

function fuzzyFind<T extends { name: string; id: string; archived?: boolean }>(
  rows: T[],
  query: string | undefined,
): T | undefined {
  if (!query) return undefined;
  const q = query.toLowerCase().trim();
  const active = rows.filter((r) => !r.archived);
  return (
    active.find((r) => r.name.toLowerCase() === q) ||
    active.find((r) => r.name.toLowerCase().includes(q)) ||
    active.find((r) => q.includes(r.name.toLowerCase()))
  );
}

async function loadAccounts(sb: Sb) {
  const { data } = await sb.from("accounts").select("id, name, type, archived, currency_code, currency_symbol").order("name");
  return (data || []) as { id: string; name: string; type: string; archived: boolean; currency_code: string; currency_symbol: string }[];
}
async function loadCategories(sb: Sb) {
  const { data } = await sb.from("categories").select("id, name, archived, is_scope, closed_at").order("name");
  return (data || []) as { id: string; name: string; archived: boolean; is_scope?: boolean; closed_at?: string | null }[];
}

/** An attachment of this conversation by full id, id prefix or file name. */
function findAttachment(ctx: ToolCtx, query: string | undefined): AttachmentRow | undefined {
  if (!query) return ctx.attachments.length === 1 ? ctx.attachments[0] : undefined;
  const q = query.trim().toLowerCase();
  return (
    ctx.attachments.find((a) => a.id === q) ||
    ctx.attachments.find((a) => q.length >= 6 && a.id.startsWith(q)) ||
    ctx.attachments.find((a) => a.file_name.toLowerCase() === q)
  );
}

export const TOOLS: ToolDef[] = [
  {
    name: "list_accounts",
    description: "List the user's accounts with current balances and currency.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    exec: async (_a, sb) => {
      const { data, error } = await sb.from("account_balances").select("*").order("type").order("name");
      if (error) return { ok: false, error: error.message };
      const rows = (data || []).map((r: any) => ({
        name: r.name,
        type: r.type,
        balance: Number(r.balance),
        currency: r.currency_code,
        archived: r.archived,
      }));
      return { ok: true, data: rows };
    },
  },
  {
    name: "list_categories",
    description: "List spending/income categories with current month budget vs actual.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    exec: async (_a, sb) => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const { error: e1 } = await sb.rpc("ensure_month_budgets", { p_month: month });
      if (e1) return { ok: false, error: e1.message };
      const { data, error } = await sb.rpc("category_month_spending", { p_month: month });
      if (error) return { ok: false, error: error.message };
      return { ok: true, data };
    },
  },
  {
    name: "list_transactions",
    description:
      "Search the full transaction history (not just the snapshot). Returns tags too. Use it whenever the snapshot has no similar past entry for a merchant/description, before guessing a description, category or tags. Filters: date_from / date_to (YYYY-MM-DD), type (expense|income|transfer), search (text in description/note), limit (default 25, max 100).",
    parameters: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "Inclusive ISO date YYYY-MM-DD" },
        date_to: { type: "string", description: "Inclusive ISO date YYYY-MM-DD" },
        type: { type: "string", enum: ["expense", "income", "transfer"] },
        search: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    exec: async (a, sb) => {
      const limit = Math.min(num(a.limit) ?? 25, 100);
      let q = sb
        .from("transactions")
        .select("id, occurred_on, type, amount, description, note, source_account_id, destination_account_id, category_id")
        .order("occurred_on", { ascending: false })
        .limit(limit);
      const df = dateStr(a.date_from);
      const dt = dateStr(a.date_to);
      if (df) q = q.gte("occurred_on", df);
      if (dt) q = q.lte("occurred_on", dt);
      const t = str(a.type);
      if (t === "expense" || t === "income" || t === "transfer") q = q.eq("type", t);
      const search = str(a.search);
      if (search) q = q.or(`description.ilike.%${search}%,note.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) return { ok: false, error: error.message };
      const rows = (data || []) as any[];
      if (rows.length) {
        const { data: tagRows } = await sb
          .from("transaction_tags")
          .select("transaction_id, tag")
          .in("transaction_id", rows.map((r) => r.id));
        const byTx = new Map<string, string[]>();
        for (const r of (tagRows || []) as any[]) {
          const list = byTx.get(r.transaction_id) ?? [];
          list.push(r.tag);
          byTx.set(r.transaction_id, list);
        }
        for (const r of rows) r.tags = byTx.get(r.id) ?? [];
      }
      return { ok: true, data: rows };
    },
  },
  {
    name: "aggregate_spending",
    description:
      "Sum spending grouped by category/account/day/month over a date range. Use this for 'where did I spend most…' questions.",
    parameters: {
      type: "object",
      properties: {
        date_from: { type: "string" },
        date_to: { type: "string" },
        group_by: { type: "string", enum: ["category", "account", "day", "month"] },
        type: { type: "string", enum: ["expense", "income"], description: "Defaults to expense." },
        top_n: { type: "number", description: "Return only top N rows by total." },
      },
      required: ["date_from", "date_to", "group_by"],
      additionalProperties: false,
    },
    exec: async (a, sb) => {
      const df = dateStr(a.date_from);
      const dt = dateStr(a.date_to);
      const groupBy = str(a.group_by) as "category" | "account" | "day" | "month" | undefined;
      if (!df || !dt || !groupBy) return { ok: false, error: "date_from, date_to, group_by are required" };
      const type = (str(a.type) as "expense" | "income" | undefined) ?? "expense";
      const [{ data: txs, error }, cats, accs] = await Promise.all([
        sb
          .from("transactions")
          .select("amount, type, occurred_on, category_id, source_account_id")
          .gte("occurred_on", df)
          .lte("occurred_on", dt)
          .eq("type", type)
          .limit(5000),
        loadCategories(sb),
        loadAccounts(sb),
      ]);
      if (error) return { ok: false, error: error.message };
      const catName = new Map(cats.map((c) => [c.id, c.name]));
      const accName = new Map(accs.map((a) => [a.id, a.name]));
      const totals = new Map<string, { key: string; label: string; total: number; count: number }>();
      for (const r of (txs as any[]) || []) {
        let key = "—";
        let label = "—";
        if (groupBy === "category") {
          key = r.category_id ?? "uncategorized";
          label = catName.get(r.category_id) ?? "Uncategorized";
        } else if (groupBy === "account") {
          key = r.source_account_id ?? "—";
          label = accName.get(r.source_account_id) ?? "—";
        } else if (groupBy === "day") {
          key = String(r.occurred_on);
          label = String(r.occurred_on);
        } else if (groupBy === "month") {
          key = String(r.occurred_on).slice(0, 7);
          label = key;
        }
        const existing = totals.get(key) ?? { key, label, total: 0, count: 0 };
        existing.total += Number(r.amount) || 0;
        existing.count += 1;
        totals.set(key, existing);
      }
      let rows = Array.from(totals.values()).sort((x, y) => y.total - x.total);
      const topN = num(a.top_n);
      if (topN && topN > 0) rows = rows.slice(0, topN);
      return { ok: true, data: { group_by: groupBy, type, date_from: df, date_to: dt, rows } };
    },
  },
  {
    name: "list_open_ious",
    description: "List open IOUs (reimbursable expenses that have not been fully repaid yet).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    exec: async (_a, sb) => {
      const { data, error } = await sb
        .from("transactions")
        .select("id, occurred_on, amount, description, reimbursable_counterparty, reimbursable_status")
        .eq("is_reimbursable", true)
        .eq("reimbursable_status", "open")
        .order("occurred_on", { ascending: false })
        .limit(100);
      if (error) return { ok: false, error: error.message };
      return { ok: true, data };
    },
  },
  {
    name: "search_help",
    description: "Search the user guide by keyword. Use this to answer 'how do I…' or privacy/GDPR questions. Returns whole pages from the published guide, German and English, each with its URL — cite that URL when you use one.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    exec: async (a) => {
      const q = str(a.query) || "";
      try {
        const hits = rankHelpSections(await getHelpSections(), q);
        return { ok: true, data: hits };
      } catch (err) {
        // The guide is a separate deployment. If it is unreachable, say so
        // rather than letting the model invent an answer about the app.
        return {
          ok: false,
          error: `The help site is unreachable, so I cannot look that up right now. It is at ${HELP_BASE}. (${err instanceof Error ? err.message : String(err)})`,
        };
      }
    },
  },
  {
    name: "prepare_add_transaction",
    description:
      "Prepare a prefilled draft for the Add-Transaction screen. Does NOT save. Returns an action card the user can open to review & save. Use this whenever the user describes a purchase, income or transfer in prose.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["expense", "income", "transfer"] },
        amount: { type: "number" },
        account_name: { type: "string", description: "Source account name (the one paying / receiving)." },
        category_name: { type: "string" },
        description: { type: "string" },
        note: { type: "string" },
        occurred_on: { type: "string", description: "YYYY-MM-DD; defaults to today." },
        iou_with: { type: "string", description: "Person who owes the user back, if part of the bill is reimbursable." },
        iou_amount: { type: "number", description: "Amount that person owes (NOT the full bill)." },
      },
      required: ["type", "amount"],
      additionalProperties: false,
    },
    exec: async (a, sb) => {
      const type = str(a.type);
      const amount = num(a.amount);
      if (type !== "expense" && type !== "income" && type !== "transfer") return { ok: false, error: "type must be expense|income|transfer" };
      if (!amount || amount <= 0) return { ok: false, error: "amount must be > 0" };
      const [accs, cats, settingsRes] = await Promise.all([
        loadAccounts(sb),
        loadCategories(sb),
        sb.from("settings").select("active_scope_id").maybeSingle(),
      ]);
      const acc = fuzzyFind(accs, str(a.account_name));
      const cat = fuzzyFind(cats, str(a.category_name));
      const activeScope =
        type === "transfer"
          ? null
          : cats.find((c) => c.id === settingsRes.data?.active_scope_id && c.is_scope && !c.archived && !c.closed_at) ?? null;
      const search: Record<string, string> = {
        type,
        amount: String(amount),
      };
      if (acc) search.source = acc.id;
      else if (str(a.account_name)) search.account_name = str(a.account_name)!;
      if (cat) search.category = cat.id;
      else if (str(a.category_name)) search.category_name = str(a.category_name)!;
      const desc = str(a.description);
      if (desc) search.description = desc;
      const note = str(a.note);
      if (note) search.note = note;
      const on = dateStr(a.occurred_on);
      if (on) search.occurred_on = on;
      const iouWith = str(a.iou_with);
      const iouAmt = num(a.iou_amount);
      if (iouWith && iouAmt && iouAmt > 0) {
        search.iou_with = iouWith;
        search.iou_amount = String(iouAmt);
      }

      const proposedCategoryName = cat?.name ?? str(a.category_name) ?? null;
      const scopeConflict =
        !!activeScope &&
        !!proposedCategoryName &&
        cat?.id !== activeScope.id &&
        proposedCategoryName.localeCompare(activeScope.name, undefined, { sensitivity: "accent" }) !== 0;
      const proposedSearch = scopeConflict ? { ...search, ignore_scope: "1" } : search;
      const scopeSearch = { ...search };
      delete scopeSearch.category;
      delete scopeSearch.category_name;

      const summary = [
        `${type === "expense" ? "Expense" : type === "income" ? "Income" : "Transfer"} ${amount}`,
        acc ? `from ${acc.name}` : null,
        proposedCategoryName ? `→ ${proposedCategoryName}` : null,
        desc,
        iouWith && iouAmt ? `(${iouWith} owes ${iouAmt})` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        ok: true,
        data: {
          summary,
          prefilled: proposedSearch,
          matched_account: acc?.name ?? null,
          matched_category: cat?.name ?? null,
          active_scope: activeScope?.name ?? null,
          scope_conflict: scopeConflict,
        },
        action: {
          kind: "open_add",
          label: scopeConflict ? "Use proposed category" : "Review in Add form",
          search: proposedSearch,
          alternate: scopeConflict ? { label: "Use active scope", search: scopeSearch } : undefined,
          proposed_category_name: proposedCategoryName,
          active_scope_name: activeScope?.name ?? null,
        },
      };
    },
  },
  {
    name: "list_recurring_rules",
    description:
      "List the user's recurring rules (standing orders, subscriptions, bills) together with the guide for writing a new one: how interval, execution day, reporting period and offset work, the placeholder syntax for descriptions, and worked examples. Call this BEFORE prepare_recurring_rule, and use it to answer questions about the user's recurring payments.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    exec: async (_a, sb) => {
      const { loadGuideContext } = await import("./recurringAi.server");
      const { buildRecurringGuide } = await import("@/lib/recurringAi");
      const ctx = await loadGuideContext(sb);
      return { ok: true, data: { guide: buildRecurringGuide(ctx) } };
    },
  },
  {
    name: "prepare_recurring_rule",
    description:
      "Prepare a recurring-rule draft and return a button that opens it in the rule editor. Does NOT save; the user reviews and saves. Use it for a bill, invoice or subscription the user wants to set up (from an attachment or described in prose), after calling list_recurring_rules. Account and category may be given by name or id.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: { type: "string", enum: ["expense", "income", "transfer"] },
        amount: { type: "number", description: "Fixed amount. Leave out when is_variable_amount." },
        is_variable_amount: { type: "boolean" },
        estimated_amount: { type: "number", description: "Typical amount when it varies (e.g. this invoice's total)." },
        source_account: { type: "string" },
        destination_account: { type: "string", description: "Only for transfers." },
        category: { type: "string" },
        description: { type: "string", description: "Transaction description template; may use placeholders." },
        note: { type: "string" },
        recurrence_interval: { type: "integer", minimum: 1, maximum: 12 },
        execution_day_rule: { type: "string", enum: ["FixedDay", "LastDay", "FirstDay"] },
        execution_day_of_month: { type: "integer", minimum: 1, maximum: 31 },
        execution_weekend_adjustment: { type: "string", enum: ["None", "PreviousBusinessDay", "NextBusinessDay"] },
        period_day_rule: { type: "string", enum: ["FixedDay", "LastDay", "FirstDay"] },
        period_offset: { type: "integer", minimum: -3, maximum: 3 },
        starts_on: { type: "string", description: "YYYY-MM-DD" },
        ends_on: { type: "string", description: "YYYY-MM-DD, only for contracts with a known end." },
        auto_post: { type: "boolean" },
        is_variable_date: { type: "boolean" },
        similar_rule: { type: "string", description: "Id of an existing rule this bill belongs to, if any." },
        notes: { type: "array", items: { type: "string" }, description: "What you were unsure about." },
        source_attachment_id: { type: "string", description: "Attachment the rule was read from, if any." },
      },
      required: ["name", "type"],
      additionalProperties: false,
    },
    exec: async (a, sb, _userId, ctx) => {
      const { loadGuideContext, toSuggestionResult } = await import("./recurringAi.server");
      const guideCtx = await loadGuideContext(sb);
      const res = toSuggestionResult(a, guideCtx);
      const att = findAttachment(ctx, str(a.source_attachment_id));
      const d = res.draft;
      const every = d.recurrence_interval === 1 ? "monthly" : `every ${d.recurrence_interval} months`;
      const amount = d.is_variable_amount ? `~${d.estimated_amount || "?"} (variable)` : d.amount;
      return {
        ok: true,
        data: {
          summary: `${d.name || "Rule"} · ${d.type} ${amount} · ${every} · first ${d.starts_on}`,
          description_template: d.description,
          warnings: res.warnings,
          similar_rule: res.similar_rule,
          note: "Not saved. The user opens the editor with the button, checks and saves.",
        },
        action: {
          kind: "open_recurring",
          label: "Open in rule editor",
          draft: d,
          warnings: res.warnings,
          notes: res.notes,
          similar_rule: res.similar_rule,
          source_file: att?.file_name ?? null,
        },
      };
    },
  },
  {
    name: "read_attachment",
    description:
      "Read more of an attached document's text when the chat only showed its beginning. Returns up to 20000 characters starting at from_char.",
    parameters: {
      type: "object",
      properties: {
        attachment_id: { type: "string" },
        from_char: { type: "integer", minimum: 0 },
      },
      required: ["attachment_id"],
      additionalProperties: false,
    },
    exec: async (a, _sb, _userId, ctx) => {
      const att = findAttachment(ctx, str(a.attachment_id));
      if (!att) return { ok: false, error: "No such attachment in this conversation." };
      if (att.text == null) return { ok: false, error: "This attachment is an image; it has no text layer." };
      const from = Math.max(0, Math.floor(num(a.from_char) ?? 0));
      const chunk = att.text.slice(from, from + 20000);
      return {
        ok: true,
        data: { file_name: att.file_name, from_char: from, total_chars: att.text.length, text: chunk, more: from + chunk.length < att.text.length },
      };
    },
  },
  {
    name: "import_statement",
    description:
      "Import an attached bank or credit-card statement into the Statements screen for an account: reads every row and matches it against the app's transactions. This WRITES an import record, so only call it when the user asked for it or confirmed your proposal. Needs the account the statement belongs to.",
    parameters: {
      type: "object",
      properties: {
        attachment_id: { type: "string" },
        account_name: { type: "string", description: "Account name or id the statement belongs to." },
        invert_amounts: { type: "boolean", description: "True for credit-card statements that list spending as positive." },
      },
      required: ["attachment_id", "account_name"],
      additionalProperties: false,
    },
    exec: async (a, sb, userId, ctx) => {
      const att = findAttachment(ctx, str(a.attachment_id));
      if (!att) return { ok: false, error: "No such attachment in this conversation." };
      const accs = await loadAccounts(sb);
      const query = str(a.account_name);
      const acc = accs.find((r) => r.id === query && !r.archived) ?? fuzzyFind(accs, query);
      if (!acc) return { ok: false, error: `Unknown account "${query ?? ""}". Ask the user which account.` };
      const { attachmentBase64 } = await import("./aiAttachments.server");
      const { runStatementExtraction, buildImportDetail } = await import("./statements.detail.server");
      const { import_id } = await runStatementExtraction(sb, userId, {
        account_id: acc.id,
        file_name: att.file_name,
        file_base64: await attachmentBase64(sb, att),
        file_type: att.mime,
        invert_amounts: a.invert_amounts === true,
      });
      try {
        const { classifyOpenStatementLines } = await import("./statements.classify.server");
        await classifyOpenStatementLines(sb, userId, import_id);
      } catch {
        // Field guessing is best effort; the import itself already succeeded.
      }
      const detail = await buildImportDetail(sb, import_id);
      const count = (st: string) => detail.lines.filter((l) => l.match_status === st).length;
      return {
        ok: true,
        data: {
          account: acc.name,
          rows: detail.lines.length,
          matched: count("exact") + count("resolved"),
          probable: count("probable"),
          missing_in_app: count("unmatched"),
          in_app_not_on_statement: detail.unmatched_app.length,
        },
        action: { kind: "open_statement", label: "Open statement import", import_id },
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Help index (mirrors the static help.tsx sections)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// OpenAI-compatible chat client (tool-calling loop)
// ---------------------------------------------------------------------------

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | ContentPart[] | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string | ContentPart[];
}


export interface ChatResult {
  text: string;
  action: AssistantAction | null;
  /** Summed token usage across all provider round-trips of this reply. */
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; steps: number } | null;
  notices: ChatNotice[];
}

export interface RunChatOptions {
  conversationId?: string | null;
  toolCtx: ToolCtx;
  /** The connection and model answering, so capability findings can be stored. */
  endpointId: string;
  caps: AIModelCapabilities;
}

const RAW_JSON_CORRECTION =
  "Your last reply was raw JSON, which the app cannot act on and the user cannot read. Nothing was saved or done. " +
  "Either call one of the provided tools through the tool-calling interface, or answer the user in plain sentences. " +
  "Never claim that something was saved.";

function stripImages(messages: OAIMessage[]): void {
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    m.content = m.content
      .map((p) => (p.type === "image_url" ? { type: "text" as const, text: "[image removed: this model cannot see images]" } : p));
  }
}

function hasImages(messages: OAIMessage[]): boolean {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));
}

function lastUserText(history: ChatTurn[]): string {
  const m = [...history].reverse().find((h) => h.role === "user");
  if (!m) return "";
  return typeof m.content === "string"
    ? m.content
    : m.content.map((p) => (p.type === "text" ? p.text : "[image]")).join("\n");
}

export async function runChat(
  creds: FullAICreds,
  sb: Sb,
  userId: string,
  systemPromptCtx: Parameters<typeof buildSystemPrompt>[0],
  history: ChatTurn[],
  opts: RunChatOptions,
): Promise<ChatResult> {
  const conversationId = opts.conversationId ?? null;
  const notices = new Set<ChatNotice>();
  let useTools = opts.caps.tools !== false;
  if (!useTools) notices.add("tools_unsupported");
  if (opts.caps.vision === false && history.some((h) => Array.isArray(h.content) && h.content.some((p) => p.type === "image_url")))
    notices.add("vision_unsupported");

  const system = () => buildSystemPrompt({ ...systemPromptCtx, toolsAvailable: useTools });
  const messages: OAIMessage[] = [
    { role: "system", content: system() },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  if (opts.caps.vision === false) stripImages(messages);

  const toolSpecs = TOOLS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  let lastAction: AssistantAction | null = null;
  const host = providerHost(creds.base_url);
  const usageTotals = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, steps: 0 };
  const addUsage = (u: Record<string, unknown> | undefined | null) => {
    if (!u) return;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const p = n(u["prompt_tokens"] ?? u["input_tokens"]);
    const c = n(u["completion_tokens"] ?? u["output_tokens"]);
    const t = n(u["total_tokens"]) || p + c;
    usageTotals.prompt_tokens += p;
    usageTotals.completion_tokens += c;
    usageTotals.total_tokens += t;
    usageTotals.steps += 1;
  };
  const usage = () => (usageTotals.steps > 0 && usageTotals.total_tokens > 0 ? usageTotals : null);
  const lastUser = lastUserText(history);
  // Each fallback (drop tools, drop images) is allowed once per reply.
  let retriesLeft = 2;
  let correctionsLeft = 1;
  let toolsConfirmed = opts.caps.tools === true;

  for (let step = 0; step < 8; step++) {
    const reqStarted = Date.now();
    const resp = await fetch(`${creds.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.api_token}`,
      },
      body: JSON.stringify({
        model: creds.model,
        messages,
        ...(useTools ? { tools: toolSpecs, tool_choice: "auto" } : {}),
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      await writeAudit({
        user_id: userId,
        kind: "chat_request",
        model: creds.model,
        provider_host: host,
        conversation_id: conversationId,
        duration_ms: Date.now() - reqStarted,
        ok: false,
        error_message: `${resp.status} ${body.slice(0, 200)}`,
        payload: {
          step,
          status: resp.status,
          message_count: messages.length,
          tools_sent: useTools,
          last_user_message: preview(lastUser, 500),
          response_body_preview: preview(body, 1000),
        },
      });
      if (retriesLeft > 0 && hasImages(messages) && isVisionUnsupportedError(resp.status, body)) {
        retriesLeft--;
        stripImages(messages);
        notices.add("vision_unsupported");
        await saveCapabilities(userId, opts.endpointId, creds.model, { vision: false });
        continue;
      }
      if (retriesLeft > 0 && useTools && isToolsUnsupportedError(resp.status, body)) {
        retriesLeft--;
        useTools = false;
        messages[0] = { role: "system", content: system() };
        notices.add("tools_unsupported");
        await saveCapabilities(userId, opts.endpointId, creds.model, { tools: false });
        continue;
      }
      throw new Error(`AI provider error (${resp.status}): ${body.slice(0, 500)}`);
    }
    const json = (await resp.json()) as {
      choices?: { message?: OAIMessage; finish_reason?: string }[];
      usage?: Record<string, unknown>;
    };
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error("AI provider returned no message");
    addUsage(json.usage);
    const u = json.usage ?? {};
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const stepPrompt = num(u["prompt_tokens"] ?? u["input_tokens"]);
    const stepCompletion = num(u["completion_tokens"] ?? u["output_tokens"]);
    const stepTotal = num(u["total_tokens"]) ?? ((stepPrompt ?? 0) + (stepCompletion ?? 0) || null);
    const replyText = typeof msg.content === "string" ? msg.content : "";

    await writeAudit({
      user_id: userId,
      kind: "chat_request",
      model: creds.model,
      provider_host: host,
      conversation_id: conversationId,
      duration_ms: Date.now() - reqStarted,
      ok: true,
      prompt_tokens: stepPrompt,
      completion_tokens: stepCompletion,
      total_tokens: stepTotal,
      payload: {
        step,
        message_count: messages.length,
        tools_sent: useTools,
        last_user_message: preview(lastUser, 500),
        finish_reason: json.choices?.[0]?.finish_reason ?? null,
        usage: json.usage ?? null,
        assistant_text_preview: preview(replyText, 1000),
        tool_call_names: (msg.tool_calls ?? []).map((c) => c.function.name),
      },
    });

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // A model that writes its tool call out as text never gets a result
      // back; retry without tools so it answers from what it has instead.
      if (useTools && retriesLeft > 0 && !toolsConfirmed && looksLikeTextToolCall(replyText, TOOLS.map((t) => t.name))) {
        retriesLeft--;
        useTools = false;
        messages[0] = { role: "system", content: system() };
        notices.add("tools_unsupported");
        await saveCapabilities(userId, opts.endpointId, creds.model, { tools: false });
        continue;
      }
      // Small models sometimes answer with invented JSON ("action": "save")
      // instead of words or a real tool call, and may claim to have done
      // things. Ask once for a proper reply; never show the JSON as an answer.
      if (looksLikeRawJson(replyText)) {
        if (correctionsLeft > 0) {
          correctionsLeft--;
          messages.push({ role: "assistant", content: replyText });
          messages.push({ role: "user", content: RAW_JSON_CORRECTION });
          continue;
        }
        notices.add("model_unreliable");
        return { text: "", action: lastAction, usage: usage(), notices: [...notices] };
      }
      return { text: replyText, action: lastAction, usage: usage(), notices: [...notices] };
    }

    if (!toolsConfirmed) {
      toolsConfirmed = true;
      if (opts.caps.tools === null) await saveCapabilities(userId, opts.endpointId, creds.model, { tools: true });
    }

    // Push the assistant turn (with its tool_calls) so the next request includes it.
    messages.push({ role: "assistant", content: replyText, tool_calls: msg.tool_calls });

    // Execute tool calls in order.
    for (const call of msg.tool_calls) {
      const tool = TOOLS.find((t) => t.name === call.function.name);
      let result: ToolResult;
      const toolStarted = Date.now();
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        parsedArgs = { __raw: call.function.arguments };
      }
      if (!tool) {
        result = { ok: false, error: `Unknown tool: ${call.function.name}` };
      } else {
        try {
          result = await tool.exec(parsedArgs, sb, userId, opts.toolCtx);
        } catch (e) {
          result = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }
      if (result.ok && result.action) lastAction = result.action;
      await writeAudit({
        user_id: userId,
        kind: "tool_call",
        model: creds.model,
        provider_host: host,
        tool_name: call.function.name,
        conversation_id: conversationId,
        duration_ms: Date.now() - toolStarted,
        ok: result.ok,
        error_message: result.ok ? null : result.error,
        payload: {
          step,
          args: parsedArgs,
          result_preview: result.ok ? preview(result.data, 2000) : null,
          action: result.ok ? (result.action ? { kind: result.action.kind, label: result.action.label } : null) : null,
        },
      });
      // The action (with its draft) goes to the client, not back to the model.
      const forModel = result.ok ? { ok: true, data: result.data, button_shown: !!result.action } : result;
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(forModel),
      });
    }
  }

  return {
    text: "(stopped: too many tool-call iterations)",
    action: lastAction,
    usage: usage(),
    notices: [...notices],
  };
}

/** List models offered by an OpenAI-compatible endpoint (GET /models). */
export async function listModels(
  baseUrl: string,
  token: string | null,
  timeoutMs = 10000,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(`${base}/models`, { headers, signal: ac.signal });
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, models: [], error: `${resp.status} ${body.slice(0, 200)}` };
    }
    const json = (await resp.json()) as any;
    const raw: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
    const models = Array.from(
      new Set(
        raw
          .map((m) => (typeof m === "string" ? m : (m?.id ?? m?.name ?? m?.model)))
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .map((v) => v.trim()),
      ),
    ).sort((a, b) => a.localeCompare(b));
    return { ok: true, models };
  } catch (e) {
    return { ok: false, models: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function testConnection(baseUrl: string, token: string, model: string): Promise<{ ok: boolean; error?: string }> {
  const url = baseUrl.trim().replace(/\/+$/, "") + "/chat/completions";
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 4,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, error: `${resp.status} ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
// ---------------------------------------------------------------------------
// Speech-to-text
// ---------------------------------------------------------------------------

/** Max accepted upload for a single recording. */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * Transcribe a recording through an OpenAI-compatible /audio/transcriptions
 * endpoint (Whisper, faster-whisper, commercial providers).
 */
export async function runTranscription(
  userId: string,
  audio: Uint8Array,
  opts: { file_name?: string; mime_type?: string; language?: string | null; endpoint_id?: string | null; duration_ms?: number | null },
): Promise<{ text: string; endpoint: { id: string; name: string; fell_back: boolean }; model: string }> {
  if (audio.byteLength === 0) throw new Error("The recording is empty. Please try again.");
  if (audio.byteLength > MAX_AUDIO_BYTES) throw new Error("The recording is too large (max 10 MB).");

  // A binding may name the speech-to-text model directly, which makes the
  // connection usable for voice even when it carries no transcribe_model.
  const resolved = await resolveEndpoint(
    userId,
    "transcribe",
    opts.endpoint_id ?? null,
    (r, modelOverride) => !!(modelOverride ?? r.transcribe_model),
  );
  const row = resolved.endpoint;
  const model = resolved.model_override ?? row.transcribe_model!;
  const host = providerHost(row.base_url);
  const started = Date.now();

  const form = new FormData();
  form.append("model", model);
  form.append(
    "file",
    new Blob([audio.slice().buffer as ArrayBuffer], { type: opts.mime_type || "audio/wav" }),
    opts.file_name || "recording.wav",
  );
  if (opts.language) form.append("language", opts.language);

  const headers: Record<string, string> = {};
  if (row.api_token) headers["Authorization"] = `Bearer ${row.api_token}`;

  let resp: Response;
  try {
    resp = await fetch(`${row.base_url}/audio/transcriptions`, { method: "POST", headers, body: form });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await writeAudit({
      user_id: userId,
      kind: "transcribe",
      model,
      provider_host: host,
      duration_ms: Date.now() - started,
      ok: false,
      error_message: message,
      payload: { bytes: audio.byteLength, audio_duration_ms: opts.duration_ms ?? null },
    });
    throw new Error(`Transcription failed: ${message}`);
  }

  const raw = await resp.text();
  if (!resp.ok) {
    await writeAudit({
      user_id: userId,
      kind: "transcribe",
      model,
      provider_host: host,
      duration_ms: Date.now() - started,
      ok: false,
      error_message: `${resp.status} ${raw.slice(0, 200)}`,
      payload: { bytes: audio.byteLength, audio_duration_ms: opts.duration_ms ?? null, status: resp.status },
    });
    throw new Error(`Transcription error (${resp.status}): ${raw.slice(0, 500)}`);
  }

  let text = "";
  let usage: Record<string, unknown> | null = null;
  try {
    const json = JSON.parse(raw) as { text?: string; usage?: Record<string, unknown> };
    text = (json.text || "").trim();
    usage = json.usage ?? null;
  } catch {
    text = raw.trim();
  }

  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const promptTokens = n(usage?.["prompt_tokens"] ?? usage?.["input_tokens"]);
  const completionTokens = n(usage?.["completion_tokens"] ?? usage?.["output_tokens"]);

  await writeAudit({
    user_id: userId,
    kind: "transcribe",
    model,
    provider_host: host,
    duration_ms: Date.now() - started,
    ok: true,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: n(usage?.["total_tokens"]) ?? ((promptTokens ?? 0) + (completionTokens ?? 0) || null),
    payload: {
      bytes: audio.byteLength,
      audio_duration_ms: opts.duration_ms ?? null,
      language: opts.language ?? null,
      transcript_preview: preview(text, 500),
      usage,
    },
  });

  if (!text) throw new Error("The provider returned an empty transcript.");
  return { text, endpoint: { id: row.id, name: row.name, fell_back: resolved.fell_back }, model };
}
