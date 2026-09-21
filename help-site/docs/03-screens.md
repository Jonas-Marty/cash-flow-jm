---
title: "Bildschirme"
description: "Ein Abschnitt pro Hauptseite der App. Übersicht (/): Buchungen (/transactions): Neu (/add): Budgets (/envelopes)"
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
- **Kategorien & Budgets** — Wofür und wie viel.
- **Sparen & Sweeps** — wohin Restbudget am Monatsende fließt.
- **Wiederkehrende Regeln** — automatisches Posten.
- **API-Tokens** — für die öffentliche REST-API.
- **Nextcloud** — Cloud-Speicher für Anhänge.
- **Audit-Log** — letzte Änderungen.
- **Export / Import** — Daten ein-/ausspielen (auch fürs Selbsthosten).

