import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, isValid, parseISO } from "date-fns";
import type { Locale as DateFnsLocale } from "date-fns";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import * as z from "zod";
import { ArrowLeftRight, LayoutGrid, ListTree, Rows3 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import {
  fetchCategoryMonthRows,
  fetchSavingsBalances,
  fetchEnvelopeReconciliation,
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
  fetchCategoryLedgerMonth,
  fetchPendingOccurrencesForMonth,
  fetchCategoryTxRange,
  fetchSavingsBalanceSeries,
  type PendingOccurrence,
  type Transaction,
  type CategoryMonthRow,
} from "@/lib/finance";
import { useFxRates, convert } from "@/lib/fx";
import { MonthBudgetSummary } from "@/components/MonthBudgetSummary";
import { ReallocateDialog } from "@/components/ReallocateDialog";
import { SavingsHistoryCard } from "@/components/envelopes/SavingsHistoryCard";
import { EnvelopeDetailSheet } from "@/components/envelopes/EnvelopeDetailSheet";
import { ReallocationEditDialog } from "@/components/envelopes/ReallocationEditDialog";
import { AllocationsView } from "@/components/envelopes/AllocationsView";
import { buildMonthMoves, monthNet, UNASSIGNED_ENVELOPE } from "@/lib/allocations";
import { UnallocatedCard } from "@/components/envelopes/UnallocatedCard";
import { OpeningBalancesDialog } from "@/components/envelopes/OpeningBalancesDialog";
import { DatePicker } from "@/components/DatePicker";
import { MonthNavigator } from "@/components/MonthNavigator";
import { BudgetEditPopover } from "@/components/BudgetEditPopover";
import { defaultAsOfForMonth, monthParam, monthStatus, parseMonthParam } from "@/lib/month";
import { BudgetGrid } from "@/components/envelopes/BudgetGrid";
import { cellId, monthWindow, resolveCells } from "@/lib/budgetGrid";
import { BudgetOverview } from "@/components/envelopes/BudgetOverview";
import { MonthEntries, type ReallocEntry } from "@/components/envelopes/MonthEntries";
import { buildOverview, overviewSummary } from "@/lib/budgetOverview";
import { buildHistory, monthsBefore, prevMonthKey } from "@/lib/budgetHistory";
import { computeMonthTotals } from "@/lib/budgetSummary";
import { fetchCategoryBudgetRange } from "@/lib/finance";
import { PrivacyValue } from "@/components/DashboardPrivacy";

const searchSchema = z.object({
  /** `YYYY-MM`. The month whose budgets are shown; absent means the current month. */
  month: fallback(z.string(), "").default(""),
  /**
   * `YYYY-MM-DD`. Present only when pinned by hand — otherwise the balances date is
   * derived from `month`, so stepping through months moves the balances with them.
   */
  asOf: fallback(z.string(), "").default(""),
  /** `grid` opens the category × month table (desktop), `allocations` the list of
   *  movements between budgets. Cards otherwise. */
  view: fallback(z.string(), "").default(""),
  /** Category id whose Verlauf is open, so a round trip to a transaction returns to it. */
  detail: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/envelopes")({
  validateSearch: zodValidator(searchSchema),
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
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/envelopes" });
  const month = React.useMemo(() => parseMonthParam(search.month), [search.month]);
  const m = monthKey(month);
  const status = monthStatus(month);

  // The balances date follows the month unless it has been pinned by hand: a past month
  // reads at its close, the current month reads today, a future month reads as a
  // projection to its end. Stepping the month clears any pin, which is the whole point.
  const pinned = React.useMemo(() => {
    const parsed = search.asOf ? parseISO(search.asOf) : null;
    return parsed && isValid(parsed) ? parsed : null;
  }, [search.asOf]);
  const asOfDate = pinned ?? defaultAsOfForMonth(month);
  const asOf = format(asOfDate, "yyyy-MM-dd");
  const isProjection = !pinned && status === "future";

  const setMonth = React.useCallback(
    (d: Date) => {
      navigate({
        // Keep `view`: stepping the month must not throw you out of the table. Drop
        // `asOf` so the balances follow the month, which is the point of deriving it.
        search: (prev) => ({ ...prev, month: monthParam(startOfMonth(d)), asOf: "" }),
        replace: true,
      });
    },
    [navigate],
  );
  const view: "cards" | "grid" | "allocations" =
    search.view === "grid" ? "grid" : search.view === "allocations" ? "allocations" : "cards";
  const gridView = view === "grid";
  const setView = React.useCallback(
    (v: "cards" | "grid" | "allocations") => {
      navigate({
        search: (prev) => ({ ...prev, view: v === "cards" ? "" : v }),
        replace: true,
      });
    },
    [navigate],
  );

  // Twelve columns ending at this month, or at the selected one when that is further
  // ahead — so selecting an earlier column reads history in place instead of sliding
  // the whole table, while stepping past today extends into the future and makes
  // those months reachable for planning.
  const gridMonths = React.useMemo(() => {
    const now = startOfMonth(new Date());
    const w = monthWindow(month > now ? month : now, 12);
    return month < w[0] ? monthWindow(month, 12) : w;
  }, [month]);
  const gridTo = monthKey(gridMonths[gridMonths.length - 1]);
  const budgetRangeQ = useQuery({
    // Every row up to the right edge, not just the visible window: the value an
    // undecided month inherits can come from a row older than the first column, and
    // showing the template instead would be a number the database never produces.
    queryKey: ["category_budget_range", gridTo],
    queryFn: () => fetchCategoryBudgetRange("1970-01-01", gridTo),
    enabled: gridView,
    placeholderData: keepPreviousData,
  });

  const setAsOf = React.useCallback(
    (d: Date | null) => {
      navigate({
        search: (prev) => ({ month: prev.month ?? "", asOf: d ? format(d, "yyyy-MM-dd") : "" }),
        replace: true,
      });
    },
    [navigate],
  );
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const rowsQ = useQuery({
    queryKey: ["category_month_rows", m],
    queryFn: () => fetchCategoryMonthRows(m),
    // Keep the month you were looking at on screen while the next one loads.
    // Without this, every step of the month navigator blanks the page.
    placeholderData: keepPreviousData,
  });
  const savingsBalanceQ = useQuery({
    queryKey: ["savings-balances", asOf],
    queryFn: () => fetchSavingsBalances(asOf),
    placeholderData: keepPreviousData,
  });
  const reconQ = useQuery({
    queryKey: ["reconciliation", asOf],
    queryFn: () => fetchEnvelopeReconciliation(asOf),
    placeholderData: keepPreviousData,
  });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const groupsQ = useQuery({ queryKey: ["category_groups"], queryFn: fetchCategoryGroups });
  const pendingImpactQ = useQuery({
    queryKey: ["pending_impact_month", m],
    queryFn: () => fetchPendingImpactsForMonth(m),
    placeholderData: keepPreviousData,
  });
  const txQ = useQuery({
    queryKey: ["envelope_month_tx", format(month, "yyyy-MM")],
    queryFn: () => fetchMonthCategoryTx(month),
    placeholderData: keepPreviousData,
  });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const reallocQ = useQuery({ queryKey: ["reallocations"], queryFn: fetchReallocations });
  // Allocation and leftovers per envelope for the month, from the same ledger as the Verlauf.
  const monthLedgerQ = useQuery({
    queryKey: ["category_ledger_month", m],
    queryFn: () => fetchCategoryLedgerMonth(m),
    placeholderData: keepPreviousData,
  });

  const symbol = settingsQ.data?.currency_symbol ?? "CHF";
  const mainCode = settingsQ.data?.currency_code ?? "CHF";
  const rows = rowsQ.data ?? [];
  const savingsBalanceMap = React.useMemo(
    () => new Map((savingsBalanceQ.data ?? []).map((s) => [s.category_id, s])),
    [savingsBalanceQ.data],
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

  const [openingOpen, setOpeningOpen] = React.useState(false);
  const [reallocOpen, setReallocOpen] = React.useState(false);
  const [reallocFrom, setReallocFrom] = React.useState<string | null>(null);
  const [reallocAmount, setReallocAmount] = React.useState<number | null>(null);
  const detailCat = React.useMemo(() => {
    if (!search.detail) return null;
    return { id: search.detail, name: categoriesById.get(search.detail)?.name ?? "" };
  }, [search.detail, categoriesById]);
  const setDetailCat = React.useCallback(
    (c: { id: string; name?: string } | null) =>
      navigate({ search: (prev) => ({ ...prev, detail: c?.id ?? "" }), replace: !c }),
    [navigate],
  );
  const [editReallocId, setEditReallocId] = React.useState<string | null>(null);
  const openTransaction = React.useCallback(
    (id: string) =>
      navigate({ to: "/edit/$id", params: { id }, search: { back: search, backTo: "envelopes" } }),
    [navigate, search],
  );
  const incomeIds = React.useMemo(
    () => new Set(rows.filter((r) => r.kind === "income").map((r) => r.category_id)),
    [rows],
  );
  const monthMoves = React.useMemo(
    () => (monthLedgerQ.data ? buildMonthMoves(monthLedgerQ.data, incomeIds, m) : []),
    [monthLedgerQ.data, incomeIds, m],
  );
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
      // An empty side is "Nicht zugeordnet": money no envelope held yet.
      const name = (id: string | null) =>
        id ? (categoriesById.get(id)?.name ?? null) : tr("env.moves.unassigned");
      if (r.to_category_id) {
        push(r.to_category_id, {
          id: `${r.id}-in`,
          reallocationId: r.id,
          transactionId: r.transaction_id ?? null,
          occurred_on: r.occurred_on,
          amount,
          inflow: true,
          counterpart: r.transaction_id ? tr("env.ledger.transfer_gain") : name(r.from_category_id),
          note: r.note ?? null,
        });
      }
      if (r.from_category_id) {
        push(r.from_category_id, {
          id: `${r.id}-out`,
          reallocationId: r.id,
          transactionId: r.transaction_id ?? null,
          occurred_on: r.occurred_on,
          amount,
          inflow: false,
          counterpart: name(r.to_category_id),
          note: r.note ?? null,
        });
      }
    }
    return map;
  }, [reallocQ.data, month, categoriesById, tr]);

  const groupKindById = React.useMemo(
    () => new Map((groupsQ.data ?? []).map((g) => [g.id, g.kind])),
    [groupsQ.data],
  );
  const balanceById = React.useMemo(
    () => new Map((savingsBalanceQ.data ?? []).map((b) => [b.category_id, Number(b.cumulative_balance)])),
    [savingsBalanceQ.data],
  );
  const overviewGroups = React.useMemo(
    () =>
      buildOverview({
        rows: effectiveRows,
        groupKindById,
        pendingMap,
        ledgerByCategory: monthLedgerQ.data,
        balanceById,
        month: m,
      }),
    [effectiveRows, groupKindById, pendingMap, monthLedgerQ.data, balanceById, m],
  );
  const overviewSum = React.useMemo(() => overviewSummary(overviewGroups), [overviewGroups]);
  const plannedNet = React.useMemo(
    () => computeMonthTotals(effectiveRows, pendingMap).plannedNet,
    [effectiveRows, pendingMap],
  );

  // A monthly budget's leftover goes to its own target when one is set on it or its
  // group; that is worth saying, the default target is not.
  const sweepTargetName = React.useCallback(
    (id: string) => {
      const cat = categoriesById.get(id);
      const groupOverride = cat?.group_id ? groupSweepById.get(cat.group_id) ?? null : null;
      const override = cat?.sweep_target_category_id ?? groupOverride;
      return override ? (categoriesById.get(override)?.name ?? null) : null;
    },
    [categoriesById, groupSweepById],
  );

  const pendingOccQ = useQuery({
    queryKey: ["pending_occurrences_month", m],
    queryFn: () => fetchPendingOccurrencesForMonth(m),
    enabled: view === "cards",
    placeholderData: keepPreviousData,
  });
  const pendingOccByCategory = React.useMemo(() => {
    const map = new Map<string, PendingOccurrence[]>();
    for (const o of pendingOccQ.data ?? []) {
      const list = map.get(o.category_id) ?? [];
      list.push(o);
      map.set(o.category_id, list);
    }
    return map;
  }, [pendingOccQ.data]);

  // The months before this one, for the chart in an opened row. Loaded only once a
  // row is opened: most visits only read the month.
  const [historyWanted, setHistoryWanted] = React.useState(false);
  const historyMonths = React.useMemo(() => monthsBefore(m, 5), [m]);
  const historyBudgetsQ = useQuery({
    queryKey: ["category_budget_range", historyMonths[historyMonths.length - 1]],
    queryFn: () => fetchCategoryBudgetRange("1970-01-01", historyMonths[historyMonths.length - 1]),
    enabled: historyWanted,
  });
  const historyTxQ = useQuery({
    queryKey: ["budget_history_tx", m],
    queryFn: () => fetchCategoryTxRange(historyMonths[0], m),
    enabled: historyWanted,
  });
  const historySavingsQ = useQuery({
    queryKey: ["savings_balance_series", prevMonthKey(historyMonths[0]), m],
    queryFn: () =>
      fetchSavingsBalanceSeries(
        format(endOfMonth(parseISO(prevMonthKey(historyMonths[0]))), "yyyy-MM-dd"),
        format(endOfMonth(parseISO(historyMonths[historyMonths.length - 1])), "yyyy-MM-dd"),
      ),
    enabled: historyWanted,
  });
  const history = React.useMemo(() => {
    if (!historyBudgetsQ.data || !historyTxQ.data || !historySavingsQ.data || !categoriesQ.data) return undefined;
    const plans = resolveCells(categoriesQ.data, historyBudgetsQ.data, historyMonths.map((k) => parseISO(k)));
    const savings = new Map<string, number>();
    for (const p of historySavingsQ.data) savings.set(`${p.category_id}:${p.as_of.slice(0, 7)}`, Number(p.cumulative_balance));
    return buildHistory({
      months: historyMonths,
      categories: overviewGroups.flatMap((g) =>
        g.rows.map((r) => ({ id: r.id, kind: r.type === "spend" ? ("spend" as const) : r.type })),
      ),
      planOf: (id, month) => plans.get(cellId(id, month))?.amount,
      txs: historyTxQ.data.map((t) => {
        const code = accountById.get(t.source_account_id)?.currency_code ?? mainCode;
        const amount = code === mainCode ? t.amount : (convert(t.amount, code, mainCode, fxQ.data) ?? t.amount);
        return { category_id: t.category_id, type: t.type, amount, occurred_on: t.occurred_on };
      }),
      savingsBalance: (id, ym) => savings.get(`${id}:${ym}`),
    });
  }, [historyBudgetsQ.data, historyTxQ.data, historySavingsQ.data, categoriesQ.data, historyMonths, overviewGroups, accountById, mainCode, fxQ.data]);

  return (
    <AppShell wide={gridView}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{tr("env.title")}</h1>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border p-0.5">
              <Button
                variant={view === "cards" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2"
                aria-label={tr("env.view.cards")}
                title={tr("env.view.cards")}
                onClick={() => setView("cards")}
              >
                <Rows3 className="h-4 w-4" />
              </Button>
              {/* The grid needs a wide screen; on a phone it is cards or allocations. */}
              <Button
                variant={gridView ? "secondary" : "ghost"}
                size="sm"
                className="hidden h-7 px-2 sm:inline-flex"
                aria-label={tr("env.view.grid")}
                title={tr("env.view.grid")}
                onClick={() => setView("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={view === "allocations" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2"
                aria-label={tr("env.view.allocations")}
                title={tr("env.view.allocations")}
                onClick={() => setView("allocations")}
              >
                <ListTree className="h-4 w-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setReallocFrom(null); setReallocAmount(null); setReallocOpen(true); }}
            >
              <ArrowLeftRight className="h-4 w-4 mr-1" />
              {tr("envelopes.reallocate")}
            </Button>
          </div>
        </div>
        {hasForeign && (
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {tr("env.fx_converted_hint", { cur: mainCode })}
          </div>
        )}

        <MonthNavigator month={month} onChange={setMonth} locale={locale} />

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-3">
            <div className="text-sm font-medium">{tr("env.asof.label")}</div>
            <DatePicker
              value={asOfDate}
              onChange={(d) => setAsOf(d)}
              lang={settingsQ.data?.language ?? "de"}
              locale={locale}
              className="h-9 w-[170px]"
            />
            {pinned && (
              <Button variant="ghost" size="sm" onClick={() => setAsOf(null)}>
                {status === "current" ? tr("env.asof.today") : tr("env.asof.follow_month")}
              </Button>
            )}
            {isProjection && (
              <Badge variant="outline" title={tr("env.asof.projected_hint")}>
                {tr("env.asof.projected")}
              </Badge>
            )}
            <div className="ml-auto text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {tr("env.asof.total_saved")}
              </div>
              <PrivacyValue className="text-lg font-bold tabular-nums">
                {fmtMoney(
                  (savingsBalanceQ.data ?? []).reduce((s, r) => s + Number(r.cumulative_balance), 0),
                  symbol,
                )}
              </PrivacyValue>
            </div>
            {isProjection && (
              <p className="w-full text-[11px] leading-snug text-muted-foreground">
                {tr("env.asof.projected_hint")}
              </p>
            )}
          </CardContent>
        </Card>

        {reconQ.data && (
          <UnallocatedCard
            rec={reconQ.data}
            symbol={symbol}
            onAssign={(amount) => {
              setReallocFrom(UNASSIGNED_ENVELOPE);
              setReallocAmount(amount != null ? Math.round(amount * 100) / 100 : null);
              setReallocOpen(true);
            }}
            onDistributeOpenings={() => setOpeningOpen(true)}
          />
        )}

        {rowsQ.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            {tr("env.no_envelopes")} <Link to="/settings" className="text-primary underline-offset-2 hover:underline">{tr("dashboard.create_in_settings")}</Link>.
          </CardContent></Card>
        ) : (
          <>
            {view !== "cards" && <MonthBudgetSummary
              rows={effectiveRows}
              pendingMap={pendingMap}
              symbol={symbol}
              monthLabel={format(month, "MMMM yyyy", { locale })}
            />}
            {gridView && (
              <>
                <p className="text-xs leading-snug text-muted-foreground">{tr("budget.grid.hint")}</p>
                {budgetRangeQ.isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <BudgetGrid
                    months={gridMonths}
                    selectedMonth={month}
                    onSelectMonth={setMonth}
                    categories={categoriesQ.data ?? []}
                    groups={groupsQ.data ?? []}
                    stored={budgetRangeQ.data ?? []}
                    symbol={symbol}
                    locale={locale}
                  />
                )}
              </>
            )}
            {view === "allocations" && (
              monthLedgerQ.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <AllocationsView
                  moves={monthMoves}
                  categoriesById={categoriesById}
                  symbol={symbol}
                  onEditReallocation={setEditReallocId}
                  onOpenTransaction={openTransaction}
                />
              )
            )}
            {view === "cards" && (
              <BudgetOverview
                groups={overviewGroups}
                summary={overviewSum}
                plannedNet={plannedNet}
                month={month}
                symbol={symbol}
                locale={locale}
                history={history}
                historyLoading={historyWanted && !history}
                onNeedHistory={() => setHistoryWanted(true)}
                renderEntries={(r) => (
                  <MonthEntries
                    rowKind={r.type === "income" ? "income" : r.type === "savings" ? "savings" : "expense"}
                    items={byCategory.get(r.id) ?? []}
                    reallocs={reallocByCategory.get(r.id) ?? []}
                    ledger={monthLedgerQ.data?.get(r.id) ?? []}
                    pending={pendingOccByCategory.get(r.id) ?? []}
                    categoriesById={categoriesById}
                    accountById={accountById}
                    symbol={symbol}
                    locale={locale}
                    onOpenTransaction={openTransaction}
                    onEditReallocation={setEditReallocId}
                    onOpenDetail={() => setDetailCat({ id: r.id })}
                  />
                )}
                renderBudgetEdit={(r, trigger) => (
                  <BudgetEditPopover
                    categoryId={r.id}
                    categoryName={r.name}
                    month={month}
                    amount={r.type === "income" ? r.target : r.allocated}
                    locale={locale}
                  >
                    {trigger}
                  </BudgetEditPopover>
                )}
                onReallocate={(id) => { setReallocFrom(id); setReallocAmount(null); setReallocOpen(true); }}
                onOpenDetail={(id) => setDetailCat({ id })}
                onAllTransactions={(id) =>
                  navigate({
                    to: "/transactions",
                    search: {
                      cats: [id],
                      from: format(startOfMonth(month), "yyyy-MM-dd"),
                      to: format(endOfMonth(month), "yyyy-MM-dd"),
                    },
                  })
                }
                sweepTargetName={sweepTargetName}
              />
            )}
          </>
        )}

        {view === "cards" && <SavingsHistoryCard symbol={symbol} />}
      </div>
      <OpeningBalancesDialog open={openingOpen} onOpenChange={setOpeningOpen} />
      <ReallocateDialog
        open={reallocOpen}
        defaultFromId={reallocFrom}
        defaultAmount={reallocAmount}
        onOpenChange={setReallocOpen}
      />
      <ReallocationEditDialog
        reallocationId={editReallocId}
        onOpenTransaction={(id) => { setEditReallocId(null); openTransaction(id); }}
        onOpenChange={(v) => { if (!v) setEditReallocId(null); }}
      />
      <EnvelopeDetailSheet
        onEditReallocation={setEditReallocId}
        onOpenTransaction={openTransaction}
        categoryId={detailCat?.id ?? null}
        categoryName={detailCat?.name ?? ""}
        asOf={asOf}
        symbol={symbol}
        open={!!detailCat}
        onOpenChange={(v) => { if (!v) setDetailCat(null); }}
      />
    </AppShell>
  );
}
