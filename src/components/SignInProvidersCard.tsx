import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, CircleDashed } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { useIsAdmin } from "@/lib/auth";
import { helpUrl } from "@/lib/helpUrl";
import { providerLabel } from "@/lib/authProviders";
import {
  getBuiltInProviderStatus,
  getOidcProviderStatus,
  removeOidcProvider,
  saveOidcProvider,
  setSignInProviderEnabled,
  testOidcDiscovery,
  type OidcTestResult,
} from "@/utils/oidc.functions";

type Row = {
  id: string;
  provider: string;
  display_name: string | null;
  enabled: boolean;
  client_id: string | null;
  discovery_url: string | null;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Settings → Integrations: which sign-in providers the login page offers. The
 * generic OIDC provider (Authentik, Keycloak, …) is configured here completely:
 * saving writes it to the auth service, secret included, so no environment
 * variable or restart is involved.
 */
export function SignInProvidersCard() {
  const { t } = useI18n();
  const isAdminQ = useIsAdmin();
  const qc = useQueryClient();
  const rowsQ = useQuery({
    queryKey: ["auth_providers_admin"],
    enabled: !!isAdminQ.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auth_providers")
        .select("id, provider, display_name, enabled, client_id, discovery_url")
        .order("provider");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const builtInQ = useQuery({
    queryKey: ["sign_in_builtin_status"],
    enabled: !!isAdminQ.data,
    queryFn: () => getBuiltInProviderStatus(),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["auth_providers_admin"] });
    qc.invalidateQueries({ queryKey: ["oidc_provider_status"] });
    qc.invalidateQueries({ queryKey: ["sign_in_providers"] });
  };

  const setEnabled = async (provider: string, enabled: boolean) => {
    try {
      await setSignInProviderEnabled({ data: { provider, enabled } });
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (isAdminQ.isLoading) return null;
  if (!isAdminQ.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.integrations")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t("settings.integrations.admin_only")}
        </CardContent>
      </Card>
    );
  }

  const rows = rowsQ.data ?? [];
  const oidc = rows.find((r) => r.provider === "oidc");
  const builtIn = rows.filter((r) => r.provider !== "oidc");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("settings.integrations")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {oidc && (
          <OidcSection row={oidc} onChanged={refresh} onEnabled={(v) => setEnabled("oidc", v)} />
        )}
        {builtIn.map((r) => {
          const ready = r.provider === "google" ? builtInQ.data?.google : builtInQ.data?.microsoft;
          return (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="font-medium">{providerLabel(r.provider, r.display_name)}</div>
                {!ready && (
                  <p className="text-xs text-muted-foreground">
                    {t("settings.integrations.builtin_missing", { p: providerLabel(r.provider) })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`en-${r.id}`} className="text-xs">
                  {t("settings.integrations.enabled")}
                </Label>
                <Switch
                  id={`en-${r.id}`}
                  checked={r.enabled}
                  disabled={!ready && !r.enabled}
                  onCheckedChange={(v) => setEnabled(r.provider, v)}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function OidcSection({
  row,
  onChanged,
  onEnabled,
}: {
  row: Row;
  onChanged: () => void;
  onEnabled: (v: boolean) => void;
}) {
  const { t, lang } = useI18n();
  const statusQ = useQuery({
    queryKey: ["oidc_provider_status"],
    queryFn: () => getOidcProviderStatus(),
  });
  const status = statusQ.data;

  const [displayName, setDisplayName] = React.useState(row.display_name ?? "");
  const [discovery, setDiscovery] = React.useState(row.discovery_url ?? "");
  const [clientId, setClientId] = React.useState(row.client_id ?? "");
  const [secret, setSecret] = React.useState("");
  const [busy, setBusy] = React.useState<"save" | "test" | "remove" | null>(null);
  const [test, setTest] = React.useState<OidcTestResult | null>(null);

  // The auth service is the truth: show what it holds once it has answered.
  React.useEffect(() => {
    if (status?.client_id) setClientId(status.client_id);
  }, [status?.client_id]);

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
  const callbackUrl = supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/auth/v1/callback` : "";
  const configured = !!status?.configured;

  const run = async (kind: "save" | "test" | "remove", fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run("save", async () => {
      await saveOidcProvider({
        data: {
          discovery_url: discovery,
          client_id: clientId,
          client_secret: secret,
          display_name: displayName || null,
        },
      });
      setSecret("");
      toast.success(t("settings.integrations.oidc.saved"));
      onChanged();
    });

  const runTest = () =>
    run("test", async () => {
      const res = await testOidcDiscovery({ data: { url: discovery } });
      setTest(res);
    });

  const remove = () =>
    run("remove", async () => {
      if (!window.confirm(t("settings.integrations.oidc.remove_confirm"))) return;
      await removeOidcProvider();
      setTest(null);
      onChanged();
    });

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{providerLabel("oidc", row.display_name)}</div>
          <div
            className="flex items-center gap-1 text-xs text-muted-foreground"
            data-testid="oidc-status"
          >
            {configured ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />{" "}
                {t("settings.integrations.oidc.configured")}
              </>
            ) : (
              <>
                <CircleDashed className="h-3.5 w-3.5" />{" "}
                {t("settings.integrations.oidc.not_configured")}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="en-oidc" className="text-xs">
            {t("settings.integrations.enabled")}
          </Label>
          <Switch
            id="en-oidc"
            checked={row.enabled && configured}
            disabled={!configured}
            onCheckedChange={onEnabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div>
          <Label htmlFor="oidc-name" className="text-xs">
            {t("settings.integrations.display_name")}
          </Label>
          <Input
            id="oidc-name"
            value={displayName}
            placeholder="Authentik"
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {t("settings.integrations.display_name_hint")}
          </p>
        </div>
        <div>
          <Label htmlFor="oidc-discovery" className="text-xs">
            {t("settings.integrations.discovery")}
          </Label>
          <div className="flex gap-2">
            <Input
              id="oidc-discovery"
              value={discovery}
              placeholder="https://auth.example.com/application/o/cashflow/"
              onChange={(e) => setDiscovery(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!discovery.trim() || busy !== null}
              onClick={runTest}
            >
              {busy === "test" ? "…" : t("settings.integrations.test")}
            </Button>
          </div>
        </div>
        <div>
          <Label htmlFor="oidc-client-id" className="text-xs">
            {t("settings.integrations.client_id")}
          </Label>
          <Input
            id="oidc-client-id"
            value={clientId}
            autoComplete="off"
            onChange={(e) => setClientId(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="oidc-secret" className="text-xs">
            {t("settings.integrations.client_secret")}
          </Label>
          <Input
            id="oidc-secret"
            type="password"
            value={secret}
            autoComplete="new-password"
            placeholder={configured ? t("settings.integrations.oidc.secret_kept") : ""}
            onChange={(e) => setSecret(e.target.value)}
          />
        </div>
      </div>

      {test && (
        <div
          role="status"
          className={`rounded-md border p-2 text-xs ${test.ok ? "border-success/60 bg-success/10" : "border-destructive/60 bg-destructive/10"}`}
        >
          {test.ok ? (
            <div className="space-y-0.5">
              <div className="font-medium">
                {t("settings.integrations.test.ok")} ({test.durationMs} ms)
              </div>
              <div className="break-all text-muted-foreground">issuer: {test.issuer}</div>
              <div className="break-all text-muted-foreground">
                authorize: {test.authorizationEndpoint}
              </div>
            </div>
          ) : (
            <div>
              {t("settings.integrations.test.failed")}: {test.error}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={save}
          disabled={
            busy !== null ||
            !discovery.trim() ||
            !clientId.trim() ||
            (!configured && !secret.trim())
          }
        >
          {busy === "save" ? "…" : t("settings.integrations.oidc.save")}
        </Button>
        {configured && (
          <Button variant="ghost" onClick={remove} disabled={busy !== null}>
            {t("settings.integrations.oidc.remove")}
          </Button>
        )}
      </div>

      {callbackUrl && (
        <p className="text-xs text-muted-foreground">
          {t("settings.integrations.redirect_uri_hint", { uri: callbackUrl })}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t("settings.integrations.oidc.hint")}{" "}
        <a
          href={helpUrl(lang, "oidc")}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {t("settings.integrations.secret_help_link")}
        </a>
      </p>
    </div>
  );
}
