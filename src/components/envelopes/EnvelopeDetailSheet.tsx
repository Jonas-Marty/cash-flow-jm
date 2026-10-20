import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, startOfMonth, subMonths } from "date-fns";
import { ArrowDownToLine, ArrowLeftRight, ChevronDown, Flag, Plus, Receipt } from "lucide-react";
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
import {
  fetchAccounts,
  fetchCategoryLedger,
  fetchSavingsBalanceSeries,
  fetchSavingsBalances,
  fetchCategories,
  fmtMoney,
  type LedgerRow,
} from "@/lib/finance";
import {
  buildLedgerItems,
  groupLedgerByMonth,
  type LedgerFilter,
  type LedgerItem,
} from "@/lib/ledger";

const FILTERS: LedgerFilter[] = ["all", "transactions", "allocations", "reallocations"];

/** Icon tile per kind of movement; the colours match the breakdown bar. */
const KIND_STYLE = {
  allocation: { Icon: Plus, cls: "bg-success/15 text-success", bar: "bg-success" },
  opening: { Icon: Flag, cls: "bg-primary/10 text-foreground", bar: "bg-primary/60" },
  sweep: {
    Icon: ArrowDownToLine,
    cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    bar: "bg-sky-500",
  },
  reallocation: { Icon: ArrowLeftRight, cls: "bg-warning/20 text-warning", bar: "bg-warning" },
  transaction: { Icon: Receipt, cls: "bg-muted text-muted-foreground", bar: "bg-muted-foreground" },
} as const;

type StyleKey = keyof typeof KIND_STYLE;

function styleKey(item: LedgerItem): StyleKey {
  if (item.type === "sweep") return "sweep";
  const k = item.row.kind;
  return k === "sweep_in" || k === "sweep_out" ? "sweep" : k;
}

function KindIcon({ k }: { k: StyleKey }) {
  const { Icon, cls } = KIND_STYLE[k];
  return (
    <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md", cls)}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

const plain = (v: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const signed = (v: number, symbol: string) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtMoney(Math.abs(v), symbol).replace("-", "")}`;

/** Balance history + every movement for one savings envelope. */
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
  const [filter, setFilter] = React.useState<LedgerFilter>("all");
  const [openSweeps, setOpenSweeps] = React.useState<Set<string>>(() => new Set());
  const allTime = months === 120;
  const from = format(startOfMonth(subMonths(parseISO(asOf), months - 1)), "yyyy-MM-dd");

  React.useEffect(() => {
    if (!open) return;
    setFilter("all");
    setOpenSweeps(new Set());
  }, [open, categoryId]);

  const enabled = open && !!categoryId;
  const seriesQ = useQuery({
    queryKey: ["savings_balance_series", from, asOf],
    queryFn: () => fetchSavingsBalanceSeries(from, asOf),
    enabled,
  });
  const balQ = useQuery({
    queryKey: ["savings-balances", asOf],
    queryFn: () => fetchSavingsBalances(asOf),
    enabled,
  });
  const ledgerQ = useQuery({
    queryKey: ["category_ledger", categoryId, allTime ? null : from, asOf],
    queryFn: () => fetchCategoryLedger(categoryId!, allTime ? null : from, asOf),
    enabled,
  });
  const catsQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, enabled });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, enabled });

  const catById = React.useMemo(
    () => new Map((catsQ.data ?? []).map((c) => [c.id, c])),
    [catsQ.data],
  );
  const accountName = React.useMemo(
    () => new Map((accountsQ.data ?? []).map((a) => [a.id, a.name])),
    [accountsQ.data],
  );
  const catName = React.useCallback(
    (id: string | null) =>
      id ? (catById.get(id)?.name ?? t("env.ledger.unknown_category")) : null,
    [catById, t],
  );

  const balance = React.useMemo(
    () => (balQ.data ?? []).find((b) => b.category_id === categoryId) ?? null,
    [balQ.data, categoryId],
  );

  // What the balance is made of. from_allocations includes the opening balance.
  const parts = React.useMemo(() => {
    if (!balance) return [];
    const opening = Number(catById.get(categoryId ?? "")?.opening_balance ?? 0);
    return (
      [
        [
          "allocation",
          t("env.ledger.part.allocations"),
          Number(balance.from_allocations) - opening,
        ],
        ["opening", t("env.ledger.part.opening"), opening],
        ["sweep", t("env.ledger.part.sweeps"), Number(balance.from_sweeps)],
        ["reallocation", t("env.ledger.part.reallocations"), Number(balance.from_reallocations)],
        ["transaction", t("env.ledger.part.transactions"), Number(balance.from_transactions)],
      ] as Array<[StyleKey, string, number]>
    ).filter(([, , v]) => Math.abs(v) > 0.005);
  }, [balance, catById, categoryId, t]);
  const partsTotal = parts.reduce((s, [, , v]) => s + Math.abs(v), 0);

  const chartData = React.useMemo(
    () =>
      (seriesQ.data ?? [])
        .filter((p) => p.category_id === categoryId)
        .map((p) => ({ as_of: p.as_of, balance: Number(p.cumulative_balance) })),
    [seriesQ.data, categoryId],
  );

  const items = React.useMemo(() => buildLedgerItems(ledgerQ.data ?? []), [ledgerQ.data]);
  const monthsList = React.useMemo(() => groupLedgerByMonth(items, filter), [items, filter]);

  const fmtDay = (d: string) => format(parseISO(d), "d MMM", { locale });
  const fmtMonth = (d: string) => format(parseISO(d), "MMMM yyyy", { locale });

  const describe = (item: LedgerItem): { label: string; sub: string } => {
    if (item.type === "sweep") {
      const n = item.rows.length;
      return {
        label: t("env.ledger.sweep_in", {
          month: item.month ? format(parseISO(item.month), "MMMM", { locale }) : "",
        }),
        sub: `${fmtDay(item.date)} · ${n === 1 ? t("env.ledger.sweep_in_sub_one") : t("env.ledger.sweep_in_sub", { n: String(n) })}`,
      };
    }
    const r: LedgerRow = item.row;
    const day = r.occurred_on ? fmtDay(r.occurred_on) : "";
    switch (r.kind) {
      case "opening":
        return { label: t("env.ledger.opening"), sub: "" };
      case "allocation":
        return {
          label: t("env.ledger.allocation"),
          sub: `${day} · ${t("env.ledger.allocation_sub")}`,
        };
      case "sweep_out":
        return {
          label: t("env.ledger.sweep_out", { name: catName(r.counterpart_category_id) ?? "" }),
          sub: day,
        };
      case "reallocation": {
        const inflow = r.amount > 0;
        const other = catName(r.counterpart_category_id);
        return {
          label: r.description || (inflow ? t("env.realloc_in") : t("env.realloc_out")),
          sub: other ? `${day} · ${inflow ? "←" : "→"} ${other}` : day,
        };
      }
      default: {
        const acc = r.account_id ? accountName.get(r.account_id) : null;
        return {
          label:
            r.description || (r.amount > 0 ? t("env.savings_refund") : t("env.savings_booking")),
          sub: acc ? `${day} · ${acc}` : day,
        };
      }
    }
  };

  const toggleSweep = (key: string) =>
    setOpenSweeps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const loading = seriesQ.isLoading || balQ.isLoading || ledgerQ.isLoading;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{categoryName}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-3 rounded-md border p-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("env.asof.balance")} · {format(parseISO(asOf), "d MMM yyyy", { locale })}
              </div>
              <div className="text-2xl font-bold tabular-nums">
                {fmtMoney(balance ? Number(balance.cumulative_balance) : 0, symbol)}
              </div>
            </div>
            {parts.length > 0 && partsTotal > 0 && (
              <div className="space-y-2">
                <div className="flex h-2 gap-0.5 overflow-hidden rounded" aria-hidden="true">
                  {parts.map(([k, , v]) => (
                    <span key={k} className={KIND_STYLE[k].bar} style={{ flexGrow: Math.abs(v) }} />
                  ))}
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs tabular-nums">
                  {parts.map(([k, label, v]) => (
                    <React.Fragment key={k}>
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span className={cn("h-2 w-2 rounded-sm", KIND_STYLE[k].bar)} />
                        {label}
                      </span>
                      <span>{signed(v, symbol)}</span>
                    </React.Fragment>
                  ))}
                </div>
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
                    tickFormatter={(v: string) => format(parseISO(v), "MMM yy", { locale })}
                    fontSize={11}
                  />
                  <YAxis
                    fontSize={11}
                    width={64}
                    tickFormatter={(v: number) => fmtMoney(v, symbol)}
                  />
                  <Tooltip
                    formatter={(v: number) => [fmtMoney(Number(v), symbol), t("env.asof.balance")]}
                    labelFormatter={(v: string) => format(parseISO(v), "d MMM yyyy", { locale })}
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

          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("env.detail.ledger")}
            </div>
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label={t("env.detail.ledger")}
            >
              {FILTERS.map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? "default" : "outline"}
                  className="h-7 rounded-full px-3 text-xs"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {t(`env.ledger.filter.${f}`)}
                </Button>
              ))}
            </div>
            {ledgerQ.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : monthsList.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {items.length === 0 ? t("env.history.empty") : t("env.ledger.filter_empty")}
              </div>
            ) : (
              <div>
                {monthsList.map((m) => (
                  <section key={m.month ?? "opening"}>
                    <div className="flex items-baseline justify-between border-b pb-1 pt-3 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <span>{m.month ? fmtMonth(m.month) : t("env.ledger.opening")}</span>
                      {m.month && (
                        <span
                          className={cn(
                            "tabular-nums",
                            m.net > 0 ? "text-success" : m.net < 0 ? "text-destructive" : "",
                          )}
                        >
                          {signed(m.net, symbol)}
                        </span>
                      )}
                    </div>
                    <ul className="divide-y">
                      {m.items.map((item) => {
                        const { label, sub } = describe(item);
                        const isSweep = item.type === "sweep";
                        const expanded = isSweep && openSweeps.has(item.key);
                        const body = (
                          <>
                            <KindIcon k={styleKey(item)} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate">{label}</div>
                              {sub && (
                                <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                                  <span className="truncate">{sub}</span>
                                  {isSweep && (
                                    <ChevronDown
                                      className={cn(
                                        "h-3.5 w-3.5 shrink-0 transition-transform",
                                        expanded && "rotate-180",
                                      )}
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="text-right">
                              <div
                                className={cn(
                                  "font-medium tabular-nums",
                                  item.amount > 0
                                    ? "text-success"
                                    : item.amount < 0
                                      ? "text-destructive"
                                      : "",
                                )}
                              >
                                {signed(item.amount, symbol)}
                              </div>
                              <div className="text-xs tabular-nums text-muted-foreground">
                                {fmtMoney(item.running, symbol)}
                              </div>
                            </div>
                          </>
                        );
                        return (
                          <li key={item.key} className="py-2 text-sm">
                            {isSweep ? (
                              <button
                                type="button"
                                className="flex w-full items-center gap-3 rounded text-left hover:bg-muted/50"
                                aria-expanded={expanded}
                                onClick={() => toggleSweep(item.key)}
                              >
                                {body}
                              </button>
                            ) : (
                              <div className="flex items-center gap-3">{body}</div>
                            )}
                            {isSweep && expanded && (
                              <div className="ml-10 mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2 text-xs tabular-nums">
                                {item.rows
                                  .slice()
                                  .sort((a, b) => b.amount - a.amount)
                                  .map((r) => {
                                    const a = plain(Number(r.meta?.allocated ?? 0));
                                    const b = plain(Number(r.meta?.actual ?? 0));
                                    return (
                                      <React.Fragment key={r.entry_key}>
                                        <span className="min-w-0">
                                          <span className="block truncate">
                                            {catName(r.counterpart_category_id)}
                                          </span>
                                          <span className="block truncate text-muted-foreground">
                                            {t(
                                              r.meta?.income
                                                ? "env.ledger.sweep_income"
                                                : "env.ledger.sweep_expense",
                                              { a, b },
                                            )}
                                          </span>
                                        </span>
                                        <span
                                          className={
                                            r.amount >= 0 ? "text-success" : "text-destructive"
                                          }
                                        >
                                          {signed(r.amount, symbol)}
                                        </span>
                                      </React.Fragment>
                                    );
                                  })}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
