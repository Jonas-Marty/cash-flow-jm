import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sparkles } from "lucide-react";
import { getAISettings, saveAISettings, testAIConnection } from "@/utils/ai.functions";
import { useI18n } from "@/i18n";

export function AISettingsCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const getFn = useServerFn(getAISettings);
  const saveFn = useServerFn(saveAISettings);
  const testFn = useServerFn(testAIConnection);
  const q = useQuery({ queryKey: ["ai_settings"], queryFn: () => getFn() });

  const [enabled, setEnabled] = React.useState(false);
  const [baseUrl, setBaseUrl] = React.useState("");
  const [model, setModel] = React.useState("");
  const [token, setToken] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (q.data) {
      setEnabled(q.data.enabled);
      setBaseUrl(q.data.base_url ?? "");
      setModel(q.data.model ?? "");
    }
  }, [q.data]);

  const onSave = async () => {
    setBusy(true);
    try {
      await saveFn({
        data: {
          enabled,
          base_url: baseUrl.trim() || null,
          model: model.trim() || null,
          api_token: token === "" ? undefined : token,
        } as never,
      });
      toast.success(t("toast.saved"));
      setToken("");
      qc.invalidateQueries({ queryKey: ["ai_settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    setBusy(true);
    try {
      const r = await testFn({
        data: {
          base_url: baseUrl.trim(),
          model: model.trim(),
          api_token: token || undefined,
        },
      });
      if (r.ok) toast.success(t("ai.test.ok"));
      else toast.error(r.error || t("ai.test.fail"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" /> {t("ai.settings.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{t("ai.settings.intro")}</p>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label className="text-sm">{t("ai.settings.enabled")}</Label>
            <p className="text-xs text-muted-foreground">{t("ai.settings.enabled_hint")}</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div>
          <Label htmlFor="ai-base-url" className="text-sm">{t("ai.settings.base_url")}</Label>
          <Input
            id="ai-base-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("ai.settings.base_url_hint")}</p>
        </div>
        <div>
          <Label htmlFor="ai-model" className="text-sm">{t("ai.settings.model")}</Label>
          <Input
            id="ai-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="ai-token" className="text-sm">{t("ai.settings.token")}</Label>
          <Input
            id="ai-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={q.data?.has_token ? "••••••••  " + t("ai.settings.token_stored") : ""}
            className="mt-1"
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("ai.settings.token_hint")}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onSave} disabled={busy}>{t("common.save")}</Button>
          <Button variant="outline" onClick={onTest} disabled={busy || !baseUrl || !model}>{t("ai.settings.test")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}