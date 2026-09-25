import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, ArchiveRestore, Archive, Pin, PinOff, Palette, ChevronUp, ChevronDown, Pencil, AlertTriangle } from "lucide-react";
import { format, startOfMonth } from "date-fns";

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
import { cn } from "@/lib/utils";
import {
  fetchAccounts, fetchCategories, fetchCategoryGroups, fetchCategoryMonthRows, fetchSettings,
  monthKey, setCategoryOpeningBalance,
  type AccountType, type GroupKind,
} from "@/lib/finance";
import { BudgetEditPopover } from "@/components/BudgetEditPopover";
import { MonthNavigator } from "@/components/MonthNavigator";
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
import { providerLabel } from "@/lib/authProviders";
import { Switch } from "@/components/ui/switch";
import { useQuery as useRQ } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { SettingsSectionNav, type SettingsSection } from "@/components/SettingsSectionNav";
import { formatVersion } from "@/lib/version";
import { AISettingsCard } from "@/components/AISettingsCard";
import { AIAuditLogCard } from "@/components/AIAuditLogCard";
import { LinkedAccountsCard } from "@/components/LinkedAccountsCard";
import { SignInProvidersCard } from "@/components/SignInProvidersCard";

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

  // The envelope list edits one month at a time, the same way /envelopes does. Showing
  // `categories.allocated_budget` here was a quiet lie: that column is the template used
  // to seed a month with no prior row, and the month in front of you may well differ.
  const [budgetMonth, setBudgetMonth] = React.useState(() => startOfMonth(new Date()));
  const budgetMonthKey = monthKey(budgetMonth);
  const monthRowsQ = useQuery({
    queryKey: ["category_month_rows", budgetMonthKey],
    queryFn: () => fetchCategoryMonthRows(budgetMonthKey),
  });
  const budgetByCategory = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of monthRowsQ.data ?? []) map.set(r.category_id, Number(r.allocated));
    return map;
  }, [monthRowsQ.data]);
  const budgetFor = React.useCallback(
    (c: { id: string; allocated_budget: number | string }) =>
      budgetByCategory.get(c.id) ?? Number(c.allocated_budget),
    [budgetByCategory],
  );

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
  const [cRollsOver, setCRollsOver] = React.useState(false);
  const addCategory = async () => {
    if (!cName.trim()) { toast.error(tr("toast.name_required")); return; }
    const sortOrder = (categoriesQ.data ?? []).length;
    const group = (groupsQ.data ?? []).find((g) => g.id === cGroupId);
    const rollsOver = cRollsOver || group?.kind === "savings";
    const { error } = await supabase.from("categories").insert({
      name: cName.trim(),
      allocated_budget: Number(cBudget) || 0,
      sort_order: sortOrder,
      group_id: cGroupId || null,
      rolls_over: rollsOver,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(tr("toast.envelope_added"));
    setCName(""); setCBudget("0"); setCGroupId(""); setCRollsOver(false);
    qc.invalidateQueries();
  };
  const updateCategoryGroup = async (id: string, groupId: string) => {
    const group = (groupsQ.data ?? []).find((g) => g.id === groupId);
    // Only auto-promote to savings when joining a savings-kind group;
    // never auto-clear rolls_over when changing/clearing the group, so
    // standalone savings envelopes stay savings.
    const patch: { group_id: string | null; rolls_over?: boolean } = {
      group_id: groupId || null,
    };
    if (group?.kind === "savings") patch.rolls_over = true;
    const { error } = await supabase.from("categories").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();
  };
  const toggleArchiveCategory = async (id: string, archived: boolean) => {
    const { error } = await supabase.from("categories").update({ archived: !archived }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();
  };
  const updateOpeningBalance = async (id: string, raw: string) => {
    const v = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(v)) return toast.error(tr("settings.opening_balance.invalid"));
    try {
      await setCategoryOpeningBalance(id, v);
      qc.invalidateQueries();
    } catch (e) { toast.error((e as Error).message); }
  };
  const toggleCategoryRollsOver = async (id: string, rollsOver: boolean) => {
    const next = !rollsOver;
    // Rolling and non-rolling envelopes are both allocated monthly; the flag
    // only decides what happens to the remainder. Deleting the budget rows here
    // used to throw away the very allocations the envelope lives on.
    const { error } = await supabase.from("categories").update({ rolls_over: next }).eq("id", id);
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
    <AppShell wide>
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_220px] xl:gap-8">
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
            { id: "linked", label: tr("linked.title") },
            { id: "audit", label: tr("audit.title") },
            { id: "account", label: tr("settings.account") },
            { id: "about", label: tr("settings.about") },
          ] satisfies SettingsSection[]}
        />
        <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-1 [&>section]:scroll-mt-24">
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

        {/* Location capture */}
        <section id="location">
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("loc.settings.title")}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="capture-location" className="text-sm">{tr("loc.settings.toggle")}</Label>
                <p className="text-xs text-muted-foreground">{tr("loc.settings.hint")}</p>
              </div>
              <Switch
                id="capture-location"
                checked={!!settingsQ.data?.capture_location}
                onCheckedChange={async (checked) => {
                  if (!settingsQ.data) return;
                  const { error } = await supabase
                    .from("settings")
                    .update({ capture_location: checked })
                    .eq("id", settingsQ.data.id);
                  if (error) { toast.error(error.message); return; }
                  qc.invalidateQueries({ queryKey: ["settings"] });
                }}
              />
            </div>
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
          <CardContent className="@container/env space-y-4">
            <MonthNavigator month={budgetMonth} onChange={setBudgetMonth} locale={locale} />
            <BudgetBalanceCard
              categories={categoriesQ.data ?? []}
              groups={groupsQ.data ?? []}
              symbol={settingsQ.data?.currency_symbol ?? "CHF"}
              amounts={budgetByCategory}
            />
            <div className="grid gap-2 @2xl/env:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
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
                    if (g) setCRollsOver(g.kind === "savings");
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
                <Input inputMode="decimal" value={cBudget} onChange={(e) => setCBudget(e.target.value)} placeholder={cRollsOver ? tr("settings.savings_target_hint") : undefined} />
              </div>
              <div className="flex items-end"><Button className="w-full" onClick={addCategory}><Plus className="h-4 w-4" /> {tr("common.add")}</Button></div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Switch id="new-cat-savings" checked={cRollsOver} onCheckedChange={setCRollsOver} />
              <Label htmlFor="new-cat-savings" className="cursor-pointer">{tr("settings.savings_envelope")}</Label>
              <span className="text-xs text-muted-foreground">{tr("settings.savings_envelope_hint")}</span>
            </div>

            {(() => {
              // Scopes are envelopes too, but they belong to /scopes: they are
              // funded on close and take no part in the monthly plan, so they
              // would only inflate the group sums and the balance card above.
              const cats = (categoriesQ.data ?? []).filter((c) => !c.is_scope);
              const grps = groupsQ.data ?? [];
              // The books only close once every franc the accounts started with
              // belongs to an envelope, so show the assignment running down.
              const accountOpenings = (accountsQ.data ?? [])
                .filter((a) => !a.archived)
                .reduce((sum, a) => sum + Number(a.opening_balance ?? 0), 0);
              const assignedOpenings = (categoriesQ.data ?? [])
                .filter((c) => c.rolls_over && !c.is_scope)
                .reduce((sum, c) => sum + Number(c.opening_balance ?? 0), 0);
              const openingsLeft = accountOpenings - assignedOpenings;
              const curSymbol = settingsQ.data?.currency_symbol ?? "CHF";
              // Rows lay out against the *card* width (container query), not the
              // viewport — the settings column is much narrower than the screen.
              const renderRow = (c: typeof cats[number], idx: number, arr: typeof cats) => (
                <li key={c.id} className="flex flex-col gap-2 py-2 @2xl/env:flex-row @2xl/env:items-center @2xl/env:justify-between">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
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
                      <div className="break-words font-medium">{c.name}</div>
                      {c.rolls_over && <div className="text-[10px] font-semibold uppercase text-muted-foreground">{tr("add.savings_badge")}</div>}
                      {(() => {
                        const g = (groupsQ.data ?? []).find((x) => x.id === c.group_id);
                        if (!g) return null;
                        const diverges = (g.kind === "savings") !== c.rolls_over;
                        if (!diverges) return null;
                        return (
                          <div className="text-[10px] text-warning" title={tr("settings.behaviour_diverges")}>⚠ {tr("settings.behaviour_diverges")}</div>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 @2xl/env:flex-nowrap @2xl/env:justify-end">
                    <Select value={c.group_id ?? "__none"} onValueChange={(v) => updateCategoryGroup(c.id, v === "__none" ? "" : v)}>
                      <SelectTrigger className="w-36 shrink-0 @2xl/env:w-40"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{tr("common.none")}</SelectItem>
                        {grps.map((g) => (
                          <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1" title={tr("settings.savings_envelope")}>
                      <Switch checked={c.rolls_over} onCheckedChange={() => toggleCategoryRollsOver(c.id, c.rolls_over)} aria-label={tr("settings.savings_envelope")} />
                    </div>
                    <BudgetEditPopover
                      categoryId={c.id}
                      categoryName={c.name}
                      month={budgetMonth}
                      amount={budgetFor(c)}
                      locale={locale}
                    >
                      <Button
                        variant="outline"
                        className="w-24 shrink-0 justify-end text-right font-normal tabular-nums @2xl/env:w-28"
                        title={tr("settings.monthly_budget")}
                      >
                        {fmtMoney(budgetFor(c), settingsQ.data?.currency_symbol ?? "CHF")}
                      </Button>
                    </BudgetEditPopover>
                    {/* Only rolling envelopes carry money across months, so an
                        opening balance is meaningless anywhere else. */}
                    {c.rolls_over ? (
                      <Input
                        key={`${c.id}-opening-${c.opening_balance ?? 0}`}
                        defaultValue={Number(c.opening_balance ?? 0).toString()}
                        inputMode="decimal"
                        className="w-24 shrink-0 text-right tabular-nums @2xl/env:w-28"
                        onBlur={(e) => updateOpeningBalance(c.id, e.target.value)}
                        title={tr("settings.opening_balance")}
                      />
                    ) : (
                      <div className="w-24 shrink-0 @2xl/env:w-28" />
                    )}
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
              return (
                <div className="space-y-2">
                  {accountOpenings !== 0 && (
                    <p className={cn(
                      "rounded-md border px-2 py-1.5 text-xs tabular-nums",
                      Math.abs(openingsLeft) < 0.005 ? "text-muted-foreground" : "border-warning/50 bg-warning/10",
                    )}>
                      {tr("settings.opening_balance.assigned", {
                        assigned: fmtMoney(assignedOpenings, curSymbol),
                        total: fmtMoney(accountOpenings, curSymbol),
                        left: fmtMoney(openingsLeft, curSymbol),
                      })}
                    </p>
                  )}
                  {/* Column headings. Only once the row lays out horizontally — below
                      that the row stacks and the labels would not line up with
                      anything. Widths mirror renderRow exactly. */}
                  <div className="hidden items-center justify-between gap-2 border-b pb-1 text-xs font-medium text-muted-foreground @2xl/env:flex">
                    <div className="min-w-0 flex-1">{tr("settings.col.envelope")}</div>
                    <div className="flex flex-nowrap items-center justify-end gap-2">
                      <div className="w-40 shrink-0">{tr("settings.col.group")}</div>
                      <div className="w-9 shrink-0 truncate text-center" title={tr("settings.savings_envelope")}>
                        {tr("settings.col.rolls_over")}
                      </div>
                      <div className="w-28 shrink-0 truncate text-right">{tr("settings.monthly_budget")}</div>
                      <div className="w-28 shrink-0 truncate text-right">{tr("settings.opening_balance")}</div>
                      <div className="w-[168px] shrink-0" aria-hidden />
                    </div>
                  </div>
                  {sections}
                </div>
              );
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
        <section id="integrations"><SignInProvidersCard /></section>
        <section id="linked"><LinkedAccountsCard /></section>
        <section id="audit"><AuditLogCard /></section>
        <section id="account"><AccountCard /></section>
        <section id="about"><AboutCard /></section>
        </div>
      </div>
    </AppShell>
  );
}

function AboutCard() {
  const { t } = useI18n();
  const serverQ = useRQ({
    queryKey: ["app-version"],
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/public/version");
      if (!res.ok) throw new Error("version unavailable");
      return (await res.json()) as {
        version: string; commit: string; commitShort: string; builtAt: string | null;
      };
    },
  });
  const server = serverQ.data;
  const rows: Array<[string, string]> = [
    [t("settings.about.client"), formatVersion()],
    [
      t("settings.about.server"),
      server ? formatVersion(server.version, server.commitShort) : serverQ.isError ? "—" : "…",
    ],
  ];
  if (server?.builtAt) rows.push([t("settings.about.built_at"), server.builtAt]);
  const copyText = `client ${formatVersion()}${server ? ` · server ${formatVersion(server.version, server.commitShort)}` : ""}`;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("settings.about")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-1 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-mono">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard?.writeText(copyText);
              toast.success(t("toast.copied"));
            }}
          >
            {t("settings.about.copy")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.about.hint")}</p>
      </CardContent>
    </Card>
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

