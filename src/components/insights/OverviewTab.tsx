import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import {
  fetchTransactionsRange,
  fetchTransactionTags,
  fetchCategories,
  fmtMoney,
  type Transaction,
} from "@/lib/finance";
import { aggregateMonthly, normalizeMerchant } from "@/lib/insights";

export function OverviewTab({
  from,
  to,
  symbol,
}: {
  from: string;
  to: string;
  symbol: string;
}) {
  const { t } = useI18n();
  const txQ = useQuery({
    queryKey: ["insights", "tx_range", from, to],
    queryFn: () => fetchTransactionsRange(from, to),
  });
  const tagsQ = useQuery({ queryKey: ["transaction_tags"], queryFn: fetchTransactionTags });
  const catsQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });

  const tx = txQ.data ?? [];
  const tags = tagsQ.data ?? [];
  const cats = catsQ.data ?? [];

  const totals = React.useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const r of tx) {
      if (r.type === "income") income += Number(r.amount) || 0;
      else if (r.type === "expense") expense += Number(r.amount) || 0;
    }
    return {
      income,
      expense,
      net: income - expense,
      savingsRate: income > 0 ? Math.max(0, (income - expense) / income) : 0,
    };
  }, [tx]);

  // Compute "last 12 months" stacked bar — always shown regardless of period
  const monthly = React.useMemo(() => {
    const today = new Date();
    const fromMo = new Date(today.getFullYear() - 1, today.getMonth() + 1, 1)
      .toISOString()
      .slice(0, 10);
    const toMo = today.toISOString().slice(0, 10);
    return aggregateMonthly(tx, fromMo, toMo);
  }, [tx]);

  const topCats = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of tx) {
      if (r.type !== "expense" || !r.category_id) continue;
      m.set(r.category_id, (m.get(r.category_id) ?? 0) + (Number(r.amount) || 0));
    }
    const arr = Array.from(m.entries())
      .map(([id, v]) => ({
        id,
        label: cats.find((c) => c.id === id)?.name ?? "—",
        v,
      }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 5);
    return arr;
  }, [tx, cats]);

  const topTags = React.useMemo(() => {
    const m = new Map<string, number>();
    const txMap = new Map<string, Transaction>();
    for (const r of tx) txMap.set(r.id, r);
    for (const tag of tags) {
      const r = txMap.get(tag.transaction_id);
      if (!r || r.type !== "expense") continue;
      m.set(tag.tag, (m.get(tag.tag) ?? 0) + (Number(r.amount) || 0));
    }
    return Array.from(m.entries())
      .map(([k, v]) => ({ k, v }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 5);
  }, [tx, tags]);

  const topMerchants = React.useMemo(() => {
    const m = new Map<string, { label: string; v: number }>();
    for (const r of tx) {
      if (r.type !== "expense") continue;
      const norm = normalizeMerchant(r.description);
      if (!norm) continue;
      const cur = m.get(norm) ?? { label: r.description ?? norm, v: 0 };
      cur.v += Number(r.amount) || 0;
      m.set(norm, cur);
    }
    return Array.from(m.values())
      .sort((a, b) => b.v - a.v)
      .slice(0, 5);
  }, [tx]);

  if (txQ.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label={t("insights.kpi.income")} value={fmtMoney(totals.income, symbol)} tone="success" />
        <KpiCard label={t("insights.kpi.expense")} value={fmtMoney(totals.expense, symbol)} tone="destructive" />
        <KpiCard label={t("insights.kpi.net")} value={fmtMoney(totals.net, symbol)} tone={totals.net >= 0 ? "success" : "destructive"} />
        <KpiCard label={t("insights.kpi.savings_rate")} value={`${(totals.savingsRate * 100).toFixed(0)}%`} />
      </div>

      {/* 12mo stacked bar */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t("insights.overview.monthly_title")}</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            <ResponsiveContainer>
              <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" fontSize={11} tickLine={false} />
                <YAxis fontSize={11} tickLine={false} width={50} />
                <Tooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6 }}
                  formatter={(v: number) => fmtMoney(v, symbol)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="income" fill="var(--chart-2)" name={t("insights.kpi.income")} />
                <Bar dataKey="expense" fill="var(--chart-1)" name={t("insights.kpi.expense")} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <TopList title={t("insights.overview.top_categories")} items={topCats.map((c) => ({ label: c.label, v: c.v }))} symbol={symbol} />
        <TopList title={t("insights.overview.top_tags")} items={topTags.map((c) => ({ label: `#${c.k}`, v: c.v }))} symbol={symbol} />
        <TopList title={t("insights.overview.top_merchants")} items={topMerchants} symbol={symbol} />
      </div>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: "success" | "destructive" }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={
          "mt-1 text-lg font-semibold tabular-nums " +
          (tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-foreground")
        }>{value}</div>
      </CardContent>
    </Card>
  );
}

function TopList({ title, items, symbol }: { title: string; items: { label: string; v: number }[]; symbol: string }) {
  const max = items.reduce((a, b) => Math.max(a, b.v), 0);
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1.5">
        {items.length === 0 && <div className="text-xs text-muted-foreground">—</div>}
        {items.map((it, i) => (
          <div key={i} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="truncate pr-2">{it.label}</span>
              <span className="tabular-nums text-muted-foreground">{fmtMoney(it.v, symbol)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary" style={{ width: `${max > 0 ? (it.v / max) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}