---
title: Core concepts
description: >-
  Accounts, envelopes, scopes, IOUs and sweeps — the building blocks of the
  budget, each with a worked example in francs.
sidebar:
  icon: book-open
---
Think of it like a set of envelopes, a notebook, and a filing cabinet — just digital.

## Account [#account]

A real-world container for money: a bank account, cash wallet, credit card, or savings pot. Every transaction belongs to exactly one account (transfers belong to two).

**Example:** You might have *UBS Checking*, *PostFinance Savings*, *Cash in Wallet*, and *Visa Credit Card*. When you buy groceries with your Visa, the transaction is recorded against the *Visa Credit Card* account. When you withdraw cash from an ATM, that is a transfer from *UBS Checking* to *Cash in Wallet*.

**Opening balance sign:** The same sign convention applies to every account, whether asset or liability:
- **Positive** = money you own (e.g. cash in a bank account, prepaid card balance).
- **Negative** = money you owe (e.g. debt on a credit card, outstanding loan).

**Example — new credit card:** You open a Visa account in the app but have already spent CHF 500 with it before tracking. Enter the opening balance as **-500**. The balance shows *-CHF 500.00* ("I owe 500"). New expenses make it more negative; a payment from your bank makes it less negative. If you entered *+500* instead, the app would treat the card like a prepaid wallet with money in it, and your net worth would be off by CHF 1,000. The same rule applies to mortgages, personal loans, and any other liability — start negative if you currently owe money.

## Transaction [#transaction]

A single movement of money: an expense, income, or transfer. Has a date, amount, account, category and optional tags, attachments and notes.

**Example:** On 5 June you spend CHF 64.50 at Migros using your debit card. That is an **expense** of 64.50, on account *UBS Checking*, in category *Groceries*. On 30 June your employer pays your salary of CHF 5,200 — that is an **income** transaction on account *UBS Checking*, category *Salary*. Moving CHF 200 from checking to savings is a **transfer**.

## Category [#category]

What the money was for (Groceries, Salary, Rent…). Categories are grouped, and most categories represent a monthly *envelope* you can budget.

**Example:** You create categories like *Groceries*, *Restaurant*, *Coffee*, *Rent*, *Electricity*, *Salary*, and *Holiday Savings*. When you record a purchase, you pick the category so the app knows which envelope to draw from. A reimbursement from a friend goes into a category too — but you might leave the category empty so it does not affect your budget.

## Category group [#category-group]

A bucket that groups related categories (e.g. *Food* contains Groceries, Eating out, Coffee). Used in reports and for shared sweep settings.

**Example:** Your *Food* group holds *Groceries*, *Restaurant*, and *Coffee*. Your *Fixed Costs* group holds *Rent*, *Insurance*, and *Phone*. When you look at the Insights Breakdown tab, you can see totals per group — which quickly tells you whether you spend more on food or fixed costs.

## Envelope / budget [#envelope-budget]

The monthly amount you plan to spend in a category. The Envelopes screen shows how much is left in each envelope for the current month.

Every month has its own amount. A new month inherits the previous month's figure, and you can change **any month, past ones included**. When you change one, you choose whether it applies to that month alone or to that month and everything after it.

If you have not opened the app for a while, **every skipped month is filled in**: away from late July until early December, August through December each get July's figure. This is not just tidiness — a month with no amount counts as neither an allocation nor towards sweeping, which would leave your savings envelopes reading short.

**Example:** You decide to budget CHF 400 for *Groceries* in June. The envelope starts with 400. After you spend 120 at Migros, the envelope shows 280 left. If you later spend 50 at the bakery, it drops to 230. If you receive a CHF 30 reimbursement for a shared dinner (linked to an IOU), the envelope grows back to 260 — because you got some of that grocery money back.

At month-end a per-category switch, **Rolls over**, decides what happens to the remainder: with it off, whatever is left (or the shortfall) sweeps into your savings category and the envelope starts fresh. With it on, the balance stays put and keeps accumulating. Both kinds are allocated every month.

## Scope [#scope]

A lens that pre-filters and pre-fills the app — for example a trip, a project, or a shared household. Switching the active scope changes the dashboard, transaction list and add-form defaults.

**What it is really for:** A scope is meant for **one-off events** (a vacation, a music festival, a wedding) where you want to collect all related expenses in one place and then **close** it with a single visible money reallocation. When you close a scope, the total spent is virtually moved from a funding category into the scope's own category — so you see the whole cost in one transparent "payment."

**What it is NOT for:** Regular monthly expenses. Do not create a scope for *Groceries* or *Restaurant* — those belong in normal budget categories with monthly envelopes.

**Example:** You create a scope called *Glastonbury 2025* with a planned budget of CHF 1,200, funded from your *Fun* category. During the festival you record tickets, camping gear, food and drinks — all tagged with the scope. When you get home, you close the scope: the app moves CHF 1,180 (what you actually spent) from *Fun* into *Glastonbury 2025*. Now you see the entire festival cost as one line, and your *Fun* envelope was reduced accordingly. Then you switch back to the default scope and your normal household budget returns.

## IOU / reimbursable [#iou-reimbursable]

A transaction flagged because someone owes you (or you owe someone). Open IOUs stay visible until you close them — by recording repayments until the amount is covered, by writing the rest off, or by cancelling.

**Example:** You pay CHF 120 for a team dinner with your credit card and your colleague owes you half. You record the expense as CHF 120, toggle **Reimbursable**, enter *Colleague Anna* as counterparty. The full 120 hits your *Restaurant* budget, but an open IOU of 60 shows up on your dashboard. When Anna pays you back via TWINT, you record a repayment — the IOU closes and your *Restaurant* envelope gets credited back 60.

## Pending transaction [#pending-transaction]

An entry imported from outside the app (via the public API or another source) that has not yet been booked. You review it and then confirm or reject.

**Example:** FinReader reads your bank's payment notification on your phone and sends it to the app: *Coop, CHF 45.30, 12 June*. It lands in **Pending** because the app does not know which category it belongs to. You open it, assign *Groceries*, and click **Confirm**. Now it becomes a real transaction in your ledger.

## Recurring rule [#recurring-rule]

A template that posts a transaction on a schedule (rent, salary, subscriptions). You can skip, edit or post individual occurrences.

**Example:** Your rent of CHF 1,450 is due on the 1st of every month. You set up a recurring rule: amount 1,450, category *Rent*, account *UBS Checking*, day-of-month = 1. The dashboard shows the next upcoming occurrence. If you are on holiday and the landlord delays the debit until the 5th, you can edit that single occurrence without changing the rule.

**How the schedule is built (v2 engine):**
- **Interval** is a whole number of months (1 = monthly, 3 = quarterly, 12 = yearly). No weekly cadence.
- **Execution** and **Reporting period** are configured *independently*, each with its own day-rule (`FixedDay N`, `LastDay`, `FirstDay`). Example: execute on the last business day, report as if for the 1st–31st.
- **Weekend adjustment** (`None` / `PreviousBusinessDay` / `NextBusinessDay`) only shifts the *execution* date; the reporting period stays anchored to the original due date.
- **Period offset** (−3…+3) lets you post now for a past or future period (e.g. VAT filed in April for Q1: offset −1).
- Description and note support the tokens `${date}`, `${dueDate}`, `${periodFrom}`, `${periodTo}`, `${runNumber}`, with date formatters like `dd.MM.yyyy`, `MMMM`, `Q` (quarter), `S` (semester), `T` (trimester), `ww` (ISO week). Older tokens (`${periodLabel}`, `${today}`, `${year}`, …) are no longer supported — the editor warns when a saved template still references them.
- **When the cadence changes** — say a subscription switches from monthly to yearly — give the old rule an end date and use **Duplicate rule** to create a copy with the new dates. The copy keeps the amount, account, category and split slices, but starts today and carries no end date. The old rule keeps its posted occurrences, so past months are still explained by the schedule that actually applied then.

## Reconciliation [#reconciliation]

The Reconcile screen breaks your account total down into the envelopes holding it: rolling envelopes, this month's remainder on the others, income not yet received, money you are owed, and anything unallocated. The last line is what none of those explain — it should read zero.

**Example:** Your real bank statement says your checking account holds CHF 3,240. The app says CHF 3,440. You recorded a transfer to savings but forgot the matching incoming side, so the app believes in 200 francs that do not exist. Once you fix it, the two sides agree again.

## Sweep / savings target [#sweep-savings-target]

At month-end, any leftover budget in an envelope can be *swept* into a savings category. You can set a default target and per-group overrides.

**What happens with leftover money?**
Imagine your *Groceries* envelope had CHF 400 for June. You only spent CHF 350. At the end of June, the remaining CHF 50 can be **swept** into your *Holiday Savings* category (or any savings target you configured). That CHF 50 is now counted as saved, and the *Groceries* envelope resets to zero for the fresh month of July.

**What happens if you overspend?**
Imagine you budgeted CHF 400 for *Groceries* but spent CHF 450. At month-end the envelope shows −50, and those 50 are **taken out of** the savings target — exactly as leftover money would have been paid into it. A sweep runs in both directions. July starts at 400 again.

Envelopes that **roll over** differ at month-end, not at allocation: they are funded every month too, but the remainder is not swept — it stays and accumulates. That is how *Taxes* works: you set aside 600 a month and pay 7,200 once a year, without the bill blowing up that month's budget.

Both sweeps are recomputed on every read and never stored. There is no month-end close to run, and editing an old transaction changes that month's sweep with it.

## Attachment [#attachment]

A file (receipt, invoice) linked to a transaction. It stays in your Nextcloud; the app stores only a link to it.

**Example:** After paying CHF 89 for a dentist visit, you snap a photo of the receipt and attach it to the transaction. Six months later, when your health insurance asks for proof, you open the transaction and the receipt is right there.

## Tag [#tag]

A free-form label you can attach to transactions and search by. Useful for cross-cutting concerns that don't fit categories (e.g. *vacation-2025*).

**Example:** You tag flights, hotel bookings, and restaurant meals with *#paris-2025*. Later, you can search that tag and see the total cost of the trip across all categories — without creating a separate *Paris* category for each expense type.

## Place [#location]

Where you paid: coordinates, accuracy and a label like *Coop Bahnhof*. **Off by default** — you switch it on under **Settings → Capture location**.

**Example:** You pay at the Coop by the station and the app remembers the place. Next time you shop there it offers *Groceries* and the same description, because it recognises where you are.

What gets stored, and which mapping services find out about it, is on [Capturing places](/location).
