import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import {
  fetchTransactionsRange,
  fmtMoney,
} from "@/lib/finance";
import { aggregateMonthly } from "@/lib/insights";

type SeriesKind = "income_expense" | "net" | "cumulative_net";
type ChartShape = "line" | "area";

export function TrendsTab({
  from,
  to,
  symbol,
}: {
  from: string;
  to: string;
  symbol: string;
}) {
  const { t } = useI18n();
  const [series, setSeries] = React.useState<SeriesKind>("income_expense");
  const [shape, setShape] = React.useState<ChartShape>("line");

  const txQ = useQuery({
    queryKey: ["insights", "tx_range", from, to],
    queryFn: () => fetchTransactionsRange(from, to),
  });
  const tx = txQ.data ?? [];

  const monthly = React.useMemo(
    () => aggregateMonthly(tx, from, to),
    [tx, from, to],
  );

  const data = React.useMemo(() => {
    if (series === "cumulative_net") {
      let acc = 0;
      return monthly.map((p) => {
        acc += p.net;
        return { month: p.month, cumulative: acc };
      });
    }
    return monthly;
  }, [monthly, series]);

  // Day-of-week heatmap data
  const dow = React.useMemo(() => {
    const buckets = [0, 0, 0, 0, 0, 0, 0];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const r of tx) {
      if (r.type !== "expense") continue;
      const d = new Date(r.occurred_on).getDay(); // 0=Sun
      buckets[d] += Number(r.amount) || 0;
      counts[d] += 1;
    }
    return buckets.map((v, i) => ({ day: i, value: v, count: counts[i] }));
  }, [tx]);
  const maxDow = dow.reduce((a, b) => Math.max(a, b.value), 0);

  if (txQ.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ChipGroup
          label={t("insights.series")}
          value={series}
          onChange={(v) => setSeries(v as SeriesKind)}
          options={[
            { v: "income_expense", l: t("insights.series.income_expense") },
            { v: "net", l: t("insights.series.net") },
            { v: "cumulative_net", l: t("insights.series.cumulative_net") },
          ]}
        />
        <ChipGroup
          label={t("insights.chart_type")}
          value={shape}
          onChange={(v) => setShape(v as ChartShape)}
          options={[
            { v: "line", l: t("insights.chart.line") },
            { v: "area", l: t("insights.chart.area") },
          ]}
        />
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="h-72 w-full">
            <ResponsiveContainer>
              {shape === "line" ? (
                <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" fontSize={11} tickLine={false} />
                  <YAxis fontSize={11} tickLine={false} width={50} />
                  <Tooltip
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6 }}
                    formatter={(v: number) => fmtMoney(v, symbol)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {series === "income_expense" && (
                    <>
                      <Line type="monotone" dataKey="income" stroke="var(--chart-2)" strokeWidth={2} dot={false} name={t("insights.kpi.income")} />
                      <Line type="monotone" dataKey="expense" stroke="var(--chart-1)" strokeWidth={2} dot={false} name={t("insights.kpi.expense")} />
                    </>
                  )}
                  {series === "net" && (
                    <Line type="monotone" dataKey="net" stroke="var(--chart-3)" strokeWidth={2} dot={false} name={t("insights.kpi.net")} />
                  )}
                  {series === "cumulative_net" && (
                    <Line type="monotone" dataKey="cumulative" stroke="var(--chart-4)" strokeWidth={2} dot={false} name={t("insights.series.cumulative_net")} />
                  )}
                </LineChart>
              ) : (
                <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" fontSize={11} tickLine={false} />
                  <YAxis fontSize={11} tickLine={false} width={50} />
                  <Tooltip
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6 }}
                    formatter={(v: number) => fmtMoney(v, symbol)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {series === "income_expense" && (
                    <>
                      <Area type="monotone" dataKey="income" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.3} name={t("insights.kpi.income")} />
                      <Area type="monotone" dataKey="expense" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.3} name={t("insights.kpi.expense")} />
                    </>
                  )}
                  {series === "net" && (
                    <Area type="monotone" dataKey="net" stroke="var(--chart-3)" fill="var(--chart-3)" fillOpacity={0.3} name={t("insights.kpi.net")} />
                  )}
                  {series === "cumulative_net" && (
                    <Area type="monotone" dataKey="cumulative" stroke="var(--chart-4)" fill="var(--chart-4)" fillOpacity={0.3} name={t("insights.series.cumulative_net")} />
                  )}
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t("insights.dow.title")}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {dow.map((d) => {
              const intensity = maxDow > 0 ? d.value / maxDow : 0;
              const dayLabels = [t("dow.sun"), t("dow.mon"), t("dow.tue"), t("dow.wed"), t("dow.thu"), t("dow.fri"), t("dow.sat")];
              return (
                <div key={d.day} className="space-y-1 text-center">
                  <div className="text-[10px] text-muted-foreground">{dayLabels[d.day]}</div>
                  <div
                    className="rounded-md p-2 text-xs"
                    style={{ background: `color-mix(in oklab, var(--chart-1) ${intensity * 80 + 5}%, transparent)` }}
                    title={`${d.count} tx`}
                  >
                    <div className="font-medium tabular-nums">{fmtMoney(d.value, symbol)}</div>
                    <div className="text-[10px] text-muted-foreground">{d.count}</div>
                  </div>
                </div>
              );
            })}
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