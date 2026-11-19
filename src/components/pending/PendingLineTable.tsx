import { formatAmountInput } from "@/lib/amountInput";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  Ban,
  Check,
  History,
  Loader2,
  MapPin,
  Pencil,
  Sparkles,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { IsoDateInput } from "@/components/DateInput";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatementPlaceDialog } from "@/components/statements/StatementPlaceDialog";
import { DescriptionAutocomplete } from "@/components/DescriptionAutocomplete";
import { TagAutocompleteInput } from "@/components/TagAutocomplete";
import { useRecentLocations } from "@/hooks/useRecentLocations";
import { useRecentTransactions } from "@/hooks/useRecentTransactions";
import { useI18n } from "@/i18n";
import {
  addTagsToNote,
  noteHasTag,
  confirmPendingTransaction,
  fmtMoney,
  rejectPendingTransaction,
  type Account,
  type Category,
  type PendingTransaction,
} from "@/lib/finance";
import { formatAccuracy } from "@/lib/location";
import {
  PENDING_FIELDS,
  flushPendingSaves,
  parseAmount,
  pendingEditSearch,
  savePendingValues,
  usePendingSaveError,
  valuesFromRow,
  type PendingValues,
} from "@/lib/pendingEdits";
import { PendingOriginalPopover } from "@/components/pending/PendingOriginalPopover";
import { PendingTypeMenu } from "@/components/pending/PendingTypeMenu";
import { TYPE_TEXT } from "@/lib/txTypeStyle";
import { rankLocationCandidates } from "@/lib/locationSuggest";
import {
  hasSuggestion,
  suggestsCategory,
  suggestsDescription,
  suggestsNote,
  suggestsTags,
  suggestsPlace,
  withSuggestedNote,
  withSuggestion as applySuggestion,
} from "@/lib/pendingSuggestView";

/**
 * The row's fields as the inputs hold them, plus what is only this page's:
 * the tick and the error from the last confirm. The fields are saved onto the
 * pending row as they change (see @/lib/pendingEdits); the tick never is.
 */
type Draft = PendingValues & {
  checked: boolean;
  error?: string | null;
};

const VALUE_KEYS = new Set<string>(PENDING_FIELDS);

function seed(p: PendingTransaction): Draft {
  // Whatever the phone captured, already gated and possibly named by the API,
  // plus whatever was saved here before.
  return { ...valuesFromRow(p), checked: false };
}

function pickValues(d: Partial<Draft>): Partial<PendingValues> {
  return Object.fromEntries(
    Object.entries(d).filter(([k]) => VALUE_KEYS.has(k)),
  ) as Partial<PendingValues>;
}

/**
 * A transfer has no category: its cell picks the account the money goes to,
 * plus what that account received when its currency differs.
 */
function TransferTargetCell({
  d,
  accounts,
  onChange,
}: {
  d: Draft;
  accounts: Account[];
  onChange: (v: Partial<PendingValues>, opts?: { debounce?: boolean }) => void;
}) {
  const { t } = useI18n();
  const source = accounts.find((a) => a.id === d.source_account_id);
  const target = accounts.find((a) => a.id === d.destination_account_id);
  const crossCurrency = !!source && !!target && source.currency_code !== target.currency_code;
  return (
    <div className="mb-1 space-y-1 lg:mb-0">
      <Select
        value={d.destination_account_id || undefined}
        onValueChange={(v) => onChange({ destination_account_id: v })}
      >
        <SelectTrigger
          className={`h-8 w-full ${target ? "" : "border-amber-500/60 text-muted-foreground"}`}
          aria-label={t("add.to_account")}
        >
          <ArrowRight className="mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">
            <SelectValue placeholder={t("pending.table.target_pick")} />
          </span>
        </SelectTrigger>
        <SelectContent>
          {accounts
            .filter((a) => !a.archived && a.id !== d.source_account_id)
            .map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {crossCurrency ? (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t("pending.table.received")}</span>
          <Input
            className="h-7 w-24 text-right tabular-nums"
            inputMode="decimal"
            value={d.destination_amount}
            onChange={(e) =>
              onChange(
                { destination_amount: e.target.value.replace(/[^0-9.,]/g, "") },
                { debounce: true },
              )
            }
            onBlur={() => onChange({ destination_amount: formatAmountInput(d.destination_amount) })}
          />
          <span>{target!.currency_symbol}</span>
        </label>
      ) : null}
    </div>
  );
}

/** The last failed save of a row, under it where confirm errors show. */
function RowSaveError({ id }: { id: string }) {
  const err = usePendingSaveError(id);
  return err ? <p className="text-xs text-destructive lg:col-span-full">{err}</p> : null;
}

/** Tick (and the changed mark) · type and amount · date · description · remarks · category · account · place · edit · confirm. */
const COLUMNS =
  "lg:grid lg:grid-cols-[44px_160px_110px_minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_36px_36px_36px] lg:gap-2";

/**
 * Settles a typed amount to two decimals on blur. Anything that does not parse
 * is left exactly as typed, so the confirm-time error still explains it rather
 * than the field quietly rewriting what someone meant.
 */

/**
 * The predicates and the promotion live in `lib/pendingSuggestView.ts`: the
 * card view in `routes/pending.tsx` renders the same suggestions and used to
 * carry its own drifted copy.
 */
function withSuggestion(p: PendingTransaction, d: Draft): Draft {
  return { ...d, ...applySuggestion(p, d) };
}

/**
 * One chip per suggested field, marked by where it came from — the user's
 * own history is a different kind of claim than a model's guess.
 */
function SuggestionChip({
  p,
  label,
  onClick,
}: {
  p: PendingTransaction;
  label: string;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const fromHistory = p.suggestion_source === "history";
  const why = fromHistory
    ? t("pending.suggest.source.history")
    : t("pending.suggest.source.ai", {
        pct: String(Math.round((p.suggestion_confidence ?? 0) * 100)),
      });
  const Icon = fromHistory ? History : Sparkles;
  return (
    <button
      type="button"
      title={why}
      onClick={onClick}
      className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-dashed border-primary/40 bg-primary/5 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/10"
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * The many-rows view of /pending: everything editable in place, ticked off in
 * batches. The card list stays for the cases this cannot express (transfers,
 * the raw notification text), which is why the two live side by side.
 */
export function PendingLineTable({
  items,
  accounts,
  categories,
  symbol,
}: {
  items: PendingTransaction[];
  accounts: Account[];
  categories: Category[];
  symbol: string;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const recentQ = useRecentLocations();
  const history = useRecentTransactions().data ?? [];

  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [placeFor, setPlaceFor] = React.useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");

  // Seed rows we have not seen; never discard an edit in progress.
  React.useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, Draft> = {};
      let changed = false;
      for (const p of items) {
        next[p.id] = prev[p.id] ?? seed(p);
        if (!prev[p.id]) changed = true;
      }
      if (!changed && Object.keys(prev).length === items.length) return prev;
      return next;
    });
  }, [items]);

  /**
   * Change a row. Field values are saved onto the pending row too: after a
   * pause while typing (`debounce`), straight away for anything picked.
   */
  const patch = (id: string, p: Partial<Draft>, opts: { debounce?: boolean } = {}) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...p } as Draft }));
    const values = pickValues(p);
    if (Object.keys(values).length > 0) {
      savePendingValues(qc, id, values, { immediate: !opts.debounce });
    }
  };

  // Leaving the page writes what is still waiting rather than dropping it.
  React.useEffect(() => () => void flushPendingSaves(), []);

  const selected = items.filter((p) => drafts[p.id]?.checked);
  const allChecked = items.length > 0 && selected.length === items.length;

  const suggested = items.filter((p) => {
    const d = drafts[p.id];
    return !!d && hasSuggestion(p, d);
  });
  const applyAllSuggestions = () => {
    for (const p of suggested) {
      const next = withSuggestion(p, drafts[p.id] ?? seed(p));
      patch(p.id, pickValues(next));
    }
  };

  /** Rows are confirmed one at a time so one bad row cannot take the batch down. */
  const confirmMut = useMutation({
    mutationFn: async (rows: PendingTransaction[]) => {
      const results: { id: string; ok: boolean; error?: string }[] = [];
      for (const p of rows) {
        const d = drafts[p.id];
        const amount = Number(String(d.amount).replace(",", "."));
        try {
          if (!Number.isFinite(amount) || amount <= 0)
            throw new Error(t("pending.table.err.amount"));
          if (!d.source_account_id) throw new Error(t("toast.account_required"));
          if (d.type === "transfer" && !d.destination_account_id) {
            throw new Error(t("pending.table.err.transfer"));
          }
          await confirmPendingTransaction(p.id, {
            source_account_id: d.source_account_id,
            amount: Math.round(amount * 100) / 100,
            type: d.type,
            occurred_on: d.occurred_on,
            destination_account_id: d.destination_account_id || null,
            destination_amount: parseAmount(d.destination_amount),
            category_id: d.type === "transfer" ? null : d.category_id || null,
            description: d.description.trim() || null,
            note: d.note.trim() || null,
            location: d.location,
          });
          results.push({ id: p.id, ok: true });
        } catch (e) {
          results.push({ id: p.id, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const ok = results.filter((r) => r.ok).length;
      setDrafts((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r.ok) delete next[r.id];
          else if (next[r.id]) next[r.id] = { ...next[r.id], error: r.error ?? "error" };
        }
        return next;
      });
      qc.invalidateQueries();
      if (ok > 0) {
        toast.success(
          t("pending.table.toast.confirmed", { ok: String(ok), total: String(results.length) }),
        );
      }
      const failed = results.length - ok;
      if (failed > 0) toast.error(t("pending.table.err.partial", { n: String(failed) }));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const rejectMut = useMutation({
    mutationFn: async () => {
      for (const p of selected) await rejectPendingTransaction(p.id, rejectReason);
      return selected.length;
    },
    onSuccess: (n) => {
      setRejectOpen(false);
      setRejectReason("");
      qc.invalidateQueries();
      toast.success(t("pending.table.toast.rejected", { n: String(n) }));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const busy = confirmMut.isPending || rejectMut.isPending;
  // The row a single-row confirm is working on, so only its button spins.
  const [confirmingOne, setConfirmingOne] = React.useState<string | null>(null);
  const confirmOne = (p: PendingTransaction) => {
    setConfirmingOne(p.id);
    confirmMut.mutate([p], { onSettled: () => setConfirmingOne(null) });
  };

  /**
   * Same shop first, then nearest to the fix the row already carries — which is
   * what separates the two branches of one chain a kilometre apart.
   */
  const candidatesFor = (id: string) => {
    const d = drafts[id];
    return rankLocationCandidates(recentQ.data ?? [], {
      description: d?.description,
      near: d?.location,
      limit: 8,
    });
  };

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Checkbox
          checked={allChecked}
          onCheckedChange={(v) =>
            setDrafts((prev) => {
              const next = { ...prev };
              for (const p of items) next[p.id] = { ...(next[p.id] ?? seed(p)), checked: !!v };
              return next;
            })
          }
          aria-label={t("statements.table.select_all")}
        />
        <span>{t("pending.table.hint")}</span>
        <div className="ml-auto flex items-center gap-2">
          {suggested.length > 0 ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={applyAllSuggestions}>
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {t("pending.suggest.apply_all", { n: String(suggested.length) })}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={selected.length === 0 || busy}
            onClick={() => setRejectOpen(true)}
          >
            <Ban className="mr-1 h-3.5 w-3.5" />
            {t("pending.table.reject", { n: String(selected.length) })}
          </Button>
          <Button
            size="sm"
            disabled={selected.length === 0 || busy}
            onClick={() => confirmMut.mutate(selected)}
          >
            {confirmMut.isPending && confirmingOne === null ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1 h-3.5 w-3.5" />
            )}
            {t("pending.table.confirm", { n: String(selected.length) })}
          </Button>
        </div>
      </div>

      {/* On the wide layout the rows scroll under a pinned header, so the
          column labels and the bulk actions stay put however long the list
          gets. On mobile there is no header to pin and nesting a scroller
          inside the page would only fight the page's own. */}
      <div className="lg:max-h-[calc(100vh-300px)] lg:overflow-auto">
        <div
          className={`sticky top-0 z-10 hidden bg-background px-3 pb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground ${COLUMNS}`}
        >
          <span />
          <span className="text-right">{t("statements.table.col.amount")}</span>
          <span>{t("statements.table.col.date")}</span>
          <span>{t("statements.table.col.description")}</span>
          <span>{t("pending.table.col.note")}</span>
          <span>{t("pending.table.col.category_target")}</span>
          <span>{t("add.account")}</span>
          <span />
          <span />
          <span />
        </div>

        <ul className="space-y-2">
          {items.map((p) => {
            const d = drafts[p.id];
            if (!d) return null;
            const acc = accounts.find((a) => a.id === d.source_account_id);
            const sym = acc?.currency_symbol ?? symbol;
            const accuracy = formatAccuracy(d.location?.accuracy_m);
            const placeLabel =
              d.location?.label ??
              (d.location ? (accuracy ?? t("loc.title")) : t("statements.table.place_pick"));
            return (
              <li
                key={p.id}
                className={`rounded-md border bg-card p-2 ${COLUMNS} lg:items-start lg:p-2`}
                // Focus leaving any field of the row writes what was typed.
                onBlur={() => void flushPendingSaves(p.id)}
              >
                <div className="mb-2 flex items-center gap-2 lg:mb-0 lg:h-8">
                  <Checkbox
                    checked={d.checked}
                    onCheckedChange={(v) => patch(p.id, { checked: !!v })}
                  />
                  <PendingOriginalPopover
                    p={p}
                    current={d}
                    accounts={accounts}
                    categories={categories}
                    symbol={symbol}
                    onRestore={(orig) => patch(p.id, orig)}
                  />
                  {/* The source name arrives from the outside and can be one
                      long token, so this summary has to be free to break. */}
                  <span className="min-w-0 break-words text-xs text-muted-foreground lg:hidden">
                    {d.occurred_on} · {fmtMoney(Number(p.amount), sym)}
                    {p.external_source ? ` · ${p.external_source}` : ""}
                  </span>
                </div>
                <div className="mb-1 flex items-center gap-1 lg:mb-0">
                  <PendingTypeMenu value={d.type} onChange={(type) => patch(p.id, { type })} />
                  <span className="text-xs text-muted-foreground">{sym}</span>
                  <Input
                    className={`h-8 flex-1 text-right font-medium tabular-nums ${TYPE_TEXT[d.type]}`}
                    inputMode="decimal"
                    value={d.amount}
                    onChange={(e) =>
                      patch(
                        p.id,
                        { amount: e.target.value.replace(/[^0-9.,]/g, "") },
                        { debounce: true },
                      )
                    }
                    onBlur={() => patch(p.id, { amount: formatAmountInput(d.amount) })}
                  />
                </div>
                <div className="mb-1 lg:mb-0">
                  <IsoDateInput
                    className="h-8"
                    value={d.occurred_on}
                    onChange={(iso) => patch(p.id, { occurred_on: iso })}
                  />
                </div>
                <div className="mb-1 lg:mb-0">
                  <DescriptionAutocomplete
                    id={`pending-desc-${p.id}`}
                    inputClassName="h-8"
                    value={d.description}
                    placeholder={t("pending.row.untitled")}
                    transactions={history}
                    onChange={(v) => patch(p.id, { description: v }, { debounce: true })}
                  />
                  {suggestsDescription(p, d) ? (
                    <SuggestionChip
                      p={p}
                      label={p.suggested_description!}
                      onClick={() => patch(p.id, { description: p.suggested_description! })}
                    />
                  ) : p.external_source ? (
                    <Badge variant="outline" className="mt-1 hidden text-[10px] lg:inline-flex">
                      {p.external_source}
                    </Badge>
                  ) : null}
                </div>
                <div className="mb-1 lg:mb-0">
                  {/* Tags live in the note as #tag, as in the Add form. */}
                  <TagAutocompleteInput
                    inputClassName="h-8"
                    aria-label={t("pending.table.col.note")}
                    value={d.note}
                    placeholder={t("pending.table.col.note")}
                    transactions={history}
                    ctx={{
                      type: d.type,
                      sourceAccountId: d.source_account_id || undefined,
                      categoryId: d.category_id || undefined,
                      description: d.description || undefined,
                    }}
                    onChange={(v) => patch(p.id, { note: v }, { debounce: true })}
                  />
                  <div className="flex flex-wrap gap-x-1">
                    {suggestsNote(p, d) ? (
                      <SuggestionChip
                        p={p}
                        label={p.suggested_note!}
                        onClick={() =>
                          patch(p.id, { note: withSuggestedNote(d.note, p.suggested_note) })
                        }
                      />
                    ) : null}
                    {suggestsTags(p, d) ? (
                      <SuggestionChip
                        p={p}
                        label={p.suggested_tags
                          .filter((x) => !noteHasTag(d.note, x))
                          .map((x) => `#${x}`)
                          .join(" ")}
                        onClick={() =>
                          patch(p.id, { note: addTagsToNote(d.note, p.suggested_tags) })
                        }
                      />
                    ) : null}
                  </div>
                </div>
                {d.type === "transfer" ? (
                  <TransferTargetCell
                    d={d}
                    accounts={accounts}
                    onChange={(v, opts) => patch(p.id, v, opts)}
                  />
                ) : (
                  <div className="mb-1 lg:mb-0">
                    <Select
                      value={d.category_id || "__none__"}
                      onValueChange={(v) => patch(p.id, { category_id: v === "__none__" ? "" : v })}
                    >
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue placeholder={t("statements.table.col.category")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("common.none")}</SelectItem>
                        {categories
                          .filter((c) => !c.archived)
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {suggestsCategory(p, d) ? (
                      <SuggestionChip
                        p={p}
                        label={
                          categories.find((c) => c.id === p.suggested_category_id)?.name ?? "?"
                        }
                        onClick={() => patch(p.id, { category_id: p.suggested_category_id! })}
                      />
                    ) : null}
                  </div>
                )}
                <div className="mb-1 lg:mb-0">
                  <Select
                    value={d.source_account_id}
                    onValueChange={(v) => patch(p.id, { source_account_id: v })}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue placeholder={t("add.account")} />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts
                        .filter((a) => !a.archived)
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="relative mb-1 lg:mb-0">
                  <Button
                    type="button"
                    size="sm"
                    variant={d.location ? "secondary" : "outline"}
                    className="h-8 w-full justify-start truncate lg:w-9 lg:justify-center"
                    title={placeLabel}
                    aria-label={placeLabel}
                    onClick={() => setPlaceFor(p.id)}
                  >
                    <MapPin className="mr-1 h-3.5 w-3.5 shrink-0 lg:mr-0" />
                    <span className="truncate lg:hidden">{placeLabel}</span>
                  </Button>
                  {/* Remove the place without opening the picker. */}
                  {d.location ? (
                    <button
                      type="button"
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground"
                      onClick={() => patch(p.id, { location: null })}
                      aria-label={t("loc.clear")}
                      title={t("loc.clear")}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                  {suggestsPlace(p, d) ? (
                    <SuggestionChip
                      p={p}
                      label={p.suggested_location!.label ?? t("loc.title")}
                      onClick={() => patch(p.id, { location: p.suggested_location })}
                    />
                  ) : null}
                </div>
                <div className="mb-1 lg:mb-0">
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-8 w-full justify-start lg:w-9 lg:justify-center"
                    title={t("pending.table.edit_hint")}
                    aria-label={t("pending.table.edit")}
                  >
                    <Link
                      to="/add"
                      search={pendingEditSearch(p, d) as never}
                      onClick={() => void flushPendingSaves(p.id)}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5 shrink-0 lg:mr-0" />
                      <span className="truncate lg:hidden">{t("pending.table.edit")}</span>
                    </Link>
                  </Button>
                </div>
                <div className="mb-1 lg:mb-0">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 w-full justify-start lg:w-9 lg:justify-center"
                    title={t("pending.table.approve_one")}
                    aria-label={t("pending.table.approve_one")}
                    disabled={busy}
                    onClick={() => confirmOne(p)}
                  >
                    {confirmingOne === p.id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin lg:mr-0" />
                    ) : (
                      <Check className="mr-1 h-3.5 w-3.5 shrink-0 lg:mr-0" />
                    )}
                    <span className="truncate lg:hidden">{t("pending.action.confirm")}</span>
                  </Button>
                </div>
                {d.error ? (
                  <p className="text-xs text-destructive lg:col-span-full">{d.error}</p>
                ) : null}
                <RowSaveError id={p.id} />
              </li>
            );
          })}
        </ul>
      </div>

      <StatementPlaceDialog
        open={!!placeFor}
        onOpenChange={(v) => setPlaceFor(v ? placeFor : null)}
        value={placeFor ? (drafts[placeFor]?.location ?? null) : null}
        onChange={(loc) => placeFor && patch(placeFor, { location: loc })}
        recent={placeFor ? candidatesFor(placeFor) : []}
      />

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("pending.table.reject", { n: String(selected.length) })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>
              {t("pending.reject.reason_label")} {t("common.optional")}
            </Label>
            <Textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => rejectMut.mutate()} disabled={rejectMut.isPending}>
              {t("pending.action.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
