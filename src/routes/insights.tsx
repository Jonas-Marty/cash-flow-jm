import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";

import { AppShell } from "@/components/AppShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useI18n } from "@/i18n";
import { fetchSettings } from "@/lib/finance";
import { OverviewTab } from "@/components/insights/OverviewTab";
import { BreakdownTab, type ChartKind } from "@/components/insights/BreakdownTab";
import { TrendsTab } from "@/components/insights/TrendsTab";
import { ProjectionTab } from "@/components/insights/ProjectionTab";
import { RecurringDetectorCard } from "@/components/insights/RecurringDetectorCard";
import { PeriodPicker, periodToRange, type PeriodKey } from "@/components/insights/PeriodPicker";
import type { GroupKey, TxFilter } from "@/lib/insights";

const searchSchema = z.object({
  tab: fallback(z.enum(["overview", "breakdown", "trends", "projection"]), "overview").default("overview"),
  period: fallback(z.enum(["this_month", "last_month", "ytd", "last_12mo", "last_24mo", "all"]), "last_12mo").default("last_12mo"),
  group: fallback(z.enum(["category", "group", "tag", "account", "type"]), "category").default("category"),
  txFilter: fallback(z.enum(["expense", "income", "both"]), "expense").default("expense"),
  chart: fallback(z.enum(["pie", "bar", "treemap"]), "pie").default("pie"),
});

export const Route = createFileRoute("/insights")({
  validateSearch: zodValidator(searchSchema),
  component: InsightsPage,
  errorComponent: ({ error }) => (
    <AppShell>
      <div className="p-4 text-sm text-destructive">{String(error?.message ?? error)}</div>
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <div className="p-4 text-sm">Not found.</div>
    </AppShell>
  ),
});

function InsightsPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/insights" });

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const symbol = settingsQ.data?.currency_symbol ?? "CHF";

  const range = React.useMemo(() => periodToRange(search.period as PeriodKey), [search.period]);

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{t("nav.insights")}</h1>
          <PeriodPicker
            value={search.period as PeriodKey}
            onChange={(p) => navigate({ search: (prev) => ({ ...prev, period: p }), replace: true })}
          />
        </div>

        <Tabs
          value={search.tab}
          onValueChange={(v) => navigate({ search: (prev) => ({ ...prev, tab: v as typeof search.tab }), replace: true })}
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">{t("insights.tab.overview")}</TabsTrigger>
            <TabsTrigger value="breakdown">{t("insights.tab.breakdown")}</TabsTrigger>
            <TabsTrigger value="trends">{t("insights.tab.trends")}</TabsTrigger>
            <TabsTrigger value="projection">{t("insights.tab.projection")}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <OverviewTab from={range.from} to={range.to} symbol={symbol} />
            <RecurringDetectorCard symbol={symbol} />
          </TabsContent>

          <TabsContent value="breakdown">
            <BreakdownTab
              from={range.from}
              to={range.to}
              symbol={symbol}
              group={search.group as GroupKey}
              onGroupChange={(g) => navigate({ search: (prev) => ({ ...prev, group: g }), replace: true })}
              txFilter={search.txFilter as TxFilter}
              onTxFilterChange={(f) => navigate({ search: (prev) => ({ ...prev, txFilter: f }), replace: true })}
              chart={search.chart as ChartKind}
              onChartChange={(c) => navigate({ search: (prev) => ({ ...prev, chart: c }), replace: true })}
            />
          </TabsContent>

          <TabsContent value="trends">
            <TrendsTab from={range.from} to={range.to} symbol={symbol} />
          </TabsContent>

          <TabsContent value="projection">
            <ProjectionTab symbol={symbol} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}