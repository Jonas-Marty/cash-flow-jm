---
title: "Screens"
description: "What each main screen shows and what you use it for — from the dashboard through Envelopes to Reconcile and Settings."
sidebar:
  icon: layout-dashboard
---

## Dashboard (/) [#dashboard]

Your home screen. Shows account balances grouped into Assets and Liabilities, monthly budget summary, open IOUs (grouped by person), pending confirmations, upcoming recurring posts, top transactions of the month, a daily spend heatmap, and a trend strip. Each card is a quick jump-off to the related screen.

## Transactions (/transactions) [#transactions-transactions]

The full transaction list. Filter by date, account, category, type, scope or tag. The amount filter supports operators like `>100`, `<=50`, `10-30` or `=42`. Tap a row to edit or delete.

Transfers between your accounts are marked in the table: *Transfer* stands where the budget would be, the account column shows source → destination, and when a different amount arrived on the destination account (in another currency, say) it is shown next to the amount.

## Add (/add) [#add-add]

The form to record a new transaction. Pick type (expense / income / transfer), amount, date, account and category. Optional fields: counterparty, scope, tags, attachments, notes, and the *reimbursable* flag for IOUs. Smart suggestions pre-fill based on past entries.

## Envelopes (/envelopes) [#envelopes-envelopes]

Your monthly budget view, compact enough to see at a glance where you stand against the plan. The arrows step through months, and the month name opens a picker. Configure rollover and sweep targets in **Settings → Savings & sweeps**.

**At the top** are four figures:
- **Spent, monthly budgets** — spent (including recurring bookings still due) out of planned, for envelopes without rollover only.
- **Left** — what is still left on those envelopes. Rolling envelopes (↻) are left out on purpose: money saved up over months for one bill would otherwise show as "left" every month.
- **Status** — how many envelopes are **over**, or *all on plan*.
- **Income** — received out of expected.

Below them, one bar shows the whole month. When the plan does not balance — the budgets hand out less or more than the income target — the difference is stated underneath: it ends up in, or is missing from, *Unallocated*.

**Each envelope is one line** in its group (income first, then the order from Settings): the status on the left, the bar in the middle, on the right what is left or how far it is over. A group turns red as soon as one envelope in it is over, and green when all are used up. On a phone, a ring replaces the bar.
- A rolling envelope reads *of plan ± carry-over ↻*: what earlier months left (or overspent) counts too.
- Savings envelopes show no bar, but their balance and this month's change.
- A **pending** badge marks recurring bookings still due this month. They already count as spent, so you see an overrun before it happens. Entries in the *Pending* inbox (from FinReader, say) do not count.
- An **archived** envelope shows faded, marked *archived*, only in months where it has bookings. It shows what was booked and counts in no total.

**Tap a line** to open it — several can be open at once. You see the envelope's figures, a chart of the last five months (each with the budget that applied then as a dashed line, refunds netted) and every entry of the month. Below are **Change budget**, **Reallocate** (only on rolling and savings envelopes), **History** and **All bookings**.

**Change budget** — or *Edit ‹month› budget* under the month's bar — opens a side panel (from the bottom on a phone) with **every budget of the month**, the cursor in the envelope you came from. It works in any month, including one that has already ended.
- At the top you choose once for all changes: **This month and later** or **Only ‹month›**. When "This month and later" would overwrite later months already planned differently, the field says so (*overwrites Dec 26 (320.00)*).
- The balance above it updates as you type: Income (target) − spending − savings = *Not planned* or *Overplanned*.
- Under each field: spent or received so far, the carry-over, the average of the last five months and the old value. A new budget below what is already spent is shown in red.
- **Enter** moves to the next field, **⌘/Ctrl + Enter** saves. All changes are saved together. Closing with unsaved changes asks first.
- For several months in one pass, the **Open year view** link leads to the table view (see below).

On a wide screen you can switch to the **table view** from the top right: envelopes down, twelve months across. It shows what an envelope has done over the year and lets you plan several months in one pass.

- **Enter** saves that one month; **⌘/Ctrl + Enter** carries the value to the right edge.
- The **arrow** in a column heading carries that whole month into every later month. This is how you set up January and everything after it while it is still December.
- Hovering either arrow previews the change: every affected cell shows its old value struck through next to the new one.
- The **left arrow**, in the column just before the oldest month, creates that one month from the oldest month's values — extending your history backwards a step at a time. This has consequences too: the new month has already ended, so its sweep is computed and every savings balance since shifts.
- The **eraser** removes budgets again. On a past month it removes that one and every earlier month — this is how you get rid of budgets created too early by accident. On a future month it removes just that one. A single month in the middle of the past cannot be removed: the next load refills it, because a month with no amount counts as neither an allocation nor towards sweeping.
- Clicking a **month name** selects it — the figures above the table follow your selection, and `<` and `>` move it without leaving the table.

Each of these can be undone — from the **Undo** button above the table, for as long as the page stays open.

Figures with a dotted underline are **not decided yet**: nothing is stored for that month, and the number shows what it would inherit from the month before. They edit like any other cell. A future month only counts towards the projection once you have set it.

*Balances as of* sets the date the balances are read at. It follows the month you are viewing: a past month reads at its last day, the current month reads today, and a future month reads as a **projection** to its end. You can always set a date of your own.

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
- **Open IOUs** — booked transactions you flagged as reimbursable that aren't settled yet, grouped by person, largest open amount first. When someone owes you several entries, **All paid back** records one repayment for all of them.
- **Rejected** — entries you rejected, kept for audit, restorable.
- **Confirmed** — entries you already confirmed, shown for traceability. The real transaction lives in Transactions.

In the table under *Pending* you tick rows and confirm or reject them in one go; the **check mark** on a row (*Confirm* on a phone) confirms just that one, and **Edit** opens it in the booking form, to split it for example. A place you set can be removed with the small **×** on the place icon.

Description and remarks suggest what you have used before as you type, like the Add form: earlier descriptions, and after `#` your tags.

## Reconcile (/reconcile) [#reconcile-reconcile]

Breaks your account total down into the envelopes holding it: rolling envelopes, this month's remainder on monthly envelopes, income not yet received, money you are owed, and anything unallocated. The last line is what none of those explain — it should read zero. If it does not, something is genuinely unaccounted for.

## Scopes (/scopes) [#scopes-scopes]

Create, edit and switch your scopes (trips, projects, shared households). The active scope is shown as a chip in the header and influences the dashboard, the add-form, and category defaults.

## Settings (/settings) [#settings-settings]

All configuration:
- **Accounts** — your real-world accounts.
- **Categories & envelopes** — what you spend on and your monthly plan. It has its own month stepper: the amounts belong to the month you pick. When an envelope has bookings or a budget in the current month, **archiving** it asks first: it leaves the budget overview and the month editor, its bookings stay, and this month's budget is still settled at month end as before.
- **Savings & sweeps** — where leftover budget goes at month-end.
- **Recurring rules** — auto-posting transactions.
- **API tokens** — for the public REST API.
- **Nextcloud** — connect cloud storage for attachments.
- **AI assistant** — connections to a model of your own, and which task is bound to which.
- **AI activity log** — every request to your provider, with previews of what was sent.
- **Webhooks** — notify an external address whenever a transaction is created.
- **Integrations** — sign-in through an OIDC provider.
- **Linked accounts** — the sign-in methods on your account.
- **Capture location** — the switch for location data; off by default.
- **Audit log** — recent changes.
- **Export / import** — move your data in or out (also useful for self-hosting).
- **About** — which version and commit is running.

