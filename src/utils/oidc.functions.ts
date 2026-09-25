import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { OIDC_PROVIDER_ID, providerLabel, toSupabaseProvider } from "@/lib/authProviders";
import { customOidcProviderBody } from "@/lib/oidcDiscovery";
import {
  assertAdmin,
  builtInProvidersEnabled,
  deleteOidcProvider,
  fetchDiscovery,
  getOidcProvider,
  putOidcProvider,
} from "./signInProviders.server";

// Sign-in providers live in two places: our auth_providers table decides which
// buttons the login page offers, and the auth service (GoTrue) holds what makes
// them work. For the generic OIDC provider the app writes both, so Settings is
// the whole configuration; the client secret only ever goes to GoTrue.

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
 * Fetches a discovery document server-side (LAN-only providers are reachable,
 * no CORS) and reports whether it is usable. Admins only: it makes the server
 * fetch a URL of the caller's choosing.
 */
export const testOidcDiscovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { url: string }) => {
    const url = String(data?.url ?? "").trim();
    if (!url) throw new Error("Discovery URL is required");
    return { url };
  })
  .handler(async ({ data, context }): Promise<OidcTestResult> => {
    await assertAdmin(context.userId);
    const d = await fetchDiscovery(data.url);
    return {
      ok: !d.error,
      issuer: d.issuer,
      authorizationEndpoint: d.authorizationEndpoint,
      tokenEndpoint: d.tokenEndpoint,
      jwksUri: d.jwksUri,
      scopes: d.scopes,
      durationMs: d.durationMs,
      error: d.error,
    };
  });

/** What the auth service holds for the generic OIDC provider. Never the secret. */
export const getOidcProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const p = await getOidcProvider();
    return p
      ? { configured: true, enabled: p.enabled, client_id: p.client_id, issuer: p.issuer ?? null }
      : { configured: false, enabled: false, client_id: null, issuer: null };
  });

export const saveOidcProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      discovery_url: string;
      client_id: string;
      client_secret?: string;
      display_name?: string | null;
    }) =>
      z
        .object({
          discovery_url: z.string().trim().url().max(500),
          client_id: z.string().trim().min(1).max(200),
          // Empty keeps the secret the auth service already has.
          client_secret: z.string().trim().max(500).optional().default(""),
          display_name: z.string().trim().max(100).nullish(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const d = await fetchDiscovery(data.discovery_url);
    if (d.error || !d.issuer) throw new Error(d.error ?? "Discovery document has no issuer");
    if (!d.issuer.startsWith("https://"))
      throw new Error("The auth service only accepts https issuers");

    const existing = await getOidcProvider();
    if (!existing && !data.client_secret) throw new Error("Enter the client secret");
    const name = providerLabel("oidc", data.display_name);
    const saved = await putOidcProvider(
      customOidcProviderBody({
        identifier: OIDC_PROVIDER_ID,
        name,
        issuer: d.issuer,
        discoveryUrl: d.url,
        clientId: data.client_id,
        clientSecret: data.client_secret || undefined,
        enabled: existing?.enabled ?? true,
      }),
      !!existing,
    );

    const { error } = await supabaseAdmin
      .from("auth_providers")
      .update({
        client_id: data.client_id,
        discovery_url: d.url,
        display_name: data.display_name || null,
      })
      .eq("provider", "oidc");
    if (error) throw new Error(error.message);
    return {
      configured: true,
      enabled: saved.enabled,
      client_id: saved.client_id,
      issuer: saved.issuer ?? d.issuer,
    };
  });

export const removeOidcProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    await deleteOidcProvider();
    const { error } = await supabaseAdmin
      .from("auth_providers")
      .update({ enabled: false })
      .eq("provider", "oidc");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Show or hide a provider on the login page. Refused while the auth service
 * cannot sign anyone in with it, so the page never offers a dead button.
 */
export const setSignInProviderEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { provider: string; enabled: boolean }) =>
    z.object({ provider: z.enum(["oidc", "google", "microsoft"]), enabled: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.provider === "oidc") {
      const existing = await getOidcProvider();
      if (!existing) {
        if (data.enabled) throw new Error("Save the provider's settings first");
      } else if (existing.enabled !== data.enabled) {
        await putOidcProvider({ enabled: data.enabled }, true);
      }
    } else if (data.enabled) {
      const external = await builtInProvidersEnabled();
      const id = toSupabaseProvider(data.provider)!;
      if (!external[id])
        throw new Error(`The auth service has no ${providerLabel(data.provider)} credentials`);
    }
    const { error } = await supabaseAdmin
      .from("auth_providers")
      .update({ enabled: data.enabled })
      .eq("provider", data.provider);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Which built-in providers the auth service could sign in with (for Settings). */
export const getBuiltInProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const external = await builtInProvidersEnabled();
    return { google: !!external.google, microsoft: !!external.azure };
  });

/**
 * The sign-in buttons for the login page and for linking: enabled in Settings
 * AND working in the auth service. Public — the login page has no session.
 */
export const listSignInProviders = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("auth_providers")
    .select("provider, display_name")
    .eq("enabled", true)
    .order("provider");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (!rows.length) return [];

  const needsBuiltIn = rows.some((r) => r.provider !== "oidc");
  const [oidc, external] = await Promise.all([
    rows.some((r) => r.provider === "oidc") ? getOidcProvider().catch(() => null) : null,
    needsBuiltIn ? builtInProvidersEnabled().catch(() => ({}) as Record<string, boolean>) : {},
  ]);
  return rows
    .filter((r) => {
      const id = toSupabaseProvider(r.provider);
      if (!id) return false;
      return r.provider === "oidc" ? !!oidc?.enabled : !!(external as Record<string, boolean>)[id];
    })
    .map((r) => ({
      provider: r.provider,
      supabaseProvider: toSupabaseProvider(r.provider)!,
      label: providerLabel(r.provider, r.display_name),
    }));
});
