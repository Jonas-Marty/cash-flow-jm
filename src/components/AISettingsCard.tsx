import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Plus, Trash2, RefreshCw, Loader2, ChevronsUpDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  listAIEndpoints,
  saveAIEndpoint,
  deleteAIEndpoint,
  saveAIActionBinding,
  checkAIEndpoints,
  testAIConnection,
  listAIModels,
} from "@/utils/ai.functions";
import type { AIContextLevel, AIEndpoint, AIEndpointHealth, AIHealthMode } from "@/lib/ai/types";
import { AI_ACTIONS } from "@/lib/ai/types";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

type Draft = {
  id: string | null;
  name: string;
  base_url: string;
  model: string;
  enabled: boolean;
  priority: number;
  context_level: AIContextLevel;
  transcribe_model: string;
  health_mode: AIHealthMode;
  token: string;
  has_token: boolean;
};

const emptyDraft = (priority: number): Draft => ({
  id: null,
  name: "",
  base_url: "",
  model: "",
  enabled: true,
  priority,
  context_level: "compact",
  transcribe_model: "",
  health_mode: "real",
  token: "",
  has_token: false,
});

const toDraft = (e: AIEndpoint): Draft => ({
  id: e.id,
  name: e.name,
  base_url: e.base_url,
  model: e.model,
  enabled: e.enabled,
  priority: e.priority,
  context_level: e.context_level ?? "compact",
  transcribe_model: e.transcribe_model ?? "",
  health_mode: e.health_mode ?? "real",
  token: "",
  has_token: e.has_token,
});

/** "checked 12s ago" style label. */
function useRelativeTime(iso: string | undefined, t: (k: string, p?: Record<string, string | number>) => string) {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    if (!iso) return;
    const id = setInterval(force, 5000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return t("ai.conn.checked_seconds", { n: secs });
  return t("ai.conn.checked_minutes", { n: Math.round(secs / 60) });
}

export function AISettingsCard() {
  return <AISettingsCardInner />;
}

function ModelField({
  value,
  onChange,
  options,
  loading,
  disabled,
  onLoad,
  placeholder,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  loading: boolean;
  disabled: boolean;
  onLoad: () => void;
  placeholder: string;
  t: (k: string) => string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mt-1 flex gap-2">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="flex-1" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled || loading}
            title={t("ai.conn.models_load")}
            aria-label={t("ai.conn.models_load")}
            onClick={() => {
              if (options.length === 0) onLoad();
            }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronsUpDown className="h-4 w-4" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="end">
          <Command>
            <CommandInput placeholder={t("ai.conn.models_search")} />
            <CommandList>
              <CommandEmpty>{t("ai.conn.models_none")}</CommandEmpty>
              <CommandGroup>
                {options.map((m) => (
                  <CommandItem
                    key={m}
                    value={m}
                    onSelect={() => {
                      onChange(m);
                      setOpen(false);
                    }}
                    className="gap-2"
                  >
                    <Check className={cn("h-4 w-4", value === m ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{m}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          <div className="border-t p-1">
            <Button variant="ghost" size="sm" className="w-full justify-start" disabled={loading} onClick={onLoad}>
              {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
              {t("ai.conn.models_reload")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function AISettingsCardInner() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listAIEndpoints);
  const saveFn = useServerFn(saveAIEndpoint);
  const delFn = useServerFn(deleteAIEndpoint);
  const bindFn = useServerFn(saveAIActionBinding);
  const checkFn = useServerFn(checkAIEndpoints);
  const testFn = useServerFn(testAIConnection);
  const modelsFn = useServerFn(listAIModels);

  const [models, setModels] = React.useState<Record<string, string[]>>({});
  const [loadingModels, setLoadingModels] = React.useState<string | null>(null);

  const draftKey = (d: Draft) => d.id ?? "new";

  const loadModels = async (d: Draft) => {
    const key = draftKey(d);
    setLoadingModels(key);
    try {
      const r = await modelsFn({
        data: { id: d.id, base_url: d.base_url.trim(), api_token: d.token || undefined },
      });
      if (!r.ok) {
        toast.error(r.error || t("ai.conn.models_failed"));
        return;
      }
      setModels((prev) => ({ ...prev, [key]: r.models }));
      if (r.models.length === 0) toast.info(t("ai.conn.models_none"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingModels(null);
    }
  };

  const q = useQuery({ queryKey: ["ai_endpoints"], queryFn: () => listFn() });
  const endpoints = q.data?.endpoints ?? [];
  const bindings = q.data?.bindings ?? [];

  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [newDraft, setNewDraft] = React.useState<Draft | null>(null);
  const [health, setHealth] = React.useState<Record<string, AIEndpointHealth>>({});
  const [busy, setBusy] = React.useState(false);
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    setDrafts(Object.fromEntries(endpoints.map((e) => [e.id, toDraft(e)])));
  }, [q.data?.endpoints]);

  const patch = (id: string, p: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));

  const save = async (d: Draft) => {
    setBusy(true);
    try {
      await saveFn({
        data: {
          id: d.id,
          name: d.name.trim(),
          base_url: d.base_url.trim(),
          model: d.model.trim(),
          enabled: d.enabled,
          priority: d.priority,
          context_level: d.context_level,
          transcribe_model: d.transcribe_model.trim() || null,
          health_mode: d.health_mode,
          ...(d.token === "" ? {} : { api_token: d.token }),
        } as never,
      });
      toast.success(t("toast.saved"));
      setNewDraft(null);
      qc.invalidateQueries({ queryKey: ["ai_endpoints"] });
      qc.invalidateQueries({ queryKey: ["ai_settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm(t("ai.conn.delete_confirm"))) return;
    try {
      await delFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["ai_endpoints"] });
      qc.invalidateQueries({ queryKey: ["ai_settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const checkAll = async () => {
    setChecking(true);
    try {
      const r = await checkFn({ data: {} } as never);
      setHealth(Object.fromEntries(r.health.map((h) => [h.id, h])));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  // Auto-check when the card mounts and then quietly every 5 minutes while the
  // tab is visible — long enough that a forgotten open tab stays harmless.
  const checkRef = React.useRef(checkAll);
  checkRef.current = checkAll;
  const autoRan = React.useRef(false);
  React.useEffect(() => {
    if (endpoints.length === 0) return;
    if (!autoRan.current) {
      autoRan.current = true;
      void checkRef.current();
    }
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void checkRef.current();
    }, 300_000);
    return () => clearInterval(id);
  }, [endpoints.length]);

  const test = async (d: Draft) => {
    setBusy(true);
    try {
      const r = await testFn({
        data: { id: d.id, base_url: d.base_url.trim(), model: d.model.trim(), api_token: d.token || undefined },
      });
      if (r.ok) toast.success(t("ai.test.ok"));
      else toast.error(r.error || t("ai.test.fail"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setBinding = async (action: string, endpoint_id: string | null, allow_fallback: boolean) => {
    try {
      await bindFn({ data: { action, endpoint_id, allow_fallback } as never });
      qc.invalidateQueries({ queryKey: ["ai_endpoints"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const StatusBadge = ({ d }: { d: Draft }) => {
    const h = d.id ? health[d.id] : undefined;
    const ago = useRelativeTime(h?.checked_at, t);
    if (!d.enabled) return <Badge variant="outline">{t("ai.conn.disabled")}</Badge>;
    if (checking && !h) {
      return (
        <Badge variant="outline">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          {t("ai.conn.checking")}
        </Badge>
      );
    }
    if (!h) return <Badge variant="outline">{t("ai.conn.unknown")}</Badge>;
    const degraded = !h.ok && h.degraded;
    const tone = h.ok
      ? "border-emerald-500/50 text-emerald-600"
      : degraded
        ? "border-amber-500/50 text-amber-600"
        : "border-destructive/50 text-destructive";
    const dot = h.ok ? "bg-emerald-500" : degraded ? "bg-amber-500" : "bg-destructive";
    const label = h.ok ? `${t("ai.conn.online")} · ${h.latency_ms}ms` : degraded ? t("ai.conn.degraded") : t("ai.conn.offline");
    const probe = h.probe ? t(`ai.conn.probe.${h.probe}`) : "";
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn(tone)} title={[probe, h.error ?? ""].filter(Boolean).join(" · ")}>
          <span className={cn("mr-1 inline-block h-2 w-2 rounded-full", dot)} />
          {label}
        </Badge>
        {ago && <span className="text-xs text-muted-foreground">{ago}</span>}
      </div>
    );
  };

  const row = (d: Draft, isNew = false) => (
    // eslint-disable-next-line
    <div key={d.id ?? "new"} className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge d={d} />
          <Switch
            checked={d.enabled}
            onCheckedChange={(v) => (isNew ? setNewDraft({ ...d, enabled: v }) : patch(d.id!, { enabled: v }))}
          />
        </div>
        {!isNew && (
          <Button variant="ghost" size="icon" onClick={() => remove(d.id!)} aria-label={t("common.remove")}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-sm">{t("ai.conn.name")}</Label>
          <Input
            value={d.name}
            onChange={(e) => (isNew ? setNewDraft({ ...d, name: e.target.value }) : patch(d.id!, { name: e.target.value }))}
            placeholder="Local Ollama"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-sm">{t("ai.settings.model")}</Label>
          <ModelField
            value={d.model}
            placeholder="gpt-4o-mini"
            options={models[draftKey(d)] ?? []}
            loading={loadingModels === draftKey(d)}
            disabled={!d.base_url.trim()}
            onLoad={() => loadModels(d)}
            onChange={(v) => (isNew ? setNewDraft({ ...d, model: v }) : patch(d.id!, { model: v }))}
            t={t}
          />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-sm">{t("ai.settings.base_url")}</Label>
          <Input
            value={d.base_url}
            onChange={(e) =>
              isNew ? setNewDraft({ ...d, base_url: e.target.value }) : patch(d.id!, { base_url: e.target.value })
            }
            placeholder="https://api.openai.com/v1"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("ai.settings.base_url_hint")}</p>
        </div>
        <div>
          <Label className="text-sm">{t("ai.settings.token")}</Label>
          <Input
            type="password"
            autoComplete="off"
            value={d.token}
            onChange={(e) => (isNew ? setNewDraft({ ...d, token: e.target.value }) : patch(d.id!, { token: e.target.value }))}
            placeholder={d.has_token ? "••••••••  " + t("ai.settings.token_stored") : ""}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-sm">{t("ai.conn.priority")}</Label>
          <Input
            type="number"
            value={d.priority}
            onChange={(e) => {
              const v = Number(e.target.value) || 0;
              isNew ? setNewDraft({ ...d, priority: v }) : patch(d.id!, { priority: v });
            }}
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("ai.conn.priority_hint")}</p>
        </div>
        <div className="sm:col-span-2">
          <Label className="text-sm">{t("ai.conn.context")}</Label>
          <Select
            value={d.context_level}
            onValueChange={(v) =>
              isNew
                ? setNewDraft({ ...d, context_level: v as AIContextLevel })
                : patch(d.id!, { context_level: v as AIContextLevel })
            }
          >
            <SelectTrigger className="mt-1 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t("ai.conn.context.off")}</SelectItem>
              <SelectItem value="compact">{t("ai.conn.context.compact")}</SelectItem>
              <SelectItem value="full">{t("ai.conn.context.full")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">{t("ai.conn.context_hint")}</p>
        </div>
        <div className="sm:col-span-2">
          <Label className="text-sm">{t("ai.conn.health_mode")}</Label>
          <Select
            value={d.health_mode}
            onValueChange={(v) =>
              isNew
                ? setNewDraft({ ...d, health_mode: v as AIHealthMode })
                : patch(d.id!, { health_mode: v as AIHealthMode })
            }
          >
            <SelectTrigger className="mt-1 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">{t("ai.conn.health_mode.fast")}</SelectItem>
              <SelectItem value="model_listed">{t("ai.conn.health_mode.model_listed")}</SelectItem>
              <SelectItem value="real">{t("ai.conn.health_mode.real")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">{t("ai.conn.health_mode_hint")}</p>
        </div>
        <div className="sm:col-span-2">
          <Label className="text-sm">{t("ai.conn.transcribe_model")}</Label>
          <ModelField
            value={d.transcribe_model}
            placeholder="whisper-1"
            options={models[draftKey(d)] ?? []}
            loading={loadingModels === draftKey(d)}
            disabled={!d.base_url.trim()}
            onLoad={() => loadModels(d)}
            onChange={(v) =>
              isNew ? setNewDraft({ ...d, transcribe_model: v }) : patch(d.id!, { transcribe_model: v })
            }
            t={t}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("ai.conn.transcribe_model_hint")}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => save(d)} disabled={busy || !d.name || !d.base_url || !d.model}>
          {t("common.save")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => test(d)} disabled={busy || !d.base_url || !d.model}>
          {t("ai.settings.test")}
        </Button>
        {isNew && (
          <Button size="sm" variant="ghost" onClick={() => setNewDraft(null)}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" /> {t("ai.conn.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{t("ai.conn.intro")}</p>
        <p className="text-xs text-muted-foreground">{t("ai.settings.token_hint")}</p>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={checkAll} disabled={checking || endpoints.length === 0}>
            {checking ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
            {t("ai.conn.check")}
          </Button>
          <Button
            size="sm"
            onClick={() => setNewDraft(emptyDraft((endpoints.at(-1)?.priority ?? 0) + 10))}
            disabled={!!newDraft}
          >
            <Plus className="mr-1 h-3 w-3" />
            {t("ai.conn.add")}
          </Button>
        </div>

        {endpoints.length === 0 && !newDraft && (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("ai.conn.none")}</p>
        )}

        <div className="space-y-3">
          {endpoints.map((e) => drafts[e.id] && row(drafts[e.id]))}
          {newDraft && row(newDraft, true)}
        </div>

        {endpoints.length > 0 && (
          <div className="space-y-3 rounded-md border p-3">
            <Label className="text-sm font-medium">{t("ai.conn.actions_title")}</Label>
            {AI_ACTIONS.map((action) => {
              const b = bindings.find((x) => x.action === action);
              return (
                <div key={action} className="space-y-2">
                  <Label className="text-xs text-muted-foreground">{t(`ai.conn.action.${action}`)}</Label>
                  <Select
                    value={b?.endpoint_id ?? "auto"}
                    onValueChange={(v) => setBinding(action, v === "auto" ? null : v, b?.allow_fallback !== false)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t("ai.conn.auto")}</SelectItem>
                      {endpoints.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name} · {e.model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{t("ai.conn.fallback")}</span>
                    <Switch
                      checked={b?.allow_fallback !== false}
                      onCheckedChange={(v) => setBinding(action, b?.endpoint_id ?? null, v)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
