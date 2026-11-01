import * as React from "react";
import { format, parseISO } from "date-fns";
import type { Locale as DateFnsLocale } from "date-fns";
import { ArrowLeftRight, ChevronDown, History, ListFilter, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StackedBudgetBar } from "@/components/StackedBudgetBar";
import { PrivacyValue } from "@/components/DashboardPrivacy";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { fmtMoney } from "@/lib/finance";
import {
  incomeTotals,
  savingsTotals,
  spendTotals,
  type OverviewGroup,
  type OverviewRow,
  type OverviewSummary,
  type RowStatus,
} from "@/lib/budgetOverview";
import { monthStatus } from "@/lib/month";
import { historyAverage, type HistoryPoint } from "@/lib/budgetHistory";

const EPS = 0.005;

/**
 * The month's budgets at a glance: one line per budget, grouped as in Settings,
 * each opening in place into its figures, the months before and its entries.
 *
 * Rows start closed on every visit and several can be open at once. Nothing about
 * that is remembered: the page is for checking the month, not for arranging it.
 */
export function BudgetOverview({
  groups,
  summary,
  plannedNet,
  month,
  symbol,
  locale,
  history,
  historyLoading,
  onNeedHistory,
  renderEntries,
  onEditBudget,
  onReallocate,
  onOpenDetail,
  onAllTransactions,
  sweepTargetName,
}: {
  groups: OverviewGroup[];
  summary: OverviewSummary;
  /** Income target minus every budget's plan, savings included. */
  plannedNet: number;
  month: Date;
  symbol: string;
  locale?: DateFnsLocale;
  history: Map<string, HistoryPoint[]> | undefined;
  historyLoading: boolean;
  /** Called once a row is opened, so the months before load only when needed. */
  onNeedHistory: () => void;
  renderEntries: (row: OverviewRow) => React.ReactNode;
  /** Opens the month's budgets for editing, on this budget's field (null: the first). */
  onEditBudget: (categoryId: string | null) => void;
  onReallocate: (categoryId: string) => void;
  onOpenDetail: (categoryId: string) => void;
  onAllTransactions: (categoryId: string) => void;
  sweepTargetName: (categoryId: string) => string | null;
}) {
  const { t: tr } = useI18n();
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const [closed, setClosed] = React.useState<Set<string>>(() => new Set());

  const toggleRow = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    onNeedHistory();
  };
  const toggleGroup = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const money = (n: number) => fmtMoney(n, symbol);
  const num = (n: number) => fmtMoney(Math.abs(n), "").trim();
  const m = summary.monthly;

  const groupLabel = (g: OverviewGroup) => g.name ?? tr("env.group.expense");

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden py-0 gap-0">
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          <SummaryTile label={tr("env.ov.spent_monthly")}>
            <PrivacyValue>
              {money(m.spent + m.pending)}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                / {num(m.allocated)}
              </span>
            </PrivacyValue>
          </SummaryTile>
          <SummaryTile label={tr("env.ov.left")}>
            <PrivacyValue className={cn(m.remaining < -EPS && "text-destructive")}>
              {money(m.remaining)}
            </PrivacyValue>
          </SummaryTile>
          <SummaryTile label={tr("env.ov.status")}>
            {summary.overCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-sm">
                <StatusDot status="over" />
                {tr("env.ov.n_over", { n: summary.overCount })}
              </span>
            ) : (
              <span className="text-sm text-success">{tr("env.ov.all_ok")}</span>
            )}
          </SummaryTile>
          <SummaryTile label={tr("env.ov.income")}>
            <PrivacyValue>
              {money(summary.income.received)}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                / {num(summary.income.target)}
              </span>
            </PrivacyValue>
          </SummaryTile>
        </div>
        <div className="space-y-1.5 border-t px-4 py-3">
          <StackedBudgetBar
            className="h-3"
            allocated={m.allocated}
            committed={m.spent}
            pending={m.pending}
          />
          <PrivacyValue className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-sm bg-success" />
              {tr("env.ov.legend_spent", { x: money(m.spent) })}
            </span>
            {m.pending > EPS && (
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2.5 w-2.5 rounded-sm bg-success/45" />
                {tr("env.ov.legend_pending", { x: money(m.pending) })}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-sm bg-muted" />
              {tr("env.ov.legend_left", { x: money(m.remaining) })}
            </span>
          </PrivacyValue>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-dashed pt-1.5 text-xs text-muted-foreground">
            {Math.abs(plannedNet) >= EPS ? (
              <PrivacyValue>
                {plannedNet > 0
                  ? tr("env.ov.plan_gap_under", { x: money(plannedNet) })
                  : tr("env.ov.plan_gap_over", { x: money(-plannedNet) })}
              </PrivacyValue>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => onEditBudget(null)}
              className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
            >
              <Pencil className="h-3 w-3" />
              {tr("env.ov.edit_month", { month: format(month, "MMMM", { locale }) })}
            </button>
          </div>
        </div>
      </Card>

      {groups.map((g) => {
        const isClosed = closed.has(g.key);
        let tone: "over" | "done" | null = null;
        let headerRight: React.ReactNode;
        let headerBar: React.ReactNode = null;
        let badge: React.ReactNode = null;
        let gridHeader = false;

        if (g.kind === "income") {
          const t = incomeTotals(g.rows);
          if (t.allDone) {
            tone = "done";
            badge = <span className="text-success">{tr("env.ov.income_done")}</span>;
          }
          headerBar = (
            <IncomeBar
              target={t.target}
              received={t.received}
              pending={t.pending}
              className="h-2"
            />
          );
          headerRight = tr("env.ov.received_of", { a: num(t.received), b: num(t.target) });
        } else if (g.rows.every((r) => r.type === "savings" || r.archived)) {
          const t = savingsTotals(g.rows);
          gridHeader = true;
          headerRight = money(t.balance);
          headerBar = (
            <span
              className={cn(
                "text-xs tabular-nums",
                t.monthChange < -EPS ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {tr("env.ov.this_month", { x: signed(t.monthChange, num) })}
            </span>
          );
        } else {
          const t = spendTotals(g.rows);
          if (t.overCount > 0) {
            tone = "over";
            badge = (
              <span className="text-destructive">{tr("env.ov.n_over", { n: t.overCount })}</span>
            );
          } else if (t.allDone) {
            tone = "done";
            badge = <span className="text-success">{tr("env.ov.group_done")}</span>;
          }
          headerBar = (
            <StackedBudgetBar
              className="h-2"
              allocated={t.available}
              committed={t.spent}
              pending={t.pending}
            />
          );
          headerRight =
            t.remaining < -EPS ? (
              <span className="text-destructive">
                {tr("env.ov.over_amount", { x: num(t.remaining) })}
              </span>
            ) : (
              tr("env.ov.left_amount", { x: num(t.remaining) })
            );
        }

        return (
          <Card
            key={g.key}
            className={cn("gap-0 overflow-hidden py-0", tone === "over" && "border-destructive/40")}
          >
            <button
              type="button"
              onClick={() => toggleGroup(g.key)}
              aria-expanded={!isClosed}
              className={cn(
                "w-full items-center gap-3 border-b px-3 py-2 text-left",
                gridHeader
                  ? "grid grid-cols-[10px_minmax(0,1fr)_auto] sm:grid-cols-[10px_minmax(0,1fr)_minmax(4rem,1.2fr)_9.5rem]"
                  : "flex",
                tone === "over"
                  ? "bg-destructive/10"
                  : tone === "done"
                    ? "bg-success/10"
                    : "bg-muted/40",
                isClosed && "border-b-0",
              )}
            >
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                  isClosed && "-rotate-90",
                )}
              />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-xs font-semibold uppercase tracking-wide">
                <span className="truncate">{groupLabel(g)}</span>
                {badge && (
                  <span className="text-[11px] font-semibold normal-case tracking-normal">
                    {badge}
                  </span>
                )}
              </span>
              {gridHeader ? (
                <>
                  <span className="hidden sm:block">{headerBar}</span>
                  <PrivacyValue className="text-right text-sm font-semibold tabular-nums">
                    {headerRight}
                  </PrivacyValue>
                </>
              ) : (
                <>
                  <span className="hidden w-28 shrink-0 sm:block">{headerBar}</span>
                  <PrivacyValue className="shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:min-w-[9rem]">
                    {headerRight}
                  </PrivacyValue>
                </>
              )}
            </button>
            {!isClosed && (
              <ul className="divide-y">
                {g.rows.map((r) => {
                  const isOpen = open.has(r.id);
                  return (
                    <li key={r.id}>
                      <RowLine
                        row={r}
                        open={isOpen}
                        onToggle={() => toggleRow(r.id)}
                        num={num}
                        money={money}
                      />
                      {isOpen && (
                        <div className="space-y-3 border-t border-dashed bg-muted/30 px-3 py-3 sm:pl-8">
                          <RowFigures row={r} money={money} />
                          {r.type === "spend" &&
                            !r.rolling &&
                            Math.abs(r.remaining) >= EPS &&
                            sweepTargetName(r.id) && (
                              <p className="text-[11px] italic text-muted-foreground">
                                {tr("envelopes.sweep.target")}: {sweepTargetName(r.id)}
                              </p>
                            )}
                          <HistoryChart
                            row={r}
                            points={history?.get(r.id)}
                            loading={historyLoading}
                            month={month}
                            locale={locale}
                            money={money}
                            num={num}
                          />
                          {renderEntries(r)}
                          <div className="flex flex-wrap gap-2">
                            {!(r.type !== "savings" && r.archived) && (
                              <Button
                                size="sm"
                                className="h-8 gap-1.5"
                                onClick={() => onEditBudget(r.id)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                {tr("env.ov.change_budget")}
                              </Button>
                            )}
                            {(r.type === "savings" || (r.type === "spend" && r.rolling)) && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 gap-1.5"
                                  onClick={() => onReallocate(r.id)}
                                >
                                  <ArrowLeftRight className="h-3.5 w-3.5" />
                                  {tr("envelopes.reallocate")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 gap-1.5"
                                  onClick={() => onOpenDetail(r.id)}
                                >
                                  <History className="h-3.5 w-3.5" />
                                  {tr("env.detail.open")}
                                </Button>
                              </>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1.5"
                              onClick={() => onAllTransactions(r.id)}
                            >
                              <ListFilter className="h-3.5 w-3.5" />
                              {tr("env.ov.all_transactions")}
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function signed(n: number, num: (n: number) => string) {
  return `${n < -EPS ? "−" : "+"}${num(n)}`;
}

function SummaryTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card px-4 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-bold tabular-nums">{children}</div>
    </div>
  );
}

function StatusDot({ status, className }: { status: RowStatus | "savings"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        status === "over" && "bg-destructive",
        status === "ok" && "bg-success",
        status === "done" && "bg-muted-foreground",
        status === "idle" && "border-[1.5px] border-muted-foreground",
        status === "savings" && "rounded-[2px] bg-sky-600 dark:bg-sky-400",
        className,
      )}
    />
  );
}

/** The phone's stand-in for the bar: one ring per row keeps every line one line high. */
function Ring({
  value,
  status,
  className,
}: {
  value: number;
  status: RowStatus;
  className?: string;
}) {
  const c = 2 * Math.PI * 8;
  const p = status === "over" ? 1 : Math.max(0, Math.min(1, value));
  return (
    <svg viewBox="0 0 22 22" aria-hidden className={cn("h-[22px] w-[22px] shrink-0", className)}>
      <circle cx="11" cy="11" r="8" fill="none" strokeWidth="4" className="stroke-muted" />
      <circle
        cx="11"
        cy="11"
        r="8"
        fill="none"
        strokeWidth="4"
        strokeDasharray={`${p * c} ${c}`}
        transform="rotate(-90 11 11)"
        className={
          status === "over"
            ? "stroke-destructive"
            : status === "done"
              ? "stroke-muted-foreground"
              : "stroke-success"
        }
      />
    </svg>
  );
}

function IncomeBar({
  target,
  received,
  pending,
  className,
}: {
  target: number;
  received: number;
  pending: number;
  className?: string;
}) {
  const den = Math.max(target, received + pending, 1);
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      {received > 0 && (
        <div className="h-full bg-success" style={{ width: `${(received / den) * 100}%` }} />
      )}
      {pending > 0 && (
        <div className="h-full bg-success/45" style={{ width: `${(pending / den) * 100}%` }} />
      )}
    </div>
  );
}

function RowLine({
  row,
  open,
  onToggle,
  num,
  money,
}: {
  row: OverviewRow;
  open: boolean;
  onToggle: () => void;
  num: (n: number) => string;
  money: (n: number) => string;
}) {
  const { t: tr } = useI18n();
  let status: RowStatus | "savings";
  let ringValue = 0;
  let middle: React.ReactNode;
  let amount: React.ReactNode;
  let sub: React.ReactNode;

  const archived = row.type !== "savings" && !!row.archived;
  if (archived) {
    status = "idle";
    middle = null;
    amount = num(row.type === "income" ? row.received : row.spent);
    sub = tr(row.type === "income" ? "env.ov.archived_received" : "env.ov.archived_spent");
  } else if (row.type === "spend") {
    status = row.status;
    ringValue = row.available > 0 ? (row.spent + row.pending) / row.available : 0;
    middle = (
      <StackedBudgetBar
        className="h-1.5"
        allocated={row.available}
        committed={row.spent}
        pending={row.pending}
      />
    );
    amount =
      row.status === "over" ? (
        <span className="text-destructive">
          {tr("env.ov.over_amount", { x: num(row.remaining) })}
        </span>
      ) : row.status === "done" ? (
        <span className="text-muted-foreground">✓ {num(row.available)}</span>
      ) : (
        tr("env.ov.left_amount", { x: num(row.remaining) })
      );
    sub =
      row.rolling && Math.abs(row.carry) >= EPS
        ? tr("env.ov.of_carry", {
            x: num(row.allocated),
            sign: row.carry < 0 ? "−" : "+",
            c: num(row.carry),
          })
        : tr("env.ov.of", { x: num(row.allocated) });
  } else if (row.type === "income") {
    status = row.status === "idle" ? "idle" : "ok";
    ringValue =
      row.target > 0 ? (row.received + row.pending) / row.target : row.received > 0 ? 1 : 0;
    middle = <IncomeBar target={row.target} received={row.received} pending={row.pending} />;
    const projected = row.received + row.pending;
    amount =
      projected > row.target + EPS ? (
        <span className="text-success">
          {tr("env.ov.more", { x: num(projected - row.target) })}
        </span>
      ) : row.status === "done" ? (
        <span className="text-success">✓ {num(row.target)}</span>
      ) : (
        tr("env.ov.outstanding", { x: num(row.target - projected) })
      );
    sub = (
      <>
        {row.pending > EPS && `${tr("env.ov.pending_part", { x: num(row.pending) })} · `}
        {tr("env.ov.target", { x: num(row.target) })}
      </>
    );
  } else {
    status = "savings";
    middle = (
      <span
        className={cn(
          "text-xs tabular-nums",
          row.monthChange < -EPS ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {tr("env.ov.this_month", { x: signed(row.monthChange, num) })}
      </span>
    );
    amount = (
      <span className={cn(row.balance < -EPS && "text-destructive")}>{money(row.balance)}</span>
    );
    sub = tr("env.ov.per_month", { x: num(row.allocated) });
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 text-left hover:bg-muted/40",
        "sm:grid-cols-[10px_minmax(0,1fr)_minmax(4rem,1.2fr)_9.5rem]",
        open && "bg-muted/40 shadow-[inset_3px_0_0_var(--primary)]",
        archived && "opacity-60",
      )}
    >
      {status === "savings" ? (
        <>
          <StatusDot status="savings" className="hidden sm:inline-block" />
          <span
            aria-hidden
            className="h-3.5 w-3.5 justify-self-center rounded-[3px] bg-sky-600 sm:hidden dark:bg-sky-400"
          />
        </>
      ) : (
        <>
          <StatusDot status={status} className="hidden sm:inline-block" />
          <Ring value={ringValue} status={status} className="sm:hidden" />
        </>
      )}
      <span className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="truncate">{row.name}</span>
        {archived && (
          <span className="shrink-0 rounded border border-dashed px-1 text-[10px] leading-4">
            {tr("env.ov.archived")}
          </span>
        )}
        {row.type === "spend" && row.rolling && (
          <span
            title={tr("env.ov.rolls")}
            className="shrink-0 rounded border px-1 text-[10px] leading-4 text-muted-foreground"
          >
            ↻
          </span>
        )}
      </span>
      <span className="hidden sm:block">{middle}</span>
      <PrivacyValue className="text-right text-sm font-semibold tabular-nums">
        {amount}
        <span className="block text-[11px] font-normal text-muted-foreground">{sub}</span>
      </PrivacyValue>
    </button>
  );
}

function RowFigures({ row, money }: { row: OverviewRow; money: (n: number) => string }) {
  const { t: tr } = useI18n();
  const boxes: Array<{ label: string; value: string; tone?: "bad" | "good" }> = [];
  if (row.type !== "savings" && row.archived) {
    boxes.push(
      row.type === "income"
        ? { label: tr("env.ov.k_received"), value: money(row.received) }
        : { label: tr("env.ov.k_spent"), value: money(row.spent) },
    );
  } else if (row.type === "spend") {
    boxes.push({ label: tr("env.ov.k_planned"), value: money(row.allocated) });
    if (row.rolling && Math.abs(row.carry) >= EPS)
      boxes.push({
        label: tr("env.ov.k_carry"),
        value: money(row.carry),
        tone: row.carry < 0 ? "bad" : undefined,
      });
    boxes.push({
      label: row.pending > EPS ? tr("env.ov.k_spent_pending") : tr("env.ov.k_spent"),
      value: money(row.spent + row.pending),
      tone: row.status === "over" ? "bad" : undefined,
    });
    boxes.push(
      row.remaining < -EPS
        ? { label: tr("env.ov.k_over"), value: money(-row.remaining), tone: "bad" }
        : { label: tr("env.ov.k_left"), value: money(row.remaining) },
    );
  } else if (row.type === "income") {
    const projected = row.received + row.pending;
    boxes.push({ label: tr("env.ov.k_target"), value: money(row.target) });
    boxes.push({
      label: row.pending > EPS ? tr("env.ov.k_received_pending") : tr("env.ov.k_received"),
      value: money(projected),
    });
    boxes.push(
      projected > row.target + EPS
        ? { label: tr("env.ov.k_more"), value: money(projected - row.target), tone: "good" }
        : { label: tr("env.ov.k_outstanding"), value: money(row.target - projected) },
    );
  } else {
    boxes.push({
      label: tr("env.ov.k_balance"),
      value: money(row.balance),
      tone: row.balance < -EPS ? "bad" : undefined,
    });
    boxes.push({ label: tr("env.ov.k_alloc_month"), value: money(row.allocated) });
    boxes.push({
      label: tr("env.ov.k_month_change"),
      value: `${row.monthChange < -EPS ? "−" : "+"}${money(Math.abs(row.monthChange))}`,
      tone: row.monthChange < -EPS ? "bad" : undefined,
    });
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2">
      {boxes.map((b) => (
        <div key={b.label} className="rounded-md border bg-card px-2.5 py-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{b.label}</div>
          <PrivacyValue
            className={cn(
              "text-sm font-bold tabular-nums",
              b.tone === "bad" && "text-destructive",
              b.tone === "good" && "text-success",
            )}
          >
            {b.value}
          </PrivacyValue>
        </div>
      ))}
    </div>
  );
}

/**
 * Five months before this one and the month so far. Spending bars turn red above
 * that month's own plan; income bars below their target, except the month still
 * running; savings bars when more was taken out than put in.
 */
function HistoryChart({
  row,
  points,
  loading,
  month,
  locale,
  money,
  num,
}: {
  row: OverviewRow;
  points: HistoryPoint[] | undefined;
  loading: boolean;
  month: Date;
  locale?: DateFnsLocale;
  money: (n: number) => string;
  num: (n: number) => string;
}) {
  const { t: tr } = useI18n();
  if (!points) {
    return loading ? <Skeleton className="h-28 w-full" /> : null;
  }
  const current: HistoryPoint =
    row.type === "spend"
      ? { month: format(month, "yyyy-MM-01"), value: row.spent + row.pending, plan: row.allocated }
      : row.type === "income"
        ? {
            month: format(month, "yyyy-MM-01"),
            value: row.received + row.pending,
            plan: row.target,
          }
        : { month: format(month, "yyyy-MM-01"), value: row.monthChange, plan: null };
  const cols = [...points, current];
  const max = Math.max(1, ...cols.map((c) => Math.max(Math.abs(c.value), c.plan ?? 0))) * 1.25;
  const avg = historyAverage(points);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs">
        <span className="font-semibold">{tr("env.ov.last_months", { n: points.length })}</span>
        <PrivacyValue className="inline-flex items-center gap-1.5 tabular-nums text-muted-foreground">
          {tr("env.ov.avg", { x: money(avg) })}
          {row.type !== "savings" && (
            <>
              <span>·</span>
              <span className="inline-block w-3.5 border-t-2 border-dashed border-muted-foreground" />
              {tr("env.ov.budget_line")}
            </>
          )}
        </PrivacyValue>
      </div>
      <PrivacyValue className="block">
        <div className="mt-4 flex h-20 items-end gap-1.5 border-b">
          {cols.map((c, i) => {
            const last = i === cols.length - 1;
            const h = (Math.abs(c.value) / max) * 100;
            const planH = c.plan != null ? (c.plan / max) * 100 : null;
            const bad =
              row.type === "spend"
                ? c.plan != null && c.value > c.plan + EPS
                : row.type === "income"
                  ? !last && c.plan != null && c.value < c.plan - EPS
                  : c.value < -EPS;
            const tone = bad
              ? "bg-destructive"
              : row.type === "savings"
                ? "bg-sky-600 dark:bg-sky-400"
                : "bg-success";
            return (
              <div
                key={c.month}
                className="relative flex h-full flex-1 justify-center"
                title={`${num(c.value)}`}
              >
                <div
                  className={cn(
                    "absolute bottom-0 w-[70%] max-w-11 rounded-t-sm",
                    tone,
                    !last && "opacity-50",
                  )}
                  style={{ height: `${h}%` }}
                />
                {planH != null && (
                  <div
                    className="absolute w-[88%] max-w-14 border-t-2 border-dashed border-foreground/45"
                    style={{ bottom: `${planH}%` }}
                  />
                )}
                <span
                  className="absolute whitespace-nowrap text-[10px] tabular-nums text-muted-foreground"
                  style={{ bottom: `calc(${Math.max(h, planH ?? 0)}% + 3px)` }}
                >
                  {row.type === "savings" ? signed(c.value, num) : num(c.value)}
                </span>
              </div>
            );
          })}
        </div>
      </PrivacyValue>
      <div className="flex gap-1.5">
        {cols.map((c, i) => (
          <span
            key={c.month}
            className={cn(
              "flex-1 text-center text-[10px] text-muted-foreground",
              i === cols.length - 1 && "font-semibold text-foreground",
            )}
          >
            {i === cols.length - 1 && monthStatus(month) === "current"
              ? tr("env.ov.so_far", { m: format(parseISO(c.month), "MMM", { locale }) })
              : format(parseISO(c.month), "MMM", { locale })}
          </span>
        ))}
      </div>
    </div>
  );
}
