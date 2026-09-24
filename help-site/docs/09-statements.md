---
title: "Auszüge importieren"
description: "Einen Auszug als PDF, Bild oder CSV hochladen, die Zeilen gegen dein Kontenbuch abgleichen und sehen, was fehlt, doppelt ist oder falsch gebucht wurde."
sidebar:
  icon: file-text
---

Die KI liest die Zeilen aus, danach vergleicht die App sie mit deinen Buchungen und zeigt Fehlendes, Doppeltes oder falsch Gebuchtes.

## Welche Dateitypen kann ich hochladen? [#which-file-types-can-i-upload]

- **PDF** — der digitale Auszug der Bank. Der Text wird lokal extrahiert, nur der Text geht an deinen KI-Endpoint.
- **Bilder** — PNG, JPEG, WebP oder GIF, z. B. ein **Foto oder Screenshot** eines Papierauszugs oder der Banking-App. Das Bild wird als Bild an den KI-Endpoint geschickt — die Verbindung für *Auszug auslesen* muss also Vision unterstützen.

Ein gescanntes PDF ohne Textebene kann nicht gelesen werden — mach stattdessen ein Foto/Screenshot davon und lade dieses als Bild hoch.

## Wie importiere ich einen Auszug? [#how-do-i-import-one]

1. **Auszüge** öffnen und das passende **Konto** wählen.
2. Datei wählen (PDF, CSV oder Bild) — vom Gerät oder, wenn Nextcloud verbunden ist, über **Oder aus Nextcloud wählen**. Eine Datei aus Nextcloud holt der Server direkt ab; die App speichert keine Kopie, sondern einen Link darauf.
3. **Datumstoleranz** setzen (Standard 3 Tage) — Buchungsdaten in App und Bank stimmen selten exakt überein.
4. **Beträge invertieren** aktivieren, wenn der Auszug Ausgaben positiv darstellt (bei Kreditkarten üblich).
5. Import starten: Die KI extrahiert die Zeilen, danach vergleicht ein deterministischer Abgleich sie mit deinen Buchungen.

## Wie funktioniert der Abgleich? [#how-does-matching-work]

Der Abgleich passiert im Code, nicht in der KI:
- **Betrag muss auf den Rappen stimmen.** Splits werden vorher pro Split-Gruppe summiert.
- **Datum** muss im Toleranzfenster liegen.
- **Textähnlichkeit** sortiert nur die Kandidaten und entscheidet *exakt* vs. *wahrscheinlich* — sie erzeugt nie allein einen Treffer.
- Jede Buchung kann **höchstens einmal** zugeordnet werden, gleiche Beträge werden also nie doppelt gematcht.

## Was bedeuten die Gruppen im Ergebnis? [#what-do-the-result-groups-mean]

- **Fehlend** — steht im Auszug, fehlt in der App. Mit einem Klick anlegen (Add-Formular ist vorausgefüllt). In der Tabelle schlagen Beschreibung und Tags beim Tippen vor, was du schon verwendet hast.
- **Wahrscheinlich** — vermuteter Treffer; bestätigen oder zurücksetzen.
- **Zugeordnet** — exakte Treffer, nichts zu tun.
- **Ignoriert** — Zeilen, die du als irrelevant markiert hast (Gebühren, Saldovorträge).
- **Nicht im Auszug** — Buchungen in der App im Auszugszeitraum, die der Auszug nicht enthält: meist Duplikat, falsches Datum oder falsches Konto.

## Was wird an den KI-Provider gesendet? [#what-is-sent-to-my-ai-provider]

Das hängt vom Dateityp ab. **CSV und TSV werden vollständig lokal gelesen — dabei geht gar nichts an einen Provider.** Bei einem PDF wird die enthaltene Textebene ausgelesen und in Stücken verschickt; bei einem Bild das Bild selbst.

Danach läuft automatisch ein zweiter Durchgang, der Zeilen zu kategorisieren versucht, die der Abgleich keiner Buchung zuordnen konnte. Dieser Durchgang schickt zusätzlich einen **Überblick über dein Kontenbuch** mit — Konten, Kategorien und deine jüngsten Buchungen —, weil er ohne diesen Kontext nicht raten kann, wohin eine Zeile gehört. Der Abgleich selbst läuft ohne KI auf dem Server.

Verbindungen wählst du unter **Einstellungen → KI-Assistent**, getrennt für *Auszug auslesen* und *Zeilen kategorisieren*; der übliche Fallback auf die nächste aktive Verbindung gilt.

