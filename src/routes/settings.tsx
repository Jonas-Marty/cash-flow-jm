import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, ArchiveRestore, Archive, Pin, PinOff, Palette, ChevronUp, ChevronDown, Pencil, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EntityChip } from "@/components/EntityChip";
import { IconPicker } from "@/components/IconPicker";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAccounts, fetchCategories, fetchCategoryGroups, fetchSettings,
  type AccountType, type GroupKind,
} from "@/lib/finance";
import { useI18n, LANGUAGES, type Lang } from "@/i18n";
import { RecurringRulesCard } from "@/components/RecurringRulesCard";
import { NextcloudCard } from "@/components/NextcloudCard";
import { ApiTokensCard } from "@/components/ApiTokensCard";
import { WebhooksCard } from "@/components/WebhooksCard";
import { AuditLogCard } from "@/components/AuditLogCard";
import { BudgetBalanceCard } from "@/components/BudgetBalanceCard";
import { SavingsAndSweepsCard } from "@/components/SavingsAndSweepsCard";
import { fmtMoney } from "@/lib/finance";
import { useAuth, useIsAdmin } from "@/lib/auth";
import { Switch } from "@/components/ui/switch";
import { useQuery as useRQ } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { SettingsSectionNav, type SettingsSection } from "@/components/SettingsSectionNav";
import { AISettingsCard } from "@/components/AISettingsCard";
import { AIAuditLogCard } from "@/components/AIAuditLogCard";

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
  const [aCurrency, setACurrency] = React.useState<string>("");
  React.useEffect(() => {
    if (!aCurrency && settingsQ.data?.currency_code) setACurrency(settingsQ.data.currency_code);
  }, [settingsQ.data?.currency_code, aCurrency]);
  const addAccount = async () => {
    if (!aName.trim()) { toast.error(tr("toast.name_required")); return; }
    const code = aCurrency || settingsQ.data?.currency_code || "CHF";
    const sym = CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
    const { error } = await supabase.from("accounts").insert({
      name: aName.trim(), type: aType, opening_balance: Number(aOpening) || 0,
      currency_code: code, currency_symbol: sym,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(tr("toast.account_added"));
    setAName(""); setAOpening("0");
    qc.invalidateQueries();
  };
  const updateAccountCurrency = async (id: string, code: string) => {
    const sym = CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
    const { error } = await supabase
      .from("accounts")
      .update({ currency_code: code, currency_symbol: sym })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(tr("toast.saved"));
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

  // Edit account
  const [editAccount, setEditAccount] = React.useState<null | { id: string; name: string; opening_balance: number }>(null);
  const [editName, setEditName] = React.useState("");
  const [editOpening, setEditOpening] = React.useState("0");
  const openEditAccount = (a: { id: string; name: string; opening_balance: number | string }) => {
    const ob = Number(a.opening_balance) || 0;
    setEditAccount({ id: a.id, name: a.name, opening_balance: ob });
    setEditName(a.name);
    setEditOpening(String(ob));
  };
  const saveEditAccount = async () => {
    if (!editAccount) return;
    const name = editName.trim();
    if (!name) { toast.error(tr("toast.name_required")); return; }
    const opening = Number(editOpening);
    if (!Number.isFinite(opening)) { toast.error(tr("toast.name_required")); return; }
    const { error } = await supabase
      .from("accounts")
      .update({ name, opening_balance: opening })
      .eq("id", editAccount.id);
    if (error) return toast.error(error.message);
    toast.success(tr("toast.saved"));
    setEditAccount(null);
    qc.invalidateQueries();
  };
  const openingChanged = !!editAccount && Number(editOpening) !== editAccount.opening_balance;

  // Category form
  const [cName, setCName] = React.useState("");
  const [cBudget, setCBudget] = React.useState("0");
  const [cGroupId, setCGroupId] = React.useState<string>("");
  const [cIsSavings, setCIsSavings] = React.useState(false);
  const addCategory = async () => {
    if (!cName.trim()) { toast.error(tr("toast.name_required")); return; }
    const sortOrder = (categoriesQ.data ?? []).length;
    const group = (groupsQ.data ?? []).find((g) => g.id === cGroupId);
    const isSavings = cIsSavings || group?.kind === "savings";
    const { error } = await supabase.from("categories").insert({
      name: cName.trim(),
      allocated_budget: Number(cBudget) || 0,
      sort_order: sortOrder,
      group_id: cGroupId || null,
      is_savings: isSavings,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(tr("toast.envelope_added"));
    setCName(""); setCBudget("0"); setCGroupId(""); setCIsSavings(false);
    qc.invalidateQueries();
  };
  const updateCategoryGroup = async (id: string, groupId: string) => {
    const group = (groupsQ.data ?? []).find((g) => g.id === groupId);
    // Only auto-promote to savings when joining a savings-kind group;
    // never auto-clear is_savings when changing/clearing the group, so
    // standalone savings envelopes stay savings.
    const patch: { group_id: string | null; is_savings?: boolean } = {
      group_id: groupId || null,
    };
    if (group?.kind === "savings") patch.is_savings = true;
    const { error } = await supabase.from("categories").update(patch).eq("id", id);
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
    // remove any pre-generated future month rows so they get regenerated from the new default
    await supabase.from("category_budgets").delete().eq("category_id", id).gt("month", m);
    qc.invalidateQueries();
  };
  const toggleArchiveCategory = async (id: string, archived: boolean) => {
    const { error } = await supabase.from("categories").update({ archived: !archived }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();
  };
  const toggleCategorySavings = async (id: string, isSavings: boolean) => {
    const next = !isSavings;
    // Keep the user's allocation when flipping savings on/off — the value
    // is now the monthly *target* for savings envelopes too.
    const { error } = await supabase.from("categories").update({ is_savings: next }).eq("id", id);
    if (error) return toast.error(error.message);
    if (next) {
      // Drop any pre-generated monthly budget rows; savings envelopes don't use them.
      await supabase.from("category_budgets").delete().eq("category_id", id);
    }
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

  // Reorder helper: swap sort_order between two rows of the same table.
  const swapSortOrder = async (
    table: "category_groups" | "categories",
    a: { id: string; sort_order: number },
    b: { id: string; sort_order: number },
  ) => {
    if (a.sort_order === b.sort_order) {
      // Normalize so the swap actually moves things.
      const { error: e1 } = await supabase.from(table).update({ sort_order: b.sort_order + 1 }).eq("id", a.id);
      if (e1) return toast.error(e1.message);
      qc.invalidateQueries();
      return;
    }
    const { error: e1 } = await supabase.from(table).update({ sort_order: b.sort_order }).eq("id", a.id);
    if (e1) return toast.error(e1.message);
    const { error: e2 } = await supabase.from(table).update({ sort_order: a.sort_order }).eq("id", b.id);
    if (e2) return toast.error(e2.message);
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
      <div className="xl:grid xl:grid-cols-[1fr_220px] xl:gap-8">
        <SettingsSectionNav
          title={tr("settings.nav.on_this_page")}
          sections={[
            { id: "preferences", label: tr("settings.preferences") },
            { id: "groups", label: tr("settings.groups") },
            { id: "envelopes", label: tr("settings.envelopes") },
            { id: "savings", label: tr("settings.nav.savings_sweeps") },
            { id: "recurring", label: tr("recurring.title") },
            { id: "scopes", label: tr("scopes.title") },
            { id: "accounts", label: tr("settings.accounts") },
            { id: "nextcloud", label: tr("nextcloud.title") },
            { id: "api-tokens", label: tr("settings.nav.api_tokens") },
            { id: "webhooks", label: tr("webhooks.title") },
            { id: "ai", label: tr("ai.settings.title") },
            { id: "ai-audit", label: tr("ai.audit.title") },
            { id: "integrations", label: tr("settings.integrations") },
            { id: "audit", label: tr("audit.title") },
            { id: "account", label: tr("settings.account") },
          ] satisfies SettingsSection[]}
        />
        <div className="space-y-6 xl:col-start-1 xl:row-start-1 [&>section]:scroll-mt-24">
        <h1 className="text-2xl font-semibold tracking-tight">{tr("settings.title")}</h1>

        {/* Preferences (merged: Localization · Appearance · Money) */}
        <section id="preferences">
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("settings.preferences")}</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            {/* Localization */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("settings.prefs.localization")}</h3>
              <div>
                <Label htmlFor="pref-lang" className="text-sm">{tr("settings.language")}</Label>
                <Select value={lang} onValueChange={onLangChange}>
                  <SelectTrigger id="pref-lang" className="mt-1 w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
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
              <div>
                <Label htmlFor="format-locale" className="text-sm">{tr("settings.format_locale")}</Label>
                <Select
                  value={(settingsQ.data?.format_locale as string) ?? "de"}
                  onValueChange={async (v) => {
                    if (!settingsQ.data) return;
                    const { error } = await supabase
                      .from("settings")
                      .update({ format_locale: v })
                      .eq("id", settingsQ.data.id);
                    if (error) { toast.error(error.message); return; }
                    toast.success(tr("toast.saved"));
                    qc.invalidateQueries({ queryKey: ["settings"] });
                  }}
                >
                  <SelectTrigger id="format-locale" className="mt-1 w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="de">Deutsch</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">{tr("settings.format_locale.hint")}</p>
              </div>
            </section>

            {/* Appearance */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("settings.prefs.appearance")}</h3>
              <div>
                <Label htmlFor="pref-theme" className="text-sm">{tr("settings.theme")}</Label>
                <Select
                  value={(settingsQ.data?.theme as string) ?? "system"}
                  onValueChange={async (v) => {
                    if (!settingsQ.data) return;
                    const { error } = await supabase
                      .from("settings")
                      .update({ theme: v })
                      .eq("id", settingsQ.data.id);
                    if (error) { toast.error(error.message); return; }
                    toast.success(tr("toast.saved"));
                    qc.invalidateQueries({ queryKey: ["settings"] });
                  }}
                >
                  <SelectTrigger id="pref-theme" className="mt-1 w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">{tr("settings.theme.system")}</SelectItem>
                    <SelectItem value="light">{tr("settings.theme.light")}</SelectItem>
                    <SelectItem value="dark">{tr("settings.theme.dark")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="heatmap-threshold" className="text-sm">{tr("settings.heatmap_threshold")}</Label>
                <div className="mt-1 flex items-center gap-2">
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
                <p className="mt-1 text-xs text-muted-foreground">{tr("settings.heatmap_threshold.hint")}</p>
              </div>
            </section>

            {/* Money */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("settings.prefs.money")}</h3>
              <div>
                <Label htmlFor="pref-currency" className="text-sm">{tr("settings.currency")}</Label>
                <Select value={settingsQ.data?.currency_code ?? "CHF"} onValueChange={setCurrency}>
                  <SelectTrigger id="pref-currency" className="mt-1 w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} ({c.symbol})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <Label htmlFor="networth-convert" className="text-sm">{tr("settings.networth_convert")}</Label>
                  <p className="text-xs text-muted-foreground">{tr("settings.networth_convert.hint")}</p>
                </div>
                <Switch
                  id="networth-convert"
                  checked={!!settingsQ.data?.net_worth_show_converted}
                  onCheckedChange={async (checked) => {
                    if (!settingsQ.data) return;
                    const { error } = await supabase
                      .from("settings")
                      .update({ net_worth_show_converted: checked })
                      .eq("id", settingsQ.data.id);
                    if (error) { toast.error(error.message); return; }
                    qc.invalidateQueries({ queryKey: ["settings"] });
                  }}
                />
              </div>
            </section>
          </CardContent>
        </Card>
        </section>

        {/* Groups */}
        <section id="groups">
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("settings.groups")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
              <div><Label className="mb-1 block text-xs text-muted-foreground">{tr("common.name")}</Label><Input value={gName} onChange={(e) => setGName(e.target.value)} placeholder="Fixkosten" /></div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">{tr("settings.group_kind_label")}</Label>
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
            <p className="text-xs text-muted-foreground">{tr("settings.group_kind_hint")}</p>
            <ul className="divide-y">
              {(groupsQ.data ?? []).map((g, idx, arr) => (
                <li key={g.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="font-medium">{g.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {g.kind === "income" ? tr("settings.kind_income") : g.kind === "savings" ? tr("settings.kind_savings") : tr("settings.kind_expense")}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" disabled={idx === 0} onClick={() => swapSortOrder("category_groups", g, arr[idx - 1])} aria-label={tr("settings.move_up")}>
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={idx === arr.length - 1} onClick={() => swapSortOrder("category_groups", g, arr[idx + 1])} aria-label={tr("settings.move_down")}>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => delGroup(g.id)} aria-label={tr("common.delete")}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
              {(groupsQ.data ?? []).length === 0 && <li className="py-2 text-sm text-muted-foreground">{tr("settings.no_groups")}</li>}
            </ul>
          </CardContent>
        </Card>
        </section>

        {/* Categories */}
        <section id="envelopes">
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("settings.envelopes")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <BudgetBalanceCard
              categories={categoriesQ.data ?? []}
              groups={groupsQ.data ?? []}
              symbol={settingsQ.data?.currency_symbol ?? "CHF"}
            />
            <div className="grid gap-2 md:grid-cols-[1fr_180px_180px_auto]">
              <div><Label className="mb-1 block text-xs text-muted-foreground">{tr("common.name")}</Label><Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Groceries" /></div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">{tr("common.group")}</Label>
                <Select
                  value={cGroupId || "__none"}
                  onValueChange={(v) => {
                    const next = v === "__none" ? "" : v;
                    setCGroupId(next);
                    // Pre-default savings toggle to match the chosen group's
                    // default behaviour. The user can still override.
                    const g = (groupsQ.data ?? []).find((x) => x.id === next);
                    if (g) setCIsSavings(g.kind === "savings");
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{tr("common.none")}</SelectItem>
                    {(groupsQ.data ?? []).map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name} <span className="text-muted-foreground">· {g.kind}</span></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">{tr("settings.monthly_budget")}</Label>
                <Input inputMode="decimal" value={cBudget} onChange={(e) => setCBudget(e.target.value)} placeholder={cIsSavings ? tr("settings.savings_target_hint") : undefined} />
              </div>
              <div className="flex items-end"><Button className="w-full" onClick={addCategory}><Plus className="h-4 w-4" /> {tr("common.add")}</Button></div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Switch id="new-cat-savings" checked={cIsSavings} onCheckedChange={setCIsSavings} />
              <Label htmlFor="new-cat-savings" className="cursor-pointer">{tr("settings.savings_envelope")}</Label>
              <span className="text-xs text-muted-foreground">{tr("settings.savings_envelope_hint")}</span>
            </div>

            {(() => {
              const cats = categoriesQ.data ?? [];
              const grps = groupsQ.data ?? [];
              const renderRow = (c: typeof cats[number], idx: number, arr: typeof cats) => (
                <li key={c.id} className="flex flex-col gap-2 py-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex flex-col">
                      <Button variant="ghost" size="icon" className="h-5 w-5" disabled={idx === 0} onClick={() => swapSortOrder("categories", c, arr[idx - 1])} aria-label={tr("settings.move_up")}>
                        <ChevronUp className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-5 w-5" disabled={idx === arr.length - 1} onClick={() => swapSortOrder("categories", c, arr[idx + 1])} aria-label={tr("settings.move_down")}>
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </div>
                    <EntityChip entity={{ id: c.id, name: c.name, icon: c.icon, emoji: c.emoji, image_url: c.image_url, color: c.color }} showLabel={false} />
                    <div className={c.archived ? "min-w-0 text-muted-foreground line-through" : "min-w-0"}>
                      <div className="font-medium">{c.name}</div>
                      {c.is_savings && <div className="text-[10px] font-semibold uppercase text-muted-foreground">{tr("add.savings_badge")}</div>}
                      {(() => {
                        const g = (groupsQ.data ?? []).find((x) => x.id === c.group_id);
                        if (!g) return null;
                        const diverges = (g.kind === "savings") !== c.is_savings;
                        if (!diverges) return null;
                        return (
                          <div className="text-[10px] text-warning" title={tr("settings.behaviour_diverges")}>⚠ {tr("settings.behaviour_diverges")}</div>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:justify-end">
                    <Select value={c.group_id ?? "__none"} onValueChange={(v) => updateCategoryGroup(c.id, v === "__none" ? "" : v)}>
                      <SelectTrigger className="w-36 md:w-40"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{tr("common.none")}</SelectItem>
                        {grps.map((g) => (
                          <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1" title={tr("settings.savings_envelope")}>
                      <Switch checked={c.is_savings} onCheckedChange={() => toggleCategorySavings(c.id, c.is_savings)} aria-label={tr("settings.savings_envelope")} />
                    </div>
                    <Input
                      key={`${c.id}-${c.is_savings}-${c.allocated_budget}`}
                      defaultValue={Number(c.allocated_budget).toString()}
                      inputMode="decimal"
                      className="w-24 text-right tabular-nums md:w-28"
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
              );
              const sections: React.ReactNode[] = [];
              for (const g of grps) {
                const inGroup = cats.filter((c) => c.group_id === g.id);
                const groupSum = inGroup.reduce((s, c) => s + (c.archived ? 0 : Number(c.allocated_budget) || 0), 0);
                const sym = settingsQ.data?.currency_symbol ?? "CHF";
                sections.push(
                  <div key={g.id} className="space-y-1">
                    <div className="flex items-baseline justify-between pt-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</div>
                      <div className="text-xs tabular-nums text-muted-foreground">
                        Σ {fmtMoney(groupSum, sym)}
                      </div>
                    </div>
                    <ul className="divide-y">
                      {inGroup.length === 0
                        ? <li className="py-2 text-sm text-muted-foreground">{tr("settings.no_envelopes_in_group")}</li>
                        : inGroup.map((c, i) => renderRow(c, i, inGroup))}
                    </ul>
                  </div>
                );
              }
              const ungrouped = cats.filter((c) => !c.group_id);
              if (ungrouped.length > 0) {
                const groupSum = ungrouped.reduce((s, c) => s + (c.archived ? 0 : Number(c.allocated_budget) || 0), 0);
                const sym = settingsQ.data?.currency_symbol ?? "CHF";
                sections.push(
                  <div key="__ungrouped" className="space-y-1">
                    <div className="flex items-baseline justify-between pt-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("settings.ungrouped_envelopes")}</div>
                      <div className="text-xs tabular-nums text-muted-foreground">
                        Σ {fmtMoney(groupSum, sym)}
                      </div>
                    </div>
                    <ul className="divide-y">
                      {ungrouped.map((c, i) => renderRow(c, i, ungrouped))}
                    </ul>
                  </div>
                );
              }
              if (cats.length === 0) {
                return <p className="py-2 text-sm text-muted-foreground">{tr("settings.no_envelopes")}</p>;
              }
              return <div className="space-y-2">{sections}</div>;
            })()}
          </CardContent>
        </Card>
        </section>

        {/* Savings & Sweeps */}
        <section id="savings"><SavingsAndSweepsCard /></section>

        {/* Recurring rules */}
        <section id="recurring"><RecurringRulesCard /></section>

        {/* Scopes */}
        <section id="scopes">
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("scopes.title")}</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">{tr("scopes.subtitle")}</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/scopes">{tr("settings.scopes.link")}</Link>
            </Button>
          </CardContent>
        </Card>
        </section>

        {/* Accounts */}
        <section id="accounts">
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("settings.accounts")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-[minmax(180px,1fr)_140px_140px_120px_auto]">
              <div className="md:col-span-2 lg:col-span-1"><Label className="mb-1 block text-xs text-muted-foreground">{tr("common.name")}</Label><Input value={aName} onChange={(e) => setAName(e.target.value)} placeholder="Main Bank" /></div>
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
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">{tr("settings.currency")}</Label>
                <Select value={aCurrency || (settingsQ.data?.currency_code ?? "CHF")} onValueChange={setACurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end"><Button className="w-full" onClick={addAccount}><Plus className="h-4 w-4" /> {tr("common.add")}</Button></div>
            </div>
            <p className="text-xs text-muted-foreground">{tr("settings.accounts.asset_hint")}</p>
            <p className="text-xs text-muted-foreground">{tr("settings.accounts.opening_balance_hint")}</p>

            <ul className="divide-y">
              {(accountsQ.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <EntityChip entity={{ id: a.id, name: a.name, icon: a.icon, emoji: a.emoji, image_url: a.image_url, color: a.color }} showLabel={false} />
                    <div className="min-w-0">
                      <div className={a.archived ? "text-muted-foreground line-through" : "font-medium"}>{a.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.type === "asset" ? tr("settings.account_asset") : tr("settings.account_liability")} · {a.currency_code} · {tr("settings.opening_balance")} {Number(a.opening_balance).toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Select value={a.currency_code} onValueChange={(v) => updateAccountCurrency(a.id, v)}>
                      <SelectTrigger className="h-8 w-[78px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
                      </SelectContent>
                    </Select>
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
                    <Button variant="ghost" size="icon" onClick={() => openEditAccount(a)} aria-label={tr("settings.edit_account")}>
                      <Pencil className="h-4 w-4" />
                    </Button>
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
        </section>

        <Dialog open={!!editAccount} onOpenChange={(o) => { if (!o) setEditAccount(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tr("settings.edit_account")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">{tr("common.name")}</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">{tr("settings.opening_balance")}</Label>
                <Input inputMode="decimal" value={editOpening} onChange={(e) => setEditOpening(e.target.value)} />
              </div>
              {openingChanged && (
                <div className="flex gap-2 rounded-md border border-warning/60 bg-warning/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <p>{tr("settings.opening_balance.warning")}</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditAccount(null)}>{tr("common.cancel")}</Button>
              <Button onClick={saveEditAccount}>{tr("common.save")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <section id="nextcloud"><NextcloudCard /></section>
        <section id="api-tokens"><ApiTokensCard /></section>
        <section id="webhooks"><WebhooksCard /></section>
       <section id="ai"><AISettingsCard /></section>
        <section id="ai-audit"><AIAuditLogCard /></section>
        <section id="integrations"><IntegrationsCard /></section>
        <section id="audit"><AuditLogCard /></section>
        <section id="account"><AccountCard /></section>
        </div>
      </div>
    </AppShell>
  );
}

function AccountCard() {
  const { t } = useI18n();
  const { user, signOut } = useAuth();
  const isAdminQ = useIsAdmin();
  if (!user) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("settings.account")}</CardTitle></CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <div className="text-sm">
          <div className="text-muted-foreground">{t("settings.you")}</div>
          <div className="font-medium">{user.email}</div>
          <div className="text-xs text-muted-foreground">
            {isAdminQ.data ? t("settings.role.admin") : t("settings.role.user")}
          </div>
        </div>
        <Button variant="outline" onClick={signOut}>
          <LogOut className="h-4 w-4" /> {t("auth.signout")}
        </Button>
      </CardContent>
    </Card>
  );
}

function IntegrationsCard() {
  const { t } = useI18n();
  const isAdminQ = useIsAdmin();
  const qc = useQueryClient();
  const providersQ = useRQ({
    queryKey: ["auth_providers_admin"],
    enabled: !!isAdminQ.data,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auth_providers")
        .select("id, provider, display_name, enabled, client_id, discovery_url")
        .order("provider");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isAdminQ.isLoading) return null;
  if (!isAdminQ.data) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">{t("settings.integrations")}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t("settings.integrations.admin_only")}</CardContent>
      </Card>
    );
  }

  const update = async (id: string, patch: { enabled?: boolean; client_id?: string | null; discovery_url?: string | null }) => {
    const { error } = await supabase.from("auth_providers").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["auth_providers_admin"] });
    qc.invalidateQueries({ queryKey: ["auth_providers_enabled"] });
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("settings.integrations")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {(providersQ.data ?? []).map((p) => (
          <div key={p.id} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">{p.display_name ?? p.provider}</div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`en-${p.id}`} className="text-xs">{t("settings.integrations.enabled")}</Label>
                <Switch id={`en-${p.id}`} checked={p.enabled} onCheckedChange={(v) => update(p.id, { enabled: v })} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div>
                <Label className="text-xs">{t("settings.integrations.client_id")}</Label>
                <Input
                  defaultValue={p.client_id ?? ""}
                  onBlur={(e) => e.currentTarget.value !== (p.client_id ?? "") && update(p.id, { client_id: e.currentTarget.value || null })}
                />
              </div>
              {p.provider === "keycloak" && (
                <div>
                  <Label className="text-xs">{t("settings.integrations.discovery")}</Label>
                  <Input
                    defaultValue={p.discovery_url ?? ""}
                    onBlur={(e) => e.currentTarget.value !== (p.discovery_url ?? "") && update(p.id, { discovery_url: e.currentTarget.value || null })}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">{t("settings.integrations.hint")}</p>
      </CardContent>
    </Card>
  );
}
