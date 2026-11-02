---
title: "Bildschirme"
description: "Was jede Hauptseite der App zeigt und wofür du sie benutzt — von der Übersicht über die Budgets bis zum Abgleich und den Einstellungen."
sidebar:
  icon: layout-dashboard
---

## Übersicht (/) [#dashboard]

Deine Startseite. Zeigt Kontosalden (Aktiva / Passiva), Monats-Budget, offene IOUs (nach Person gruppiert), zu bestätigende Buchungen, anstehende wiederkehrende Posten, Top-Buchungen, Tages-Heatmap und Trends. Jede Karte führt zur passenden Detailseite.

## Buchungen (/transactions) [#transactions-transactions]

Die vollständige Liste. Filter nach Datum, Konto, Kategorie, Typ, Scope oder Tag. Der Betragsfilter versteht Operatoren wie `>100`, `<=50`, `10-30` oder `=42`. Zeile antippen zum Bearbeiten oder Löschen.

Umbuchungen zwischen deinen Konten sind in der Tabelle markiert: statt eines Budgets steht *Umbuchung*, die Kontospalte zeigt Quelle → Ziel, und kommt auf dem Zielkonto ein anderer Betrag an (etwa in einer anderen Währung), steht er neben dem Betrag.

## Neu (/add) [#add-add]

Formular für neue Buchungen. Typ (Ausgabe / Einnahme / Übertrag), Betrag, Datum, Konto und Kategorie. Optional: Gegenpartei, Scope, Tags, Anhänge, Notizen und das *erstattungsfähig*-Flag für IOUs. Vorschläge füllen Felder automatisch.

## Budgets (/envelopes) [#envelopes-envelopes]

Monatsansicht deiner Umschläge, so kompakt, dass du auf einen Blick siehst, wo du im Plan bist. Mit den Pfeilen wechselst du den Monat, über den Monatsnamen wählst du direkt einen aus. Rollover und Sweep-Ziele konfigurierst du in **Einstellungen → Sparen & Sweeps**.

**Oben** stehen vier Kennzahlen:
- **Ausgaben Monatsbudgets** — ausgegeben (inkl. offener wiederkehrender Buchungen) von geplant, nur für Umschläge ohne Übertrag.
- **Übrig** — was auf diesen Umschlägen noch übrig ist. Umschläge mit Übertrag (↻) zählen hier bewusst nicht mit: Geld, das über Monate für eine Rechnung angespart wird, würde sonst jeden Monat als „übrig“ erscheinen.
- **Status** — wie viele Umschläge **überzogen** sind, oder *alles im Plan*.
- **Einnahmen** — erhalten von erwartet.

Darunter zeigt ein Balken den ganzen Monat. Ist der Plan nicht ausgeglichen — die Budgets verteilen weniger oder mehr als das Einnahmenziel —, steht der Unterschied darunter: Er landet in bzw. fehlt in *Nicht zugeordnet*.

**Jeder Umschlag ist eine Zeile** in seiner Gruppe (Einnahmen zuerst, dann in der Reihenfolge aus den Einstellungen): links der Status, in der Mitte der Balken, rechts was übrig ist oder um wie viel er überzogen ist. Eine Gruppe wird rot, sobald ein Umschlag darin überzogen ist, und grün, wenn alle aufgebraucht sind. Auf dem Handy ersetzt ein Ring den Balken.
- Ein Umschlag mit Übertrag zeigt *von Plan ± Übertrag ↻*: Was aus früheren Monaten übrig blieb (oder fehlt), zählt mit.
- Spar-Umschläge zeigen keinen Balken, sondern ihren Stand und die Veränderung in diesem Monat.
- Ein **offen**-Abzeichen markiert wiederkehrende Buchungen, die diesen Monat noch fällig sind. Sie zählen schon als ausgegeben, damit du eine Überschreitung vorher siehst. Einträge im Posteingang unter *Offen* (z. B. von FinReader) zählen nicht.
- Ein **archivierter** Umschlag erscheint blass mit *archiviert* nur in Monaten, in denen er Buchungen hat. Er zeigt nur, was gebucht wurde, und zählt in keine Summe.

**Tippe auf eine Zeile**, um sie aufzuklappen — mehrere gleichzeitig sind möglich. Du siehst die Kennzahlen des Umschlags, ein Diagramm der letzten fünf Monate (jeder mit seinem damaligen Budget als gestrichelte Linie, Rückerstattungen verrechnet) und alle Einträge des Monats. Dazu die Schaltflächen **Budget ändern**, **Umschichten** (nur bei Umschlägen mit Übertrag und Spar-Umschlägen), **Verlauf** und **Alle Buchungen**.

**Budget ändern** — oder *Budget ‹Monat› bearbeiten* unter dem Monatsbalken — öffnet ein Seitenfenster (auf dem Handy von unten) mit **allen Budgets des Monats**, der Cursor im Umschlag, von dem du kamst. Das geht in jedem Monat, auch in einem vergangenen.
- Oben wählst du einmal für alle Änderungen: **Ab diesem Monat** oder **Nur ‹Monat›**. Würde „Ab diesem Monat“ spätere, bereits anders geplante Monate überschreiben, steht das beim Feld (*überschreibt Dez 26 (320.00)*).
- Die Bilanz darüber rechnet laufend mit: Einnahmen (Ziel) − Ausgaben − Sparen = *Nicht verplant* bzw. *Überplant*.
- Unter jedem Feld: bisher ausgegeben bzw. erhalten, der Übertrag, der Durchschnitt der letzten fünf Monate und der alte Wert. Liegt das neue Budget unter dem bereits Ausgegebenen, wird das rot angezeigt.
- **Enter** springt ins nächste Feld, **⌘/Strg + Enter** speichert. Alle Änderungen werden zusammen gespeichert. Schliesst du mit ungespeicherten Änderungen, fragt die App zuerst.
- Für mehrere Monate am Stück führt der Link **Zur Jahresansicht** in die Tabellenansicht (siehe unten).

Auf einem breiten Bildschirm kannst du oben rechts auf die **Tabellenansicht** umschalten: Umschläge untereinander, zwölf Monate nebeneinander. Damit siehst du die Entwicklung eines Umschlags über das Jahr und planst mehrere Monate am Stück.

- **Enter** speichert den einzelnen Monat, **⌘/Strg + Enter** überträgt den Wert bis zum rechten Rand.
- Der **Pfeil** in einer Spaltenüberschrift überträgt den ganzen Monat in alle folgenden Monate. So legst du im Dezember den Januar und alles danach an.
- Wenn du mit der Maus über einen dieser Pfeile fährst, zeigen die betroffenen Zellen vorher an, was sich ändern würde: der alte Wert durchgestrichen, der neue daneben.
- Der **Pfeil nach links** in der Spalte links neben dem ältesten Monat legt genau diesen einen Monat an, mit den Werten des ältesten. So verlängerst du die Historie Schritt für Schritt nach hinten. Auch das hat Folgen: der neue Monat ist bereits vorbei, sein Übertrag wird berechnet, und alle Rückstellungssaldi seither verschieben sich.
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
- **Offene IOUs** — gebuchte erstattungsfähige Transaktionen, die noch offen sind, nach Person gruppiert, grösster offener Betrag zuerst. Schuldet dir jemand mehrere Posten, erfasst **Alles zurückgezahlt** eine einzige Rückzahlung für alle.
- **Abgelehnt** — abgelehnte Einträge (zur Nachvollziehbarkeit, wiederherstellbar).
- **Bestätigt** — bereits bestätigte Einträge; die echte Buchung findest du in Buchungen.

In der Tabelle unter *Offen* kreuzt du Zeilen an und bestätigst oder lehnst sie gesammelt ab; das **Häkchen** in einer Zeile (auf dem Handy *Bestätigen*) bestätigt nur diese eine, **Bearbeiten** öffnet sie im Buchungsformular, etwa zum Aufteilen. Ein gesetzter Ort lässt sich über das kleine **×** am Orts-Symbol wieder entfernen.

Beschreibung und Bemerkung schlagen beim Tippen vor, was du schon verwendet hast, wie im Formular *Hinzufügen*: frühere Beschreibungen, und nach `#` deine Tags.

## Abgleich (/reconcile) [#reconcile-reconcile]

Zerlegt deine Kontosumme in die Umschläge, die sie halten: übertragende Umschläge, der Rest des laufenden Monats auf den übrigen Umschlägen, noch nicht eingetroffenes Einkommen, Geld das dir geschuldet wird, und alles nicht Zugewiesene. Die letzte Zeile ist das, was keiner davon erklärt — sie sollte null sein. Ist sie es nicht, fehlt irgendwo tatsächlich eine Zuordnung.

## Scopes (/scopes) [#scopes-scopes]

Anlegen, bearbeiten und wechseln von Scopes (Reisen, Projekte, gemeinsame Haushalte). Der aktive Scope erscheint als Chip im Header und beeinflusst Übersicht, Add-Formular und Kategorie-Vorgaben.

## Einstellungen (/settings) [#settings-settings]

Sämtliche Konfiguration:
- **Konten** — deine realen Konten.
- **Kategorien & Budgets** — Wofür und wie viel. Mit eigenem Monatswechsler: die Beträge gehören zum gewählten Monat. Hat ein Umschlag im laufenden Monat Buchungen oder ein Budget, fragt die App vor dem **Archivieren** nach: Er verschwindet aus der Budget-Übersicht und dem Monatseditor, seine Buchungen bleiben, und das Budget dieses Monats wird am Monatsende wie bisher abgerechnet.
- **Sparen & Sweeps** — wohin Restbudget am Monatsende fließt.
- **Wiederkehrende Regeln** — automatisches Posten.
- **API-Tokens** — für die öffentliche REST-API.
- **Nextcloud** — Cloud-Speicher für Anhänge.
- **KI-Assistent** — Verbindungen zu deinem eigenen Modell und welche Aufgabe an welcher hängt.
- **KI-Nutzung** — führt zur Seite mit dem Token-Verbrauch nach Verbindung, Modell oder Funktion ([mehr](/ai#usage)).
- **KI-Protokoll** — jede Anfrage an deinen Provider, mit Auszügen aus dem Gesendeten.
- **Webhooks** — eine externe Adresse bei jeder neuen Buchung benachrichtigen.
- **Integrationen** — Anmeldung über einen OIDC-Provider.
- **Verknüpfte Konten** — Anmeldeverfahren deines Accounts.
- **Ort erfassen** — der Schalter für Standortdaten; standardmäßig aus.
- **Audit-Log** — letzte Änderungen.
- **Export / Import** — Daten ein-/ausspielen (auch fürs Selbsthosten).
- **Über** — welche Version und welcher Commit gerade läuft.

