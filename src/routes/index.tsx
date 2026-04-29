import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowLeftRight, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { UpcomingCard } from "@/components/UpcomingCard";
import {
  fetchAccountBalances,
  fetchAccountBalancesAsOf,
  fetchCategoryMonthRows,
  fetchSavingsBalances,
  fetchSettings,
  fetchTransactions,
  fetchAccounts,
  fetchRecurringRules,
  processRecurringRules,
  fetchPendingImpactsForMonth,
  buildPendingMap,
  pendingDeltaForRow,
  fmtMoney,
  groupSumByCurrency,
  formatPerCurrency,
  monthKey,
  endOfMonthISO,
  endOfYearISO,
  type CategoryMonthRow,
  type CategorySavingsBalance,
  type AccountBalance,
  type PendingCategorySigned,
} from "@/lib/finance";
import { StackedBudgetBar } from "@/components/StackedBudgetBar";
import { useFxRates, convert } from "@/lib/fx";
import { MonthBudgetSummary } from "@/components/MonthBudgetSummary";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const { t, locale } = useI18n();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const m = monthKey(monthStart);
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const balancesQ = useQuery({ queryKey: ["account_balances"], queryFn: fetchAccountBalances });
  const eomDate = React.useMemo(() => endOfMonthISO(), []);
  const eoyDate = React.useMemo(() => endOfYearISO(), []);
  const eomQ = useQuery({ queryKey: ["account_balances_as_of", eomDate], queryFn: () => fetchAccountBalancesAsOf(eomDate) });
  const eoyQ = useQuery({ queryKey: ["account_balances_as_of", eoyDate], queryFn: () => fetchAccountBalancesAsOf(eoyDate) });
  const envelopesQ = useQuery({ queryKey: ["category_month_rows", m], queryFn: () => fetchCategoryMonthRows(m) });
  const savingsQ = useQuery({ queryKey: ["savings_balance"], queryFn: fetchSavingsBalances });
  const pendingImpactQ = useQuery({ queryKey: ["pending_impact_month", m], queryFn: () => fetchPendingImpactsForMonth(m) });
  const recentQ = useQuery({ queryKey: ["transactions", "recent"], queryFn: () => fetchTransactions(8) });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const rulesQ = useQuery({ queryKey: ["recurring_rules"], queryFn: fetchRecurringRules });
  // Run the recurring processor once when the dashboard mounts.
  // Idempotent — safe even if the user reloads many times.
  React.useEffect(() => {
    processRecurringRules().catch(() => {});
  }, []);

  const symbol = settingsQ.data?.currency_symbol ?? "CHF";
  const mainCode = settingsQ.data?.currency_code ?? "CHF";
  const showConverted = !!settingsQ.data?.net_worth_show_converted;
  const accounts = balancesQ.data ?? [];
  const assets = accounts.filter((a) => a.type === "asset" && !a.archived);
  const liabilities = accounts.filter((a) => a.type === "liability" && !a.archived);

  // Detect any non-main currency among balances. If absent, render exactly
  // like before — single total in the user's main currency.
  const hasForeign = React.useMemo(
    () => accounts.some((a) => !a.archived && (a.currency_code ?? mainCode) !== mainCode),
    [accounts, mainCode],
  );
  const fxQ = useFxRates(mainCode, hasForeign);

  // Per-currency totals (separate buckets, no FX involved)
  const assetsByCur = React.useMemo(
    () => groupSumByCurrency(assets, (a) => a.currency_code ?? mainCode, (a) => Number(a.balance)),
    [assets, mainCode],
  );
  const liabByCur = React.useMemo(
    () => groupSumByCurrency(liabilities, (a) => a.currency_code ?? mainCode, (a) => Number(a.balance)),
    [liabilities, mainCode],
  );
  const symbolForCode = React.useCallback(
    (code: string) => {
      const acc = accounts.find((a) => (a.currency_code ?? mainCode) === code);
      return acc?.currency_symbol ?? (code === mainCode ? symbol : code);
    },
    [accounts, mainCode, symbol],
  );

  // Main-currency-only totals (used for the headline when no foreign currencies exist)
  const totalAssetsMain = (assetsByCur.get(mainCode) ?? 0);
  const totalLiabMain = (liabByCur.get(mainCode) ?? 0);

  // Converted totals (only used when toggle is on or for projection tiles fallback)
  const convertedTotal = React.useCallback(
    (rows: AccountBalance[]) =>
      rows.reduce((s, a) => {
        const code = a.currency_code ?? mainCode;
        const v = Number(a.balance);
        if (code === mainCode) return s + v;
        const c = convert(v, code, mainCode, fxQ.data);
        return s + (c ?? 0);
      }, 0),
    [fxQ.data, mainCode],
  );
  const totalAssetsConverted = convertedTotal(assets);
  const totalLiabConverted = convertedTotal(liabilities);
  const netWorthConverted = totalAssetsConverted + totalLiabConverted;
  const netWorthMainOnly = totalAssetsMain + totalLiabMain;

  const [showOther, setShowOther] = React.useState(false);

  const envelopes = envelopesQ.data ?? [];
  const savings = savingsQ.data ?? [];
  const pendingMap = React.useMemo(() => buildPendingMap(pendingImpactQ.data ?? []), [pendingImpactQ.data]);
  const accountById = React.useMemo(
    () => new Map((accountsQ.data ?? []).map((a) => [a.id, a])),
    [accountsQ.data],
  );

  // Group envelopes by group_id, preserving sort order
  const grouped = React.useMemo(() => groupRows(envelopes), [envelopes]);

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
            <p className="text-sm text-muted-foreground">{format(new Date(), "MMMM yyyy", { locale })}</p>
          </div>
          <Button asChild size="sm" className="hidden md:inline-flex">
            <Link to="/add"><Plus className="h-4 w-4" /> {t("nav.add_transaction")}</Link>
          </Button>
        </header>

        {/* Net worth */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("dashboard.networth")}</CardTitle>
          </CardHeader>
          <CardContent>
            <NetWorthBlock
              showConverted={showConverted}
              hasForeign={hasForeign}
              loading={balancesQ.isLoading}
              netWorthMain={netWorthMainOnly}
              netWorthConverted={netWorthConverted}
              totalAssetsMain={totalAssetsMain}
              totalLiabMain={totalLiabMain}
              totalAssetsConverted={totalAssetsConverted}
              totalLiabConverted={totalLiabConverted}
              assetsByCur={assetsByCur}
              liabByCur={liabByCur}
              symbol={symbol}
              mainCode={mainCode}
              symbolForCode={symbolForCode}
              showOther={showOther}
              setShowOther={setShowOther}
              fxReady={!hasForeign || !!fxQ.data}
              tr={t}
            />
          </CardContent>
        </Card>

        {/* Projected net worth */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("dashboard.projected")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <ProjectionTile
                label={t("dashboard.projected_eom")}
                date={eomDate}
                accounts={eomQ.data ?? []}
                loading={eomQ.isLoading}
                symbol={symbol}
                locale={locale}
                tr={t}
              />
              <ProjectionTile
                label={t("dashboard.projected_eoy")}
                date={eoyDate}
                accounts={eoyQ.data ?? []}
                loading={eoyQ.isLoading}
                symbol={symbol}
                locale={locale}
                tr={t}
              />
            </div>
          </CardContent>
        </Card>

        {/* Accounts */}
        <div className="grid gap-4 md:grid-cols-2">
          <AccountsCard title={t("dashboard.assets")} tone="success" items={assets} symbol={symbol} loading={balancesQ.isLoading} emptyHint={t("dashboard.assets_empty")} />
          <AccountsCard title={t("dashboard.liabilities")} tone="destructive" items={liabilities} symbol={symbol} loading={balancesQ.isLoading} emptyHint={t("dashboard.liab_empty")} />
        </div>

        {/* Upcoming & due (recurring) */}
        <UpcomingCard symbol={symbol} />

        {/* Envelopes */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t("dashboard.envelopes_month")}</h2>
            <Link to="/envelopes" className="text-sm text-muted-foreground hover:text-foreground">{t("common.viewAll")}</Link>
          </div>
          {envelopesQ.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
          ) : envelopes.length === 0 ? (
            <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
              {t("dashboard.no_envelopes")} <Link to="/settings" className="font-medium text-primary underline-offset-2 hover:underline">{t("dashboard.create_in_settings")}</Link>.
            </CardContent></Card>
          ) : (
            <div className="space-y-4">
              <MonthBudgetSummary
                rows={envelopes}
                pendingMap={pendingMap}
                symbol={symbol}
                monthLabel={format(monthStart, "MMMM yyyy", { locale })}
              />
              {grouped.map((g) => (
                <GroupBlock key={g.key} group={g} symbol={symbol} savings={savings} pendingMap={pendingMap} tr={t} />
              ))}
            </div>
          )}
        </section>

        {/* Recent transactions */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t("dashboard.recent")}</h2>
            <Link to="/transactions" className="text-sm text-muted-foreground hover:text-foreground">{t("common.viewAll")}</Link>
          </div>
          {recentQ.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (recentQ.data ?? []).length === 0 ? (
            <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">{t("dashboard.no_transactions")}</CardContent></Card>
          ) : (
            <Card><CardContent className="divide-y p-0">
              {(recentQ.data ?? []).map((tx) => {
                const Icon = tx.type === "expense" ? ArrowDown : tx.type === "income" ? ArrowUp : ArrowLeftRight;
                const tone = tx.type === "expense" ? "text-destructive" : tx.type === "income" ? "text-success" : "text-muted-foreground";
                const sign = tx.type === "expense" ? "-" : tx.type === "income" ? "+" : "";
                const srcAcc = accountById.get(tx.source_account_id);
                const txSym = srcAcc?.currency_symbol ?? symbol;
                return (
                  <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-full bg-muted", tone)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {tx.description || (tx.type === "transfer"
                          ? t("tx.transfer_label")
                          : tx.type === "income" ? t("add.income") : t("add.expense"))}
                        {tx.recurring_rule_id && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                            {t("tx.from_rule")}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{format(new Date(tx.occurred_on), "MMM d", { locale })}</div>
                    </div>
                    <div className={cn("text-sm font-semibold tabular-nums", tone)}>
                      {sign}{fmtMoney(Number(tx.amount), txSym).replace("-", "")}
                    </div>
                  </div>
                );
              })}
            </CardContent></Card>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function ProjectionTile({
  label, date, accounts, loading, symbol, locale, tr,
}: {
  label: string;
  date: string;
  accounts: AccountBalance[];
  loading: boolean;
  symbol: string;
  locale: import("date-fns").Locale;
  tr: (k: string, v?: Record<string, string | number>) => string;
}) {
  const active = accounts.filter((a) => !a.archived);
  const assets = active.filter((a) => a.type === "asset");
  const liabilities = active.filter((a) => a.type === "liability");
  const totalAssets = assets.reduce((s, a) => s + Number(a.balance), 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + Number(a.balance), 0);
  const net = totalAssets + totalLiabilities;
  const dateLabel = format(new Date(date), "PP", { locale });
  return (
    <div className="rounded-md border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{dateLabel}</div>
      </div>
      <div className={cn(
        "mt-1 text-2xl font-bold tabular-nums",
        net >= 0 ? "text-success" : "text-destructive",
      )}>
        {loading ? <Skeleton className="h-8 w-40" /> : fmtMoney(net, symbol)}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded border p-2">
          <div className="text-muted-foreground">{tr("dashboard.assets")}</div>
          <div className={cn("mt-0.5 font-semibold tabular-nums", totalAssets < 0 ? "text-destructive" : "text-foreground")}>{fmtMoney(totalAssets, symbol)}</div>
        </div>
        <div className="rounded border p-2">
          <div className="text-muted-foreground">{tr("dashboard.liabilities")}</div>
          <div className={cn("mt-0.5 font-semibold tabular-nums", totalLiabilities < 0 ? "text-destructive" : "text-foreground")}>{fmtMoney(totalLiabilities, symbol)}</div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        {tr("dashboard.projected_caption", { date: dateLabel })}
      </div>
    </div>
  );
}

function AccountsCard({
  title, items, symbol, loading, emptyHint,
}: {
  title: string;
  tone?: "success" | "destructive";
  items: { id: string; name: string; balance: number; currency_symbol?: string }[];
  symbol: string;
  loading: boolean;
  emptyHint: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-16 w-full" /> : items.length === 0 ? (
          <div className="text-sm text-muted-foreground">{emptyHint}</div>
        ) : (
          <ul className="divide-y">
            {items.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <span className="truncate">{a.name}</span>
                <span className={cn("tabular-nums font-medium", Number(a.balance) < 0 ? "text-destructive" : "text-foreground")}>
                  {fmtMoney(Number(a.balance), a.currency_symbol ?? symbol)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type GroupedBlock = {
  key: string;
  name: string;
  kind: "income" | "expense" | "savings";
  rows: CategoryMonthRow[];
};

function groupRows(rows: CategoryMonthRow[]): GroupedBlock[] {
  const map = new Map<string, GroupedBlock>();
  for (const r of rows) {
    // Standalone savings envelopes (is_savings on a non-savings group, or no
    // group at all) are routed into a synthetic Savings bucket so they render
    // with the running-balance layout and stay out of the monthly expense
    // budget section.
    const isSavingsRow = r.is_savings || r.kind === "savings";
    const effectiveKind: "income" | "expense" | "savings" = isSavingsRow ? "savings" : r.kind;
    const useGroup = r.group_id && r.kind === effectiveKind;
    const key = useGroup ? r.group_id! : `__${effectiveKind}__ungrouped`;
    if (!map.has(key)) {
      map.set(key, {
        key,
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
}

function GroupBlock({
  group, symbol, savings, pendingMap, tr,
}: { group: GroupedBlock; symbol: string; savings: CategorySavingsBalance[]; pendingMap: Map<string, PendingCategorySigned>; tr: (k: string, v?: Record<string, string | number>) => string }) {
  const totalAlloc = group.rows.reduce((s, r) => s + Number(r.allocated), 0);
  const totalActual = group.rows.reduce((s, r) => s + Number(r.spent_or_received), 0);
  const totalPending = group.rows.reduce((s, r) => {
    const p = pendingMap.get(r.category_id);
    const d = pendingDeltaForRow(p, group.kind);
    return s + (group.kind === "income" ? d : Math.max(0, d));
  }, 0);
  const totalProjected = totalActual + totalPending;
  const remaining = totalAlloc - totalProjected;
  const overProjected = group.kind !== "savings" && group.kind !== "income" && totalAlloc > 0 && totalProjected > totalAlloc;
  const savingsMap = new Map(savings.map((s) => [s.category_id, s]));
  const groupKindLabel = group.kind === "income" ? tr("settings.kind_income")
    : group.kind === "savings" ? tr("settings.kind_savings")
    : tr("settings.kind_expense");

  return (
    <Card>
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {group.name}
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground">
              {groupKindLabel}
            </span>
          </CardTitle>
          <div className={cn("text-base font-semibold tabular-nums", overProjected && "text-destructive")}>
            {group.kind === "savings"
              ? fmtMoney(totalAlloc, symbol)
              : `${fmtMoney(totalActual, symbol)} / ${fmtMoney(totalAlloc, symbol)}`}
          </div>
        </div>
        {group.kind !== "savings" && (
          <>
            <div className="text-xs tabular-nums text-muted-foreground flex flex-wrap gap-x-3">
              {group.kind === "income" ? (
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
            {group.kind === "expense" && (
              <StackedBudgetBar allocated={totalAlloc} committed={totalActual} pending={totalPending} />
            )}
          </>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {group.rows.map((r) => {
          const pending = pendingMap.get(r.category_id);
          const pendingDelta = pendingDeltaForRow(pending, group.kind);
          if (group.kind === "savings") {
            const sav = savingsMap.get(r.category_id);
            const balance = Number(sav?.balance ?? 0);
            return (
              <div key={r.category_id} className="rounded-md border p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-medium">{r.name}</div>
                  <div className={cn("text-lg font-semibold tabular-nums", balance < 0 ? "text-destructive" : "text-foreground")}>
                    {fmtMoney(balance, symbol)}
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {tr("dashboard.this_month_savings", { a: fmtMoney(Number(r.allocated), symbol), b: fmtMoney(Number(r.spent_or_received), symbol) })}
                </div>
                {pending && (pending.income > 0 || pending.expense > 0) && (
                  <div className="mt-1 text-xs text-warning tabular-nums">
                    {tr("env.savings_pending", { a: fmtMoney(pending.income, symbol), b: fmtMoney(pending.expense, symbol) })}
                  </div>
                )}
              </div>
            );
          }
          if (group.kind === "income") {
            const allocated = Number(r.allocated);
            const received = Number(r.spent_or_received);
            const projected = received + pendingDelta;
            const variance = received - allocated;
            const tone = variance >= 0 ? "text-success" : "text-destructive";
            return (
              <div key={r.category_id} className="flex items-baseline justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
                <div className="font-medium">{r.name}</div>
                <div className="text-sm tabular-nums">
                  <span className={cn("font-semibold", tone)}>{fmtMoney(received, symbol)}</span>
                  <span className="text-muted-foreground"> / {fmtMoney(allocated, symbol)}</span>
                  <span className={cn("ml-2 text-xs", tone)}>({variance >= 0 ? "+" : ""}{fmtMoney(variance, symbol)})</span>
                  {pendingDelta > 0 && (
                    <span className="ml-2 text-xs text-warning">{tr("env.income_expected", { x: fmtMoney(pendingDelta, symbol) })} {tr("env.projected_suffix", { x: fmtMoney(projected, symbol) })}</span>
                  )}
                </div>
              </div>
            );
          }
          // expense
          const allocated = Number(r.allocated);
          const spent = Number(r.spent_or_received);
          const projected = spent + Math.max(0, pendingDelta);
          const pendingPos = Math.max(0, pendingDelta);
          const overProjected = allocated > 0 && projected > allocated;
          const remainingProjected = allocated - projected;
          return (
            <div key={r.category_id}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-medium">{r.name}</div>
                <div className="text-sm tabular-nums text-muted-foreground">
                  <span className={cn(overProjected && "text-destructive font-semibold")}>{fmtMoney(spent, symbol)}</span>
                  <span> / {fmtMoney(allocated, symbol)}</span>
                  {pendingPos > 0 && (
                    <span className="ml-2 text-xs text-warning">{tr("env.pending_suffix", { x: fmtMoney(pendingPos, symbol) })} {tr("env.projected_suffix", { x: fmtMoney(projected, symbol) })}</span>
                  )}
                </div>
              </div>
              <StackedBudgetBar className="mt-1.5" allocated={allocated} committed={spent} pending={pendingPos} />
              <div className={cn("mt-1 text-xs tabular-nums", overProjected ? "text-destructive" : "text-muted-foreground")}>
                {overProjected
                  ? (pendingPos > 0
                      ? tr("env.over_with_pending", { x: fmtMoney(-remainingProjected, symbol) })
                      : tr("dashboard.over_by", { x: fmtMoney(-remainingProjected, symbol) }))
                  : (pendingPos > 0
                      ? tr("env.remaining_with_pending", { x: fmtMoney(remainingProjected, symbol) })
                      : tr("dashboard.remaining", { x: fmtMoney(allocated - spent, symbol) }))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function NetWorthBlock({
  showConverted, hasForeign, loading,
  netWorthMain, netWorthConverted,
  totalAssetsMain, totalLiabMain,
  totalAssetsConverted, totalLiabConverted,
  assetsByCur, liabByCur,
  symbol, mainCode, symbolForCode,
  showOther, setShowOther, fxReady, tr,
}: {
  showConverted: boolean;
  hasForeign: boolean;
  loading: boolean;
  netWorthMain: number;
  netWorthConverted: number;
  totalAssetsMain: number;
  totalLiabMain: number;
  totalAssetsConverted: number;
  totalLiabConverted: number;
  assetsByCur: Map<string, number>;
  liabByCur: Map<string, number>;
  symbol: string;
  mainCode: string;
  symbolForCode: (code: string) => string;
  showOther: boolean;
  setShowOther: (b: boolean) => void;
  fxReady: boolean;
  tr: (k: string, v?: Record<string, string | number>) => string;
}) {
  // Effective values: when toggle on AND fx ready, show converted; else main-only
  const useConverted = showConverted && hasForeign && fxReady;
  const net = useConverted ? netWorthConverted : netWorthMain;
  const a = useConverted ? totalAssetsConverted : totalAssetsMain;
  const l = useConverted ? totalLiabConverted : totalLiabMain;

  // Foreign breakdown (excludes main currency)
  const otherAssets = Array.from(assetsByCur.entries()).filter(([code]) => code !== mainCode);
  const otherLiab = Array.from(liabByCur.entries()).filter(([code]) => code !== mainCode);
  const otherCount = new Set([...otherAssets.map(([c]) => c), ...otherLiab.map(([c]) => c)]).size;

  return (
    <>
      <div className={cn(
        "text-3xl font-bold tabular-nums",
        net >= 0 ? "text-success" : "text-destructive",
      )}>
        {loading ? <Skeleton className="h-9 w-48" /> : fmtMoney(net, symbol)}
      </div>
      {useConverted && (
        <div className="mt-1 text-xs text-muted-foreground">{tr("dashboard.networth_converted_hint")}</div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md border p-3">
          <div className="text-muted-foreground">{tr("dashboard.assets")}</div>
          <div className={cn("mt-1 font-semibold tabular-nums", a < 0 ? "text-destructive" : "text-foreground")}>{fmtMoney(a, symbol)}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-muted-foreground">{tr("dashboard.liabilities")}</div>
          <div className={cn("mt-1 font-semibold tabular-nums", l < 0 ? "text-destructive" : "text-foreground")}>{fmtMoney(l, symbol)}</div>
        </div>
      </div>

      {hasForeign && otherCount > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowOther(!showOther)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showOther ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {tr("dashboard.networth_other")} ({otherCount})
          </button>
          {showOther && (
            <div className="mt-2 space-y-2 rounded-md border p-3">
              {otherAssets.length > 0 && (
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{tr("dashboard.assets")}</span>
                  <span className="tabular-nums font-medium">
                    {otherAssets.map(([code, v]) => fmtMoney(v, symbolForCode(code))).join(" · ")}
                  </span>
                </div>
              )}
              {otherLiab.length > 0 && (
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{tr("dashboard.liabilities")}</span>
                  <span className="tabular-nums font-medium">
                    {otherLiab.map(([code, v]) => fmtMoney(v, symbolForCode(code))).join(" · ")}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
