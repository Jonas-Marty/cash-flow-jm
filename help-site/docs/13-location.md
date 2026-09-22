---
title: "Orte erfassen"
description: "Buchungen können festhalten, wo du etwas bezahlt hast. Standardmässig ist das aus — hier steht, was gespeichert wird und wer davon erfährt."
sidebar:
  icon: map-pin
---

Eine Buchung kann festhalten, wo du gezahlt hast: Koordinaten, wie genau die Messung war, und eine Bezeichnung wie *Coop Bahnhof*. Das hilft später beim Wiedererkennen — und die App schlägt dir beim nächsten Einkauf am selben Ort Kategorie und Beschreibung von damals vor.

Weil dabei Bewegungsdaten entstehen, ist die Funktion **standardmässig ausgeschaltet** und du schaltest sie selbst ein.

## Einschalten und wieder ausschalten [#turning-it-on]

**Einstellungen → Ort erfassen.** Solange der Schalter aus ist, wird an keiner Buchung ein Ort gespeichert und es geht nichts an einen Kartendienst.

Ist er an, holt das Add-Formular beim Erfassen einmal die aktuelle Position — aber nur bei **neuen** Buchungen mit dem **heutigen Datum**. Bei einer Nachbuchung von letzter Woche wäre dein jetziger Standort ohnehin die falsche Antwort. Sobald du das Feld selbst anfasst, hält sich die Automatik heraus.

Ausschalten stoppt das Erfassen ab sofort. Bereits gespeicherte Orte bleiben — die löschst du an der jeweiligen Buchung oder über den Export/Import.

## Was gespeichert wird [#what-is-stored]

Pro Buchung, alles optional:

- **Koordinaten** auf sechs Nachkommastellen, also etwa handbreit genau.
- **Genauigkeit** in Metern — wie sicher sich das Gerät war.
- **Bezeichnung**, der Text, den du in der Liste siehst.
- **Herkunft**: `device` (vom Gerät gemessen), `search` (aus der Ortssuche) oder `manual` (Pin von Hand gesetzt oder verschoben).

Koordinaten gibt es nur im Paar — entweder Länge *und* Breite, oder keins von beidem. Und **ohne Bezeichnung lässt sich ein Ort nicht speichern**: ein Punkt ohne Namen ist in der Buchungsliste wertlos.

Auch offene Buchungen können einen Ort tragen, wenn ein API-Client ihn mitschickt. Beim Bestätigen wandert er auf die echte Buchung mit.

## Woher die Bezeichnung kommt [#where-the-label-comes-from]

Drei Wege:

1. **Ortssuche** — du tippst *Coop Bahnhof*, wählst einen Treffer.
2. **Rückwärtssuche** — du erfasst einen Punkt oder verschiebst den Pin, und die App fragt die Adresse dazu ab.
3. **Aus deiner eigenen Historie** — schickt ein Gerät Koordinaten ohne Bezeichnung, sucht die App in deinen letzten 200 Buchungen nach einem Ort, der zur Beschreibung passt und nah genug liegt. Nah genug heisst: die gemeldete Genauigkeit, mindestens aber 150 m und höchstens 500 m.

Passt keine Beschreibung — Zahlterminals schicken meist nur *Kartenzahlung* — zählt die App, wo du schon warst: Ein Ort, den du an **mindestens zwei verschiedenen Tagen dreimal** besucht hast und der dort die klare Mehrheit stellt, benennt sich selbst. Sind zwei Geschäfte im selben Bahnhof ungefähr gleich oft dabei, sagt die App lieber nichts, als das falsche zu raten.

Bei Weg 3 wird **nur der Name übernommen**. Die Koordinaten bleiben so, wie das Gerät sie gemessen hat — der gepflegte Pin von damals ist unter **Offen** einen Tipp entfernt.

## Wer davon erfährt [#who-sees-it]

Die Ortssuche und die Rückwärtssuche laufen über **OpenStreetMap Nominatim**, mit **Photon (Komoot)** als Ausweichdienst. Beide Abfragen stellt **der Server stellvertretend für dich** — die Dienste sehen also die Adresse dieses Servers, nicht deine.

Zwei Dinge gehen dagegen direkt von deinem Browser aus und machen damit deine IP-Adresse bekannt:

- Die **Kartenkacheln** kommen von `tile.openstreetmap.org`, sobald eine Karte angezeigt wird.
- *In OpenStreetMap öffnen* ruft openstreetmap.org mit den Koordinaten im Link auf.

Wichtig zu wissen: die Rückwärtssuche läuft **automatisch bei jedem Pin**, nicht auf Knopfdruck. Wer das nicht möchte, lässt den Schalter aus.

Die vollständige Aufstellung steht im [Datenschutzhinweis](https://cash-flow.wi-wo.ch/privacy), Abschnitt 6.

## Wer die Orte lesen kann [#who-can-read-them]

Dieselbe Antwort wie für alle anderen Daten: Koordinaten und Bezeichnungen liegen **unverschlüsselt** in der Datenbank, und die betreibende Person kann sie lesen. Siehe [Datenspeicherung](/data-storage).

An Webhooks werden Orte **nicht** mitgeschickt. Verwendest du den KI-Assistenten für Vorschläge zu offenen Buchungen, geht die **Ortsbezeichnung** (nicht die Koordinaten) an deinen Provider mit — siehe [KI-Assistent](/ai).

Trägt eine offene Buchung Koordinaten, kommen zusätzlich die **Namen** von bis zu 24 Orten mit, die du früher gespeichert hast, damit das Modell zwei nahe beieinanderliegende Geschäfte auseinanderhalten kann. Es bekommt dafür kurze Kürzel (*p1*, *p2*) und antwortet mit einem davon — einen Ortsnamen darf es nicht selbst erfinden, und Koordinaten oder Entfernungen bekommt es nie zu sehen.
