---
title: "Typische Abläufe"
description: "Typische Abläufe: Gemeinsame Ausgabe und Rückzahlung: Buchungen per API importieren: Monatsabschluss: Wiederkehrende Rechnungen"
sidebar:
  icon: list-ordered
---

## Gemeinsame Ausgabe und Rückzahlung [#shared-expense-and-getting-repaid]

1. Buchung erfassen, **Erstattungsfähig** aktivieren, Gegenpartei wählen.
2. Sie erscheint unter **Offene IOUs** auf der Übersicht.
3. Wenn das Geld kommt: **Rückzahlung hinzufügen** — Formular ist vorbelegt, nur speichern.
4. Die IOU schließt automatisch, sobald sie voll gedeckt ist. Für Teilbeträge oder Bargeld nutze stattdessen *Als abgegolten markieren* oder *Als Verlust buchen*.

## Buchungen per API importieren [#importing-transactions-via-the-api]

1. In **Einstellungen → API-Tokens** ein Token erstellen.
2. Einträge an `/api/public/pending-transactions` POSTen (Swagger UI unter `/api/public/docs`).
3. Importe erscheinen in **Offen → Offen**. Prüfen und bestätigen oder ablehnen.

## Monatsabschluss [#monthly-close]

1. **Abgleich** öffnen und prüfen, ob die Umschläge weiterhin mit den Konten übereinstimmen.
2. Restbeträge werden automatisch übertragen — sobald ein Monat vorbei ist, fließt der Rest (oder die Überschreitung) jedes Monatsumschlags in seine Sammelkategorie. Es gibt nichts zu klicken.
3. **Auswertungen → Übersicht** und **Trends** prüfen.
4. Budgets für den nächsten Monat anpassen.

## Wiederkehrende Rechnungen [#recurring-bills]

1. In **Einstellungen → Wiederkehrende Regeln** eine Regel anlegen (Takt, Betrag, Kategorie).
2. *Anstehend*-Karte zeigt offene Vorkommen.
3. Jedes Vorkommen einzeln posten, ändern oder überspringen.

## Nextcloud verbinden [#connecting-nextcloud]

**Einstellungen → Nextcloud** öffnen und dem OAuth-Flow folgen. Danach werden Anhänge in deiner Nextcloud gespeichert und über einen Dateibrowser eingebunden.

