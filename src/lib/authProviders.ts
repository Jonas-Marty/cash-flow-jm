import type { Provider } from "@supabase/supabase-js";

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
    case "keycloak":
      return "keycloak";
    default:
      return null;
  }
}

export function providerLabel(provider: string, displayName?: string | null) {
  return displayName ?? provider;
}
