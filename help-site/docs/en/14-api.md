---
title: Public API
description: >-
  Submit transactions from outside and read your ledger — tokens, idempotency
  and the limits you should know before you write a script.
sidebar:
  icon: plug
---
Under `/api/public/*` there is a REST interface that lets a script, an automation service or an app submit transactions and read your ledger. This is how the lines from [FinReader](/finreader) get into the app.

**The endpoints themselves are deliberately not listed here.** They are described in an OpenAPI file that is generated from the code and is therefore always up to date — a copy here would be wrong within a month. To try things out:

- **Swagger UI:** [cash-flow.wi-wo.ch/api/public/docs](https://cash-flow.wi-wo.ch/api/public/docs)
- **Raw specification:** `/api/public/openapi`

This page covers what the specification does not, and what does not change.

## Authentication [#authentication]

You create a token under **Settings → API Tokens**. It is shown **once**; after that only a hash of it remains in the database, and nobody — not even the person running the instance — can show it to you again. Lost means reissued.

Send it along as a bearer token:

```
Authorization: Bearer cfjm_your-token
```

## One token can do everything [#no-scopes]

There are **no scopes**. A valid token may do everything the API can do, on all the data in your account: create transactions, read and delete pending transactions, list accounts and categories. You cannot issue a token that may only write or may only see one account.

In practice that means: only hand a token to something you would trust with your whole account, and create a separate one per client — then you can revoke one without affecting the others. Revoking takes effect immediately, on the next call.

## There is no rate limit [#no-rate-limiting]

The API throttles nothing. A script in an endless loop slows down your own instance, and nothing stops it. Build the pauses into your client.

## Sending twice is safe [#idempotency]

Transactions that you submit as *pending* can be made unique with two fields:

- `external_source` — who sent them, e.g. `FinReader`
- `external_ref` — your own ID for this particular operation

If the same combination arrives a second time, the app does **not** create a second line. It returns the existing one, with `deduplicated: true` and status **200** instead of 201.

This is the saving grace for any client with a shaky connection: timeout while sending, send again, no duplicate. Without `external_ref` there is no such protection — then every call is a new transaction.

Deletion works through the same combination. A line that has already been **confirmed** can no longer be deleted (status 409): it has become a real transaction, and that belongs to you, not to the client.

## Nothing is booked without asking [#nothing-is-booked]

Anything coming in through the API lands under **Pending** and waits. Category, description and note can be suggested — from your own history or by the AI assistant — but nothing is booked until you confirm. See [Pending transactions](/screens#pending-pending).

## Three endpoints belong to operations [#operator-endpoints]

`/api/public/metrics`, `/api/public/prune-audit` and `/api/public/process-recurring` take **no** personal token, but a server secret from the environment variables. They are meant for cron jobs and monitoring, not for clients; if the variable is not set, they respond with 503 rather than standing open. Details are in the [project README](https://github.com/Jonas-Marty/cash-flow-jm#6-observability).

## When something goes wrong [#errors]

Errors come back as JSON, `{"error": "..."}`. For invalid fields, `details` says which field was rejected and why. Internal database errors are logged but not returned — the instance log says more than the response does.
