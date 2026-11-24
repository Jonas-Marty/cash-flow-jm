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

**Didn't know beforehand that you'd be repaid?** Just record the income and, under **Repays expenses**, search for the expense or expenses it settles. The search covers every open expense in the income's currency, including parts of a split, and suggests combinations that add up. Picking an expense makes it reimbursable; it takes the counterparty from **From whom** if it has none. Untick it later and it becomes a normal expense again, with its earlier category.

For each expense you decide:

- **Rest** (when the income doesn't cover all of it): *still to come* keeps it open. *My share* keeps it with you — either **write it off** (expense and income both go to the chosen category) or **split the expense** (your share stays in the category; the repaid part and the income have none).
- **Budget** (when it is repaid in full, or the rest is still coming): the default is **Remove the expense's category** — the expense no longer counts in any envelope, and neither does the income. Or **book the income to a category**, such as the expense's.
- **Surplus** (the income brings more): credit it to a budget, or split it off as its own line.

The income's category follows from these choices; if they involve different categories, the income is split automatically. A split income has its own picks per line.

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

You then choose files in a picker. Without a search term you browse your folders, and the last one you used is remembered. From two characters on, it searches all of your Nextcloud. Files are sorted by name, Z to A by default, so names that start with a date show the newest first. Attachments to transactions show only PDFs and images by default. The eye next to a file opens a preview, over the list on a phone. Nothing is uploaded: the app stores a permanent link that keeps working after the file is renamed or moved. Deleting the attachment here leaves the file in your Nextcloud.

The connection renews itself. Nextcloud grants access for one hour at a time, and the app fetches a new grant automatically. You only need to reconnect if you remove the app in Nextcloud under *Personal settings → Security → Devices & sessions*, or leave it unused for a year. The app tells you when that happens.

