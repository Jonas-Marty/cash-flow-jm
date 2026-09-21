---
title: "Common workflows"
description: "Worked end-to-end recipes: a shared expense and getting repaid, importing via the API, monthly close, recurring bills and Nextcloud."
sidebar:
  icon: list-ordered
---

## Shared expense and getting repaid [#shared-expense-and-getting-repaid]

1. Add the expense, toggle **Reimbursable** and pick the counterparty.
2. It appears under **Open IOUs** on the dashboard.
3. When you receive the money, click **Add repayment** — the form is pre-filled, just save.
4. The IOU auto-closes once fully covered. If you get back less than you paid — or more, say 20.00 against an outlay of 19.50 — **write off the rest**: the difference is charged to or credited to your envelope instead of landing nowhere.

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

Open **Settings → Nextcloud** and follow the OAuth flow. Once connected you can attach files from your Nextcloud to transactions through a file picker. Nothing is uploaded: the file stays where it is and this app stores only a link to it. Deleting the attachment here leaves the file in your Nextcloud.

