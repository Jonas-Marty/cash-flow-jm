import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Treemap,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import {
  fetchTransactionsRange,
  fetchTransactionTags,
  fetchCategories,
  fetchCategoryGroups,
  fetchAccounts,
  fmtMoney,
  type Transaction,
} from "@/lib/finance";
import {
  topNWithOther,
  colorForIndex,
  type BreakdownSlice,
  type GroupKey,
  type TxFilter,
} from "@/lib/insights";

export type ChartKind = "pie" | "bar" | "treemap";

export function BreakdownTab({
  from,
  to,
  symbol,
  group,
  onGroupChange,
  txFilter,
  onTxFilterChange,
  chart,
  onChartChange,
}: {
  from: string;
  to: string;
  symbol: string;
  group: GroupKey;
  onGroupChange: (g: GroupKey) => void;
  txFilter: TxFilter;
  onTxFilterChange: (f: TxFilter) => void;
  chart: ChartKind;
  onChartChange: (c: ChartKind) => void;
}) {
  const { t } = useI18n();
  const txQ = useQuery({ queryKey: ["insights", "tx_range", from, to], queryFn: () => fetchTransactionsRange(from, to) });
  const tagsQ = useQuery({ queryKey: ["transaction_tags"], queryFn: fetchTransactionTags });
  const catsQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const grpsQ = useQuery({ queryKey: ["category_groups"], queryFn: fetchCategoryGroups });
  const accQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

  const tx = txQ.data ?? [];
  const tags = tagsQ.data ?? [];
  const cats = catsQ.data ?? [];
  const grps = grpsQ.data ?? [];
  const accs = accQ.data ?? [];

  const filtered = React.useMemo(() => {
    return tx.filter((r) => {
      if (txFilter === "expense") return r.type === "expense";
      if (txFilter === "income") return r.type === "income";
      return r.type !== "transfer";
    });
  }, [tx, txFilter]);

  const slices = React.useMemo<BreakdownSlice[]>(() => {
    const m = new Map<string, BreakdownSlice>();
    const add = (key: string, label: string, amount: number) => {
      const cur = m.get(key) ?? { key, label, value: 0, count: 0 };
      cur.value += amount;
      cur.count += 1;
      m.set(key, cur);
    };

    if (group === "tag") {
      const txMap = new Map<string, Transaction>();
      for (const r of filtered) txMap.set(r.id, r);
      const seen = new Set<string>(); // tx that had at least one tag
      for (const tg of tags) {
        const r = txMap.get(tg.transaction_id);
        if (!r) continue;
        seen.add(r.id);
        add(tg.tag, `#${tg.tag}`, Number(r.amount) || 0);
      }
      const untagged = filtered.filter((r) => !seen.has(r.id));
      const sumU = untagged.reduce((a, r) => a + (Number(r.amount) || 0), 0);
      if (sumU > 0) m.set("__none__", { key: "__none__", label: t("insights.untagged"), value: sumU, count: untagged.length });
    } else {
      for (const r of filtered) {
        const amt = Number(r.amount) || 0;
        if (group === "category") {
          const c = r.category_id ? cats.find((x) => x.id === r.category_id) : undefined;
          add(c?.id ?? "__none__", c?.name ?? t("insights.uncategorized"), amt);
        } else if (group === "group") {
          const c = r.category_id ? cats.find((x) => x.id === r.category_id) : undefined;
          const g = c?.group_id ? grps.find((x) => x.id === c.group_id) : undefined;
          add(g?.id ?? "__none__", g?.name ?? t("insights.uncategorized"), amt);
        } else if (group === "account") {
          const a = accs.find((x) => x.id === r.source_account_id);
          add(a?.id ?? "__none__", a?.name ?? "—", amt);
        } else {
          // type
          add(r.type, t(`insights.type.${r.type}`), amt);
        }
      }
    }

    const arr = Array.from(m.values());
    return topNWithOther(arr, 8, t("insights.other")).map((s, i) => ({
      ...s,
      color: s.color ?? colorForIndex(i),
    }));
  }, [filtered, group, tags, cats, grps, accs, t]);

  const total = slices.reduce((a, s) => a + s.value, 0);

  if (txQ.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ChipGroup
          label={t("insights.group_by")}
          value={group}
          onChange={(v) => onGroupChange(v as GroupKey)}
          options={[
            { v: "category", l: t("insights.group.category") },
            { v: "group", l: t("insights.group.group") },
            { v: "tag", l: t("insights.group.tag") },
            { v: "account", l: t("insights.group.account") },
            { v: "type", l: t("insights.group.type") },
          ]}
        />
        <ChipGroup
          label={t("insights.filter")}
          value={txFilter}
          onChange={(v) => onTxFilterChange(v as TxFilter)}
          options={[
            { v: "expense", l: t("insights.kpi.expense") },
            { v: "income", l: t("insights.kpi.income") },
            { v: "both", l: t("insights.both") },
          ]}
        />
        <ChipGroup
          label={t("insights.chart_type")}
          value={chart}
          onChange={(v) => onChartChange(v as ChartKind)}
          options={[
            { v: "pie", l: t("insights.chart.pie") },
            { v: "bar", l: t("insights.chart.bar") },
            { v: "treemap", l: t("insights.chart.treemap") },
          ]}
        />
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="h-72 w-full">
            {slices.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("common.no_data")}
              </div>
            ) : chart === "pie" ? (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={slices} dataKey="value" nameKey="label" innerRadius={50} outerRadius={100} paddingAngle={1}>
                    {slices.map((s, i) => (
                      <Cell key={s.key} fill={s.color ?? colorForIndex(i)} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6 }}
                    formatter={(v: number, _n, p) => [`${fmtMoney(v, symbol)} (${total > 0 ? ((v / total) * 100).toFixed(0) : 0}%)`, p?.payload?.label]}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : chart === "bar" ? (
              <ResponsiveContainer>
                <BarChart data={slices} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" fontSize={11} tickLine={false} />
                  <YAxis type="category" dataKey="label" fontSize={11} tickLine={false} width={120} />
                  <Tooltip
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6 }}
                    formatter={(v: number) => fmtMoney(v, symbol)}
                  />
                  <Bar dataKey="value">
                    {slices.map((s, i) => (
                      <Cell key={s.key} fill={s.color ?? colorForIndex(i)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer>
                <Treemap data={slices.map((s, i) => ({ name: s.label, size: s.value, fill: s.color ?? colorForIndex(i) }))} dataKey="size" stroke="var(--background)">
                  <Tooltip
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6 }}
                    formatter={(v: number) => fmtMoney(v, symbol)}
                  />
                </Treemap>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          <div className="space-y-1.5">
            {slices.map((s, i) => (
              <div key={s.key} className="flex items-center gap-2 text-sm">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color ?? colorForIndex(i) }} />
                <span className="flex-1 truncate">{s.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {fmtMoney(s.value, symbol)} · {total > 0 ? ((s.value / total) * 100).toFixed(0) : 0}%
                </span>
              </div>
            ))}
            {slices.length > 0 && (
              <div className="flex items-center justify-between border-t pt-2 text-sm font-medium">
                <span>{t("insights.total")}</span>
                <span className="tabular-nums">{fmtMoney(total, symbol)}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChipGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground mr-1">{label}:</span>
      {options.map((o) => (
        <Button
          key={o.v}
          size="sm"
          variant={value === o.v ? "default" : "outline"}
          className="h-7 px-2 text-xs"
          onClick={() => onChange(o.v)}
        >
          {o.l}
        </Button>
      ))}
    </div>
  );
}