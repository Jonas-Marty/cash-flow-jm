// Talking to the auth service (GoTrue) about sign-in providers, as the service
// role. Server-only: the service key never reaches the browser.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { OIDC_PROVIDER_ID } from "@/lib/authProviders";
import { discoveryUrlFor, readDiscovery, type Discovery } from "@/lib/oidcDiscovery";

export interface GoTrueCustomProvider {
  identifier: string;
  name: string;
  client_id: string;
  issuer?: string;
  discovery_url?: string;
  enabled: boolean;
}

function authBase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return { base: `${url.replace(/\/$/, "")}/auth/v1`, key };
}

async function gotrue(path: string, init: RequestInit = {}) {
  const { base, key } = authBase();
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
}

/** The auth service's message for a failed call, without echoing the body blindly. */
async function gotrueError(res: Response): Promise<Error> {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const j = (await res.json()) as { msg?: string; message?: string; error_description?: string };
    msg = j.msg ?? j.message ?? j.error_description ?? msg;
  } catch {
    // not JSON
  }
  return new Error(`Auth service: ${msg}`);
}

// Raw, not URL-encoded: GoTrue compares the path segment as is, and refuses
// "custom%3Aoidc" for not starting with "custom:".
const providerPath = `/admin/custom-providers/${OIDC_PROVIDER_ID}`;

export async function getOidcProvider(): Promise<GoTrueCustomProvider | null> {
  const res = await gotrue(providerPath);
  if (res.status === 404) return null;
  if (!res.ok) throw await gotrueError(res);
  return (await res.json()) as GoTrueCustomProvider;
}

export async function putOidcProvider(body: Record<string, unknown>, exists: boolean) {
  const res = exists
    ? await gotrue(providerPath, { method: "PUT", body: JSON.stringify(body) })
    : await gotrue("/admin/custom-providers", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw await gotrueError(res);
  return (await res.json()) as GoTrueCustomProvider;
}

export async function deleteOidcProvider() {
  const res = await gotrue(providerPath, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw await gotrueError(res);
}

/** Which of the built-in OAuth providers the auth service has credentials for. */
export async function builtInProvidersEnabled(): Promise<Record<string, boolean>> {
  const res = await gotrue("/settings");
  if (!res.ok) throw await gotrueError(res);
  const j = (await res.json()) as { external?: Record<string, boolean> };
  return j.external ?? {};
}

export async function isAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

export async function assertAdmin(userId: string) {
  if (!(await isAdmin(userId))) throw new Error("Only administrators can change sign-in providers");
}

export type DiscoveryResult = Discovery & { url: string; durationMs: number; error?: string };

/** Fetch and read a discovery document. Never throws: the caller shows `error`. */
export async function fetchDiscovery(input: string): Promise<DiscoveryResult> {
  const started = Date.now();
  let url: string;
  try {
    url = discoveryUrlFor(input);
  } catch (e) {
    return {
      url: input,
      durationMs: 0,
      missing: [],
      error: e instanceof Error ? e.message : "Invalid URL",
    };
  }
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const durationMs = Date.now() - started;
    if (!res.ok)
      return { url, durationMs, missing: [], error: `HTTP ${res.status} ${res.statusText}` };
    let doc: unknown;
    try {
      doc = await res.json();
    } catch {
      return { url, durationMs, missing: [], error: "Response is not valid JSON" };
    }
    const d = readDiscovery(doc);
    return {
      ...d,
      url,
      durationMs,
      error: d.missing.length
        ? `Discovery document is missing: ${d.missing.join(", ")}`
        : undefined,
    };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      url,
      durationMs: Date.now() - started,
      missing: [],
      error: timedOut ? "Timed out after 8s" : e instanceof Error ? e.message : "Unknown error",
    };
  }
}
