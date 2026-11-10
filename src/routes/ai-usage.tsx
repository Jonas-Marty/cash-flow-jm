import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { IsoDateInput } from "@/components/DateInput";

import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import {
  bucketUnit,
  buckets,
  groupRows,
  niceAxis,
  periodFor,
  totals,
  type GroupBy,
  type Period,
  type PeriodKind,
  type UsageGroup,
  type UsageRow,
  type UsageTotals,
} from "@/lib/aiUsage";

export const Route = createFileRoute("/ai-usage")({
  component: AIUsagePage,
});

const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const fmtInt = (n: number) => Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

async function fetchUsage(p: Period): Promise<{ rows: UsageRow[]; chats: number }> {
  const args = { p_from: p.from, p_to: p.to };
  const [usage, chats] = await Promise.all([
    supabase.rpc("ai_usage", args),
    supabase.rpc("ai_usage_chats", args),
  ]);
  if (usage.error) throw usage.error;
  if (chats.error) throw chats.error;
  return { rows: (usage.data ?? []) as UsageRow[], chats: Number(chats.data ?? 0) };
}

/**
 * How many tokens the AI connections used, from the AI log: per connection,
 * model or feature, over a period. Opened from Settings.
 */
function AIUsagePage() {
  const { t, locale } = useI18n();
  const [periodKind, setPeriodKind] = React.useState<PeriodKind>("month");
  const [custom, setCustom] = React.useState(() => {
    const y = periodFor("year");
    return { from: y.from, to: periodFor("month").to };
  });
  const [groupBy, setGroupBy] = React.useState<GroupBy>("connection");
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set());
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());

  const period: Period =
    periodKind === "custom"
      ? {
          kind: "custom",
          from: custom.from <= custom.to ? custom.from : custom.to,
          to: custom.from <= custom.to ? custom.to : custom.from,
        }
      : periodFor(periodKind);

  const q = useQuery({
    queryKey: ["ai_usage", period.from, period.to],
    queryFn: () => fetchUsage(period),
    placeholderData: keepPreviousData,
  });
  const rows = q.data?.rows ?? [];
  const sum = totals(rows);
  const groups = groupRows(rows, groupBy);

  const labelOf = React.useCallback(
    (g: UsageGroup) =>
      groupBy === "connection"
        ? g.rows[0].connection
        : groupBy === "model"
          ? g.rows[0].model
          : t(`ai.usage.kind.${g.key}`),
    [groupBy, t],
  );
  const colorOf = (key: string) => SERIES[groups.findIndex((g) => g.key === key) % SERIES.length];

  const rangeLabel =
    periodKind === "month" || periodKind === "last"
      ? format(parseISO(period.from), "MMMM yyyy", { locale })
      : `${format(parseISO(period.from), "d. MMM yyyy", { locale })} – ${format(parseISO(period.to), "d. MMM yyyy", { locale })}`;

  const switchGroup = (g: GroupBy) => {
    setGroupBy(g);
    setHidden(new Set());
    setOpen(new Set());
  };

  return (
    <AppShell wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <Link
              to="/settings"
              hash="ai-usage"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> {t("ai.usage.back")}
            </Link>
            <h1 className="text-2xl font-semibold">{t("ai.usage.title")}</h1>
          </div>
          <Segmented
            label={t("ai.usage.period")}
            value={periodKind}
            onChange={(v) => setPeriodKind(v as PeriodKind)}
            options={[
              ["month", t("ai.usage.period.month")],
              ["last", t("ai.usage.period.last")],
              ["year", t("ai.usage.period.year")],
              ["custom", t("ai.usage.period.custom")],
            ]}
          />
        </div>

        {periodKind === "custom" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="usage-from" className="text-muted-foreground">
              {t("ai.usage.from")}
            </label>
            <IsoDateInput
              id="usage-from"
              className="h-9 w-32"
              value={custom.from}
              onChange={(iso) => setCustom((c) => ({ ...c, from: iso }))}
            />
            <label htmlFor="usage-to" className="text-muted-foreground">
              {t("ai.usage.to")}
            </label>
            <IsoDateInput
              id="usage-to"
              className="h-9 w-32"
              value={custom.to}
              onChange={(iso) => setCustom((c) => ({ ...c, to: iso }))}
            />
          </div>
        )}
        <p className="-mt-2 text-sm text-muted-foreground">{rangeLabel}</p>

        {q.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : q.error ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : (
          <>
            <Card className="grid grid-cols-2 gap-px overflow-hidden bg-border py-0 sm:grid-cols-3 lg:grid-cols-6">
              <Tile
                label={t("ai.usage.requests")}
                value={fmtInt(sum.requests)}
                sub={t("ai.usage.chats", { n: q.data?.chats ?? 0 })}
              />
              <Tile
                label={t("ai.usage.in")}
                value={fmtInt(sum.prompt)}
                sub={t("ai.usage.cached", { x: fmtInt(sum.cached) })}
              />
              <Tile label={t("ai.usage.out")} value={fmtInt(sum.completion)} />
              <Tile
                label={t("ai.usage.total")}
                value={fmtInt(sum.total)}
                sub={
                  sum.avgTokens !== null
                    ? t("ai.usage.per_request", { x: fmtInt(sum.avgTokens) })
                    : undefined
                }
              />
              <Tile
                label={t("ai.usage.failed")}
                value={fmtInt(sum.failed)}
                sub={sum.failed ? t("ai.usage.failed_hint") : undefined}
                bad={sum.failed > 0}
              />
              <Tile
                label={t("ai.usage.without")}
                value={fmtInt(sum.withoutUsage)}
                sub={sum.withoutUsage ? t("ai.usage.without_hint") : undefined}
              />
            </Card>

            {rows.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                {t("ai.usage.empty")}
              </Card>
            ) : (
              <>
                <Card className="gap-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Segmented
                      label={t("ai.usage.group")}
                      value={groupBy}
                      onChange={(v) => switchGroup(v as GroupBy)}
                      options={[
                        ["connection", t("ai.usage.by.connection")],
                        ["model", t("ai.usage.by.model")],
                        ["kind", t("ai.usage.by.kind")],
                      ]}
                    />
                    <span className="text-xs text-muted-foreground">
                      {bucketUnit(period) === "day"
                        ? t("ai.usage.per_day")
                        : t("ai.usage.per_month")}
                    </span>
                  </div>
                  <UsageChart
                    rows={rows}
                    period={period}
                    groupBy={groupBy}
                    order={groups.map((g) => g.key)}
                    hidden={hidden}
                    colorOf={colorOf}
                    labelOf={(k) => labelOf(groups.find((g) => g.key === k)!)}
                    locale={locale}
                  />
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {groups.map((g) => (
                      <button
                        key={g.key}
                        type="button"
                        aria-pressed={!hidden.has(g.key)}
                        onClick={() =>
                          setHidden((h) => {
                            const n = new Set(h);
                            if (n.has(g.key)) n.delete(g.key);
                            else n.add(g.key);
                            return n;
                          })
                        }
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded px-0.5 hover:text-foreground",
                          hidden.has(g.key) && "line-through opacity-40",
                        )}
                      >
                        <i
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ background: colorOf(g.key) }}
                        />
                        {labelOf(g)}
                      </button>
                    ))}
                  </div>
                </Card>

                <UsageTable
                  groups={groups}
                  groupBy={groupBy}
                  total={sum}
                  open={open}
                  onToggle={(k) =>
                    setOpen((o) => {
                      const n = new Set(o);
                      if (n.has(k)) n.delete(k);
                      else n.add(k);
                      return n;
                    })
                  }
                  labelOf={labelOf}
                  colorOf={colorOf}
                />
              </>
            )}
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>{t("ai.usage.note.tools")}</p>
              <p>{t("ai.usage.note.without")}</p>
              <p>{t("ai.usage.note.history")}</p>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Segmented({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap overflow-hidden rounded-md border bg-card"
    >
      {options.map(([v, text], i) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            i > 0 && "border-l",
            value === v ? "bg-primary text-primary-foreground" : "hover:bg-muted",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  bad,
}: {
  label: string;
  value: string;
  sub?: string;
  bad?: boolean;
}) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("text-lg font-bold tabular-nums", bad && "text-destructive")}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function UsageChart({
  rows,
  period,
  groupBy,
  order,
  hidden,
  colorOf,
  labelOf,
  locale,
}: {
  rows: UsageRow[];
  period: Period;
  groupBy: GroupBy;
  order: string[];
  hidden: Set<string>;
  colorOf: (k: string) => string;
  labelOf: (k: string) => string;
  locale: import("date-fns").Locale;
}) {
  const isMobile = useIsMobile();
  const bs = buckets(rows, period, groupBy);
  const shown = order.filter((k) => !hidden.has(k));
  const max = Math.max(0, ...bs.map((b) => shown.reduce((s, k) => s + (b.values.get(k) ?? 0), 0)));
  const { top, step } = niceAxis(max);
  // A narrower drawing on a phone keeps the labels readable once scaled down.
  const W = isMobile ? 400 : 940;
  const H = isMobile ? 200 : 220;
  const L = isMobile ? 40 : 56;
  const R = 8;
  const T = 10;
  const B = 26;
  const iw = W - L - R;
  const ih = H - T - B;
  const y = (v: number) => T + ih - (v / top) * ih;
  const bw = iw / bs.length;
  const unit = bucketUnit(period);
  const every = Math.ceil(bs.length / (isMobile ? 6 : unit === "day" ? 10 : 12));
  const tick = (v: number) =>
    v >= 1000 ? `${(Math.round(v / 100) / 10).toLocaleString()}k` : String(v);
  const label = (k: string) =>
    unit === "day"
      ? format(parseISO(k), "d.", { locale })
      : format(parseISO(`${k}-01`), "MMM", { locale });

  const lines: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) lines.push(v);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Tokens">
      {lines.map((v) => (
        <g key={v}>
          <line
            x1={L}
            x2={W - R}
            y1={y(v)}
            y2={y(v)}
            style={{ stroke: "var(--border)" }}
            strokeWidth={1}
          />
          <text
            x={L - 6}
            y={y(v) + 4}
            textAnchor="end"
            fontSize={11}
            style={{ fill: "var(--muted-foreground)" }}
          >
            {tick(v)}
          </text>
        </g>
      ))}
      {bs.map((b, i) => {
        let acc = 0;
        const x = L + i * bw + bw * 0.15;
        const w = Math.max(1, bw * 0.7);
        return (
          <g key={b.key}>
            {shown.map((k) => {
              const v = b.values.get(k) ?? 0;
              if (!v) return null;
              const y1 = y(acc + v);
              const y0 = y(acc);
              acc += v;
              return (
                <rect
                  key={k}
                  x={x}
                  y={y1}
                  width={w}
                  height={Math.max(0, y0 - y1)}
                  rx={1.5}
                  style={{ fill: colorOf(k) }}
                >
                  <title>{`${label(b.key)} · ${labelOf(k)}: ${fmtInt(v)}`}</title>
                </rect>
              );
            })}
            {(i % every === 0 || i === bs.length - 1) && (
              <text
                x={L + i * bw + bw / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize={11}
                style={{ fill: "var(--muted-foreground)" }}
              >
                {label(b.key)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Markers on a line: fallback use, a model no longer set up, a deleted connection. */
function Markers({
  rows,
  t: tot,
  level,
}: {
  rows: UsageRow[];
  t: UsageTotals;
  level: "group" | "model";
}) {
  const { t } = useI18n();
  const deleted = rows.every((r) => !r.connection_exists);
  const retired = level === "model" && !deleted && rows.every((r) => !r.model_configured);
  return (
    <>
      {tot.fallback > 0 && (
        <span className="ml-1.5 whitespace-nowrap rounded-full bg-warning/15 px-1.5 text-[10.5px] font-medium leading-4 text-warning">
          {t("ai.usage.fallback", { n: tot.fallback })}
        </span>
      )}
      {retired && (
        <span className="ml-1.5 whitespace-nowrap rounded-full border px-1.5 text-[10.5px] leading-4 text-muted-foreground">
          {t("ai.usage.retired")}
        </span>
      )}
      {deleted && level === "group" && (
        <span className="ml-1.5 whitespace-nowrap rounded-full border px-1.5 text-[10.5px] leading-4 text-muted-foreground">
          {t("ai.usage.deleted")}
        </span>
      )}
    </>
  );
}

function logSearch(groupBy: GroupBy, g: UsageGroup, model?: string) {
  const first = g.rows[0];
  if (groupBy === "connection")
    return {
      aiConn: first.endpoint_id ?? `name:${first.connection}`,
      aiModel: model ?? "",
      aiKind: "",
    };
  if (groupBy === "model") return { aiConn: "", aiModel: g.key, aiKind: "" };
  return { aiConn: "", aiModel: "", aiKind: g.key };
}

function UsageTable({
  groups,
  groupBy,
  total,
  open,
  onToggle,
  labelOf,
  colorOf,
}: {
  groups: UsageGroup[];
  groupBy: GroupBy;
  total: UsageTotals;
  open: Set<string>;
  onToggle: (k: string) => void;
  labelOf: (g: UsageGroup) => string;
  colorOf: (k: string) => string;
}) {
  const { t } = useI18n();
  const nested = groupBy === "connection";
  const share = (n: number) => (total.total > 0 ? (n / total.total) * 100 : 0);
  const sec = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`);
  const models = (g: UsageGroup) => groupRows(g.rows, "model").map((m) => ({ ...m, label: m.key }));

  const cells = (tot: UsageTotals, color: string) => (
    <>
      <td className="px-3 py-2 text-right">
        {fmtInt(tot.requests)}
        {tot.withoutUsage > 0 && (
          <span className="ml-1.5 whitespace-nowrap rounded-full border px-1.5 text-[10.5px] text-muted-foreground">
            {t("ai.usage.without_n", { n: tot.withoutUsage })}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right">{fmtInt(tot.prompt)}</td>
      <td className="px-3 py-2 text-right">{fmtInt(tot.completion)}</td>
      <td className="px-3 py-2 text-right font-semibold">{fmtInt(tot.total)}</td>
      <td className="px-3 py-2 text-right">
        <span className="inline-flex items-center justify-end gap-2">
          {share(tot.total).toFixed(1)} %
          <span className="h-1.5 w-16 overflow-hidden rounded bg-muted">
            <span
              className="block h-full"
              style={{ width: `${share(tot.total)}%`, background: color }}
            />
          </span>
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        {tot.avgTokens === null ? "–" : fmtInt(tot.avgTokens)}
      </td>
      <td className="px-3 py-2 text-right">{sec(tot.avgMs)}</td>
      <td className={cn("px-3 py-2 text-right", tot.failed > 0 && "text-destructive")}>
        {fmtInt(tot.failed)}
      </td>
    </>
  );

  const logLink = (g: UsageGroup, model?: string) => (
    <Link
      to="/settings"
      search={logSearch(groupBy, g, model)}
      hash="ai-audit"
      className="text-xs text-muted-foreground hover:text-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      {t("ai.usage.to_log")} →
    </Link>
  );

  return (
    <>
      {/* Wide screens: a table. */}
      <Card className="hidden overflow-x-auto py-0 md:block">
        <table className="w-full min-w-[760px] text-sm tabular-nums">
          <thead>
            <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold">{t(`ai.usage.by.${groupBy}`)}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("ai.usage.requests")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("ai.usage.col.in")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("ai.usage.col.out")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("ai.usage.total")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("ai.usage.col.share")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("ai.usage.col.avg")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("ai.usage.col.duration")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("ai.usage.col.errors")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = open.has(g.key);
              const color = colorOf(g.key);
              return (
                <React.Fragment key={g.key}>
                  <tr
                    className={cn("border-b", nested && "cursor-pointer hover:bg-muted/40")}
                    onClick={nested ? () => onToggle(g.key) : undefined}
                    onKeyDown={
                      nested
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onToggle(g.key);
                            }
                          }
                        : undefined
                    }
                    tabIndex={nested ? 0 : undefined}
                    aria-expanded={nested ? isOpen : undefined}
                  >
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        {nested && (
                          <ChevronRight
                            className={cn(
                              "h-3.5 w-3.5 text-muted-foreground transition-transform",
                              isOpen && "rotate-90",
                            )}
                          />
                        )}
                        <i
                          className="h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ background: color }}
                        />
                        <span>{labelOf(g)}</span>
                        <Markers
                          rows={g.rows}
                          t={g.totals}
                          level={groupBy === "model" ? "model" : "group"}
                        />
                      </span>
                    </td>
                    {cells(g.totals, color)}
                    <td className="px-3 py-2 text-right">{!nested && logLink(g)}</td>
                  </tr>
                  {nested &&
                    isOpen &&
                    models(g).map((m) => (
                      <tr
                        key={m.key}
                        className="border-b bg-muted/20 text-[13px] text-muted-foreground"
                      >
                        <td className="py-2 pl-12 pr-3">
                          {m.label}
                          <Markers rows={m.rows} t={m.totals} level="model" />
                        </td>
                        {cells(m.totals, color)}
                        <td className="px-3 py-2 text-right">{logLink(g, m.key)}</td>
                      </tr>
                    ))}
                </React.Fragment>
              );
            })}
            <tr className="font-semibold">
              <td className="px-3 py-2">{t("ai.usage.total")}</td>
              {cells(total, "var(--muted-foreground)")}
              <td />
            </tr>
          </tbody>
        </table>
      </Card>

      {/* Phones: one card per line. */}
      <div className="grid gap-2 md:hidden">
        {groups.map((g) => {
          const color = colorOf(g.key);
          return (
            <React.Fragment key={g.key}>
              <UsageCard
                title={labelOf(g)}
                markers={
                  <Markers
                    rows={g.rows}
                    t={g.totals}
                    level={groupBy === "model" ? "model" : "group"}
                  />
                }
                tot={g.totals}
                share={share(g.totals.total)}
                color={color}
                link={!nested ? logLink(g) : null}
              />
              {nested &&
                models(g).map((m) => (
                  <UsageCard
                    key={m.key}
                    sub
                    title={m.label}
                    markers={<Markers rows={m.rows} t={m.totals} level="model" />}
                    tot={m.totals}
                    share={share(m.totals.total)}
                    color={color}
                    link={logLink(g, m.key)}
                  />
                ))}
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
}

function UsageCard({
  title,
  markers,
  tot,
  share,
  color,
  link,
  sub,
}: {
  title: string;
  markers: React.ReactNode;
  tot: UsageTotals;
  share: number;
  color: string;
  link: React.ReactNode;
  sub?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Card className={cn("gap-1.5 px-3.5 py-3", sub && "ml-4 bg-muted/40")}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-y-1 text-sm">
          {!sub && (
            <i className="mr-2 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
          )}
          <span className="truncate">{title}</span>
          {markers}
        </span>
        <span className="font-semibold tabular-nums">{fmtInt(tot.total)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-muted">
        <span className="block h-full" style={{ width: `${share}%`, background: color }} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
        <span>{share.toFixed(1)} %</span>
        <span>{t("ai.usage.card.requests", { n: fmtInt(tot.requests) })}</span>
        <span>
          {t("ai.usage.card.in_out", { a: fmtInt(tot.prompt), b: fmtInt(tot.completion) })}
        </span>
        {tot.avgTokens !== null && (
          <span>{t("ai.usage.per_request", { x: fmtInt(tot.avgTokens) })}</span>
        )}
        {tot.avgMs !== null && <span>Ø {(tot.avgMs / 1000).toFixed(1)} s</span>}
        {tot.failed > 0 && (
          <span className="text-destructive">{t("ai.usage.card.errors", { n: tot.failed })}</span>
        )}
        {tot.withoutUsage > 0 && <span>{t("ai.usage.without_n", { n: tot.withoutUsage })}</span>}
        {link && <span className="ml-auto">{link}</span>}
      </div>
    </Card>
  );
}
