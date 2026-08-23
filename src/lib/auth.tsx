import * as React from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** sessionStorage marker for a fresh interactive sign-in in this tab. */
export const JUST_SIGNED_IN_KEY = "just-signed-in";

interface AuthCtx {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = React.createContext<AuthCtx>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let lastUserId: string | null = null;
    let hadSession = false;
    // Set listener BEFORE getSession (per Supabase guidance)
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      setSession(s);
      // Best-effort audit logging for auth events.
      // Defer the network call so we don't block the auth state update.
      const uid = s?.user?.id ?? null;
      // Mark a *fresh* interactive sign-in (no session before) so one-time
      // post-login prompts don't fire on every tab open / session restore.
      if (evt === "SIGNED_IN" && uid && !hadSession && typeof window !== "undefined") {
        window.sessionStorage.setItem(`${JUST_SIGNED_IN_KEY}:${uid}`, "1");
      }
      hadSession = !!s;

      const action: "login" | "logout" | "token.refresh" | null =
        evt === "SIGNED_IN" ? "login"
        : evt === "SIGNED_OUT" ? "logout"
        : evt === "TOKEN_REFRESHED" ? "token.refresh"
        : null;
      if (action && (action !== "login" || uid !== lastUserId)) {
        // Avoid spamming on initial-state replays for the same user.
        if (action === "logout" || uid) {
          lastUserId = uid;
          setTimeout(() => {
            supabase.rpc("log_audit_event", {
              p_action: action,
              p_metadata: {
                ua: typeof navigator !== "undefined" ? navigator.userAgent : null,
              },
            }).then(({ error }) => {
              if (error && typeof console !== "undefined") {
                // eslint-disable-next-line no-console
                console.warn("[audit] log_audit_event failed:", error.message);
              }
            });
          }, 0);
        }
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      lastUserId = data.session?.user?.id ?? null;
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = React.useMemo<AuthCtx>(
    () => ({ session, user: session?.user ?? null, loading, signOut }),
    [session, loading, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => React.useContext(Ctx);

export function useIsAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["is_admin", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return false;
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) return false;
      return !!data;
    },
  });
}
