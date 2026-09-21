---
title: "Webhooks"
description: "Ausgehende Webhooks benachrichtigen einen externen Dienst (z. B. n8n, Zapier, eigenes Script), sobald eine Buchung angelegt wird."
sidebar:
  icon: webhook
---

Praktisch um z. B. gemeinsame Haushaltsausgaben an Flatastic weiterzureichen.

## Was löst einen Webhook aus? [#what-triggers-a-webhook]

Ein Webhook wird für jede neu angelegte Buchung gefeuert, aus einer dieser Quellen:
- **`transaction.created.manual`** — über das Add-Formular gespeichert.
- **`transaction.created.recurring`** — automatisch durch eine wiederkehrende Regel gebucht.
- **`transaction.created.api`** — über die öffentliche REST-API erfasst.

Änderungen, Löschungen und Umverteilungen lösen **keinen** Webhook aus (bewusste Vereinfachung des Vertrags).

## Wie lege ich einen an? [#how-do-i-add-one]

**Einstellungen → Webhooks**: Name (frei wählbar), Ziel-**URL** (muss vom Server erreichbar sein), optional ein **Auth-Header** (Name + Wert). Der Header wird bei jedem Request mitgesendet — die *Header Auth*-Node in n8n, Zapiers *Custom Webhook* oder dein eigener Server kann ihn prüfen.

Mit **Test senden** schickst du sofort einen synthetischen Payload und prüfst den Empfänger.

## Zustellung, Retries und Logging [#delivery-retries-and-logging]

Die Zustellung ist **für dich fire-and-forget** — die Buchung wird zuerst gespeichert, der Webhook danach im Hintergrund ausgeliefert. Pro Webhook werden bis zu **3 Versuche** gemacht (1 s und 4 s Backoff, 10 s Timeout je Versuch). Jeder Versuch wird geloggt nach:
- **stdout** (strukturiertes JSON), nützlich beim Selbsthosten,
- ins **Audit-Log** (`Einstellungen → Audit-Log`, Aktion `custom`, Kind `webhook.delivery`) mit Status, Versuchen, Dauer und Fehlermeldung.

Es gibt keine persistente Queue: scheitern alle 3 Versuche, wird der Versand verworfen und nur der Fehler steht im Audit-Log. Künftige Notification-Kanäle (z. B. Gotify) hängen sich an denselben Dispatcher.

## Aufbau des Payloads [#payload-structure]

`POST <deine-url>` mit `Content-Type: application/json` und deinem konfigurierten Auth-Header. Body:

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
    "tags": ["lebensmittel", "haushalt"],
    "split_group_id": null,
    "recurring_rule_id": null,
    "created_at": "2026-06-18T10:30:00.142Z"
  }
}
```

Hinweise:
- `amount` ist immer **positiv**; das Vorzeichen ergibt sich aus `type` (`expense` / `income` / `transfer`).
- `destination_amount` ist nur bei Fremdwährungs-Überträgen gesetzt.
- `tags` ist ein flaches String-Array, damit Empfänger ohne zweiten API-Call verzweigen können (z. B. *nur an Flatastic weiterleiten, wenn `tags` `haushalt` enthält*).
- `delivery_id` ist pro Auslieferungs-Batch eindeutig — eignet sich als **Idempotenz-Schlüssel** auf der Empfängerseite.
- IDs verweisen auf Zeilen in deiner Cashflow-DB; lesbare Konto-/Kategorienamen holst du dir bei Bedarf über die öffentliche REST-API.

## Beispiel: Weiterleitung an Flatastic via n8n [#example-forwarding-to-flatastic-via-n8n]

1. In n8n einen Workflow mit **Webhook**-Trigger anlegen (Methode `POST`, *Header Auth* mit demselben Namen/Wert wie in Cashflow).
2. **IF**-Node zum Filtern: z. B. nur weitermachen, wenn `{{$json.transaction.tags}}` `haushalt` enthält.
3. **HTTP Request**-Node, der die Flatastic-API mit den gemappten Feldern aufruft.
4. Workflow aktivieren, dann in Cashflow **Test senden** klicken — der Test-Event sollte in n8n ankommen.

## Sicherheit [#security]

- Nur **HTTPS**-URLs (HTTP ist ausserhalb von localhost gesperrt).
- Der Auth-Header-Wert liegt serverseitig und wird **nie geloggt** (weder nach stdout noch ins Audit-Log).
- Jeder Webhook ist auf deinen User beschränkt (RLS): niemand sonst kann ihn sehen, ändern oder auslösen.
- Der Server-Betreiber kann den gespeicherten Header-Wert in der DB lesen — behandle ihn wie andere Zugangsdaten auf dieser Instanz.

