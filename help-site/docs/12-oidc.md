---
title: "Generic-OIDC-Anmeldung"
description: "Unter Einstellungen → Integrationen konfigurierst du den OIDC-Provider (Authentik, Keycloak, Zitadel, …), mit dem sich Nutzer anmelden können."
sidebar:
  icon: key-round
---

In der App-Datenbank stehen nur nicht-geheime Werte; das Client Secret gehört immer in die Umgebung des Auth-Backends.

## Public Client oder Confidential Client? [#public-client-or-confidential-client]

Beides funktioniert — entscheide dich für eine Variante:

**Public Client** (ohne Secret)
- Im IdP: App als *public* Client mit PKCE anlegen.
- Redirect-URI: die Callback-URL aus Einstellungen → Integrationen.
- Auth-Backend: Issuer/Discovery-URL und Client-ID setzen, die **Secret-Variable weglassen**.

**Confidential Client** (mit Secret)
- Im IdP: App als *confidential* Client anlegen und das Secret kopieren.
- Auth-Backend: die Secret-Variable **zusätzlich** setzen.
- Das Secret niemals in die App-Einstellungen eintragen — diese Tabelle ist für alle angemeldeten Nutzer lesbar.

## Welche Umgebungsvariablen brauche ich? [#which-environment-variables-do-i-set]

Das selbst gehostete Auth-Backend (GoTrue/Supabase Auth) benennt seine Variablen nach der *Provider-ID*, und der generische OIDC-Provider ist dort unter der ID `keycloak` registriert. Diese ID gibt das Auth-Backend vor, die Variablennamen lassen sich also nicht umbenennen — nur die Beschriftung in dieser App heisst „Generic OIDC“.

```bash
GOTRUE_EXTERNAL_KEYCLOAK_ENABLED=true
GOTRUE_EXTERNAL_KEYCLOAK_URL=https://auth.example.com/application/o/cashflow/
GOTRUE_EXTERNAL_KEYCLOAK_CLIENT_ID=cashflow
GOTRUE_EXTERNAL_KEYCLOAK_REDIRECT_URI=https://<supabase-host>/auth/v1/callback
# nur bei Confidential Client:
GOTRUE_EXTERNAL_KEYCLOAK_SECRET=<client secret>
```

Bei einem Public Client lässt du die letzte Zeile einfach weg. Nach Änderungen den Auth-Container neu starten.

## Wie prüfe ich die Konfiguration? [#how-do-i-verify-the-setup]

Trage die **Discovery-URL** (`…/.well-known/openid-configuration`) unter Einstellungen → Integrationen ein und klicke **Test**. Das Dokument wird serverseitig geladen und Issuer, Authorize-Endpoint und Laufzeit werden angezeigt. Ein Fehler bedeutet falsche URL, TLS- oder Netzwerkprobleme — das Client Secret wird dabei *nicht* geprüft, ein falsches Secret zeigt sich erst beim echten Login (`invalid_client`).

## Verknüpfen schlägt mit „manual_linking_disabled“ fehl [#linking-fails-with-manual-linking-disabled]

Manuelles Identity-Linking ist im Auth-Backend **standardmässig deaktiviert**. Aktiviere es und starte den Auth-Container neu:

```bash
GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true
```

Solange die Variable fehlt, liefern die *Verknüpfen*-Buttons unter Einstellungen → Verknüpfte Konten und der Hinweis nach dem Login `manual_linking_disabled`. Das hat nichts mit dem OIDC-Test zu tun, der nur das Discovery-Dokument prüft.

## Bestehendes Konto mit gleicher E-Mail [#existing-account-with-the-same-e-mail]

Meldest du dich per OIDC mit einer E-Mail an, die bereits ein Passwort-Konto hat, entsteht kein zweites Konto, sofern du die Verknüpfung bestätigst. Methoden lassen sich jederzeit unter Einstellungen → Verknüpfte Konten verbinden und trennen (setzt aktiviertes manuelles Linking voraus, siehe oben).

