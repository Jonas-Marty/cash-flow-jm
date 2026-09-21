---
title: "Buchungs-Verknüpfungen"
description: "Bündle mehrere einzeln gebuchte Transaktionen, die zum selben realen Einkauf gehören (Geschenkkarte auf zwei Karten gesplittet, Konzertticket + Essen vor…"
sidebar:
  icon: link-2
---

Die Buchungen zählen weiterhin einzeln in Budgets, Kategorien und KPIs — die Verknüpfung ist nur eine benannte Sicht darüber.

## Was ist der Unterschied zu Splits, Tags und Erstattungen? [#how-does-it-differ-from-splits-tags-and-reimbursements]

- **Splits** teilen **eine** Zahlung in mehrere Kategorie-Anteile **einer** Buchung.
- **Tags** sind freie Labels fürs Filtern — kein gemeinsames Metadatum.
- **Erstattungen** sind die 1:1-Verrechnung zwischen Ausgabe und Rückzahlung.
- **Verknüpfungen** bündeln N Buchungen unter einem Titel (mit optionalem Plandatum und Icon). Eine Buchung kann zu **höchstens einer** Verknüpfung gehören.

## Ändert eine Verknüpfung meine Budgets oder Auswertungen? [#does-a-link-change-my-budgets-or-kpis]

**Nein.** Die Auswertungen rechnen weiter mit dem `amount` jeder einzelnen Buchung in ihrer eigenen Kategorie und ihrem Datum. Der „Verknüpfte Gesamtbetrag" im Sheet ist rein deskriptiv — zur Orientierung, nicht zur Doppelzählung.

## Nur ein Teil einer Buchung gehört dazu [#only-part-of-a-transaction-belongs-to-the-purchase]

**Splitte die Buchung zuerst** (Neu → Splitten) und verknüpfe nur den passenden Teil. Die Verknüpfung selbst speichert keine Teilbeträge — das hält die Buchhaltung eindeutig.

## Was passiert, wenn ich die letzte Buchung entferne? [#what-happens-when-i-remove-the-last-member]

Du wirst gefragt: das Entfernen der letzten Buchung **löscht die Verknüpfung selbst**. Solange noch mehrere Mitglieder drin sind, entfernt das Löschen einer Buchung sie nur aus der Verknüpfung.

