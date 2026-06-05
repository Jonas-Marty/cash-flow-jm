import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import {
  getNextcloudStatus, saveNextcloudConfig, startNextcloudOAuth, disconnectNextcloud,
} from "@/utils/nextcloud.functions";

export function NextcloudCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const status = useServerFn(getNextcloudStatus);
  const save = useServerFn(saveNextcloudConfig);
  const start = useServerFn(startNextcloudOAuth);
  const disconnect = useServerFn(disconnectNextcloud);

  const q = useQuery({ queryKey: ["nextcloud_status"], queryFn: () => status() });
  const [baseUrl, setBaseUrl] = React.useState("");
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");

  React.useEffect(() => {
    if (q.data?.base_url) setBaseUrl(q.data.base_url);
  }, [q.data?.base_url]);

  const onSave = async () => {
    try {
      await save({ data: { base_url: baseUrl.trim(), client_id: clientId.trim(), client_secret: clientSecret.trim() } });
      toast.success(t("common.save"));
      setClientSecret("");
      qc.invalidateQueries({ queryKey: ["nextcloud_status"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  const onConnect = async () => {
    try {
      const { authUrl } = await start();
      window.location.href = authUrl;
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  const onDisconnect = async () => {
    if (!confirm(t("nextcloud.confirm_disconnect"))) return;
    try {
      await disconnect();
      qc.invalidateQueries({ queryKey: ["nextcloud_status"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("nextcloud.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("nextcloud.intro")}</p>
        <div className="grid gap-2 md:grid-cols-2">
          <div>
            <Label className="text-xs">{t("nextcloud.base_url")}</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://cloud.example.com" />
          </div>
          <div>
            <Label className="text-xs">{t("nextcloud.client_id")}</Label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={t("nextcloud.client_id_ph")} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">{t("nextcloud.client_secret")}</Label>
            <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={t("nextcloud.client_secret_ph")} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onSave}>{t("common.save")}</Button>
          <Button size="sm" variant="outline" disabled={!q.data?.configured} onClick={onConnect}>{t("nextcloud.connect")}</Button>
          {q.data?.connected && (
            <Button size="sm" variant="outline" onClick={onDisconnect}>{t("nextcloud.disconnect")}</Button>
          )}
        </div>
        {q.data?.connected ? (
          <p className="text-xs text-muted-foreground">{t("nextcloud.connected_as", { user: q.data.nextcloud_user ?? "?" })}</p>
        ) : q.data?.configured ? (
          <p className="text-xs text-muted-foreground">{t("nextcloud.saved_not_connected")}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("nextcloud.privilege_hint")}</p>
        <p className="text-xs text-muted-foreground">
          {t("nextcloud.redirect_uri_hint", { uri: `${typeof window !== "undefined" ? window.location.origin : "…"}/api/nextcloud/callback` })}
        </p>
      </CardContent>
    </Card>
  );
}