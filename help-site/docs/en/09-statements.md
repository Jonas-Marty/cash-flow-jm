---
title: "Statement import"
description: "Upload a statement as PDF, image or CSV, match its rows against your ledger, and see what is missing, duplicated or booked wrong."
sidebar:
  icon: file-text
---

The AI reads the rows; the app then compares them against your transactions and shows what is missing, duplicated or booked wrong.
## Which file types can I upload? [#which-file-types-can-i-upload]

- **PDF** — the digital statement from your bank. The text layer is extracted locally and only the text is sent to your AI endpoint.
- **Images** — PNG, JPEG, WebP or GIF, e.g. a **photo or screenshot** of a paper statement or a banking app. The image is sent to your AI endpoint as an image, so the connection you use for *Statement extraction* must support vision.

A scanned PDF without a text layer cannot be read — take a photo/screenshot of it instead and upload that as an image.

## How do I import one? [#how-do-i-import-one]

1. Open **Statements**, pick the **account** the statement belongs to.
2. Choose the file (PDF, CSV or image) — from your device or, if Nextcloud is connected, through **Or choose from Nextcloud**. A Nextcloud file is fetched by the server directly; the app keeps no copy, only a link to it.
3. Set the **date tolerance** (default 3 days) — booking dates in the app and at the bank rarely match exactly.
4. Enable **invert amounts** if the statement shows expenses as positive numbers (common on credit-card statements).
5. Start the import. The AI extracts the rows, then a deterministic matcher compares them with your transactions.

## How does matching work? [#how-does-matching-work]

Matching is done in code, not by the AI:
- **Amount must agree to the cent.** Split transactions are summed per split group first.
- **Date** must be inside your tolerance window.
- **Description similarity** only ranks candidates and decides *exact* vs *probable* — it never creates a match on its own.
- Each app transaction can be consumed by **at most one** statement line, so repeated identical amounts are never double-matched.

## What do the result groups mean? [#what-do-the-result-groups-mean]

- **Missing** — on the statement, but not in the app. Create the transaction with one click (the Add form is prefilled). In the table, description and tags suggest what you have used before as you type.
- **Probable** — a likely match; confirm or reset it.
- **Matched** — exact matches, nothing to do.
- **Ignored** — rows you marked irrelevant (fees you don't track, carry-forwards).
- **Not on the statement** — transactions in the app inside the statement period that the statement does not contain: typically a duplicate, a wrong date, or a booking on the wrong account.

## What is sent to my AI provider? [#what-is-sent-to-my-ai-provider]

It depends on the file type. **CSV and TSV are read entirely locally — nothing reaches a provider at all.** For a PDF, the embedded text layer is extracted and sent in chunks; for an image, the picture itself.

A second pass then runs automatically to categorise lines that matching could not tie to a transaction. That pass also sends a **snapshot of your ledger** — accounts, categories and your recent transactions — because without that context it cannot guess where a line belongs. Matching itself runs on the server with no AI call.

Choose connections under **Settings → AI Assistant**, separately for *Statement extraction* and *Line classification*; the usual fallback to the next enabled connection applies.

