import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, subMonths } from "date-fns";
import { ArrowLeftRight } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchSavingsBalanceSeries,
  fetchSavingsBalancesV2,
  fetchReallocations,
  fetchCategories,
  fmtMoney,
  type Transaction,
} from "@/lib/finance";

type LedgerEntry = {
  id: string;
  occurred_on: string;
  label: string;
  sub: string | null;
  delta: number;
  kind: "tx" | "realloc";
};

async function fetchCategoryTx(categoryId: string, from: string, to: string): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("category_id", categoryId)
    .gte("occurred_on", from)
    .lte("occurred_on", to)
    .order("occurred_on", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return (data || []) as Transaction[];
}

/** Balance history + running ledger for one savings envelope. */
export function EnvelopeDetailSheet({
  categoryId,
  categoryName,
  asOf,
  symbol,
  open,
  onOpenChange,
}: {
  categoryId: string | null;
  categoryName: string;
  asOf: string;
  symbol: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const [months, setMonths] = React.useState(12);
  const from = format(startOfMonth(subMonths(new Date(asOf), months - 1)), "yyyy-MM-dd");

  const enabled = open && !!categoryId;
  const seriesQ = useQuery({
    queryKey: ["savings_balance_series", from, asOf],
    queryFn: () => fetchSavingsBalanceSeries(from, asOf),
    enabled,
  });
  const balQ = useQuery({
    queryKey: ["savings-balances-v2", asOf],
    queryFn: () => fetchSavingsBalancesV2(asOf),
    enabled,
  });
  const txQ = useQuery({
    queryKey: ["envelope_detail_tx", categoryId, from, asOf],
    queryFn: () => fetchCategoryTx(categoryId!, from, asOf),
    enabled,
  });
  const reallocQ = useQuery({ queryKey: ["reallocations"], queryFn: fetchReallocations, enabled });
  const catsQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, enabled });

  const catNames = React.useMemo(
    () => new Map((catsQ.data ?? []).map((c) => [c.id, c.name])),
    [catsQ.data],
  );

  const balance = React.useMemo(() => {
    const row = (balQ.data ?? []).find((b) => b.category_id === categoryId);
    return row ?? null;
  }, [balQ.data, categoryId]);

  const chartData = React.useMemo(
    () =>
      (seriesQ.data ?? [])
        .filter((p) => p.category_id === categoryId)
        .map((p) => ({ as_of: p.as_of, balance: Number(p.cumulative_balance) })),
    [seriesQ.data, categoryId],
  );

  // Ledger, newest first, with the running balance after each entry.
  const ledger = React.useMemo(() => {
    if (!categoryId) return [] as (LedgerEntry & { running: number })[];
    const entries: LedgerEntry[] = [];
    for (const tx of txQ.data ?? []) {
      const amt = Number(tx.amount);
      const delta = tx.type === "income" ? amt : tx.type === "expense" ? -amt : 0;
      if (delta === 0) continue;
      entries.push({
        id: tx.id,
        occurred_on: tx.occurred_on,
        label: tx.description || (delta > 0 ? t("env.savings_refund") : t("env.savings_booking")),
        sub: null,
        delta,
        kind: "tx",
      });
    }
    for (const r of reallocQ.data ?? []) {
      if (r.occurred_on < from || r.occurred_on > asOf) continue;
      const amount = Number(r.amount);
      if (r.to_category_id === categoryId) {
        entries.push({
          id: `${r.id}-in`,
          occurred_on: r.occurred_on,
          label: r.note || t("env.realloc_in"),
          sub: catNames.get(r.from_category_id) ?? null,
          delta: amount,
          kind: "realloc",
        });
      }
      if (r.from_category_id === categoryId) {
        entries.push({
          id: `${r.id}-out`,
          occurred_on: r.occurred_on,
          label: r.note || t("env.realloc_out"),
          sub: catNames.get(r.to_category_id) ?? null,
          delta: -amount,
          kind: "realloc",
        });
      }
    }
    entries.sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : 0));
    let running = balance ? Number(balance.cumulative_balance) : 0;
    return entries.map((e) => {
      const withRunning = { ...e, running };
      running -= e.delta;
      return withRunning;
    });
  }, [txQ.data, reallocQ.data, categoryId, from, asOf, balance, catNames, t]);

  const loading = seriesQ.isLoading || balQ.isLoading || txQ.isLoading;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{categoryName}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("env.asof.balance")} · {format(new Date(asOf), "d MMM yyyy", { locale })}
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {fmtMoney(balance ? Number(balance.cumulative_balance) : 0, symbol)}
            </div>
            {balance && (
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs tabular-nums text-muted-foreground">
                <span>{t("env.detail.from_tx")}: {fmtMoney(Number(balance.from_transactions), symbol)}</span>
                <span>{t("envelopes.savings.from_reallocations")}: {fmtMoney(Number(balance.from_reallocations), symbol)}</span>
                <span>{t("envelopes.savings.from_sweeps")}: {fmtMoney(Number(balance.from_sweeps), symbol)}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            {[12, 24, 120].map((m) => (
              <Button
                key={m}
                size="sm"
                variant={months === m ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setMonths(m)}
              >
                {m === 120 ? t("env.history.all") : t("env.history.months", { n: String(m) })}
              </Button>
            ))}
          </div>

          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="as_of"
                    tickFormatter={(v: string) => format(new Date(v), "MMM yy", { locale })}
                    fontSize={11}
                  />
                  <YAxis fontSize={11} width={64} tickFormatter={(v: number) => fmtMoney(v, symbol)} />
                  <Tooltip
                    formatter={(v: number) => [fmtMoney(Number(v), symbol), t("env.asof.balance")]}
                    labelFormatter={(v: string) => format(new Date(v), "d MMM yyyy", { locale })}
                  />
                  <ReferenceLine y={0} className="stroke-muted-foreground" />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    stroke="var(--chart-1, #6366f1)"
                    fill="var(--chart-1, #6366f1)"
                    fillOpacity={0.25}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              {t("env.detail.ledger")}
            </div>
            {ledger.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{t("env.history.empty")}</div>
            ) : (
              <ul className="divide-y border-t">
                {ledger.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {e.kind === "realloc" && (
                          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{e.label}</span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {format(new Date(e.occurred_on), "d MMM yyyy", { locale })}
                        {e.sub ? ` · ${e.delta > 0 ? "←" : "→"} ${e.sub}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={cn("tabular-nums font-medium", e.delta > 0 ? "text-success" : "text-destructive")}>
                        {e.delta > 0 ? "+" : "−"}{fmtMoney(Math.abs(e.delta), symbol).replace("-", "")}
                      </div>
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {fmtMoney(e.running, symbol)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}