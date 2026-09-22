---
title: "Capturing places"
description: "Transactions can record where you paid. It is off by default — this is what gets stored, and who gets to find out about it."
sidebar:
  icon: map-pin
---

A transaction can record where you paid: coordinates, how precise the reading was, and a label like *Coop Bahnhof*. It helps you recognise a transaction later — and next time you buy something at the same place, the app offers the category and description you used before.

Because this produces a record of your movements, the feature is **off by default** and you switch it on yourself.

## Turning it on, and off again [#turning-it-on]

**Settings → Capture location.** While the switch is off, no transaction stores a place and nothing is sent to a mapping service.

With it on, the Add form takes one reading of your current position — but only for **new** transactions dated **today**. On an entry you are catching up on from last week, where you are standing now is the wrong answer anyway. The moment you touch the field yourself, the automatic reading stays out of your way.

Switching it off stops the capture immediately. Places already stored stay put — remove those on the transaction itself, or through export/import.

## What gets stored [#what-is-stored]

Per transaction, all optional:

- **Coordinates** to six decimal places, precise to roughly a handbreadth.
- **Accuracy** in metres — how sure the device was.
- **Label**, the text you see in the list.
- **Source**: `device` (measured), `search` (picked from the place search) or `manual` (pin dropped or dragged by hand).

Coordinates only exist as a pair — either both latitude and longitude, or neither. And **a place cannot be saved without a label**: a point with no name is no use in a transaction list.

Pending transactions can carry a place too, if an API client sends one. Confirming the row moves it onto the real transaction.

## Where the label comes from [#where-the-label-comes-from]

Three ways:

1. **Place search** — you type *Coop Bahnhof* and pick a result.
2. **Reverse lookup** — you capture a point or drag the pin, and the app looks up the address for it.
3. **From your own history** — when a device sends coordinates with no label, the app looks through your last 200 transactions for a place whose description matches and which is close enough. Close enough means the reported accuracy, but never less than 150 m and never more than 500 m.

When no description matches — payment terminals mostly send just *card payment* — the app counts where you have already been instead: a place you have visited **three times across at least two different days**, and which clearly outnumbers anything else nearby, names itself. If two shops in the same station come up about equally often, the app would rather say nothing than guess the wrong one.

In the third case **only the name is borrowed**. The coordinates stay exactly as the device measured them — the curated pin from last time is one tap away under **Pending**.

## Who finds out about it [#who-sees-it]

Place search and reverse lookup go to **OpenStreetMap Nominatim**, with **Photon (Komoot)** as a fallback. Both requests are made **by the server on your behalf**, so those services see this server's address rather than yours.

Two things do go straight from your browser, which makes your own IP address known:

- **Map tiles** come from `tile.openstreetmap.org` whenever a map is shown.
- *Open in OpenStreetMap* calls openstreetmap.org with the coordinates in the link.

Worth knowing: the reverse lookup runs **automatically on every pin**, not on request. If you would rather it did not, leave the switch off.

The full list is in the [privacy notice](https://cash-flow.wi-wo.ch/privacy), section 6.

## Who can read the places [#who-can-read-them]

The same answer as for everything else: coordinates and labels sit **unencrypted** in the database and the operator can read them. See [Data storage](/data-storage).

Places are **not** included in webhook payloads. If you use the AI assistant for suggestions on pending transactions, the **place label** (not the coordinates) is sent to your provider — see [AI assistant](/ai).

When a pending row carries coordinates, the **names** of up to 24 places you have saved before go along with it, so the model can tell two nearby shops apart. It gets short references (*p1*, *p2*) and answers with one of them — it is not allowed to invent a place name of its own, and it never sees a coordinate or a distance.
