---
title: "Screens"
description: "One section per main screen in the app. Dashboard (/): Transactions (/transactions): Add (/add): Envelopes (/envelopes)"
sidebar:
  icon: layout-dashboard
---

## Dashboard (/) [#dashboard]

Your home screen. Shows account balances grouped into Assets and Liabilities, monthly budget summary, open IOUs, pending confirmations, upcoming recurring posts, top transactions of the month, a daily spend heatmap, and a trend strip. Each card is a quick jump-off to the related screen.

## Transactions (/transactions) [#transactions-transactions]

The full transaction list. Filter by date, account, category, type, scope or tag. The amount filter supports operators like `>100`, `<=50`, `10-30` or `=42`. Tap a row to edit or delete.

## Add (/add) [#add-add]

The form to record a new transaction. Pick type (expense / income / transfer), amount, date, account and category. Optional fields: counterparty, scope, tags, attachments, notes, and the *reimbursable* flag for IOUs. Smart suggestions pre-fill based on past entries.

## Envelopes (/envelopes) [#envelopes-envelopes]

Your monthly budget view. Each envelope shows planned vs spent vs remaining. Use *Reallocate* to move budget between envelopes, and configure rollover and sweep targets in **Settings → Savings & sweeps**.

## Insights (/insights) [#insights-insights]

Analytics in four tabs:
- **Overview** — totals and net flow for the chosen period.
- **Breakdown** — spending by category / group.
- **Trends** — month-over-month evolution.
- **Projection** — extrapolation based on recurring rules and recent averages.
Use the period picker at the top to switch month / quarter / year / custom.

## Pending (/pending) [#pending-pending]

Four tabs:
- **Pending** — imported entries waiting for you to confirm or reject. Not yet booked.
- **Open IOUs** — booked transactions you flagged as reimbursable that aren't settled yet.
- **Rejected** — entries you rejected, kept for audit, restorable.
- **Confirmed** — entries you already confirmed, shown for traceability. The real transaction lives in Transactions.

## Reconcile (/reconcile) [#reconcile-reconcile]

Breaks your account total down into the envelopes holding it: rolling envelopes, this month's remainder on monthly envelopes, income not yet received, money you are owed, and anything unallocated. The last line is what none of those explain — it should read zero. If it does not, something is genuinely unaccounted for.

## Scopes (/scopes) [#scopes-scopes]

Create, edit and switch your scopes (trips, projects, shared households). The active scope is shown as a chip in the header and influences the dashboard, the add-form, and category defaults.

## Settings (/settings) [#settings-settings]

All configuration:
- **Accounts** — your real-world accounts.
- **Categories & envelopes** — what you spend on and your monthly plan.
- **Savings & sweeps** — where leftover budget goes at month-end.
- **Recurring rules** — auto-posting transactions.
- **API tokens** — for the public REST API.
- **Nextcloud** — connect cloud storage for attachments.
- **Audit log** — recent changes.
- **Export / import** — move your data in or out (also useful for self-hosting).

