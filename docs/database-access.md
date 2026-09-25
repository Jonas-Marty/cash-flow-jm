# Looking at the production database directly (DBeaver)

For the rare case the app is not enough. Studio (the web data browser) is gone;
use a desktop client through an SSH tunnel instead.

**Prerequisite:** the prod compose file publishes Postgres on the host's
loopback only, `127.0.0.1:54322` (service `db`, `ports: - 127.0.0.1:54322:5432`).
Nothing on the network can reach that port; only a process on the server — or
an SSH tunnel into it — can.

## DBeaver (recommended — free, handles Postgres fully)

1. **New Database Connection → PostgreSQL.**
2. **Main tab**
   - Host: `127.0.0.1`, Port: `54322`, Database: `postgres`
   - Username: `postgres`
   - Password: `POSTGRES_PASSWORD` from Dokploy → Cash Flow → production →
     supabase → Environment. Don't save it in DBeaver unless your DBeaver
     workspace is encrypted.
3. **SSH tab** → *Use SSH Tunnel*
   - Host/IP: the server, port `22`
   - User: your SSH user, authentication: your private key
4. **Test Connection**, then Finish.

## HeidiSQL (works too)

Network type *PostgreSQL (TCP/IP)*, hostname `127.0.0.1`, port `54322`, user
`postgres`, database `postgres`; on the *SSH tunnel* tab, the server and your
key (HeidiSQL needs `plink.exe` for this). Fine for browsing tables and running
SQL; for roles, RLS policies and functions DBeaver is the better tool.

## Before you change anything

- **You are superuser-adjacent and bypass RLS.** `postgres` sees every user's
  rows. Read freely; write carefully.
- **Take a backup first:** Dokploy → supabase → Backups → run
  `backup-copy-neural-capacitor-pslgvo` manually.
- **Wrap edits in a transaction** (DBeaver: switch to *Manual commit*), check
  the result, then commit.
- **Schema changes belong in `supabase/migrations/`**, not in a client: the
  migrate sidecar applies those on deploy, and dev gets them the same way.
- Tables that are only meaningful to the auth service (`auth.*`) and to
  storage (`storage.*`) should not be edited by hand at all.
