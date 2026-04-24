import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, ArchiveRestore, Archive, Pin, PinOff, Palette } from "lucide-react";
import { format } from "date-fns";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EntityChip } from "@/components/EntityChip";
import { IconPicker } from "@/components/IconPicker";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAccounts, fetchCategories, fetchCategoryGroups, fetchSettings,
  type AccountType, type GroupKind,
} from "@/lib/finance";
import { useI18n, LANGUAGES, type Lang } from "@/i18n";
import { RecurringRulesCard } from "@/components/RecurringRulesCard";
import { useAuth, useIsAdmin } from "@/lib/auth";
import { Switch } from "@/components/ui/switch";
import { useQuery as useRQ } from "@tanstack/react-query";
import { LogOut } from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const CURRENCIES: { code: string; symbol: string }[] = [
  { code: "CHF", symbol: "CHF" },
  { code: "EUR", symbol: "€" },
  { code: "USD", symbol: "$" },
  { code: "GBP", symbol: "£" },
  { code: "JPY", symbol: "¥" },
  { code: "CAD", symbol: "C$" },
  { code: "AUD", symbol: "A$" },
];

function SettingsPage() {
  const { t: tr, lang, setLang, locale } = useI18n();
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const groupsQ = useQuery({ queryKey: ["category_groups"], queryFn: fetchCategoryGroups });

  // Currency
  const setCurrency = async (code: string) => {
    const sym = CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
    if (!settingsQ.data) return;
    const { error } = await supabase
      .from("settings")
      .update({ currency_code: code, currency_symbol: sym })
      .eq("id", settingsQ.data.id);
    if (error) { toast.error(error.message); return; }
    toast.success(tr("toast.currency_updated"));
    qc.invalidateQueries({ queryKey: ["settings"] });
  };

  // Account form
  const [aName, setAName] = React.useState("");
  const [aType, setAType] = React.useState<AccountType>("asset");
  const [aOpening, setAOpening] = React.useState("0");
  const addAccount = async () => {
    if (!aName.trim()) { toast.error(tr("toast.name_required")); return; }
    const { error } = await supabase.from("accounts").insert({
      name: aName.trim(), type: aType, opening_balance: Number(aOpening) || 0,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(tr("toast.account_added"));
    setAName(""); setAOpening("0");
    qc.invalidateQueries();
  };
  const toggleArchiveAccount = async (id: string, archived: boolean) => {
    const { error } = await supabase.from("accounts").update({ archived: !archived }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();
  };
  const delAccount = async (id: string) => {
    if (!confirm(tr("confirm.delete_account"))) return;
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(tr("toast.deleted"));
    qc.invalidateQueries();
  };

  // Category form
  const [cName, setCName] = React.useState("");
  const [cBudget, setCBudget] = React.useState("0");
  const [cGroupId, setCGroupId] = React.useState<string>("");
  const addCategory = async () => {
    if (!cName.trim()) { toast.error(tr("toast.name_required")); return; }
    const sortOrder = (categoriesQ.data ?? []).length;
    const group = (groupsQ.data ?? []).find((g) => g.id === cGroupId);
    const isSavings = group?.kind === "savings";
    const { error } = await supabase.from("categories").insert({
      name: cName.trim(),
      allocated_budget: Number(cBudget) || 0,
      sort_order: sortOrder,
      group_id: cGroupId || null,
      is_savings: isSavings,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(tr("toast.envelope_added"));
    setCName(""); setCBudget("0"); setCGroupId("");
    qc.invalidateQueries();
  };
  const updateCategoryGroup = async (id: string, groupId: string) => {
    const group = (groupsQ.data ?? []).find((g) => g.id === groupId);
    const { error } = await supabase.from("categories").update({
      group_id: groupId || null,
      is_savings: group?.kind === "savings",
    }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();
  };
  const updateCategoryBudget = async (id: string, value: string) => {
    const v = Number(value); if (Number.isNaN(v)) return;
    const { error } = await supabase.from("categories").update({ allocated_budget: v }).eq("id", id);
    if (error) return toast.error(error.message);
    // also update current month's budget row so the change reflects immediately
    const m = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
    await supabase.from("category_budgets").upsert({ category_id: id, month: m, amount: v }, { onConflict: "category_id,month" });
    qc.invalidateQueries();
  };
  const toggleArchiveCategory = async (id: string, archived: boolean) => {
    const { error } = await supabase.from("categories").update({ archived: !archived }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();
  };
  const delCategory = async (id: string) => {
    if (!confirm(tr("confirm.delete_envelope"))) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(tr("toast.deleted"));
    qc.invalidateQueries();
  };

  // Group form
  const [gName, setGName] = React.useState("");
  const [gKind, setGKind] = React.useState<GroupKind>("expense");
  const addGroup = async () => {
    if (!gName.trim()) { toast.error(tr("toast.name_required")); return; }
    const sortOrder = (groupsQ.data ?? []).length;
    const { error } = await supabase.from("category_groups").insert({
      name: gName.trim(), kind: gKind, sort_order: sortOrder,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(tr("toast.group_added"));
    setGName("");
    qc.invalidateQueries();
  };
  const delGroup = async (id: string) => {
    if (!confirm(tr("confirm.delete_group"))) return;
    const { error } = await supabase.from("category_groups").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(tr("toast.deleted"));
    qc.invalidateQueries();
  };

  // Visual + pin updates (shared between accounts and categories)
  const updateVisual = async (
    table: "accounts" | "categories",
    id: string,
    patch: { icon: string | null; emoji: string | null; image_url: string | null; color: string | null },
  ) => {
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();
  };
  const togglePin = async (table: "accounts" | "categories", id: string, pinned: boolean) => {
    const { error } = await supabase.from(table).update({ pinned: !pinned }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();
  };

  const visualLabels = {
    icon: tr("settings.visual.icon"),
    emoji: tr("settings.visual.emoji"),
    image: tr("settings.visual.image"),
    color: tr("settings.visual.color"),
    upload: tr("settings.visual.upload"),
    remove: tr("settings.visual.remove"),
    uploadHint: tr("settings.visual.upload_hint"),
  };

  const onLangChange = async (l: string) => {
    await setLang(l as Lang);
    toast.success(tr("toast.language_updated"));
  };

  const [thresholdDraft, setThresholdDraft] = React.useState<string>("");
  React.useEffect(() => {
    if (settingsQ.data) setThresholdDraft(String(settingsQ.data.day_heatmap_threshold ?? 100));
  }, [settingsQ.data?.day_heatmap_threshold]);
  const saveThreshold = async () => {
    if (!settingsQ.data) return;
    const v = Number(thresholdDraft.replace(",", "."));
    if (!isFinite(v) || v < 0) return;
    if (v === Number(settingsQ.data.day_heatmap_threshold)) return;
    const { error } = await supabase
      .from("settings")
      .update({ day_heatmap_threshold: v })
      .eq("id", settingsQ.data.id);
    if (error) { toast.error(error.message); return; }
    toast.success(tr("toast.saved"));
    qc.invalidateQueries({ queryKey: ["settings"] });
  };

  const setDateFormat = async (fmt: string) => {
    if (!settingsQ.data) return;
    const { error } = await supabase
      .from("settings")
      .update({ date_format: fmt })
      .eq("id", settingsQ.data.id);
    if (error) { toast.error(error.message); return; }
    toast.success(tr("toast.saved"));
    qc.invalidateQueries({ queryKey: ["settings"] });
  };

  const DATE_FORMAT_PRESETS = [
    "dd.MM.yyyy",
    "dd/MM/yyyy",
    "MM/dd/yyyy",
    "yyyy-MM-dd",
    "d.M.yyyy",
    "d MMM yyyy",
  ];
  const datePreview = (fmt: string) => {
    try { return format(new Date(), fmt, { locale }); } catch { return fmt; }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{tr("settings.title")}</h1>

        <AccountCard />
        <IntegrationsCard />

        {/* Language */}
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("settings.language")}</CardTitle></CardHeader>
          <CardContent>
            <Select value={lang} onValueChange={onLangChange}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Currency */}
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("settings.currency")}</CardTitle></CardHeader>
          <CardContent>
            <Select value={settingsQ.data?.currency_code ?? "CHF"} onValueChange={setCurrency}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} ({c.symbol})</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Preferences */}
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("settings.preferences")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="heatmap-threshold" className="text-sm">{tr("settings.heatmap_threshold")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="heatmap-threshold"
                inputMode="decimal"
                className="w-40"
                value={thresholdDraft}
                onChange={(e) => setThresholdDraft(e.target.value.replace(/[^0-9.,]/g, ""))}
                onBlur={saveThreshold}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              />
              <span className="text-sm text-muted-foreground">{settingsQ.data?.currency_symbol ?? "CHF"}</span>
            </div>
            <p className="text-xs text-muted-foreground">{tr("settings.heatmap_threshold.hint")}</p>
            <div className="pt-3">
              <Label htmlFor="date-format" className="text-sm">{tr("settings.date_format")}</Label>
              <Select value={settingsQ.data?.date_format ?? "dd.MM.yyyy"} onValueChange={setDateFormat}>
                <SelectTrigger id="date-format" className="mt-1 w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DATE_FORMAT_PRESETS.map((f) => (
                    <SelectItem key={f} value={f}>
                      <span className="font-mono">{f}</span>
                      <span className="ml-2 text-muted-foreground">· {datePreview(f)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{tr("settings.date_format.hint")}</p>
            </div>
          </CardContent>
        </Card>

        {/* Accounts */}
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("settings.accounts")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-[1fr_140px_140px_auto]">
              <div><Label className="mb-1 block text-xs text-muted-foreground">{tr("common.name")}</Label><Input value={aName} onChange={(e) => setAName(e.target.value)} placeholder="Main Bank" /></div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">{tr("common.type")}</Label>
                <Select value={aType} onValueChange={(v) => setAType(v as AccountType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asset">{tr("settings.account_asset")}</SelectItem>
                    <SelectItem value="liability">{tr("settings.account_liability")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="mb-1 block text-xs text-muted-foreground">{tr("settings.opening_balance")}</Label><Input inputMode="decimal" value={aOpening} onChange={(e) => setAOpening(e.target.value)} /></div>
              <div className="flex items-end"><Button className="w-full" onClick={addAccount}><Plus className="h-4 w-4" /> {tr("common.add")}</Button></div>
            </div>
            <p className="text-xs text-muted-foreground">{tr("settings.accounts.asset_hint")}</p>

            <ul className="divide-y">
              {(accountsQ.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <EntityChip entity={{ id: a.id, name: a.name, icon: a.icon, emoji: a.emoji, image_url: a.image_url, color: a.color }} showLabel={false} />
                    <div className="min-w-0">
                      <div className={a.archived ? "text-muted-foreground line-through" : "font-medium"}>{a.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.type === "asset" ? tr("settings.account_asset") : tr("settings.account_liability")} · {tr("settings.opening_balance")} {Number(a.opening_balance).toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={tr("settings.visual.edit")}><Palette className="h-4 w-4" /></Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80" align="end">
                        <IconPicker
                          entityId={a.id}
                          value={{ icon: a.icon, emoji: a.emoji, image_url: a.image_url, color: a.color }}
                          onChange={(p) => updateVisual("accounts", a.id, p)}
                          labels={visualLabels}
                        />
                      </PopoverContent>
                    </Popover>
                    <Button variant="ghost" size="icon" onClick={() => togglePin("accounts", a.id, !!a.pinned)} aria-label={a.pinned ? tr("settings.unpin") : tr("settings.pin")}>
                      {a.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => toggleArchiveAccount(a.id, a.archived)} aria-label={a.archived ? tr("common.unarchive") : tr("common.archive")}>
                      {a.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => delAccount(a.id)} aria-label={tr("common.delete")}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
              {(accountsQ.data ?? []).length === 0 && <li className="py-2 text-sm text-muted-foreground">{tr("settings.no_accounts")}</li>}
            </ul>
          </CardContent>
        </Card>

        {/* Categories */}
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("settings.groups")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
              <div><Label className="mb-1 block text-xs text-muted-foreground">{tr("common.name")}</Label><Input value={gName} onChange={(e) => setGName(e.target.value)} placeholder="Fixkosten" /></div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">{tr("common.kind")}</Label>
                <Select value={gKind} onValueChange={(v) => setGKind(v as GroupKind)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="income">{tr("settings.kind_income")}</SelectItem>
                    <SelectItem value="expense">{tr("settings.kind_expense")}</SelectItem>
                    <SelectItem value="savings">{tr("settings.kind_savings")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end"><Button className="w-full" onClick={addGroup}><Plus className="h-4 w-4" /> {tr("common.add")}</Button></div>
            </div>
            <ul className="divide-y">
              {(groupsQ.data ?? []).map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="font-medium">{g.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {g.kind === "income" ? tr("settings.kind_income") : g.kind === "savings" ? tr("settings.kind_savings") : tr("settings.kind_expense")}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => delGroup(g.id)} aria-label={tr("common.delete")}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
              {(groupsQ.data ?? []).length === 0 && <li className="py-2 text-sm text-muted-foreground">{tr("settings.no_groups")}</li>}
            </ul>
          </CardContent>
        </Card>

        {/* Categories */}
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("settings.envelopes")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-[1fr_180px_180px_auto]">
              <div><Label className="mb-1 block text-xs text-muted-foreground">{tr("common.name")}</Label><Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Groceries" /></div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">{tr("common.group")}</Label>
                <Select value={cGroupId || "__none"} onValueChange={(v) => setCGroupId(v === "__none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{tr("common.none")}</SelectItem>
                    {(groupsQ.data ?? []).map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name} <span className="text-muted-foreground">· {g.kind}</span></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="mb-1 block text-xs text-muted-foreground">{tr("settings.monthly_budget")}</Label><Input inputMode="decimal" value={cBudget} onChange={(e) => setCBudget(e.target.value)} /></div>
              <div className="flex items-end"><Button className="w-full" onClick={addCategory}><Plus className="h-4 w-4" /> {tr("common.add")}</Button></div>
            </div>

            <ul className="divide-y">
              {(categoriesQ.data ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <EntityChip entity={{ id: c.id, name: c.name, icon: c.icon, emoji: c.emoji, image_url: c.image_url, color: c.color }} showLabel={false} />
                    <div className={c.archived ? "min-w-0 text-muted-foreground line-through" : "min-w-0"}>
                      <div className="font-medium">{c.name}</div>
                      {c.is_savings && <div className="text-[10px] font-semibold uppercase text-muted-foreground">{tr("add.savings_badge")}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={c.group_id ?? "__none"} onValueChange={(v) => updateCategoryGroup(c.id, v === "__none" ? "" : v)}>
                      <SelectTrigger className="w-40"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{tr("common.none")}</SelectItem>
                        {(groupsQ.data ?? []).map((g) => (
                          <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      defaultValue={Number(c.allocated_budget).toString()}
                      inputMode="decimal"
                      className="w-28 text-right tabular-nums"
                      onBlur={(e) => updateCategoryBudget(c.id, e.target.value)}
                    />
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={tr("settings.visual.edit")}><Palette className="h-4 w-4" /></Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80" align="end">
                        <IconPicker
                          entityId={c.id}
                          value={{ icon: c.icon, emoji: c.emoji, image_url: c.image_url, color: c.color }}
                          onChange={(p) => updateVisual("categories", c.id, p)}
                          labels={visualLabels}
                        />
                      </PopoverContent>
                    </Popover>
                    <Button variant="ghost" size="icon" onClick={() => togglePin("categories", c.id, !!c.pinned)} aria-label={c.pinned ? tr("settings.unpin") : tr("settings.pin")}>
                      {c.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => toggleArchiveCategory(c.id, c.archived)} aria-label={c.archived ? tr("common.unarchive") : tr("common.archive")}>
                      {c.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => delCategory(c.id)} aria-label={tr("common.delete")}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
              {(categoriesQ.data ?? []).length === 0 && <li className="py-2 text-sm text-muted-foreground">{tr("settings.no_envelopes")}</li>}
            </ul>
          </CardContent>
        </Card>

        {/* Recurring rules */}
        <RecurringRulesCard />

        <p className="pb-4 text-xs text-muted-foreground">{tr("settings.footer")}</p>
      </div>
    </AppShell>
  );
}
