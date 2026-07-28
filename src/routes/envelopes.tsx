import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, addMonths, isValid, parseISO } from "date-fns";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ChevronLeft, ChevronRight, ArrowLeftRight, ChevronDown } from "lucide-react";

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
  fetchSavingsBalancesV2,
  fetchSettings,
  fetchAccounts,
  fmtMoney,
  monthKey,
  fetchPendingImpactsForMonth,
  buildPendingMap,
  pendingDeltaForRow,
  fetchCategoryGroups,
  fetchCategories,
  fetchReallocations,
  type Transaction,
  type CategoryMonthRow,
} from "@/lib/finance";
import { StackedBudgetBar } from "@/components/StackedBudgetBar";
import { useFxRates, convert } from "@/lib/fx";
import { MonthBudgetSummary } from "@/components/MonthBudgetSummary";
import { ReallocateDialog } from "@/components/ReallocateDialog";
import { SavingsHistoryCard } from "@/components/envelopes/SavingsHistoryCard";
import { EnvelopeDetailSheet } from "@/components/envelopes/EnvelopeDetailSheet";
import { DateInput } from "@/components/DateInput";
import { PrivacyValue } from "@/components/DashboardPrivacy";

const searchSchema = z.object({
  asOf: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/envelopes")({
  validateSearch: zodValidator(searchSchema),
  component: EnvelopesPage,
});

type ReallocEntry = {
  id: string;
  occurred_on: string;
  amount: number;
  inflow: boolean;
  counterpart: string | null;
  note: string | null;
};

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
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/envelopes" });
  const asOfDate = React.useMemo(() => {
    const parsed = search.asOf ? parseISO(search.asOf) : null;
    return parsed && isValid(parsed) ? parsed : new Date();
  }, [search.asOf]);
  const asOf = format(asOfDate, "yyyy-MM-dd");
  const isToday = asOf === format(new Date(), "yyyy-MM-dd");
  const setAsOf = React.useCallback(
    (d: Date | null) => {
      navigate({
        search: () => ({ asOf: d ? format(d, "yyyy-MM-dd") : "" }),
        replace: true,
      });
    },
    [navigate],
  );
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const rowsQ = useQuery({ queryKey: ["category_month_rows", m], queryFn: () => fetchCategoryMonthRows(m) });
  const savingsQ = useQuery({ queryKey: ["savings_balance"], queryFn: fetchSavingsBalances });
  const savingsV2Q = useQuery({ queryKey: ["savings-balances-v2", asOf], queryFn: () => fetchSavingsBalancesV2(asOf) });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const groupsQ = useQuery({ queryKey: ["category_groups"], queryFn: fetchCategoryGroups });
  const pendingImpactQ = useQuery({ queryKey: ["pending_impact_month", m], queryFn: () => fetchPendingImpactsForMonth(m) });
  const txQ = useQuery({
    queryKey: ["envelope_month_tx", format(month, "yyyy-MM")],
    queryFn: () => fetchMonthCategoryTx(month),
  });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const reallocQ = useQuery({ queryKey: ["reallocations"], queryFn: fetchReallocations });

  const symbol = settingsQ.data?.currency_symbol ?? "CHF";
  const mainCode = settingsQ.data?.currency_code ?? "CHF";
  const rows = rowsQ.data ?? [];
  const savings = savingsQ.data ?? [];
  const savingsMap = new Map(savings.map((s) => [s.category_id, s]));
  const savingsV2Map = React.useMemo(
    () => new Map((savingsV2Q.data ?? []).map((s) => [s.category_id, s])),
    [savingsV2Q.data],
  );
  const categoriesById = React.useMemo(
    () => new Map((categoriesQ.data ?? []).map((c) => [c.id, c])),
    [categoriesQ.data],
  );
  const defaultSweepId = settingsQ.data?.default_sweep_category_id ?? null;
  const groupSweepById = React.useMemo(() => {
    const m = new Map<string, string | null>();
    for (const g of groupsQ.data ?? []) m.set(g.id, (g as unknown as { sweep_target_category_id: string | null }).sweep_target_category_id ?? null);
    return m;
  }, [groupsQ.data]);

  const [reallocOpen, setReallocOpen] = React.useState(false);
  const [reallocFrom, setReallocFrom] = React.useState<string | null>(null);
  const [detailCat, setDetailCat] = React.useState<{ id: string; name: string } | null>(null);
  const [expandedCats, setExpandedCats] = React.useState<Set<string>>(() => new Set());
  const toggleExpanded = React.useCallback((id: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const pendingMap = React.useMemo(() => buildPendingMap(pendingImpactQ.data ?? []), [pendingImpactQ.data]);
  const txs = txQ.data ?? [];
  const accountById = React.useMemo(
    () => new Map((accountsQ.data ?? []).map((a) => [a.id, a])),
    [accountsQ.data],
  );
  const hasForeign = React.useMemo(
    () => (accountsQ.data ?? []).some((a) => (a.currency_code ?? mainCode) !== mainCode),
    [accountsQ.data, mainCode],
  );
  const fxQ = useFxRates(mainCode, hasForeign);

  // Per-category, FX-converted spent_or_received in main currency. Only
  // overrides DB rows when the category had at least one foreign-currency tx.
  const convertedSpentByCat = React.useMemo(() => {
    const m = new Map<string, { converted: number; hadForeign: boolean }>();
    for (const t of txs) {
      if (!t.category_id) continue;
      const acc = accountById.get(t.source_account_id);
      const code = acc?.currency_code ?? mainCode;
      const raw = Number(t.amount);
      // Sign matches `category_month_spending`: expense positive, income negative
      const signed = t.type === "expense" ? raw : t.type === "income" ? -raw : 0;
      let mainAmt: number;
      if (code === mainCode) {
        mainAmt = signed;
      } else {
        const c = convert(signed, code, mainCode, fxQ.data);
        mainAmt = c ?? signed; // fall back to raw if FX not loaded yet
      }
      const cur = m.get(t.category_id) ?? { converted: 0, hadForeign: false };
      cur.converted += mainAmt;
      if (code !== mainCode) cur.hadForeign = true;
      m.set(t.category_id, cur);
    }
    return m;
  }, [txs, accountById, mainCode, fxQ.data]);

  // Build effective rows: replace spent_or_received with converted total when foreign txs exist
  const effectiveRows = React.useMemo(() => {
    if (!hasForeign) return rows;
    return rows.map((r) => {
      const c = convertedSpentByCat.get(r.category_id);
      if (!c?.hadForeign) return r;
      // For income groups, category_month_spending stores income as positive;
      // our convertedSpentByCat uses expense-positive convention. Flip sign back.
      const signed = r.kind === "income" ? -c.converted : c.converted;
      const allocated = Number(r.allocated);
      const variance = r.kind === "income" ? signed - allocated : allocated - signed;
      return { ...r, spent_or_received: signed, variance };
    });
  }, [rows, convertedSpentByCat, hasForeign]);

  const byCategory = new Map<string, Transaction[]>();
  txs.forEach((t) => {
    if (!t.category_id) return;
    const arr = byCategory.get(t.category_id) ?? [];
    arr.push(t);
    byCategory.set(t.category_id, arr);
  });

  // Reallocations that fall inside the displayed month, per category.
  const reallocByCategory = React.useMemo(() => {
    const from = format(startOfMonth(month), "yyyy-MM-dd");
    const to = format(endOfMonth(month), "yyyy-MM-dd");
    const map = new Map<string, ReallocEntry[]>();
    const push = (catId: string, e: ReallocEntry) => {
      const arr = map.get(catId) ?? [];
      arr.push(e);
      map.set(catId, arr);
    };
    for (const r of reallocQ.data ?? []) {
      if (r.occurred_on < from || r.occurred_on > to) continue;
      const amount = Number(r.amount);
      push(r.to_category_id, {
        id: `${r.id}-in`,
        occurred_on: r.occurred_on,
        amount,
        inflow: true,
        counterpart: categoriesById.get(r.from_category_id)?.name ?? null,
        note: r.note ?? null,
      });
      push(r.from_category_id, {
        id: `${r.id}-out`,
        occurred_on: r.occurred_on,
        amount,
        inflow: false,
        counterpart: categoriesById.get(r.to_category_id)?.name ?? null,
        note: r.note ?? null,
      });
    }
    return map;
  }, [reallocQ.data, month, categoriesById]);

  // Group rows by group_id preserving sort. The RPC already returns the
  // effective per-row kind (driven by categories.is_savings, falling back to
  // category_groups.kind), so we trust it directly. Rows without a group fall
  // into a synthetic bucket per effective kind.
  const groups = React.useMemo(() => {
    const map = new Map<string, { name: string; kind: CategoryMonthRow["kind"]; rows: CategoryMonthRow[] }>();
    for (const r of effectiveRows) {
      const key = r.group_id ?? `__${r.kind}__`;
      if (!map.has(key)) {
        map.set(key, {
          name: r.group_id
            ? (r.group_name ?? "")
            : (r.kind === "income" ? "Income" : r.kind === "savings" ? "Savings" : "Uncategorized"),
          kind: r.kind,
          rows: [],
        });
      }
      map.get(key)!.rows.push(r);
    }
    return Array.from(map.values());
  }, [effectiveRows]);

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{tr("env.title")}</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setReallocFrom(null); setReallocOpen(true); }}
          >
            <ArrowLeftRight className="h-4 w-4 mr-1" />
            {tr("envelopes.reallocate")}
          </Button>
        </div>
        {hasForeign && (
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {tr("env.fx_converted_hint", { cur: mainCode })}
          </div>
        )}

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
        ) : (
          <>
            <MonthBudgetSummary
              rows={effectiveRows}
              pendingMap={pendingMap}
              symbol={symbol}
              monthLabel={format(month, "MMMM yyyy", { locale })}
            />
            {groups.map((g) => {
              const totalAlloc = g.rows.reduce((s, r) => s + Number(r.allocated), 0);
              const totalActual = g.rows.reduce((s, r) => s + Number(r.spent_or_received), 0);
              const totalPending = g.rows.reduce((s, r) => {
                const p = pendingMap.get(r.category_id);
                const d = pendingDeltaForRow(p, g.kind);
                return s + (g.kind === "income" ? d : Math.max(0, d));
              }, 0);
              const overProjected = g.kind === "expense" && totalAlloc > 0 && totalActual + totalPending > totalAlloc;
              const remaining = totalAlloc - totalActual - totalPending;
              return (
          <Card key={g.name + g.kind}>
            <CardHeader className="pb-2 space-y-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold uppercase tracking-wide text-foreground">
                  {g.name}
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground">
                    {g.kind === "income" ? tr("settings.kind_income") : g.kind === "savings" ? tr("settings.kind_savings") : tr("settings.kind_expense")}
                  </span>
                </CardTitle>
                <div className={cn("text-lg font-bold tabular-nums", overProjected && "text-destructive")}>
                  {g.kind === "savings"
                    ? fmtMoney(totalAlloc, symbol)
                    : `${fmtMoney(totalActual + totalPending, symbol)} / ${fmtMoney(totalAlloc, symbol)}`}
                </div>
              </div>
              {g.kind !== "savings" && (
                <>
                  <div className="text-xs tabular-nums text-muted-foreground flex flex-wrap gap-x-3">
                    {g.kind === "income" ? (
                      <>
                        <span>{tr("dashboard.group.received", { x: fmtMoney(totalActual, symbol) })}</span>
                        {totalPending > 0 && <span className="text-warning">{tr("dashboard.group.expected", { x: fmtMoney(totalPending, symbol) })}</span>}
                        <span className="ml-auto">{tr("dashboard.group.of_target", { x: fmtMoney(totalAlloc, symbol) })}</span>
                      </>
                    ) : (
                      <>
                        <span>{tr("dashboard.group.spent", { x: fmtMoney(totalActual, symbol) })}</span>
                        {totalPending > 0 && <span className="text-warning">{tr("dashboard.group.pending", { x: fmtMoney(totalPending, symbol) })}</span>}
                        <span className="ml-auto">
                          {overProjected
                            ? <span className="text-destructive">{tr("dashboard.group.over_by", { x: fmtMoney(-remaining, symbol) })}</span>
                            : tr("dashboard.group.left", { x: fmtMoney(remaining, symbol) })}
                        </span>
                      </>
                    )}
                  </div>
                  {g.kind === "expense" && (
                    <StackedBudgetBar className="h-3" allocated={totalAlloc} committed={totalActual} pending={totalPending} />
                  )}
                </>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {g.rows.map((r) => {
                const items = byCategory.get(r.category_id) ?? [];
                const allocated = Number(r.allocated);
                const actual = Number(r.spent_or_received);
                const pending = pendingMap.get(r.category_id);
                // Use the row's own effective kind (from RPC), not the group's,
                // so a savings envelope inside an expense group still computes
                // correctly.
                const rowKind = r.kind;
                const pendingDelta = pendingDeltaForRow(pending, rowKind);
                const pendingPos = Math.max(0, pendingDelta);

                let header: React.ReactNode;
                if (rowKind === "savings") {
                  const v2 = savingsV2Map.get(r.category_id);
                  const balance = v2 ? Number(v2.cumulative_balance) : Number(savingsMap.get(r.category_id)?.balance ?? 0);
                  const monthly = v2 ? Number(v2.month_activity) : 0;
                  header = (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="font-semibold flex items-center gap-2">
                          <span>{r.name}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => { setReallocFrom(r.category_id); setReallocOpen(true); }}
                          >
                            <ArrowLeftRight className="h-3 w-3 mr-1" />
                            {tr("envelopes.reallocate")}
                          </Button>
                        </div>
                        <div className={cn("text-base font-bold tabular-nums", balance < 0 ? "text-destructive" : "text-foreground")}>
                          {fmtMoney(balance, symbol)}
                        </div>
                      </div>
                      {v2 && (
                        <div className="mt-1 text-xs tabular-nums text-muted-foreground flex flex-wrap gap-x-3">
                          <span>{tr("envelopes.savings.month_activity")}: <span className={cn(monthly > 0 ? "text-success" : monthly < 0 ? "text-destructive" : "")}>{monthly >= 0 ? "+" : ""}{fmtMoney(monthly, symbol)}</span></span>
                          {Math.abs(Number(v2.from_sweeps)) > 0.005 && (
                            <span>{tr("envelopes.savings.from_sweeps")}: {fmtMoney(Number(v2.from_sweeps), symbol)}</span>
                          )}
                          {Math.abs(Number(v2.from_reallocations)) > 0.005 && (
                            <span>{tr("envelopes.savings.from_reallocations")}: {fmtMoney(Number(v2.from_reallocations), symbol)}</span>
                          )}
                        </div>
                      )}
                      {pending && (pending.income > 0 || pending.expense > 0) && (
                        <div className="mt-1 text-xs text-warning tabular-nums">
                          {tr("env.savings_pending", { a: fmtMoney(pending.income, symbol), b: fmtMoney(pending.expense, symbol) })}
                        </div>
                      )}
                    </>
                  );
                } else if (rowKind === "income") {
                  const variance = actual - allocated;
                  const tone = variance >= 0 ? "text-success" : "text-destructive";
                  const projected = actual + pendingDelta;
                  header = (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="font-semibold">{r.name}</div>
                        <div className="text-base font-bold tabular-nums">
                          <span className={tone}>{fmtMoney(projected, symbol)}</span>
                          <span className="text-muted-foreground font-normal"> / {fmtMoney(allocated, symbol)}</span>
                        </div>
                      </div>
                      <div className="mt-1 text-xs tabular-nums text-muted-foreground flex flex-wrap gap-x-2">
                        <span>{fmtMoney(actual, symbol)} {tr("dashboard.summary.received_label")}</span>
                        {pendingDelta > 0 && (
                          <span className="text-warning">+{fmtMoney(pendingDelta, symbol)} {tr("dashboard.summary.expected_label")}</span>
                        )}
                        <span className={cn("ml-auto", tone)}>({variance >= 0 ? "+" : ""}{fmtMoney(variance, symbol)})</span>
                      </div>
                    </>
                  );
                } else {
                  const projected = actual + pendingPos;
                  const overProjected = allocated > 0 && projected > allocated;
                  const remainingProjected = allocated - projected;
                  const cat = categoriesById.get(r.category_id);
                  const groupOverride = r.group_id ? groupSweepById.get(r.group_id) ?? null : null;
                  const resolvedSweepId = (cat as unknown as { sweep_target_category_id?: string | null } | undefined)?.sweep_target_category_id ?? groupOverride ?? defaultSweepId;
                  const isOverride = ((cat as unknown as { sweep_target_category_id?: string | null } | undefined)?.sweep_target_category_id ?? null) !== null
                    || (r.group_id != null && groupOverride !== null);
                  const sweepTargetName = resolvedSweepId ? (categoriesById.get(resolvedSweepId)?.name ?? null) : null;
                  header = (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="font-semibold">{r.name}</div>
                        <div className="text-base font-bold tabular-nums">
                          <span className={cn(overProjected ? "text-destructive" : "text-foreground")}>{fmtMoney(projected, symbol)}</span>
                          <span className="text-muted-foreground font-normal"> / {fmtMoney(allocated, symbol)}</span>
                        </div>
                      </div>
                      <StackedBudgetBar className="mt-2 h-1.5" allocated={allocated} committed={actual} pending={pendingPos} />
                      <div className="mt-1 text-xs tabular-nums text-muted-foreground flex flex-wrap gap-x-2">
                        <span>{fmtMoney(actual, symbol)} {tr("dashboard.summary.spent_label")}</span>
                        {pendingPos > 0 && (
                          <span className="text-warning">+{fmtMoney(pendingPos, symbol)} {tr("dashboard.summary.pending_label")}</span>
                        )}
                        <span className={cn("ml-auto", overProjected && "text-destructive font-medium")}>
                          {overProjected
                            ? tr("dashboard.over_by", { x: fmtMoney(-remainingProjected, symbol) })
                            : tr("dashboard.remaining", { x: fmtMoney(remainingProjected, symbol) })}
                        </span>
                      </div>
                      {isOverride && sweepTargetName && Math.abs(allocated - projected) > 0.005 && (
                        <div className="mt-1 text-[11px] text-muted-foreground italic">
                          {tr("envelopes.sweep.target")}: {sweepTargetName}
                        </div>
                      )}
                    </>
                  );
                }

                const isExpanded = expandedCats.has(r.category_id);
                const reallocs = reallocByCategory.get(r.category_id) ?? [];
                const entryCount = items.length + reallocs.length;
                // Heatmap intensity per outflow tx, scaled to the largest outflow in this category
                const maxOutflow = items.reduce((m, t) => {
                  if (t.type !== "expense") return m;
                  const a = Math.abs(Number(t.amount));
                  return a > m ? a : m;
                }, 0);
                return (
                  <div key={r.category_id} className="rounded-md border p-3">
                    {header}
                    {entryCount > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(r.category_id)}
                          className="mt-2 flex w-full items-center justify-between rounded px-1 py-1 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
                          aria-expanded={isExpanded}
                        >
                          <span>
                            {reallocs.length > 0
                              ? tr("env.entry_count", { n: String(entryCount) })
                              : tr("env.tx_count", { n: String(items.length) })}
                          </span>
                          <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
                        </button>
                        {isExpanded && (
                          <ul className="mt-1 divide-y border-t pt-1">
                            {reallocs.map((e) => (
                              <li
                                key={e.id}
                                className="flex items-center justify-between gap-3 px-2 py-2 text-sm rounded-sm bg-muted/40"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="truncate">
                                      {e.note || (e.inflow ? tr("env.realloc_in") : tr("env.realloc_out"))}
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {format(new Date(e.occurred_on), "MMM d", { locale })}
                                    {e.counterpart ? ` · ${e.inflow ? "←" : "→"} ${e.counterpart}` : ""}
                                  </div>
                                </div>
                                <div className={cn("tabular-nums font-medium", e.inflow ? "text-success" : "text-destructive")}>
                                  {e.inflow ? "+" : "-"}{fmtMoney(e.amount, symbol).replace("-", "")}
                                </div>
                              </li>
                            ))}
                            {items.map((t) => {
                              const isInflow = t.type === "income";
                              const label = rowKind === "income"
                                ? (isInflow ? tr("env.income_label") : tr("env.income_adjustment"))
                                : rowKind === "savings"
                                  ? (isInflow ? tr("env.savings_refund") : tr("env.savings_booking"))
                                  : (isInflow ? tr("env.reimb_short") : tr("env.expense_label"));
                              const acc = accountById.get(t.source_account_id);
                              const txSym = acc?.currency_symbol ?? symbol;
                              const amt = Math.abs(Number(t.amount));
                              // Heatmap only for expenses in expense envelopes
                              const intensity = rowKind === "expense" && !isInflow && maxOutflow > 0
                                ? Math.min(1, amt / maxOutflow)
                                : 0;
                              const bgStyle = intensity > 0
                                ? { backgroundColor: `color-mix(in oklab, var(--destructive) ${Math.round(intensity * 22)}%, transparent)` }
                                : undefined;
                              return (
                                <li
                                  key={t.id}
                                  className="flex items-center justify-between gap-3 px-2 py-2 text-sm rounded-sm"
                                  style={bgStyle}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate">{t.description || label}</div>
                                    <div className="text-xs text-muted-foreground">{format(new Date(t.occurred_on), "MMM d", { locale })}</div>
                                  </div>
                                  <div className={cn("tabular-nums font-medium", isInflow ? "text-success" : "text-destructive")}>
                                    {isInflow ? "+" : "-"}{fmtMoney(amt, txSym).replace("-", "")}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
              );
            })}
          </>
        )}
      </div>
      <ReallocateDialog
        open={reallocOpen}
        defaultFromId={reallocFrom}
        onOpenChange={setReallocOpen}
      />
    </AppShell>
  );
}
