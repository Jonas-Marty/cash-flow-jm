import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, Unlink } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { toSupabaseProvider, providerLabel } from "@/lib/authProviders";
import { useAuth } from "@/lib/auth";

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

export function useEnabledProviders() {
  return useQuery({
    queryKey: ["auth_providers_enabled"],
    queryFn: async () => {
      const { data } = await supabase
        .from("auth_providers")
        .select("provider, display_name, enabled")
        .eq("enabled", true);
      return data ?? [];
    },
  });
}

export async function startLinkIdentity(provider: string) {
  const mapped = toSupabaseProvider(provider);
  if (!mapped) return { error: "unsupported" as const };
  const { error } = await supabase.auth.linkIdentity({
    provider: mapped,
    options: { redirectTo: `${window.location.origin}/settings` },
  });
  return { error: error?.message ?? null };
}

export function LinkedAccountsCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const identitiesQ = useUserIdentities();
  const providersQ = useEnabledProviders();
  const [busy, setBusy] = React.useState<string | null>(null);

  const identities = identitiesQ.data ?? [];
  const linkedProviders = new Set(identities.map((i) => i.provider));

  const link = async (provider: string) => {
    setBusy(provider);
    const { error } = await startLinkIdentity(provider);
    setBusy(null);
    if (error === "unsupported") {
      toast.error(t("linked.unsupported"));
      return;
    }
    if (error && /manual.linking.is.disabled/i.test(error)) {
      toast.error(t("linked.manual_disabled"));
      return;
    }
    if (error) toast.error(`${t("linked.link_failed")}: ${error}`);
  };

  const unlink = async (identityId: string) => {
    if (identities.length <= 1) {
      toast.error(t("linked.last_method"));
      return;
    }
    const identity = identities.find((i) => i.identity_id === identityId);
    if (!identity) return;
    setBusy(identityId);
    const { error } = await supabase.auth.unlinkIdentity(identity);
    setBusy(null);
    if (error) {
      toast.error(`${t("linked.unlink_failed")}: ${error.message}`);
      return;
    }
    toast.success(t("linked.unlinked"));
    qc.invalidateQueries({ queryKey: ["user_identities"] });
  };

  const linkable = (providersQ.data ?? []).filter(
    (p) => !!toSupabaseProvider(p.provider) && !linkedProviders.has(toSupabaseProvider(p.provider)!),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("linked.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("linked.intro")}</p>

        <ul className="divide-y rounded-md border">
          {identities.map((i) => (
            <li key={i.identity_id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium capitalize">{i.provider}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {(i.identity_data?.email as string | undefined) ?? i.id}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === i.identity_id || identities.length <= 1}
                onClick={() => unlink(i.identity_id)}
                title={identities.length <= 1 ? t("linked.last_method") : undefined}
              >
                <Unlink className="h-4 w-4" /> {t("linked.unlink")}
              </Button>
            </li>
          ))}
          {identities.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">{t("linked.none")}</li>
          )}
        </ul>

        {linkable.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs uppercase text-muted-foreground">{t("linked.add")}</div>
            <div className="flex flex-wrap gap-2">
              {linkable.map((p) => (
                <Button
                  key={p.provider}
                  variant="outline"
                  size="sm"
                  disabled={busy === p.provider}
                  onClick={() => link(p.provider)}
                >
                  <Link2 className="h-4 w-4" />{" "}
                  {t("linked.link_with", { p: providerLabel(p.provider, p.display_name) })}
                </Button>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("linked.hint")}</p>
      </CardContent>
    </Card>
  );
}
