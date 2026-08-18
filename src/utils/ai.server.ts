// Server-only helpers for the AI assistant.
// Loads BYO provider credentials, runs the tool-call loop, executes tools
// against the user-scoped Supabase client (RLS applies).

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildSystemPrompt } from "@/lib/ai/systemPrompt";
import type { AIHealthMode, AIHealthProbe, AssistantAction } from "@/lib/ai/types";

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

export async function writeAudit(row: {
  user_id: string;
  kind: "chat_request" | "tool_call" | "document_extract" | "transcribe";
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
  context_level: "off" | "compact" | "full";
  /** Speech-to-text model for /audio/transcriptions. Null = voice unsupported. */
  transcribe_model: string | null;
  /** How thoroughly availability is probed. */
  health_mode: AIHealthMode;
}

export async function loadEndpointRows(userId: string): Promise<EndpointRow[]> {
  const { data, error } = await supabaseAdmin
    .from("ai_endpoints")
    .select(
      "id, name, base_url, model, api_token, enabled, priority, context_level, transcribe_model, health_mode, created_at",
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
  }));
}

function toCreds(row: EndpointRow): FullAICreds {
  return { enabled: true, base_url: row.base_url, model: row.model, api_token: row.api_token || "" };
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
  try {
    const resp = await withTimeout((signal) =>
      fetch(`${base}/health?model=${encodeURIComponent(model)}`, { headers, signal }),
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
    // no usable /health — fall through to the real chat request
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
 */
export async function resolveEndpoint(
  userId: string,
  action: string,
  explicitId?: string | null,
  filter?: (row: EndpointRow) => boolean,
): Promise<{ creds: FullAICreds; endpoint: EndpointRow; fell_back: boolean }> {
  const rows = (await loadEndpointRows(userId)).filter(
    (r) => r.enabled && r.base_url && r.model && (!filter || filter(r)),
  );
  if (rows.length === 0) throw new Error("No AI connection configured. Add one in Settings.");

  const { data: binding } = await supabaseAdmin
    .from("ai_action_endpoints")
    .select("endpoint_id, allow_fallback")
    .eq("user_id", userId)
    .eq("action", action)
    .maybeSingle();

  const preferredId = explicitId || binding?.endpoint_id || null;
  const allowFallback = explicitId ? true : binding?.allow_fallback !== false;
  const preferred = preferredId ? rows.find((r) => r.id === preferredId) : rows[0];

  if (preferred && !allowFallback) return { creds: toCreds(preferred), endpoint: preferred, fell_back: false };

  const ordered = preferred ? [preferred, ...rows.filter((r) => r.id !== preferred.id)] : rows;
  let lastError = "";
  for (const [i, row] of ordered.entries()) {
    const health = await pingEndpoint(row.base_url, row.api_token, row.model);
    if (health.ok) return { creds: toCreds(row), endpoint: row, fell_back: i > 0 };
    lastError = health.error || "unavailable";
  }
  throw new Error(`No AI connection is reachable right now (last error: ${lastError}).`);
}

export async function loadCredentials(userId: string): Promise<FullAICreds> {
  const { data, error } = await supabaseAdmin
    .from("ai_credentials")
    .select("enabled, base_url, model, api_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.enabled) throw new Error("AI is disabled. Configure it in Settings.");
  const base_url = (data.base_url || "").trim().replace(/\/+$/, "");
  if (!base_url) throw new Error("AI base URL is missing. Configure it in Settings.");
  if (!data.api_token) throw new Error("AI API token is missing. Configure it in Settings.");
  if (!data.model) throw new Error("AI model name is missing. Configure it in Settings.");
  return {
    enabled: true,
    base_url,
    model: data.model,
    api_token: data.api_token,
  };
}

export async function saveCredentials(
  userId: string,
  patch: { enabled?: boolean; base_url?: string | null; model?: string | null; api_token?: string | null },
): Promise<void> {
  // Upsert via admin to allow writing api_token (column-grant excludes it for authenticated).
  const { error } = await supabaseAdmin
    .from("ai_credentials")
    .upsert(
      {
        user_id: userId,
        enabled: patch.enabled ?? false,
        base_url: patch.base_url ?? null,
        model: patch.model ?? null,
        // If api_token is undefined, keep existing; null clears.
        ...(patch.api_token !== undefined ? { api_token: patch.api_token } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

type Sb = SupabaseClient;

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  exec: (args: Record<string, unknown>, sb: Sb, userId: string) => Promise<ToolResult>;
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
  const { data } = await sb.from("categories").select("id, name, archived").order("name");
  return (data || []) as { id: string; name: string; archived: boolean }[];
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
      "List recent transactions. Filters: date_from / date_to (YYYY-MM-DD), type (expense|income|transfer), search (text in description/note), limit (default 25, max 100).",
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
      return { ok: true, data };
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
        .select("id, occurred_on, amount, description, reimbursement_counterparty, reimbursement_status")
        .eq("is_reimbursable", true)
        .neq("reimbursement_status", "settled")
        .order("occurred_on", { ascending: false })
        .limit(100);
      if (error) return { ok: false, error: error.message };
      return { ok: true, data };
    },
  },
  {
    name: "search_help",
    description: "Search the in-app help/wiki content by keyword. Use this to answer 'how do I…' or privacy/GDPR questions.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    exec: async (a) => {
      const q = (str(a.query) || "").toLowerCase();
      const hits = HELP_INDEX.filter((h) => h.q.toLowerCase().includes(q) || h.a.toLowerCase().includes(q)).slice(0, 6);
      return { ok: true, data: hits };
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
      const [accs, cats] = await Promise.all([loadAccounts(sb), loadCategories(sb)]);
      const acc = fuzzyFind(accs, str(a.account_name));
      const cat = fuzzyFind(cats, str(a.category_name));
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
      const summary = [
        `${type === "expense" ? "Expense" : type === "income" ? "Income" : "Transfer"} ${amount}`,
        acc ? `from ${acc.name}` : null,
        cat ? `→ ${cat.name}` : null,
        desc,
        iouWith && iouAmt ? `(${iouWith} owes ${iouAmt})` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        ok: true,
        data: { summary, prefilled: search, matched_account: acc?.name ?? null, matched_category: cat?.name ?? null },
        action: { kind: "open_add", label: "Review in Add form", search },
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Help index (mirrors the static help.tsx sections)
// ---------------------------------------------------------------------------

const HELP_INDEX: { section: string; q: string; a: string }[] = [
  { section: "Transactions", q: "How do I add a transaction?", a: "Tap the + button (mobile) or the Add tab. Pick expense / income / transfer, fill amount, account and category. You can also ask me to prefill the form from a sentence." },
  { section: "IOUs", q: "What are Open IOUs?", a: "Expenses you marked as reimbursable where someone owes you money. From OpenIOUs card you can Add repayment, Mark settled (paid in full off-app), Book as loss (write off), or Cancel (revert to a normal expense)." },
  { section: "Pending", q: "What are Pending Transactions?", a: "Entries imported from the public API (bank, Nextcloud bridge, etc.) waiting for review. Tabs: Pending, Open IOUs, Rejected, Confirmed." },
  { section: "Insights", q: "Insights page", a: "Overview, Breakdown, Trends, Projection tabs for any period." },
  { section: "API", q: "How do I use the public API?", a: "Create an API token in Settings → API Tokens, then call /api/public/* with header X-API-Token. See /help for endpoints." },
  { section: "Privacy", q: "Where is my data stored?", a: "Data is stored unencrypted on a private homelab server in Switzerland. The server operator can read all entered data — see /privacy for the full GDPR statement." },
  { section: "AI", q: "What does the AI assistant send to my provider?", a: "When you chat, your messages plus tool results (transactions, balances, categories) are sent to the OpenAI-compatible endpoint you configured. Your API token is stored server-side and is readable by the server operator." },
];

// ---------------------------------------------------------------------------
// OpenAI-compatible chat client (tool-calling loop)
// ---------------------------------------------------------------------------

interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatResult {
  text: string;
  action: AssistantAction | null;
  /** Summed token usage across all provider round-trips of this reply. */
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; steps: number } | null;
}

export async function runChat(
  creds: FullAICreds,
  sb: Sb,
  userId: string,
  systemPromptCtx: Parameters<typeof buildSystemPrompt>[0],
  history: { role: "user" | "assistant" | "tool"; content: string; tool_call_id?: string; tool_calls?: OAIMessage["tool_calls"] }[],
  conversationId?: string | null,
): Promise<ChatResult> {
  const messages: OAIMessage[] = [
    { role: "system", content: buildSystemPrompt(systemPromptCtx) },
    ...history.map((m) => ({
      role: m.role,
      content: m.content,
      tool_call_id: m.tool_call_id,
      tool_calls: m.tool_calls,
    })),
  ];

  const tools = TOOLS.map((t) => ({
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
  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";

  for (let step = 0; step < 6; step++) {
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
        tools,
        tool_choice: "auto",
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      await writeAudit({
        user_id: userId,
        kind: "chat_request",
        model: creds.model,
        provider_host: host,
        conversation_id: conversationId ?? null,
        duration_ms: Date.now() - reqStarted,
        ok: false,
        error_message: `${resp.status} ${body.slice(0, 200)}`,
        payload: {
          step,
          status: resp.status,
          message_count: messages.length,
          last_user_message: preview(lastUser, 500),
          response_body_preview: preview(body, 1000),
        },
      });
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

    await writeAudit({
      user_id: userId,
      kind: "chat_request",
      model: creds.model,
      provider_host: host,
      conversation_id: conversationId ?? null,
      duration_ms: Date.now() - reqStarted,
      ok: true,
      prompt_tokens: stepPrompt,
      completion_tokens: stepCompletion,
      total_tokens: stepTotal,
      payload: {
        step,
        message_count: messages.length,
        last_user_message: preview(lastUser, 500),
        finish_reason: json.choices?.[0]?.finish_reason ?? null,
        usage: json.usage ?? null,
        assistant_text_preview: preview(msg.content ?? "", 1000),
        tool_call_names: (msg.tool_calls ?? []).map((c) => c.function.name),
      },
    });

    // Push the assistant turn (with any tool_calls) so the next request includes it.
    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: msg.tool_calls,
    });

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return {
        text: msg.content || "",
        action: lastAction,
        usage: usageTotals.steps > 0 && usageTotals.total_tokens > 0 ? usageTotals : null,
      };
    }

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
          result = await tool.exec(parsedArgs, sb, userId);
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
        conversation_id: conversationId ?? null,
        duration_ms: Date.now() - toolStarted,
        ok: result.ok,
        error_message: result.ok ? null : result.error,
        payload: {
          step,
          args: parsedArgs,
          result_preview: result.ok ? preview(result.data, 2000) : null,
          action: result.ok ? result.action ?? null : null,
        },
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    text: "(stopped: too many tool-call iterations)",
    action: lastAction,
    usage: usageTotals.steps > 0 && usageTotals.total_tokens > 0 ? usageTotals : null,
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

  const resolved = await resolveEndpoint(userId, "transcribe", opts.endpoint_id ?? null, (r) => !!r.transcribe_model);
  const row = resolved.endpoint;
  const model = row.transcribe_model!;
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
