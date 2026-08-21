import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OidcTestResult = {
  ok: boolean;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  scopes?: string[];
  durationMs: number;
  error?: string;
};

/**
 * Probes an OIDC discovery document (".well-known/openid-configuration") and
 * reports whether it is reachable and structurally usable.
 *
 * Runs server-side so self-hosted / LAN-only identity providers can be reached
 * and so the browser is not blocked by CORS.
 */
export const testOidcDiscovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { url: string }) => {
    const url = String(data?.url ?? "").trim();
    if (!url) throw new Error("Discovery URL is required");
    return { url };
  })
  .handler(async ({ data }): Promise<OidcTestResult> => {
    const started = Date.now();
    let target = data.url;
    try {
      const parsed = new URL(target);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, durationMs: 0, error: "URL must use http(s)" };
      }
      // Accept either the issuer root or the full discovery path.
      if (!parsed.pathname.includes("/.well-known/")) {
        parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`;
        target = parsed.toString();
      }
    } catch {
      return { ok: false, durationMs: 0, error: "Invalid URL" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(target, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const durationMs = Date.now() - started;
      if (!res.ok) {
        return { ok: false, durationMs, error: `HTTP ${res.status} ${res.statusText}` };
      }
      let doc: Record<string, unknown>;
      try {
        doc = (await res.json()) as Record<string, unknown>;
      } catch {
        return { ok: false, durationMs, error: "Response is not valid JSON" };
      }
      const issuer = typeof doc.issuer === "string" ? doc.issuer : undefined;
      const authorizationEndpoint =
        typeof doc.authorization_endpoint === "string" ? doc.authorization_endpoint : undefined;
      const tokenEndpoint = typeof doc.token_endpoint === "string" ? doc.token_endpoint : undefined;
      const jwksUri = typeof doc.jwks_uri === "string" ? doc.jwks_uri : undefined;
      const scopes = Array.isArray(doc.scopes_supported)
        ? (doc.scopes_supported as unknown[]).filter((s): s is string => typeof s === "string")
        : undefined;

      const missing: string[] = [];
      if (!issuer) missing.push("issuer");
      if (!authorizationEndpoint) missing.push("authorization_endpoint");
      if (!tokenEndpoint) missing.push("token_endpoint");
      if (!jwksUri) missing.push("jwks_uri");
      if (missing.length) {
        return {
          ok: false,
          durationMs,
          issuer,
          authorizationEndpoint,
          tokenEndpoint,
          jwksUri,
          error: `Discovery document is missing: ${missing.join(", ")}`,
        };
      }
      return { ok: true, durationMs, issuer, authorizationEndpoint, tokenEndpoint, jwksUri, scopes };
    } catch (err) {
      const durationMs = Date.now() - started;
      const message =
        err instanceof Error
          ? err.name === "AbortError"
            ? "Timed out after 8s"
            : err.message
          : "Unknown error";
      return { ok: false, durationMs, error: message };
    } finally {
      clearTimeout(timer);
    }
  });
