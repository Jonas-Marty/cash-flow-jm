---
title: "FAQ & troubleshooting"
description: "Answers on reconciling, skipped recurring occurrences and reallocations — including why a reallocation deliberately leaves the monthly budget alone."
sidebar:
  icon: help-circle
---

## An IOU I closed was open again after reload [#an-iou-i-marked-as-settled-came-back-after-reload]

This was a known bug and is now fixed: the UI only confirms success if the database actually updated. If it still happens, take note of the transaction id and check whether the row is reachable for your user (RLS / scope).

## Why is the last line on Reconcile not zero? [#why-is-my-reconciliation-drift-not-zero]

The Reconcile screen breaks your account total down into the envelopes holding it. The last line is whatever none of them explain, and it should read zero. When it does not, there is usually money in your accounts that no envelope owns yet: opening balances you have not assigned in Settings, or transactions with no category. Check those two first.

## Where do skipped recurring occurrences go? [#where-do-skipped-recurring-occurrences-go]

Nowhere — they are simply not posted. The recurring rule continues with the next scheduled date. You can always post an occurrence later from the Upcoming card.

## Do reallocations affect a category's monthly budget? [#do-reallocations-affect-a-category-s-monthly-budget]

**No.** A reallocation only moves money between **savings** category balances (their running totals). The monthly envelope view (`Envelopes` / budget summary) is computed purely from real `transactions` rows — it ignores `category_reallocations` entirely.

**What this means in practice:**
- Moving CHF 100 from *Holiday Savings* → *Emergency Fund* changes both savings balances. No monthly envelope is touched.
- Closing a scope inserts a reallocation from the **funding** category → the **scope's own** category. For that reallocation to actually move a balance, the funding category must be a **savings** category (running balance). If the funding category is a regular monthly envelope, the reallocation row is still written, but the funding envelope's *spent this month* total will not change — the original transactions you booked during the scope still hit whichever categories you picked at booking time.
- **Rule of thumb:** treat scopes as a *savings → savings* movement. Fund them from a savings envelope (e.g. *Fun Money Pot*, *Travel Pot*), and the scope's own category will receive the final reallocated total.

## Could reallocations be made to affect monthly budgets too? [#could-reallocations-be-made-to-affect-monthly-budgets-too]

Technically yes, but it would change the meaning of an envelope. Today an envelope answers *"how much did I actually spend in this category this month?"* — purely from transactions, which keeps it auditable against a bank statement.

If reallocations were folded in, an envelope would instead answer *"how much budget did this category end up with after manual adjustments?"* That introduces three side-effects to weigh:
- **Double counting risk.** A scope close already redistributes via a reallocation; if envelopes also reacted to it, the same CHF would appear twice in reports unless every aggregation explicitly subtracts the reallocation leg.
- **Historical drift.** Editing a reallocation would silently rewrite past months' budget figures.
- **Insights & projection.** Trends, projections and the budget-balance card would all need to choose between *cash-flow truth* (transactions only) and *planned-vs-adjusted truth* (transactions + reallocations).

For now Cashflow deliberately keeps the two layers separate: **transactions** drive monthly envelopes, **reallocations** drive savings balances and scope closing.

