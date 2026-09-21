---
title: "Data storage & privacy"
description: "Where this instance keeps your data, why it is stored unencrypted, what that means in practice, and how to run your own instead."
sidebar:
  icon: shield
---

## Where is my data stored? [#where-is-my-data-stored]

This instance is hosted on a **private homelab server in Switzerland**, operated by an individual (not a company or cloud provider). It is not located in a commercial data center.

## Is my data encrypted? [#is-my-data-encrypted]

**No.** Data is currently stored **unencrypted** at rest in the database. The server operator has full technical access to the database and can read any information you enter (descriptions, amounts, notes, attachments, tags, account names, etc.).

## What does this mean for me? [#what-does-this-mean-for-me]

Only enter information you are comfortable with the server operator being able to read. Avoid storing highly sensitive data (passwords, full IBANs you wouldn't share, medical references, etc.).

## How is this handled legally? [#how-is-this-handled-legally]

See the [Privacy Policy / GDPR notice](https://cash-flow.wi-wo.ch/privacy) — you accepted it at sign-up. It explains who the data controller is, what is stored, and your rights under GDPR / DSGVO.

## Can I run my own instance? [#can-i-run-my-own-instance]

Yes. The project is open source. See the [GitHub repository](https://github.com/Jonas-Marty/cash-flow-jm) — the README explains how to build and how to deploy against your own Supabase instance.

