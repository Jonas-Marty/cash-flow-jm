
# Shared rent (and similar split costs) — how to model

Good news: your current model already supports this cleanly through the **reimbursement rule** (architecture §3.2). No schema changes needed — just a documented pattern + a small UX nudge so it's discoverable.

## The pattern

For a 2,400 CHF rent where your girlfriend pays you 1,200 back:

1. **Expense** — 2,400 CHF, account = Bank, category = **Miete**.
   → Bank −2,400. Miete `spent` += 2,400.
2. **Income** — 1,200 CHF, account = Bank, category = **Miete** (same envelope), payee = "Girlfriend", note = `#shared`.
   → Bank +1,200. Miete `spent` −= 1,200 (reimbursement rule).

Net effect on Miete envelope: **+1,200 spent** = your actual share. Net effect on Bank: −1,200 = the cash that actually left you. Both physical transactions stay in history for traceability.

This works for any split cost: shared groceries, joint Netflix, splitting a restaurant bill, etc.

## Why this is the right fit (not a new "shared expense" type)

- **Audit trail intact**: both real bank movements are visible in Transactions; if you ever reconcile against your bank statement they match 1:1.
- **Envelope math is automatic**: the existing `category_month_spending` function already nets income-with-expense-category against the month's spend.
- **No new concepts**: same Add Transaction screen, same envelopes, same dashboard. You already use this rule implicitly for refunds (architecture §3.2 row "Income (expense category) = reimbursement").
- **Recurring works too**: pair a recurring **Expense** rule (2,400 to landlord on the 1st) with a recurring **Income** rule (1,200 from girlfriend on the 28th) — both bound to the Miete envelope. The envelope shows the correct net at the end of the month.

Alternatives considered and rejected:
- *New "split" transaction type*: doubles complexity for a case the reimbursement rule already solves. Rejected.
- *Book only your half (1,200 expense), ignore her transfer*: would make Bank balance drift from reality. Rejected.
- *Separate "Shared > Miete reimbursement" income envelope*: makes the dashboard noisier and breaks the natural "Miete cost me X this month" reading. Rejected.

## Small changes to make this discoverable

1. **Add Transaction screen** — when the user picks Income type and selects an expense-flavoured category, show a subtle hint under the category dropdown: *"This will be treated as a reimbursement and reduce this envelope's spending."* (translated DE/EN). Purely informational, no behaviour change.
2. **Architecture doc** — add §3.7 "Shared / split expenses" with the rent example, the recurring-rule pairing pattern, and a note that any income posted against an expense envelope is a reimbursement. Add change-log entry.
3. **i18n** — two new keys: `add.reimbursement_hint` (DE: *"Wird als Rückerstattung gebucht und reduziert die Ausgaben dieses Umschlags."*, EN: *"Booked as a reimbursement; reduces this envelope's spending."*) and `add.reimbursement_hint.savings` for the savings-envelope variant (*"...erhöht das Guthaben dieses Rückstellungs-Umschlags."* / *"...increases this savings envelope's balance."*).

## Files touched

- `src/routes/add.tsx` — render the hint under the category select when `type === "income"` and the chosen category's group kind is `expense` or `savings`.
- `src/i18n/index.tsx` — two new keys (DE + EN).
- `architecture.md` — new §3.7 + change-log entry dated today.

## Out of scope

Multi-party splits with arbitrary fractions, automatic IOU tracking, linking the expense and the reimbursement transactions as a pair (they stay independent rows — the envelope math handles the linkage implicitly).
