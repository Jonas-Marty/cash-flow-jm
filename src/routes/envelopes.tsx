import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, addMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import {
  fetchCategoryMonthRows,
  fetchSavingsBalances,
  fetchSettings,
  fmtMoney,
  monthKey,
  fetchPendingImpactsForMonth,
  buildPendingMap,
  pendingDeltaForRow,
  type Transaction,
  type CategoryMonthRow,
} from "@/lib/finance";
import { StackedBudgetBar } from "@/components/StackedBudgetBar";

export const Route = createFileRoute("/envelopes")({
  component: EnvelopesPage,
});

async function fetchMonthCategoryTx(monthStart: Date): Promise<Transaction[]> {
  const from = format(startOfMonth(monthStart), "yyyy-MM-dd");
  const to = format(endOfMonth(monthStart), "yyyy-MM-dd");
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .gte("occurred_on", from)
    .lte("occurred_on", to)
    .not("category_id", "is", null)
    .order("occurred_on", { ascending: false });
  if (error) throw error;
  return (data || []) as Transaction[];
}

function EnvelopesPage() {
  const { t: tr, locale } = useI18n();
  const [month, setMonth] = React.useState(() => startOfMonth(new Date()));
  const m = monthKey(month);
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const rowsQ = useQuery({ queryKey: ["category_month_rows", m], queryFn: () => fetchCategoryMonthRows(m) });
  const savingsQ = useQuery({ queryKey: ["savings_balance"], queryFn: fetchSavingsBalances });
  const pendingImpactQ = useQuery({ queryKey: ["pending_impact_month", m], queryFn: () => fetchPendingImpactsForMonth(m) });
  const txQ = useQuery({
    queryKey: ["envelope_month_tx", format(month, "yyyy-MM")],
    queryFn: () => fetchMonthCategoryTx(month),
  });

  const symbol = settingsQ.data?.currency_symbol ?? "CHF";
  const rows = rowsQ.data ?? [];
  const savings = savingsQ.data ?? [];
  const savingsMap = new Map(savings.map((s) => [s.category_id, s]));
  const pendingMap = React.useMemo(() => buildPendingMap(pendingImpactQ.data ?? []), [pendingImpactQ.data]);
  const txs = txQ.data ?? [];

  const byCategory = new Map<string, Transaction[]>();
  txs.forEach((t) => {
    if (!t.category_id) return;
    const arr = byCategory.get(t.category_id) ?? [];
    arr.push(t);
    byCategory.set(t.category_id, arr);
  });

  // Group rows by group_id preserving sort
  const groups = React.useMemo(() => {
    const map = new Map<string, { name: string; kind: CategoryMonthRow["kind"]; rows: CategoryMonthRow[] }>();
    for (const r of rows) {
      const isSavingsRow = r.is_savings || r.kind === "savings";
      const effectiveKind: CategoryMonthRow["kind"] = isSavingsRow ? "savings" : r.kind;
      const useGroup = r.group_id && r.kind === effectiveKind;
      const key = useGroup ? r.group_id! : `__${effectiveKind}__`;
      if (!map.has(key)) {
        map.set(key, {
          name: useGroup
            ? (r.group_name ?? "")
            : (effectiveKind === "income" ? "Income" : effectiveKind === "savings" ? "Savings" : "Uncategorized"),
          kind: effectiveKind,
          rows: [],
        });
      }
      map.get(key)!.rows.push(r);
    }
    return Array.from(map.values());
  }, [rows]);

  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{tr("env.title")}</h1>

        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="font-medium">{format(month, "MMMM yyyy", { locale })}</div>
          <Button variant="outline" size="sm" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {rowsQ.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            {tr("env.no_envelopes")} <Link to="/settings" className="text-primary underline-offset-2 hover:underline">{tr("dashboard.create_in_settings")}</Link>.
          </CardContent></Card>
        ) : groups.map((g) => (
          <Card key={g.name + g.kind}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {g.name}
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground">
                  {g.kind === "income" ? tr("settings.kind_income") : g.kind === "savings" ? tr("settings.kind_savings") : tr("settings.kind_expense")}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {g.rows.map((r) => {
                const items = byCategory.get(r.category_id) ?? [];
                const allocated = Number(r.allocated);
                const actual = Number(r.spent_or_received);
                const pending = pendingMap.get(r.category_id);
                const pendingDelta = pendingDeltaForRow(pending, g.kind);
                const pendingPos = Math.max(0, pendingDelta);

                let header: React.ReactNode;
                if (g.kind === "savings") {
                  const balance = Number(savingsMap.get(r.category_id)?.balance ?? 0);
                  header = (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="font-semibold">{r.name}</div>
                        <div className={cn("text-base font-bold tabular-nums", balance < 0 ? "text-destructive" : "text-foreground")}>
                          {tr("env.balance", { x: fmtMoney(balance, symbol) })}
                        </div>
                      </div>
                      {pending && (pending.income > 0 || pending.expense > 0) && (
                        <div className="mt-1 text-xs text-warning tabular-nums">
                          {tr("env.savings_pending", { a: fmtMoney(pending.income, symbol), b: fmtMoney(pending.expense, symbol) })}
                        </div>
                      )}
                    </>
                  );
                } else if (g.kind === "income") {
                  const variance = actual - allocated;
                  const tone = variance >= 0 ? "text-success" : "text-destructive";
                  const projected = actual + pendingDelta;
                  header = (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="font-semibold">{r.name}</div>
                        <div className="text-sm tabular-nums">
                          <span className={cn("font-semibold", tone)}>{fmtMoney(actual, symbol)}</span>
                          <span className="text-muted-foreground"> / {fmtMoney(allocated, symbol)}</span>
                          <span className={cn("ml-2 text-xs", tone)}>({variance >= 0 ? "+" : ""}{fmtMoney(variance, symbol)})</span>
                          {pendingDelta > 0 && (
                            <span className="ml-2 text-xs text-warning">{tr("env.income_expected", { x: fmtMoney(pendingDelta, symbol) })} {tr("env.projected_suffix", { x: fmtMoney(projected, symbol) })}</span>
                          )}
                        </div>
                      </div>
                    </>
                  );
                } else {
                  const projected = actual + pendingPos;
                  const overProjected = allocated > 0 && projected > allocated;
                  const remainingProjected = allocated - projected;
                  header = (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="font-semibold">{r.name}</div>
                        <div className="text-sm tabular-nums text-muted-foreground">
                          <span className={cn(overProjected && "text-destructive font-semibold")}>{fmtMoney(actual, symbol)}</span>
                          <span> / {fmtMoney(allocated, symbol)}</span>
                          {pendingPos > 0 && (
                            <span className="ml-2 text-xs text-warning">{tr("env.pending_suffix", { x: fmtMoney(pendingPos, symbol) })} {tr("env.projected_suffix", { x: fmtMoney(projected, symbol) })}</span>
                          )}
                        </div>
                      </div>
                      <StackedBudgetBar className="mt-2" allocated={allocated} committed={actual} pending={pendingPos} />
                      <div className={cn("mt-1 text-xs tabular-nums", overProjected ? "text-destructive" : "text-muted-foreground")}>
                        {overProjected
                          ? (pendingPos > 0
                              ? tr("env.over_with_pending", { x: fmtMoney(-remainingProjected, symbol) })
                              : tr("dashboard.over_by", { x: fmtMoney(-remainingProjected, symbol) }))
                          : (pendingPos > 0
                              ? tr("env.remaining_with_pending", { x: fmtMoney(remainingProjected, symbol) })
                              : tr("dashboard.remaining", { x: fmtMoney(allocated - actual, symbol) }))}
                      </div>
                    </>
                  );
                }

                return (
                  <div key={r.category_id} className="rounded-md border p-3">
                    {header}
                    {items.length > 0 && (
                      <ul className="mt-3 divide-y border-t pt-2">
                        {items.map((t) => {
                          const isInflow = t.type === "income";
                          const label = g.kind === "income"
                            ? (isInflow ? tr("env.income_label") : tr("env.income_adjustment"))
                            : g.kind === "savings"
                              ? (isInflow ? tr("env.savings_refund") : tr("env.savings_booking"))
                              : (isInflow ? tr("env.reimb_short") : tr("env.expense_label"));
                          return (
                            <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                              <div className="min-w-0 flex-1">
                                <div className="truncate">{t.description || label}</div>
                                <div className="text-xs text-muted-foreground">{format(new Date(t.occurred_on), "MMM d", { locale })}</div>
                              </div>
                              <div className={cn("tabular-nums font-medium", isInflow ? "text-success" : "text-destructive")}>
                                {isInflow ? "+" : "-"}{fmtMoney(Number(t.amount), symbol).replace("-", "")}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
