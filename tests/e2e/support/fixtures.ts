import { USER_ID } from "./stub";

/**
 * A small, deterministic ledger.
 *
 * Months are relative to whenever the suite runs, because the grid's window ends at
 * the current month — pinning absolute dates would make these tests expire.
 */

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

export const NOW = startOfMonth(new Date());
/** `0` is the current month, `-1` last month, `+1` next month. */
export const month = (offset: number) => monthKey(addMonths(NOW, offset));

export const GROUPS = [
  { id: "g-income", name: "Einnahmen", kind: "income", sort_order: 0, archived: false },
  { id: "g-fixed", name: "Fixkosten", kind: "expense", sort_order: 1, archived: false },
];

const category = (
  id: string,
  name: string,
  group_id: string,
  allocated_budget: number,
  sort_order: number,
) => ({
  id,
  user_id: USER_ID,
  name,
  group_id,
  allocated_budget,
  sort_order,
  archived: false,
  is_scope: false,
  rolls_over: false,
  opening_balance: 0,
  icon: null,
  emoji: null,
  image_url: null,
  color: null,
  pinned: false,
  pin_order: null,
  sweep_target_category_id: null,
});

export const CATEGORIES = [
  category("c-salary", "Lohn", "g-income", 7000, 0),
  category("c-rent", "Miete", "g-fixed", 1200, 1),
  category("c-food", "Lebensmittel", "g-fixed", 600, 2),
];

/**
 * Stored budgets for the current month and the two before it only.
 *
 * Everything further back is therefore *undecided* in the grid — which is exactly
 * the state the phantom-save bug corrupted, so the suite needs both kinds on screen.
 */
export const BUDGETS = CATEGORIES.flatMap((c) =>
  [-2, -1, 0].map((offset) => ({
    category_id: c.id,
    month: month(offset),
    amount: c.allocated_budget,
  })),
);

export const SETTINGS = [
  {
    id: "s-1",
    user_id: USER_ID,
    currency_code: "CHF",
    currency_symbol: "CHF",
    language: "en",
    created_at: "2026-01-01T00:00:00Z",
    capture_location: false,
    default_sweep_category_id: null,
  },
];

const monthRow = (c: (typeof CATEGORIES)[number]) => ({
  category_id: c.id,
  name: c.name,
  group_id: c.group_id,
  group_name: GROUPS.find((g) => g.id === c.group_id)?.name ?? null,
  kind: c.group_id === "g-income" ? "income" : "expense",
  rolls_over: false,
  is_scope: false,
  sort_order: c.sort_order,
  group_sort_order: GROUPS.find((g) => g.id === c.group_id)?.sort_order ?? 0,
  allocated: c.allocated_budget,
  spent_or_received: 0,
  variance: c.allocated_budget,
});

export const DEFAULT_FIXTURES = {
  tables: {
    categories: CATEGORIES,
    category_groups: GROUPS,
    category_budgets: BUDGETS,
    settings: SETTINGS,
    accounts: [],
    transactions: [],
    recurring_occurrences: [],
    category_reallocations: [],
  },
  rpc: {
    ensure_month_budgets: null,
    category_month_spending: CATEGORIES.map(monthRow),
    category_savings_balance: [],
    envelope_reconciliation: [],
    set_category_budgets_bulk: 1,
    set_category_budget: null,
  },
};
