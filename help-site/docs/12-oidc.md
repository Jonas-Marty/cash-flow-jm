---
title: "OIDC-Anmeldung (Authentik & Co.)"
description: "Unter Einstellungen → Integrationen richtest du einen OIDC-Anbieter (Authentik, Keycloak, Zitadel, …) ein, mit dem man sich anmelden kann – ganz ohne Umgebungsvariablen."
sidebar:
  icon: key-round
---

Die ganze Einrichtung passiert in der App: Speichern schreibt den Anbieter direkt in den Auth-Dienst. Das Client Secret landet nur dort, nie in der App-Datenbank, und nichts muss neu gestartet werden.

## Was lege ich beim Anbieter an? [#what-do-i-create-at-the-provider]

Eine App mit einem **Confidential Client** (mit Secret). Der Auth-Dienst verlangt ein Secret und nutzt zusätzlich PKCE.

- **Redirect-URI:** die Callback-URL, die unter Einstellungen → Integrationen steht (`https://<supabase-host>/auth/v1/callback`).
- **Scopes:** `openid`, `email`, `profile`.
- **Subject:** eine feste ID, nicht die E-Mail-Adresse. In Authentik ist das «Based on the User's hashed ID», die Voreinstellung. Ändert sich das Subject später, erkennt der Auth-Dienst dich nicht mehr.

## Wie richte ich ihn in der App ein? [#how-do-i-set-it-up-in-the-app]

1. Einstellungen → Integrationen, Abschnitt **OIDC**.
2. **Issuer- oder Discovery-URL** eintragen, bei Authentik z. B. `https://auth.example.com/application/o/<slug>/`. **Testen** holt das Discovery-Dokument und zeigt Issuer und Authorize-Endpunkt.
3. **Client ID** und **Client Secret** eintragen, einen Anzeigenamen wählen (z. B. «Authentik») und **Im Auth-Dienst speichern**.
4. **Aktiviert** einschalten. Erst jetzt erscheint der Knopf auf der Anmeldeseite.

Ist das Secret einmal gespeichert, bleibt das Feld leer. Lässt du es beim nächsten Speichern leer, bleibt das gespeicherte Secret erhalten.

Die Anmeldeseite zeigt nur Anbieter, die in den Einstellungen aktiviert **und** im Auth-Dienst eingerichtet sind. Einen Knopf ohne funktionierenden Anbieter dahinter gibt es nicht.

## Wie verbinde ich ihn mit meinem bestehenden Konto? [#how-do-i-connect-it-to-my-existing-account]

Melde dich wie gewohnt mit E-Mail und Passwort an und wähle unter Einstellungen → Verknüpfte Anmeldemethoden **Mit … verknüpfen**. Danach öffnet jede der beiden Methoden dasselbe Konto.

Meldest du dich stattdessen gleich über den Anbieter an, verknüpft der Auth-Dienst nur, wenn der Anbieter die E-Mail-Adresse als bestätigt meldet (`email_verified: true`). Authentik meldet in der Voreinstellung `false`. Dann schlägt die Anmeldung fehl, und die Anmeldeseite zeigt den Grund an.

## Die Anmeldung schlägt fehl – was nun? [#sign-in-fails-what-now]

Die Anmeldeseite zeigt die Meldung des Auth-Dienstes. Die häufigsten:

- **«Unverified email with custom:oidc»**: Siehe oben, verknüpfe über die Einstellungen.
- **Fehlerseite beim Anbieter zur Redirect-URI**: Die Redirect-URI beim Anbieter stimmt nicht genau mit der Callback-URL aus den Einstellungen überein.
- **«invalid_client»**: Client ID oder Secret sind falsch. Trage das Secret neu ein und speichere.

Ein erfolgreicher **Test** prüft nur das Discovery-Dokument, nicht Client ID und Secret.
