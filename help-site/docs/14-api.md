---
title: "Öffentliche API"
description: "Buchungen von aussen einliefern und dein Kontenbuch auslesen — Token, Idempotenz und die Grenzen, die du kennen solltest, bevor du ein Skript schreibst."
sidebar:
  icon: plug
---

Unter `/api/public/*` liegt eine REST-Schnittstelle, mit der ein Skript, ein Automatisierungsdienst oder eine App Buchungen einliefern und dein Kontenbuch lesen kann. So kommen die Zeilen von [FinReader](/finreader) in die App.

**Die Endpunkte selbst stehen hier bewusst nicht.** Sie sind in einer OpenAPI-Datei beschrieben, die aus dem Code erzeugt wird und damit immer aktuell ist — eine Abschrift hier wäre in einem Monat falsch. Zum Ausprobieren:

- **Swagger UI:** [cash-flow.wi-wo.ch/api/public/docs](https://cash-flow.wi-wo.ch/api/public/docs)
- **Rohe Spezifikation:** `/api/public/openapi`

Auf dieser Seite steht das, was in der Spezifikation nicht steht und sich auch nicht ändert.

## Anmeldung [#authentication]

Ein Token erstellst du unter **Einstellungen → API-Tokens**. Es wird **einmal** angezeigt; danach liegt nur noch ein Hash davon in der Datenbank, und niemand — auch die betreibende Person nicht — kann es dir noch einmal zeigen. Verloren heisst neu ausstellen.

Mitschicken als Bearer-Token:

```
Authorization: Bearer cfjm_dein-token
```

## Ein Token kann alles [#no-scopes]

Es gibt **keine Scopes**. Ein gültiges Token darf alles, was die API kann, auf allen Daten deines Accounts: Buchungen anlegen, offene Buchungen lesen und löschen, Konten und Kategorien auflisten. Du kannst kein Token ausstellen, das nur schreiben oder nur ein Konto sehen darf.

Praktisch heisst das: gib ein Token nur an etwas weiter, dem du deinen ganzen Account anvertraust, und leg pro Client ein eigenes an — dann kannst du eines zurückziehen, ohne die anderen zu treffen. Zurückziehen geht sofort und wirkt beim nächsten Aufruf.

## Es gibt kein Rate Limit [#no-rate-limiting]

Die API drosselt nichts. Ein Skript in einer Endlosschleife bremst deine eigene Instanz, und niemand hält es auf. Bau die Pausen in deinen Client ein.

## Zweimal schicken ist sicher [#idempotency]

Buchungen, die du als *offen* einlieferst, kannst du mit zwei Feldern eindeutig machen:

- `external_source` — wer sie geschickt hat, z. B. `FinReader`
- `external_ref` — deine eigene ID für genau diesen Vorgang

Kommt dieselbe Kombination ein zweites Mal, legt die App **keine zweite Zeile** an. Sie gibt die bestehende zurück, mit `deduplicated: true` und Status **200** statt 201.

Das ist die Rettung für jeden Client mit wackeliger Verbindung: Timeout beim Senden, nochmal schicken, kein Duplikat. Ohne `external_ref` gibt es diesen Schutz nicht — dann ist jeder Aufruf eine neue Buchung.

Eine Ausnahme gibt es: **einen genaueren Ort darfst du nachreichen.** Ein Handy an der Kasse hat oft noch keine brauchbare Position, wenn die Benachrichtigung kommt. Schickst du dieselbe Zeile Sekunden später mit einer deutlich genaueren Messung, ersetzt sie die gespeicherte, und die Antwort enthält `location_updated: true`. Nur solange die Zeile noch offen ist, nur wenn die neue Genauigkeit wirklich besser ist — eine Wiederholung, deren Messung bloss ein paar Meter schwankt, ändert nichts — und nur der Ort. Betrag, Beschreibung und Kategorie bleiben, wie sie ankamen: Das ist, was du beim Prüfen vor dir hast.

Löschen geht über dieselbe Kombination. Eine bereits **bestätigte** Zeile lässt sich nicht mehr löschen (Status 409): daraus ist eine echte Buchung geworden, und die gehört dir, nicht dem Client.

## Nichts wird ungefragt gebucht [#nothing-is-booked]

Was über die API kommt, landet unter **Offen** und wartet. Kategorie, Beschreibung und Notiz können vorgeschlagen werden — von deiner eigenen Historie oder vom KI-Assistenten —, aber gebucht wird erst, wenn du bestätigst. Siehe [Offene Buchungen](/screens#pending-pending).

## Drei Endpunkte gehören dem Betrieb [#operator-endpoints]

`/api/public/metrics`, `/api/public/prune-audit` und `/api/public/process-recurring` nehmen **kein** persönliches Token, sondern ein Server-Geheimnis aus den Umgebungsvariablen. Sie sind für Cronjobs und Monitoring gedacht, nicht für Clients; ist die Variable nicht gesetzt, antworten sie mit 503 statt offen zu stehen. Details stehen im [README des Projekts](https://github.com/Jonas-Marty/cash-flow-jm#6-observability).

## Wenn etwas schiefgeht [#errors]

Fehler kommen als JSON, `{"error": "..."}`. Bei ungültigen Feldern liegt unter `details` dazu, welches Feld warum abgelehnt wurde. Interne Datenbankfehler werden protokolliert, aber nicht ausgeliefert — im Log der Instanz steht mehr als in der Antwort.
