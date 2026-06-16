import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Trash2, Send } from "lucide-react";
import { useI18n } from "@/i18n";
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
} from "@/utils/webhooks.functions";

export function WebhooksCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const list = useServerFn(listWebhooks);
  const create = useServerFn(createWebhook);
  const update = useServerFn(updateWebhook);
  const del = useServerFn(deleteWebhook);
  const sendTest = useServerFn(testWebhook);

  const q = useQuery({ queryKey: ["webhooks"], queryFn: () => list() });

  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [headerName, setHeaderName] = React.useState("");
  const [headerValue, setHeaderValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const onCreate = async () => {
    if (!name.trim() || !url.trim()) return;
    setBusy(true);
    try {
      await create({
        data: {
          name: name.trim(),
          url: url.trim(),
          auth_header_name: headerName.trim() || null,
          auth_header_value: headerValue || null,
        },
      });
      setName(""); setUrl(""); setHeaderName(""); setHeaderValue("");
      qc.invalidateQueries({ queryKey: ["webhooks"] });
      toast.success(t("webhooks.created"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("webhooks.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("webhooks.intro")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label className="text-xs">{t("webhooks.name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="n8n flatastic" />
          </div>
          <div>
            <Label className="text-xs">{t("webhooks.url")}</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://n8n.example.com/webhook/…" />
          </div>
          <div>
            <Label className="text-xs">{t("webhooks.header_name")}</Label>
            <Input value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="X-API-Key" />
          </div>
          <div>
            <Label className="text-xs">{t("webhooks.header_value")}</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={headerValue}
              onChange={(e) => setHeaderValue(e.target.value)}
              placeholder="••••••••"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={onCreate} disabled={busy || !name.trim() || !url.trim()}>
            {t("webhooks.create")}
          </Button>
        </div>

        <ul className="divide-y rounded-md border">
          {(q.data?.webhooks ?? []).length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">{t("webhooks.empty")}</li>
          )}
          {(q.data?.webhooks ?? []).map((wh) => (
            <li key={wh.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{wh.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">{wh.url}</div>
                {wh.auth_header_name && (
                  <div className="text-[10px] text-muted-foreground">
                    {t("webhooks.header_label")}: <code>{wh.auth_header_name}</code>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!!wh.active}
                  onCheckedChange={async (v) => {
                    try {
                      await update({ data: { id: wh.id, patch: { active: v } } });
                      qc.invalidateQueries({ queryKey: ["webhooks"] });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : String(e));
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await sendTest({ data: { id: wh.id } });
                      toast.success(t("webhooks.test_sent"));
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : String(e));
                    }
                  }}
                  title={t("webhooks.test")}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
                <button
                  onClick={async () => {
                    if (!confirm(t("webhooks.confirm_delete"))) return;
                    try {
                      await del({ data: { id: wh.id } });
                      qc.invalidateQueries({ queryKey: ["webhooks"] });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : String(e));
                    }
                  }}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("webhooks.payload_hint")}</p>
      </CardContent>
    </Card>
  );
}