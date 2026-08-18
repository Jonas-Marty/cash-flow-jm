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
import { useServerFn } from "@tanstack/react-start";
import { notifyTransactionCreated } from "@/utils/webhooks.functions";
import { resolveStatementLine } from "@/utils/statements.functions";
import {
  fetchAccounts, fetchCategories, fetchCategoryGroups, fetchSettings, fetchTransactions,
  fetchOpenReimbursables, fetchReimbursementLinks, fetchReimbursementCounterparties,
  linkReimbursement,
  extractTags, fmtMoney,
  type TxType, type Transaction, type ReimbursementLink,
} from "@/lib/finance";
import {
  fetchAccountBalances, fetchCategoryMonthRows, monthKey,
  type AccountBalance, type CategoryMonthRow,
} from "@/lib/finance";
import { fetchSavingsBalancesV2, type CategorySavingsBalanceV2 } from "@/lib/finance";
import { EntityVisual } from "@/components/EntityVisual";
import { AlertTriangle, Link as LinkIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { StringAutocomplete } from "@/components/StringAutocomplete";
import { Checkbox } from "@/components/ui/checkbox";
import { Toggle } from "@/components/ui/toggle";
import { useI18n } from "@/i18n";
import { useSuggestions } from "@/lib/suggestions/useSuggestions";
import type { Suggestion } from "@/lib/suggestions/types";
import { SuggestionRow } from "@/components/SuggestionRow";
import { QuickAmountChips } from "@/components/QuickAmountChips";
import { TagChips } from "@/components/TagChips";
import { TagAutocompleteTextarea } from "@/components/TagAutocompleteTextarea";
import { DateShortcuts } from "@/components/DateShortcuts";
import { ChipPicker, type ChipPickerItem } from "@/components/ChipPicker";
import { scoreAccounts, scoreCategories, sortByPinAndScore, type SuggestionContext } from "@/lib/usageScoring";
import { DayHeatmapCalendar } from "@/components/DayHeatmapCalendar";
import { DateInput } from "@/components/DateInput";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { DescriptionAutocomplete } from "@/components/DescriptionAutocomplete";
import { AttachmentsSection, type DraftAttachment } from "@/components/AttachmentsSection";
import { Markdown } from "@/components/Markdown";
import { useFxRates, convert } from "@/lib/fx";
import { findSubsetSumMatch, defaultTolerance, REIMB_MATCH_MAX_CANDIDATES } from "@/lib/reimbMatch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import type { FxRates } from "@/lib/fx";
import { fetchScopes } from "@/lib/finance";
import { useActiveScopeId } from "@/lib/activeScope";
import { Target } from "lucide-react";

export const Route = createFileRoute("/add")({
  component: AddTransactionRoute,
});

function AddTransactionRoute() {
  // Read prefill from URL search params (set by deep links such as the
  // dashboard "Add refund" button). Kept untyped to avoid forcing every
  // <Link to="/add"> elsewhere to declare a search shape.
  const prefill = React.useMemo<AddPrefill>(() => {
    if (typeof window === "undefined") return {};
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("type");
    return {
      reimburse_for: sp.get("reimburse_for") ?? undefined,
      type: t === "income" || t === "expense" || t === "transfer" ? t : undefined,
      amount: cleanAmountParam(sp.get("amount")),
      source: sp.get("source") ?? undefined,
      counterparty: sp.get("counterparty") ?? undefined,
      account_name: sp.get("account_name") ?? undefined,
      category: sp.get("category") ?? undefined,
      category_name: sp.get("category_name") ?? undefined,
      description: sp.get("description") ?? undefined,
      note: sp.get("note") ?? undefined,
      occurred_on: sp.get("occurred_on") ?? undefined,
      iou_with: sp.get("iou_with") ?? undefined,
      iou_amount: cleanAmountParam(sp.get("iou_amount")),
      statement_line: sp.get("statement_line") ?? undefined,
      statement_import: sp.get("statement_import") ?? undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <TransactionForm editId={null} prefill={prefill} />;
}

/** Strip quotes/currency noise from an amount passed via URL (e.g. AI prefill). */
function cleanAmountParam(v: string | null): string | undefined {
  if (v == null) return undefined;
  const s = v.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/[^\d.,-]/g, "").replace(",", ".").trim();
  return s === "" ? undefined : s;
}

export interface AddPrefill {
  reimburse_for?: string;
  type?: TxType;
  amount?: string;
  source?: string;
  counterparty?: string;
  /** Free-text account name from AI; resolved client-side. */
  account_name?: string;
  category?: string;
  category_name?: string;
  description?: string;
  note?: string;
  occurred_on?: string;
  iou_with?: string;
  iou_amount?: string;
  /** Statement import line this entry closes; linked back after save. */
  statement_line?: string;
  statement_import?: string;
}

export function TransactionForm({ editId, prefill }: { editId: string | null; prefill?: AddPrefill }) {
  const { t: tr, locale, lang } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notifyCreated = useServerFn(notifyTransactionCreated);
  const linkStatementLineFn = useServerFn(resolveStatementLine);
  // When the form was opened from a statement line ("create missing entry"),
  // link the created transaction back so the statement can be worked through.
  const linkStatementLine = React.useCallback(
    async (txId: string): Promise<boolean> => {
      const lineId = prefill?.statement_line;
      if (!lineId) return false;
      try {
        await linkStatementLineFn({ data: { line_id: lineId, decision: "link", transaction_id: txId } });
        toast.success(tr("statements.toast.linked"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
      navigate({
        to: "/statements",
        search: prefill?.statement_import ? ({ import: prefill.statement_import } as never) : undefined,
      });
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefill?.statement_line, prefill?.statement_import],
  );
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const groupsQ = useQuery({ queryKey: ["category_groups"], queryFn: fetchCategoryGroups });
  const recentQ = useQuery({ queryKey: ["transactions", "recent", 200], queryFn: () => fetchTransactions(200) });
  const openReimbQ = useQuery({ queryKey: ["reimbursables", "open"], queryFn: fetchOpenReimbursables });
  const reimbLinksQ = useQuery({ queryKey: ["reimbursement_links"], queryFn: fetchReimbursementLinks });
  const reimbCpQ = useQuery({ queryKey: ["reimbursement_counterparties"], queryFn: fetchReimbursementCounterparties });
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
  const balancesQ = useQuery({ queryKey: ["account_balances"], queryFn: fetchAccountBalances });

  const accounts = (accountsQ.data ?? []).filter((a) => !a.archived);
  // Hide closed scopes from category pickers. Active (open) scopes stay in the list.
  const categories = (categoriesQ.data ?? []).filter((c) => !c.archived && !c.closed_at);
  const groupKindById = new Map((groupsQ.data ?? []).map((g) => [g.id, g.kind]));
  const mainSymbol = settingsQ.data?.currency_symbol ?? "CHF";
  const accountById = React.useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  const [type, setType] = React.useState<TxType>("expense");
  const [amount, setAmount] = React.useState("");
  const [sourceId, setSourceId] = React.useState<string>("");
  const [destId, setDestId] = React.useState<string>("");
  const [categoryId, setCategoryId] = React.useState<string>("");
  const [description, setDescription] = React.useState("");
  const [note, setNote] = React.useState("");

  // Context-aware chip ordering: once the user picks a type/account/category,
  // the remaining fields re-rank toward what was historically used together.
  // See src/lib/usageScoring.ts for the scoring formula.
  const accountChips: ChipPickerItem[] = React.useMemo(() => {
    const ctx: SuggestionContext = {
      type,
      categoryId: categoryId || undefined,
      description: description || undefined,
    };
    const scores = scoreAccounts(recentQ.data ?? [], ctx);
    return sortByPinAndScore(accounts, scores).map((a) => ({
      id: a.id, name: a.name,
      icon: a.icon, emoji: a.emoji, image_url: a.image_url, color: a.color,
      pinned: a.pinned,
    }));
  }, [accounts, recentQ.data, type, categoryId, description]);
  const categoryChips: ChipPickerItem[] = React.useMemo(() => {
    const ctx: SuggestionContext = {
      type,
      sourceAccountId: sourceId || undefined,
      destAccountId: destId || undefined,
      description: description || undefined,
    };
    const scores = scoreCategories(recentQ.data ?? [], ctx);
    return sortByPinAndScore(categories, scores).map((c) => ({
      id: c.id, name: c.name,
      icon: c.icon, emoji: c.emoji, image_url: c.image_url, color: c.color,
      pinned: c.pinned,
    }));
  }, [categories, recentQ.data, type, sourceId, destId, description]);

  const [date, setDate] = React.useState<Date>(new Date());
  const [saving, setSaving] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const amountRef = React.useRef<HTMLInputElement>(null);

  // ───────── Reimbursable section ─────────
  const [isReimbursable, setIsReimbursable] = React.useState(false);
  const [reimbCounterparty, setReimbCounterparty] = React.useState("");
  const [reimbReason, setReimbReason] = React.useState("");
  // For income transactions: which open reimbursable expenses the user
  // wants to link this income to. Map<originalTxId, amountToApply>.
  const [linkSelections, setLinkSelections] = React.useState<Record<string, number>>({});
  // Set by the "Add refund" deep link from the dashboard so we can preselect
  // the original reimbursable expense once data has loaded.
  const reimburseForId = prefill?.reimburse_for ?? null;

  // Cross-currency dual-amount field: when source/dest currencies differ on
  // a transfer, the user enters the amount that actually arrived in the
  // destination account (e.g. EUR cash dispensed from a CHF bank withdrawal).
  const [destAmount, setDestAmount] = React.useState("");
  const [destAmountTouched, setDestAmountTouched] = React.useState(false);

  // Optional fee charged on a transfer (e.g. ATM withdrawal fee). When set,
  // we create an auto-linked expense transaction on the source account in the
  // chosen category. Charged in the source account's currency.
  const [feeOpen, setFeeOpen] = React.useState(false);
  const [feeAmount, setFeeAmount] = React.useState("");
  const [feeCategoryId, setFeeCategoryId] = React.useState<string>("");
  // Tracks an already-linked fee transaction id when editing.
  const [existingFeeTxId, setExistingFeeTxId] = React.useState<string | null>(null);

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

  // Clear fee state when leaving transfer mode (DB trigger does the same on
  // the row, but we also reset the UI).
  React.useEffect(() => {
    if (type !== "transfer") {
      setFeeOpen(false);
      setFeeAmount("");
      setFeeCategoryId("");
    }
  }, [type]);

  // ───────── Split mode (multi-item receipt) ─────────
  type Slice = {
    id: string;
    amount: string;
    categoryId: string;
    description: string;
    note: string;
    isReimbursable: boolean;
    reimbCounterparty: string;
    reimbReason: string;
  };
  const newSlice = (): Slice => ({
    id: Math.random().toString(36).slice(2),
    amount: "",
    categoryId: "",
    description: "",
    note: "",
    isReimbursable: false,
    reimbCounterparty: "",
    reimbReason: "",
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

  // Draft attachments collected before the transaction is created.
  const [draftAttachments, setDraftAttachments] = React.useState<DraftAttachment[]>([]);

  // ───────── Edit-mode reimbursement guards ─────────
  // Links where this tx is the *original* (open reimbursable being repaid).
  const editAsOriginalLinks = React.useMemo<ReimbursementLink[]>(() => {
    if (!editId) return [];
    return (reimbLinksQ.data ?? []).filter((l) => l.original_transaction_id === editId);
  }, [editId, reimbLinksQ.data]);
  // Links where this tx is the *settler* (repayment row).
  const editAsSettlerLinks = React.useMemo<ReimbursementLink[]>(() => {
    if (!editId) return [];
    return (reimbLinksQ.data ?? []).filter((l) => l.settling_transaction_id === editId);
  }, [editId, reimbLinksQ.data]);

  // ───────── Active scope ─────────
  const [activeScopeId] = useActiveScopeId();
  const scopesQ = useQuery({ queryKey: ["scopes"], queryFn: fetchScopes, enabled: !isEdit });
  const activeScope = React.useMemo(() => {
    if (isEdit || !activeScopeId) return null;
    const s = (scopesQ.data ?? []).find((x) => x.id === activeScopeId);
    return s && !s.closed_at ? s : null;
  }, [isEdit, activeScopeId, scopesQ.data]);
  const [scopeSkipped, setScopeSkipped] = React.useState(false);
  React.useEffect(() => {
    if (!activeScope || scopeSkipped || isEdit) return;
    if (type === "transfer") return;
    if (!categoryId) setCategoryId(activeScope.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScope?.id, scopeSkipped, isEdit, type]);

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
    if (tx.is_reimbursable) {
      setIsReimbursable(true);
      setReimbCounterparty(tx.reimbursable_counterparty ?? "");
      setReimbReason(tx.reimbursable_reason ?? "");
    }
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
          isReimbursable: !!g.is_reimbursable,
          reimbCounterparty: g.reimbursable_counterparty ?? "",
          reimbReason: g.reimbursable_reason ?? "",
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
      if (tx.fee_amount != null && Number(tx.fee_amount) > 0) {
        setFeeOpen(true);
        setFeeAmount(Number(tx.fee_amount).toFixed(2));
        setFeeCategoryId(tx.fee_category_id ?? "");
        setExistingFeeTxId(tx.fee_transaction_id ?? null);
      }
    }
    // mark all fields as touched so suggestions never overwrite loaded data
    setTouched({ amount: true, description: true, note: true, sourceId: true, categoryId: true });
  }, [isEdit, editQ.data]);

  // Apply non-edit prefill once (deep link from dashboard "Add refund").
  const prefillAppliedRef = React.useRef(false);
  React.useEffect(() => {
    if (isEdit || prefillAppliedRef.current || !prefill) return;
    const anyField =
      prefill.type || prefill.amount || prefill.source || prefill.counterparty || prefill.reimburse_for ||
      prefill.account_name || prefill.category || prefill.category_name || prefill.description ||
      prefill.note || prefill.occurred_on || prefill.iou_with || prefill.iou_amount;
    if (!anyField) return;
    // Wait until accounts/categories are loaded so name-based prefill can resolve.
    if ((prefill.account_name || prefill.category_name) && (accounts.length === 0 || categories.length === 0)) return;
    prefillAppliedRef.current = true;
    if (prefill.type) setType(prefill.type);
    if (prefill.amount) { setAmount(prefill.amount); mark("amount"); }
    if (prefill.source) { setSourceId(prefill.source); mark("sourceId"); }
    if (prefill.counterparty) setReimbCounterparty(prefill.counterparty);
    if (!prefill.source && prefill.account_name) {
      const needle = prefill.account_name.toLowerCase();
      const match =
        accounts.find((a) => a.name.toLowerCase() === needle) ||
        accounts.find((a) => a.name.toLowerCase().includes(needle));
      if (match) { setSourceId(match.id); mark("sourceId"); }
    }
    if (prefill.category) { setCategoryId(prefill.category); }
    else if (prefill.category_name) {
      const needle = prefill.category_name.toLowerCase();
      const match =
        categories.find((c) => c.name.toLowerCase() === needle) ||
        categories.find((c) => c.name.toLowerCase().includes(needle));
      if (match) setCategoryId(match.id);
    }
    if (prefill.description) setDescription(prefill.description);
    if (prefill.note) setNote(prefill.note);
    if (prefill.occurred_on) {
      const d = new Date(prefill.occurred_on);
      if (!Number.isNaN(d.getTime())) setDate(d);
    }
    if (prefill.iou_with || prefill.iou_amount) {
      setIsReimbursable(true);
      if (prefill.iou_with) setReimbCounterparty(prefill.iou_with);
      if (prefill.iou_amount) {
        const cur = prefill.iou_with ? ` (${prefill.iou_with}: ${prefill.iou_amount})` : ` (owed: ${prefill.iou_amount})`;
        setReimbReason((prev) => (prev ? prev : `Share owed${cur}`));
      }
    }
    // The actual link selection happens when openReimbQ has loaded — see
    // the auto-link effect below.
  }, [isEdit, prefill, accounts, categories]);

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

  // Month bucket for the chosen transaction date — used by the impact preview
  // to read the affected category's monthly envelope (spent vs allocated).
  const impactMonth = React.useMemo(() => monthKey(date), [date]);
  const categoryMonthQ = useQuery({
    queryKey: ["category_month_spending", impactMonth],
    queryFn: () => fetchCategoryMonthRows(impactMonth),
  });
  // Cumulative savings envelope balances — savings categories show accumulated
  // money in the impact preview instead of a monthly remaining figure.
  const savingsBalancesQ = useQuery({
    queryKey: ["savings_balances_v2"],
    queryFn: () => fetchSavingsBalancesV2(),
  });

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

  // Remaining (open) amount per reimbursable original transaction.
  const remainingByOrig = React.useMemo(() => {
    const linked = new Map<string, number>();
    (reimbLinksQ.data ?? []).forEach((l: ReimbursementLink) => {
      linked.set(l.original_transaction_id, (linked.get(l.original_transaction_id) ?? 0) + Number(l.amount));
    });
    const out = new Map<string, number>();
    (openReimbQ.data ?? []).forEach((t) => {
      out.set(t.id, Math.max(0, Number(t.amount) - (linked.get(t.id) ?? 0)));
    });
    return out;
  }, [openReimbQ.data, reimbLinksQ.data]);

  // Auto-link candidates: open reimbursables for the current source account
  // (same currency) that this income could plausibly settle.
  // Candidates for the reimbursable-link card: open reimbursables on a
  // same-currency account, optionally filtered by counterparty ("From whom"
  // on the income transaction). Sorted by most-recent first so the
  // subset-sum search prefers recent items when there are too many.
  const linkCandidates = React.useMemo<Transaction[]>(() => {
    if (type !== "income" || !sourceId) return [];
    const srcAcc = accountById.get(sourceId);
    if (!srcAcc) return [];
    const list = (openReimbQ.data ?? []).filter((t) => {
      const tAcc = accountById.get(t.source_account_id);
      if (!tAcc) return false;
      if (tAcc.currency_code !== srcAcc.currency_code) return false;
      if ((remainingByOrig.get(t.id) ?? 0) <= 0) return false;
      return true;
    });
    list.sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : 0));
    return list;
  }, [type, sourceId, openReimbQ.data, accountById, remainingByOrig]);

  // Subset-sum suggestion: best subset of candidates whose remaining amounts
  // sum to the income amount within a generous tolerance. Only computed when
  // the user has typed a counterparty — otherwise we don't claim a "match".
  const suggestedMatch = React.useMemo<{ ids: string[]; total: number; exact: boolean } | null>(() => {
    if (type !== "income" || amountNum == null) return null;
    const pool = linkCandidates.slice(0, REIMB_MATCH_MAX_CANDIDATES);
    if (pool.length === 0) return null;
    const amounts = pool.map((t) => remainingByOrig.get(t.id) ?? 0);
    const m = findSubsetSumMatch(amounts, amountNum, defaultTolerance(amountNum));
    if (!m) return null;
    return {
      ids: m.indices.map((i) => pool[i].id),
      total: m.total,
      exact: m.exact,
    };
  }, [type, amountNum, linkCandidates, remainingByOrig]);

  // The subset-sum suggestion is only a *highlight* — we never auto-check
  // the items because an amount match may be coincidental. The user must
  // confirm explicitly by ticking the checkbox or clicking "Link suggested".
  const linkSelectionsTouchedRef = React.useRef(false);

  // When deep-linked from "Add refund", preselect the original reimbursable.
  const reimbForAppliedRef = React.useRef(false);
  React.useEffect(() => {
    if (reimbForAppliedRef.current || !reimburseForId) return;
    const tx = (openReimbQ.data ?? []).find((t) => t.id === reimburseForId);
    if (!tx) return;
    reimbForAppliedRef.current = true;
    const rem = remainingByOrig.get(tx.id) ?? Number(tx.amount);
    setLinkSelections((cur) => ({ ...cur, [tx.id]: rem }));
  }, [reimburseForId, openReimbQ.data, remainingByOrig]);

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
    const re = new RegExp(`(^|\\s)#${tag.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(?![\\p{L}\\p{N}_-])`, "giu");
    return text.replace(re, (_m, lead: string) => lead).replace(/[ \t]{2,}/g, " ").replace(/\s+$/g, "").replace(/^\s+/g, (s) => s);
  };
  const removeTag = (tag: string) => {
    setNote(removeTagFrom(note, tag));
    mark("note");
  };

  const reset = () => {
    setAmount(""); setDescription(""); setNote("");
    setCategoryId(activeScope && type !== "transfer" ? activeScope.id : "");
    setDate(new Date());
    setTouched({});
    setAppliedFrom(null);
    setIsReimbursable(false);
    setReimbCounterparty("");
    setReimbReason("");
    setLinkSelections({});
    setFeeOpen(false);
    setFeeAmount("");
    setFeeCategoryId("");
    setExistingFeeTxId(null);
    setScopeSkipped(false);
    linkSelectionsTouchedRef.current = false;
    setTimeout(() => amountRef.current?.focus(), 0);
  };

  const save = async (andNew: boolean) => {
    const amt = Number(amount.replace(",", "."));
    if (!amt || amt <= 0) { toast.error(tr("toast.amount_required")); return; }
    if (!sourceId) { toast.error(tr("toast.account_required")); return; }
    if (type === "transfer" && !destId) { toast.error(tr("toast.dest_required")); return; }
    if (type === "transfer" && destId === sourceId) { toast.error(tr("toast.dest_must_differ")); return; }

    // Validate optional transfer fee
    const feeAmtNum =
      type === "transfer" && feeOpen
        ? (() => {
            const n = Number(feeAmount.replace(",", "."));
            return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
          })()
        : 0;
    if (type === "transfer" && feeOpen && feeAmtNum > 0 && !feeCategoryId) {
      toast.error(tr("toast.fee_category_required"));
      return;
    }

    // Validate dest amount up front, before we start any DB writes.
    let destAmountNum: number | null = null;
    if (type === "transfer" && isCrossCurrency) {
      const dn = Number(destAmount.replace(",", "."));
      destAmountNum = Number.isFinite(dn) && dn > 0 ? dn : null;
      if (destAmountNum == null) {
        toast.error(tr("toast.dest_amount_required"));
        return;
      }
    }

    // Guard: don't allow turning off `is_reimbursable` on the parent edit row
    // while reimbursement links or a write-off still reference it. The same
    // applies per-slice in split mode (checked below per slice id).
    if (isEdit && editId && !splitMode) {
      const wasReimb = !!editQ.data?.tx.is_reimbursable;
      const becameNotReimb = wasReimb && !isReimbursable;
      const hasWriteoff = !!editQ.data?.tx.reimbursable_writeoff_transaction_id;
      if (becameNotReimb && (editAsOriginalLinks.length > 0 || hasWriteoff)) {
        toast.error(tr("add.reimb.cannot_unflag"));
        return;
      }
    }

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
          isReimbursable: !!s.isReimbursable,
          reimbCounterparty: s.isReimbursable ? (s.reimbCounterparty.trim() || null) : null,
          reimbReason: s.isReimbursable ? (s.reimbReason.trim() || null) : null,
        };
      });
      if (parsed.some((p) => !p.amount || p.amount <= 0)) { toast.error(tr("add.split.toast.amounts")); return; }

      setSaving(true);
      const occurred_on = format(date, "yyyy-MM-dd");
      // Edit-mode split save: diff existing slices vs incoming and apply
      // UPDATE/INSERT/DELETE individually. Avoids the cascade-delete trigger
      // collision that "DELETE then INSERT" hits when a slice is reimbursable
      // and already has rows in transaction_reimbursements.
      if (isEdit && editQ.data) {
        const tx = editQ.data.tx;
        const existingGroup = editQ.data.group ?? [];
        const existingIds = new Set<string>(
          existingGroup.length > 0 ? existingGroup.map((g) => g.id) : [tx.id],
        );
        const groupId =
          tx.split_group_id ??
          (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));

        const rowFor = (p: typeof parsed[number]) => ({
          occurred_on,
          amount: p.amount,
          description: p.description,
          note: p.note,
          type,
          source_account_id: sourceId,
          destination_account_id: null,
          category_id: p.categoryId,
          split_group_id: groupId,
          is_reimbursable: p.isReimbursable,
          reimbursable_counterparty: p.reimbCounterparty,
          reimbursable_reason: p.reimbReason,
        });

        const toUpdate: { id: string; row: ReturnType<typeof rowFor> }[] = [];
        const toInsert: ReturnType<typeof rowFor>[] = [];
        parsed.forEach((p) => {
          if (existingIds.has(p.id)) toUpdate.push({ id: p.id, row: rowFor(p) });
          else toInsert.push(rowFor(p));
        });
        const incomingIds = new Set(parsed.map((p) => p.id));
        const toDeleteIds = [...existingIds].filter((id) => !incomingIds.has(id));

        // Per-slice guard: prevent turning off is_reimbursable on a slice
        // that still has reimbursement links or a write-off.
        const existingById = new Map<string, Transaction>(
          (existingGroup.length > 0 ? existingGroup : [tx]).map((g) => [g.id, g as Transaction]),
        );
        for (const u of toUpdate) {
          const prev = existingById.get(u.id);
          if (!prev) continue;
          const becameNotReimb = !!prev.is_reimbursable && !u.row.is_reimbursable;
          if (!becameNotReimb) continue;
          const hasLink = (reimbLinksQ.data ?? []).some(
            (l) => l.original_transaction_id === u.id,
          );
          const hasWriteoff = !!prev.reimbursable_writeoff_transaction_id;
          if (hasLink || hasWriteoff) {
            setSaving(false);
            toast.error(tr("add.reimb.cannot_unflag"));
            return;
          }
        }

        // Confirm if removing slices that have reimbursement links.
        const allLinks = reimbLinksQ.data ?? [];
        const lostLinkIds = toDeleteIds.filter((id) =>
          allLinks.some(
            (l) => l.original_transaction_id === id || l.settling_transaction_id === id,
          ),
        );
        if (lostLinkIds.length > 0) {
          const ok =
            typeof window !== "undefined" &&
            window.confirm(tr("add.split.confirm_remove_linked"));
          if (!ok) {
            setSaving(false);
            return;
          }
        }

        for (const u of toUpdate) {
          const { error: uErr } = await supabase
            .from("transactions")
            .update(u.row)
            .eq("id", u.id);
          if (uErr) { setSaving(false); toast.error(uErr.message); return; }
        }
        if (toInsert.length > 0) {
          const { error: iErr } = await supabase.from("transactions").insert(toInsert);
          if (iErr) { setSaving(false); toast.error(iErr.message); return; }
        }
        if (toDeleteIds.length > 0) {
          const { error: dErr } = await supabase
            .from("transactions")
            .delete()
            .in("id", toDeleteIds);
          if (dErr) { setSaving(false); toast.error(dErr.message); return; }
        }

        setSaving(false);
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
        is_reimbursable: p.isReimbursable,
        reimbursable_counterparty: p.reimbCounterparty,
        reimbursable_reason: p.reimbReason,
      }));
      const { data: insRows, error } = await supabase
        .from("transactions")
        .insert(rows)
        .select("id");
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      const newIds = (insRows ?? []).map((r) => r.id).filter((x): x is string => !!x);
      if (newIds.length > 0) {
        void notifyCreated({ data: { ids: newIds } }).catch(() => {});
      }
      toast.success(tr("toast.saved"));
      qc.invalidateQueries();
      if (newIds.length > 0 && (await linkStatementLine(newIds[0]))) return;
      if (andNew) { setSplitMode(false); setSlices([newSlice(), newSlice()]); reset(); }
      else navigate({ to: "/" });
      return;
    }

    setSaving(true);
    const occurredOnStr = format(date, "yyyy-MM-dd");
    // For transfers with a fee, insert the fee expense FIRST so we can
    // store its id on the transfer row. Skip on edit when an existing fee
    // tx is already linked — we update it in place below instead.
    let feeTxId: string | null = existingFeeTxId;
    if (type === "transfer" && feeAmtNum > 0 && feeCategoryId) {
      if (!existingFeeTxId) {
        const feeDesc =
          (description.trim() ? `${tr("add.transfer.fee.tx_prefix")}: ${description.trim()}` : tr("add.transfer.fee.tx_default"));
        const { data: feeIns, error: feeErr } = await supabase
          .from("transactions")
          .insert({
            occurred_on: occurredOnStr,
            amount: feeAmtNum,
            type: "expense",
            source_account_id: sourceId,
            destination_account_id: null,
            category_id: feeCategoryId,
            description: feeDesc,
            note: null,
            is_reimbursable: false,
          })
          .select("id")
          .single();
        if (feeErr) { setSaving(false); toast.error(feeErr.message); return; }
        feeTxId = feeIns?.id ?? null;
      } else {
        // Update the existing linked fee tx amount / category / date.
        const { error: feeUpdErr } = await supabase
          .from("transactions")
          .update({
            occurred_on: occurredOnStr,
            amount: feeAmtNum,
            source_account_id: sourceId,
            category_id: feeCategoryId,
          })
          .eq("id", existingFeeTxId);
        if (feeUpdErr) { setSaving(false); toast.error(feeUpdErr.message); return; }
      }
    } else if (existingFeeTxId) {
      // Fee was removed by the user (or type changed off transfer). Delete
      // the linked fee tx; the parent transfer's fee_* fields will be cleared
      // by the update payload below.
      const { error: feeDelErr } = await supabase
        .from("transactions")
        .delete()
        .eq("id", existingFeeTxId);
      if (feeDelErr) { setSaving(false); toast.error(feeDelErr.message); return; }
      feeTxId = null;
    }

    const payload = {
      occurred_on: occurredOnStr,
      amount: amt,
      description: description.trim() || null,
      note: note.trim() || null,
      type,
      source_account_id: sourceId,
      destination_account_id: type === "transfer" ? destId : null,
      category_id: type === "transfer" ? null : (categoryId || null),
      destination_amount:
        type === "transfer" && isCrossCurrency ? destAmountNum : null,
      // Reimbursable flag only meaningful for expenses (or income that you
      // expect to receive — rare, but allowed). Transfers can't be reimbursable.
      is_reimbursable: type !== "transfer" ? isReimbursable : false,
      reimbursable_counterparty:
        type !== "transfer" && isReimbursable ? (reimbCounterparty.trim() || null) : null,
      reimbursable_reason:
        type !== "transfer" && isReimbursable ? (reimbReason.trim() || null) : null,
      fee_amount: type === "transfer" && feeAmtNum > 0 ? feeAmtNum : null,
      fee_category_id: type === "transfer" && feeAmtNum > 0 ? feeCategoryId : null,
      fee_transaction_id: type === "transfer" && feeAmtNum > 0 ? feeTxId : null,
    };
    const selectedLinks = Object.entries(linkSelections)
      .map(([id, amt2]) => ({ id, amount: Number(amt2) }))
      .filter((x) => x.id && Number.isFinite(x.amount) && x.amount > 0);
    if (isEdit && editId) {
      const { error } = await supabase.from("transactions").update(payload).eq("id", editId);
      if (error) { setSaving(false); toast.error(error.message); return; }
      // Mirror amount changes into reimbursement link rows where this tx
      // is the settler, so the original's settled/open status stays correct.
      if (editAsSettlerLinks.length === 1) {
        const link = editAsSettlerLinks[0];
        if (Math.abs(Number(link.amount) - amt) > 0.005) {
          const { error: lErr } = await supabase
            .from("transaction_reimbursements")
            .update({ amount: amt })
            .eq("id", link.id);
          if (lErr) toast.error(lErr.message);
        }
      } else if (editAsSettlerLinks.length > 1) {
        const total = editAsSettlerLinks.reduce((s, l) => s + Number(l.amount), 0);
        if (Math.abs(total - amt) > 0.005) {
          toast.warning(tr("add.reimb.settler_amount_mismatch"));
        }
      }
      setSaving(false);
      toast.success(tr("toast.saved"));
      qc.invalidateQueries();
      navigate({ to: "/transactions" });
      return;
    }
    const { data: inserted, error } = await supabase
      .from("transactions")
      .insert(payload)
      .select("id")
      .single();
    if (error) { setSaving(false); toast.error(error.message); return; }
    const newTxId = inserted?.id as string | undefined;
    if (newTxId) {
      void notifyCreated({ data: { ids: [newTxId] } }).catch(() => {});
    }
    // Insert reimbursement link rows when the user confirmed the auto-link
    // suggestion (income settling an outgoing reimbursable) or when this
    // transaction was opened via reimburse_for (e.g. expense repayment of
    // an "I owe" income reimbursable).
    if (newTxId && type !== "transfer" && selectedLinks.length > 0) {
      for (const sel of selectedLinks) {
        try {
          await linkReimbursement(sel.id, newTxId, sel.amount);
        } catch (e) {
          toast.error((e as Error).message);
        }
      }
    }
    // Persist any attachments the user added before save.
    if (newTxId && draftAttachments.length > 0) {
      const rows = draftAttachments.map((a) => ({
        transaction_id: newTxId,
        statement_id: null,
        source: a.source,
        display_name: a.display_name,
        link_url: a.link_url,
      }));
      const { error: aErr } = await supabase.from("transaction_attachments").insert(rows);
      if (aErr) toast.error(aErr.message);
      else setDraftAttachments([]);
    }
    setSaving(false);
    toast.success(tr("toast.saved"));
    qc.invalidateQueries();
    if (newTxId && (await linkStatementLine(newTxId))) return;
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
        {activeScope && type !== "transfer" && (
          <div className={cn(
            "flex items-start gap-3 rounded-lg border px-3 py-2 text-sm",
            scopeSkipped
              ? "border-muted bg-muted/30 text-muted-foreground"
              : "border-primary/40 bg-primary/5 text-foreground",
          )}>
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1">
              <div className="font-medium">
                {scopeSkipped
                  ? tr("add.scope.banner_skipped", { name: activeScope.name })
                  : tr("add.scope.banner_active", { name: activeScope.name })}
              </div>
              <div className="text-xs text-muted-foreground">
                {scopeSkipped ? tr("add.scope.banner_skipped_hint") : tr("add.scope.banner_active_hint")}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                if (scopeSkipped) {
                  setScopeSkipped(false);
                  if (!categoryId) setCategoryId(activeScope.id);
                } else {
                  setScopeSkipped(true);
                  if (categoryId === activeScope.id) setCategoryId("");
                }
              }}
            >
              {scopeSkipped ? tr("add.scope.use") : tr("add.scope.skip")}
            </Button>
          </div>
        )}
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
              {/* Optional fee on the transfer (e.g. ATM withdrawal fee) */}
              {sourceAccount && destAccount && (
                feeOpen ? (
                  <div className="mt-3 rounded-md border border-dashed border-border/60 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <Label className="text-xs">
                        {tr("add.transfer.fee.label", { sym: symbol })}
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setFeeOpen(false);
                          setFeeAmount("");
                          setFeeCategoryId("");
                        }}
                      >
                        {tr("add.transfer.fee.remove")}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {symbol}
                      </span>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={feeAmount}
                        onChange={(e) =>
                          setFeeAmount(e.target.value.replace(/[^0-9.,]/g, ""))
                        }
                        className="tabular-nums"
                      />
                    </div>
                    <div className="mt-2">
                      <Label className="mb-1 block text-xs">
                        {tr("add.transfer.fee.category")}
                      </Label>
                      <ChipPicker
                        items={categoryChips}
                        value={feeCategoryId || null}
                        onChange={(v) => setFeeCategoryId(v ?? "")}
                        placeholder={tr("add.select_category")}
                        moreLabel={tr("picker.more")}
                        searchPlaceholder={tr("picker.search")}
                        emptyLabel={tr("picker.no_match")}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {tr("add.transfer.fee.help")}
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setFeeOpen(true)}
                    className="mt-2 text-xs text-primary underline-offset-2 hover:underline"
                  >
                    + {tr("add.transfer.fee.add")}
                  </button>
                )
              )}
            </div>
          )}

          {/* Split toggle (expense/income only, not transfer). In edit mode,
              splitting a single tx is allowed unless it is a reimbursement
              settler; ungrouping an existing split is blocked. */}
          {type !== "transfer" && (
            <div className="flex items-center justify-between rounded-md border border-dashed border-border/60 px-3 py-2">
              <Label htmlFor="split-toggle" className="cursor-pointer text-sm font-normal">
                {tr("add.split.toggle")}
              </Label>
              <Toggle
                id="split-toggle"
                variant="outline"
                size="sm"
                pressed={splitMode}
                onPressedChange={(v: boolean) => {
                  if (v) {
                    if (isEdit && editAsSettlerLinks.length > 0) {
                      toast.error(tr("add.split.cannot_split_settler"));
                      return;
                    }
                    // Convert a single edit-mode tx into the first slice so
                    // it keeps its id (and reimbursement links/attachments).
                    if (isEdit && editQ.data && !editQ.data.tx.split_group_id) {
                      const t0 = editQ.data.tx;
                      setSlices([
                        {
                          id: t0.id,
                          amount: Number(t0.amount).toFixed(2),
                          categoryId: t0.category_id ?? "",
                          description: t0.description ?? "",
                          note: t0.note ?? "",
                          isReimbursable: !!t0.is_reimbursable,
                          reimbCounterparty: t0.reimbursable_counterparty ?? "",
                          reimbReason: t0.reimbursable_reason ?? "",
                        },
                        newSlice(),
                      ]);
                    }
                    setSplitMode(true);
                    return;
                  }
                  // Turning OFF
                  if (isEdit && editQ.data?.tx.split_group_id) {
                    toast.error(tr("add.split.cannot_ungroup"));
                    return;
                  }
                  setSplitMode(false);
                }}
                aria-label={tr("add.split.toggle")}
              >
                {splitMode ? tr("common.on") : tr("common.off")}
              </Toggle>
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
              {activeScope && !scopeSkipped && categoryId === activeScope.id && (
                <p className="mt-1 flex items-center gap-1 text-xs text-primary">
                  <Target className="h-3 w-3" /> {tr("add.scope.field_hint", { name: activeScope.name })}
                </p>
              )}
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
                        ctx={{
                          type,
                          sourceAccountId: sourceId || undefined,
                          categoryId: s.categoryId || undefined,
                          description: s.description || undefined,
                        }}
                      />
                      <TagChips
                        className="mt-2"
                        transactions={recentQ.data ?? []}
                        currentNote={s.note}
                        ctx={{
                          type,
                          sourceAccountId: sourceId || undefined,
                          categoryId: s.categoryId || undefined,
                          description: s.description || undefined,
                        }}
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
                    <div className="mt-3 rounded-md border border-dashed border-border/60 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Label className="text-xs font-medium">{tr("add.reimb.section")}</Label>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{tr("add.reimb.toggle.hint")}</p>
                        </div>
                        <Switch
                          checked={s.isReimbursable}
                          onCheckedChange={(v) =>
                            setSlices((cur) => cur.map((x, i) => (i === idx ? { ...x, isReimbursable: !!v } : x)))
                          }
                          aria-label={tr("add.reimb.toggle")}
                        />
                      </div>
                      {s.isReimbursable && (
                        <div className="mt-2 space-y-2">
                          <div>
                            <Label className="mb-1 block text-xs">{tr("add.reimb.counterparty")}</Label>
                            <StringAutocomplete
                              value={s.reimbCounterparty}
                              onChange={(v) =>
                                setSlices((cur) => cur.map((x, i) => (i === idx ? { ...x, reimbCounterparty: v } : x)))
                              }
                              options={reimbCpQ.data ?? []}
                            />
                          </div>
                          <div>
                            <Label className="mb-1 block text-xs">{tr("add.reimb.reason")}</Label>
                            <Input
                              value={s.reimbReason}
                              onChange={(e) =>
                                setSlices((cur) => cur.map((x, i) => (i === idx ? { ...x, reimbReason: e.target.value } : x)))
                              }
                            />
                          </div>
                          {type === "expense" && s.categoryId && (
                            <p className="text-[11px] text-warning">{tr("add.reimb.category_clear_warning")}</p>
                          )}
                        </div>
                      )}
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
            ctx={{
              type,
              sourceAccountId: sourceId || undefined,
              destAccountId: destId || undefined,
              categoryId: categoryId || undefined,
              description: description || undefined,
            }}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">{tr("common.markdown_hint")}</p>
          <TagChips
            className="mt-2"
            transactions={recentQ.data ?? []}
            currentNote={note}
            ctx={{
              type,
              sourceAccountId: sourceId || undefined,
              destAccountId: destId || undefined,
              categoryId: categoryId || undefined,
              description: description || undefined,
            }}
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

        {/* Reimbursable / lent-out section (not for transfers; per-slice in split mode) */}
        {type !== "transfer" && !splitMode && (
          <Card>
            <CardContent className="space-y-3 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label className="text-sm font-medium">{tr("add.reimb.section")}</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">{tr("add.reimb.toggle.hint")}</p>
                </div>
                <Switch
                  checked={isReimbursable}
                  onCheckedChange={(v) => setIsReimbursable(!!v)}
                  aria-label={tr("add.reimb.toggle")}
                />
              </div>
              {isReimbursable && (
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="reimb-cp" className="mb-1 block text-xs">{tr("add.reimb.counterparty")}</Label>
                    <StringAutocomplete
                      id="reimb-cp"
                      value={reimbCounterparty}
                      onChange={setReimbCounterparty}
                      options={reimbCpQ.data ?? []}
                    />
                  </div>
                  <div>
                    <Label htmlFor="reimb-reason" className="mb-1 block text-xs">{tr("add.reimb.reason")}</Label>
                    <Input
                      id="reimb-reason"
                      value={reimbReason}
                      onChange={(e) => setReimbReason(e.target.value)}
                      placeholder=""
                    />
                  </div>
                  {type === "expense" && categoryId && (
                    <p className="text-xs text-warning">{tr("add.reimb.category_clear_warning")}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Reimbursable-link card: subset-sum suggestion when we have a match,
            otherwise collapsed manual-link list. */}
        {!isEdit && type === "income" && linkCandidates.length > 0 && (() => {
          const matchedIds = new Set(suggestedMatch?.ids ?? []);
          const selectedTotal = Object.values(linkSelections).reduce((s, v) => s + (Number(v) || 0), 0);
          const hasSelection = Object.keys(linkSelections).length > 0;
          const incomeAmt = amountNum ?? 0;
          const diff = selectedTotal - incomeAmt;
          const absDiff = Math.abs(diff);
          const summaryKey = absDiff < 0.005
            ? "add.reimb.link.selected_summary.exact"
            : diff < 0
              ? "add.reimb.link.selected_summary.under"
              : "add.reimb.link.selected_summary.over";
          return (
            <Collapsible defaultOpen={!!suggestedMatch}>
              <Card className={suggestedMatch ? "border-warning/60 bg-warning/5" : ""}>
                <CardContent className="space-y-2 py-3">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 text-left"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <LinkIcon className="h-4 w-4" />
                        {suggestedMatch
                          ? tr("add.reimb.link.suggested_title", {
                              n: String(suggestedMatch.ids.length),
                              amount: fmtMoney(suggestedMatch.total, symbol),
                            })
                          : (
                            <>
                              <span>{tr("add.reimb.link.section_title")}</span>
                              <span className="text-xs font-normal text-muted-foreground">
                                {tr("add.reimb.link.count_label", { n: String(linkCandidates.length) })}
                              </span>
                            </>
                          )}
                      </div>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [&[data-state=open]]:rotate-180" />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2">
                    {!suggestedMatch && (
                      <p className="text-xs text-muted-foreground">{tr("add.reimb.link.no_match_hint")}</p>
                    )}
                    <ul className="space-y-1">
                      {linkCandidates.map((t) => {
                        const rem = remainingByOrig.get(t.id) ?? 0;
                        const checked = linkSelections[t.id] != null;
                        const acc = accountById.get(t.source_account_id);
                        const sym = acc?.currency_symbol ?? symbol;
                        const isMatched = matchedIds.has(t.id);
                        return (
                          <li
                            key={t.id}
                            className={cn(
                              "flex items-start gap-2 rounded-md px-2 py-1.5",
                              isMatched
                                ? "bg-warning/15 ring-1 ring-warning/60"
                                : "bg-background/60",
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                linkSelectionsTouchedRef.current = true;
                                setLinkSelections((cur) => {
                                  const next = { ...cur };
                                  if (v) next[t.id] = rem;
                                  else delete next[t.id];
                                  return next;
                                });
                              }}
                              className="mt-0.5"
                            />
                            <div className="min-w-0 flex-1 text-xs">
                              <div className="truncate font-medium">
                                {t.description || tr("add.expense")}
                                {t.reimbursable_counterparty && (
                                  <span className="ml-1 text-muted-foreground">
                                    {tr("add.reimb.autolink.from", { who: t.reimbursable_counterparty })}
                                  </span>
                                )}
                              </div>
                              <div className="text-muted-foreground">
                                {format(new Date(t.occurred_on + "T00:00:00"), "dd.MM.yyyy", { locale })} · {fmtMoney(rem, sym)}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {hasSelection && incomeAmt > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {tr(summaryKey, {
                          sel: fmtMoney(selectedTotal, symbol),
                          inc: fmtMoney(incomeAmt, symbol),
                          diff: fmtMoney(absDiff, symbol),
                        })}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {suggestedMatch && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            linkSelectionsTouchedRef.current = true;
                            const next: Record<string, number> = {};
                            suggestedMatch.ids.forEach((id) => { next[id] = remainingByOrig.get(id) ?? 0; });
                            setLinkSelections(next);
                          }}
                        >
                          {tr("add.reimb.link.link_suggested")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          linkSelectionsTouchedRef.current = true;
                          const next: Record<string, number> = {};
                          linkCandidates.forEach((t) => { next[t.id] = remainingByOrig.get(t.id) ?? 0; });
                          setLinkSelections(next);
                        }}
                      >
                        {tr("add.reimb.autolink.link_all")}
                      </Button>
                      {hasSelection && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            linkSelectionsTouchedRef.current = true;
                            setLinkSelections({});
                          }}
                        >
                          {tr("add.reimb.link.clear")}
                        </Button>
                      )}
                    </div>
                  </CollapsibleContent>
                </CardContent>
              </Card>
            </Collapsible>
          );
        })()}

        <div className="pt-2">
          {isEdit && editId ? (
            <AttachmentsSection transactionId={editId} />
          ) : (
            <AttachmentsSection
              draft
              items={draftAttachments}
              onItemsChange={setDraftAttachments}
            />
          )}
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

        <ImpactPreview
          type={type}
          amountNum={amountNum}
          destAmountNum={(() => {
            const n = Number(destAmount.replace(",", "."));
            return Number.isFinite(n) && n > 0 ? n : null;
          })()}
          feeAmountNum={(() => {
            if (type !== "transfer" || !feeOpen) return null;
            const n = Number(feeAmount.replace(",", "."));
            return Number.isFinite(n) && n > 0 ? n : null;
          })()}
          feeCategoryId={type === "transfer" && feeOpen ? feeCategoryId || null : null}
          source={sourceAccount ?? null}
          destination={destAccount ?? null}
          category={categoryId ? categoryById.get(categoryId) ?? null : null}
          date={date}
          splitMode={splitMode}
          slices={splitMode ? slices.map((s) => ({
            amount: Number(s.amount.replace(",", ".")) || 0,
            categoryId: s.categoryId || null,
          })) : null}
          categoryById={categoryById}
          balances={balancesQ.data ?? null}
          categoryRows={categoryMonthQ.data ?? null}
          savingsBalances={savingsBalancesQ.data ?? null}
          mainCode={settingsQ.data?.currency_code ?? "CHF"}
          mainSymbol={mainSymbol}
          fxRates={fxQ.data}
          editOriginal={isEdit ? editQ.data ?? null : null}
          tr={tr}
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

        {prefill?.statement_line && (
          <div className="pt-2 text-xs text-muted-foreground">{tr("statements.linking_hint")}</div>
        )}

        <div className="flex gap-2 pt-2">
          {isEdit ? (
            <>
              <Button variant="outline" className="flex-1" disabled={saving} onClick={() => navigate({ to: "/transactions" })}>{tr("common.cancel")}</Button>
              <Button className="flex-1" disabled={saving} onClick={() => save(false)}>{saving ? tr("common.saving") : tr("edit.save_changes")}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="flex-1" disabled={saving} onClick={() => save(false)}>{saving ? tr("common.saving") : tr("common.save")}</Button>
              <Button className="flex-1" disabled={saving} onClick={() => save(true)}>{tr("add.save_new")}</Button>
            </>
          )}
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
              <div className="mt-1 text-xs text-muted-foreground">
                <Markdown>{note.trim()}</Markdown>
              </div>
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

// ───────── Impact preview (compact) ─────────
// Shows how saving this transaction will change:
//   - source account balance
//   - destination account balance (transfers only)
//   - net worth (income/expense, or cross-currency transfer residual)
//   - affected category envelope(s) for the chosen month
// Pure presentation — reads from already-loaded queries.
type ImpactAccount = { id: string; name: string; currency_code?: string; currency_symbol?: string };
type ImpactCategory = { id: string; name: string; allocated_budget: number } | null;
function ImpactPreview({
  type, amountNum, destAmountNum, feeAmountNum, feeCategoryId,
  source, destination, category, date,
  splitMode, slices, categoryById,
  balances, categoryRows, savingsBalances, mainCode, mainSymbol, fxRates,
  editOriginal, tr,
}: {
  type: TxType;
  amountNum: number | null;
  destAmountNum: number | null;
  feeAmountNum: number | null;
  feeCategoryId: string | null;
  source: ImpactAccount | null;
  destination: ImpactAccount | null;
  category: ImpactCategory;
  date: Date;
  splitMode: boolean;
  slices: Array<{ amount: number; categoryId: string | null }> | null;
  categoryById: Map<string, { id: string; name: string; allocated_budget: number }>;
  balances: AccountBalance[] | null;
  categoryRows: CategoryMonthRow[] | null;
  savingsBalances: CategorySavingsBalanceV2[] | null;
  mainCode: string;
  mainSymbol: string;
  fxRates: FxRates | undefined;
  editOriginal: { tx: Transaction; group: Transaction[] | null } | null;
  tr: (k: string, p?: Record<string, string>) => string;
}) {
  if (!source || amountNum == null || amountNum <= 0) return null;

  const balById = new Map((balances ?? []).map((b) => [b.id, b]));
  const rowByCat = new Map((categoryRows ?? []).map((r) => [r.category_id, r]));

  // Per-account signed delta in account's native currency.
  const accDelta = new Map<string, number>();
  const add = (id: string | null | undefined, v: number) => {
    if (!id) return;
    accDelta.set(id, (accDelta.get(id) ?? 0) + v);
  };
  if (type === "expense") add(source.id, -amountNum);
  else if (type === "income") add(source.id, +amountNum);
  else if (type === "transfer") {
    add(source.id, -amountNum);
    add(destination?.id ?? null, destAmountNum != null && destAmountNum > 0 ? destAmountNum : amountNum);
  }
  if (feeAmountNum != null) add(source.id, -feeAmountNum);

  // Back-out original effect on edit so "before" represents balance w/o this tx.
  const original = editOriginal?.tx;
  const originalGroup = editOriginal?.group;
  const originalEffects = new Map<string, number>();
  const ogAdd = (id: string | null | undefined, v: number) => {
    if (!id) return;
    originalEffects.set(id, (originalEffects.get(id) ?? 0) + v);
  };
  if (original) {
    if (originalGroup && originalGroup.length > 1) {
      // Split — sum siblings on source account (all same source/type).
      const total = originalGroup.reduce((s, x) => s + Number(x.amount), 0);
      if (original.type === "expense") ogAdd(original.source_account_id, -total);
      else if (original.type === "income") ogAdd(original.source_account_id, +total);
    } else {
      const a = Number(original.amount);
      if (original.type === "expense") ogAdd(original.source_account_id, -a);
      else if (original.type === "income") ogAdd(original.source_account_id, +a);
      else if (original.type === "transfer") {
        ogAdd(original.source_account_id, -a);
        ogAdd(original.destination_account_id, original.destination_amount != null ? Number(original.destination_amount) : a);
      }
      if (original.fee_amount != null && Number(original.fee_amount) > 0) {
        ogAdd(original.source_account_id, -Number(original.fee_amount));
      }
    }
  }

  // Account rows
  const accountIds = Array.from(new Set([source.id, ...(destination ? [destination.id] : [])]));
  const accountRows = accountIds.map((id) => {
    const b = balById.get(id);
    const acc = id === source.id ? source : destination!;
    const sym = b?.currency_symbol ?? acc.currency_symbol ?? mainSymbol;
    const current = Number(b?.balance ?? 0);
    const before = current - (originalEffects.get(id) ?? 0);
    const after = before + (accDelta.get(id) ?? 0);
    return { id, name: acc.name, sym, before, after };
  });

  // Net worth delta in main currency. Sum per-account delta converted; for
  // accounts excluded from net worth we'd skip — but assume all accounts count.
  const toMain = (v: number, code: string | undefined): number | null => {
    const c = code ?? mainCode;
    if (c === mainCode) return v;
    const r = convert(v, c, mainCode, fxRates);
    return r == null ? null : r;
  };
  let netDelta = 0;
  let netDeltaUnknown = false;
  let netBefore = 0;
  for (const b of balances ?? []) {
    if (b.archived) continue;
    const conv = toMain(Number(b.balance), b.currency_code);
    if (conv == null) { netDeltaUnknown = true; } else { netBefore += conv; }
  }
  // Back out original net effect from netBefore
  for (const [id, eff] of originalEffects) {
    const b = balById.get(id);
    const conv = toMain(eff, b?.currency_code);
    if (conv == null) netDeltaUnknown = true; else netBefore -= conv;
  }
  for (const [id, d] of accDelta) {
    const b = balById.get(id);
    const conv = toMain(d, b?.currency_code);
    if (conv == null) netDeltaUnknown = true; else netDelta += conv;
  }
  const netAfter = netBefore + netDelta;

  // Category rows. For splits, one per slice category; else single category.
  // Sign follows `category_month_spending.spent_or_received` convention:
  //  - income kind:   income → +amount, expense → -amount
  //  - expense/savings kind: expense → +amount, income (refund) → -amount
  // So an income posted to an expense category reduces "spent" and
  // increases "remaining" (reimbursement / refund case).
  // Drift category in source currency assumed = main currency for the budget
  // view (budgets are in main currency in this app).
  type CatItem = {
    id: string; name: string; allocated: number; before: number; after: number;
    isSavings: boolean; savedBefore: number; savedAfter: number;
  };
  const catImpacts = new Map<string, number>();
  // Savings envelopes follow the DB convention in category_savings_balance_v2:
  // income credits the envelope (+), expense withdraws from it (−) — the
  // opposite sign of the month "spent" convention above.
  const savImpacts = new Map<string, number>();
  const savSign = (txType: TxType): number => (txType === "income" ? 1 : -1);
  const catSign = (catId: string, txType: TxType): number => {
    const kind = rowByCat.get(catId)?.kind ?? "expense";
    if (kind === "income") return txType === "income" ? 1 : -1;
    return txType === "income" ? -1 : 1;
  };
  if (type !== "transfer") {
    if (splitMode && slices) {
      for (const s of slices) {
        if (!s.categoryId || s.amount <= 0) continue;
        catImpacts.set(s.categoryId, (catImpacts.get(s.categoryId) ?? 0) + s.amount * catSign(s.categoryId, type));
        savImpacts.set(s.categoryId, (savImpacts.get(s.categoryId) ?? 0) + s.amount * savSign(type));
      }
    } else if (category) {
      catImpacts.set(category.id, amountNum * catSign(category.id, type));
      savImpacts.set(category.id, amountNum * savSign(type));
    }
  }
  // Fee creates an extra expense in feeCategory on transfers.
  if (feeAmountNum != null && feeCategoryId) {
    catImpacts.set(feeCategoryId, (catImpacts.get(feeCategoryId) ?? 0) + feeAmountNum * catSign(feeCategoryId, "expense"));
    savImpacts.set(feeCategoryId, (savImpacts.get(feeCategoryId) ?? 0) + feeAmountNum * savSign("expense"));
  }
  // Back out original category spent for same month
  const sameMonth = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth();
  };
  const ogCatImpacts = new Map<string, number>();
  // Same as ogCatImpacts but across all months — cumulative savings balances
  // are not month-scoped, so an edit must be backed out regardless of date.
  const ogCatImpactsAll = new Map<string, number>();
  const ogSavImpactsAll = new Map<string, number>();
  if (original) {
    const rows = originalGroup && originalGroup.length > 1 ? originalGroup : [original];
    for (const r of rows) {
      if (r.type === "transfer") continue;
      if (!r.category_id) continue;
      const v = Number(r.amount) * catSign(r.category_id, r.type);
      ogCatImpactsAll.set(r.category_id, (ogCatImpactsAll.get(r.category_id) ?? 0) + v);
      ogSavImpactsAll.set(
        r.category_id,
        (ogSavImpactsAll.get(r.category_id) ?? 0) + Number(r.amount) * savSign(r.type),
      );
      if (!sameMonth(r.occurred_on)) continue;
      ogCatImpacts.set(r.category_id, (ogCatImpacts.get(r.category_id) ?? 0) + v);
    }
    if (original.fee_amount != null && Number(original.fee_amount) > 0 && original.fee_category_id) {
      const fv = Number(original.fee_amount) * catSign(original.fee_category_id, "expense");
      ogCatImpactsAll.set(original.fee_category_id, (ogCatImpactsAll.get(original.fee_category_id) ?? 0) + fv);
      ogSavImpactsAll.set(
        original.fee_category_id,
        (ogSavImpactsAll.get(original.fee_category_id) ?? 0) + Number(original.fee_amount) * savSign("expense"),
      );
      if (sameMonth(original.occurred_on)) {
        ogCatImpacts.set(original.fee_category_id, (ogCatImpacts.get(original.fee_category_id) ?? 0) + fv);
      }
    }
  }
  const catRows: CatItem[] = [];
  const savedByCat = new Map((savingsBalances ?? []).map((s) => [s.category_id, Number(s.cumulative_balance) || 0]));
  const allCatIds = new Set<string>([...catImpacts.keys(), ...ogCatImpacts.keys()]);
  for (const id of allCatIds) {
    const meta = categoryById.get(id);
    if (!meta) continue;
    const row = rowByCat.get(id);
    const currentSpent = Number(row?.spent_or_received ?? 0);
    const before = currentSpent - (ogCatImpacts.get(id) ?? 0);
    const after = before + (catImpacts.get(id) ?? 0);
    const isSavings = (row?.kind ?? "expense") === "savings" || savedByCat.has(id);
    const savedNow = savedByCat.get(id) ?? 0;
    const savedBefore = savedNow - (ogSavImpactsAll.get(id) ?? 0);
    const savedAfter = savedBefore + (savImpacts.get(id) ?? 0);
    catRows.push({
      id, name: meta.name,
      allocated: Number(row?.allocated ?? meta.allocated_budget ?? 0),
      before, after, isSavings, savedBefore, savedAfter,
    });
  }

  // Date hint
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cmpDate = new Date(date); cmpDate.setHours(0, 0, 0, 0);
  const hint = cmpDate < today ? tr("add.impact.hint_past")
    : cmpDate > today ? tr("add.impact.hint_future")
    : null;

  // Cross-currency hint
  const xCur = type === "transfer" && source && destination &&
    (source.currency_code ?? mainCode) !== (destination.currency_code ?? mainCode);

  const fmt = (v: number, sym: string) => fmtMoney(v, sym);
  const deltaStr = (v: number, sym: string) => {
    const s = v >= 0 ? "+" : "−";
    return `${s}${fmtMoney(Math.abs(v), sym)}`;
  };

  const showNetWorth = type !== "transfer" || xCur;

  return (
    <Card className="border-dashed">
      <CardContent className="px-3 py-2 text-xs">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {tr("add.impact.title")}
        </div>
        <ul className="space-y-1">
          {accountRows.map((r) => {
            const delta = r.after - r.before;
            return (
              <li key={r.id} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-muted-foreground">
                  {tr("add.impact.account")} · {r.name}
                </span>
                <span className="tabular-nums">
                  {fmt(r.before, r.sym)} → <span className="font-medium text-foreground">{fmt(r.after, r.sym)}</span>{" "}
                  <span className={cn(delta >= 0 ? "text-success" : "text-destructive")}>({deltaStr(delta, r.sym)})</span>
                </span>
              </li>
            );
          })}
          {showNetWorth && !netDeltaUnknown && (
            <li className="flex items-baseline justify-between gap-3">
              <span className="truncate text-muted-foreground">{tr("add.impact.networth")}</span>
              <span className="tabular-nums">
                {fmt(netBefore, mainSymbol)} → <span className="font-medium text-foreground">{fmt(netAfter, mainSymbol)}</span>{" "}
                <span className={cn(netDelta >= 0 ? "text-success" : "text-destructive")}>({deltaStr(netDelta, mainSymbol)})</span>
              </span>
            </li>
          )}
          {catRows.map((r) => {
            const hasBudget = r.allocated > 0;
            const remBefore = r.allocated - r.before;
            const remAfter = r.allocated - r.after;
            return (
              <li key={"cat-" + r.id} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-muted-foreground">
                  {tr("add.impact.category")} · {r.name}
                </span>
                <span className="tabular-nums">
                  {r.isSavings ? (
                    <>
                      {tr("add.impact.saved")}: {fmt(r.savedBefore, mainSymbol)} →{" "}
                      <span className={cn("font-medium", r.savedAfter < 0 ? "text-destructive" : "text-foreground")}>
                        {fmt(r.savedAfter, mainSymbol)}
                      </span>
                    </>
                  ) : hasBudget ? (
                    <>
                      {tr("add.impact.remaining")}: {fmt(remBefore, mainSymbol)} →{" "}
                      <span className={cn("font-medium", remAfter < 0 ? "text-destructive" : "text-foreground")}>
                        {fmt(remAfter, mainSymbol)}
                      </span>{" "}
                      <span className="text-muted-foreground">{tr("add.impact.of", { x: fmtMoney(r.allocated, mainSymbol) })}</span>
                    </>
                  ) : (
                    <>
                      {tr("add.impact.spent")}: {fmt(r.before, mainSymbol)} →{" "}
                      <span className="font-medium text-foreground">{fmt(r.after, mainSymbol)}</span>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {(hint || xCur) && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {hint}
            {hint && xCur ? " · " : ""}
            {xCur ? tr("add.impact.hint_fx") : ""}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
