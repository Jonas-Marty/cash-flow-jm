import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { Check, Ban, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";

import { AppShell } from "@/components/AppShell";
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
import {
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

function PendingRoute() {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<"pending" | "rejected" | "confirmed">("pending");
  const pendingQ = useQuery({
    queryKey: ["pending_transactions", tab],
    queryFn: () => fetchPendingTransactions(tab),
  });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });

  const items = pendingQ.data ?? [];

  return (
    <AppShell>
      <div className="space-y-4">
        <header>
          <h1 className="text-2xl font-semibold">{t("pending.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("pending.subtitle")}</p>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="pending">{t("pending.tab.pending")}</TabsTrigger>
            <TabsTrigger value="rejected">{t("pending.tab.rejected")}</TabsTrigger>
            <TabsTrigger value="confirmed">{t("pending.tab.confirmed")}</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="mt-4 space-y-3">
            {pendingQ.isLoading ? (
              <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</CardContent></Card>
            ) : items.length === 0 ? (
              <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">{t("pending.empty")}</CardContent></Card>
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

  const acc = accounts.find((a) => a.id === pending.source_account_id);
  const sym = acc?.currency_symbol ?? "CHF";

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
            <div className="flex items-center gap-2">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <CardTitle className="text-base">
                {pending.description || t("pending.row.untitled")}
              </CardTitle>
              {pending.external_source && (
                <Badge variant="outline" className="text-[10px]">{pending.external_source}</Badge>
              )}
              {pending.status === "rejected" && (
                <Badge variant="secondary">{t("pending.tab.rejected")}</Badge>
              )}
              {pending.status === "confirmed" && (
                <Badge variant="secondary">{t("pending.tab.confirmed")}</Badge>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {format(parseISO(pending.occurred_on), "dd.MM.yyyy", { locale })}
              {" · "}{acc?.name ?? "?"}
              {" · "}{pending.type}
            </div>
          </div>
          <span className="tabular-nums text-sm font-semibold">
            {fmtMoney(Number(pending.amount), sym)}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {(pending.external_info || pending.external_ref || pending.external_source) && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="mb-1 font-medium">{t("pending.external.title")}</div>
              {pending.external_source && (
                <div><span className="text-muted-foreground">{t("pending.external.source")}: </span>{pending.external_source}</div>
              )}
              {pending.external_ref && (
                <div><span className="text-muted-foreground">{t("pending.external.ref")}: </span>{pending.external_ref}</div>
              )}
              {pending.external_info && (
                <div className="mt-1 whitespace-pre-wrap">{pending.external_info}</div>
              )}
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
                <Label>{t("add.amount")}</Label>
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
                    <Label>{t("add.dest_account")}</Label>
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
                    <Label>{t("add.dest_amount")} {t("common.optional")}</Label>
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