---
title: "FinReader (Android)"
description: "Die Begleit-App liest Zahlungsmeldungen auf dem Handy mit — was sie sendet, wohin der Text weitergeht und wie du sie einrichtest."
sidebar:
  icon: smartphone
---

FinReader ist eine kleine Android-App, die die **Benachrichtigungen deiner Bank-Apps mitliest** und daraus offene Buchungen macht. Statt jede Kartenzahlung abends von Hand nachzutragen, liegt sie beim nächsten Öffnen schon unter **Offen** und wartet auf eine Kategorie.

FinReader gehört nicht zu diesem Repository und ist keine öffentliche App. Sie wird als signiertes APK unter `apk.wi-wo.ch` verteilt, hinter einem Login — wer diese Instanz selbst hostet, kann sie nicht mitbenutzen. Die Schnittstelle, die sie nutzt, ist dagegen offen: die [öffentliche API](/api) steht jedem Client offen, den du dir schreibst.

## Wie es zusammenhängt [#how-it-works]

1. Deine Bank-App zeigt eine Benachrichtigung: *Belastung CHF 45.30, Coop Genossenschaft*.
2. FinReader liest sie mit, zieht Betrag, Datum und Text heraus.
3. Sie schickt das mit deinem API-Token an `/api/public/pending-transactions`.
4. Die Zeile erscheint in der App unter **Offen**.
5. Du prüfst, wählst eine Kategorie und bestätigst — erst dann wird daraus eine echte Buchung.

Schritt 5 lässt sich nicht überspringen. Nichts, was von aussen kommt, landet ungefragt in deinem Kontenbuch.

## Einrichten [#setup]

1. In der App unter **Einstellungen → API-Tokens** ein Token anlegen. Es wird nur einmal angezeigt.
2. Das Token in FinReader eintragen.
3. FinReader die Android-Berechtigung *Benachrichtigungszugriff* geben — ohne sie kann sie nichts lesen.
4. Auswählen, welche Apps mitgelesen werden sollen.

Leg für FinReader ein **eigenes** Token an. Wird das Handy verloren, ziehst du dieses eine zurück, und alles andere läuft weiter. Ein Token kann allerdings alles — siehe [Ein Token kann alles](/api#no-scopes).

## Doppelte Meldungen [#duplicates]

Android stellt Benachrichtigungen gern mehrfach zu, und die Verbindung im Zug ist, was sie ist. FinReader schickt deshalb zu jeder Zeile eine eigene Kennung mit. Kommt dieselbe zweimal an, gibt die App die bestehende Zeile zurück, statt eine zweite anzulegen — siehe [Zweimal schicken ist sicher](/api#idempotency).

## Was mitgeschickt wird [#what-is-sent]

Betrag, Datum, Zielkonto — und der **ursprüngliche Benachrichtigungstext**, damit du beim Prüfen siehst, worum es ging. Schickt das Handy Koordinaten mit, kommen auch die mit; siehe [Orte erfassen](/location).

Dieser Benachrichtigungstext ist der Punkt, an dem du kurz nachdenken solltest: **hast du den KI-Assistenten für Vorschläge zu offenen Buchungen eingerichtet, geht er an deinen KI-Provider.** Das ist der einzige KI-Aufruf in der App, den du nicht selbst auslöst — er läuft automatisch, sobald eine unkategorisierte Zeile ankommt. Was dabei genau übertragen wird, steht unter [KI-Assistent](/ai) und im [Datenschutzhinweis](https://cash-flow.wi-wo.ch/privacy), Abschnitt 6a.

Ohne eingerichtete KI-Verbindung verlässt der Text den Server nicht.
