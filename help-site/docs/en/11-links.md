---
title: "Transaction links"
description: "Tie several transactions that belong to the same real-world purchase into one group, without changing your budgets or your reports."
sidebar:
  icon: link-2
---

The transactions still count individually in budgets, categories and KPIs — the link is just a named view on top.

## How does it differ from splits, tags and reimbursements? [#how-does-it-differ-from-splits-tags-and-reimbursements]

- **Splits** divide one payment into several category legs of one transaction.
- **Tags** are ad-hoc labels for filtering — no shared metadata.
- **Reimbursements** are a 1:1 settlement between an expense and a refund.
- **Links** are N transactions sharing one named bundle (title, optional planned date, kind icon). A transaction can belong to **at most one** link.

## Does a link change my budgets or KPIs? [#does-a-link-change-my-budgets-or-kpis]

**No.** Reports keep using each transaction's own `amount` against its own category and date. The link total shown in the sheet ("Linked total") is purely descriptive — for orientation, not double-counting.

## Only part of a transaction belongs to the purchase [#only-part-of-a-transaction-belongs-to-the-purchase]

**Split the transaction first** (Add → Split), then link only the slice that belongs to the bundle. The link itself never stores partial amounts — that keeps accounting unambiguous.

## What happens when I remove the last member? [#what-happens-when-i-remove-the-last-member]

You're asked to confirm: removing the last transaction deletes the link itself. Until then, deleting individual transactions just removes them from the link.

