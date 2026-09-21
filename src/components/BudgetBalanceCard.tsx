import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/finance";
import { computePlanTotals } from "@/lib/budgetSummary";
import { useI18n } from "@/i18n";
import type { Category, CategoryGroup } from "@/lib/finance";

/**
 * Plan-balance card shown above the envelopes editor in Settings.
 *
 * Computes income − expenses − savings for the month the editor is showing. Pass
 * `amounts` (category id → that month's `category_budgets.amount`) and the card
 * reflects that month; omit it and the card falls back to
 * `categories.allocated_budget`, the template used to seed months with no prior row.
 *
 * Scope envelopes are excluded: they are funded from their funding envelope
 * at close time and do not participate in the monthly plan.
 */
export function BudgetBalanceCard({
  categories, groups, symbol, amounts,
}: {
  categories: Category[];
  groups: CategoryGroup[];
  symbol: string;
  /** That month's actual budgets. Falls back to the template per category when absent. */
  amounts?: Map<string, number>;
}) {
  const { t } = useI18n();
  const totals = React.useMemo(
    () => computePlanTotals(categories, groups, amounts),
    [categories, groups, amounts],
  );

  let verdictKey: "balanced" | "buffer" | "over" | "ok";
  if (totals.unallocated < -0.5) verdictKey = "over";
  else if (Math.abs(totals.unallocated) < 1) verdictKey = "balanced";
  else if (totals.income > 0 && totals.unallocated / totals.income > 0.05) verdictKey = "buffer";
  else verdictKey = "ok";

  const tone =
    verdictKey === "over" ? "text-destructive"
    : verdictKey === "balanced" ? "text-success"
    : verdictKey === "buffer" ? "text-primary"
    : "text-muted-foreground";

  const denom = Math.max(totals.income, totals.expense + totals.savings, 1);
  const expW = Math.min(100, (totals.expense / denom) * 100);
  const savW = Math.min(100 - expW, (totals.savings / denom) * 100);
  const bufW = Math.max(0, 100 - expW - savW - (totals.unallocated < 0 ? Math.abs(totals.unallocated) / denom * 100 : 0));
  const overW = totals.unallocated < 0 ? Math.min(100, Math.abs(totals.unallocated) / denom * 100) : 0;

  const verdictLabel =
    verdictKey === "over"
      ? t("settings.balance.over", { x: fmtMoney(Math.abs(totals.unallocated), symbol) })
      : verdictKey === "balanced"
        ? t("settings.balance.balanced")
        : verdictKey === "buffer"
          ? t("settings.balance.buffer", { x: fmtMoney(totals.unallocated, symbol) })
          : t("settings.balance.ok", { x: fmtMoney(totals.unallocated, symbol) });

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("settings.balance.title")}
          </div>
          <div className={cn("text-sm font-semibold", tone)}>{verdictLabel}</div>
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <PlanRow label={t("settings.kind_income")} value={totals.income} symbol={symbol} sign="+" />
          <PlanRow label={t("settings.kind_expense")} value={totals.expense} symbol={symbol} sign="−" />
          <PlanRow label={t("settings.kind_savings")} value={totals.savings} symbol={symbol} sign="−" />
          <PlanRow
            label={t("settings.balance.unallocated")}
            value={totals.unallocated}
            symbol={symbol}
            sign=""
            tone={tone}
          />
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-muted flex" aria-hidden>
          {expW > 0 && <div className="h-full bg-destructive/80" style={{ width: `${expW}%` }} />}
          {savW > 0 && <div className="h-full bg-primary/70" style={{ width: `${savW}%` }} />}
          {bufW > 0 && verdictKey !== "over" && <div className="h-full bg-success/40" style={{ width: `${bufW}%` }} />}
          {overW > 0 && <div className="h-full bg-destructive" style={{ width: `${overW}%` }} />}
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <LegendDot className="bg-destructive/80" label={t("settings.kind_expense")} />
          <LegendDot className="bg-primary/70" label={t("settings.kind_savings")} />
          {verdictKey !== "over"
            ? <LegendDot className="bg-success/40" label={t("settings.balance.unallocated")} />
            : <LegendDot className="bg-destructive" label={t("settings.balance.over_segment")} />}
        </div>
      </CardContent>
    </Card>
  );
}

function PlanRow({ label, value, symbol, sign, tone }: { label: string; value: number; symbol: string; sign: "+" | "−" | ""; tone?: string }) {
  const display = sign === "" ? fmtMoney(value, symbol) : `${sign} ${fmtMoney(Math.abs(value), symbol).replace("-", "")}`;
  return (
    <div className="rounded-md border bg-card/50 p-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-sm font-semibold tabular-nums", tone)}>{display}</div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-2 w-2 rounded-full", className)} />
      {label}
    </span>
  );
}
