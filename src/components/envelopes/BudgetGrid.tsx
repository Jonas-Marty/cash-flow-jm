import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, isSameMonth } from "date-fns";
import type { Locale } from "date-fns";
import { ArrowRight, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import {
  fmtMoney,
  monthKey,
  setCategoryBudgetsBulk,
  type BudgetEdit,
  type Category,
  type CategoryBudgetCell,
  type CategoryGroup,
} from "@/lib/finance";
import { buildGridGroups, cellId, resolveCells, type ResolvedCell } from "@/lib/budgetGrid";
import { monthStatus } from "@/lib/month";

/**
 * Budgets as a category × month grid.
 *
 * The card view answers "how is this month going"; this answers the two questions it
 * structurally cannot — "what has this envelope done all year" and "set the next six
 * months at once". Both are desk work, which is why this is the wide view and the
 * cards stay the default on a phone.
 *
 * Nothing here calls `ensure_month_budgets`. A month with no stored row is *undecided*,
 * and opening a twelve-column grid must not quietly decide a year of them. Undecided
 * cells show the value they would inherit, greyed — a blank would be read as zero.
 */
export function BudgetGrid({
  months,
  selectedMonth,
  categories,
  groups,
  stored,
  symbol,
  locale,
}: {
  months: Date[];
  selectedMonth: Date;
  categories: Category[];
  groups: CategoryGroup[];
  stored: CategoryBudgetCell[];
  symbol: string;
  locale?: Locale;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const gridRef = React.useRef<HTMLDivElement>(null);

  const gridGroups = React.useMemo(() => buildGridGroups(categories, groups), [categories, groups]);
  const visible = React.useMemo(() => gridGroups.flatMap((g) => g.rows), [gridGroups]);
  const monthKeys = React.useMemo(() => months.map(monthKey), [months]);
  const resolved = React.useMemo(
    () => resolveCells(visible, stored, months),
    [visible, stored, months],
  );

  /**
   * Applies a batch and offers undo.
   *
   * The undo payload restores each touched cell to exactly what it was — including
   * `amount: null` for cells that held no row, because writing back the value they
   * happened to inherit would decide a month the user had left undecided.
   */
  const apply = React.useCallback(
    async (edits: BudgetEdit[], label: string) => {
      if (!edits.length) return;
      const undo: BudgetEdit[] = edits.map((e) => {
        const before = resolved.get(cellId(e.categoryId, e.month));
        return {
          categoryId: e.categoryId,
          month: e.month,
          amount: before && !before.inherited ? before.amount : null,
        };
      });

      setBusy(true);
      try {
        await setCategoryBudgetsBulk(edits);
        await qc.invalidateQueries();
        toast.success(label, {
          action: {
            label: t("common.undo"),
            onClick: () => {
              void (async () => {
                try {
                  await setCategoryBudgetsBulk(undo);
                  await qc.invalidateQueries();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : String(e));
                }
              })();
            },
          },
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [qc, resolved, t],
  );

  const commitCell = (categoryId: string, month: string, raw: string) => {
    const next = Number(raw.replace(",", "."));
    if (!Number.isFinite(next)) {
      toast.error(t("budget.edit.invalid"));
      return false;
    }
    const before = resolved.get(cellId(categoryId, month));
    if (before && !before.inherited && Math.abs(before.amount - next) < 0.005) return false;
    void apply([{ categoryId, month, amount: next }], t("budget.grid.saved"));
    return true;
  };

  /** That value, from this month to the right edge of the window. */
  const fillRight = (categoryId: string, month: string, raw: string) => {
    const next = Number(raw.replace(",", "."));
    if (!Number.isFinite(next)) {
      toast.error(t("budget.edit.invalid"));
      return;
    }
    const from = monthKeys.indexOf(month);
    if (from < 0) return;
    const edits = monthKeys.slice(from).map((mk) => ({ categoryId, month: mk, amount: next }));
    void apply(edits, t("budget.grid.filled", { n: edits.length }));
  };

  /** Re-sync a whole column from the one to its left. */
  const copyColumn = (index: number) => {
    if (index === 0) return;
    const target = monthKeys[index];
    const source = monthKeys[index - 1];
    const edits: BudgetEdit[] = [];
    for (const c of visible) {
      const from = resolved.get(cellId(c.id, source));
      const to = resolved.get(cellId(c.id, target));
      if (!from) continue;
      if (to && !to.inherited && Math.abs(to.amount - from.amount) < 0.005) continue;
      edits.push({ categoryId: c.id, month: target, amount: from.amount });
    }
    if (!edits.length) {
      toast.info(t("budget.grid.copy_nothing"));
      return;
    }
    void apply(edits, t("budget.grid.copied", { n: edits.length }));
  };

  /** Arrow keys move between cells; the browser already handles Tab. */
  const moveFocus = (row: number, col: number) => {
    const next = gridRef.current?.querySelector<HTMLInputElement>(
      `input[data-row="${row}"][data-col="${col}"]`,
    );
    next?.focus();
    next?.select();
  };

  const template = `minmax(9rem, 1.4fr) repeat(${months.length}, minmax(5.5rem, 1fr))`;
  let rowIndex = -1;

  return (
    <div className="overflow-x-auto rounded-md border">
      <div ref={gridRef} className="min-w-max">
        {/* Header: months, with today and the selected month marked. */}
        <div
          className="sticky top-0 z-20 grid border-b bg-background"
          style={{ gridTemplateColumns: template }}
        >
          <div className="sticky left-0 z-10 bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
            {t("budget.grid.envelope")}
          </div>
          {months.map((m, i) => {
            const status = monthStatus(m);
            return (
              <div
                key={monthKeys[i]}
                className={cn(
                  "px-2 py-2 text-right text-xs",
                  status === "past" && "text-muted-foreground",
                  isSameMonth(m, selectedMonth) && "bg-accent/40 font-semibold text-foreground",
                )}
              >
                <div className="flex items-center justify-end gap-1">
                  {i > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="h-5 w-5 p-0 opacity-50 hover:opacity-100"
                      title={t("budget.grid.copy_previous", {
                        month: format(m, "MMMM", { locale }),
                      })}
                      aria-label={t("budget.grid.copy_previous", {
                        month: format(m, "MMMM", { locale }),
                      })}
                      onClick={() => copyColumn(i)}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  )}
                  <span>{format(m, "MMM", { locale })}</span>
                </div>
                <div className="text-[10px] tabular-nums text-muted-foreground">
                  {format(m, "yyyy")}
                </div>
              </div>
            );
          })}
        </div>

        {gridGroups.map((g) => (
          <div key={g.key}>
            <div
              className="grid border-b bg-muted/40"
              style={{ gridTemplateColumns: template }}
            >
              <div className="sticky left-0 z-10 bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.key.startsWith("__") ? t(`env.group.${g.kind}`) : g.name}
              </div>
              <div style={{ gridColumn: `span ${months.length}` }} />
            </div>

            {g.rows.map((c) => {
              rowIndex += 1;
              const r = rowIndex;
              return (
                <div
                  key={c.id}
                  className="grid border-b last:border-b-0 hover:bg-accent/20"
                  style={{ gridTemplateColumns: template }}
                >
                  <div className="sticky left-0 z-10 truncate bg-background px-3 py-1 text-sm">
                    {c.name}
                  </div>
                  {monthKeys.map((mk, col) => (
                    <GridCell
                      key={mk}
                      row={r}
                      col={col}
                      month={months[col]}
                      cell={resolved.get(cellId(c.id, mk))}
                      symbol={symbol}
                      selected={isSameMonth(months[col], selectedMonth)}
                      disabled={busy}
                      onCommit={(raw) => commitCell(c.id, mk, raw)}
                      onFillRight={(raw) => fillRight(c.id, mk, raw)}
                      onMove={moveFocus}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function GridCell({
  row,
  col,
  month,
  cell,
  symbol,
  selected,
  disabled,
  onCommit,
  onFillRight,
  onMove,
}: {
  row: number;
  col: number;
  month: Date;
  cell: ResolvedCell | undefined;
  symbol: string;
  selected: boolean;
  disabled: boolean;
  onCommit: (raw: string) => boolean;
  onFillRight: (raw: string) => void;
  onMove: (row: number, col: number) => void;
}) {
  const amount = cell?.amount ?? 0;
  const inherited = cell?.inherited ?? true;
  const [draft, setDraft] = React.useState(() => String(amount));
  const [focused, setFocused] = React.useState(false);

  // Follow the resolved value whenever it changes underneath and we are not editing.
  React.useEffect(() => {
    if (!focused) setDraft(String(amount));
  }, [amount, focused]);

  const status = monthStatus(month);

  return (
    <div
      className={cn(
        "relative border-l px-1 py-0.5",
        selected && "bg-accent/30",
        status === "past" && "bg-muted/20",
      )}
    >
      <input
        data-row={row}
        data-col={col}
        inputMode="decimal"
        disabled={disabled}
        value={draft}
        title={
          inherited
            ? `${fmtMoney(amount, symbol)} — ${format(month, "MMMM yyyy")}`
            : fmtMoney(amount, symbol)
        }
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setFocused(false); if (!onCommit(draft)) setDraft(String(amount)); }}
        onKeyDown={(e) => {
          // Enter commits this cell; Cmd/Ctrl+Enter carries it to the right edge —
          // the same two scopes the popover offers, as the same two gestures.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onFillRight(draft);
            return;
          }
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); return; }
          if (e.key === "Escape") { e.preventDefault(); setDraft(String(amount)); e.currentTarget.blur(); return; }
          if (e.key === "ArrowUp") { e.preventDefault(); onMove(row - 1, col); return; }
          if (e.key === "ArrowDown") { e.preventDefault(); onMove(row + 1, col); return; }
        }}
        className={cn(
          "w-full bg-transparent px-1 py-1 text-right text-sm tabular-nums outline-none",
          "focus:rounded-sm focus:ring-2 focus:ring-ring",
          // Undecided: shown so the month is not read as zero, greyed so it is not
          // read as a decision either.
          inherited && "italic text-muted-foreground/60",
        )}
      />
      {focused && (
        <button
          type="button"
          tabIndex={-1}
          title="⌘/Ctrl + Enter"
          className="absolute -right-1 top-1/2 z-10 -translate-y-1/2 rounded bg-primary p-0.5 text-primary-foreground shadow"
          onMouseDown={(e) => { e.preventDefault(); onFillRight(draft); }}
        >
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
