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

In Nextcloud, add a client under *Administration → Security → OAuth 2.0*, with the redirect URI that **Settings → Nextcloud** shows. Enter the server URL, client ID and client secret there, save, and click **Connect**. The client ID and secret stay stored afterwards: leave the fields empty to keep them.

You then choose files in a picker. Without a search term you browse your folders, and the last one you used is remembered. From two characters on, it searches all of your Nextcloud, newest files first. Attachments to transactions show only PDFs and images by default. Nothing is uploaded: the app stores a permanent link that keeps working after the file is renamed or moved. Deleting the attachment here leaves the file in your Nextcloud.

The connection renews itself. Nextcloud grants access for one hour at a time, and the app fetches a new grant automatically. You only need to reconnect if you remove the app in Nextcloud under *Personal settings → Security → Devices & sessions*, or leave it unused for a year. The app tells you when that happens.

