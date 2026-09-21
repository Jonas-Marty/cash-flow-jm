import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, isSameMonth } from "date-fns";
import type { Locale } from "date-fns";
import { ArrowLeftToLine, ArrowRight, ChevronsRight, Eraser, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { invalidateBudgetQueries } from "@/lib/budgetQueries";
import { monthStatus } from "@/lib/month";
import {
  fmtMoney,
  monthKey,
  setCategoryBudgetsBulk,
  type BudgetEdit,
  type Category,
  type CategoryBudgetCell,
  type CategoryGroup,
} from "@/lib/finance";
import {
  buildGridGroups,
  cellId,
  isBudgetChange,
  needsBulkWrite,
  previewValueFor,
  resolveCells,
  type GridPreview,
  type PreviewOutcome,
  type ResolvedCell,
} from "@/lib/budgetGrid";

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
 * cells are marked with a dotted underline rather than greyed out — they are perfectly
 * editable, and greying them read as disabled.
 */
export function BudgetGrid({
  months,
  selectedMonth,
  onSelectMonth,
  categories,
  groups,
  stored,
  symbol,
  locale,
}: {
  months: Date[];
  selectedMonth: Date;
  onSelectMonth: (m: Date) => void;
  categories: Category[];
  groups: CategoryGroup[];
  stored: CategoryBudgetCell[];
  symbol: string;
  locale?: Locale;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState<GridPreview | null>(null);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const gridGroups = React.useMemo(() => buildGridGroups(categories, groups), [categories, groups]);
  const visible = React.useMemo(() => gridGroups.flatMap((g) => g.rows), [gridGroups]);
  const monthKeys = React.useMemo(() => months.map(monthKey), [months]);
  const resolved = React.useMemo(
    () => resolveCells(visible, stored, months),
    [visible, stored, months],
  );
  /**
   * Exactly what the database holds, keyed per cell.
   *
   * `resolved` covers only the visible window and conflates inherited with stored, so
   * it cannot describe how to put back a row older than the leftmost column — which
   * trimming history does touch.
   */
  const storedByCell = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const cell of stored) m.set(cellId(cell.category_id, cell.month), cell.amount);
    return m;
  }, [stored]);

  const selectedCol = months.findIndex((m) => isSameMonth(m, selectedMonth));

  /**
   * The first month anything is stored for.
   *
   * `ensure_month_budgets` backfills from each envelope's own earliest row, so this
   * is the floor of the whole ledger: nothing before it is created automatically,
   * and extending backwards means moving it one month at a time.
   */
  const earliestStored = React.useMemo(
    () => stored.reduce<string | null>((min, c) => (min === null || c.month < min ? c.month : min), null),
    [stored],
  );

  // Open on the month you are actually working in. Without this the table opens on its
  // left edge, a year ago, which is never what you wanted to look at.
  const scrolledFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    const target = monthKeys[selectedCol >= 0 ? selectedCol : months.length - 1];
    if (!target || scrolledFor.current === target) return;
    scrolledFor.current = target;
    const header = gridRef.current?.querySelector<HTMLElement>(`[data-month-header="${target}"]`);
    const box = scrollRef.current;
    if (!header || !box) return;
    // Scroll the container only — scrollIntoView would drag the whole page with it.
    box.scrollLeft = Math.max(0, header.offsetLeft + header.offsetWidth - box.clientWidth);
  }, [monthKeys, selectedCol, months.length]);

  /**
   * Every applied batch, newest last, each holding the payload that puts it back.
   *
   * A ref rather than state for the list itself: the toast action captures `apply`'s
   * closure, and a stale copy of the array would undo the wrong entry. The counter
   * exists only so the toolbar re-renders.
   */
  const undoRef = React.useRef<Array<{ edits: BudgetEdit[]; label: string }>>([]);
  const [undoDepth, setUndoDepth] = React.useState(0);

  const runUndo = React.useCallback(async () => {
    const top = undoRef.current[undoRef.current.length - 1];
    if (!top) return;
    setBusy(true);
    try {
      await setCategoryBudgetsBulk(top.edits);
      await invalidateBudgetQueries(qc);
      undoRef.current.pop();
      setUndoDepth(undoRef.current.length);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [qc]);

  /**
   * Applies a batch and remembers how to reverse it.
   *
   * The undo payload restores each touched cell to exactly what it was — including
   * `amount: null` for cells that held no row, because writing back the value they
   * happened to inherit would decide a month the user had left undecided.
   *
   * Undo used to live only in the toast, so it expired after a few seconds and a
   * mis-drag became permanent the moment you looked away. The toast still offers it,
   * but it is now a shortcut to a stack that stays for the session.
   */
  const apply = React.useCallback(
    async (edits: BudgetEdit[], label: string) => {
      if (!edits.length) return;
      const undo: BudgetEdit[] = edits.map((e) => {
        const key = cellId(e.categoryId, e.month);
        // `null` restores "no row". Writing back a value the cell merely inherited
        // would decide a month the user had left undecided.
        return { categoryId: e.categoryId, month: e.month, amount: storedByCell.get(key) ?? null };
      });

      setBusy(true);
      try {
        await setCategoryBudgetsBulk(edits);
        await invalidateBudgetQueries(qc);
        // Bounded: this is a safety net for the last few actions, not a history.
        undoRef.current = [...undoRef.current.slice(-24), { edits: undo, label }];
        setUndoDepth(undoRef.current.length);
        toast.success(label, {
          action: { label: t("common.undo"), onClick: () => void runUndo() },
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [qc, storedByCell, t, runUndo],
  );

  const parse = (raw: string): number | null => {
    const n = Number(raw.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const commitCell = (categoryId: string, month: string, raw: string) => {
    const next = parse(raw);
    if (next === null) {
      toast.error(t("budget.edit.invalid"));
      return false;
    }
    // Unchanged is unchanged, whether or not a row exists. Writing here on every blur
    // meant tabbing across the table silently materialised months nobody had decided.
    if (!isBudgetChange(resolved.get(cellId(categoryId, month)), next)) return false;
    void apply([{ categoryId, month, amount: next }], t("budget.grid.saved"));
    return true;
  };

  /** That value, from this month to the right edge of the window. */
  const fillRight = (categoryId: string, month: string, raw: string) => {
    const next = parse(raw);
    if (next === null) {
      toast.error(t("budget.edit.invalid"));
      return;
    }
    const from = monthKeys.indexOf(month);
    if (from < 0) return;
    const edits = monthKeys
      .slice(from)
      .filter((mk) => needsBulkWrite(resolved.get(cellId(categoryId, mk)), next))
      .map((mk) => ({ categoryId, month: mk, amount: next }));
    if (!edits.length) {
      toast.info(t("budget.grid.copy_nothing"));
      return;
    }
    void apply(edits, t("budget.grid.filled", { n: edits.length }));
  };

  /** Every envelope in this column, carried to every later column. */
  const fillColumnRight = (index: number) => {
    const edits: BudgetEdit[] = [];
    for (const c of visible) {
      const src = resolved.get(cellId(c.id, monthKeys[index]));
      if (!src) continue;
      for (const mk of monthKeys.slice(index + 1)) {
        if (!needsBulkWrite(resolved.get(cellId(c.id, mk)), src.amount)) continue;
        edits.push({ categoryId: c.id, month: mk, amount: src.amount });
      }
    }
    if (!edits.length) {
      toast.info(t("budget.grid.copy_nothing"));
      return;
    }
    void apply(edits, t("budget.grid.filled_month", { n: edits.length }));
  };

  /**
   * Removes stored rows, putting those months back to undecided.
   *
   * Only two shapes of this actually stick, and the UI offers only those:
   *
   *  - **trim** (`through`) — this month and every earlier one. `ensure_month_budgets`
   *    backfills from each envelope's *earliest* row, so deleting the oldest months
   *    moves that starting point forward and they stay gone. This is the one that
   *    undoes budgets created before you started using the app.
   *  - **a future month** — the backfill stops at the current month, so it never
   *    comes back.
   *
   * An interior past month cannot be cleared: it would be a gap before today, and the
   * next load refills it. That is deliberate — a month with no row contributes no
   * allocation and no sweep, so gaps in elapsed months are a correctness bug.
   */
  const clearMonths = (index: number, through: boolean) => {
    const cutoff = monthKeys[index];
    // Straight from `stored`, not `resolved`: trimming reaches rows older than the
    // leftmost visible column, and only stored rows can be removed at all.
    const edits: BudgetEdit[] = stored
      .filter((cell) => (through ? cell.month <= cutoff : cell.month === cutoff))
      .map((cell) => ({ categoryId: cell.category_id, month: cell.month, amount: null }));
    if (!edits.length) {
      toast.info(t("budget.grid.clear_nothing"));
      return;
    }
    void apply(edits, t("budget.grid.cleared", { n: edits.length }));
  };

  /**
   * Creates the month immediately before the earliest stored one, from its values.
   *
   * The mirror of trimming, and deliberately one month per click: each new month is
   * in the past, so it is not a blank slate — its sweep gets computed and every
   * savings balance since moves. Doing several at once would hide that.
   *
   * Every visible envelope gets a row, including any whose own history starts later.
   * A month where only some envelopes have budgets is a state the model does not
   * otherwise produce, and it would sweep as though the others were planned at zero.
   */
  const extendBack = (index: number) => {
    const source = monthKeys[index + 1];
    if (!source) return;
    const edits: BudgetEdit[] = [];
    for (const c of visible) {
      const from = resolved.get(cellId(c.id, source));
      if (!from) continue;
      edits.push({ categoryId: c.id, month: monthKeys[index], amount: from.amount });
    }
    if (!edits.length) {
      toast.info(t("budget.grid.copy_nothing"));
      return;
    }
    void apply(edits, t("budget.grid.extended", { n: edits.length }));
  };

  /** Re-sync one column from the one to its left. */
  const copyColumn = (index: number) => {
    if (index === 0) return;
    const target = monthKeys[index];
    const source = monthKeys[index - 1];
    const edits: BudgetEdit[] = [];
    for (const c of visible) {
      const from = resolved.get(cellId(c.id, source));
      if (!from) continue;
      if (!needsBulkWrite(resolved.get(cellId(c.id, target)), from.amount)) continue;
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

  const template = `minmax(9rem, 1.4fr) repeat(${months.length}, minmax(7rem, 1fr))`;
  let rowIndex = -1;

  const lastLabel = undoRef.current[undoRef.current.length - 1]?.label ?? "";

  return (
    <div className="space-y-2">
      {undoDepth > 0 && (
        <div className="flex items-center justify-end">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void runUndo()}>
            <Undo2 className="mr-1 h-3.5 w-3.5" />
            {t("budget.grid.undo_last", { what: lastLabel })}
          </Button>
        </div>
      )}
      <div ref={scrollRef} className="overflow-x-auto rounded-md border">
      <div ref={gridRef} className="min-w-max">
        <div
          className="sticky top-0 z-20 grid border-b bg-background"
          style={{ gridTemplateColumns: template }}
        >
          <div className="sticky left-0 z-10 bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
            {t("budget.grid.envelope")}
          </div>
          {months.map((m, i) => {
            const label = format(m, "MMMM yyyy", { locale });
            return (
              // A div, not a button: the actions below are buttons, and a button
              // inside a button is invalid HTML that breaks hydration. The month
              // label carries the selection instead.
              <div
                key={monthKeys[i]}
                data-month-header={monthKeys[i]}
                className={cn(
                  "px-2 py-2 text-right text-xs transition-colors",
                  i === selectedCol && "bg-accent/50 font-semibold text-foreground",
                )}
              >
                <div className="flex items-center justify-end gap-0.5">
                  {i > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="h-5 w-5 p-0 opacity-40 hover:opacity-100"
                      title={t("budget.grid.copy_previous_tip", {
                        month: label,
                        prev: format(months[i - 1], "MMMM", { locale }),
                      })}
                      onMouseEnter={() => setPreview({ kind: "copy", fromCol: i })}
                      onMouseLeave={() => setPreview(null)}
                      onClick={() => { setPreview(null); copyColumn(i); }}
                    >
                      {/* Points right because the *data* moves right: the previous month's values
                          land in this one. Rotated left, it read as "scroll back". */}
                      <ChevronsRight className="h-3 w-3" />
                    </Button>
                  )}
                  {i < months.length - 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="h-5 w-5 p-0 opacity-40 hover:opacity-100"
                      title={t("budget.grid.fill_month_tip", { month: label })}
                      onMouseEnter={() => setPreview({ kind: "fill", fromCol: i })}
                      onMouseLeave={() => setPreview(null)}
                      onClick={() => { setPreview(null); fillColumnRight(i); }}
                    >
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  )}
                  {/* Offered only where a deletion survives the next load: trimming
                      the oldest months, or clearing a month that has not happened. */}
                  {earliestStored !== null && monthKeys[i + 1] === earliestStored && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      className="h-5 w-5 p-0 opacity-40 hover:opacity-100"
                      title={t("budget.grid.extend_tip", {
                        month: label,
                        source: format(months[i + 1], "MMMM yyyy", { locale }),
                      })}
                      onMouseEnter={() => setPreview({ kind: "back", fromCol: i })}
                      onMouseLeave={() => setPreview(null)}
                      onClick={() => { setPreview(null); extendBack(i); }}
                    >
                      <ArrowLeftToLine className="h-3 w-3" />
                    </Button>
                  )}
                  {(() => {
                    const future = monthStatus(m) === "future";
                    const through = !future;
                    // Nothing to erase is worth showing rather than discovering by
                    // clicking: a disabled button says so before you press it.
                    const erasable = stored.some((cell) =>
                      through ? cell.month <= monthKeys[i] : cell.month === monthKeys[i],
                    );
                    return (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || !erasable}
                        className={cn(
                          "h-5 w-5 p-0 opacity-40",
                          erasable ? "hover:text-destructive hover:opacity-100" : "opacity-15",
                        )}
                        title={
                          future
                            ? t("budget.grid.clear_month_tip", { month: label })
                            : t("budget.grid.trim_tip", { month: label })
                        }
                        onMouseEnter={() => setPreview({ kind: "clear", fromCol: i, through })}
                        onMouseLeave={() => setPreview(null)}
                        onClick={() => { setPreview(null); clearMonths(i, through); }}
                      >
                        <Eraser className="h-3 w-3" />
                      </Button>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => onSelectMonth(m)}
                    aria-label={t("budget.grid.select_month", { month: label })}
                    className="rounded px-1 hover:bg-accent/40"
                  >
                    {format(m, "MMM", { locale })}
                  </button>
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
            <div className="grid border-b bg-muted/40" style={{ gridTemplateColumns: template }}>
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
                      cell={resolved.get(cellId(c.id, mk))}
                      previewValue={previewValueFor(preview, c.id, col, monthKeys, resolved)}
                      symbol={symbol}
                      selected={col === selectedCol}
                      disabled={busy}
                      fillTip={t("budget.grid.fill_row_tip", {
                        month: format(months[col], "MMMM", { locale }),
                      })}
                      onCommit={(raw) => commitCell(c.id, mk, raw)}
                      onFillRight={(raw) => fillRight(c.id, mk, raw)}
                      onPreviewFill={(v) =>
                        setPreview(v === null ? null : { kind: "row", categoryId: c.id, fromCol: col, value: v })
                      }
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
    </div>
  );
}

function GridCell({
  row,
  col,
  cell,
  previewValue,
  symbol,
  selected,
  disabled,
  fillTip,
  onCommit,
  onFillRight,
  onPreviewFill,
  onMove,
}: {
  row: number;
  col: number;
  cell: ResolvedCell | undefined;
  previewValue: PreviewOutcome | null;
  symbol: string;
  selected: boolean;
  disabled: boolean;
  fillTip: string;
  onCommit: (raw: string) => boolean;
  onFillRight: (raw: string) => void;
  onPreviewFill: (value: number | null) => void;
  onMove: (row: number, col: number) => void;
}) {
  const amount = cell?.amount ?? 0;
  const inherited = cell?.inherited ?? true;
  const [draft, setDraft] = React.useState(() => String(amount));
  const [focused, setFocused] = React.useState(false);
  /**
   * A fill already wrote this cell, so the blur that follows must not write it again.
   *
   * Applying a batch sets `busy`, which disables the inputs, which blurs whichever
   * one had focus — so filling right fired a second, redundant write for the source
   * cell, with its own undo entry and its own audit row.
   */
  const filledRef = React.useRef(false);

  React.useEffect(() => {
    if (!focused) setDraft(String(amount));
  }, [amount, focused]);

  const clearing = previewValue === "clear";
  const changes =
    previewValue !== null &&
    (clearing || Math.abs((previewValue as number) - amount) >= 0.005);

  return (
    <div
      className={cn(
        "relative border-l px-1 py-0.5",
        selected && "bg-accent/25",
        previewValue !== null && (changes ? "bg-primary/10" : "bg-muted/40"),
      )}
    >
      <input
        data-row={row}
        data-col={col}
        inputMode="decimal"
        disabled={disabled}
        value={draft}
        title={fmtMoney(amount, symbol)}
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false);
          onPreviewFill(null);
          if (filledRef.current) { filledRef.current = false; return; }
          if (!onCommit(draft)) setDraft(String(amount));
        }}
        onKeyDown={(e) => {
          // Enter commits this cell; Cmd/Ctrl+Enter carries it to the right edge —
          // the same two scopes the popover offers, as the same two gestures.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            filledRef.current = true;
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
          // Undecided: nothing is stored for this month and the figure is what it would
          // inherit. Marked, not dimmed — the cell is as editable as any other.
          inherited && "underline decoration-dotted decoration-muted-foreground/50 underline-offset-4",
        )}
      />

      {/* What this cell becomes if the hovered action is taken. */}
      {previewValue !== null && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-end gap-1 rounded-sm bg-background/95 px-1 text-[11px] tabular-nums">
          {!changes ? (
            <span className="text-muted-foreground">{amount}</span>
          ) : clearing ? (
            <span className="text-destructive line-through">{amount}</span>
          ) : (
            <>
              <span className="text-destructive line-through">{amount}</span>
              <span className="font-medium italic text-success">{previewValue}</span>
            </>
          )}
        </div>
      )}

      {/* Rendered on focus alone, never on preview state: gating this on
          `previewValue === null` made the button unmount the instant hovering it set
          the preview, so its own onMouseLeave never fired — the preview stuck, and
          the button could not be clicked at all. A hover target must not be able to
          remove itself in response to being hovered. */}
      {focused && (
        <button
          type="button"
          tabIndex={-1}
          title={fillTip}
          className="absolute -right-1 top-1/2 z-10 -translate-y-1/2 rounded bg-primary p-0.5 text-primary-foreground shadow"
          onMouseEnter={() => {
            const n = Number(draft.replace(",", "."));
            onPreviewFill(Number.isFinite(n) ? n : null);
          }}
          onMouseLeave={() => onPreviewFill(null)}
          onMouseDown={(e) => { e.preventDefault(); onPreviewFill(null); filledRef.current = true; onFillRight(draft); }}
        >
          <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
