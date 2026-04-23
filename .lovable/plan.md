
# Monthly budget history, category groups, savings envelopes — final plan

## Business rules

**Account** = where money physically sits (Bank, Cash, Migros Cumulus credit card).
**Category / Envelope** = what the money is mentally earmarked for. Three flavours, defined by the parent group's `kind`:

| Flavour | Group `kind` | Behaviour | Variance semantics |
|---|---|---|---|
| **Income** | `income` | Tracks earnings; allocated = expected monthly income. "Received" = income transactions assigned to it for that month. | **Under budget** = received < expected (red). **Over budget** = received > expected (green, positive). |
| **Expense** (regular) | `expense` | Resets monthly. `spent = expenses − reimbursements` for the month. | Over budget = spent > allocated (red). |
| **Savings / Rückstellung** | `savings` | Accumulates across months. Balance = Σ(allocations to date) − Σ(all bookings). Bookings excluded from monthly expense totals and over-budget logic. | Headline = current available balance; negative = under-saved. |

**Booking a savings expense (e.g. SBB GA on Migros Cumulus)**: same Add Transaction screen — Account = Migros Cumulus, Category = Bahnabos. The savings flavour is a property of the category set in Settings; entry UX is identical.

**Monthly budget history**: budgets stored per `(category_id, month)` in `category_budgets`. Editing the current month overwrites only that month's row; past months stay frozen. On first access of a new month, the most recent prior allocation is copied forward (idempotent SQL function `ensure_month_budgets`).

## Schema changes

```text
category_groups(id, name, kind ENUM('income','expense','savings'), sort_order, archived, created_at, updated_at, user_id)
categories: + group_id (nullable FK → category_groups), is_savings (bool, default false)
category_budgets(category_id FK, month DATE /* day=1 */, amount NUMERIC,
                 PRIMARY KEY(category_id, month), created_at, updated_at)
```

New SQL:
- `ensure_month_budgets(p_month DATE)` — copies most-recent prior `category_budgets` row per active category into `p_month` if missing; falls back to `categories.allocated_budget` when no history. Idempotent.
- Replace `category_month_spending` view with function `category_month_spending(p_month DATE)` returning `category_id, name, group_id, kind, is_savings, allocated, spent_or_received, variance` for the month. For income categories, `spent_or_received` sums income transactions; variance = received − allocated (positive = over, negative = under). For expense categories, variance = allocated − spent (positive = remaining, negative = over).
- View `category_savings_balance(category_id, name, allocated_total, spent_total, balance)` summing all-time allocations minus all-time bookings for `is_savings = true` categories.

Backfill: insert one `category_budgets` row per existing category for the current month using the current `allocated_budget`. The `allocated_budget` column stays as template/default for new categories.

## UI changes

**Settings**:
- **Groups** card: CRUD + reorder + `kind` selector (income/expense/savings).
- **Categories** card: add Group dropdown per category; the group's kind drives savings/income behaviour.
- **Monthly budgets** card: month picker; per-category editable amount for current/future months; past months read-only with a "View history" mini-list per category.

**Dashboard**:
- Envelopes section grouped by `category_groups`, ordered by `sort_order`, with subtotals per group.
- **Income groups**: each row shows received vs. expected with a colored delta (green if over, red if under). Group subtotal: total received vs. total expected.
- **Expense groups**: existing progress-bar treatment with green→amber→red.
- **Savings groups**: each card shows **Balance available** as the headline (no progress bar) plus small print "this month: allocated X / spent Y".

**Envelopes page**: month picker drives `category_month_spending(month)`; sections by group; income sections use the income variance treatment; savings sections show all-time balance alongside the month view.

**Add Transaction**: unchanged; small "Rückstellung" / "Income" badge in the category dropdown so the picked envelope flavour is visible.

## Architecture document

Create `architecture.md` at repo root covering:
1. Overview & milestone scope
2. Domain model with ascii ERD (accounts, category_groups, categories, category_budgets, transactions, transaction_tags, settings)
3. Business rules: each transaction type's effect on accounts and categories; reimbursement; savings envelope; income variance; monthly reset & rollover-of-allocation
4. SQL views & functions (`account_balances`, `category_month_spending(month)`, `category_savings_balance`, `ensure_month_budgets`, `sync_transaction_tags`, `update_updated_at_column`)
5. UI route map
6. Future-auth note (nullable `user_id` columns, Keycloak plug-in path)
7. Change log — first dated entry = this iteration (groups, monthly budget history, savings envelopes, income variance)

Going forward, `architecture.md` is updated in the same change set as any feature/design change.

## Out of scope this round

Editing past-month budgets from UI (read-only history); auto-transferring savings to a real account; multi-currency; recurring transactions.
