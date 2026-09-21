---
title: "Grundkonzepte"
description: "Diese Bausteine arbeiten zusammen, um dir ein vollständiges Bild deines Geldes zu geben. Konto: Buchung: Kategorie"
sidebar:
  icon: book-open
---

Stell dir einen Satz Umschläge, ein Notizbuch und einen Aktenschrank vor — nur digital.

## Konto [#account]

Ein realer Geldbehälter: Bankkonto, Bargeld, Kreditkarte, Sparbuch. Jede Buchung gehört zu genau einem Konto (Übertrag zu zweien).

**Beispiel:** Du hast vielleicht *UBS Giro*, *PostFinance Spar*, *Bargeld* und *Visa Kreditkarte*. Wenn du mit der Visa einkaufen gehst, wird die Buchung auf das Konto *Visa Kreditkarte* gebucht. Wenn du am Bankomat Bargeld abhebst, ist das ein Übertrag von *UBS Giro* nach *Bargeld*.

## Buchung [#transaction]

Eine einzelne Geldbewegung: Ausgabe, Einnahme oder Übertrag. Mit Datum, Betrag, Konto, Kategorie und optional Tags, Anhängen, Notizen.

**Beispiel:** Am 5. Juni gibst du 64.50 CHF bei der Migros mit der Debitkarte aus. Das ist eine **Ausgabe** von 64.50, auf dem Konto *UBS Giro*, in der Kategorie *Lebensmittel*. Am 30. Juni zahlt dir dein Arbeitgeber 5,200 CHF Lohn — das ist eine **Einnahme** auf *UBS Giro*, Kategorie *Lohn*. 200 CHF von Giro auf Sparbuch zu überweisen ist ein **Übertrag**.

## Kategorie [#category]

Wofür das Geld war (Lebensmittel, Gehalt, Miete…). Kategorien sind gruppiert; die meisten sind monatliche *Umschläge*, für die du Budgets setzen kannst.

**Beispiel:** Du legst Kategorien an wie *Lebensmittel*, *Restaurant*, *Kaffee*, *Miete*, *Strom*, *Lohn* und *Urlaubsrücklage*. Wenn du einen Kauf erfassen willst, wählst du die Kategorie, damit die App weiss, aus welchem Umschlag das Geld kommen soll. Eine Rückerstattung von einer Freundin buchst du ebenfalls in eine Kategorie — oder lässt die Kategorie weg, damit sie dein Budget nicht beeinflusst.

## Kategoriegruppe [#category-group]

Bündelt verwandte Kategorien (z. B. *Essen* enthält Lebensmittel, Restaurant, Kaffee). Wird in Auswertungen und für gemeinsame Sweep-Einstellungen verwendet.

**Beispiel:** Deine Gruppe *Essen* enthält *Lebensmittel*, *Restaurant* und *Kaffee*. Deine Gruppe *Fixkosten* enthält *Miete*, *Versicherung* und *Telefon*. In der Aufschlüsselung unter *Auswertungen* siehst du dann die Summen pro Gruppe — und erkennst auf einen Blick, ob du mehr für Essen oder für Fixkosten ausgibst.

## Umschlag / Budget [#envelope-budget]

Der monatliche Betrag, den du in einer Kategorie ausgeben willst. Die Budget-Seite zeigt den verbleibenden Stand pro Umschlag.

**Beispiel:** Du budgetierst 400 CHF für *Lebensmittel* im Juni. Der Umschlag startet mit 400. Nach dem Einkauf bei Migros für 120 bleiben 280. Wenn du später 50 beim Bäcker ausgibst, sinkt er auf 230. Wenn du eine Rückerstattung von 30 CHF für ein gemeinsames Abendessen bekommst (verknüpft mit einer IOU), wächst der Umschlag wieder auf 260 — weil du einen Teil des Essensgeldes zurückbekommen hast.

Am Monatsende wird das, was noch im Umschlag ist (oder das Defizit), durch deine Sweep- und Rollover-Einstellungen verarbeitet.

## Scope [#scope]

Ein Filter, der die App vorbelegt — z. B. eine Reise, ein Projekt, ein gemeinsamer Haushalt. Der aktive Scope beeinflusst Übersicht, Buchungsliste und Add-Formular.

**Wofür er gedacht ist:** Ein Scope ist für **einmalige Ereignisse** (Urlaub, Musikfestival, Hochzeit), bei denen du alle dazugehörigen Ausgaben an einem Ort sammeln und dann mit einer einzigen sichtbaren Geld-Umverteilung **abschliessen** willst. Wenn du einen Scope schliesst, wird der Gesamtbetrag virtuell aus einer Finanzierungskategorie in die eigene Kategorie des Scopes verschoben — so siehst du die Gesamtkosten in einer transparenten "Zahlung".

**Wofür er NICHT gedacht ist:** Für reguläre monatliche Ausgaben. Erstelle keinen Scope für *Lebensmittel* oder *Restaurant* — die gehören in normale Budgetkategorien mit monatlichen Umschlägen.

**Beispiel:** Du erstellst einen Scope *Glastonbury 2025* mit einem geplanten Budget von 1,200 CHF, finanziert aus deiner Kategorie *Freizeit*. Während dem Festival erfasst du Tickets, Camping-Ausrüstung, Essen und Getränke — alles mit dem Scope markiert. Wenn du zurück bist, schliesst du den Scope: die App verschiebt 1,180 CHF (was du tatsächlich ausgegeben hast) von *Freizeit* nach *Glastonbury 2025*. Jetzt siehst du die gesamten Festival-Kosten als eine Zeile, und dein *Freizeit*-Umschlag wurde entsprechend reduziert. Dann schaltest du zurück auf den Standard-Scope — und dein normales Haushaltsbudget ist wieder da.

## IOU / erstattungsfähig [#iou-reimbursable]

Eine Buchung, die markiert wurde, weil dir jemand Geld schuldet (oder umgekehrt). Offene IOUs bleiben sichtbar, bis du eine Rückzahlung erfasst, sie als abgegolten markierst, abschreibst oder stornierst.

**Beispiel:** Du zahlst 120 CHF für ein Team-Abendessen mit deiner Kreditkarte; dein Kollege schuldet dir die Hälfte. Du buchst die Ausgabe als 120 CHF, aktivierst **Erstattungsfähig** und gibst *Kollegin Anna* als Gegenpartei an. Die vollen 120 belasten deinen *Restaurant*-Umschlag, aber eine offene IOU über 60 erscheint auf der Übersicht. Wenn Anna dir via TWINT zurückzahlt, erfasst du die Rückzahlung — die IOU schließt sich und dein *Restaurant*-Umschlag wird um 60 wieder aufgestockt.

## Offene Buchung [#pending-transaction]

Ein Eintrag, der aus einem externen System (oder über die öffentliche API) importiert wurde und noch nicht gebucht ist. Du prüfst und bestätigst oder lehnst ab.

**Beispiel:** Deine Bank-API schiebt eine Buchung: *Coop, 45.30 CHF, 12. Juni*. Sie landet unter **Offen**, weil die App noch nicht weiss, welcher Kategorie sie gehört. Du öffnest sie, weist *Lebensmittel* zu und klickst **Bestätigen**. Jetzt ist sie eine echte Buchung in deinem Kontenbuch.

## Wiederkehrende Regel [#recurring-rule]

Eine Vorlage, die Buchungen nach Zeitplan erzeugt (Miete, Gehalt, Abos). Einzelne Vorkommen lassen sich überspringen, ändern oder posten.

**Beispiel:** Deine Miete von 1,450 CHF fällt jeden 1. des Monats an. Du legst eine Regel an: Betrag 1,450, Kategorie *Miete*, Konto *UBS Giro*, Tag-im-Monat = 1. Die Übersicht zeigt das nächste anstehende Vorkommen. Falls du im Urlaub bist und der Vermieter die Abbuchung auf den 5. verschiebt, kannst du dieses eine Vorkommen ändern, ohne die Regel anzufassen.

**Wie der Zeitplan gebildet wird (v2-Engine):**
- **Intervall** ist eine ganze Monatszahl (1 = monatlich, 3 = quartalsweise, 12 = jährlich). Kein Wochen-Takt.
- **Ausführung** und **Berichtsperiode** werden *unabhängig* konfiguriert, jeweils mit eigener Tagesregel (`FixedDay N`, `LastDay`, `FirstDay`). Beispiel: am letzten Werktag ausführen, aber für den 1.–31. berichten.
- **Wochenend-Anpassung** (`None` / `PreviousBusinessDay` / `NextBusinessDay`) verschiebt nur das *Ausführungsdatum*; die Berichtsperiode bleibt am ursprünglichen Fälligkeitstag verankert.
- **Perioden-Verschiebung** (−3…+3) erlaubt, jetzt für eine vergangene oder zukünftige Periode zu posten (z. B. MwSt-Abrechnung im April für Q1: Offset −1).
- Beschreibung und Notiz unterstützen die Tokens `${date}`, `${dueDate}`, `${periodFrom}`, `${periodTo}`, `${runNumber}`, mit Datumsformatierern wie `dd.MM.yyyy`, `MMMM`, `Q` (Quartal), `S` (Halbjahr), `T` (Trimester), `ww` (ISO-Woche). Ältere Tokens (`${periodLabel}`, `${today}`, `${year}`, …) werden nicht mehr unterstützt — der Editor warnt, wenn eine gespeicherte Vorlage sie noch verwendet.

## Abgleich [#reconciliation]

Vergleich der App-Salden mit der Realität. Die Abgleich-Seite zeigt jede Abweichung zwischen gebuchten Salden, Sparumschlägen und ungekehrtem Geld.

**Beispiel:** Dein echter Kontoauszug sagt, dein Giro hat 3,240 CHF. Die App zeigt 3,440 CHF. Der Abgleich zeigt eine Drift von 200 CHF. Du stellst fest: du hast einen Übertrag aufs Sparbuch gebucht, aber die Gegenbuchung vergessen. Nach der Korrektur ist die Drift null — alles stimmt.

## Sweep / Sparziel [#sweep-savings-target]

Am Monatsende kann übriges Budget aus einem Umschlag in eine Sparkategorie *gekehrt* werden. Ein Standardziel und Gruppen-Overrides sind möglich.

**Was passiert mit übrigem Geld?**
Stell dir vor, dein *Lebensmittel*-Umschlag hatte 400 CHF für Juni. Du hast nur 350 ausgegeben. Am Ende des Monats können die verbleibenden 50 CHF per **Sweep** in deine *Urlaubsrücklage* (oder ein anderes konfiguriertes Sparziel) überführt werden. Die 50 CHF gelten dann als gespart, und der *Lebensmittel*-Umschlag wird für den frischen Juli auf null zurückgesetzt.

**Was passicht bei Überziehung?**
Stell dir vor, du hast 400 CHF für *Lebensmittel* budgetiert, aber 450 ausgegeben. Am Monatsende zeigt der Umschlag −50. Je nach Einstellung bleibt das Defizit bestehen (du startest den Juli bereits mit 50 im Minus), oder es wird durch *Umverteilen* von einem anderen Umschlag gedeckt. Die App verschiebt nie stillschweigend Geld — du entscheidest immer, was passiert.

Spar-Kategorien (wie *Urlaubsrücklage* oder *Notgroschen*) funktionieren anders: Sie haben einen **laufenden Saldo**, kein Monatsbudget. Geld summiert sich Monat für Monat, bis du daraus ausgibst.

## Anhang [#attachment]

Eine Datei (Quittung, Rechnung), die einer Buchung beiliegt. Optional über Nextcloud synchronisierbar.

**Beispiel:** Nach dem Bezahlen von 89 CHF beim Zahnarzt fotografierst du die Quittung und hängst sie an die Buchung an. Sechs Monate später, wenn deine Krankenkasse einen Nachweis verlangt, öffnest du die Buchung — und die Quittung ist gleich zur Hand.

## Tag [#tag]

Ein freies Label für Buchungen, das du durchsuchen kannst. Praktisch für Querschnitte, die nicht zu einer Kategorie passen (z. B. *urlaub-2025*).

**Beispiel:** Du markierst Flug, Hotel und Restaurantbesuche mit *#paris-2025*. Später suchst du nach diesem Tag und siehst die Gesamtkosten der Reise über alle Kategorien hinweg — ohne für jeden Ausgabentyp eine separate *Paris*-Kategorie anlegen zu müssen.

