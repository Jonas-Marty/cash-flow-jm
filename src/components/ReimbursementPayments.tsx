import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  fetchTransactionsByIds,
  fmtMoney,
  unlinkReimbursement,
  type ReimbursementLink,
  type Transaction,
} from "@/lib/finance";

/**
 * On a reimbursable expense: the incomes that repay it, how much is repaid and
 * how much is still open. A link can be removed here ("Aufheben"); new ones
 * are assigned on the income. Removing one makes the expense open again, and
 * the dashboard and "Offen" list it from then on (they read the status, which
 * the database recomputes).
 */
export function ReimbursementPayments({
  original,
  links,
  symbol,
}: {
  original: Transaction;
  links: ReimbursementLink[];
  symbol: string;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const settlerIds = React.useMemo(
    () => links.map((l) => l.settling_transaction_id).sort(),
    [links],
  );
  const settlersQ = useQuery({
    queryKey: ["transactions_by_ids", settlerIds],
    queryFn: () => fetchTransactionsByIds(settlerIds),
    enabled: settlerIds.length > 0,
  });
  const settlerById = React.useMemo(
    () => new Map((settlersQ.data ?? []).map((s) => [s.id, s])),
    [settlersQ.data],
  );
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const total = Number(original.amount);
  const paid = links.reduce((s, l) => s + Number(l.amount), 0);
  const open = Math.max(0, total - paid);
  const surplus = Math.max(0, paid - total);
  const status = original.reimbursable_status ?? "open";
  // A write-off moved the repayments already; the links behind it stay.
  const locked = status === "written_off";
  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;

  const remove = async (link: ReimbursementLink) => {
    setBusy(true);
    try {
      await unlinkReimbursement(link.id);
      toast.success(t("add.reimb.payments.removed"));
      setConfirmId(null);
      // Everything that reads the status: dashboard, Offen, Buchungen, budgets.
      await qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{t("add.reimb.payments.title")}</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
              status === "open" && "bg-warning/15 text-warning",
              status === "settled" && "bg-success/15 text-success",
              (status === "written_off" || status === "cancelled") &&
                "bg-muted text-muted-foreground",
            )}
          >
            {t(`tx.reimb.status.${status}`)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded bg-muted" aria-hidden="true">
          <div className="h-full bg-success" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs tabular-nums">
          <span>
            {t("add.reimb.payments.repaid", {
              paid: fmtMoney(paid, symbol),
              total: fmtMoney(total, symbol),
            })}
          </span>
          {surplus > 0.005 ? (
            <span className="text-success">
              {t("add.reimb.payments.surplus", { x: fmtMoney(surplus, symbol) })}
            </span>
          ) : open > 0.005 ? (
            <span className="text-warning">
              {t("add.reimb.payments.open", { x: fmtMoney(open, symbol) })}
            </span>
          ) : null}
        </div>
        {links.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("add.reimb.payments.none")}</p>
        ) : (
          <ul className="divide-y">
            {links.map((l) => {
              const s = settlerById.get(l.settling_transaction_id);
              return (
                <li key={l.id} className="space-y-2 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{s?.description || t("add.income")}</div>
                      <div className="text-xs text-muted-foreground">
                        {s ? format(parseISO(s.occurred_on), "dd.MM.yyyy", { locale }) : "…"} ·{" "}
                        <Link
                          to="/edit/$id"
                          params={{ id: l.settling_transaction_id }}
                          className="text-primary underline underline-offset-2"
                        >
                          {t("add.reimb.payments.open_tx")}
                        </Link>
                      </div>
                    </div>
                    <span className="tabular-nums text-success">
                      {fmtMoney(Number(l.amount), symbol)}
                    </span>
                    {!locked && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive"
                        disabled={busy}
                        onClick={() => setConfirmId(confirmId === l.id ? null : l.id)}
                      >
                        {t("add.reimb.payments.remove")}
                      </Button>
                    )}
                  </div>
                  {confirmId === l.id && (
                    <div
                      role="alertdialog"
                      aria-label={t("add.reimb.payments.confirm_title")}
                      className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs"
                    >
                      <div className="font-medium">{t("add.reimb.payments.confirm_title")}</div>
                      <p>
                        {t("add.reimb.payments.confirm_body", {
                          x: fmtMoney(Number(l.amount), symbol),
                          open: fmtMoney(Math.min(total, open + Number(l.amount)), symbol),
                        })}
                      </p>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setConfirmId(null)}
                          disabled={busy}
                        >
                          {t("common.cancel")}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => remove(l)}
                          disabled={busy}
                        >
                          {t("add.reimb.payments.confirm_remove")}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          {locked ? t("add.reimb.payments.locked") : t("add.reimb.payments.assign_hint")}
        </p>
      </CardContent>
    </Card>
  );
}
