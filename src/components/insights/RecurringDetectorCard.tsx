import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import {
  fetchTransactionsRange,
  fetchRecurringRules,
  fmtMoney,
} from "@/lib/finance";
import { detectRecurringCandidates } from "@/lib/insights";

/**
 * Detects expenses that look recurring (stable amount, repeating monthly)
 * but aren't yet linked to a recurring_rules row. Pure client-side.
 */
export function RecurringDetectorCard({ symbol }: { symbol: string }) {
  const { t } = useI18n();
  // Always look back 12 months for detection regardless of selected period.
  const range = React.useMemo(() => {
    const today = new Date();
    return {
      from: new Date(today.getFullYear() - 1, today.getMonth(), 1).toISOString().slice(0, 10),
      to: today.toISOString().slice(0, 10),
    };
  }, []);

  const [minOcc, setMinOcc] = React.useState(3);
  const [minMonths, setMinMonths] = React.useState(3);
  const [maxCv, setMaxCv] = React.useState(30);

  const txQ = useQuery({
    queryKey: ["insights", "tx_range", range.from, range.to],
    queryFn: () => fetchTransactionsRange(range.from, range.to),
  });
  const rulesQ = useQuery({ queryKey: ["recurring_rules"], queryFn: fetchRecurringRules });

  const candidates = React.useMemo(() => {
    if (!txQ.data || !rulesQ.data) return [];
    return detectRecurringCandidates(txQ.data, rulesQ.data, {
      minOccurrences: minOcc,
      minMonths: minMonths,
      maxCv: maxCv / 100,
    });
  }, [txQ.data, rulesQ.data, minOcc, minMonths, maxCv]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t("insights.detector.title")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("insights.detector.hint")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">{t("insights.detector.min_occ")}</Label>
            <Input type="number" min={2} value={minOcc} onChange={(e) => setMinOcc(Math.max(2, Number(e.target.value) || 2))} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">{t("insights.detector.min_months")}</Label>
            <Input type="number" min={2} value={minMonths} onChange={(e) => setMinMonths(Math.max(2, Number(e.target.value) || 2))} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">{t("insights.detector.max_cv")} (%)</Label>
            <Input type="number" min={0} max={100} value={maxCv} onChange={(e) => setMaxCv(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="h-8" />
          </div>
        </div>

        {txQ.isLoading || rulesQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("insights.detector.empty")}</p>
        ) : (
          <div className="space-y-1.5">
            {candidates.slice(0, 12).map((c) => (
              <div key={c.key} className="flex items-center justify-between gap-2 rounded-md border bg-card p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {c.occurrences}× · {c.monthsCovered} {t("insights.detector.months")} · ±{(c.cv * 100).toFixed(0)}% · {t("insights.detector.last_seen")}: {c.lastSeen}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">{fmtMoney(c.avgAmount, symbol)}</div>
                  <div className="text-[11px] text-muted-foreground">{t("insights.detector.avg")}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}