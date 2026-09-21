import { addMonths, startOfMonth } from "date-fns";
import { monthKey, type Category, type CategoryBudgetCell, type CategoryGroup, type GroupKind } from "@/lib/finance";

/**
 * The flavour an envelope actually behaves as.
 *
 * `rolls_over` wins over the parent group's `kind`, and a non-rolling envelope in a
 * savings-flavoured group still resets monthly. Kept in one place because several
 * callers previously derived it independently and could disagree.
 */
export function effectiveKind(
  c: Pick<Category, "rolls_over" | "group_id">,
  groupKindById: Map<string, GroupKind>,
): GroupKind {
  if (c.rolls_over) return "savings";
  const kind = (c.group_id && groupKindById.get(c.group_id)) || "expense";
  return kind === "savings" ? "expense" : kind;
}

export interface GridGroup {
  key: string;
  name: string;
  kind: GroupKind;
  rows: Category[];
}

/**
 * The grid's rows, grouped and ordered the way the card view groups them.
 *
 * Scopes and archived envelopes are excluded: scopes are funded from their funding
 * envelope at close and have no monthly budget at all, which is also why the RPC
 * refuses them.
 */
export function buildGridGroups(categories: Category[], groups: CategoryGroup[]): GridGroup[] {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupKindById = new Map(groups.map((g) => [g.id, g.kind]));

  const map = new Map<string, GridGroup>();
  for (const c of categories) {
    if (c.archived || c.is_scope) continue;
    const kind = effectiveKind(c, groupKindById);
    const key = c.group_id ?? `__${kind}__`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: c.group_id ? (groupById.get(c.group_id)?.name ?? "") : kind,
        kind: c.group_id ? (groupById.get(c.group_id)?.kind ?? kind) : kind,
        rows: [],
      });
    }
    map.get(key)!.rows.push(c);
  }

  // Ungrouped buckets sort last; named groups keep their configured order.
  const groupOrder = (g: GridGroup) =>
    g.key.startsWith("__") ? Number.MAX_SAFE_INTEGER : (groupById.get(g.key)?.sort_order ?? 0);

  const out = [...map.values()];
  for (const g of out) g.rows.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  out.sort((a, b) => groupOrder(a) - groupOrder(b) || a.name.localeCompare(b.name));
  return out;
}

/** `count` consecutive months ending at `end` inclusive, oldest first. */
export function monthWindow(end: Date, count: number): Date[] {
  const last = startOfMonth(end);
  return Array.from({ length: count }, (_, i) => addMonths(last, i - (count - 1)));
}

export interface ResolvedCell {
  amount: number;
  /**
   * True when no row exists for this month and the figure shown is what the month
   * *would* inherit. Nothing has been decided and nothing has been written. The grid
   * marks these with a dotted underline — showing the figure so a blank is never read
   * as zero, but not dimming it, which read as "you cannot edit this".
   */
  inherited: boolean;
}

/** Key for the resolved-cell map. Uuid and `YYYY-MM-01` both exclude `|`. */
export const cellId = (categoryId: string, month: string) => `${categoryId}|${month}`;

/**
 * Every visible cell, resolved against the copy-forward rule the database uses.
 *
 * `ensure_month_budgets` seeds a month from the nearest *prior* row, falling back to
 * `categories.allocated_budget`. This mirrors that exactly, so what the grid shows for
 * an undecided month is what the database would produce if the month were seeded.
 *
 * `stored` must include rows from before the window, otherwise a month whose nearest
 * prior row is older than the first column would fall back to the template and show a
 * number the database would never produce.
 */
export function resolveCells(
  categories: Category[],
  stored: CategoryBudgetCell[],
  months: Date[],
): Map<string, ResolvedCell> {
  const byCategory = new Map<string, CategoryBudgetCell[]>();
  for (const cell of stored) {
    const list = byCategory.get(cell.category_id);
    if (list) list.push(cell);
    else byCategory.set(cell.category_id, [cell]);
  }
  for (const list of byCategory.values()) list.sort((a, b) => a.month.localeCompare(b.month));

  const keys = months.map(monthKey);
  const out = new Map<string, ResolvedCell>();

  for (const c of categories) {
    const list = byCategory.get(c.id) ?? [];
    let i = 0;
    let carried = Number(c.allocated_budget) || 0;

    for (const key of keys) {
      // Advance through every stored row at or before this month; the last one wins.
      let exact = false;
      while (i < list.length && list[i].month <= key) {
        carried = list[i].amount;
        exact = list[i].month === key;
        i++;
      }
      out.set(cellId(c.id, key), { amount: carried, inherited: !exact });
    }
  }
  return out;
}

/**
 * Whether committing `next` into a cell is actually a change worth writing.
 *
 * Deliberately ignores whether a row exists. Focusing a cell and tabbing away is not
 * a decision, and treating an undecided cell as always-dirty meant moving across the
 * table silently materialised every month it touched — complete with a toast claiming
 * the budget had been updated.
 */
export function isBudgetChange(before: ResolvedCell | undefined, next: number): boolean {
  if (!before) return true;
  return Math.abs(before.amount - next) >= 0.005;
}

/**
 * Whether a *bulk* fill should write this cell.
 *
 * Unlike a single commit, filling right exists precisely to decide undecided months,
 * so an inherited cell is written even when the number does not change — that is the
 * difference between "this month happens to inherit 600" and "this month is 600".
 */
export function needsBulkWrite(before: ResolvedCell | undefined, next: number): boolean {
  if (!before || before.inherited) return true;
  return Math.abs(before.amount - next) >= 0.005;
}

/** Which cells a hovered bulk action would change, and to what. */
export type GridPreview =
  | { kind: "row"; categoryId: string; fromCol: number; value: number }
  | { kind: "fill"; fromCol: number }
  | { kind: "copy"; fromCol: number }
  /** Remove stored rows: `through` clears this month and every earlier one. */
  | { kind: "clear"; fromCol: number; through: boolean }
  /** Create this month from the one to its right — extending history backwards. */
  | { kind: "back"; fromCol: number };

/** `"clear"` means the cell loses its row and goes back to undecided. */
export type PreviewOutcome = number | "clear";

/**
 * The value a cell would take if the hovered action were taken; `null` if untouched.
 *
 * `row`  — one envelope, from `fromCol` rightwards, inclusive.
 * `fill` — every envelope, strictly right of `fromCol`, taking that column's value.
 * `copy` — every envelope, `fromCol` only, taking the column to its left.
 */
export function previewValueFor(
  preview: GridPreview | null,
  categoryId: string,
  col: number,
  monthKeys: string[],
  resolved: Map<string, ResolvedCell>,
): PreviewOutcome | null {
  if (!preview) return null;
  if (preview.kind === "clear") {
    const hit = preview.through ? col <= preview.fromCol : col === preview.fromCol;
    if (!hit) return null;
    // Only a stored row can be removed; an undecided cell is already clear.
    return resolved.get(cellId(categoryId, monthKeys[col]))?.inherited === false ? "clear" : null;
  }
  if (preview.kind === "row") {
    if (preview.categoryId !== categoryId || col < preview.fromCol) return null;
    return preview.value;
  }
  if (preview.kind === "fill") {
    if (col <= preview.fromCol) return null;
    return resolved.get(cellId(categoryId, monthKeys[preview.fromCol]))?.amount ?? null;
  }
  if (preview.kind === "back") {
    if (col !== preview.fromCol || preview.fromCol + 1 >= monthKeys.length) return null;
    return resolved.get(cellId(categoryId, monthKeys[preview.fromCol + 1]))?.amount ?? null;
  }
  if (col !== preview.fromCol || preview.fromCol === 0) return null;
  return resolved.get(cellId(categoryId, monthKeys[preview.fromCol - 1]))?.amount ?? null;
}
