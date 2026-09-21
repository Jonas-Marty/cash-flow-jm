---
title: "Generic OIDC sign-in"
description: "Settings → Integrations configures the OIDC provider (Authentik, Keycloak, Zitadel, …) that users can sign in with."
sidebar:
  icon: key-round
---

Only non-secret values live in the app database; the client secret always belongs in the auth backend's environment.

## Public client or confidential client? [#public-client-or-confidential-client]

Both work — pick one and stay consistent:

**Public client** (no secret)
- In your IdP: create the app as a *public* client with PKCE.
- Redirect URI: the callback URL shown in Settings → Integrations.
- Auth backend: set the issuer/discovery URL and client ID, **leave the secret env var unset**.

**Confidential client** (with secret)
- In your IdP: create the app as a *confidential* client and copy the generated secret.
- Auth backend: set the secret env var **in addition** to issuer and client ID.
- Never paste the secret into the app's Settings screen — that table is readable by every signed-in user.

## Which environment variables do I set? [#which-environment-variables-do-i-set]

The self-hosted auth backend (GoTrue/Supabase Auth) keys its variables by the *provider id*, and the generic OIDC provider is registered under the id `keycloak`. That id is fixed by the auth backend, so the variable names cannot be renamed — only the label in this app says “Generic OIDC”.

```bash
GOTRUE_EXTERNAL_KEYCLOAK_ENABLED=true
GOTRUE_EXTERNAL_KEYCLOAK_URL=https://auth.example.com/application/o/cashflow/
GOTRUE_EXTERNAL_KEYCLOAK_CLIENT_ID=cashflow
GOTRUE_EXTERNAL_KEYCLOAK_REDIRECT_URI=https://<supabase-host>/auth/v1/callback
# only for a confidential client:
GOTRUE_EXTERNAL_KEYCLOAK_SECRET=<client secret>
```

With a public client simply omit the last line. Restart the auth container after changing the variables.

## How do I verify the setup? [#how-do-i-verify-the-setup]

Enter the **discovery URL** (`…/.well-known/openid-configuration`) in Settings → Integrations and press **Test**. It fetches the document server-side and shows the issuer and authorize endpoint plus the round-trip time. A failing test means the URL, TLS or network path is wrong — it does *not* validate the client secret; that only shows up on a real sign-in attempt (`invalid_client`).

## Linking fails with “manual_linking_disabled” [#linking-fails-with-manual-linking-disabled]

Manual identity linking is **off by default** in the auth backend. Enable it and restart the auth container:

```bash
GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true
```

Until that variable is set, the *Link* buttons under Settings → Linked accounts and the post-login prompt return `manual_linking_disabled`. This is independent of the OIDC test, which only checks the discovery document.

## Existing account with the same e-mail [#existing-account-with-the-same-e-mail]

Signing in via OIDC with an e-mail that already has a password account does **not** create a second account when you confirm the linking prompt. You can also link and unlink methods any time under Settings → Linked accounts (requires manual linking enabled, see above).

