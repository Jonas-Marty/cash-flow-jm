---
title: "Webhooks"
description: "Outbound webhooks notify an external service (e.g. n8n, Zapier, your own script) whenever a transaction is created."
sidebar:
  icon: webhook
---

Useful for forwarding shared-household expenses to a separate app like Flatastic.

## What triggers a webhook? [#what-triggers-a-webhook]

A webhook is fired for every newly created transaction, from any of these sources:
- **`transaction.created.manual`** — you saved it via the Add screen.
- **`transaction.created.recurring`** — a recurring rule auto-posted it.
- **`transaction.created.api`** — it came in through the public REST API.

Edits, deletes and reallocations do **not** fire a webhook (by design — keeps the contract simple).

## How do I add one? [#how-do-i-add-one]

**Settings → Webhooks**: enter a name (free text, just for you), the target **URL** (must be reachable from the server), and optionally an **auth header**. The header name + value are sent on every request — n8n's *Header Auth* node, Zapier's *Custom Webhook*, or your own server can verify it.

Click **Send test** to push a synthetic payload immediately and check your receiver.

## Delivery, retries and logging [#delivery-retries-and-logging]

Delivery is **fire-and-forget from the user's perspective** — your transaction is saved first, then the webhook is dispatched in the background. Each delivery attempts up to **3 times** (1s and 4s back-off, 10s timeout per attempt). Every attempt is logged to:
- **stdout** (structured JSON), useful when self-hosting,
- the **audit log** (`Settings → Audit log`, action `custom`, kind `webhook.delivery`), with status, attempts, duration and error message.

There is no persistent queue: if all 3 attempts fail, the delivery is dropped and only the failure shows up in the audit log. Future notification channels (e.g. Gotify) will plug into the same dispatcher.

## Payload structure [#payload-structure]

`POST <your-url>` with `Content-Type: application/json` and your configured auth header. Body:

```json
{
  "event": "transaction.created.manual",
  "delivered_at": "2026-06-18T10:30:00.000Z",
  "delivery_id": "a1c8e9d2-2f4d-4c11-9b1e-7e2a3a3d40e5",
  "transaction": {
    "id": "6b6a7c80-1f4a-4c2c-8f7d-2c0b3f1d9d11",
    "occurred_on": "2026-06-18",
    "amount": 42.50,
    "destination_amount": null,
    "type": "expense",
    "source_account_id": "b6e3d0fa-…",
    "destination_account_id": null,
    "category_id": "3a9b1f7c-…",
    "description": "Migros",
    "note": null,
    "tags": ["groceries", "household"],
    "split_group_id": null,
    "recurring_rule_id": null,
    "created_at": "2026-06-18T10:30:00.142Z"
  }
}
```

Notes:
- `amount` is always **positive**; use `type` to interpret the sign (`expense` / `income` / `transfer`).
- `destination_amount` is only set for cross-currency transfers.
- `tags` are sent as a flat string array so receivers can branch without a second API call (e.g. *forward to Flatastic only if `tags` contains `household`*).
- `delivery_id` is unique per delivery attempt batch — safe to use for **idempotency** on the receiver side.
- IDs reference rows in your Cashflow database; resolve them via the public REST API if you need human-readable account or category names.

## Example: forwarding to Flatastic via n8n [#example-forwarding-to-flatastic-via-n8n]

1. In n8n, create a workflow with a **Webhook** trigger node (method `POST`, *Header Auth* with the same name/value you store in Cashflow).
2. Add an **IF** node to filter: e.g. only continue when `{{$json.transaction.tags}}` contains `household`.
3. Add an **HTTP Request** node that calls the Flatastic API with the mapped fields.
4. Activate the workflow, then in Cashflow click **Send test** — you should see the test event arrive in n8n.

## Security [#security]

- Use **HTTPS** URLs (HTTP is rejected outside localhost).
- The auth header value is stored server-side and **never logged** (not in stdout, not in the audit log).
- Each webhook is scoped to your user (RLS): nobody else can read, edit, or fire it.
- The server operator can read the stored header value in the database — treat it like any other credential on this instance.

