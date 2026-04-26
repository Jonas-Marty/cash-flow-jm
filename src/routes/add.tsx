import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, ArrowLeftRight } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fetchAccounts, fetchCategories, fetchCategoryGroups, fetchSettings, fetchTransactions, extractTags, type TxType } from "@/lib/finance";
import { useI18n } from "@/i18n";
import { useSuggestions } from "@/lib/suggestions/useSuggestions";
import type { Suggestion } from "@/lib/suggestions/types";
import { SuggestionRow } from "@/components/SuggestionRow";
import { QuickAmountChips } from "@/components/QuickAmountChips";
import { TagChips } from "@/components/TagChips";
import { DateShortcuts } from "@/components/DateShortcuts";
import { ChipPicker, type ChipPickerItem } from "@/components/ChipPicker";
import { scoreAccounts, scoreCategories, sortByPinAndScore } from "@/lib/usageScoring";
import { DayHeatmapCalendar } from "@/components/DayHeatmapCalendar";
import { DateInput } from "@/components/DateInput";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { DescriptionAutocomplete } from "@/components/DescriptionAutocomplete";

export const Route = createFileRoute("/add")({
  component: AddTransaction,
});

function AddTransaction() {
  const { t: tr, locale, lang } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const groupsQ = useQuery({ queryKey: ["category_groups"], queryFn: fetchCategoryGroups });
  const recentQ = useQuery({ queryKey: ["transactions", "recent", 200], queryFn: () => fetchTransactions(200) });
  const ruleTxIdsQ = useQuery({
    queryKey: ["recurring_occurrences", "posted_tx_ids"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_occurrences")
        .select("transaction_id")
        .not("transaction_id", "is", null);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.transaction_id as string));
    },
  });

  const accounts = (accountsQ.data ?? []).filter((a) => !a.archived);
  const categories = (categoriesQ.data ?? []).filter((c) => !c.archived);
  const groupKindById = new Map((groupsQ.data ?? []).map((g) => [g.id, g.kind]));
  const symbol = settingsQ.data?.currency_symbol ?? "CHF";

  // Sorted account/category chips: pinned first, then recency-weighted usage
  const accountChips: ChipPickerItem[] = React.useMemo(() => {
    const scores = scoreAccounts(recentQ.data ?? []);
    return sortByPinAndScore(accounts, scores).map((a) => ({
      id: a.id, name: a.name,
      icon: a.icon, emoji: a.emoji, image_url: a.image_url, color: a.color,
      pinned: a.pinned,
    }));
  }, [accounts, recentQ.data]);
  const categoryChips: ChipPickerItem[] = React.useMemo(() => {
    const scores = scoreCategories(recentQ.data ?? []);
    return sortByPinAndScore(categories, scores).map((c) => ({
      id: c.id, name: c.name,
      icon: c.icon, emoji: c.emoji, image_url: c.image_url, color: c.color,
      pinned: c.pinned,
    }));
  }, [categories, recentQ.data]);

  const [type, setType] = React.useState<TxType>("expense");
  const [amount, setAmount] = React.useState("");
  const [sourceId, setSourceId] = React.useState<string>("");
  const [destId, setDestId] = React.useState<string>("");
  const [categoryId, setCategoryId] = React.useState<string>("");
  const [description, setDescription] = React.useState("");
  const [note, setNote] = React.useState("");
  const [date, setDate] = React.useState<Date>(new Date());
  const [saving, setSaving] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const amountRef = React.useRef<HTMLInputElement>(null);

  // Track which fields the user has explicitly touched, so suggestion-apply
  // in "sticky" mode doesn't overwrite their input.
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const mark = (k: string) => setTouched((p) => (p[k] ? p : { ...p, [k]: true }));

  const [appliedFrom, setAppliedFrom] = React.useState<null | {
    suggestion: Suggestion;
    prev: { amount: string; description: string; note: string; sourceId: string; categoryId: string };
  }>(null);

  // Default source = most-used account in recent transactions
  React.useEffect(() => {
    if (sourceId || accounts.length === 0) return;
    const counts = new Map<string, number>();
    (recentQ.data ?? []).forEach((t) => counts.set(t.source_account_id, (counts.get(t.source_account_id) ?? 0) + 1));
    let best = accounts[0]?.id;
    let bestN = -1;
    for (const a of accounts) {
      const n = counts.get(a.id) ?? 0;
      if (n > bestN) { bestN = n; best = a.id; }
    }
    if (best) setSourceId(best);
  }, [accounts, recentQ.data, sourceId]);

  const tags = extractTags(note);

  const amountNum = React.useMemo(() => {
    const n = Number(amount.replace(",", "."));
    return isFinite(n) && n > 0 ? n : null;
  }, [amount]);

  const { suggestions } = useSuggestions({
    type,
    amount,
    amountNum,
    description,
    note,
    sourceId,
    categoryId,
    date,
    recentTransactions: recentQ.data ?? [],
    accounts,
    categories,
  });

  const applySuggestion = (s: Suggestion, mode: "sticky" | "all") => {
    const prev = { amount, description, note, sourceId, categoryId };
    const d = s.draft;
    const shouldSet = (key: string, val: unknown) => {
      if (val == null || val === "") return false;
      if (mode === "all") return true;
      return !touched[key];
    };
    if (d.amount != null && shouldSet("amount", d.amount)) setAmount(d.amount.toFixed(2));
    if (shouldSet("description", d.description)) setDescription(d.description ?? "");
    if (shouldSet("note", d.note)) setNote(d.note ?? "");
    if (shouldSet("sourceId", d.source_account_id)) setSourceId(d.source_account_id ?? "");
    if (d.category_id !== undefined && shouldSet("categoryId", d.category_id)) {
      setCategoryId(d.category_id ?? "");
    }
    setAppliedFrom({ suggestion: s, prev });
  };

  const undoApply = () => {
    if (!appliedFrom) return;
    const p = appliedFrom.prev;
    setAmount(p.amount); setDescription(p.description); setNote(p.note);
    setSourceId(p.sourceId); setCategoryId(p.categoryId);
    setAppliedFrom(null);
  };

  const appendTag = (tag: string) => {
    const present = new Set(extractTags(note));
    if (present.has(tag)) return;
    const sep = note.length === 0 || note.endsWith(" ") ? "" : " ";
    setNote(note + sep + "#" + tag);
    mark("note");
  };

  const reset = () => {
    setAmount(""); setDescription(""); setNote(""); setCategoryId("");
    setDate(new Date());
    setTouched({});
    setAppliedFrom(null);
    setTimeout(() => amountRef.current?.focus(), 0);
  };

  const save = async (andNew: boolean) => {
    const amt = Number(amount.replace(",", "."));
    if (!amt || amt <= 0) { toast.error(tr("toast.amount_required")); return; }
    if (!sourceId) { toast.error(tr("toast.account_required")); return; }
    if (type === "transfer" && !destId) { toast.error(tr("toast.dest_required")); return; }
    if (type === "transfer" && destId === sourceId) { toast.error(tr("toast.dest_must_differ")); return; }

    setSaving(true);
    const payload = {
      occurred_on: format(date, "yyyy-MM-dd"),
      amount: amt,
      description: description.trim() || null,
      note: note.trim() || null,
      type,
      source_account_id: sourceId,
      destination_account_id: type === "transfer" ? destId : null,
      category_id: type === "transfer" ? null : (categoryId || null),
    };
    const { error } = await supabase.from("transactions").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(tr("toast.saved"));
    qc.invalidateQueries();
    if (andNew) reset(); else navigate({ to: "/" });
  };

  // Global keyboard shortcuts
  const saveRef = React.useRef(save);
  saveRef.current = save;
  const applyRef = React.useRef(applySuggestion);
  applyRef.current = applySuggestion;
  const suggestionsRef = React.useRef(suggestions);
  suggestionsRef.current = suggestions;

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      const tag = target?.tagName;
      const mod = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd+Enter — save (Shift = save & new)
      if (mod && e.key === "Enter") {
        e.preventDefault();
        saveRef.current(e.shiftKey);
        return;
      }
      // Alt+1/2/3 — switch type
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === "1") { e.preventDefault(); setType("expense"); return; }
        if (e.key === "2") { e.preventDefault(); setType("income"); return; }
        if (e.key === "3") { e.preventDefault(); setType("transfer"); return; }
        // Alt+0 → use-all from best suggestion
        if (e.key === "0") {
          const best = suggestionsRef.current[0];
          if (best) { e.preventDefault(); applyRef.current(best, "all"); }
          return;
        }
        // Alt+1..9 already handled above for 1/2/3 (type switch wins by design).
        // For 4..9, apply Nth suggestion (sticky).
        const n = Number(e.key);
        if (n >= 4 && n <= 9) {
          const s = suggestionsRef.current[n - 1];
          if (s) { e.preventDefault(); applyRef.current(s, "sticky"); }
          return;
        }
      }
      // "?" → help (only when not editing text)
      if (e.key === "?" && !inEditable) {
        e.preventDefault();
        setHelpOpen((o) => !o);
        return;
      }
      // "Escape" — close help if open
      if (e.key === "Escape" && helpOpen) {
        setHelpOpen(false);
      }
      // Suppress unused warnings
      void tag;
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [helpOpen]);

  const shortcutRows = React.useMemo(() => [
    { keys: "Ctrl+Enter / Cmd+Enter", label: tr("kbd.save") },
    { keys: "Ctrl+Shift+Enter / Cmd+Shift+Enter", label: tr("kbd.save_new") },
    { keys: "Alt+1", label: tr("kbd.expense") },
    { keys: "Alt+2", label: tr("kbd.income") },
    { keys: "Alt+3", label: tr("kbd.transfer") },
    { keys: "Alt+0", label: tr("kbd.suggest_all") },
    { keys: "Alt+4 … Alt+9", label: tr("kbd.suggestion", { n: "N" }) },
    { keys: "← → ↑ ↓", label: tr("kbd.picker_arrows") },
    { keys: "/ / Ctrl+K", label: tr("kbd.picker_search") },
    { keys: "+ / -", label: tr("kbd.date_step_day") },
    { keys: "PgUp / PgDn", label: tr("kbd.date_step_month") },
    { keys: "?", label: tr("kbd.help") },
  ], [tr]);

  const typeBtn = (t: TxType, label: string, Icon: typeof ArrowDown) => (
    <button
      type="button"
      onClick={() => setType(t)}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        type === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );

  return (
    <AppShell>
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">{tr("add.title")}</h1>

        {/* Type segmented control */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {typeBtn("expense", tr("add.expense"), ArrowDown)}
          {typeBtn("income", tr("add.income"), ArrowUp)}
          {typeBtn("transfer", tr("add.transfer"), ArrowLeftRight)}
        </div>

        {/* Big amount */}
        <Card>
          <CardContent className="py-6">
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{symbol}</div>
              <Input
                inputMode="decimal"
                autoFocus
                ref={amountRef}
                placeholder="0.00"
                value={amount}
                onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.,]/g, "")); mark("amount"); }}
                className={cn(
                  "mt-1 h-auto border-0 bg-transparent p-0 text-center text-5xl font-bold tabular-nums shadow-none focus-visible:ring-0",
                  type === "expense" && "text-destructive",
                  type === "income" && "text-success",
                )}
              />
              <QuickAmountChips
                className="mt-3 justify-center"
                transactions={recentQ.data ?? []}
                type={type}
                symbol={symbol}
                onPick={(a) => { setAmount(a); mark("amount"); }}
                excludeTransactionIds={ruleTxIdsQ.data}
              />
            </div>
          </CardContent>
        </Card>

        {/* Smart suggestions — reserve space to avoid layout jumps */}
        <div className="space-y-2">
          <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {tr("add.suggestions")}
          </div>
          <div className="h-[120px]">
            {suggestions.length > 0 ? (
              <SuggestionRow
                suggestions={suggestions}
                symbol={symbol}
                applyAllLabel={tr("add.suggest.use_all")}
                onApply={applySuggestion}
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border/60 px-3 text-center text-xs text-muted-foreground">
                {tr("add.suggest.empty")}
              </div>
            )}
          </div>
          {appliedFrom && (
            <div className="flex items-center justify-between rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
              <span>{tr("add.suggest.applied")}</span>
              <button type="button" onClick={undoApply} className="text-primary underline-offset-2 hover:underline">
                {tr("add.suggest.undo")}
              </button>
            </div>
          )}
        </div>

        {/* Account(s) */}
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block">{type === "transfer" ? tr("add.from_account") : tr("add.account")}</Label>
            <ChipPicker
              items={accountChips}
              value={sourceId || null}
              onChange={(v) => { setSourceId(v); mark("sourceId"); }}
              placeholder={accounts.length ? tr("add.account") : tr("add.no_accounts")}
              moreLabel={tr("picker.more")}
              searchPlaceholder={tr("picker.search")}
              emptyLabel={tr("picker.no_match")}
            />
            {accounts.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                <Link to="/settings" className="text-primary underline-offset-2 hover:underline">{tr("add.create_first_account")}</Link>
              </p>
            )}
          </div>

          {type === "transfer" && (
            <div>
              <Label className="mb-1.5 block">{tr("add.to_account")}</Label>
              <ChipPicker
                items={accountChips}
                value={destId || null}
                onChange={setDestId}
                disabledIds={sourceId ? [sourceId] : []}
                placeholder={tr("add.to_account")}
                moreLabel={tr("picker.more")}
                searchPlaceholder={tr("picker.search")}
                emptyLabel={tr("picker.no_match")}
              />
            </div>
          )}

          {type !== "transfer" && (
            <div>
              <Label className="mb-1.5 block">
                {tr("add.category")} {type === "income" && <span className="text-xs font-normal text-muted-foreground">{tr("add.category_optional_reimb")}</span>}
              </Label>
              <ChipPicker
                items={categoryChips}
                value={categoryId || null}
                onChange={(v) => { setCategoryId(v); mark("categoryId"); }}
                allowClear
                clearLabel={tr("common.none")}
                placeholder={tr("add.select_category")}
                moreLabel={tr("picker.more")}
                searchPlaceholder={tr("picker.search")}
                emptyLabel={tr("picker.no_match")}
              />
              {type === "income" && categoryId && (() => {
                const c = categories.find((x) => x.id === categoryId);
                if (!c) return null;
                const kind = c.group_id ? groupKindById.get(c.group_id) : undefined;
                const isSavings = c.is_savings || kind === "savings";
                if (kind !== "expense" && !isSavings) return null;
                return (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {tr(isSavings ? "add.reimbursement_hint.savings" : "add.reimbursement_hint")}
                  </p>
                );
              })()}
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="description" className="mb-1.5 block">{tr("add.description")}</Label>
          <DescriptionAutocomplete
            id="description"
            value={description}
            onChange={(v) => { setDescription(v); mark("description"); }}
            transactions={recentQ.data ?? []}
            placeholder={type === "transfer" ? tr("common.optional") : tr("add.payee_placeholder")}
          />
        </div>

        <div>
          <Label htmlFor="note" className="mb-1.5 block">{tr("add.note")}</Label>
          <Textarea id="note" rows={2} value={note} onChange={(e) => { setNote(e.target.value); mark("note"); }} placeholder={tr("add.note_placeholder")} />
          <TagChips
            className="mt-2"
            transactions={recentQ.data ?? []}
            currentNote={note}
            onAppend={appendTag}
          />
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">#{t}</span>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <Label htmlFor="date-input">{tr("add.date")}</Label>
          </div>
          <DateShortcuts
            className="mb-2"
            selected={date}
            onPick={setDate}
            locale={locale}
            labels={{
              today: tr("add.date.today"),
              yesterday: tr("add.date.yesterday"),
              last_prefix: tr("add.date.last_prefix"),
            }}
          />
          <DateInput
            id="date-input"
            value={date}
            onChange={setDate}
            formatStr={settingsQ.data?.date_format}
            lang={lang}
            locale={locale}
            className="mb-2 hidden w-full md:block"
          />
          <DayHeatmapCalendar
            selected={date}
            onSelect={setDate}
            transactions={recentQ.data ?? []}
            accounts={accounts}
            categories={categories}
            threshold={Number(settingsQ.data?.day_heatmap_threshold ?? 100)}
            symbol={symbol}
            locale={locale}
            labels={{
              title: tr("add.day_preview.title"),
              empty: tr("add.day_preview.empty"),
              net: tr("add.day_preview.net"),
            }}
          />
          <p className="mt-1 text-xs text-muted-foreground md:hidden">{tr("add.day_preview.long_press_hint")}</p>
          <p className="mt-1 hidden text-xs text-muted-foreground md:block">
            {tr("add.date_input_hint", { fmt: settingsQ.data?.date_format ?? "dd.MM.yyyy" })}
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" disabled={saving} onClick={() => save(true)}>{tr("add.save_new")}</Button>
          <Button className="flex-1" disabled={saving} onClick={() => save(false)}>{saving ? tr("common.saving") : tr("common.save")}</Button>
        </div>

        <ShortcutsDialog
          open={helpOpen}
          onOpenChange={setHelpOpen}
          title={tr("kbd.title")}
          rows={shortcutRows}
        />
      </div>
    </AppShell>
  );
}
