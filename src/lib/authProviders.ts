import type { Provider } from "@supabase/supabase-js";

/**
 * The generic OIDC provider (Authentik, Keycloak, Zitadel, …) as the auth
 * service knows it: a custom provider registered through its admin API.
 */
export const OIDC_PROVIDER_ID = "custom:oidc" as const;

/**
 * Maps a row in `auth_providers` (our admin-facing config table) to the
 * provider id the auth backend expects.
 */
export function toSupabaseProvider(provider: string): Provider | null {
  switch (provider) {
    case "google":
      return "google";
    case "microsoft":
      return "azure";
    case "oidc":
      return OIDC_PROVIDER_ID;
    default:
      return null;
  }
}

export function providerLabel(provider: string, displayName?: string | null) {
  if (displayName?.trim()) return displayName.trim();
  switch (provider) {
    case "oidc":
    case OIDC_PROVIDER_ID:
      return "OIDC";
    case "azure":
    case "microsoft":
      return "Microsoft";
    case "google":
      return "Google";
    case "email":
      return "E-Mail";
    default:
      return provider;
  }
}

/**
 * Where the auth service sends the browser back to after a sign-in. With the
 * trailing slash: the allow list holds `https://app/*`, which a bare origin
 * does not match, and GoTrue then falls back to its SITE_URL.
 */
export function authReturnUrl(origin: string, path = "/") {
  return `${origin.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface OAuthReturnError {
  code: string | null;
  description: string;
}

/**
 * A failed sign-in comes back as `error`/`error_code`/`error_description` in
 * the URL fragment (implicit flow) or query (PKCE). Null when there is none.
 */
export function oauthErrorFromUrl(href: string): OAuthReturnError | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  for (const params of [new URLSearchParams(url.hash.replace(/^#/, "")), url.searchParams]) {
    const error = params.get("error");
    const description = params.get("error_description");
    if (!error && !description) continue;
    return {
      code: params.get("error_code") ?? error,
      description: (description ?? error ?? "").replace(/\+/g, " "),
    };
  }
  return null;
}

/** The URL with any sign-in error parameters removed, for history.replaceState. */
export function withoutOAuthError(href: string): string {
  const url = new URL(href);
  const keys = ["error", "error_code", "error_description"];
  keys.forEach((k) => url.searchParams.delete(k));
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  keys.forEach((k) => hash.delete(k));
  url.hash = hash.toString();
  return url.toString();
}
