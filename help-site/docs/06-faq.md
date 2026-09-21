---
title: "FAQ & Fehlersuche"
description: "Antworten zu Abgleich, übersprungenen wiederkehrenden Buchungen, rückwirkend geänderten Budgets und warum Umverteilungen das Monatsbudget nicht anfassen."
sidebar:
  icon: help-circle
---

## Eine geschlossene IOU war nach dem Reload wieder offen [#an-iou-i-marked-as-settled-came-back-after-reload]

War ein bekannter Bug und ist behoben: die UI meldet jetzt nur Erfolg, wenn das Update in der Datenbank tatsächlich gelaufen ist. Falls es erneut auftritt, notiere die Buchungs-ID und prüfe, ob die Zeile für deinen User erreichbar ist (RLS / Scope).

## Warum ist die letzte Zeile im Abgleich nicht null? [#why-is-my-reconciliation-drift-not-zero]

Die Abgleich-Seite zerlegt deine Kontosumme in die Umschläge, die sie halten. Die letzte Zeile ist der Rest, den keiner davon erklärt, und sie sollte null sein. Ist sie es nicht, steht meist Geld auf den Konten, das noch keinem Umschlag gehört: Anfangsbestände, die du in den Einstellungen noch nicht zugewiesen hast, oder Buchungen ohne Kategorie. Prüfe zuerst diese beiden.

## Wo landen übersprungene wiederkehrende Vorkommen? [#where-do-skipped-recurring-occurrences-go]

Nirgends — sie werden einfach nicht gepostet. Die Regel läuft mit dem nächsten Termin weiter. Du kannst ein Vorkommen jederzeit später aus der *Anstehend*-Karte posten.

## Kann ich das Budget eines vergangenen Monats ändern? [#can-i-change-a-past-month-s-budget]

**Ja.** Wechsle auf der Budget-Seite zum gewünschten Monat und tippe auf den geplanten Betrag. Du wählst dabei, ob die Änderung nur für diesen Monat gilt oder ab diesem Monat für alle folgenden.

Bei einem abgeschlossenen Monat ist das keine reine Kosmetik, und die App weist dich darauf hin:

- Der **Sweep** dieses Monats wird neu gerechnet. Erhöhst du nachträglich ein Budget, wandert mehr übriges Geld ins Sweep-Ziel.
- Alle **Rückstellungssaldi seither** verschieben sich entsprechend, weil sie aus den Zuteilungen aufsummiert werden.
- Die Änderung wird im **Änderungsprotokoll** (Einstellungen → Protokoll) festgehalten.

Nichts wird dabei eingefroren gespeichert und später repariert — die App rechnet diese Werte bei jedem Aufruf neu. Deshalb ist die Korrektur günstig, und deshalb ist sie sofort überall sichtbar.

## Beeinflussen Umverteilungen das Monatsbudget einer Kategorie? [#do-reallocations-affect-a-category-s-monthly-budget]

**Nein.** Eine Umverteilung (`category_reallocations`) verschiebt nur den **laufenden Saldo** zwischen **Spar-Kategorien**. Die Monatsbudget-Ansicht (Umschläge / Budget-Zusammenfassung) wird ausschliesslich aus echten `transactions`-Zeilen berechnet — Umverteilungen werden dort komplett ignoriert.

**Was das konkret heisst:**
- 100 CHF von *Urlaubsrücklage* → *Notgroschen* zu verschieben ändert beide Spar-Salden. Kein Monatsumschlag wird berührt.
- Beim Schliessen eines Scopes wird eine Umverteilung von der **Finanzierungs-Kategorie** → der **Scope-Kategorie** geschrieben. Damit diese Umverteilung wirklich einen Saldo bewegt, muss die Finanzierungskategorie eine **Spar-Kategorie** (laufender Saldo) sein. Bei einem normalen Monats-Umschlag wird die Reallocation-Zeile zwar erfasst, der *diesen Monat ausgegeben*-Wert des Umschlags ändert sich aber nicht — die Original-Buchungen aus dem Scope bleiben in den Kategorien, die du beim Buchen gewählt hast.
- **Faustregel:** Behandle Scopes als *Spar → Spar*-Bewegung. Finanziere sie aus einem Spar-Umschlag (z. B. *Spass-Topf*, *Reise-Topf*), dann erhält die Scope-Kategorie am Ende den umverteilten Gesamtbetrag.

## Könnten Umverteilungen auch Monatsbudgets beeinflussen? [#could-reallocations-be-made-to-affect-monthly-budgets-too]

Technisch ja, aber das würde die Bedeutung eines Umschlags ändern. Heute beantwortet ein Umschlag die Frage *„wie viel habe ich in dieser Kategorie diesen Monat tatsächlich ausgegeben?"* — ausschliesslich aus Buchungen, was den Abgleich mit dem Bankauszug einfach hält.

Würden Umverteilungen einbezogen, würde der Umschlag stattdessen sagen *„wie viel Budget hat diese Kategorie nach manuellen Anpassungen am Ende übrig?"* Drei Nebenwirkungen wären abzuwägen:
- **Doppelzählungs-Risiko.** Ein Scope-Schluss verteilt bereits per Umverteilung; würden Umschläge ebenfalls darauf reagieren, würde derselbe CHF doppelt in Berichten auftauchen, ausser jede Aggregation zieht die Reallocation-Seite explizit wieder ab.
- **Rückwirkende Drift.** Eine bearbeitete Umverteilung würde **stillschweigend** die Budgetzahlen vergangener Monate verändern — als Nebenwirkung einer Buchung, die man für etwas anderes gemacht hat. Das Budget eines vergangenen Monats direkt zu ändern ist etwas anderes: eine bewusste Entscheidung, mit Hinweis und Protokolleintrag.
- **Auswertungen & Prognose.** Trends, Prognose und die Budget-Balance-Karte müssten zwischen *Cash-Flow-Wahrheit* (nur Buchungen) und *Geplant-vs-angepasst-Wahrheit* (Buchungen + Umverteilungen) wählen.

Deshalb hält Cashflow die beiden Ebenen bewusst getrennt: **Buchungen** treiben Monatsumschläge, **Umverteilungen** treiben Spar-Salden und Scope-Schluss.

