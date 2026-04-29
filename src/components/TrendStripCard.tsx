import * as React from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/finance";
import { useI18n } from "@/i18n";

/**
 * Compact trend card. Shows the user's cash net (income − expenses, transfers
 * excluded) for two windows and their delta vs. the equivalent prior window:
 *  - This month so far (1st → today) vs. previous month same window
 *  - YTD (Jan 1 → today) vs. last year same window
 */
export function TrendStripCard({ symbol }: { symbol: string }) {
  const { t } = useI18n();
  const today = React.useMemo(() => new Date(), []);
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Windows
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMonthEnd = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const lastYearStart = new Date(today.getFullYear() - 1, 0, 1);
  const lastYearEnd = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());

  const earliest = ymd(lastYearStart);
  const latest = ymd(today);

  const txQ = useQuery({
    queryKey: ["trend_transactions", earliest, latest],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("occurred_on, amount, type")
        .gte("occurred_on", earliest)
        .lte("occurred_on", latest);
      if (error) throw error;
      return (data || []) as Array<{ occurred_on: string; amount: number; type: "expense" | "income" | "transfer" }>;
    },
  });

  const sumIn = (start: Date, end: Date) => {
    const s = ymd(start), e = ymd(end);
    let net = 0;
    for (const r of txQ.data ?? []) {
      if (r.type === "transfer") continue;
      if (r.occurred_on < s || r.occurred_on > e) continue;
      const v = Number(r.amount);
      net += r.type === "income" ? v : -v;
    }
    return net;
  };

  const monthNet = sumIn(monthStart, today);
  const monthBaseline = sumIn(prevMonthStart, prevMonthEnd);
  const ytdNet = sumIn(yearStart, today);
  const ytdBaseline = sumIn(lastYearStart, lastYearEnd);

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{t("dashboard.trend.title")}</CardTitle></CardHeader>
      <CardContent className="divide-y p-0">
        {txQ.isLoading ? (
          <div className="p-4"><Skeleton className="h-12 w-full" /></div>
        ) : (
          <>
            <Row label={t("dashboard.trend.this_month")} value={monthNet} baseline={monthBaseline} symbol={symbol} compareLabel={t("dashboard.trend.vs_last_month")} noBaseline={t("dashboard.trend.no_baseline")} />
            <Row label={t("dashboard.trend.ytd")} value={ytdNet} baseline={ytdBaseline} symbol={symbol} compareLabel={t("dashboard.trend.vs_last_year")} noBaseline={t("dashboard.trend.no_baseline")} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, baseline, symbol, compareLabel, noBaseline }: {
  label: string; value: number; baseline: number; symbol: string; compareLabel: string; noBaseline: string;
}) {
  const diff = value - baseline;
  const hasBaseline = Math.abs(baseline) > 0.005;
  const pct = hasBaseline ? (diff / Math.abs(baseline)) * 100 : null;
  // Better = higher net (more income or smaller loss)
  const better = diff > 0.005;
  const worse = diff < -0.005;
  const tone = better ? "text-success" : worse ? "text-destructive" : "text-muted-foreground";
  const Icon = better ? ArrowUp : worse ? ArrowDown : Minus;
  const sign = value >= 0 ? "+" : "−";
  const valueStr = `${sign}${fmtMoney(Math.abs(value), symbol).replace("-", "")}`;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{compareLabel}</div>
      </div>
      <div className="text-right">
        <div className={cn("text-base font-semibold tabular-nums", value >= 0 ? "text-success" : "text-destructive")}>{valueStr}</div>
        <div className={cn("flex items-center justify-end gap-1 text-xs tabular-nums", tone)}>
          <Icon className="h-3 w-3" />
          {pct === null ? noBaseline : `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`}
        </div>
      </div>
    </div>
  );
}