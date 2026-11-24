---
title: "Typische Abläufe"
description: "Durchgespielte Abläufe: geteilte Ausgabe und Rückzahlung, Import per API, Monatsabschluss, wiederkehrende Rechnungen und Nextcloud."
sidebar:
  icon: list-ordered
---

## Gemeinsame Ausgabe und Rückzahlung [#shared-expense-and-getting-repaid]

1. Buchung erfassen, **Erstattungsfähig** aktivieren, Gegenpartei wählen.
2. Sie erscheint unter **Offene IOUs** auf der Übersicht.
3. Wenn das Geld kommt: **Rückzahlung hinzufügen** — Formular ist vorbelegt, nur speichern.
4. Die IOU schließt automatisch, sobald sie voll gedeckt ist. Bekommst du weniger zurück als ausgelegt — oder mehr, etwa 20.00 für eine Auslage von 19.50 — dann **schreib den Rest ab**: die Differenz wird deinem Umschlag belastet bzw. gutgeschrieben, statt nirgends zu landen.

**Nicht vorher gewusst, dass du etwas zurückbekommst?** Erfasse einfach die Einnahme und such unter **Zahlt Ausgaben zurück** die Ausgabe oder Ausgaben, die sie begleicht. Die Suche umfasst alle offenen Ausgaben in der Währung der Einnahme, auch Teile einer Aufteilung, und schlägt passende Kombinationen vor. Eine gewählte Ausgabe wird dabei zur Auslage; die Gegenpartei kommt aus **Von wem**, falls sie noch keine hat. Hebst du die Auswahl später wieder auf, wird sie wieder eine normale Ausgabe mit ihrer früheren Kategorie.

Pro Ausgabe entscheidest du:

- **Rest** (wenn die Einnahme nicht alles deckt): *noch ausstehend* lässt ihn offen. *Mein Anteil* behält ihn bei dir — entweder **abschreiben** (Ausgabe und Einnahme gehen auf die gewählte Kategorie) oder **Ausgabe aufteilen** (dein Anteil bleibt in der Kategorie, der erstattete Teil und die Einnahme haben keine).
- **Budget** (bei voller Erstattung oder wenn der Rest noch kommt): Standard ist **Kategorie der Ausgabe entfernen** — die Ausgabe zählt in keinem Umschlag mehr, die Einnahme auch nicht. Alternativ **Einnahme auf Kategorie buchen**, zum Beispiel auf die Kategorie der Ausgabe.
- **Überschuss** (die Einnahme bringt mehr): einem Budget gutschreiben oder als eigene Zeile abteilen.

Die Kategorie der Einnahme ergibt sich aus diesen Entscheidungen; betreffen sie verschiedene Kategorien, wird die Einnahme automatisch aufgeteilt. Eine aufgeteilte Einnahme hat pro Zeile eine eigene Auswahl.

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

In Nextcloud unter *Verwaltung → Sicherheit → OAuth 2.0* einen Client anlegen, mit der Weiterleitungs-URI, die **Einstellungen → Nextcloud** anzeigt. Dort Server-URL, Client ID und Client Secret eintragen, speichern und auf **Verbinden** klicken. Client ID und Secret bleiben danach gespeichert: Lässt du die Felder leer, werden sie beibehalten.

Dateien wählst du dann in einem Picker. Ohne Suchbegriff blätterst du durch deine Ordner, und der zuletzt benutzte wird gemerkt. Ab zwei Zeichen durchsuchst du die ganze Nextcloud. Sortiert wird nach Namen, standardmässig von Z nach A, damit Namen, die mit einem Datum beginnen, die neuesten zuerst zeigen. Anhänge an Buchungen zeigen standardmässig nur PDFs und Bilder. Das Auge neben einer Datei öffnet eine Vorschau, auf dem Handy über der Liste. Hochgeladen wird nichts: die App speichert einen dauerhaften Link, der auch nach Umbenennen oder Verschieben funktioniert. Löschst du den Anhang hier, bleibt die Datei in deiner Nextcloud.

Die Verbindung erneuert sich selbst. Nextcloud gibt Zugriff jeweils für eine Stunde, danach holt die App automatisch einen neuen. Neu verbinden musst du erst, wenn du die App in Nextcloud unter *Persönliche Einstellungen → Sicherheit → Geräte & Sitzungen* entfernst oder sie ein Jahr lang nicht benutzt. Die App zeigt das dann an.

