import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addMonths, format, parseISO } from "date-fns";
import type { Locale as DateFnsLocale } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import {
  fetchCategoryBudgetRange,
  fmtMoney,
  monthKey,
  setMonthBudgets,
  type BudgetScope,
} from "@/lib/finance";
import { invalidateBudgetQueries } from "@/lib/budgetQueries";
import { monthStatus } from "@/lib/month";
import type { OverviewGroup, OverviewRow } from "@/lib/budgetOverview";
import { historyAverage, type HistoryPoint } from "@/lib/budgetHistory";
import {
  isChange,
  overwrittenMonths,
  parseAmount,
  planBalance,
  type EditorField,
} from "@/lib/budgetEditor";

const EPS = 0.005;

function fieldOf(r: OverviewRow): EditorField {
  return {
    id: r.id,
    kind: r.type === "income" ? "income" : r.type === "savings" ? "savings" : "spend",
    amount: r.type === "income" ? r.target : r.allocated,
  };
}

/**
 * Every budget of one month in one panel, opened on the budget you came from.
 *
 * Changing one budget usually means taking the money from another, so the panel
 * shows the whole plan and how it balances against the income target while you
 * type. One switch decides whether the new amounts hold for this month only or
 * from now on; later months already planned differently are named before saving.
 */
export function MonthBudgetEditor({
  open,
  onOpenChange,
  month,
  focusId,
  groups,
  history,
  symbol,
  locale,
  onOpenGrid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: Date;
  /** The budget whose field gets the cursor; null opens on the first one. */
  focusId: string | null;
  groups: OverviewGroup[];
  history: Map<string, HistoryPoint[]> | undefined;
  symbol: string;
  locale?: DateFnsLocale;
  onOpenGrid: () => void;
}) {
  const { t: tr } = useI18n();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const m = monthKey(month);
  const status = monthStatus(month);
  const monthLabel = format(month, "MMMM yyyy", { locale });
  const monthShort = format(month, "MMMM", { locale });

  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [scope, setScope] = React.useState<BudgetScope>("forward");
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const inputs = React.useRef(new Map<string, HTMLInputElement>());

  // Fresh on every open, like the popover it replaces: a closed month's edit is
  // normally a one-off, a change to this month or a later one is the new plan.
  React.useEffect(() => {
    if (!open) return;
    setDraft({});
    setScope(status === "past" ? "month" : "forward");
    setConfirmDiscard(false);
  }, [open, status]);

  const laterQ = useQuery({
    queryKey: ["category_budget_range", "after", m],
    queryFn: () => fetchCategoryBudgetRange(monthKey(addMonths(month, 1)), "9999-12-01"),
    enabled: open,
  });

  const sections = React.useMemo(
    () =>
      groups
        .map((g) => ({
          key: g.key,
          name: g.name,
          kind: g.kind,
          // Archived budgets have no plan left to change.
          rows: g.rows.filter((r) => r.type === "savings" || !r.archived),
        }))
        .filter((g) => g.rows.length > 0),
    [groups],
  );
  const rows = React.useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const fields = React.useMemo(() => rows.map(fieldOf), [rows]);

  const valueOf = React.useCallback(
    (f: EditorField): number | null => (f.id in draft ? parseAmount(draft[f.id]) : f.amount),
    [draft],
  );
  const changed = fields.filter((f) => isChange(f.amount, valueOf(f)));
  const invalid = fields.some((f) => valueOf(f) === null);
  const balance = planBalance(fields, (f) => valueOf(f));
  const overwrites =
    scope === "forward"
      ? changed.reduce((n, f) => {
          const v = valueOf(f);
          return v === null ? n : n + overwrittenMonths(laterQ.data ?? [], f.id, m, v).length;
        }, 0)
      : 0;

  React.useEffect(() => {
    if (!open) return;
    // After the sheet's own focus handling and its slide-in.
    const h = window.setTimeout(() => {
      const el = (focusId && inputs.current.get(focusId)) || inputs.current.values().next().value;
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
      el.select();
    }, 60);
    return () => window.clearTimeout(h);
  }, [open, focusId]);

  const requestClose = () => {
    if (changed.length > 0 && !saving) setConfirmDiscard(true);
    else onOpenChange(false);
  };

  const save = async () => {
    if (!changed.length || invalid) return;
    setSaving(true);
    try {
      await setMonthBudgets(
        m,
        scope,
        changed.map((f) => ({ categoryId: f.id, amount: valueOf(f) as number })),
      );
      await invalidateBudgetQueries(qc);
      toast.success(
        tr(scope === "forward" ? "env.ed.saved_forward" : "env.ed.saved_month", {
          n: changed.length,
          month: monthShort,
        }),
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const money = (n: number) => fmtMoney(n, symbol);
  const num = (n: number) => fmtMoney(Math.abs(n), "").trim();
  const sectionLabel = (s: (typeof sections)[number]) => s.name ?? tr("env.group.expense");

  const hintFor = (r: OverviewRow, f: EditorField) => {
    const parts: React.ReactNode[] = [];
    const v = valueOf(f);
    if (r.type === "spend") {
      parts.push(tr("env.ed.spent", { x: num(r.spent + r.pending) }));
      if (r.rolling && Math.abs(r.carry) >= EPS)
        parts.push(tr("env.ed.carry", { x: `${r.carry < 0 ? "−" : "+"}${num(r.carry)}` }));
    } else if (r.type === "income") {
      parts.push(tr("env.ed.received", { x: num(r.received) }));
    } else {
      parts.push(tr("env.ed.balance", { x: money(r.balance) }));
    }
    const pts = history?.get(r.id);
    if (pts?.length) parts.push(tr("env.ed.avg", { x: num(historyAverage(pts)) }));
    if (v === null) {
      parts.push(<span className="text-destructive">{tr("env.ed.invalid")}</span>);
    } else {
      if (isChange(f.amount, v))
        parts.push(
          <span>
            {tr("env.ed.was")} <span className="line-through">{num(f.amount)}</span>
          </span>,
        );
      if (r.type === "spend") {
        const over = r.spent + r.pending - (v + r.carry);
        if (over > EPS)
          parts.push(
            <span className="text-destructive">{tr("env.ed.below", { x: num(over) })}</span>,
          );
      }
    }
    const later =
      scope === "forward" && v !== null && isChange(f.amount, v)
        ? overwrittenMonths(laterQ.data ?? [], f.id, m, v)
        : [];
    return (
      <>
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            {i > 0 && " · "}
            {p}
          </React.Fragment>
        ))}
        {later.length > 0 && (
          <span className="block text-warning">
            {tr("env.ed.overwrites", {
              list: later
                .map((c) => `${format(parseISO(c.month), "MMM yy", { locale })} (${num(c.amount)})`)
                .join(", "),
            })}
          </span>
        )}
      </>
    );
  };

  const fieldIds = fields.map((f) => f.id);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) onOpenChange(true);
        else requestClose();
      }}
    >
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "h-[92dvh] rounded-t-xl" : "w-full sm:max-w-md",
        )}
      >
        <SheetHeader className="space-y-3 border-b px-4 pb-3 pt-4 text-left">
          <SheetTitle className="pr-8">{tr("env.ed.title", { month: monthLabel })}</SheetTitle>
          <SheetDescription className="sr-only">{tr("env.ed.description")}</SheetDescription>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup
              type="single"
              value={scope}
              onValueChange={(v) => {
                if (v) setScope(v as BudgetScope);
              }}
              variant="outline"
              size="sm"
              aria-label={tr("budget.edit.scope")}
            >
              <ToggleGroupItem value="forward" className="px-2.5 text-xs">
                {tr("budget.edit.scope.forward")}
              </ToggleGroupItem>
              <ToggleGroupItem value="month" className="px-2.5 text-xs">
                {tr("budget.edit.scope.month", { month: monthShort })}
              </ToggleGroupItem>
            </ToggleGroup>
            <button
              type="button"
              onClick={onOpenGrid}
              className="hidden text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground sm:inline"
            >
              {tr("env.ed.to_grid")}
            </button>
          </div>
          {status === "past" && (
            <p className="rounded-md bg-warning/10 p-2 text-[11px] leading-snug text-muted-foreground">
              {tr("budget.edit.past_warning")}
            </p>
          )}
          <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 rounded-md bg-muted px-3 py-2 text-sm tabular-nums">
            <span>{tr("env.ed.income_target")}</span>
            <span className="text-right">{money(balance.income)}</span>
            <span>− {tr("env.ed.spend_planned")}</span>
            <span className="text-right">{money(balance.spend)}</span>
            <span>− {tr("env.ed.savings_planned")}</span>
            <span className="text-right">{money(balance.savings)}</span>
            <span className="mt-1 border-t pt-1 font-semibold">
              {balance.free < -EPS ? tr("env.ed.overplanned") : tr("env.ed.free")}
            </span>
            <span
              className={cn(
                "mt-1 border-t pt-1 text-right font-semibold",
                balance.free < -EPS && "text-destructive",
              )}
            >
              {money(balance.free)}
            </span>
            <span className="col-span-2 text-[11px] text-muted-foreground">
              {balance.free < -EPS
                ? tr("env.ed.hint_over")
                : Math.abs(balance.free) < EPS
                  ? tr("env.ed.hint_even")
                  : tr("env.ed.hint_free")}
            </span>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {sections.map((s) => (
            <section key={s.key} className="pt-3">
              <h3 className="flex justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>{sectionLabel(s)}</span>
                <span className="tabular-nums">
                  {money(
                    s.rows.reduce((sum, r) => sum + (valueOf(fieldOf(r)) ?? fieldOf(r).amount), 0),
                  )}
                </span>
              </h3>
              <ul>
                {s.rows.map((r) => {
                  const f = fieldOf(r);
                  const isChanged = isChange(f.amount, valueOf(f));
                  return (
                    <li
                      key={r.id}
                      className={cn(
                        "-mx-2 grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-x-3 rounded-md px-2 py-1.5",
                        isChanged && "bg-primary/5",
                        r.id === focusId && "shadow-[inset_3px_0_0_var(--primary)]",
                      )}
                    >
                      <label htmlFor={`budget-${r.id}`} className="min-w-0">
                        <span className="block truncate text-sm">{r.name}</span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">
                          {hintFor(r, f)}
                        </span>
                      </label>
                      <Input
                        id={`budget-${r.id}`}
                        ref={(el) => {
                          if (el) inputs.current.set(r.id, el);
                          else inputs.current.delete(r.id);
                        }}
                        inputMode="decimal"
                        aria-invalid={valueOf(f) === null}
                        className={cn(
                          "h-9 text-right tabular-nums",
                          isChanged && "border-primary/60",
                          valueOf(f) === null && "border-destructive",
                        )}
                        value={r.id in draft ? draft[r.id] : f.amount.toFixed(2)}
                        onChange={(e) => {
                          setConfirmDiscard(false);
                          setDraft((d) => ({ ...d, [r.id]: e.target.value }));
                        }}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={() => {
                          const v = r.id in draft ? parseAmount(draft[r.id]) : null;
                          if (v !== null) setDraft((d) => ({ ...d, [r.id]: v.toFixed(2) }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          if (e.metaKey || e.ctrlKey) {
                            void save();
                            return;
                          }
                          const next = fieldIds[fieldIds.indexOf(r.id) + 1];
                          const el = next ? inputs.current.get(next) : null;
                          el?.focus();
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {confirmDiscard && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-destructive/10 px-4 py-2.5 text-sm">
            <span>{tr("env.ed.discard_q", { n: changed.length })}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(false)}>
                {tr("env.ed.keep")}
              </Button>
              <Button size="sm" variant="destructive" onClick={() => onOpenChange(false)}>
                {tr("env.ed.discard")}
              </Button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <span className="text-xs text-muted-foreground">
            {changed.length === 0
              ? tr("env.ed.none")
              : tr(scope === "forward" ? "env.ed.count_forward" : "env.ed.count_month", {
                  n: changed.length,
                  month: monthShort,
                })}
            {overwrites > 0 && (
              <span className="text-warning">
                {" "}
                · {tr("env.ed.overwrites_total", { n: overwrites })}
              </span>
            )}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" onClick={requestClose} disabled={saving}>
              {tr("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={saving || !changed.length || invalid}
            >
              {changed.length ? tr("env.ed.save_n", { n: changed.length }) : tr("common.save")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
