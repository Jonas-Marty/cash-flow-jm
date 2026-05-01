import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { ArrowDown, ArrowUp, ArrowLeftRight, Plus, X } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fetchAccounts, fetchCategories, fetchCategoryGroups, fetchSettings, fetchTransactions, extractTags, fmtMoney, type TxType, type Transaction } from "@/lib/finance";
import { EntityVisual } from "@/components/EntityVisual";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/i18n";
import { useSuggestions } from "@/lib/suggestions/useSuggestions";
import type { Suggestion } from "@/lib/suggestions/types";
import { SuggestionRow } from "@/components/SuggestionRow";
import { QuickAmountChips } from "@/components/QuickAmountChips";
import { TagChips } from "@/components/TagChips";
import { TagAutocompleteTextarea } from "@/components/TagAutocompleteTextarea";
import { DateShortcuts } from "@/components/DateShortcuts";
import { ChipPicker, type ChipPickerItem } from "@/components/ChipPicker";
import { scoreAccounts, scoreCategories, sortByPinAndScore } from "@/lib/usageScoring";
import { DayHeatmapCalendar } from "@/components/DayHeatmapCalendar";
import { DateInput } from "@/components/DateInput";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { DescriptionAutocomplete } from "@/components/DescriptionAutocomplete";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { useFxRates, convert } from "@/lib/fx";

export const Route = createFileRoute("/add")({
  component: AddTransactionRoute,
});

function AddTransactionRoute() {
  return <TransactionForm editId={null} />;
}

export function TransactionForm({ editId }: { editId: string | null }) {
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
  const mainSymbol = settingsQ.data?.currency_symbol ?? "CHF";
  const accountById = React.useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

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

  // Cross-currency dual-amount field: when source/dest currencies differ on
  // a transfer, the user enters the amount that actually arrived in the
  // destination account (e.g. EUR cash dispensed from a CHF bank withdrawal).
  const [destAmount, setDestAmount] = React.useState("");
  const [destAmountTouched, setDestAmountTouched] = React.useState(false);

  const sourceAccount = sourceId ? accountById.get(sourceId) : undefined;
  const destAccount = destId ? accountById.get(destId) : undefined;
  // For income/expense, the source field IS the account holding the money,
  // so the source-account symbol always governs the main amount input.
  const symbol = sourceAccount?.currency_symbol ?? mainSymbol;
  const destSymbol = destAccount?.currency_symbol ?? symbol;
  const isCrossCurrency =
    type === "transfer" &&
    !!sourceAccount &&
    !!destAccount &&
    sourceAccount.currency_code !== destAccount.currency_code;

  const fxQ = useFxRates(sourceAccount?.currency_code, isCrossCurrency);
  // Auto-suggest destination amount via live FX, but never overwrite a value
  // the user has already edited. Reset suggestion when accounts/amount change.
  React.useEffect(() => {
    if (!isCrossCurrency || destAmountTouched) return;
    const n = Number(amount.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      setDestAmount("");
      return;
    }
    const conv = convert(
      n,
      sourceAccount!.currency_code,
      destAccount!.currency_code,
      fxQ.data,
    );
    setDestAmount(conv != null ? conv.toFixed(2) : "");
  }, [isCrossCurrency, amount, sourceAccount, destAccount, fxQ.data, destAmountTouched]);
  // Reset cross-currency state when leaving transfer mode or matching currencies.
  React.useEffect(() => {
    if (!isCrossCurrency) {
      setDestAmount("");
      setDestAmountTouched(false);
    }
  }, [isCrossCurrency]);

  // ───────── Split mode (multi-item receipt) ─────────
  type Slice = { id: string; amount: string; categoryId: string; description: string; note: string };
  const newSlice = (): Slice => ({
    id: Math.random().toString(36).slice(2),
    amount: "",
    categoryId: "",
    description: "",
    note: "",
  });
  const [splitMode, setSplitMode] = React.useState(false);
  const [slices, setSlices] = React.useState<Slice[]>([newSlice(), newSlice()]);
  // Split mode is not allowed for transfers — clear it when switching.
  React.useEffect(() => {
    if (type === "transfer" && splitMode) setSplitMode(false);
  }, [type, splitMode]);
  const splitTotal = React.useMemo(
    () => slices.reduce((s, x) => s + (Number(x.amount.replace(",", ".")) || 0), 0),
    [slices],
  );
  const targetTotal = Number(amount.replace(",", ".")) || 0;
  const splitDiff = +(targetTotal - splitTotal).toFixed(2);

  // Track which fields the user has explicitly touched, so suggestion-apply
  // in "sticky" mode doesn't overwrite their input.
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const mark = (k: string) => setTouched((p) => (p[k] ? p : { ...p, [k]: true }));

  const [appliedFrom, setAppliedFrom] = React.useState<null | {
    suggestion: Suggestion;
    prev: { amount: string; description: string; note: string; sourceId: string; categoryId: string };
  }>(null);

  const isEdit = !!editId;

  // ───────── Edit mode: load the transaction (and split-group siblings) ─────────
  const editQ = useQuery({
    queryKey: ["transaction", "edit", editId],
    enabled: !!editId,
    queryFn: async () => {
      const { data: tx, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("id", editId!)
        .maybeSingle();
      if (error) throw error;
      if (!tx) throw new Error("Transaction not found");
      let group: Transaction[] | null = null;
      if (tx.split_group_id) {
        const { data: sib, error: sErr } = await supabase
          .from("transactions")
          .select("*")
          .eq("split_group_id", tx.split_group_id)
          .order("created_at", { ascending: true });
        if (sErr) throw sErr;
        group = (sib ?? []) as Transaction[];
      }
      return { tx: tx as Transaction, group };
    },
  });

  // Hydrate form once when edit data arrives.
  const hydratedRef = React.useRef(false);
  React.useEffect(() => {
    if (!isEdit || hydratedRef.current || !editQ.data) return;
    const { tx, group } = editQ.data;
    hydratedRef.current = true;
    setType(tx.type);
    setSourceId(tx.source_account_id);
    setDestId(tx.destination_account_id ?? "");
    setDate(new Date(tx.occurred_on + "T00:00:00"));
    if (group && group.length > 1) {
      // Edit a split group: amount = total, slices = group rows
      const total = group.reduce((s, x) => s + Number(x.amount), 0);
      setAmount(total.toFixed(2));
      setDescription("");
      setNote("");
      setSplitMode(true);
      setSlices(
        group.map((g) => ({
          id: g.id,
          amount: Number(g.amount).toFixed(2),
          categoryId: g.category_id ?? "",
          description: g.description ?? "",
          note: g.note ?? "",
        })),
      );
    } else {
      setAmount(Number(tx.amount).toFixed(2));
      setCategoryId(tx.category_id ?? "");
      setDescription(tx.description ?? "");
      setNote(tx.note ?? "");
      if (tx.destination_amount != null) {
        setDestAmount(Number(tx.destination_amount).toFixed(2));
        setDestAmountTouched(true);
      }
    }
    // mark all fields as touched so suggestions never overwrite loaded data
    setTouched({ amount: true, description: true, note: true, sourceId: true, categoryId: true });
  }, [isEdit, editQ.data]);

  // Default source = most-used account in recent transactions (skip in edit mode)
  React.useEffect(() => {
    if (isEdit) return;
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
  }, [accounts, recentQ.data, sourceId, isEdit]);

  const amountNum = React.useMemo(() => {
    const n = Number(amount.replace(",", "."));
    return isFinite(n) && n > 0 ? n : null;
  }, [amount]);

  // Duplicate-warning: same source account + same date + same amount.
  // For splits, compare against the per-slice amount (skip — too noisy).
  const duplicates = React.useMemo<Transaction[]>(() => {
    if (splitMode) return [];
    if (!sourceId || amountNum == null) return [];
    const dateStr = format(date, "yyyy-MM-dd");
    return (recentQ.data ?? []).filter((t) => {
      if (isEdit && editId && t.id === editId) return false;
      if (t.source_account_id !== sourceId) return false;
      if (t.occurred_on !== dateStr) return false;
      return Math.abs(Number(t.amount) - amountNum) < 0.005;
    });
  }, [splitMode, sourceId, amountNum, date, recentQ.data, isEdit, editId]);

  const categoryById = React.useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

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

  const removeTagFrom = (text: string, tag: string): string => {
    // Remove `#tag` tokens (case-insensitive on tag name, word-bounded by tag chars).
    const re = new RegExp(`(^|\\s)#${tag.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "gi");
    return text.replace(re, (_m, lead: string) => lead).replace(/[ \t]{2,}/g, " ").replace(/\s+$/g, "").replace(/^\s+/g, (s) => s);
  };
  const removeTag = (tag: string) => {
    setNote(removeTagFrom(note, tag));
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

    // Split path: insert N rows sharing a split_group_id
    if (splitMode && type !== "transfer") {
      if (slices.length < 2) { toast.error(tr("add.split.toast.min")); return; }
      const sharedNote = note.trim();
      const parsed = slices.map((s) => {
        const sliceNote = s.note.trim();
        const merged = [sharedNote, sliceNote].filter(Boolean).join(" ");
        return {
          id: s.id,
          amount: Number(s.amount.replace(",", ".")),
          categoryId: s.categoryId || null,
          description: s.description.trim() || null,
          note: merged || null,
        };
      });
      if (parsed.some((p) => !p.amount || p.amount <= 0)) { toast.error(tr("add.split.toast.amounts")); return; }

      setSaving(true);
      const occurred_on = format(date, "yyyy-MM-dd");
      if (isEdit && editQ.data?.tx.split_group_id) {
        // Update existing split group: replace rows (delete all then insert).
        const groupId = editQ.data.tx.split_group_id;
        const delRes = await supabase.from("transactions").delete().eq("split_group_id", groupId);
        if (delRes.error) { setSaving(false); toast.error(delRes.error.message); return; }
        const rows = parsed.map((p) => ({
          occurred_on,
          amount: p.amount,
          description: p.description,
          note: p.note,
          type,
          source_account_id: sourceId,
          destination_account_id: null,
          category_id: p.categoryId,
          split_group_id: groupId,
        }));
        const { error } = await supabase.from("transactions").insert(rows);
        setSaving(false);
        if (error) { toast.error(error.message); return; }
        toast.success(tr("toast.saved"));
        qc.invalidateQueries();
        navigate({ to: "/transactions" });
        return;
      }
      const groupId = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
      const rows = parsed.map((p) => ({
        occurred_on,
        amount: p.amount,
        description: p.description,
        note: p.note,
        type,
        source_account_id: sourceId,
        destination_account_id: null,
        category_id: p.categoryId,
        split_group_id: groupId,
      }));
      const { error } = await supabase.from("transactions").insert(rows);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success(tr("toast.saved"));
      qc.invalidateQueries();
      if (andNew) { setSplitMode(false); setSlices([newSlice(), newSlice()]); reset(); }
      else navigate({ to: "/" });
      return;
    }

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
      destination_amount:
        type === "transfer" && isCrossCurrency
          ? (() => {
              const dn = Number(destAmount.replace(",", "."));
              return Number.isFinite(dn) && dn > 0 ? dn : null;
            })()
          : null,
    };
    if (type === "transfer" && isCrossCurrency && payload.destination_amount == null) {
      setSaving(false);
      toast.error(tr("toast.dest_amount_required"));
      return;
    }
    if (isEdit && editId) {
      const { error } = await supabase.from("transactions").update(payload).eq("id", editId);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success(tr("toast.saved"));
      qc.invalidateQueries();
      navigate({ to: "/transactions" });
      return;
    }
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
        <h1 className="text-2xl font-semibold tracking-tight">{isEdit ? tr("edit.title") : tr("add.title")}</h1>
        {isEdit && editQ.isLoading && (
          <p className="text-sm text-muted-foreground">{tr("common.loading")}</p>
        )}
        {isEdit && editQ.isError && (
          <p className="text-sm text-destructive">{(editQ.error as Error)?.message ?? "Error"}</p>
        )}

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

        {/* Smart suggestions — reserve space to avoid layout jumps (hidden in edit mode) */}
        {!isEdit && <div className="space-y-2">
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
        </div>}

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
              {isCrossCurrency && (
                <div className="mt-3 rounded-md border border-dashed border-border/60 p-3">
                  <Label htmlFor="dest-amount" className="mb-1 block text-xs">
                    {tr("add.dest_amount.label", { sym: destSymbol })}
                  </Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {destSymbol}
                    </span>
                    <Input
                      id="dest-amount"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={destAmount}
                      onChange={(e) => {
                        setDestAmount(e.target.value.replace(/[^0-9.,]/g, ""));
                        setDestAmountTouched(true);
                      }}
                      className="tabular-nums"
                    />
                    {destAmountTouched && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={() => setDestAmountTouched(false)}
                      >
                        {tr("add.dest_amount.use_fx")}
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {fxQ.data
                      ? tr("add.dest_amount.hint_fx", {
                          from: sourceAccount!.currency_code,
                          to: destAccount!.currency_code,
                          date: fxQ.data.date,
                        })
                      : fxQ.isLoading
                        ? tr("add.dest_amount.hint_loading")
                        : tr("add.dest_amount.hint_offline")}
                  </p>
                </div>
              )}
            </div>
          )}

          {type !== "transfer" && !splitMode && (
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

        {/* Split toggle (only for expense/income, not transfer; hidden in edit mode) */}
        {type !== "transfer" && !isEdit && (
          <div className="flex items-center justify-between rounded-md border border-dashed border-border/60 px-3 py-2">
            <Label htmlFor="split-toggle" className="cursor-pointer text-sm font-normal">
              {tr("add.split.toggle")}
            </Label>
            <input
              id="split-toggle"
              type="checkbox"
              className="h-4 w-4 cursor-pointer"
              checked={splitMode}
              onChange={(e) => setSplitMode(e.target.checked)}
            />
          </div>
        )}

        {/* Split panel */}
        {splitMode && type !== "transfer" && (
          <Card>
            <CardContent className="space-y-3 py-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {tr("add.split.title")}
              </div>
              <p className="text-xs text-muted-foreground">{tr("add.split.hint")}</p>
              <ul className="space-y-3">
                {slices.map((s, idx) => (
                  <li key={s.id} className="rounded-md border border-border/60 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        {tr("add.split.slice", { n: idx + 1 })}
                      </span>
                      {slices.length > 2 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          aria-label={tr("add.split.remove_slice")}
                          onClick={() => setSlices((cur) => cur.filter((_, i) => i !== idx))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-[120px_1fr]">
                      <div>
                        <Label className="mb-1 block text-xs">{tr("add.split.amount")}</Label>
                        <Input
                          inputMode="decimal"
                          placeholder="0.00"
                          value={s.amount}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^0-9.,]/g, "");
                            setSlices((cur) => cur.map((x, i) => (i === idx ? { ...x, amount: v } : x)));
                          }}
                          className="tabular-nums"
                        />
                      </div>
                      <div>
                        <Label className="mb-1 block text-xs">{tr("add.split.description")}</Label>
                        <Input
                          value={s.description}
                          onChange={(e) =>
                            setSlices((cur) => cur.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))
                          }
                          placeholder={tr("add.description_placeholder")}
                        />
                      </div>
                    </div>
                    <div className="mt-2">
                      <Label className="mb-1 block text-xs">{tr("add.split.category")}</Label>
                      <ChipPicker
                        items={categoryChips}
                        value={s.categoryId || null}
                        onChange={(v) =>
                          setSlices((cur) => cur.map((x, i) => (i === idx ? { ...x, categoryId: v ?? "" } : x)))
                        }
                        allowClear
                        clearLabel={tr("add.split.no_category")}
                        placeholder={tr("add.select_category")}
                        moreLabel={tr("picker.more")}
                        searchPlaceholder={tr("picker.search")}
                        emptyLabel={tr("picker.no_match")}
                      />
                    </div>
                    <div className="mt-2">
                      <Label className="mb-1 block text-xs">{tr("add.split.note")}</Label>
                      <TagAutocompleteTextarea
                        rows={2}
                        value={s.note}
                        onChange={(next) =>
                          setSlices((cur) => cur.map((x, i) => (i === idx ? { ...x, note: next } : x)))
                        }
                        transactions={recentQ.data ?? []}
                        placeholder={tr("add.split.note_placeholder")}
                      />
                      <TagChips
                        className="mt-2"
                        transactions={recentQ.data ?? []}
                        currentNote={s.note}
                        onAppend={(tag) => {
                          setSlices((cur) =>
                            cur.map((x, i) => {
                              if (i !== idx) return x;
                              const present = new Set(extractTags(x.note));
                              if (present.has(tag)) return x;
                              const sep = x.note.length === 0 || x.note.endsWith(" ") ? "" : " ";
                              return { ...x, note: x.note + sep + "#" + tag };
                            }),
                          );
                        }}
                        onRemove={(tag) => {
                          setSlices((cur) =>
                            cur.map((x, i) => (i === idx ? { ...x, note: removeTagFrom(x.note, tag) } : x)),
                          );
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSlices((cur) => [...cur, newSlice()])}
              >
                <Plus className="mr-1 h-4 w-4" /> {tr("add.split.add_slice")}
              </Button>

              <div className="rounded-md bg-muted px-3 py-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{tr("add.split.total")}</span>
                  <span className="tabular-nums font-medium">
                    {splitTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{tr("add.split.target_total")}</span>
                  <span className="tabular-nums">
                    {targetTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {symbol}
                  </span>
                </div>
                {Math.abs(splitDiff) > 0.005 && targetTotal > 0 && (
                  <div className={cn("mt-1 flex justify-between font-medium", splitDiff > 0 ? "text-warning" : "text-destructive")}>
                    <span>{tr("add.split.diff")}</span>
                    <span className="tabular-nums">
                      {splitDiff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {symbol}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {!splitMode && (
          <div>
            <Label htmlFor="description" className="mb-1.5 block">{tr("add.description")}</Label>
            <DescriptionAutocomplete
              id="description"
              value={description}
              onChange={(v) => { setDescription(v); mark("description"); }}
              transactions={recentQ.data ?? []}
              placeholder={type === "transfer" ? tr("common.optional") : tr("add.description_placeholder")}
            />
          </div>
        )}

        <div>
          <Label htmlFor="note" className="mb-1.5 block">
            {splitMode ? tr("add.note.shared") : tr("add.note")}
          </Label>
          {splitMode && (
            <p className="mb-1.5 text-xs text-muted-foreground">{tr("add.note.shared_hint")}</p>
          )}
          <TagAutocompleteTextarea
            id="note"
            rows={2}
            value={note}
            onChange={(next) => { setNote(next); mark("note"); }}
            transactions={recentQ.data ?? []}
            placeholder={tr("add.note_placeholder")}
          />
          <TagChips
            className="mt-2"
            transactions={recentQ.data ?? []}
            currentNote={note}
            onAppend={appendTag}
            onRemove={removeTag}
          />
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

        {/* Live summary: how this transaction will look in the list */}
        <TransactionPreview
          type={type}
          amountNum={amountNum}
          destAmountNum={(() => {
            const n = Number(destAmount.replace(",", "."));
            return Number.isFinite(n) && n > 0 ? n : null;
          })()}
          isCrossCurrency={isCrossCurrency}
          source={sourceAccount ?? null}
          destination={destAccount ?? null}
          category={categoryId ? categoryById.get(categoryId) ?? null : null}
          description={description}
          note={note}
          date={date}
          locale={locale}
          symbol={symbol}
          destSymbol={destSymbol}
          splitMode={splitMode}
          slices={splitMode ? slices.map((s) => ({
            amount: Number(s.amount.replace(",", ".")) || 0,
            description: s.description,
            category: s.categoryId ? categoryById.get(s.categoryId) ?? null : null,
          })) : null}
          labels={{
            transfer: tr("tx.transfer_label"),
            income: tr("add.income"),
            expense: tr("add.expense"),
            preview: tr("add.preview.title"),
            split: tr("add.split.title"),
          }}
        />

        {duplicates.length > 0 && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
            style={{ borderColor: "hsl(38 92% 50% / 0.5)", backgroundColor: "hsl(38 92% 50% / 0.12)", color: "hsl(25 95% 35%)" }}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "hsl(25 95% 45%)" }} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{tr("add.duplicate.warning")}</div>
              <div className="mt-0.5 text-xs">
                {tr("add.duplicate.detail", {
                  count: String(duplicates.length),
                  account: sourceAccount?.name ?? "",
                  amount: amountNum != null ? fmtMoney(amountNum, symbol) : "",
                  date: format(date, "dd.MM.yyyy"),
                })}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          {isEdit ? (
            <>
              <Button variant="outline" className="flex-1" disabled={saving} onClick={() => navigate({ to: "/transactions" })}>{tr("common.cancel")}</Button>
              <Button className="flex-1" disabled={saving} onClick={() => save(false)}>{saving ? tr("common.saving") : tr("edit.save_changes")}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="flex-1" disabled={saving} onClick={() => save(true)}>{tr("add.save_new")}</Button>
              <Button className="flex-1" disabled={saving} onClick={() => save(false)}>{saving ? tr("common.saving") : tr("common.save")}</Button>
            </>
          )}
        </div>

        {isEdit && editId && (
          <div className="pt-2">
            <AttachmentsSection transactionId={editId} />
          </div>
        )}

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

type PreviewEntity = {
  name: string;
  icon?: string | null;
  emoji?: string | null;
  image_url?: string | null;
  color?: string | null;
  currency_symbol?: string;
} | null;

function TransactionPreview({
  type,
  amountNum,
  destAmountNum,
  isCrossCurrency,
  source,
  destination,
  category,
  description,
  note,
  date,
  locale,
  symbol,
  destSymbol,
  splitMode,
  slices,
  labels,
}: {
  type: TxType;
  amountNum: number | null;
  destAmountNum: number | null;
  isCrossCurrency: boolean;
  source: PreviewEntity;
  destination: PreviewEntity;
  category: PreviewEntity;
  description: string;
  note: string;
  date: Date;
  locale: Locale;
  symbol: string;
  destSymbol: string;
  splitMode: boolean;
  slices: Array<{ amount: number; description: string; category: PreviewEntity }> | null;
  labels: { transfer: string; income: string; expense: string; preview: string; split: string };
}) {
  if (amountNum == null || !source) return null;

  const Icon = type === "expense" ? ArrowDown : type === "income" ? ArrowUp : ArrowLeftRight;
  const tone =
    type === "expense" ? "text-destructive" : type === "income" ? "text-success" : "text-muted-foreground";
  const sign = type === "expense" ? "-" : type === "income" ? "+" : "";
  const primary = (type !== "transfer" ? category : null) ?? source;
  const showDst = type === "transfer" && isCrossCurrency && destAmountNum != null;
  const fallbackTitle = type === "transfer" ? labels.transfer : type === "income" ? labels.income : labels.expense;

  return (
    <Card className="border-dashed">
      <CardContent className="space-y-2 py-3">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {labels.preview}
        </div>
        <div className="flex items-start gap-3">
          <div className="relative mt-0.5 shrink-0">
            <EntityVisual entity={primary} size="md" />
            <div className={cn("absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background ring-1 ring-border", tone)}>
              <Icon className="h-3 w-3" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="truncate text-sm font-medium">
                {description.trim() || fallbackTitle}
              </div>
              <div className={cn("whitespace-nowrap text-sm font-semibold tabular-nums", tone)}>
                {sign}
                {fmtMoney(amountNum, symbol).replace("-", "")}
                {showDst && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    → {fmtMoney(destAmountNum!, destSymbol).replace("-", "")}
                  </span>
                )}
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {source && <EntityVisual entity={source} size="xs" />}
                {source?.name ?? "?"}
              </span>
              {type === "transfer" && destination && (
                <>
                  <span>→</span>
                  <span className="inline-flex items-center gap-1">
                    <EntityVisual entity={destination} size="xs" />
                    {destination.name}
                  </span>
                </>
              )}
              {category && type !== "transfer" && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <EntityVisual entity={category} size="xs" />
                    {category.name}
                  </span>
                </>
              )}
              <span>·</span>
              <span>{format(date, "dd.MM.yyyy", { locale })}</span>
            </div>
            {note.trim() && (
              <div className="mt-1 truncate text-xs text-muted-foreground">{note.trim()}</div>
            )}
          </div>
        </div>
        {splitMode && slices && slices.length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-dashed border-border/60 pt-2 text-xs">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{labels.split}</div>
            {slices.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-muted-foreground">
                  {s.category && <EntityVisual entity={s.category} size="xs" />}
                  <span className="truncate">{s.description.trim() || s.category?.name || "—"}</span>
                </span>
                <span className={cn("tabular-nums", tone)}>
                  {sign}
                  {fmtMoney(s.amount, symbol).replace("-", "")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
