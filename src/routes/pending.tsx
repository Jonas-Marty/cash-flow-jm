import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  Check,
  Ban,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  History,
  LayoutList,
  Loader2,
  Sparkles,
  Table2,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { LocationSection, type RecentLocation } from "@/components/LocationSection";
import { PendingLineTable } from "@/components/pending/PendingLineTable";
import { useRecentLocations } from "@/hooks/useRecentLocations";
import { OpenIOUsCard } from "@/components/OpenIOUsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { isToday, locationFromRow, type TxLocation } from "@/lib/location";
import { rankLocationCandidates } from "@/lib/locationSuggest";
import { enrichPendingTransactions } from "@/utils/pending.functions";
import {
  addTagsToNote,
  fetchPendingTransactions,
  fetchAccounts,
  fetchCategories,
  confirmPendingTransaction,
  rejectPendingTransaction,
  restorePendingTransaction,
  fmtMoney,
  type PendingTransaction,
  type TxType,
  type Account,
  type Category,
} from "@/lib/finance";

export const Route = createFileRoute("/pending")({
  component: PendingRoute,
});

const VIEW_KEY = "pending.view";

function PendingRoute() {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<"pending" | "rejected" | "confirmed" | "ious">("pending");
  // Read after mount: the server has no way to know the stored preference and
  // rendering a different view there would be a hydration mismatch.
  const [view, setView] = React.useState<"table" | "cards">("table");
  React.useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_KEY);
    if (stored === "cards" || stored === "table") setView(stored);
  }, []);
  const chooseView = (next: "table" | "cards") => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* private mode: the choice just does not outlive the visit */
    }
  };
  const pendingQ = useQuery({
    queryKey: ["pending_transactions", tab],
    queryFn: () => fetchPendingTransactions(tab === "ious" ? "pending" : tab),
    enabled: tab !== "ious",
  });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const sym = accountsQ.data?.[0]?.currency_symbol ?? "CHF";

  const items = pendingQ.data ?? [];
  const qc = useQueryClient();

  // "Suggest" re-examines every uncategorised row, including ones already
  // looked at, and says what it found.
  const suggestMut = useMutation({
    mutationFn: () => enrichPendingTransactions({ data: { force: true } }),
    onSuccess: (s) => {
      if (s.rows > 0) qc.invalidateQueries({ queryKey: ["pending_transactions"] });
      if (s.rows === 0 || s.history + s.ai === 0) toast.info(t("pending.suggest.toast.none"));
      else
        toast.success(
          t("pending.suggest.toast", {
            rows: String(s.rows),
            history: String(s.history),
            ai: String(s.ai),
          }),
        );
      if (s.ai_status === "unavailable") toast.warning(t("pending.suggest.ai_unavailable"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  // Catching up silently: rows nobody could place when they arrived (no AI
  // connection online at the time) get another look whenever the tab opens.
  React.useEffect(() => {
    if (tab !== "pending") return;
    let cancelled = false;
    enrichPendingTransactions({ data: {} })
      .then((s) => {
        if (!cancelled && s.history + s.ai > 0)
          qc.invalidateQueries({ queryKey: ["pending_transactions"] });
      })
      .catch(() => {
        /* best effort; the page is not waiting on it */
      });
    return () => {
      cancelled = true;
    };
  }, [tab, qc]);

  // The table needs the room the cards do not, exactly as /transactions does.
  const tableView = tab === "pending" && view === "table";

  return (
    <AppShell wide={tableView}>
      <div className="space-y-4">
        <header>
          <h1 className="text-2xl font-semibold">{t("pending.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("pending.subtitle")}</p>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="pending">{t("pending.tab.pending")}</TabsTrigger>
            <TabsTrigger value="ious">{t("iou.title")}</TabsTrigger>
            <TabsTrigger value="rejected">{t("pending.tab.rejected")}</TabsTrigger>
            <TabsTrigger value="confirmed">{t("pending.tab.confirmed")}</TabsTrigger>
          </TabsList>
          <div className="mt-2 flex items-start justify-between gap-3">
            <p className="min-w-0 text-xs text-muted-foreground">{t(`pending.tab.help.${tab}`)}</p>
            {tab === "pending" ? (
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="mr-2"
                  onClick={() => suggestMut.mutate()}
                  disabled={suggestMut.isPending}
                >
                  {suggestMut.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-4 w-4" />
                  )}
                  {suggestMut.isPending ? t("pending.suggest.running") : t("pending.suggest.run")}
                </Button>
                <Button
                  size="sm"
                  variant={view === "table" ? "secondary" : "ghost"}
                  onClick={() => chooseView("table")}
                  aria-label={t("pending.view.table")}
                  title={t("pending.view.table")}
                >
                  <Table2 className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={view === "cards" ? "secondary" : "ghost"}
                  onClick={() => chooseView("cards")}
                  aria-label={t("pending.view.cards")}
                  title={t("pending.view.cards")}
                >
                  <LayoutList className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </div>
          <TabsContent value={tab} className="mt-4 space-y-3">
            {tab === "ious" ? (
              <OpenIOUsCard symbol={sym} headless />
            ) : pendingQ.isLoading ? (
              <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</CardContent></Card>
            ) : items.length === 0 ? (
              <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">{t("pending.empty")}</CardContent></Card>
            ) : tableView ? (
              <PendingLineTable
                items={items}
                accounts={accountsQ.data ?? []}
                categories={categoriesQ.data ?? []}
                symbol={sym}
              />
            ) : (
              items.map((p) => (
                <PendingRow
                  key={p.id}
                  pending={p}
                  accounts={accountsQ.data ?? []}
                  categories={categoriesQ.data ?? []}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function PendingRow({
  pending,
  accounts,
  categories,
}: {
  pending: PendingTransaction;
  accounts: Account[];
  categories: Category[];
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const isPending = pending.status === "pending";
  const isRejected = pending.status === "rejected";
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");

  // Editable fields, seeded from the pending row
  const [type, setType] = React.useState<TxType>(pending.type);
  const [amount, setAmount] = React.useState<string>(String(pending.amount));
  const [occurredOn, setOccurredOn] = React.useState<string>(pending.occurred_on);
  const [sourceId, setSourceId] = React.useState<string>(pending.source_account_id);
  const [destId, setDestId] = React.useState<string>(pending.destination_account_id ?? "");
  const [destAmount, setDestAmount] = React.useState<string>(
    pending.destination_amount != null ? String(pending.destination_amount) : "",
  );
  const [categoryId, setCategoryId] = React.useState<string>(pending.category_id ?? "");
  const [description, setDescription] = React.useState<string>(pending.description ?? "");
  const [note, setNote] = React.useState<string>(pending.note ?? "");
  const [location, setLocation] = React.useState<TxLocation | null>(() => locationFromRow(pending));
  const recentQ = useRecentLocations();
  const candidates = React.useMemo<RecentLocation[]>(
    () =>
      rankLocationCandidates(recentQ.data ?? [], {
        description,
        near: location,
        limit: 8,
      }),
    [recentQ.data, description, location],
  );

  const acc = accounts.find((a) => a.id === pending.source_account_id);
  const sym = acc?.currency_symbol ?? "CHF";

  const suggestedCat = categories.find((c) => c.id === pending.suggested_category_id);
  const suggestionOpen =
    isPending &&
    ((!!suggestedCat && !categoryId && type !== "transfer") ||
      (!!pending.suggested_description && pending.suggested_description !== description));
  const useSuggestion = () => {
    if (suggestedCat && !categoryId) setCategoryId(suggestedCat.id);
    if (pending.suggested_description) setDescription(pending.suggested_description);
    if (pending.suggested_tags.length) setNote((n) => addTagsToNote(n, pending.suggested_tags));
  };

  const onConfirm = async () => {
    const n = Number(amount.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return toast.error(t("toast.amount_required"));
    if (!sourceId) return toast.error(t("toast.account_required"));
    if (type === "transfer") {
      if (!destId) return toast.error(t("toast.dest_required"));
      if (destId === sourceId) return toast.error(t("toast.dest_must_differ"));
    }
    setBusy(true);
    try {
      await confirmPendingTransaction(pending.id, {
        source_account_id: sourceId,
        amount: Math.round(n * 100) / 100,
        type,
        occurred_on: occurredOn,
        destination_account_id: type === "transfer" ? destId : null,
        destination_amount:
          type === "transfer" && destAmount.trim()
            ? Math.round(Number(destAmount.replace(",", ".")) * 100) / 100
            : null,
        category_id: type === "transfer" ? null : categoryId || null,
        description: description.trim() || null,
        note: note.trim() || null,
        location,
      });
      toast.success(t("pending.toast.confirmed"));
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onReject = async () => {
    setBusy(true);
    try {
      await rejectPendingTransaction(pending.id, rejectReason);
      toast.success(t("pending.toast.rejected"));
      setRejectOpen(false);
      setRejectReason("");
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async () => {
    setBusy(true);
    try {
      await restorePendingTransaction(pending.id);
      toast.success(t("toast.saved"));
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <button
          type="button"
          className="flex w-full items-start justify-between gap-3 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              {open ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
              <CardTitle className="min-w-0 truncate text-base">
                {pending.description || t("pending.row.untitled")}
              </CardTitle>
              {pending.external_source && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {pending.external_source}
                </Badge>
              )}
              {pending.status === "rejected" && (
                <Badge variant="secondary" className="shrink-0">
                  {t("pending.tab.rejected")}
                </Badge>
              )}
              {pending.status === "confirmed" && (
                <Badge variant="secondary" className="shrink-0">
                  {t("pending.tab.confirmed")}
                </Badge>
              )}
            </div>
            {/* Account names and the raw type can be long: let the line wrap
                and break rather than push the amount off a phone screen. */}
            <div className="mt-0.5 break-words text-xs text-muted-foreground">
              {format(parseISO(pending.occurred_on), "dd.MM.yyyy", { locale })}
              {" · "}{acc?.name ?? "?"}
              {" · "}{t(`add.${pending.type}`)}
            </div>
          </div>
          <span className="shrink-0 tabular-nums text-sm font-semibold">
            {fmtMoney(Number(pending.amount), sym)}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {(pending.external_info || pending.external_ref || pending.external_source) && (
            <div className="break-words rounded-md border bg-muted/30 p-3 text-xs">
              <div className="mb-1 font-medium">{t("pending.external.title")}</div>
              {pending.external_source && (
                <div><span className="text-muted-foreground">{t("pending.external.source")}: </span>{pending.external_source}</div>
              )}
              {pending.external_ref && (
                <div><span className="text-muted-foreground">{t("pending.external.ref")}: </span>{pending.external_ref}</div>
              )}
              {pending.external_info && (
                <div className="mt-1 whitespace-pre-wrap break-words">{pending.external_info}</div>
              )}
            </div>
          )}

          {suggestionOpen && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-primary/40 bg-primary/5 p-2 text-xs">
              {pending.suggestion_source === "history" ? (
                <History className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="font-medium">{t("pending.suggest.label")}:</span>
              <span className="min-w-0 flex-1 truncate">
                {[
                  suggestedCat?.name,
                  pending.suggested_description,
                  pending.suggested_tags.map((x) => `#${x}`).join(" ") || null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="text-muted-foreground">
                {pending.suggestion_source === "history"
                  ? t("pending.suggest.source.history")
                  : t("pending.suggest.source.ai", {
                      pct: String(Math.round((pending.suggestion_confidence ?? 0) * 100)),
                    })}
              </span>
              <Button size="sm" variant="secondary" className="h-7" onClick={useSuggestion}>
                {t("pending.suggest.use")}
              </Button>
            </div>
          )}

          {pending.status === "rejected" && pending.reject_reason && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
              <span className="font-medium">{t("pending.reject.reason_label")}: </span>
              {pending.reject_reason}
            </div>
          )}

          {isPending && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t("common.type")}</Label>
                <Select value={type} onValueChange={(v) => setType(v as TxType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">{t("add.expense")}</SelectItem>
                    <SelectItem value="income">{t("add.income")}</SelectItem>
                    <SelectItem value="transfer">{t("add.transfer")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("add.split.amount")}</Label>
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
              </div>
              <div className="space-y-1">
                <Label>{t("add.date")}</Label>
                <Input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t("add.account")}</Label>
                <Select value={sourceId} onValueChange={setSourceId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => !a.archived).map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {type === "transfer" && (
                <>
                  <div className="space-y-1">
                    <Label>{t("add.account")}</Label>
                    <Select value={destId} onValueChange={setDestId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {accounts.filter((a) => !a.archived && a.id !== sourceId).map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>{t("add.dest_amount.label", { sym: acc?.currency_symbol ?? "" })} {t("common.optional")}</Label>
                    <Input value={destAmount} onChange={(e) => setDestAmount(e.target.value)} inputMode="decimal" />
                  </div>
                </>
              )}
              {type !== "transfer" && (
                <div className="space-y-1 sm:col-span-2">
                  <Label>{t("add.category")}</Label>
                  <Select value={categoryId || "__none__"} onValueChange={(v) => setCategoryId(v === "__none__" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t("common.none")}</SelectItem>
                      {categories.filter((c) => !c.archived).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1 sm:col-span-2">
                <Label>{t("add.description")}</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>{t("add.note")}</Label>
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <LocationSection
                  value={location}
                  onChange={setLocation}
                  dateIsToday={isToday(parseISO(occurredOn))}
                  recent={candidates}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {isPending && (
              <>
                <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)} disabled={busy}>
                  <Ban className="mr-1 h-3.5 w-3.5" /> {t("pending.action.reject")}
                </Button>
                <Button size="sm" onClick={onConfirm} disabled={busy}>
                  <Check className="mr-1 h-3.5 w-3.5" /> {t("pending.action.confirm")}
                </Button>
              </>
            )}
            {isRejected && (
              <Button variant="outline" size="sm" onClick={onRestore} disabled={busy}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> {t("pending.action.restore")}
              </Button>
            )}
          </div>
        </CardContent>
      )}

      <Dialog open={rejectOpen} onOpenChange={(v) => { if (!v) setRejectOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("pending.action.reject")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{t("pending.reject.reason_label")} {t("common.optional")}</Label>
            <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={onReject} disabled={busy}>{t("pending.action.reject")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}