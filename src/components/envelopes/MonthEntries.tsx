import * as React from "react";
import { format, parseISO } from "date-fns";
import type { Locale as DateFnsLocale } from "date-fns";
import { ArrowDownToLine, ArrowLeftRight, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import {
  fmtMoney,
  type Account,
  type Category,
  type LedgerRow,
  type PendingOccurrence,
  type Transaction,
} from "@/lib/finance";

export type ReallocEntry = {
  id: string;
  reallocationId: string;
  /** Made by a transfer (its difference): opens the transfer, not the edit sheet. */
  transactionId: string | null;
  occurred_on: string;
  amount: number;
  inflow: boolean;
  counterpart: string | null;
  note: string | null;
};

/**
 * An allocation or leftover in a budget's month list, styled like the reallocation
 * rows next to it. Leftovers swept in open the Verlauf, which breaks them down.
 */
function LedgerExtraRow({
  kind,
  label,
  sub,
  amount,
  symbol,
  onClick,
}: {
  kind: "allocation" | "sweep";
  label: string;
  sub: string;
  amount: number;
  symbol: string;
  onClick?: () => void;
}) {
  const Icon = kind === "allocation" ? Plus : ArrowDownToLine;
  return (
    <li
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "flex items-center justify-between gap-3 rounded-sm bg-muted/40 px-2 py-2 text-sm",
        onClick && "cursor-pointer hover:bg-muted",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              kind === "allocation" ? "text-success" : "text-sky-600 dark:text-sky-400",
            )}
          />
          <span className="truncate">{label}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{sub}</div>
      </div>
      <div
        className={cn(
          "font-medium tabular-nums",
          amount >= 0 ? "text-success" : "text-destructive",
        )}
      >
        {amount >= 0 ? "+" : "-"}
        {fmtMoney(Math.abs(amount), symbol)}
      </div>
    </li>
  );
}

/**
 * Everything that moved a budget in the month: bookings, reallocations, its
 * allocation and leftovers, and the recurring bookings still due ("offen").
 */
export function MonthEntries({
  rowKind,
  items,
  reallocs,
  ledger,
  pending,
  categoriesById,
  accountById,
  symbol,
  locale,
  onOpenTransaction,
  onEditReallocation,
  onOpenDetail,
}: {
  rowKind: "income" | "expense" | "savings";
  items: Transaction[];
  reallocs: ReallocEntry[];
  ledger: LedgerRow[];
  pending: PendingOccurrence[];
  categoriesById: Map<string, Category>;
  accountById: Map<string, Account>;
  symbol: string;
  locale?: DateFnsLocale;
  onOpenTransaction: (id: string) => void;
  onEditReallocation: (id: string) => void;
  onOpenDetail: () => void;
}) {
  const { t: tr } = useI18n();
  // Income budgets show the plan as their target already; an allocation row there
  // would read as money received.
  const allocRows = rowKind === "income" ? [] : ledger.filter((l) => l.kind === "allocation");
  const sweepOut = ledger.filter((l) => l.kind === "sweep_out");
  const sweepIn = ledger.filter((l) => l.kind === "sweep_in");
  const day = (iso: string | null) => (iso ? format(parseISO(iso), "d. MMM", { locale }) : "");

  // Heatmap intensity per outflow, scaled to the largest outflow in this budget.
  const maxOutflow = items.reduce((m, t) => {
    if (t.type !== "expense") return m;
    const a = Math.abs(Number(t.amount));
    return a > m ? a : m;
  }, 0);

  const empty =
    items.length +
      reallocs.length +
      allocRows.length +
      sweepOut.length +
      sweepIn.length +
      pending.length ===
    0;
  if (empty) return <p className="text-xs text-muted-foreground">{tr("env.ov.no_entries")}</p>;

  return (
    <ul className="divide-y border-t">
      {pending.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3 px-2 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{p.label}</span>
              <span className="shrink-0 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-success">
                {tr("env.ov.pending_badge")}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">{day(p.effective_on)}</div>
          </div>
          <div
            className={cn(
              "tabular-nums font-medium",
              p.type === "income" ? "text-success" : "text-destructive",
            )}
          >
            {p.type === "income" ? "+" : "-"}
            {fmtMoney(p.amount, symbol)}
          </div>
        </li>
      ))}
      {sweepOut.map((l) => (
        <LedgerExtraRow
          key={l.entry_key}
          kind="sweep"
          label={tr(l.amount > 0 ? "env.ledger.sweep_out_cover" : "env.ledger.sweep_out", {
            name:
              (l.counterpart_category_id && categoriesById.get(l.counterpart_category_id)?.name) ||
              "",
          })}
          sub={day(l.occurred_on)}
          amount={l.amount}
          symbol={symbol}
        />
      ))}
      {reallocs.map((e) => (
        <li
          key={e.id}
          role="button"
          tabIndex={0}
          onClick={() =>
            e.transactionId
              ? onOpenTransaction(e.transactionId)
              : onEditReallocation(e.reallocationId)
          }
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              if (e.transactionId) onOpenTransaction(e.transactionId);
              else onEditReallocation(e.reallocationId);
            }
          }}
          className="flex cursor-pointer items-center justify-between gap-3 rounded-sm bg-muted/40 px-2 py-2 text-sm hover:bg-muted"
        >
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {e.note || (e.inflow ? tr("env.realloc_in") : tr("env.realloc_out"))}
              </span>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {day(e.occurred_on)}
              {e.counterpart ? ` · ${e.inflow ? "←" : "→"} ${e.counterpart}` : ""}
            </div>
          </div>
          <div
            className={cn(
              "tabular-nums font-medium",
              e.inflow ? "text-success" : "text-destructive",
            )}
          >
            {e.inflow ? "+" : "-"}
            {fmtMoney(Math.abs(e.amount), symbol)}
          </div>
        </li>
      ))}
      {items.map((t) => {
        const isInflow = t.type === "income";
        const label =
          rowKind === "income"
            ? isInflow
              ? tr("env.income_label")
              : tr("env.income_adjustment")
            : rowKind === "savings"
              ? isInflow
                ? tr("env.savings_refund")
                : tr("env.savings_booking")
              : isInflow
                ? tr("env.reimb_short")
                : tr("env.expense_label");
        const acc = accountById.get(t.source_account_id);
        const txSym = acc?.currency_symbol ?? symbol;
        const amt = Math.abs(Number(t.amount));
        const intensity =
          rowKind === "expense" && !isInflow && maxOutflow > 0 ? Math.min(1, amt / maxOutflow) : 0;
        const bgStyle =
          intensity > 0
            ? {
                backgroundColor: `color-mix(in oklab, var(--destructive) ${Math.round(intensity * 22)}%, transparent)`,
              }
            : undefined;
        return (
          <li
            key={t.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpenTransaction(t.id)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onOpenTransaction(t.id);
              }
            }}
            className="flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-2 text-sm hover:bg-muted/60"
            style={bgStyle}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate">{t.description || label}</div>
              <div className="text-xs text-muted-foreground">{day(t.occurred_on)}</div>
            </div>
            <div
              className={cn(
                "tabular-nums font-medium",
                isInflow ? "text-success" : "text-destructive",
              )}
            >
              {isInflow ? "+" : "-"}
              {fmtMoney(amt, txSym)}
            </div>
          </li>
        );
      })}
      {allocRows.map((l) => (
        <LedgerExtraRow
          key={l.entry_key}
          kind="allocation"
          label={tr("env.ledger.allocation")}
          sub={`${day(l.occurred_on)} · ${tr("env.ledger.allocation_sub")}`}
          amount={l.amount}
          symbol={symbol}
        />
      ))}
      {sweepIn.length > 0 && (
        <LedgerExtraRow
          kind="sweep"
          label={tr("env.ledger.sweep_in", {
            month: sweepIn[0].meta?.month
              ? format(parseISO(sweepIn[0].meta.month), "MMMM", { locale })
              : "",
          })}
          sub={`${day(sweepIn[0].occurred_on)} · ${
            sweepIn.length === 1
              ? tr("env.ledger.sweep_in_sub_one")
              : tr("env.ledger.sweep_in_sub", { n: String(sweepIn.length) })
          }`}
          amount={sweepIn.reduce((sum, l) => sum + l.amount, 0)}
          symbol={symbol}
          onClick={onOpenDetail}
        />
      )}
    </ul>
  );
}
