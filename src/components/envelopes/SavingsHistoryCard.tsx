import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, subMonths } from "date-fns";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { fetchSavingsBalanceSeries, fmtMoney, todayISO } from "@/lib/finance";

const COLORS = [
  "var(--chart-1, #6366f1)",
  "var(--chart-2, #10b981)",
  "var(--chart-3, #f59e0b)",
  "var(--chart-4, #ef4444)",
  "var(--chart-5, #0ea5e9)",
  "#a855f7",
];

type Shape = "stacked" | "total";

/** Month-by-month total of all savings envelopes, stacked per envelope. */
export function SavingsHistoryCard({ symbol }: { symbol: string }) {
  const { t, locale } = useI18n();
  const [months, setMonths] = React.useState(12);
  const [shape, setShape] = React.useState<Shape>("stacked");

  const from = format(startOfMonth(subMonths(new Date(), months - 1)), "yyyy-MM-dd");
  const to = todayISO();

  const q = useQuery({
    queryKey: ["savings_balance_series", from, to],
    queryFn: () => fetchSavingsBalanceSeries(from, to),
  });

  const { data, keys, nameById } = React.useMemo(() => {
    const points = q.data ?? [];
    const nameById = new Map<string, string>();
    const totalsById = new Map<string, number>();
    const byDate = new Map<string, Record<string, number | string>>();
    for (const p of points) {
      nameById.set(p.category_id, p.name);
      const bal = Number(p.cumulative_balance);
      totalsById.set(p.category_id, Math.max(totalsById.get(p.category_id) ?? 0, Math.abs(bal)));
      const row = byDate.get(p.as_of) ?? { as_of: p.as_of };
      row[p.category_id] = bal;
      byDate.set(p.as_of, row);
    }
    // Keep the 5 largest envelopes named, fold the rest into "Other".
    const ranked = Array.from(totalsById.entries()).sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, 5).map(([id]) => id);
    const rest = ranked.slice(5).map(([id]) => id);
    const rows = Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([, row]) => {
        const out: Record<string, number | string> = { as_of: row.as_of };
        let total = 0;
        for (const id of top) {
          const v = Number(row[id] ?? 0);
          out[id] = v;
          total += v;
        }
        if (rest.length) {
          let other = 0;
          for (const id of rest) other += Number(row[id] ?? 0);
          out.__other = other;
          total += other;
        }
        out.__total = total;
        return out;
      });
    const keys = rest.length ? [...top, "__other"] : top;
    return { data: rows, keys, nameById };
  }, [q.data]);

  const labelFor = (key: string) =>
    key === "__other" ? t("env.history.other") : (nameById.get(key) ?? key);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("env.history.title")}</CardTitle>
          <div className="flex flex-wrap gap-1">
            {[12, 24, 60].map((m) => (
              <Button
                key={m}
                size="sm"
                variant={months === m ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setMonths(m)}
              >
                {t("env.history.months", { n: String(m) })}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => setShape((s) => (s === "stacked" ? "total" : "stacked"))}
            >
              {shape === "stacked" ? t("env.history.show_total") : t("env.history.show_stacked")}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : data.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{t("env.history.empty")}</div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {shape === "stacked" ? (
                <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="as_of"
                    tickFormatter={(v: string) => format(new Date(v), "MMM yy", { locale })}
                    fontSize={11}
                  />
                  <YAxis fontSize={11} width={64} tickFormatter={(v: number) => fmtMoney(v, symbol)} />
                  <Tooltip
                    formatter={(v: number, name: string) => [fmtMoney(Number(v), symbol), labelFor(name)]}
                    labelFormatter={(v: string) => format(new Date(v), "d MMM yyyy", { locale })}
                  />
                  {keys.map((k, i) => (
                    <Area
                      key={k}
                      type="monotone"
                      dataKey={k}
                      stackId="1"
                      stroke={COLORS[i % COLORS.length]}
                      fill={COLORS[i % COLORS.length]}
                      fillOpacity={0.35}
                      name={labelFor(k)}
                    />
                  ))}
                </AreaChart>
              ) : (
                <LineChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="as_of"
                    tickFormatter={(v: string) => format(new Date(v), "MMM yy", { locale })}
                    fontSize={11}
                  />
                  <YAxis fontSize={11} width={64} tickFormatter={(v: number) => fmtMoney(v, symbol)} />
                  <Tooltip
                    formatter={(v: number) => [fmtMoney(Number(v), symbol), t("env.history.total")]}
                    labelFormatter={(v: string) => format(new Date(v), "d MMM yyyy", { locale })}
                  />
                  <Line type="monotone" dataKey="__total" stroke={COLORS[0]} strokeWidth={2} dot={false} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}