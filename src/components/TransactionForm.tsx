import { formatAmountInput } from "@/lib/amountInput";
import { useDateFormat } from "@/lib/dateFormat";
import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { ArrowDown, ArrowUp, ArrowLeftRight, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { notifyTransactionCreated } from "@/utils/webhooks.functions";
import { resolveStatementLine } from "@/utils/statements.functions";
import {
  fetchAccounts,
  fetchCategories,
  fetchCategoryGroups,
  fetchSettings,
  fetchOpenReimbursables,
  fetchReimbursementLinks,
  fetchReimbursementCounterpartyUses,
  linkReimbursement,
  extractTags,
  fmtMoney,
  type TxType,
  type Transaction,
  type ReimbursementLink,
} from "@/lib/finance";
import {
  fetchAccountBalances,
  fetchCategoryMonthRows,
  monthKey,
  type AccountBalance,
  type CategoryMonthRow,
} from "@/lib/finance";
import { fetchSavingsBalances, type CategorySavingsBalance } from "@/lib/finance";
import { markPendingConfirmed } from "@/lib/finance";
import {
  fetchPreviewImpact,
  fetchTransactionsByIds,
  type PreviewImpactRow,
  type PreviewOp,
} from "@/lib/finance";
import { applyRefundLinks, fetchRefundCandidates } from "@/lib/finance";
import { RefundCard } from "@/components/RefundCard";
import {
  defaultDecision,
  pickIssue,
  planIncomeParts,
  refundLinksPayload,
  refundPreviewOps,
  type PreviewExpense,
  type RefundPicks,
} from "@/lib/refundPlan";
import { ReimbursementPayments } from "@/components/ReimbursementPayments";
import { EntityVisual } from "@/components/EntityVisual";
import { AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { StringAutocomplete } from "@/components/StringAutocomplete";
import { Toggle } from "@/components/ui/toggle";
import { useI18n } from "@/i18n";
import { useSuggestions } from "@/lib/suggestions/useSuggestions";
import type { Suggestion } from "@/lib/suggestions/types";
import { SuggestionRow } from "@/components/SuggestionRow";
import { QuickAmountChips } from "@/components/QuickAmountChips";
import { TagChips } from "@/components/TagChips";
import { TagAutocompleteTextarea } from "@/components/TagAutocomplete";
import { DateShortcuts } from "@/components/DateShortcuts";
import { ChipPicker, type ChipPickerItem } from "@/components/ChipPicker";
import {
  rankCounterparties,
  scoreAccounts,
  scoreCategories,
  sortByPinAndScore,
  type SuggestionContext,
} from "@/lib/usageScoring";
import { DayHeatmapCalendar } from "@/components/DayHeatmapCalendar";
import { DateInput } from "@/components/DateInput";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { DescriptionAutocomplete } from "@/components/DescriptionAutocomplete";
import { useRecentTransactions } from "@/hooks/useRecentTransactions";
import { AttachmentsSection, type DraftAttachment } from "@/components/AttachmentsSection";
import { TransactionStatementRow } from "@/components/StatementDocLink";
import { Markdown } from "@/components/Markdown";
import { useFxRates, convert } from "@/lib/fx";
import { clampLinkAmounts } from "@/lib/reimbMatch";
import type { FxRates } from "@/lib/fx";
import { fetchScopes } from "@/lib/finance";
import { useActiveScopeId } from "@/lib/activeScope";
import { Target } from "lucide-react";
import { LocationSection, type RecentLocation } from "@/components/LocationSection";
import { useRecentLocations } from "@/hooks/useRecentLocations";
import { rankLocationCandidates } from "@/lib/locationSuggest";
import {
  getCurrentLocation,
  isToday as dateIsTodayFn,
  locationFromRow,
  locationToColumns,
  type TxLocation,
} from "@/lib/location";

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
  /** Assistant draft explicitly chose its own category instead of the active scope. */
  ignore_scope?: boolean;
  /** Statement import line this entry closes; linked back after save. */
  statement_line?: string;
  statement_import?: string;
  /**
   * Pending row this entry closes — set when /pending sends a row here to be
   * split. Retired against the saved transaction afterwards.
   */
  pending_id?: string;
  /** Place the entry happened at, e.g. the one a pending row carries. */
  location?: TxLocation;
  /** Transfer target account, and what it received when that differs. */
  destination?: string;
  destination_amount?: string;
}

export function TransactionForm({
  editId,
  prefill,
  backSearch,
  backTo = "transactions",
}: {
  editId: string | null;
  prefill?: AddPrefill;
  backSearch?: Record<string, unknown>;
  /** Where save and cancel return to; `backSearch` is that page's search. */
  backTo?: "transactions" | "envelopes";
}) {
  const { t: tr, locale, lang } = useI18n();
  const dateFmt = useDateFormat();
  const navigate = useNavigate();
  // A closed scope reopens in the database when a save changes its money. Say
  // so: the scopes this booking touched that were closed before and are not now.
  const noticeReopenedScopes = async () => {
    const before = (categoriesQ.data ?? []).filter((c) => c.is_scope && c.closed_at);
    if (before.length === 0) return;
    const touched = new Set<string>();
    const og = editQ.data;
    if (og)
      for (const r of og.group && og.group.length > 1 ? og.group : [og.tx])
        if (r.category_id) touched.add(r.category_id);
    if (categoryId) touched.add(categoryId);
    for (const sl of slices) if (sl.categoryId) touched.add(sl.categoryId);
    const candidates = before.filter((c) => touched.has(c.id));
    if (candidates.length === 0) return;
    const { data } = await supabase
      .from("categories")
      .select("id, closed_at")
      .in(
        "id",
        candidates.map((c) => c.id),
      );
    for (const c of candidates) {
      if ((data ?? []).some((d) => d.id === c.id && !d.closed_at)) {
        toast.info(tr("toast.scope_reopened", { name: c.name }));
      }
    }
  };
  const goBack = () =>
    navigate({
      to: backTo === "envelopes" ? "/envelopes" : "/transactions",
      search: (backSearch ?? {}) as never,
    });
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
        await linkStatementLineFn({
          data: { line_id: lineId, decision: "link", transaction_id: txId },
        });
        toast.success(tr("statements.toast.linked"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
      navigate({
        to: "/statements",
        search: prefill?.statement_import
          ? ({ import: prefill.statement_import } as never)
          : undefined,
      });
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefill?.statement_line, prefill?.statement_import],
  );
  // Opened from /pending to be split: retire the pending row against what was
  // saved, so it leaves the Pending tab instead of sitting there as a duplicate
  // of the split that just replaced it.
  const linkPendingRow = React.useCallback(
    async (txId: string): Promise<boolean> => {
      const pendingId = prefill?.pending_id;
      if (!pendingId) return false;
      try {
        await markPendingConfirmed(pendingId, txId);
        toast.success(tr("pending.toast.confirmed"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
      navigate({ to: "/pending" });
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefill?.pending_id],
  );
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const groupsQ = useQuery({ queryKey: ["category_groups"], queryFn: fetchCategoryGroups });
  const recentQ = useRecentTransactions();
  const openReimbQ = useQuery({
    queryKey: ["reimbursables", "open"],
    queryFn: fetchOpenReimbursables,
  });
  const reimbLinksQ = useQuery({
    queryKey: ["reimbursement_links"],
    queryFn: fetchReimbursementLinks,
  });
  // Names for "from whom" / "to whom": most used first, recent use counting more.
  const reimbCpQ = useQuery({
    queryKey: ["reimbursement_counterparties"],
    queryFn: async () => rankCounterparties(await fetchReimbursementCounterpartyUses()),
  });
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
  const accountById = React.useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const [type, setType] = React.useState<TxType>("expense");
  const [amount, setAmount] = React.useState("");
  const [sourceId, setSourceId] = React.useState<string>("");
  const [destId, setDestId] = React.useState<string>("");
  const [categoryId, setCategoryId] = React.useState<string>("");
  const [description, setDescription] = React.useState("");
  const [note, setNote] = React.useState("");

  // ───────── Location ─────────
  const [location, setLocation] = React.useState<TxLocation | null>(null);
  // Set as soon as the user edits the location by hand, so auto-capture and
  // date changes never overwrite a deliberate choice.
  const locationTouchedRef = React.useRef(false);
  const setLocationManual = React.useCallback((loc: TxLocation | null) => {
    locationTouchedRef.current = true;
    setLocation(loc);
  }, []);
  const recentLocationsQ = useRecentLocations();
  // Same description first, then nearest to the point already picked — with
  // several branches of one chain in the list, distance is what tells them apart.
  const recentLocations = React.useMemo<RecentLocation[]>(
    () =>
      rankLocationCandidates(recentLocationsQ.data ?? [], {
        description,
        near: location,
      }),
    [recentLocationsQ.data, description, location],
  );

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
      id: a.id,
      name: a.name,
      icon: a.icon,
      emoji: a.emoji,
      image_url: a.image_url,
      color: a.color,
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
      id: c.id,
      name: c.name,
      icon: c.icon,
      emoji: c.emoji,
      image_url: c.image_url,
      color: c.color,
      pinned: c.pinned,
    }));
  }, [categories, recentQ.data, type, sourceId, destId, description]);

  // Where a transfer's difference can go: budgets that keep their balance.
  const rollingCategoryChips: ChipPickerItem[] = React.useMemo(() => {
    const rolling = new Set(categories.filter((c) => c.rolls_over && !c.is_scope).map((c) => c.id));
    return categoryChips.filter((c) => rolling.has(c.id));
  }, [categories, categoryChips]);

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
  // For incomes: the expenses it repays, with what the user decided about each
  // (src/lib/refundPlan.ts). Split lines carry their own in Slice.refunds.
  const [refundPicks, setRefundPicks] = React.useState<RefundPicks>({});
  const [refundTouched, setRefundTouched] = React.useState(false);
  const [refundQuery, setRefundQuery] = React.useState("");
  const [refundCounterparty, setRefundCounterparty] = React.useState("");
  // The split line whose "Zahlt Ausgaben zurück" card is open.
  const [refundSliceOpen, setRefundSliceOpen] = React.useState<string | null>(null);
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

  // Same-currency transfer that received more than it paid (a gift card bought
  // at a discount): the amount received and the budget the difference goes to.
  // Saved as destination_amount + difference_category_id; a database trigger
  // books the difference into that budget. Receiving less is a fee instead.
  const [diffOpen, setDiffOpen] = React.useState(false);
  const [received, setReceived] = React.useState("");
  const [diffCategoryId, setDiffCategoryId] = React.useState<string>("");

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
    const conv = convert(n, sourceAccount!.currency_code, destAccount!.currency_code, fxQ.data);
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
      setDiffOpen(false);
      setReceived("");
      setDiffCategoryId("");
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
    /** Income lines: the expenses this line repays. */
    refunds: RefundPicks;
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
    refunds: {},
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
    prev: {
      amount: string;
      description: string;
      note: string;
      sourceId: string;
      categoryId: string;
      location: TxLocation | null;
      locationTouched: boolean;
    };
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
  const [scopeSkipped, setScopeSkipped] = React.useState(() => !!prefill?.ignore_scope);
  React.useEffect(() => {
    if (!activeScope || scopeSkipped || isEdit || prefill?.ignore_scope) return;
    if (type === "transfer") return;
    if (!categoryId) setCategoryId(activeScope.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScope?.id, scopeSkipped, isEdit, type, prefill?.ignore_scope]);

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
    setLocation(locationFromRow(tx));
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
          refunds: {},
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
        // Same currency: only a "received more" transfer has one. The section
        // only shows when the currencies match, so this is harmless for FX.
        setReceived(Number(tx.destination_amount).toFixed(2));
        setDiffOpen(true);
      }
      setDiffCategoryId(tx.difference_category_id ?? "");
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
  // Set when the link named the account. The default below runs in the same
  // commit as the prefill and still sees the empty account from before it, so
  // without this it would pick the most-used account over the one asked for.
  const accountFromPrefillRef = React.useRef(false);
  React.useEffect(() => {
    if (isEdit || prefillAppliedRef.current || !prefill) return;
    const anyField =
      prefill.type ||
      prefill.amount ||
      prefill.source ||
      prefill.counterparty ||
      prefill.reimburse_for ||
      prefill.account_name ||
      prefill.category ||
      prefill.category_name ||
      prefill.description ||
      prefill.note ||
      prefill.occurred_on ||
      prefill.iou_with ||
      prefill.iou_amount ||
      prefill.location ||
      prefill.destination;
    if (!anyField) return;
    // Wait until accounts/categories are loaded so name-based prefill can resolve.
    if (
      (prefill.account_name || prefill.category_name) &&
      (accounts.length === 0 || categories.length === 0)
    )
      return;
    prefillAppliedRef.current = true;
    if (prefill.type) setType(prefill.type);
    if (prefill.amount) {
      setAmount(prefill.amount);
      mark("amount");
    }
    if (prefill.source) {
      accountFromPrefillRef.current = true;
      setSourceId(prefill.source);
      mark("sourceId");
    }
    if (prefill.counterparty) setReimbCounterparty(prefill.counterparty);
    if (!prefill.source && prefill.account_name) {
      const needle = prefill.account_name.toLowerCase();
      const match =
        accounts.find((a) => a.name.toLowerCase() === needle) ||
        accounts.find((a) => a.name.toLowerCase().includes(needle));
      if (match) {
        accountFromPrefillRef.current = true;
        setSourceId(match.id);
        mark("sourceId");
      }
    }
    if (prefill.category) {
      setCategoryId(prefill.category);
    } else if (prefill.category_name) {
      const needle = prefill.category_name.toLowerCase();
      const match =
        categories.find((c) => c.name.toLowerCase() === needle) ||
        categories.find((c) => c.name.toLowerCase().includes(needle));
      if (match) setCategoryId(match.id);
    }
    if (prefill.description) setDescription(prefill.description);
    if (prefill.note) setNote(prefill.note);
    if (prefill.location) setLocationManual(prefill.location);
    if (prefill.destination) setDestId(prefill.destination);
    if (prefill.destination_amount) {
      setDestAmount(prefill.destination_amount);
      setDestAmountTouched(true);
    }
    if (prefill.occurred_on) {
      const d = new Date(prefill.occurred_on);
      if (!Number.isNaN(d.getTime())) setDate(d);
    }
    if (prefill.iou_with || prefill.iou_amount) {
      setIsReimbursable(true);
      if (prefill.iou_with) setReimbCounterparty(prefill.iou_with);
      if (prefill.iou_amount) {
        const cur = prefill.iou_with
          ? ` (${prefill.iou_with}: ${prefill.iou_amount})`
          : ` (owed: ${prefill.iou_amount})`;
        setReimbReason((prev) => (prev ? prev : `Share owed${cur}`));
      }
    }
    // The actual link selection happens when openReimbQ has loaded — see
    // the auto-link effect below.
  }, [isEdit, prefill, accounts, categories, setLocationManual]);

  // Default source = most-used account in recent transactions (skip in edit mode)
  React.useEffect(() => {
    if (isEdit || accountFromPrefillRef.current) return;
    if (sourceId || accounts.length === 0) return;
    const counts = new Map<string, number>();
    (recentQ.data ?? []).forEach((t) =>
      counts.set(t.source_account_id, (counts.get(t.source_account_id) ?? 0) + 1),
    );
    let best = accounts[0]?.id;
    let bestN = -1;
    for (const a of accounts) {
      const n = counts.get(a.id) ?? 0;
      if (n > bestN) {
        bestN = n;
        best = a.id;
      }
    }
    if (best) setSourceId(best);
  }, [accounts, recentQ.data, sourceId, isEdit]);

  const amountNum = React.useMemo(() => {
    const n = Number(amount.replace(",", "."));
    return isFinite(n) && n > 0 ? n : null;
  }, [amount]);

  // ───────── Expenses an income repays ("Zahlt Ausgaben zurück") ─────────
  // The rows that make up the entry being edited; their links are this entry's
  // own, everything else counts as already repaid elsewhere.
  const entryRowIds = React.useMemo(() => {
    const og = editQ.data;
    if (!isEdit || !og) return new Set<string>();
    return new Set((og.group && og.group.length > 0 ? og.group : [og.tx]).map((r) => r.id));
  }, [isEdit, editQ.data]);
  // Per expense: what other incomes already pay towards it.
  const linkedElsewhere = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const l of reimbLinksQ.data ?? []) {
      if (entryRowIds.has(l.settling_transaction_id)) continue;
      m.set(l.original_transaction_id, (m.get(l.original_transaction_id) ?? 0) + Number(l.amount));
    }
    return m;
  }, [reimbLinksQ.data, entryRowIds]);
  // Per income row of this entry: the expenses it repaid when the form opened.
  const existingLinksByRow = React.useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const l of reimbLinksQ.data ?? []) {
      if (!entryRowIds.has(l.settling_transaction_id)) continue;
      const row = m.get(l.settling_transaction_id) ?? new Map<string, number>();
      row.set(
        l.original_transaction_id,
        (row.get(l.original_transaction_id) ?? 0) + Number(l.amount),
      );
      m.set(l.settling_transaction_id, row);
    }
    return m;
  }, [reimbLinksQ.data, entryRowIds]);

  // The lines of the income that can repay expenses: the whole income, or
  // each split line. `rowId` is the existing row when editing.
  type RefundLine = {
    key: string;
    rowId: string | null;
    amount: number;
    categoryId: string | null;
    picks: RefundPicks;
  };
  const refundLines = React.useMemo<RefundLine[]>(() => {
    if (type !== "income") return [];
    if (splitMode) {
      return slices.map((s) => ({
        key: s.id,
        rowId: entryRowIds.has(s.id) ? s.id : null,
        amount: Number(s.amount.replace(",", ".")) || 0,
        categoryId: s.categoryId || null,
        picks: s.refunds,
      }));
    }
    return [
      {
        key: "single",
        rowId: isEdit && editId ? editId : null,
        amount: amountNum ?? 0,
        categoryId: categoryId || null,
        picks: refundPicks,
      },
    ];
  }, [type, splitMode, slices, entryRowIds, isEdit, editId, amountNum, categoryId, refundPicks]);

  // Expenses to show: search results in the income's currency, plus the ones
  // ticked or linked already (which a search may not return).
  const [refundQueryDebounced, setRefundQueryDebounced] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setRefundQueryDebounced(refundQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [refundQuery]);
  const incomeCurrency = sourceAccount?.currency_code ?? null;
  const refundAccountIds = React.useMemo(() => {
    const all = accountsQ.data ?? [];
    return {
      same: all
        .filter((a) => a.currency_code === incomeCurrency)
        .map((a) => a.id)
        .sort(),
      other: all
        .filter((a) => a.currency_code !== incomeCurrency)
        .map((a) => a.id)
        .sort(),
    };
  }, [accountsQ.data, incomeCurrency]);
  const refundSearchQ = useQuery({
    queryKey: [
      "refund_candidates",
      refundAccountIds.same,
      refundAccountIds.other,
      refundQueryDebounced,
    ],
    queryFn: () =>
      fetchRefundCandidates({
        accountIds: refundAccountIds.same,
        otherAccountIds: refundAccountIds.other,
        query: refundQueryDebounced,
      }),
    enabled: type === "income" && !!incomeCurrency,
    staleTime: 30_000,
  });
  const refundKnownIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const row of existingLinksByRow.values()) for (const id of row.keys()) ids.add(id);
    for (const line of refundLines) for (const id of Object.keys(line.picks)) ids.add(id);
    return [...ids].sort();
  }, [existingLinksByRow, refundLines]);
  const refundKnownQ = useQuery({
    queryKey: ["transactions_by_ids", refundKnownIds],
    queryFn: () => fetchTransactionsByIds(refundKnownIds),
    enabled: type === "income" && refundKnownIds.length > 0,
  });
  const refundExpenseById = React.useMemo(() => {
    const m = new Map<string, Transaction>();
    for (const t of refundKnownQ.data ?? []) m.set(t.id, t);
    for (const t of refundSearchQ.data?.rows ?? []) if (!m.has(t.id)) m.set(t.id, t);
    return m;
  }, [refundKnownQ.data, refundSearchQ.data]);
  const refundCandidates = React.useMemo(
    () => [...refundExpenseById.values()],
    [refundExpenseById],
  );
  // What each expense can still take from one line: its amount, less what
  // other incomes and the other lines of this one pay towards it.
  const refundOpenFor = React.useCallback(
    (lineKey: string) => {
      const m = new Map<string, number>();
      for (const t of refundCandidates) {
        let other = linkedElsewhere.get(t.id) ?? 0;
        for (const line of refundLines)
          if (line.key !== lineKey) other += Number(line.picks[t.id]?.amount) || 0;
        m.set(t.id, Math.max(0, Math.round((Number(t.amount) - other) * 100) / 100));
      }
      return m;
    },
    [refundCandidates, linkedElsewhere, refundLines],
  );
  const refundExistingFor = React.useCallback(
    (rowId: string | null) =>
      new Set(rowId ? [...(existingLinksByRow.get(rowId)?.keys() ?? [])] : []),
    [existingLinksByRow],
  );
  const refundLockedFor = React.useCallback(
    (rowId: string | null) => {
      const out = new Set<string>();
      for (const id of refundExistingFor(rowId)) {
        const st = refundExpenseById.get(id)?.reimbursable_status;
        if (st === "written_off" || st === "cancelled") out.add(id);
      }
      return out;
    },
    [refundExistingFor, refundExpenseById],
  );

  // The income's rows as they will be saved: each line in parts, one per
  // category; the first part of a line keeps the line's row.
  const refundPlan = React.useMemo(
    () =>
      refundLines.map((line) => ({
        line,
        parts: planIncomeParts(line.amount, line.categoryId, line.picks, refundOpenFor(line.key)),
      })),
    [refundLines, refundOpenFor],
  );
  // Something that cannot be saved yet: an i18n key, or null.
  const refundIssue = React.useMemo(() => {
    for (const { line } of refundPlan) {
      const open = refundOpenFor(line.key);
      const locked = refundLockedFor(line.rowId);
      for (const [id, pick] of Object.entries(line.picks)) {
        if (locked.has(id)) continue;
        const issue = pickIssue(open.get(id) ?? Number(pick.amount), pick);
        if (issue) return issue;
      }
      const linked = Object.values(line.picks).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      if (line.amount > 0 && linked > line.amount + 0.005) return "refund.issue.over";
    }
    return null;
  }, [refundPlan, refundOpenFor, refundLockedFor]);
  const hasNewRefundPick = refundLines.some((l) => Object.values(l.picks).some((p) => p.decision));
  const refundBlocks = type === "income" && refundTouched && refundIssue != null;
  // The category the booking shows: for an income whose picks decide it, the
  // first of its parts (the impact card's figures come from the database).
  const previewCategoryId =
    type === "income" && !splitMode && hasNewRefundPick
      ? (refundPlan[0]?.parts[0]?.categoryId ?? null)
      : categoryId || null;
  const refundCategoryOptions = React.useMemo(
    () => categories.map((c) => ({ id: c.id, name: c.name })),
    [categories],
  );
  /** The "Zahlt Ausgaben zurück" card for one line of the income. */
  const renderRefundCard = (
    line: RefundLine,
    onChange: (next: RefundPicks) => void,
    extra: {
      surplusCategoryId: string | null;
      onSurplusCategoryChange: (id: string | null) => void;
      onSplitSurplus?: () => void;
    },
  ) => (
    <RefundCard
      lineAmount={line.amount > 0 ? line.amount : null}
      picks={line.picks}
      onPicksChange={onChange}
      candidates={refundCandidates}
      openById={refundOpenFor(line.key)}
      existingIds={refundExistingFor(line.rowId)}
      lockedIds={refundLockedFor(line.rowId)}
      loading={refundSearchQ.isLoading}
      query={refundQuery}
      onQueryChange={setRefundQuery}
      otherCurrency={refundSearchQ.data?.otherCurrency ?? 0}
      counterparty={refundCounterparty}
      onCounterpartyChange={setRefundCounterparty}
      counterpartyOptions={reimbCpQ.data ?? []}
      categories={refundCategoryOptions}
      surplusCategoryId={extra.surplusCategoryId}
      onSurplusCategoryChange={extra.onSurplusCategoryChange}
      onSplitSurplus={extra.onSplitSurplus}
      incomeDate={date}
      symbol={sourceAccount?.currency_symbol ?? mainSymbol}
      dateFmt={dateFmt}
    />
  );
  /** The income's category when picks decide it: one, or the split per category. */
  const renderDerivedCategory = (parts: Array<{ categoryId: string | null; amount: number }>) => (
    <div className="space-y-1 rounded-md bg-muted px-3 py-2 text-sm">
      {parts.length <= 1 ? (
        <div>
          {parts[0]?.categoryId
            ? categoryById.get(parts[0].categoryId)?.name
            : tr("refund.no_category")}
          <span className="text-xs text-muted-foreground"> · {tr("refund.derived")}</span>
        </div>
      ) : (
        <>
          <div className="font-medium">{tr("refund.derived.split", { n: parts.length })}</div>
          {parts.map((p, i) => (
            <div key={i} className="tabular-nums">
              {fmtMoney(p.amount, sourceAccount?.currency_symbol ?? mainSymbol)} ·{" "}
              {p.categoryId ? categoryById.get(p.categoryId)?.name : tr("refund.no_category")}
            </div>
          ))}
          <div className="text-xs text-muted-foreground">{tr("refund.derived")}</div>
        </>
      )}
    </div>
  );
  /** Whatever the single income brings beyond its expenses becomes its own split line. */
  const splitOffSurplus = () => {
    const linked = Object.values(refundPicks).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const surplus = Math.round(((amountNum ?? 0) - linked) * 100) / 100;
    if (surplus <= 0.005) return;
    const first: Slice = {
      ...newSlice(),
      id: isEdit && editId ? editId : newSlice().id,
      amount: (Math.round(linked * 100) / 100).toFixed(2),
      categoryId,
      description,
      refunds: refundPicks,
      isReimbursable,
      reimbCounterparty,
      reimbReason,
    };
    const second: Slice = {
      ...newSlice(),
      amount: surplus.toFixed(2),
      description,
      categoryId: "",
    };
    setSlices([first, second]);
    setRefundPicks({});
    setRefundSliceOpen(first.id);
    setRefundTouched(true);
    setSplitMode(true);
  };

  // Editing an income: start from the expenses it repays today.
  const refundHydratedRef = React.useRef(false);
  React.useEffect(() => {
    if (
      !isEdit ||
      refundHydratedRef.current ||
      !editQ.data ||
      !reimbLinksQ.data ||
      !hydratedRef.current
    )
      return;
    if (editQ.data.tx.type !== "income") return;
    refundHydratedRef.current = true;
    const picksOf = (rowId: string): RefundPicks => {
      const out: RefundPicks = {};
      for (const [id, a] of existingLinksByRow.get(rowId) ?? [])
        out[id] = { amount: Math.round(a * 100) / 100 };
      return out;
    };
    if (editQ.data.group && editQ.data.group.length > 1) {
      setSlices((cur) => cur.map((s) => ({ ...s, refunds: picksOf(s.id) })));
    } else {
      setRefundPicks(picksOf(editQ.data.tx.id));
    }
  }, [isEdit, editQ.data, reimbLinksQ.data, existingLinksByRow]);
  // Changing picks marks the repayment as touched: saving then goes through
  // apply_refund_links(). Untouched, an edit keeps the older behaviour, where
  // a single link follows the income's amount.
  const changeRefundPicks = (next: RefundPicks) => {
    setRefundTouched(true);
    setRefundPicks(next);
    // Whatever the income brings beyond the expenses defaults to the first
    // picked expense's category.
    if (!categoryId && !touched.categoryId) {
      const first = Object.entries(next).find(([, p]) => p.decision);
      const cat = first ? refundExpenseById.get(first[0])?.category_id : null;
      if (cat) setCategoryId(cat);
    }
  };
  const changeSliceRefunds = (sliceId: string, next: RefundPicks) => {
    setRefundTouched(true);
    setSlices((cur) => cur.map((x) => (x.id === sliceId ? { ...x, refunds: next } : x)));
  };

  // The change as the database would get it on save, for the exact preview:
  // inserts for a new booking, an update (plus fee changes) for an edit, and
  // for a split what save_split_group does: kept slices updated, new ones
  // inserted, removed ones deleted. null while it cannot be saved yet.
  const previewOps = React.useMemo((): PreviewOp[] | null => {
    if (!sourceId || amountNum == null) return null;
    if (type === "transfer" && (!destId || destId === sourceId)) return null;
    const on = format(date, "yyyy-MM-dd");
    const num = (v: string) => {
      const n = Number(v.replace(",", "."));
      return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
    };
    const receivedNum = type === "transfer" && !isCrossCurrency && diffOpen ? num(received) : null;
    const base: Record<string, unknown> = {
      type,
      amount: amountNum,
      occurred_on: on,
      source_account_id: sourceId,
      destination_account_id: type === "transfer" ? destId : null,
      category_id: type === "transfer" ? null : categoryId || null,
      destination_amount:
        type !== "transfer" ? null : isCrossCurrency ? num(destAmount) : receivedNum,
      difference_category_id:
        type === "transfer" && !isCrossCurrency && receivedNum != null
          ? diffCategoryId || null
          : null,
      is_reimbursable: type !== "transfer" ? isReimbursable : false,
      reimbursable_counterparty:
        type !== "transfer" && isReimbursable ? reimbCounterparty.trim() || null : null,
    };
    const fee = type === "transfer" && feeOpen ? num(feeAmount) : null;
    const feeRow =
      fee != null && feeCategoryId
        ? {
            type: "expense",
            amount: fee,
            occurred_on: on,
            source_account_id: sourceId,
            category_id: feeCategoryId,
          }
        : null;
    const ops: PreviewOp[] = [];
    const og = editQ.data;
    // An income repaying expenses: its rows per category, and what the picks
    // change on the expenses (the links themselves are not part of it).
    if (type === "income" && refundTouched) {
      const kept = new Set<string>();
      for (const { line, parts } of refundPlan) {
        parts.forEach((part, i) => {
          const row = { ...base, amount: part.amount, category_id: part.categoryId };
          const id = i === 0 ? line.rowId : null;
          if (id) {
            kept.add(id);
            ops.push({ op: "update", id, row });
          } else ops.push({ op: "insert", row });
        });
      }
      for (const id of entryRowIds) if (!kept.has(id)) ops.push({ op: "delete", id });
      for (const { line } of refundPlan) {
        ops.push(
          ...refundPreviewOps(
            line.picks,
            refundExpenseById as Map<string, PreviewExpense>,
            refundOpenFor(line.key),
          ),
        );
      }
      return ops.length > 0 ? ops : null;
    }
    if (splitMode && type !== "transfer") {
      const existingIds = new Set(
        isEdit && og ? (og.group && og.group.length > 0 ? og.group : [og.tx]).map((r) => r.id) : [],
      );
      const keptIds = new Set<string>();
      for (const sl of slices) {
        const a = num(sl.amount);
        if (a == null) continue;
        const row = {
          ...base,
          amount: a,
          category_id: sl.categoryId || null,
          is_reimbursable: sl.isReimbursable,
          reimbursable_counterparty: sl.isReimbursable ? sl.reimbCounterparty.trim() || null : null,
        };
        if (existingIds.has(sl.id)) {
          keptIds.add(sl.id);
          ops.push({ op: "update", id: sl.id, row });
        } else ops.push({ op: "insert", row });
      }
      if (ops.length === 0) return null;
      for (const id of existingIds) if (!keptIds.has(id)) ops.push({ op: "delete", id });
      return ops;
    }
    if (isEdit && editId) {
      ops.push({ op: "update", id: editId, row: base });
      if (existingFeeTxId && feeRow) ops.push({ op: "update", id: existingFeeTxId, row: feeRow });
      else if (existingFeeTxId) ops.push({ op: "delete", id: existingFeeTxId });
      else if (feeRow) ops.push({ op: "insert", row: feeRow });
    } else {
      ops.push({ op: "insert", row: base });
      if (feeRow) ops.push({ op: "insert", row: feeRow });
    }
    return ops;
  }, [
    sourceId,
    amountNum,
    type,
    destId,
    date,
    isCrossCurrency,
    diffOpen,
    received,
    destAmount,
    categoryId,
    diffCategoryId,
    isReimbursable,
    reimbCounterparty,
    feeOpen,
    feeAmount,
    feeCategoryId,
    editQ.data,
    splitMode,
    slices,
    isEdit,
    editId,
    existingFeeTxId,
    refundTouched,
    refundPlan,
    entryRowIds,
    refundExpenseById,
    refundOpenFor,
  ]);
  // The rows that make up the entry being edited, so the preview can also show
  // it as if booked new: its slices, or the booking and its transfer fee.
  const previewEntryIds = React.useMemo((): string[] => {
    const og = editQ.data;
    if (!isEdit || !og) return [];
    const ids = (og.group && og.group.length > 0 ? og.group : [og.tx]).map((r) => r.id);
    if (existingFeeTxId) ids.push(existingFeeTxId);
    return ids;
  }, [isEdit, editQ.data, existingFeeTxId]);
  const previewRequest = previewOps
    ? JSON.stringify({ ops: previewOps, entryIds: previewEntryIds })
    : null;
  // Ask once typing pauses, not on every keystroke.
  const [previewKey, setPreviewKey] = React.useState<string | null>(null);
  React.useEffect(() => {
    const timer = setTimeout(() => setPreviewKey(previewRequest), 400);
    return () => clearTimeout(timer);
  }, [previewRequest]);
  const previewQ = useQuery({
    queryKey: ["preview_transaction_impact", previewKey],
    queryFn: () => {
      const req = JSON.parse(previewKey!) as { ops: PreviewOp[]; entryIds: string[] };
      return fetchPreviewImpact(req.ops, req.entryIds);
    },
    enabled: !!previewKey,
    staleTime: 0,
    gcTime: 30_000,
  });
  // Only an answer for what is on screen now counts; an older one is dropped.
  const serverImpact = previewKey && previewKey === previewRequest ? (previewQ.data ?? null) : null;
  // Received no more than was paid on a same-currency transfer: that is a fee,
  // and the database refuses it. Said at the field, and saving waits for a fix.
  const receivedTooLow = (() => {
    if (
      type !== "transfer" ||
      isCrossCurrency ||
      !diffOpen ||
      received.trim() === "" ||
      amountNum == null
    )
      return false;
    const n = Number(received.replace(",", "."));
    return !Number.isFinite(n) || n <= amountNum;
  })();
  // More assigned to reimbursables than this income brings: saving waits.
  // (Incomes go through the repayment card; see refundBlocks.)
  const linkOverAssigned =
    type !== "income" &&
    amountNum != null &&
    Object.values(linkSelections).reduce((sum, v) => sum + (Number(v) || 0), 0) > amountNum + 0.005;
  // A refusal the app recognises blocks saving: the database would refuse it
  // too. Any other one is shown in the Auswirkung card but does not block, as
  // the trial run itself may be what is wrong.
  const previewRefusal = serverImpact?.find((r) => r.kind === "error")?.error ?? null;
  const refusalBlocks = previewRefusal != null && knownRefusal(previewRefusal, tr) != null;

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
    queryKey: ["savings-balances"],
    queryFn: () => fetchSavingsBalances(),
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

  const categoryById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Remaining (open) amount per reimbursable original transaction.
  const remainingByOrig = React.useMemo(() => {
    const linked = new Map<string, number>();
    (reimbLinksQ.data ?? []).forEach((l: ReimbursementLink) => {
      linked.set(
        l.original_transaction_id,
        (linked.get(l.original_transaction_id) ?? 0) + Number(l.amount),
      );
    });
    const out = new Map<string, number>();
    (openReimbQ.data ?? []).forEach((t) => {
      out.set(t.id, Math.max(0, Number(t.amount) - (linked.get(t.id) ?? 0)));
    });
    return out;
  }, [openReimbQ.data, reimbLinksQ.data]);

  // When deep-linked from "Add refund", preselect the original reimbursable.
  const reimbForAppliedRef = React.useRef(false);
  React.useEffect(() => {
    if (reimbForAppliedRef.current || !reimburseForId) return;
    // One id, or several when repaying everything a person owes at once.
    const ids = new Set(reimburseForId.split(",").filter(Boolean));
    const txs = (openReimbQ.data ?? []).filter((t) => ids.has(t.id));
    if (txs.length === 0) return;
    reimbForAppliedRef.current = true;
    if ((prefill?.type ?? type) === "income") {
      const next: RefundPicks = {};
      for (const tx of txs) {
        next[tx.id] = {
          amount: remainingByOrig.get(tx.id) ?? Number(tx.amount),
          decision: defaultDecision(tx),
        };
      }
      setRefundTouched(true);
      setRefundPicks(next);
      return;
    }
    setLinkSelections((cur) => {
      const next = { ...cur };
      for (const tx of txs) next[tx.id] = remainingByOrig.get(tx.id) ?? Number(tx.amount);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const prev = {
      amount,
      description,
      note,
      sourceId,
      categoryId,
      location,
      locationTouched: locationTouchedRef.current,
    };
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
    if (d.location && (mode === "all" || !locationTouchedRef.current)) {
      setLocationManual(d.location);
    }
    setAppliedFrom({ suggestion: s, prev });
  };

  const undoApply = () => {
    if (!appliedFrom) return;
    const p = appliedFrom.prev;
    setAmount(p.amount);
    setDescription(p.description);
    setNote(p.note);
    setSourceId(p.sourceId);
    setCategoryId(p.categoryId);
    setLocation(p.location);
    locationTouchedRef.current = p.locationTouched;
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
    const re = new RegExp(
      `(^|\\s)#${tag.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(?![\\p{L}\\p{N}_-])`,
      "giu",
    );
    return text
      .replace(re, (_m, lead: string) => lead)
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+$/g, "")
      .replace(/^\s+/g, (s) => s);
  };
  const removeTag = (tag: string) => {
    setNote(removeTagFrom(note, tag));
    mark("note");
  };

  const reset = () => {
    setAmount("");
    setDescription("");
    setNote("");
    setCategoryId(activeScope && type !== "transfer" ? activeScope.id : "");
    setDate(new Date());
    setTouched({});
    setAppliedFrom(null);
    setIsReimbursable(false);
    setReimbCounterparty("");
    setReimbReason("");
    setLinkSelections({});
    setRefundPicks({});
    setRefundTouched(false);
    setRefundQuery("");
    setRefundCounterparty("");
    setRefundSliceOpen(null);
    setFeeOpen(false);
    setFeeAmount("");
    setFeeCategoryId("");
    setExistingFeeTxId(null);
    setDiffOpen(false);
    setReceived("");
    setDiffCategoryId("");
    setScopeSkipped(false);
    setLocation(null);
    locationTouchedRef.current = false;
    autoLocRef.current = false;
    setTimeout(() => amountRef.current?.focus(), 0);
  };

  // ───────── Auto-capture (new transactions, today only, opt-in) ─────────
  const captureEnabled = !!settingsQ.data?.capture_location;
  const isTodayDate = dateIsTodayFn(date);
  const autoLocRef = React.useRef(false);
  React.useEffect(() => {
    if (isEdit || !captureEnabled || !isTodayDate) return;
    if (locationTouchedRef.current || autoLocRef.current) return;
    autoLocRef.current = true;
    let cancelled = false;
    void getCurrentLocation().then((res) => {
      if (cancelled || !res.ok) return;
      if (locationTouchedRef.current) return;
      setLocation(res.location);
    });
    return () => {
      cancelled = true;
    };
  }, [isEdit, captureEnabled, isTodayDate]);

  /**
   * Save an income whose repaid expenses changed. Each line becomes one row per
   * category (src/lib/refundPlan.ts): one row stays a plain booking, several
   * are saved as a split group. Then every row that repays something, or did,
   * gets its links and the expense changes in one apply_refund_links() call.
   */
  const saveIncomeWithRefunds = async (andNew: boolean) => {
    if (refundIssue) {
      toast.error(tr(refundIssue));
      return;
    }
    const occurred_on = format(date, "yyyy-MM-dd");
    const sharedNote = note.trim();
    const sliceById = new Map(slices.map((x) => [x.id, x]));
    const rows = refundPlan.flatMap(({ line, parts }) => {
      const sl = splitMode ? sliceById.get(line.key) : undefined;
      const lineNote = sl ? [sharedNote, sl.note.trim()].filter(Boolean).join(" ") : sharedNote;
      const reimb = sl
        ? { on: sl.isReimbursable, cp: sl.reimbCounterparty.trim(), reason: sl.reimbReason.trim() }
        : { on: isReimbursable, cp: reimbCounterparty.trim(), reason: reimbReason.trim() };
      return parts.map((part, i) => ({
        id: i === 0 ? line.rowId : null,
        amount: part.amount,
        category_id: part.categoryId,
        description: (sl ? sl.description : description).trim() || null,
        note: lineNote || null,
        is_reimbursable: reimb.on,
        reimbursable_counterparty: reimb.on ? reimb.cp || null : null,
        reimbursable_reason: reimb.on ? reimb.reason || null : null,
        links: part.links,
      }));
    });
    if (rows.length === 0 || rows.some((r) => !(r.amount > 0))) {
      toast.error(tr("add.split.toast.amounts"));
      return;
    }
    const og = editQ.data;
    const wasSplit = isEdit && !!og?.tx.split_group_id;
    if (wasSplit && rows.length < 2) {
      toast.error(tr("add.split.toast.min"));
      return;
    }

    setSaving(true);
    let ids: string[];
    if (rows.length === 1 && !wasSplit) {
      const r = rows[0];
      const payload = {
        occurred_on,
        amount: r.amount,
        description: r.description,
        note: r.note,
        type,
        source_account_id: sourceId,
        destination_account_id: null,
        category_id: r.category_id,
        destination_amount: null,
        difference_category_id: null,
        is_reimbursable: r.is_reimbursable,
        reimbursable_counterparty: r.reimbursable_counterparty,
        reimbursable_reason: r.reimbursable_reason,
        fee_amount: null,
        fee_category_id: null,
        fee_transaction_id: null,
        ...locationToColumns(location),
      };
      if (isEdit && editId) {
        const { error } = await supabase.from("transactions").update(payload).eq("id", editId);
        if (error) {
          setSaving(false);
          toast.error(error.message);
          return;
        }
        ids = [editId];
      } else {
        const { data, error } = await supabase
          .from("transactions")
          .insert(payload)
          .select("id")
          .single();
        if (error || !data) {
          setSaving(false);
          toast.error(error?.message ?? "insert failed");
          return;
        }
        ids = [data.id as string];
      }
    } else {
      // Rows of the entry that are not kept lose their links with them.
      const keptIds = new Set(rows.map((r) => r.id).filter(Boolean));
      const lost = [...entryRowIds].filter((id) => !keptIds.has(id) && existingLinksByRow.has(id));
      if (
        lost.length > 0 &&
        !(typeof window !== "undefined" && window.confirm(tr("add.split.confirm_remove_linked")))
      ) {
        setSaving(false);
        return;
      }
      const groupId =
        og?.tx.split_group_id ??
        globalThis.crypto?.randomUUID?.() ??
        Math.random().toString(36).slice(2);
      const { data, error } = await supabase.rpc("save_split_group", {
        p_group_id: groupId,
        p_occurred_on: occurred_on,
        p_type: type,
        p_source_account_id: sourceId,
        p_slices: rows.map(({ links: _links, ...r }) => r),
        p_location: locationToColumns(location),
      });
      if (error) {
        setSaving(false);
        toast.error(error.message);
        return;
      }
      ids = (data ?? []) as string[];
    }

    const counterparty = refundCounterparty.trim() || null;
    for (let i = 0; i < rows.length; i++) {
      const id = ids[i];
      if (!id) continue;
      if (rows[i].links.length === 0 && !existingLinksByRow.has(id)) continue;
      try {
        await applyRefundLinks(id, refundLinksPayload(rows[i].links), counterparty);
      } catch (e) {
        toast.error(tr("refund.toast.link_failed", { msg: (e as Error).message }));
      }
    }

    if (!isEdit) {
      void notifyCreated({ data: { ids } }).catch(() => {});
      if (draftAttachments.length > 0 && ids[0]) {
        const att = draftAttachments.map((a) => ({
          transaction_id: ids[0],
          statement_id: null,
          source: a.source,
          display_name: a.display_name,
          link_url: a.link_url,
          external_id: a.external_id ?? null,
          external_path: a.external_path ?? null,
        }));
        const { error: aErr } = await supabase.from("transaction_attachments").insert(att);
        if (aErr) toast.error(aErr.message);
        else setDraftAttachments([]);
      }
    }
    setSaving(false);
    toast.success(tr("toast.saved"));
    void noticeReopenedScopes();
    qc.invalidateQueries();
    if (isEdit) {
      goBack();
      return;
    }
    if (ids[0] && (await linkStatementLine(ids[0]))) return;
    if (ids[0] && (await linkPendingRow(ids[0]))) return;
    if (andNew) {
      setSplitMode(false);
      setSlices([newSlice(), newSlice()]);
      reset();
    } else navigate({ to: "/" });
  };

  const save = async (andNew: boolean) => {
    const amt = Number(amount.replace(",", "."));
    if (!amt || amt <= 0) {
      toast.error(tr("toast.amount_required"));
      return;
    }
    if (!sourceId) {
      toast.error(tr("toast.account_required"));
      return;
    }
    if (type === "transfer" && !destId) {
      toast.error(tr("toast.dest_required"));
      return;
    }
    if (type === "transfer" && destId === sourceId) {
      toast.error(tr("toast.dest_must_differ"));
      return;
    }
    if (location && !location.label?.trim()) {
      toast.error(tr("loc.error.label_required"));
      return;
    }

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
    // Same currency, received more than paid: the received amount must really
    // be more. Less is a fee, which has its own field.
    if (type === "transfer" && !isCrossCurrency && diffOpen && received.trim() !== "") {
      const rn = Number(received.replace(",", "."));
      if (!Number.isFinite(rn) || rn <= amt) {
        toast.error(tr("toast.received_must_exceed"));
        return;
      }
      destAmountNum = Math.round(rn * 100) / 100;
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

    // An income whose repayments changed: its own path.
    if (type === "income" && refundTouched) {
      await saveIncomeWithRefunds(andNew);
      return;
    }

    // Split path: insert N rows sharing a split_group_id
    if (splitMode && type !== "transfer") {
      if (slices.length < 2) {
        toast.error(tr("add.split.toast.min"));
        return;
      }
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
          reimbCounterparty: s.isReimbursable ? s.reimbCounterparty.trim() || null : null,
          reimbReason: s.isReimbursable ? s.reimbReason.trim() || null : null,
        };
      });
      if (parsed.some((p) => !p.amount || p.amount <= 0)) {
        toast.error(tr("add.split.toast.amounts"));
        return;
      }

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
          globalThis.crypto?.randomUUID?.() ??
          Math.random().toString(36).slice(2);

        // Slices that are already rows keep their id (and with it their
        // reimbursement links and attachments); new ones go in with id null.
        const rows = parsed.map((p) => ({
          id: existingIds.has(p.id) ? p.id : null,
          amount: p.amount,
          description: p.description,
          note: p.note,
          category_id: p.categoryId,
          is_reimbursable: p.isReimbursable,
          reimbursable_counterparty: p.reimbCounterparty,
          reimbursable_reason: p.reimbReason,
        }));
        const keptIds = new Set(rows.map((r) => r.id).filter((x): x is string => !!x));
        const toDeleteIds = [...existingIds].filter((id) => !keptIds.has(id));

        // Per-slice guard: prevent turning off is_reimbursable on a slice
        // that still has reimbursement links or a write-off.
        const existingById = new Map<string, Transaction>(
          (existingGroup.length > 0 ? existingGroup : [tx]).map((g) => [g.id, g as Transaction]),
        );
        for (const r of rows) {
          const prev = r.id ? existingById.get(r.id) : undefined;
          if (!prev) continue;
          const becameNotReimb = !!prev.is_reimbursable && !r.is_reimbursable;
          if (!becameNotReimb) continue;
          const hasLink = (reimbLinksQ.data ?? []).some((l) => l.original_transaction_id === r.id);
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
            typeof window !== "undefined" && window.confirm(tr("add.split.confirm_remove_linked"));
          if (!ok) {
            setSaving(false);
            return;
          }
        }

        // One server-side transaction for the whole group: updates, inserts
        // and removals land together. Row-by-row writes could not move a
        // split to another date or account — the first row already disagreed
        // with its untouched siblings and the split-group check rejected it.
        const { error: saveErr } = await supabase.rpc("save_split_group", {
          p_group_id: groupId,
          p_occurred_on: occurred_on,
          p_type: type,
          p_source_account_id: sourceId,
          p_slices: rows,
          p_location: locationToColumns(location),
        });
        if (saveErr) {
          setSaving(false);
          toast.error(saveErr.message);
          return;
        }

        setSaving(false);
        toast.success(tr("toast.saved"));
        void noticeReopenedScopes();
        qc.invalidateQueries();
        goBack();
        return;
      }
      const groupId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
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
        ...locationToColumns(location),
      }));
      const { data: insRows, error } = await supabase
        .from("transactions")
        .insert(rows)
        .select("id");
      setSaving(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      const newIds = (insRows ?? []).map((r) => r.id).filter((x): x is string => !!x);
      if (newIds.length > 0) {
        void notifyCreated({ data: { ids: newIds } }).catch(() => {});
      }
      toast.success(tr("toast.saved"));
      void noticeReopenedScopes();
      qc.invalidateQueries();
      if (newIds.length > 0 && (await linkStatementLine(newIds[0]))) return;
      if (newIds.length > 0 && (await linkPendingRow(newIds[0]))) return;
      if (andNew) {
        setSplitMode(false);
        setSlices([newSlice(), newSlice()]);
        reset();
      } else navigate({ to: "/" });
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
        const feeDesc = description.trim()
          ? `${tr("add.transfer.fee.tx_prefix")}: ${description.trim()}`
          : tr("add.transfer.fee.tx_default");
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
        if (feeErr) {
          setSaving(false);
          toast.error(feeErr.message);
          return;
        }
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
        if (feeUpdErr) {
          setSaving(false);
          toast.error(feeUpdErr.message);
          return;
        }
      }
    } else if (existingFeeTxId) {
      // Fee was removed by the user (or type changed off transfer). Delete
      // the linked fee tx; the parent transfer's fee_* fields will be cleared
      // by the update payload below.
      const { error: feeDelErr } = await supabase
        .from("transactions")
        .delete()
        .eq("id", existingFeeTxId);
      if (feeDelErr) {
        setSaving(false);
        toast.error(feeDelErr.message);
        return;
      }
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
      category_id: type === "transfer" ? null : categoryId || null,
      destination_amount: type === "transfer" ? destAmountNum : null,
      difference_category_id:
        type === "transfer" && !isCrossCurrency && destAmountNum != null
          ? diffCategoryId || null
          : null,
      // Reimbursable flag only meaningful for expenses (or income that you
      // expect to receive — rare, but allowed). Transfers can't be reimbursable.
      is_reimbursable: type !== "transfer" ? isReimbursable : false,
      reimbursable_counterparty:
        type !== "transfer" && isReimbursable ? reimbCounterparty.trim() || null : null,
      reimbursable_reason:
        type !== "transfer" && isReimbursable ? reimbReason.trim() || null : null,
      fee_amount: type === "transfer" && feeAmtNum > 0 ? feeAmtNum : null,
      fee_category_id: type === "transfer" && feeAmtNum > 0 ? feeCategoryId : null,
      fee_transaction_id: type === "transfer" && feeAmtNum > 0 ? feeTxId : null,
      ...locationToColumns(location),
    };
    // Never claim more than this transaction actually pays: an over-stated
    // link flips the original to "settled" and the IOU silently disappears.
    const selectedLinks = clampLinkAmounts(
      Object.entries(linkSelections)
        .map(([id, amt2]) => ({ id, amount: Number(amt2) }))
        .filter((x) => x.id && Number.isFinite(x.amount) && x.amount > 0),
      amountNum ?? 0,
    );
    if (isEdit && editId) {
      const { error } = await supabase.from("transactions").update(payload).eq("id", editId);
      if (error) {
        setSaving(false);
        toast.error(error.message);
        return;
      }
      // Reimbursables covered by this income: the card's list replaces the
      // current links in one step when it was changed. Otherwise a single
      // link follows the amount, so the original's status stays correct.
      // (A changed repayment of an income was saved by saveIncomeWithRefunds.)
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
      void noticeReopenedScopes();
      qc.invalidateQueries();
      goBack();
      return;
    }
    const { data: inserted, error } = await supabase
      .from("transactions")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      setSaving(false);
      toast.error(error.message);
      return;
    }
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
        external_id: a.external_id ?? null,
        external_path: a.external_path ?? null,
      }));
      const { error: aErr } = await supabase.from("transaction_attachments").insert(rows);
      if (aErr) toast.error(aErr.message);
      else setDraftAttachments([]);
    }
    setSaving(false);
    toast.success(tr("toast.saved"));
    void noticeReopenedScopes();
    qc.invalidateQueries();
    if (newTxId && (await linkStatementLine(newTxId))) return;
    if (newTxId && (await linkPendingRow(newTxId))) return;
    if (andNew) reset();
    else navigate({ to: "/" });
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
        if (e.key === "1") {
          e.preventDefault();
          setType("expense");
          return;
        }
        if (e.key === "2") {
          e.preventDefault();
          setType("income");
          return;
        }
        if (e.key === "3") {
          e.preventDefault();
          setType("transfer");
          return;
        }
        // Alt+0 → use-all from best suggestion
        if (e.key === "0") {
          const best = suggestionsRef.current[0];
          if (best) {
            e.preventDefault();
            applyRef.current(best, "all");
          }
          return;
        }
        // Alt+1..9 already handled above for 1/2/3 (type switch wins by design).
        // For 4..9, apply Nth suggestion (sticky).
        const n = Number(e.key);
        if (n >= 4 && n <= 9) {
          const s = suggestionsRef.current[n - 1];
          if (s) {
            e.preventDefault();
            applyRef.current(s, "sticky");
          }
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

  const shortcutRows = React.useMemo(
    () => [
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
    ],
    [tr],
  );

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
        <h1 className="text-2xl font-semibold tracking-tight">
          {isEdit ? tr("edit.title") : tr("add.title")}
        </h1>
        {activeScope && type !== "transfer" && (
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2 text-sm",
              scopeSkipped
                ? "border-muted bg-muted/30 text-muted-foreground"
                : "border-primary/40 bg-primary/5 text-foreground",
            )}
          >
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1">
              <div className="font-medium">
                {scopeSkipped
                  ? tr("add.scope.banner_skipped", { name: activeScope.name })
                  : tr("add.scope.banner_active", { name: activeScope.name })}
              </div>
              <div className="text-xs text-muted-foreground">
                {scopeSkipped
                  ? tr("add.scope.banner_skipped_hint")
                  : tr("add.scope.banner_active_hint")}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                if (scopeSkipped) {
                  setScopeSkipped(false);
                  setCategoryId(activeScope.id);
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
                onChange={(e) => {
                  setAmount(e.target.value.replace(/[^0-9.,]/g, ""));
                  mark("amount");
                }}
                onBlur={() => setAmount((v) => formatAmountInput(v))}
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
                onPick={(a) => {
                  setAmount(a);
                  mark("amount");
                }}
                excludeTransactionIds={ruleTxIdsQ.data}
              />
            </div>
          </CardContent>
        </Card>

        {/* Smart suggestions — reserve space to avoid layout jumps (hidden in edit mode) */}
        {!isEdit && (
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
                <button
                  type="button"
                  onClick={undoApply}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {tr("add.suggest.undo")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Account(s) */}
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block">
              {type === "transfer" ? tr("add.from_account") : tr("add.account")}
            </Label>
            <ChipPicker
              items={accountChips}
              value={sourceId || null}
              onChange={(v) => {
                setSourceId(v);
                mark("sourceId");
              }}
              placeholder={accounts.length ? tr("add.account") : tr("add.no_accounts")}
              moreLabel={tr("picker.more")}
              searchPlaceholder={tr("picker.search")}
              emptyLabel={tr("picker.no_match")}
            />
            {accounts.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                <Link to="/settings" className="text-primary underline-offset-2 hover:underline">
                  {tr("add.create_first_account")}
                </Link>
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
                      onBlur={() => setDestAmount((v) => formatAmountInput(v))}
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
              {/* Received more than paid, same currency (gift card at a discount) */}
              {sourceAccount &&
                destAccount &&
                !isCrossCurrency &&
                (() => {
                  if (!diffOpen) {
                    return (
                      <button
                        type="button"
                        onClick={() => setDiffOpen(true)}
                        className="mt-2 mr-4 text-xs text-primary underline-offset-2 hover:underline"
                      >
                        + {tr("add.transfer.diff.add")}
                      </button>
                    );
                  }
                  const paid = Number(amount.replace(",", "."));
                  const got = Number(received.replace(",", "."));
                  const diff =
                    Number.isFinite(paid) && Number.isFinite(got) && received.trim() !== ""
                      ? got - paid
                      : null;
                  const target = diffCategoryId ? categoryById.get(diffCategoryId) : null;
                  return (
                    <div className="mt-3 rounded-md border border-dashed border-border/60 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <Label htmlFor="received-amount" className="text-xs">
                          {tr("add.transfer.diff.label", { sym: destSymbol })}
                        </Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setDiffOpen(false);
                            setReceived("");
                            setDiffCategoryId("");
                          }}
                        >
                          {tr("add.transfer.fee.remove")}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                          {destSymbol}
                        </span>
                        <Input
                          id="received-amount"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={received}
                          onChange={(e) => setReceived(e.target.value.replace(/[^0-9.,]/g, ""))}
                          onBlur={() => setReceived((v) => formatAmountInput(v))}
                          aria-invalid={receivedTooLow || undefined}
                          aria-describedby={receivedTooLow ? "received-error" : undefined}
                          className={cn(
                            "tabular-nums",
                            receivedTooLow && "border-destructive focus-visible:ring-destructive",
                          )}
                        />
                      </div>
                      {diff != null && diff > 0.005 && (
                        <div className="mt-2 flex items-baseline justify-between rounded-md bg-success/10 px-2 py-1.5 text-xs">
                          <span>{tr("add.transfer.diff.gain")}</span>
                          <span className="font-semibold tabular-nums text-success">
                            +{fmtMoney(diff, destSymbol)}
                            {paid > 0 && (
                              <span className="ml-1 font-normal text-muted-foreground">
                                ({((diff / paid) * 100).toFixed(1)} %)
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                      {receivedTooLow && (
                        <p
                          id="received-error"
                          role="alert"
                          className="mt-2 text-xs text-destructive"
                        >
                          {tr("add.transfer.diff.less")}{" "}
                          {!feeOpen && (
                            <button
                              type="button"
                              className="text-primary underline underline-offset-2"
                              onClick={() => {
                                setFeeOpen(true);
                                if (diff != null && diff < 0) setFeeAmount((-diff).toFixed(2));
                                setDiffOpen(false);
                                setReceived("");
                                setDiffCategoryId("");
                              }}
                            >
                              {tr("add.transfer.fee.add")}
                            </button>
                          )}
                        </p>
                      )}
                      <div className="mt-2">
                        <Label className="mb-1 block text-xs">
                          {tr("add.transfer.diff.category")}
                        </Label>
                        <ChipPicker
                          items={rollingCategoryChips}
                          value={diffCategoryId || null}
                          onChange={(v) => setDiffCategoryId(v ?? "")}
                          placeholder={tr("add.transfer.diff.none")}
                          moreLabel={tr("picker.more")}
                          searchPlaceholder={tr("picker.search")}
                          emptyLabel={tr("picker.no_match")}
                        />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {target
                          ? tr("add.transfer.diff.help", { name: target.name })
                          : tr("add.transfer.diff.help_none")}
                      </p>
                    </div>
                  );
                })()}
              {/* Optional fee on the transfer (e.g. ATM withdrawal fee) */}
              {sourceAccount &&
                destAccount &&
                (feeOpen ? (
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
                        onBlur={() => setFeeAmount((v) => formatAmountInput(v))}
                        onChange={(e) => setFeeAmount(e.target.value.replace(/[^0-9.,]/g, ""))}
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
                ))}
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
                    // An income's repayments move to its first line
                    // (saveIncomeWithRefunds); other settlers can't be split.
                    if (isEdit && editAsSettlerLinks.length > 0 && type !== "income") {
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
                          refunds: type === "income" ? refundPicks : {},
                        },
                        newSlice(),
                      ]);
                      if (type === "income") {
                        setRefundPicks({});
                        setRefundTouched(true);
                      }
                    } else if (
                      !isEdit &&
                      type === "income" &&
                      Object.keys(refundPicks).length > 0
                    ) {
                      // New income: what it repays stays with the first line.
                      const first = {
                        ...newSlice(),
                        categoryId,
                        description,
                        refunds: refundPicks,
                      };
                      const linkedSum = Object.values(refundPicks).reduce(
                        (sum, p) => sum + (Number(p.amount) || 0),
                        0,
                      );
                      first.amount = (Math.round(linkedSum * 100) / 100).toFixed(2);
                      setSlices([first, newSlice()]);
                      setRefundPicks({});
                      setRefundSliceOpen(first.id);
                      setRefundTouched(true);
                    }
                    setSplitMode(true);
                    return;
                  }
                  // Turning OFF
                  if (isEdit && editQ.data?.tx.split_group_id) {
                    toast.error(tr("add.split.cannot_ungroup"));
                    return;
                  }
                  // The first line's repayments come back to the whole income.
                  if (type === "income" && Object.keys(slices[0]?.refunds ?? {}).length > 0) {
                    setRefundPicks(slices[0].refunds);
                  }
                  setSplitMode(false);
                }}
                aria-label={tr("add.split.toggle")}
              >
                {splitMode ? tr("common.on") : tr("common.off")}
              </Toggle>
            </div>
          )}

          {type === "income" &&
            !splitMode &&
            refundLines[0] &&
            renderRefundCard(refundLines[0], changeRefundPicks, {
              surplusCategoryId: categoryId || null,
              onSurplusCategoryChange: (v) => {
                setCategoryId(v ?? "");
                mark("categoryId");
              },
              onSplitSurplus: splitOffSurplus,
            })}

          {type === "income" && !splitMode && hasNewRefundPick && refundPlan[0] && (
            <div>
              <Label className="mb-1.5 block">{tr("add.category")}</Label>
              {renderDerivedCategory(refundPlan[0].parts)}
            </div>
          )}

          {type !== "transfer" && !splitMode && !(type === "income" && hasNewRefundPick) && (
            <div>
              <Label className="mb-1.5 block">
                {tr("add.category")}{" "}
                {type === "income" && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {tr("add.category_optional_reimb")}
                  </span>
                )}
              </Label>
              <ChipPicker
                items={categoryChips}
                value={categoryId || null}
                onChange={(v) => {
                  setCategoryId(v);
                  mark("categoryId");
                }}
                allowClear
                clearLabel={tr("common.none")}
                placeholder={tr("add.select_category")}
                moreLabel={tr("picker.more")}
                searchPlaceholder={tr("picker.search")}
                emptyLabel={tr("picker.no_match")}
              />
              {activeScope && !scopeSkipped && categoryId === activeScope.id && (
                <p className="mt-1 flex items-center gap-1 text-xs text-primary">
                  <Target className="h-3 w-3" />{" "}
                  {tr("add.scope.field_hint", { name: activeScope.name })}
                </p>
              )}
              {type === "income" &&
                categoryId &&
                (() => {
                  const c = categories.find((x) => x.id === categoryId);
                  if (!c) return null;
                  const kind = c.group_id ? groupKindById.get(c.group_id) : undefined;
                  const isSavings = c.rolls_over || kind === "savings";
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
                            setSlices((cur) =>
                              cur.map((x, i) => (i === idx ? { ...x, amount: v } : x)),
                            );
                          }}
                          onBlur={() =>
                            setSlices((cur) =>
                              cur.map((x, i) =>
                                i === idx ? { ...x, amount: formatAmountInput(x.amount) } : x,
                              ),
                            )
                          }
                          className="tabular-nums"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`slice-description-${idx}`} className="mb-1 block text-xs">
                          {tr("add.split.description")}
                        </Label>
                        {/* The same suggestions as the single description field. */}
                        <DescriptionAutocomplete
                          id={`slice-description-${idx}`}
                          value={s.description}
                          onChange={(v) =>
                            setSlices((cur) =>
                              cur.map((x, i) => (i === idx ? { ...x, description: v } : x)),
                            )
                          }
                          transactions={recentQ.data ?? []}
                          placeholder={tr("add.description_placeholder")}
                        />
                      </div>
                    </div>
                    {(() => {
                      const line = refundLines.find((l) => l.key === s.id);
                      const plan = refundPlan.find((pl) => pl.line.key === s.id);
                      const hasNew = !!line && Object.values(line.picks).some((p) => p.decision);
                      const open =
                        refundSliceOpen === s.id || (!!line && Object.keys(line.picks).length > 0);
                      return (
                        <>
                          <div className="mt-2">
                            <Label className="mb-1 block text-xs">{tr("add.split.category")}</Label>
                            {hasNew && plan ? (
                              renderDerivedCategory(plan.parts)
                            ) : (
                              <ChipPicker
                                items={categoryChips}
                                value={s.categoryId || null}
                                onChange={(v) =>
                                  setSlices((cur) =>
                                    cur.map((x, i) =>
                                      i === idx ? { ...x, categoryId: v ?? "" } : x,
                                    ),
                                  )
                                }
                                allowClear
                                clearLabel={tr("add.split.no_category")}
                                placeholder={tr("add.select_category")}
                                moreLabel={tr("picker.more")}
                                searchPlaceholder={tr("picker.search")}
                                emptyLabel={tr("picker.no_match")}
                              />
                            )}
                          </div>
                          {line && (
                            <div className="mt-2">
                              {open ? (
                                <>
                                  {renderRefundCard(
                                    line,
                                    (next) => changeSliceRefunds(s.id, next),
                                    {
                                      surplusCategoryId: s.categoryId || null,
                                      onSurplusCategoryChange: (v) =>
                                        setSlices((cur) =>
                                          cur.map((x) =>
                                            x.id === s.id ? { ...x, categoryId: v ?? "" } : x,
                                          ),
                                        ),
                                    },
                                  )}
                                  {Object.keys(line.picks).length === 0 && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="mt-1"
                                      onClick={() => setRefundSliceOpen(null)}
                                    >
                                      {tr("refund.slice_hide")}
                                    </Button>
                                  )}
                                </>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setRefundSliceOpen(s.id)}
                                >
                                  <Plus className="mr-1 h-4 w-4" /> {tr("refund.slice_add")}
                                </Button>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}
                    <div className="mt-2">
                      <Label className="mb-1 block text-xs">{tr("add.split.note")}</Label>
                      <TagAutocompleteTextarea
                        rows={2}
                        value={s.note}
                        onChange={(next) =>
                          setSlices((cur) =>
                            cur.map((x, i) => (i === idx ? { ...x, note: next } : x)),
                          )
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
                            cur.map((x, i) =>
                              i === idx ? { ...x, note: removeTagFrom(x.note, tag) } : x,
                            ),
                          );
                        }}
                      />
                    </div>
                    <div className="mt-3 rounded-md border border-dashed border-border/60 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Label className="text-xs font-medium">{tr("add.reimb.section")}</Label>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {tr("add.reimb.toggle.hint")}
                          </p>
                        </div>
                        <Switch
                          checked={s.isReimbursable}
                          onCheckedChange={(v) =>
                            setSlices((cur) =>
                              cur.map((x, i) => (i === idx ? { ...x, isReimbursable: !!v } : x)),
                            )
                          }
                          aria-label={tr("add.reimb.toggle")}
                        />
                      </div>
                      {s.isReimbursable && (
                        <div className="mt-2 space-y-2">
                          <div>
                            <Label className="mb-1 block text-xs">
                              {tr("add.reimb.counterparty")}
                            </Label>
                            <StringAutocomplete
                              value={s.reimbCounterparty}
                              onChange={(v) =>
                                setSlices((cur) =>
                                  cur.map((x, i) =>
                                    i === idx ? { ...x, reimbCounterparty: v } : x,
                                  ),
                                )
                              }
                              options={reimbCpQ.data ?? []}
                            />
                          </div>
                          <div>
                            <Label className="mb-1 block text-xs">{tr("add.reimb.reason")}</Label>
                            <Input
                              value={s.reimbReason}
                              onChange={(e) =>
                                setSlices((cur) =>
                                  cur.map((x, i) =>
                                    i === idx ? { ...x, reimbReason: e.target.value } : x,
                                  ),
                                )
                              }
                            />
                          </div>
                          {type === "expense" && s.categoryId && (
                            <p className="text-[11px] text-warning">
                              {tr("add.reimb.category_clear_warning")}
                            </p>
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
                    {splitTotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    {symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{tr("add.split.target_total")}</span>
                  <span className="tabular-nums">
                    {targetTotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    {symbol}
                  </span>
                </div>
                {Math.abs(splitDiff) > 0.005 && targetTotal > 0 && (
                  <div
                    className={cn(
                      "mt-1 flex justify-between font-medium",
                      splitDiff > 0 ? "text-warning" : "text-destructive",
                    )}
                  >
                    <span>{tr("add.split.diff")}</span>
                    <span className="tabular-nums">
                      {splitDiff.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      {symbol}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {!splitMode && (
          <div>
            <Label htmlFor="description" className="mb-1.5 block">
              {tr("add.description")}
            </Label>
            <DescriptionAutocomplete
              id="description"
              value={description}
              onChange={(v) => {
                setDescription(v);
                mark("description");
              }}
              transactions={recentQ.data ?? []}
              placeholder={
                type === "transfer" ? tr("common.optional") : tr("add.description_placeholder")
              }
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
            onChange={(next) => {
              setNote(next);
              mark("note");
            }}
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
            locale={locale}
            className="mb-2 hidden w-full md:block"
          />
          <DayHeatmapCalendar
            selected={date}
            onSelect={setDate}
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
          <p className="mt-1 text-xs text-muted-foreground md:hidden">
            {tr("add.day_preview.long_press_hint")}
          </p>
          <p className="mt-1 hidden text-xs text-muted-foreground md:block">
            {tr("add.date_input_hint", { fmt: dateFmt })}
          </p>
        </div>

        {/* Reimbursable / lent-out section (not for transfers; per-slice in split mode) */}
        {type !== "transfer" && !splitMode && (
          <Card>
            <CardContent className="space-y-3 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label className="text-sm font-medium">{tr("add.reimb.section")}</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {tr("add.reimb.toggle.hint")}
                  </p>
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
                    <Label htmlFor="reimb-cp" className="mb-1 block text-xs">
                      {tr("add.reimb.counterparty")}
                    </Label>
                    <StringAutocomplete
                      id="reimb-cp"
                      value={reimbCounterparty}
                      onChange={setReimbCounterparty}
                      options={reimbCpQ.data ?? []}
                    />
                  </div>
                  <div>
                    <Label htmlFor="reimb-reason" className="mb-1 block text-xs">
                      {tr("add.reimb.reason")}
                    </Label>
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

        {/* A reimbursable being edited: the incomes that repay it. */}
        {isEdit &&
          editQ.data &&
          editQ.data.tx.is_reimbursable &&
          !splitMode &&
          type !== "transfer" && (
            <ReimbursementPayments
              original={editQ.data.tx}
              links={editAsOriginalLinks}
              symbol={symbol}
            />
          )}

        <div className="pt-2">
          {isEdit && editId ? (
            <div className="space-y-2">
              <TransactionStatementRow transactionId={editId} />
              <AttachmentsSection transactionId={editId} />
            </div>
          ) : (
            <AttachmentsSection
              draft
              items={draftAttachments}
              onItemsChange={setDraftAttachments}
            />
          )}
        </div>

        <LocationSection
          value={location}
          onChange={setLocationManual}
          dateIsToday={isTodayDate}
          recent={recentLocations}
        />

        {/* Live summary: how this transaction will look in the list */}
        <TransactionPreview
          type={type}
          amountNum={amountNum}
          destAmountNum={(() => {
            const n = Number(
              (isCrossCurrency ? destAmount : diffOpen ? received : "").replace(",", "."),
            );
            return Number.isFinite(n) && n > 0 ? n : null;
          })()}
          isCrossCurrency={isCrossCurrency}
          source={sourceAccount ?? null}
          destination={destAccount ?? null}
          category={previewCategoryId ? (categoryById.get(previewCategoryId) ?? null) : null}
          description={description}
          note={note}
          date={date}
          locale={locale}
          symbol={symbol}
          destSymbol={destSymbol}
          splitMode={splitMode}
          slices={
            splitMode
              ? slices.map((s) => ({
                  amount: Number(s.amount.replace(",", ".")) || 0,
                  description: s.description,
                  category: s.categoryId ? (categoryById.get(s.categoryId) ?? null) : null,
                  reimb: s.isReimbursable ? { from: s.reimbCounterparty.trim() } : null,
                }))
              : null
          }
          reimb={type !== "transfer" && isReimbursable ? { from: reimbCounterparty.trim() } : null}
          settles={
            type === "income"
              ? refundLines
                  .flatMap((l) => Object.entries(l.picks))
                  .filter(([, p]) => Number(p.amount) > 0)
                  .map(([id, p]) => {
                    const o = refundExpenseById.get(id);
                    return `${o?.description || tr("add.expense")} (${fmtMoney(Number(p.amount), symbol).replace(/^\S+\s/, "")})`;
                  })
              : []
          }
          labels={{
            transfer: tr("tx.transfer_label"),
            income: tr("add.income"),
            expense: tr("add.expense"),
            preview: tr("add.preview.title"),
            split: tr("add.split.title"),
            reimb: (from) =>
              from ? tr("add.preview.reimb_from", { name: from }) : tr("add.preview.reimb"),
            settles: (list) => tr("add.preview.settles", { list }),
          }}
        />

        <ImpactPreview
          type={type}
          amountNum={amountNum}
          destAmountNum={(() => {
            const n = Number(
              (isCrossCurrency ? destAmount : diffOpen ? received : "").replace(",", "."),
            );
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
          category={previewCategoryId ? (categoryById.get(previewCategoryId) ?? null) : null}
          date={date}
          splitMode={splitMode}
          slices={
            splitMode
              ? slices.map((s) => ({
                  amount: Number(s.amount.replace(",", ".")) || 0,
                  categoryId: s.categoryId || null,
                }))
              : null
          }
          categoryById={categoryById}
          balances={balancesQ.data ?? null}
          categoryRows={categoryMonthQ.data ?? null}
          savingsBalances={savingsBalancesQ.data ?? null}
          mainCode={settingsQ.data?.currency_code ?? "CHF"}
          mainSymbol={mainSymbol}
          fxRates={fxQ.data}
          editOriginal={isEdit ? (editQ.data ?? null) : null}
          serverImpact={serverImpact}
          locale={locale}
          tr={tr}
        />

        {duplicates.length > 0 && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
            style={{
              borderColor: "hsl(38 92% 50% / 0.5)",
              backgroundColor: "hsl(38 92% 50% / 0.12)",
              color: "hsl(25 95% 35%)",
            }}
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              style={{ color: "hsl(25 95% 45%)" }}
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{tr("add.duplicate.warning")}</div>
              <div className="mt-0.5 text-xs">
                {tr("add.duplicate.detail", {
                  count: String(duplicates.length),
                  account: sourceAccount?.name ?? "",
                  amount: amountNum != null ? fmtMoney(amountNum, symbol) : "",
                  date: format(date, dateFmt),
                })}
              </div>
            </div>
          </div>
        )}

        {prefill?.statement_line && (
          <div className="pt-2 text-xs text-muted-foreground">{tr("statements.linking_hint")}</div>
        )}

        {refundBlocks && refundIssue && (
          <p role="alert" className="text-sm text-destructive">
            {tr(refundIssue)}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          {isEdit ? (
            <>
              <Button
                variant="outline"
                className="flex-1"
                disabled={saving}
                onClick={() => goBack()}
              >
                {tr("common.cancel")}
              </Button>
              <Button
                className="flex-1"
                disabled={
                  saving || receivedTooLow || linkOverAssigned || refundBlocks || refusalBlocks
                }
                onClick={() => save(false)}
              >
                {saving ? tr("common.saving") : tr("edit.save_changes")}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                className="flex-1"
                disabled={
                  saving || receivedTooLow || linkOverAssigned || refundBlocks || refusalBlocks
                }
                onClick={() => save(false)}
              >
                {saving ? tr("common.saving") : tr("common.save")}
              </Button>
              <Button
                className="flex-1"
                disabled={
                  saving || receivedTooLow || linkOverAssigned || refundBlocks || refusalBlocks
                }
                onClick={() => save(true)}
              >
                {tr("add.save_new")}
              </Button>
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
  reimb,
  settles,
  labels,
}: {
  type: TxType;
  amountNum: number | null;
  destAmountNum: number | null;
  isCrossCurrency: boolean;
  /** Money you get back: who pays it ("" when not named). null when it is not. */
  reimb: { from: string } | null;
  /** An income: the reimbursables it repays, as "Name (60.00)" each. */
  settles: string[];
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
  slices: Array<{
    amount: number;
    description: string;
    category: PreviewEntity;
    reimb: { from: string } | null;
  }> | null;
  labels: {
    transfer: string;
    income: string;
    expense: string;
    preview: string;
    split: string;
    reimb: (from: string) => string;
    settles: (list: string) => string;
  };
}) {
  const dateFmt = useDateFormat();
  if (amountNum == null || !source) return null;

  const Icon = type === "expense" ? ArrowDown : type === "income" ? ArrowUp : ArrowLeftRight;
  const tone =
    type === "expense"
      ? "text-destructive"
      : type === "income"
        ? "text-success"
        : "text-muted-foreground";
  const sign = type === "expense" ? "-" : type === "income" ? "+" : "";
  const primary = (type !== "transfer" ? category : null) ?? source;
  // Another currency, or more received than paid (a gift card at a discount).
  const showDst =
    type === "transfer" &&
    destAmountNum != null &&
    (isCrossCurrency || destAmountNum !== amountNum);
  const fallbackTitle =
    type === "transfer" ? labels.transfer : type === "income" ? labels.income : labels.expense;

  return (
    <Card className="border-dashed">
      <CardContent className="space-y-2 py-3">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {labels.preview}
        </div>
        <div className="flex items-start gap-3">
          <div className="relative mt-0.5 shrink-0">
            <EntityVisual entity={primary} size="md" />
            <div
              className={cn(
                "absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background ring-1 ring-border",
                tone,
              )}
            >
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
              <span>{format(date, dateFmt, { locale })}</span>
            </div>
            {type === "income" && settles.length > 0 && (
              <div className="mt-1.5">
                <span className="inline-flex items-center rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                  {labels.settles(settles.join(", "))}
                </span>
              </div>
            )}
            {!splitMode && reimb && (
              <div className="mt-1.5">
                <span className="inline-flex items-center rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                  {labels.reimb(reimb.from)}
                </span>
              </div>
            )}
            {note.trim() && (
              <div className="mt-1 text-xs text-muted-foreground">
                <Markdown>{note.trim()}</Markdown>
              </div>
            )}
          </div>
        </div>
        {splitMode && slices && slices.length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-dashed border-border/60 pt-2 text-xs">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {labels.split}
            </div>
            {slices.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  {s.category && <EntityVisual entity={s.category} size="xs" />}
                  <span className="truncate">
                    {s.description.trim() || s.category?.name || "—"}
                  </span>
                  {s.reimb && (
                    <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      {labels.reimb(s.reimb.from)}
                    </span>
                  )}
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
  type,
  amountNum,
  destAmountNum,
  feeAmountNum,
  feeCategoryId,
  source,
  destination,
  category,
  date,
  splitMode,
  slices,
  categoryById,
  balances,
  categoryRows,
  savingsBalances,
  mainCode,
  mainSymbol,
  fxRates,
  editOriginal,
  tr,
  serverImpact,
  locale,
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
  categoryById: Map<
    string,
    { id: string; name: string; allocated_budget: number; is_scope?: boolean }
  >;
  balances: AccountBalance[] | null;
  categoryRows: CategoryMonthRow[] | null;
  savingsBalances: CategorySavingsBalance[] | null;
  mainCode: string;
  mainSymbol: string;
  fxRates: FxRates | undefined;
  editOriginal: { tx: Transaction; group: Transaction[] | null } | null;
  tr: (k: string, p?: Record<string, string>) => string;
  /** What the database says saving would move; replaces the estimated budget rows. */
  serverImpact: PreviewImpactRow[] | null;
  locale: Locale;
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
    add(
      destination?.id ?? null,
      destAmountNum != null && destAmountNum > 0 ? destAmountNum : amountNum,
    );
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
        ogAdd(
          original.destination_account_id,
          original.destination_amount != null ? Number(original.destination_amount) : a,
        );
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
    if (conv == null) {
      netDeltaUnknown = true;
    } else {
      netBefore += conv;
    }
  }
  // Back out original net effect from netBefore
  for (const [id, eff] of originalEffects) {
    const b = balById.get(id);
    const conv = toMain(eff, b?.currency_code);
    if (conv == null) netDeltaUnknown = true;
    else netBefore -= conv;
  }
  for (const [id, d] of accDelta) {
    const b = balById.get(id);
    const conv = toMain(d, b?.currency_code);
    if (conv == null) netDeltaUnknown = true;
    else netDelta += conv;
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
    id: string;
    name: string;
    allocated: number;
    before: number;
    after: number;
    isSavings: boolean;
    savedBefore: number;
    savedAfter: number;
    isScope: boolean;
    scopeSpentBefore: number;
    scopeSpentAfter: number;
  };
  const catImpacts = new Map<string, number>();
  // Savings envelopes follow the DB convention in category_savings_balance:
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
        catImpacts.set(
          s.categoryId,
          (catImpacts.get(s.categoryId) ?? 0) + s.amount * catSign(s.categoryId, type),
        );
        savImpacts.set(
          s.categoryId,
          (savImpacts.get(s.categoryId) ?? 0) + s.amount * savSign(type),
        );
      }
    } else if (category) {
      catImpacts.set(category.id, amountNum * catSign(category.id, type));
      savImpacts.set(category.id, amountNum * savSign(type));
    }
  }
  // Fee creates an extra expense in feeCategory on transfers.
  if (feeAmountNum != null && feeCategoryId) {
    catImpacts.set(
      feeCategoryId,
      (catImpacts.get(feeCategoryId) ?? 0) + feeAmountNum * catSign(feeCategoryId, "expense"),
    );
    savImpacts.set(
      feeCategoryId,
      (savImpacts.get(feeCategoryId) ?? 0) + feeAmountNum * savSign("expense"),
    );
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
    if (
      original.fee_amount != null &&
      Number(original.fee_amount) > 0 &&
      original.fee_category_id
    ) {
      const fv = Number(original.fee_amount) * catSign(original.fee_category_id, "expense");
      ogCatImpactsAll.set(
        original.fee_category_id,
        (ogCatImpactsAll.get(original.fee_category_id) ?? 0) + fv,
      );
      ogSavImpactsAll.set(
        original.fee_category_id,
        (ogSavImpactsAll.get(original.fee_category_id) ?? 0) +
          Number(original.fee_amount) * savSign("expense"),
      );
      if (sameMonth(original.occurred_on)) {
        ogCatImpacts.set(
          original.fee_category_id,
          (ogCatImpacts.get(original.fee_category_id) ?? 0) + fv,
        );
      }
    }
  }
  const catRows: CatItem[] = [];
  const savedByCat = new Map(
    (savingsBalances ?? []).map((s) => [s.category_id, Number(s.cumulative_balance) || 0]),
  );
  // A scope's budget is a target, not money: it is funded from its envelope for
  // exactly what it spent when it closes, so cumulative_balance nets to ~0 and
  // would report a fully-spent trip as untouched. Its own spending is
  // from_transactions (negative for an expense).
  const scopeSpentByCat = new Map(
    (savingsBalances ?? []).map((s) => [s.category_id, Number(s.from_transactions) || 0]),
  );
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
    const scopeSpentNow = scopeSpentByCat.get(id) ?? 0;
    const scopeSpentBefore = scopeSpentNow - (ogSavImpactsAll.get(id) ?? 0);
    const scopeSpentAfter = scopeSpentBefore + (savImpacts.get(id) ?? 0);
    catRows.push({
      id,
      name: meta.name,
      allocated: Number(row?.allocated ?? meta.allocated_budget ?? 0),
      before,
      after,
      isSavings,
      savedBefore,
      savedAfter,
      isScope: Boolean(meta.is_scope),
      scopeSpentBefore,
      scopeSpentAfter,
    });
  }

  // Cross-currency hint
  const xCur =
    type === "transfer" &&
    source &&
    destination &&
    (source.currency_code ?? mainCode) !== (destination.currency_code ?? mainCode);

  const fmt = (v: number, sym: string) => fmtMoney(v, sym);
  const deltaStr = (v: number, sym: string) => {
    const s = v >= 0 ? "+" : "−";
    return `${s}${fmtMoney(Math.abs(v), sym)}`;
  };

  const showNetWorth = type !== "transfer" || xCur;
  const refusal = serverImpact?.find((r) => r.kind === "error") ?? null;

  return (
    <Card className="border-dashed">
      <CardContent className="px-3 py-2 text-xs">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {tr("add.impact.title")}
        </div>
        {refusal ? (
          <ImpactRefusal message={refusal.error ?? ""} tr={tr} />
        ) : serverImpact ? (
          <ImpactBlocks
            rows={serverImpact}
            isEdit={!!editOriginal}
            noBudgetReason={
              type === "transfer"
                ? "transfer"
                : (splitMode ? (slices ?? []).every((s) => !s.categoryId) : !category)
                  ? "no_category"
                  : null
            }
            balances={balances}
            categoryById={categoryById}
            mainCode={mainCode}
            mainSymbol={mainSymbol}
            locale={locale}
            tr={tr}
          />
        ) : (
          <ul className="space-y-1 opacity-60" aria-busy="true">
            {accountRows.map((r) => {
              const delta = r.after - r.before;
              return (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 text-muted-foreground">
                    {tr("add.impact.account")} · {r.name}
                  </span>
                  <span className="ml-auto text-right tabular-nums">
                    {fmt(r.before, r.sym)} →{" "}
                    <span className="font-medium text-foreground">{fmt(r.after, r.sym)}</span>{" "}
                    <span className={cn(delta >= 0 ? "text-success" : "text-destructive")}>
                      ({deltaStr(delta, r.sym)})
                    </span>
                  </span>
                </li>
              );
            })}
            {showNetWorth && !netDeltaUnknown && (
              <li className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-0 text-muted-foreground">{tr("add.impact.networth")}</span>
                <span className="ml-auto text-right tabular-nums">
                  {fmt(netBefore, mainSymbol)} →{" "}
                  <span className="font-medium text-foreground">{fmt(netAfter, mainSymbol)}</span>{" "}
                  <span className={cn(netDelta >= 0 ? "text-success" : "text-destructive")}>
                    ({deltaStr(netDelta, mainSymbol)})
                  </span>
                </span>
              </li>
            )}
            {catRows.map((r) => {
              const hasBudget = r.allocated > 0;
              const remBefore = r.allocated - r.before;
              const remAfter = r.allocated - r.after;
              // Scopes (trips/projects) are savings envelopes that mostly only
              // get spent from. Show budget left instead of a negative balance:
              // saved balance is ≤ 0 for pure spending, so allocated + saved.
              const scopeRemBefore = r.allocated + r.scopeSpentBefore;
              const scopeRemAfter = r.allocated + r.scopeSpentAfter;
              return (
                <li
                  key={"cat-" + r.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3"
                >
                  <span className="min-w-0 text-muted-foreground">
                    {tr("add.impact.category")} · {r.name}
                  </span>
                  <span className="ml-auto text-right tabular-nums">
                    {r.isScope && hasBudget ? (
                      <>
                        {tr("add.impact.remaining")}: {fmt(scopeRemBefore, mainSymbol)} →{" "}
                        <span
                          className={cn(
                            "font-medium",
                            scopeRemAfter < 0 ? "text-destructive" : "text-foreground",
                          )}
                        >
                          {fmt(scopeRemAfter, mainSymbol)}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {tr("add.impact.of", { x: fmtMoney(r.allocated, mainSymbol) })}
                        </span>
                      </>
                    ) : r.isSavings ? (
                      <>
                        {tr("add.impact.saved")}: {fmt(r.savedBefore, mainSymbol)} →{" "}
                        <span
                          className={cn(
                            "font-medium",
                            r.savedAfter < 0 ? "text-destructive" : "text-foreground",
                          )}
                        >
                          {fmt(r.savedAfter, mainSymbol)}
                        </span>
                      </>
                    ) : hasBudget ? (
                      <>
                        {tr("add.impact.remaining")}: {fmt(remBefore, mainSymbol)} →{" "}
                        <span
                          className={cn(
                            "font-medium",
                            remAfter < 0 ? "text-destructive" : "text-foreground",
                          )}
                        >
                          {fmt(remAfter, mainSymbol)}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {tr("add.impact.of", { x: fmtMoney(r.allocated, mainSymbol) })}
                        </span>
                      </>
                    ) : (
                      <>
                        {tr("add.impact.spent")}: {fmt(r.before, mainSymbol)} →{" "}
                        <span className="font-medium text-foreground">
                          {fmt(r.after, mainSymbol)}
                        </span>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {xCur && !refusal && (
          <div className="mt-1 text-[11px] text-muted-foreground">{tr("add.impact.hint_fx")}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ───────── Impact as the database computed it ─────────
// Two questions on an edit, one on a new entry. "This edit" compares the books
// now with the books after saving; "this entry" compares them without the
// entry with after saving, as if it were booked new. Only figures that move
// are shown. Rows are plain differences between snapshots, so any mix of
// changes (account, date, split, person, type) needs no rule of its own.
type ImpactStage = "now" | "without";
type ImpactLine = {
  key: string;
  label: string;
  indent?: boolean;
  what?: string;
  from: number;
  to: number;
  sym: string;
  /** The rise is bad news (you owe more). */
  invert?: boolean;
  of?: number | null;
};

function ImpactBlocks({
  rows,
  isEdit,
  noBudgetReason,
  balances,
  categoryById,
  mainCode,
  mainSymbol,
  locale,
  tr,
}: {
  rows: PreviewImpactRow[];
  isEdit: boolean;
  noBudgetReason: "transfer" | "no_category" | null;
  balances: AccountBalance[] | null;
  categoryById: Map<string, { id: string; name: string }>;
  mainCode: string;
  mainSymbol: string;
  locale: Locale;
  tr: (k: string, p?: Record<string, string>) => string;
}) {
  // Rates into the main currency, as the dashboard's net worth uses them.
  const fxRates = useFxRates(mainCode).data;
  const balById = new Map((balances ?? []).map((b) => [b.id, b]));
  const catName = (id: string | null) => categoryById.get(id ?? "")?.name ?? "?";
  const toMain = (v: number, code: string | undefined): number | null =>
    (code ?? mainCode) === mainCode ? v : convert(v, code ?? mainCode, mainCode, fxRates);

  // Net worth now, from the balances already loaded; the other states add the
  // database's account differences to it.
  let netNow: number | null = 0;
  for (const b of balances ?? []) {
    if (b.archived) continue;
    const v = toMain(Number(b.balance), b.currency_code);
    netNow = v == null || netNow == null ? null : netNow + v;
  }

  const lines = (stage: ImpactStage): { money: ImpactLine[]; budgets: ImpactLine[] } => {
    const from = (r: PreviewImpactRow) => r[stage];
    const moved = rows.filter((r) => r.kind !== "error" && Math.abs(r.after - from(r)) >= 0.005);
    const money: ImpactLine[] = [];

    const accounts = moved
      .filter((r) => r.kind === "account")
      .sort((a, b) =>
        (balById.get(a.ref_id ?? "")?.name ?? "").localeCompare(
          balById.get(b.ref_id ?? "")?.name ?? "",
        ),
      );
    for (const r of accounts) {
      const b = balById.get(r.ref_id ?? "");
      money.push({
        key: "acc-" + r.ref_id,
        label: `${tr("add.impact.account")} · ${b?.name ?? "?"}`,
        from: from(r),
        to: r.after,
        sym: b?.currency_symbol ?? mainSymbol,
      });
    }

    if (netNow != null) {
      let netFrom: number | null = netNow;
      let netTo: number | null = netNow;
      for (const r of rows) {
        if (r.kind !== "account") continue;
        const code = balById.get(r.ref_id ?? "")?.currency_code;
        const f = toMain(from(r) - r.now, code);
        const t = toMain(r.after - r.now, code);
        netFrom = f == null || netFrom == null ? null : netFrom + f;
        netTo = t == null || netTo == null ? null : netTo + t;
      }
      if (netFrom != null && netTo != null && Math.abs(netTo - netFrom) >= 0.005) {
        money.push({
          key: "net",
          label: tr("add.impact.networth"),
          from: netFrom,
          to: netTo,
          sym: mainSymbol,
        });
      }
    }

    const people = moved
      .filter((r) => r.kind === "person")
      .sort(
        (a, b) =>
          Number(!!a.income) - Number(!!b.income) || (a.label ?? "").localeCompare(b.label ?? ""),
      );
    for (const r of people) {
      const who = r.label?.trim() || tr("add.impact.no_one");
      money.push({
        key: `person-${r.income ? "owe" : "owed"}-${who}`,
        label: tr(r.income ? "add.impact.you_owe" : "add.impact.owed_to_you", { x: who }),
        from: from(r),
        to: r.after,
        sym: mainSymbol,
        invert: !!r.income,
      });
    }

    // Budgets: months by date, each sweep target right after the closed
    // months that feed it, then other envelopes, then unassigned money.
    const months = moved
      .filter((r) => r.kind === "month")
      .sort(
        (a, b) =>
          (a.month ?? "").localeCompare(b.month ?? "") ||
          catName(a.ref_id).localeCompare(catName(b.ref_id)),
      );
    const envelopes = new Map(
      moved.filter((r) => r.kind === "envelope").map((r) => [r.ref_id ?? "", r]),
    );
    const feeders = new Map<string, PreviewImpactRow[]>();
    for (const m of months) {
      if (!m.sweep_target || !envelopes.has(m.sweep_target)) continue;
      feeders.set(m.sweep_target, [...(feeders.get(m.sweep_target) ?? []), m]);
    }
    const budgets: ImpactLine[] = [];
    months.forEach((m) => {
      const monthName = format(new Date(m.month + "T00:00:00"), "MMM yyyy", { locale });
      budgets.push({
        key: `month-${m.ref_id}-${m.month}`,
        label: `${catName(m.ref_id)} (${m.closed ? `${monthName}, ${tr("add.impact.closed")}` : monthName})`,
        what: m.income ? tr("add.impact.received") : tr("add.impact.remaining"),
        from: from(m),
        to: m.after,
        sym: mainSymbol,
        of: m.allocated != null && m.allocated > 0 ? m.allocated : null,
      });
      for (const [target, feeding] of feeders) {
        if (feeding[feeding.length - 1] !== m) continue;
        const env = envelopes.get(target)!;
        const parts =
          feeding.length > 1
            ? ` (${feeding
                .map((f, j) => {
                  const d = f.after - from(f);
                  return `${j === 0 ? (d < 0 ? "−" : "+") : d < 0 ? " − " : " + "}${fmtMoney(Math.abs(d), "").trim()}`;
                })
                .join("")})`
            : "";
        budgets.push({
          key: "sweep-" + target,
          label: `↳ ${tr("add.impact.swept", { x: catName(target) })}${parts}`,
          indent: true,
          what: tr("add.impact.saved"),
          from: from(env),
          to: env.after,
          sym: mainSymbol,
        });
      }
    });
    for (const [id, env] of envelopes) {
      if (feeders.has(id)) continue;
      budgets.push({
        key: "env-" + id,
        label: catName(id),
        what: tr("add.impact.saved"),
        from: from(env),
        to: env.after,
        sym: mainSymbol,
      });
    }
    const unalloc = moved.find((r) => r.kind === "unallocated");
    if (unalloc) {
      budgets.push({
        key: "unalloc",
        label: tr("env.moves.unassigned"),
        from: from(unalloc),
        to: unalloc.after,
        sym: mainSymbol,
      });
    }
    return { money, budgets };
  };

  const renderLine = (l: ImpactLine) => {
    const delta = l.to - l.from;
    const good = l.invert ? delta <= 0 : delta >= 0;
    return (
      <li key={l.key} className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className={cn("min-w-0 text-muted-foreground", l.indent && "pl-4")}>{l.label}</span>
        <span className="ml-auto text-right tabular-nums">
          {l.what && <>{l.what}: </>}
          {fmtMoney(l.from, l.sym)} →{" "}
          <span className="font-medium text-foreground">{fmtMoney(l.to, l.sym)}</span>{" "}
          <span className={good ? "text-success" : "text-destructive"}>
            ({delta >= 0 ? "+" : "−"}
            {fmtMoney(Math.abs(delta), l.sym)})
          </span>
          {l.of != null && (
            <span className="text-muted-foreground">
              {" "}
              {tr("add.impact.of", { x: fmtMoney(l.of, mainSymbol) })}
            </span>
          )}
        </span>
      </li>
    );
  };
  const quiet = (key: string, label: string, value?: string) => (
    <li
      key={key}
      className="flex flex-wrap items-baseline justify-between gap-x-3 text-muted-foreground"
    >
      <span className="min-w-0">{label}</span>
      {value && <span className="ml-auto text-right">{value}</span>}
    </li>
  );

  const entry = lines(isEdit ? "without" : "now");
  const entryList = (
    <ul className="space-y-1">
      {entry.money.map(renderLine)}
      {entry.budgets.map(renderLine)}
      {entry.budgets.length === 0 &&
        noBudgetReason &&
        quiet(
          "no-budget",
          tr("add.impact.budgets"),
          tr(`add.impact.budgets_none_${noBudgetReason}`),
        )}
    </ul>
  );
  if (!isEdit) return entryList;

  const edit = lines("now");
  const heading = (title: string, sub: string) => (
    <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
      <span className="font-semibold text-foreground">{title}</span>
      <span className="text-[11px] text-muted-foreground">{sub}</span>
    </div>
  );
  return (
    <div className="space-y-3">
      <div>
        {heading(tr("add.impact.edit"), tr("add.impact.edit_sub"))}
        <ul className="space-y-1">
          {edit.money.map(renderLine)}
          {edit.budgets.map(renderLine)}
          {edit.money.length === 0 &&
            edit.budgets.length === 0 &&
            quiet("none", tr("add.impact.no_changes"))}
        </ul>
      </div>
      <div className="border-t pt-2">
        {heading(tr("add.impact.entry"), tr("add.impact.entry_sub"))}
        {entryList}
      </div>
    </div>
  );
}

/**
 * A refusal the app recognises, in plain words with what to do about it, or
 * null. Anything else is most likely a bug in the app, not in the input.
 */
function knownRefusal(
  message: string,
  tr: (k: string, p?: Record<string, string>) => string,
): string | null {
  if (
    message.includes("in the same currency, destination_amount must be more than the amount sent")
  ) {
    return tr("add.impact.refusal.received_too_low");
  }
  return null;
}

function ImpactRefusal({
  message,
  tr,
}: {
  message: string;
  tr: (k: string, p?: Record<string, string>) => string;
}) {
  const known = knownRefusal(message, tr);
  return (
    <div role="status" className="space-y-1">
      <div className="text-warning">
        {tr(known ? "add.impact.refusal.known_title" : "add.impact.refusal.unknown_title")}
      </div>
      <div className="text-foreground">{known ?? tr("add.impact.refusal.unknown_body")}</div>
      {!known && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">{tr("add.impact.refusal.details")}</summary>
          <div className="mt-1 break-words font-mono">{message}</div>
        </details>
      )}
    </div>
  );
}
