---
title: "Common workflows"
description: "Common workflows: Shared expense and getting repaid: Importing transactions via the API: Monthly close: Recurring bills"
sidebar:
  icon: list-ordered
---

## Shared expense and getting repaid [#shared-expense-and-getting-repaid]

1. Add the expense, toggle **Reimbursable** and pick the counterparty.
2. It appears under **Open IOUs** on the dashboard.
3. When you receive the money, click **Add repayment** — the form is pre-filled, just save.
4. The IOU auto-closes once fully covered. For partial or cash settlements, use *Mark as settled* or *Book as loss* instead.

## Importing transactions via the API [#importing-transactions-via-the-api]

1. In **Settings → API tokens**, create a token.
2. POST entries to `/api/public/pending-transactions` (see Swagger UI at `/api/public/docs`).
3. Imported entries appear in **Pending → Pending**. Review and confirm or reject.

## Monthly close [#monthly-close]

1. Open **Reconcile** and check that envelopes still add up to your accounts.
2. Leftovers sweep themselves — once a month is over, whatever is left in (or overspent from) each monthly envelope moves to its sweep target automatically. Nothing to click.
3. Review **Insights → Overview** and **Trends** to spot anomalies.
4. Adjust next month's envelopes if needed.

## Recurring bills [#recurring-bills]

1. In **Settings → Recurring rules**, add a rule with cadence, amount and category.
2. The dashboard's *Upcoming* card shows pending occurrences.
3. Post, edit or skip each occurrence individually.

## Connecting Nextcloud [#connecting-nextcloud]

Open **Settings → Nextcloud** and follow the OAuth flow. Once connected, attachments uploaded to transactions are stored in your Nextcloud and previewable via a file picker.

