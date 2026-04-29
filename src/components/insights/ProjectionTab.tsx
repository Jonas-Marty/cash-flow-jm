import * as React from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/i18n";
import {
  fetchAccountBalancesAsOf,
  fetchRecurringRules,
  fmtMoney,
  type AccountBalance,
} from "@/lib/finance";
import { buildProjection, type NetWorthPoint } from "@/lib/insights";

type Window = 6 | 12 | 24;
type AheadPreset = "3mo" | "6mo" | "12mo" | "24mo" | "eoy" | "eoy_next" | "10y";

function endOfMonthISO(year: number, month0: number): string {
  const d = new Date(year, month0 + 1, 0);
  return d.toISOString().slice(0, 10);
}

function netWorthOf(balances: AccountBalance[]): { net: number; assets: number; liabilities: number } {
  let assets = 0;
  let liabilities = 0;
  for (const a of balances) {
    if (a.archived) continue;
    const bal = Number(a.balance) || 0;
    if (a.type === "asset") assets += bal;
    else liabilities += bal;
  }
  // liabilities are stored as positive owed amounts; net = assets - liabilities
  return { net: assets - liabilities, assets, liabilities };
}

export function ProjectionTab({ symbol }: { symbol: string }) {
  const { t } = useI18n();
  const [windowMo, setWindowMo] = React.useState<Window>(12);
  const [aheadPreset, setAheadPreset] = React.useState<AheadPreset>("12mo");
  const [cutPct, setCutPct] = React.useState<number[]>([0]);

  const today = React.useMemo(() => new Date(), []);
  const currentYear = today.getFullYear();

  // Resolve preset → number of months ahead from this month.
  const ahead = React.useMemo(() => {
    const monthsTo = (year: number, month0: number) =>
      (year - currentYear) * 12 + (month0 - today.getMonth());
    switch (aheadPreset) {
      case "3mo": return 3;
      case "6mo": return 6;
      case "12mo": return 12;
      case "24mo": return 24;
      case "eoy": return Math.max(1, monthsTo(currentYear, 11));
      case "eoy_next": return monthsTo(currentYear + 1, 11);
      case "10y": return 120;
    }
  }, [aheadPreset, currentYear, today]);

  // Build the list of month-end dates we want snapshots for.
  const monthEnds = React.useMemo(() => {
    const out: string[] = [];
    const today = new Date();
    for (let i = windowMo; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      out.push(endOfMonthISO(d.getFullYear(), d.getMonth()));
    }
    return out;
  }, [windowMo]);

  // Fetch one snapshot per month-end. Each cached separately so adding/editing
  // a transaction (which calls qc.invalidateQueries()) busts them all.
  const snapshotQs = useQueries({
    queries: monthEnds.map((d) => ({
      queryKey: ["account_balances_as_of", d] as const,
      queryFn: () => fetchAccountBalancesAsOf(d),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const rulesQ = useQuery({ queryKey: ["recurring_rules"], queryFn: fetchRecurringRules });

  const loading = snapshotQs.some((q) => q.isLoading);

  const history = React.useMemo<NetWorthPoint[]>(() => {
    const out: NetWorthPoint[] = [];
    for (let i = 0; i < monthEnds.length; i++) {
      const data = snapshotQs[i].data;
      if (!data) continue;
      const { net, assets, liabilities } = netWorthOf(data);
      out.push({ date: monthEnds[i], netWorth: net, assets, liabilities });
    }
    return out;
  }, [monthEnds, snapshotQs]);

  // Recurring monthly net: sum income rules - sum expense rules (monthly equivalent)
  const recurringMonthlyNet = React.useMemo(() => {
    const rules = rulesQ.data ?? [];
    let net = 0;
    for (const r of rules) {
      if (r.archived) continue;
      if (r.type === "transfer") continue;
      const amt = Number(r.is_variable_amount ? r.estimated_amount : r.amount) || 0;
      const monthlyFactor = r.frequency === "monthly" ? 1 : r.frequency === "quarterly" ? 1 / 3 : 1 / 12;
      const monthly = amt * monthlyFactor;
      net += r.type === "income" ? monthly : -monthly;
    }
    return net;
  }, [rulesQ.data]);

  // Apply expense-cut adjustment to avg/recurring projections: cut expenses by X%
  // means the negative side becomes (1 - cut) of itself. Simplest approximation:
  // if avgMonthlyNet < 0 (net spender), the cut increases net.
  const cut = (cutPct[0] ?? 0) / 100;

  const projection = React.useMemo(() => {
    const baseRecurring = recurringMonthlyNet;
    const adjustedRecurring = baseRecurring < 0 ? baseRecurring * (1 - cut) : baseRecurring;
    return buildProjection(history, ahead, adjustedRecurring);
  }, [history, ahead, recurringMonthlyNet, cut]);

  // For "What if" we recompute the avg series ourselves (override the avg line)
  const adjustedPoints = React.useMemo(() => {
    if (cut === 0) return projection.points;
    const last = history[history.length - 1];
    if (!last) return projection.points;
    const avgAdjusted = projection.summary.avgMonthlyNet < 0
      ? projection.summary.avgMonthlyNet * (1 - cut)
      : projection.summary.avgMonthlyNet;
    return projection.points.map((p, i) => {
      if (p.actual !== undefined) return p;
      // i is overall index; offset = i - history.length + 1
      const offset = i - (history.length - 1);
      return { ...p, avg: last.netWorth + avgAdjusted * offset };
    });
  }, [projection, history, cut]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  const lastActual = history[history.length - 1];
  const lastDate = adjustedPoints[adjustedPoints.length - 1]?.date ?? "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ChipGroup
          label={t("insights.projection.baseline")}
          value={String(windowMo)}
          onChange={(v) => setWindowMo(Number(v) as Window)}
          options={[
            { v: "6", l: "6 mo" },
            { v: "12", l: "12 mo" },
            { v: "24", l: "24 mo" },
          ]}
        />
        <ChipGroup
          label={t("insights.projection.ahead")}
          value={aheadPreset}
          onChange={(v) => setAheadPreset(v as AheadPreset)}
          options={[
            { v: "3mo", l: "3 mo" },
            { v: "6mo", l: "6 mo" },
            { v: "12mo", l: "12 mo" },
            { v: "24mo", l: "24 mo" },
            { v: "eoy", l: t("insights.projection.preset.eoy", { year: String(currentYear) }) },
            { v: "eoy_next", l: t("insights.projection.preset.eoy", { year: String(currentYear + 1) }) },
            { v: "10y", l: t("insights.projection.preset.ten_years") },
          ]}
        />
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="h-80 w-full">
            <ResponsiveContainer>
              <ComposedChart data={adjustedPoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" fontSize={11} tickLine={false} tickFormatter={(s) => s.slice(0, 7)} />
                <YAxis fontSize={11} tickLine={false} width={60} />
                <Tooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6 }}
                  formatter={(v: number) => fmtMoney(v, symbol)}
                  labelFormatter={(l) => String(l).slice(0, 7)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="bandHigh" stroke="none" fill="var(--chart-3)" fillOpacity={0.08} name={t("insights.projection.band")} />
                <Area type="monotone" dataKey="bandLow" stroke="none" fill="var(--background)" fillOpacity={1} legendType="none" />
                <Line type="monotone" dataKey="actual" stroke="var(--chart-3)" strokeWidth={2.5} dot={false} name={t("insights.projection.actual")} />
                <Line type="monotone" dataKey="trend" stroke="var(--chart-3)" strokeWidth={2} strokeDasharray="6 4" dot={false} name={t("insights.projection.trend")} />
                <Line type="monotone" dataKey="avg" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="3 3" dot={false} name={t("insights.projection.avg")} />
                <Line type="monotone" dataKey="recurring" stroke="var(--chart-1)" strokeWidth={2} strokeDasharray="2 2" dot={false} name={t("insights.projection.recurring")} />
                {lastActual && (
                  <ReferenceLine x={lastActual.date} stroke="var(--muted-foreground)" strokeDasharray="2 2" />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {lastActual && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("insights.projection.summary", {
                trend: fmtMoney(projection.summary.trendEnd, symbol),
                date: lastDate.slice(0, 7),
                band: fmtMoney(projection.summary.band, symbol),
              })}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("insights.projection.whatif.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground whitespace-nowrap">{t("insights.projection.whatif.label")}</span>
            <Slider value={cutPct} onValueChange={setCutPct} min={0} max={50} step={1} className="flex-1" />
            <span className="w-12 text-right text-sm font-medium tabular-nums">{cutPct[0]}%</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("insights.projection.whatif.hint")}
          </p>
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