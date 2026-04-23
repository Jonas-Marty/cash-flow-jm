import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowLeftRight, Plus } from "lucide-react";
import { format } from "date-fns";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  fetchAccountBalances,
  fetchCategoryMonthRows,
  fetchSavingsBalances,
  fetchSettings,
  fetchTransactions,
  fmtMoney,
  monthKey,
  type CategoryMonthRow,
  type CategorySavingsBalance,
} from "@/lib/finance";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const m = monthKey(monthStart);
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const balancesQ = useQuery({ queryKey: ["account_balances"], queryFn: fetchAccountBalances });
  const envelopesQ = useQuery({ queryKey: ["category_month_rows", m], queryFn: () => fetchCategoryMonthRows(m) });
  const savingsQ = useQuery({ queryKey: ["savings_balance"], queryFn: fetchSavingsBalances });
  const recentQ = useQuery({ queryKey: ["transactions", "recent"], queryFn: () => fetchTransactions(8) });

  const symbol = settingsQ.data?.currency_symbol ?? "CHF";
  const accounts = balancesQ.data ?? [];
  const assets = accounts.filter((a) => a.type === "asset" && !a.archived);
  const liabilities = accounts.filter((a) => a.type === "liability" && !a.archived);

  const totalAssets = assets.reduce((s, a) => s + Number(a.balance), 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + Number(a.balance), 0);
  const netWorth = totalAssets + totalLiabilities; // liabilities are stored as negatives via transfers

  const envelopes = envelopesQ.data ?? [];
  const savings = savingsQ.data ?? [];

  // Group envelopes by group_id, preserving sort order
  const grouped = React.useMemo(() => groupRows(envelopes), [envelopes]);

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground">{format(new Date(), "MMMM yyyy")}</p>
          </div>
          <Button asChild size="sm" className="hidden md:inline-flex">
            <Link to="/add"><Plus className="h-4 w-4" /> Add transaction</Link>
          </Button>
        </header>

        {/* Net worth */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net worth</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn(
              "text-3xl font-bold tabular-nums",
              netWorth >= 0 ? "text-success" : "text-destructive",
            )}>
              {balancesQ.isLoading ? <Skeleton className="h-9 w-48" /> : fmtMoney(netWorth, symbol)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground">Assets</div>
                <div className="mt-1 font-semibold text-success tabular-nums">{fmtMoney(totalAssets, symbol)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground">Liabilities</div>
                <div className="mt-1 font-semibold text-destructive tabular-nums">{fmtMoney(totalLiabilities, symbol)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Accounts */}
        <div className="grid gap-4 md:grid-cols-2">
          <AccountsCard title="Assets" tone="success" items={assets} symbol={symbol} loading={balancesQ.isLoading} emptyHint="Create your first asset account in Settings." />
          <AccountsCard title="Liabilities" tone="destructive" items={liabilities} symbol={symbol} loading={balancesQ.isLoading} emptyHint="Add credit cards in Settings." />
        </div>

        {/* Envelopes */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Envelopes — this month</h2>
            <Link to="/envelopes" className="text-sm text-muted-foreground hover:text-foreground">View all</Link>
          </div>
          {envelopesQ.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
          ) : envelopes.length === 0 ? (
            <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
              No envelopes yet. <Link to="/settings" className="font-medium text-primary underline-offset-2 hover:underline">Create one in Settings</Link>.
            </CardContent></Card>
          ) : (
            <div className="space-y-4">
              {grouped.map((g) => (
                <GroupBlock key={g.key} group={g} symbol={symbol} savings={savings} />
              ))}
            </div>
          )}
        </section>

        {/* Recent transactions */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent transactions</h2>
            <Link to="/transactions" className="text-sm text-muted-foreground hover:text-foreground">View all</Link>
          </div>
          {recentQ.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (recentQ.data ?? []).length === 0 ? (
            <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">No transactions yet.</CardContent></Card>
          ) : (
            <Card><CardContent className="divide-y p-0">
              {(recentQ.data ?? []).map((t) => {
                const Icon = t.type === "expense" ? ArrowDown : t.type === "income" ? ArrowUp : ArrowLeftRight;
                const tone = t.type === "expense" ? "text-destructive" : t.type === "income" ? "text-success" : "text-muted-foreground";
                const sign = t.type === "expense" ? "-" : t.type === "income" ? "+" : "";
                return (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-full bg-muted", tone)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.payee || (t.type === "transfer" ? "Transfer" : t.type)}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(t.occurred_on), "MMM d")}</div>
                    </div>
                    <div className={cn("text-sm font-semibold tabular-nums", tone)}>
                      {sign}{fmtMoney(Number(t.amount), symbol).replace("-", "")}
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

function AccountsCard({
  title, tone, items, symbol, loading, emptyHint,
}: {
  title: string;
  tone: "success" | "destructive";
  items: { id: string; name: string; balance: number }[];
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
                <span className={cn("tabular-nums font-medium", tone === "success" ? "text-success" : "text-destructive")}>
                  {fmtMoney(Number(a.balance), symbol)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
