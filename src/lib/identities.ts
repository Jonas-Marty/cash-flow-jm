import { useQuery } from "@tanstack/react-query";
import type { Provider } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { authReturnUrl } from "@/lib/authProviders";
import { useAuth } from "@/lib/auth";
import { listSignInProviders } from "@/utils/oidc.functions";

export function useUserIdentities() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["user_identities", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUserIdentities();
      if (error) throw error;
      return data?.identities ?? [];
    },
  });
}

/** Providers that work end to end: enabled in Settings and set up in the auth service. */
export function useEnabledProviders() {
  return useQuery({
    queryKey: ["sign_in_providers"],
    queryFn: () => listSignInProviders(),
  });
}

export async function startLinkIdentity(provider: Provider) {
  const { error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo: authReturnUrl(window.location.origin, "/settings") },
  });
  return { error: error?.message ?? null };
}
