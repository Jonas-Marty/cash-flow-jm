---
title: "OIDC sign-in (Authentik & co.)"
description: "Settings → Integrations sets up an OIDC provider (Authentik, Keycloak, Zitadel, …) to sign in with — no environment variables involved."
sidebar:
  icon: key-round
---

The whole setup happens in the app: saving writes the provider straight to the auth service. The client secret is kept only there, never in the app's database, and nothing needs a restart.

## What do I create at the provider? [#what-do-i-create-at-the-provider]

An app with a **confidential client** (with a secret). The auth service requires a secret and uses PKCE on top.

- **Redirect URI:** the callback URL shown under Settings → Integrations (`https://<supabase-host>/auth/v1/callback`).
- **Scopes:** `openid`, `email`, `profile`.
- **Subject:** a fixed ID, not the e-mail address. In Authentik that is "Based on the User's hashed ID", the default. If the subject changes later, the auth service no longer recognises you.

## How do I set it up in the app? [#how-do-i-set-it-up-in-the-app]

1. Settings → Integrations, section **OIDC**.
2. Enter the **issuer or discovery URL**, for Authentik e.g. `https://auth.example.com/application/o/<slug>/`. **Test** fetches the discovery document and shows the issuer and authorize endpoint.
3. Enter the **client ID** and **client secret**, pick a display name (e.g. "Authentik") and press **Save to auth service**.
4. Switch **Enabled** on. Only now does the button appear on the sign-in page.

Once the secret is stored, the field stays empty. Leave it empty on the next save and the stored secret is kept.

The sign-in page only shows providers that are enabled in Settings **and** set up in the auth service. There is never a button without a working provider behind it.

## How do I connect it to my existing account? [#how-do-i-connect-it-to-my-existing-account]

Sign in with e-mail and password as usual and choose **Link with …** under Settings → Linked sign-in methods. Afterwards either method opens the same account.

If you sign in through the provider straight away instead, the auth service only links when the provider reports the e-mail address as verified (`email_verified: true`). Authentik reports `false` by default. The sign-in then fails, and the sign-in page shows why.

## Sign-in fails — what now? [#sign-in-fails-what-now]

The sign-in page shows the auth service's message. The most common ones:

- **"Unverified email with custom:oidc"**: See above; link through Settings.
- **An error page at the provider about the redirect URI**: The redirect URI at the provider does not exactly match the callback URL from Settings.
- **"invalid_client"**: The client ID or secret is wrong. Enter the secret again and save.

A successful **Test** only checks the discovery document, not the client ID and secret.
