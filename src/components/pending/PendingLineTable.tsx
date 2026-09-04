import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Check, History, Loader2, MapPin, Sparkles } from "lucide-react";

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
import { useRecentLocations } from "@/hooks/useRecentLocations";
import { useI18n } from "@/i18n";
import {
  addTagsToNote,
  confirmPendingTransaction,
  fmtMoney,
  rejectPendingTransaction,
  type Account,
  type Category,
  type PendingTransaction,
} from "@/lib/finance";
import { formatAccuracy, locationFromRow, type TxLocation } from "@/lib/location";
import { rankLocationCandidates } from "@/lib/locationSuggest";

type Draft = {
  description: string;
  category_id: string;
  amount: string;
  occurred_on: string;
  source_account_id: string;
  note: string;
  location: TxLocation | null;
  checked: boolean;
  error?: string | null;
};

function seed(p: PendingTransaction): Draft {
  return {
    description: p.description ?? "",
    category_id: p.category_id ?? "",
    amount: String(p.amount),
    occurred_on: p.occurred_on,
    source_account_id: p.source_account_id,
    note: p.note ?? "",
    // Whatever the phone captured, already gated and possibly named by the API.
    location: locationFromRow(p),
    checked: false,
  };
}

/** Tick · date · description · category · account · place · amount. */
const COLUMNS =
  "lg:grid lg:grid-cols-[28px_110px_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_120px] lg:gap-2";

/** A suggestion still counts while the draft has not taken it. */
function suggestsCategory(p: PendingTransaction, d: Draft): boolean {
  return !!p.suggested_category_id && !d.category_id && p.type !== "transfer";
}
function suggestsDescription(p: PendingTransaction, d: Draft): boolean {
  return !!p.suggested_description && p.suggested_description !== d.description;
}

/** The tap that promotes a suggestion: it only ever touches the draft. */
function withSuggestion(p: PendingTransaction, d: Draft): Draft {
  return {
    ...d,
    category_id: suggestsCategory(p, d) ? p.suggested_category_id! : d.category_id,
    description: p.suggested_description ?? d.description,
    note: p.suggested_tags.length ? addTagsToNote(d.note, p.suggested_tags) : d.note,
  };
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

  const patch = (id: string, p: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...p } as Draft }));

  const selected = items.filter((p) => drafts[p.id]?.checked);
  const allChecked = items.length > 0 && selected.length === items.length;

  const suggested = items.filter((p) => {
    const d = drafts[p.id];
    return d && (suggestsCategory(p, d) || suggestsDescription(p, d));
  });
  const applyAllSuggestions = () =>
    setDrafts((prev) => {
      const next = { ...prev };
      for (const p of suggested) next[p.id] = withSuggestion(p, next[p.id] ?? seed(p));
      return next;
    });

  /** Rows are confirmed one at a time so one bad row cannot take the batch down. */
  const confirmMut = useMutation({
    mutationFn: async () => {
      const results: { id: string; ok: boolean; error?: string }[] = [];
      for (const p of selected) {
        const d = drafts[p.id];
        const amount = Number(String(d.amount).replace(",", "."));
        try {
          if (!Number.isFinite(amount) || amount <= 0)
            throw new Error(t("pending.table.err.amount"));
          if (!d.source_account_id) throw new Error(t("toast.account_required"));
          if (p.type === "transfer" && !p.destination_account_id) {
            throw new Error(t("pending.table.err.transfer"));
          }
          await confirmPendingTransaction(p.id, {
            source_account_id: d.source_account_id,
            amount: Math.round(amount * 100) / 100,
            type: p.type,
            occurred_on: d.occurred_on,
            destination_account_id: p.destination_account_id,
            destination_amount: p.destination_amount,
            category_id: p.type === "transfer" ? null : d.category_id || null,
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
            onClick={() => confirmMut.mutate()}
          >
            {confirmMut.isPending ? (
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
          <span>{t("statements.table.col.date")}</span>
          <span>{t("statements.table.col.description")}</span>
          <span>{t("statements.table.col.category")}</span>
          <span>{t("add.account")}</span>
          <span>{t("statements.table.place")}</span>
          <span className="text-right">{t("statements.table.col.amount")}</span>
        </div>

        <ul className="space-y-2">
          {items.map((p) => {
            const d = drafts[p.id];
            if (!d) return null;
            const acc = accounts.find((a) => a.id === d.source_account_id);
            const sym = acc?.currency_symbol ?? symbol;
            const accuracy = formatAccuracy(d.location?.accuracy_m);
            return (
              <li
                key={p.id}
                className={`rounded-md border bg-card p-2 ${COLUMNS} lg:items-center lg:p-2`}
              >
                <div className="mb-2 flex items-center gap-2 lg:mb-0">
                  <Checkbox
                    checked={d.checked}
                    onCheckedChange={(v) => patch(p.id, { checked: !!v })}
                  />
                  <span className="text-xs text-muted-foreground lg:hidden">
                    {d.occurred_on} · {fmtMoney(Number(p.amount), sym)}
                    {p.external_source ? ` · ${p.external_source}` : ""}
                  </span>
                </div>
                <div className="mb-1 lg:mb-0">
                  <Input
                    type="date"
                    className="h-8"
                    value={d.occurred_on}
                    onChange={(e) => patch(p.id, { occurred_on: e.target.value })}
                  />
                </div>
                <div className="mb-1 lg:mb-0">
                  <Input
                    className="h-8"
                    value={d.description}
                    placeholder={t("pending.row.untitled")}
                    onChange={(e) => patch(p.id, { description: e.target.value })}
                  />
                  {suggestsDescription(p, d) ? (
                    <SuggestionChip
                      p={p}
                      label={[
                        p.suggested_description,
                        ...p.suggested_tags.map((x) => `#${x}`),
                      ].join(" ")}
                      onClick={() =>
                        patch(p.id, {
                          description: p.suggested_description ?? d.description,
                          note: p.suggested_tags.length
                            ? addTagsToNote(d.note, p.suggested_tags)
                            : d.note,
                        })
                      }
                    />
                  ) : p.external_source ? (
                    <Badge variant="outline" className="mt-1 hidden text-[10px] lg:inline-flex">
                      {p.external_source}
                    </Badge>
                  ) : null}
                </div>
                <div className="mb-1 lg:mb-0">
                  <Select
                    value={d.category_id || "__none__"}
                    onValueChange={(v) => patch(p.id, { category_id: v === "__none__" ? "" : v })}
                    disabled={p.type === "transfer"}
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
                      label={categories.find((c) => c.id === p.suggested_category_id)?.name ?? "?"}
                      onClick={() => patch(p.id, { category_id: p.suggested_category_id! })}
                    />
                  ) : null}
                </div>
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
                <div className="mb-1 lg:mb-0">
                  <Button
                    type="button"
                    size="sm"
                    variant={d.location ? "secondary" : "outline"}
                    className="h-8 w-full justify-start truncate"
                    onClick={() => setPlaceFor(p.id)}
                  >
                    <MapPin className="mr-1 h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      {d.location?.label ??
                        (d.location
                          ? (accuracy ?? t("loc.title"))
                          : t("statements.table.place_pick"))}
                    </span>
                  </Button>
                </div>
                <div className="mb-1 lg:mb-0">
                  <Input
                    className="h-8 text-right"
                    inputMode="decimal"
                    value={d.amount}
                    onChange={(e) => patch(p.id, { amount: e.target.value })}
                  />
                </div>
                {d.error ? (
                  <p className="text-xs text-destructive lg:col-span-full">{d.error}</p>
                ) : null}
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
