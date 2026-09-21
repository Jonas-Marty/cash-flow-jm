---
title: "Bildschirme"
description: "Was jede Hauptseite der App zeigt und wofür du sie benutzt — von der Übersicht über die Budgets bis zum Abgleich und den Einstellungen."
sidebar:
  icon: layout-dashboard
---

## Übersicht (/) [#dashboard]

Deine Startseite. Zeigt Kontosalden (Aktiva / Passiva), Monats-Budget, offene IOUs, zu bestätigende Buchungen, anstehende wiederkehrende Posten, Top-Buchungen, Tages-Heatmap und Trends. Jede Karte führt zur passenden Detailseite.

## Buchungen (/transactions) [#transactions-transactions]

Die vollständige Liste. Filter nach Datum, Konto, Kategorie, Typ, Scope oder Tag. Der Betragsfilter versteht Operatoren wie `>100`, `<=50`, `10-30` oder `=42`. Zeile antippen zum Bearbeiten oder Löschen.

## Neu (/add) [#add-add]

Formular für neue Buchungen. Typ (Ausgabe / Einnahme / Übertrag), Betrag, Datum, Konto und Kategorie. Optional: Gegenpartei, Scope, Tags, Anhänge, Notizen und das *erstattungsfähig*-Flag für IOUs. Vorschläge füllen Felder automatisch.

## Budgets (/envelopes) [#envelopes-envelopes]

Monatsansicht deiner Umschläge: geplant vs. ausgegeben vs. übrig. Mit *Umverteilen* verschiebst du Budget; Rollover und Sweep-Ziele konfigurierst du in **Einstellungen → Sparen & Sweeps**.

Mit den Pfeilen wechselst du den Monat, über den Monatsnamen wählst du direkt einen aus. **Tippe auf den geplanten Betrag, um das Budget dieses Monats zu ändern** — in jedem Monat, auch in einem vergangenen.

Auf einem breiten Bildschirm kannst du oben rechts auf die **Tabellenansicht** umschalten: Umschläge untereinander, zwölf Monate nebeneinander. Damit siehst du die Entwicklung eines Umschlags über das Jahr und planst mehrere Monate am Stück.

- **Enter** speichert den einzelnen Monat, **⌘/Strg + Enter** überträgt den Wert bis zum rechten Rand.
- Der **Pfeil** in einer Spaltenüberschrift überträgt den ganzen Monat in alle folgenden Monate. So legst du im Dezember den Januar und alles danach an.
- Wenn du mit der Maus über einen dieser Pfeile fährst, zeigen die betroffenen Zellen vorher an, was sich ändern würde: der alte Wert durchgestrichen, der neue daneben.
- Der **Radiergummi** entfernt Budgets wieder. Bei einem vergangenen Monat entfernt er diesen und alle früheren — dafür gedacht, versehentlich zu früh angelegte Budgets loszuwerden. Bei einem künftigen Monat entfernt er nur diesen. Einen einzelnen Monat mitten in der Vergangenheit kann man nicht entfernen: er wird beim nächsten Laden wieder aufgefüllt, weil ein Monat ohne Betrag weder als Zuteilung zählt noch gekehrt wird.
- Ein Klick auf den **Monatsnamen** wählt diesen Monat aus — die Kennzahlen oberhalb der Tabelle beziehen sich darauf, und die Pfeiltasten `<` und `>` verschieben die Auswahl, ohne die Tabelle zu verlassen.

Jede dieser Aktionen lässt sich rückgängig machen — über die Schaltfläche **Rückgängig** über der Tabelle, solange die Seite offen ist.

Gepunktet unterstrichene Werte sind **noch nicht festgelegt**: für diesen Monat ist nichts gespeichert, und die Zahl zeigt, was er vom Vormonat erben würde. Bearbeiten kannst du sie ganz normal. Ein künftiger Monat zählt erst dann in die Prognose, wenn du ihn festgelegt hast.

*Stand per* bestimmt, auf welchen Tag sich die Salden beziehen. Das Feld folgt dem gewählten Monat: ein vergangener Monat zeigt den Stand an seinem letzten Tag, der laufende Monat zeigt heute, ein künftiger Monat zeigt eine **Prognose** auf sein Ende. Du kannst jederzeit ein eigenes Datum setzen.

## Auswertungen (/insights) [#insights-insights]

Vier Tabs:
- **Übersicht** — Summen und Netto für den Zeitraum.
- **Aufschlüsselung** — Ausgaben nach Kategorie / Gruppe.
- **Trends** — Monatsvergleich.
- **Prognose** — Hochrechnung anhand wiederkehrender Regeln und Durchschnitte.
Oben wechselst du Monat / Quartal / Jahr / frei.

## Offen (/pending) [#pending-pending]

Vier Tabs:
- **Offen** — importierte Einträge, die du bestätigen oder ablehnen sollst.
- **Offene IOUs** — gebuchte erstattungsfähige Transaktionen, die noch offen sind.
- **Abgelehnt** — abgelehnte Einträge (zur Nachvollziehbarkeit, wiederherstellbar).
- **Bestätigt** — bereits bestätigte Einträge; die echte Buchung findest du in Buchungen.

## Abgleich (/reconcile) [#reconcile-reconcile]

Zerlegt deine Kontosumme in die Umschläge, die sie halten: übertragende Umschläge, der Rest des laufenden Monats auf den übrigen Umschlägen, noch nicht eingetroffenes Einkommen, Geld das dir geschuldet wird, und alles nicht Zugewiesene. Die letzte Zeile ist das, was keiner davon erklärt — sie sollte null sein. Ist sie es nicht, fehlt irgendwo tatsächlich eine Zuordnung.

## Scopes (/scopes) [#scopes-scopes]

Anlegen, bearbeiten und wechseln von Scopes (Reisen, Projekte, gemeinsame Haushalte). Der aktive Scope erscheint als Chip im Header und beeinflusst Übersicht, Add-Formular und Kategorie-Vorgaben.

## Einstellungen (/settings) [#settings-settings]

Sämtliche Konfiguration:
- **Konten** — deine realen Konten.
- **Kategorien & Budgets** — Wofür und wie viel. Mit eigenem Monatswechsler: die Beträge gehören zum gewählten Monat, geändert wird mit demselben Feld wie auf der Budget-Seite.
- **Sparen & Sweeps** — wohin Restbudget am Monatsende fließt.
- **Wiederkehrende Regeln** — automatisches Posten.
- **API-Tokens** — für die öffentliche REST-API.
- **Nextcloud** — Cloud-Speicher für Anhänge.
- **KI-Assistent** — Verbindungen zu deinem eigenen Modell und welche Aufgabe an welcher hängt.
- **KI-Protokoll** — jede Anfrage an deinen Provider, mit Auszügen aus dem Gesendeten.
- **Webhooks** — eine externe Adresse bei jeder neuen Buchung benachrichtigen.
- **Integrationen** — Anmeldung über einen OIDC-Provider.
- **Verknüpfte Konten** — Anmeldeverfahren deines Accounts.
- **Ort erfassen** — der Schalter für Standortdaten; standardmäßig aus.
- **Audit-Log** — letzte Änderungen.
- **Export / Import** — Daten ein-/ausspielen (auch fürs Selbsthosten).
- **Über** — welche Version und welcher Commit gerade läuft.

