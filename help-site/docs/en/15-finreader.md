---
title: FinReader (Android)
description: >-
  The companion app reads payment notifications on your phone — what it sends,
  where that text goes next, and how to set it up.
sidebar:
  icon: smartphone
---
FinReader is a small Android app that **reads the notifications from your banking apps** and turns them into pending transactions. Instead of typing up every card payment by hand in the evening, it is already sitting under **Pending** the next time you open the app, waiting for a category.

FinReader is not part of this repository and is not a public app. It is distributed as a signed APK at `apk.wi-wo.ch`, behind a login — if you host this instance yourself, you cannot use it. The interface it uses, on the other hand, is open: the [public API](/api) is open to any client you care to write.

## How it fits together [#how-it-works]

1. Your banking app shows a notification: *Debit CHF 45.30, Coop Genossenschaft*.
2. FinReader picks it up and extracts the amount, date and text.
3. It sends that to `/api/public/pending-transactions` with your API token.
4. The line appears in the app under **Pending**.
5. You check it, choose a category and confirm — only then does it become a real transaction.

Step 5 cannot be skipped. Nothing that comes in from outside ends up in your ledger unasked.

## Setting it up [#setup]

1. In the app, create a token under **Settings → API tokens**. It is shown only once.
2. Enter the token in FinReader.
3. Give FinReader the Android *notification access* permission — without it, it cannot read anything.
4. Select which apps it should read.

Create a **separate** token for FinReader. If you lose the phone, you revoke that one and everything else carries on. A token can do everything, though — see [A token can do everything](/api#no-scopes).

## Duplicate notifications [#duplicates]

Android likes to deliver notifications more than once, and the connection on the train is what it is. FinReader therefore sends its own identifier with each line. If the same one arrives twice, the app returns the existing line instead of creating a second one — see [Sending twice is safe](/api#idempotency).

## What gets sent [#what-is-sent]

The amount, date, target account — and the **original notification text**, so that you can see what it was about when you check it. If your phone sends coordinates along with it, those come too; see [Recording locations](/location).

That notification text is the point at which you should stop and think for a moment: **if you have set up the AI assistant for suggestions on pending transactions, it goes to your AI provider.** That is the only AI call in the app that you do not trigger yourself — it runs automatically as soon as an uncategorised line comes in. Exactly what is transmitted is described under [AI assistant](/ai) and in the [privacy notice](https://cash-flow.wi-wo.ch/privacy), section 6a.

Without an AI connection set up, the text does not leave the server.
