import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchOpenReimbursables,
  fetchReimbursementLinks,
  fetchAccounts,
  setReimbursableStatus,
  fmtMoney,
  type Transaction,
  type Account,
  type ReimbursementLink,
} from "@/lib/finance";
import { useI18n } from "@/i18n";
import { Plus, Check, Ban, Pencil } from "lucide-react";
import { format, parseISO } from "date-fns";

export function OpenReimbursementsCard({ symbol }: { symbol: string }) {
  const { t: tr, locale } = useI18n();
  const qc = useQueryClient();
  const openQ = useQuery({ queryKey: ["reimbursables", "open"], queryFn: fetchOpenReimbursables });
  const linksQ = useQuery({ queryKey: ["reimbursement_links"], queryFn: fetchReimbursementLinks });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

  const [cancelTx, setCancelTx] = React.useState<Transaction | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");

  const accountById = React.useMemo(
    () => new Map((accountsQ.data ?? []).map((a) => [a.id, a])),
    [accountsQ.data],
  );
  const linkedSumByOrig = React.useMemo(() => {
    const m = new Map<string, number>();
    (linksQ.data ?? []).forEach((l: ReimbursementLink) => {
      m.set(l.original_transaction_id, (m.get(l.original_transaction_id) ?? 0) + Number(l.amount));
    });
    return m;
  }, [linksQ.data]);

  const items = openQ.data ?? [];
  if (openQ.isLoading || items.length === 0) return null;

  // Group by counterparty
  const groups = new Map<string, Transaction[]>();
  for (const t of items) {
    const key = (t.reimbursable_counterparty ?? "").trim() || "__none__";
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  const groupEntries = Array.from(groups.entries()).sort((a, b) => {
    if (a[0] === "__none__") return 1;
    if (b[0] === "__none__") return -1;
    return a[0].localeCompare(b[0]);
  });

  const fmtAmt = (tx: Transaction) => {
    const acc = accountById.get(tx.source_account_id);
    return fmtMoney(Number(tx.amount), acc?.currency_symbol ?? symbol);
  };

  const remaining = (tx: Transaction) =>
    Math.max(0, Number(tx.amount) - (linkedSumByOrig.get(tx.id) ?? 0));

  const onMarkSettled = async (tx: Transaction) => {
    try {
      await setReimbursableStatus(tx.id, "settled");
      toast.success(tr("toast.saved"));
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onCancelConfirm = async () => {
    if (!cancelTx) return;
    try {
      await setReimbursableStatus(cancelTx.id, "cancelled", cancelReason.trim() || null);
      toast.success(tr("toast.saved"));
      qc.invalidateQueries();
      setCancelTx(null);
      setCancelReason("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const refundLink = (tx: Transaction) => {
    const rem = remaining(tx);
    const params = new URLSearchParams({
      reimburse_for: tx.id,
      type: "income",
      amount: rem.toFixed(2),
      source: tx.source_account_id,
    });
    if (tx.reimbursable_counterparty) params.set("counterparty", tx.reimbursable_counterparty);
    return `/add?${params.toString()}`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle className="text-base">{tr("dash.reimb.title")}</CardTitle>
          <span className="text-xs text-muted-foreground">{tr("dash.reimb.subtitle")}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {groupEntries.map(([cp, txs]) => {
          const total = txs.reduce((s, x) => s + remaining(x), 0);
          // assume same currency per counterparty group most of the time; fallback to symbol
          const sampleAcc = accountById.get(txs[0].source_account_id);
          const groupSym = sampleAcc?.currency_symbol ?? symbol;
          return (
            <div key={cp} className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-medium">
                  {cp === "__none__" ? tr("dash.reimb.no_counterparty") : cp}
                </div>
                <div className="tabular-nums text-sm font-semibold text-warning">
                  {fmtMoney(total, groupSym)}
                </div>
              </div>
              <ul className="divide-y rounded-md border border-border/60">
                {txs.map((tx) => {
                  const linked = linkedSumByOrig.get(tx.id) ?? 0;
                  const partial = linked > 0 && linked < Number(tx.amount);
                  return (
                    <li key={tx.id} className="flex flex-wrap items-start gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {tx.description || tr("add.expense")}
                          </span>
                          <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning">
                            {tr("tx.reimb.status.open")}
                          </Badge>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {format(parseISO(tx.occurred_on), "dd.MM.yyyy", { locale })}
                          {" · "}
                          {accountById.get(tx.source_account_id)?.name ?? "?"}
                          {tx.reimbursable_reason && ` · ${tx.reimbursable_reason}`}
                        </div>
                        {partial && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {tr("dash.reimb.partial", {
                              paid: fmtMoney(linked, groupSym),
                              total: fmtMoney(Number(tx.amount), groupSym),
                            })}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="tabular-nums text-sm font-semibold">{fmtAmt(tx)}</span>
                      </div>
                      <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
                        <Button asChild size="sm" variant="default" className="h-7 px-2 text-xs">
                          <Link to={refundLink(tx)}>
                            <Plus className="mr-1 h-3 w-3" /> {tr("dash.reimb.add_refund")}
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => onMarkSettled(tx)}
                          aria-label={tr("dash.reimb.mark_settled")}
                          title={tr("dash.reimb.mark_settled")}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-muted-foreground"
                          onClick={() => { setCancelTx(tx); setCancelReason(""); }}
                          aria-label={tr("dash.reimb.mark_cancelled")}
                          title={tr("dash.reimb.mark_cancelled")}
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                        <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-label={tr("common.edit")}>
                          <Link to="/edit/$id" params={{ id: tx.id }}><Pencil className="h-3.5 w-3.5" /></Link>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </CardContent>

      <Dialog open={!!cancelTx} onOpenChange={(v) => { if (!v) setCancelTx(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("dash.reimb.mark_cancelled")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{tr("dash.reimb.cancel.prompt")}</p>
            <Textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder=""
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTx(null)}>{tr("common.cancel")}</Button>
            <Button onClick={onCancelConfirm}>{tr("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// Re-export to satisfy unused-import lint when Account changes
export type { Account };