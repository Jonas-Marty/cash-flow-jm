import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/finance";
import { useI18n } from "@/i18n";
import { computeMonthTotals, monthVerdict, type MonthBudgetTotals } from "@/lib/budgetSummary";
import type { CategoryMonthRow, PendingCategorySigned } from "@/lib/finance";

/**
 * "Will I stay within budget this month?" — the single verdict line plus
 * three category-kind subtotals (income, expenses, savings target).
 */
export function MonthBudgetSummary({
  rows, pendingMap, symbol, monthLabel,
}: {
  rows: CategoryMonthRow[];
  pendingMap: Map<string, PendingCategorySigned>;
  symbol: string;
  monthLabel: string;
}) {
  const { t } = useI18n();
  const totals = React.useMemo<MonthBudgetTotals>(
    () => computeMonthTotals(rows, pendingMap),
    [rows, pendingMap],
  );
  const verdict = monthVerdict(totals);
  const tone =
    verdict === "ok" ? "text-success"
    : verdict === "tight" ? "text-warning"
    : "text-destructive";
  const verdictLabel =
    verdict === "ok" ? t("dashboard.month_verdict.ok")
    : verdict === "tight" ? t("dashboard.month_verdict.tight")
    : t("dashboard.month_verdict.over");

  const net = totals.projectedNet;
  const netStr = `${net >= 0 ? "+" : "−"}${fmtMoney(Math.abs(net), symbol).replace("-", "")}`;

  // Stacked bar: planned expenses + savings target vs. projected expenses + savings target
  const planTotal = Math.max(totals.incomeAllocated, totals.expenseAllocated + totals.savingsTarget, 1);
  const expW = Math.min(100, (totals.expenseProjected / planTotal) * 100);
  const savW = Math.min(100 - expW, (totals.savingsTarget / planTotal) * 100);

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {monthLabel}
          </div>
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-muted-foreground">{t("dashboard.month_verdict.label")}</span>
            <span className={cn("text-base font-bold tabular-nums", tone)}>{netStr}</span>
            <span className={cn("text-xs", tone)}>· {verdictLabel}</span>
          </div>
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <SummaryLine
            label={t("settings.kind_income")}
            actual={totals.incomeReceived}
            allocated={totals.incomeAllocated}
            pending={totals.incomePending}
            projected={totals.incomeProjected}
            symbol={symbol}
            kind="income"
          />
          <SummaryLine
            label={t("settings.kind_expense")}
            actual={totals.expenseSpent}
            allocated={totals.expenseAllocated}
            pending={totals.expensePending}
            projected={totals.expenseProjected}
            symbol={symbol}
            kind="expense"
          />
          <SummaryLine
            label={t("settings.kind_savings")}
            actual={0}
            allocated={totals.savingsTarget}
            pending={0}
            projected={totals.savingsTarget}
            symbol={symbol}
            kind="savings"
          />
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-muted flex" aria-hidden>
          <div className={cn("h-full", verdict === "over" ? "bg-destructive" : "bg-primary")} style={{ width: `${expW}%` }} />
          <div className="h-full bg-success/70" style={{ width: `${savW}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryLine({
  label, actual, allocated, pending, projected, symbol, kind,
}: {
  label: string; actual: number; allocated: number; pending: number; projected: number;
  symbol: string; kind: "income" | "expense" | "savings";
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border bg-card/50 p-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm tabular-nums">
        {kind === "savings" ? (
          <span className="font-semibold">{fmtMoney(allocated, symbol)}</span>
        ) : (
          <>
            <span className="font-semibold">{fmtMoney(actual, symbol)}</span>
            <span className="text-muted-foreground"> / {fmtMoney(allocated, symbol)}</span>
          </>
        )}
      </div>
      {pending > 0 && (
        <div className="text-xs text-warning tabular-nums">
          {t("dashboard.summary.pending", { x: fmtMoney(pending, symbol) })} · {t("dashboard.summary.projected", { x: fmtMoney(projected, symbol) })}
        </div>
      )}
    </div>
  );
}
