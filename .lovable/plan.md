# Authentication, User Scoping & Admin Roles

## 1. Audit of current state (important)

- All tables (`accounts`, `categories`, `category_groups`, `transactions`, `recurring_rules`, `recurring_occurrences`, `category_budgets`, `transaction_tags`, `settings`) **already have a nullable `user_id` column**, but:
  - All RLS policies are `open_all` (`USING true`) → data is globally shared.
  - Insert code (e.g. `settings.tsx`, `add.tsx`) **never sets `user_id**` → existing rows have `user_id = NULL`.
  - DB functions (`process_recurring_rules`, `category_month_spending`, `ensure_month_budgets`) operate globally.
- No auth UI exists; the Supabase client already persists sessions in `localStorage`.

So existing data is **not** properly bound to a user yet. We will fix that.

## 2. Database migration

**a) Backfill + lock down `user_id**`

- Create a "legacy owner" approach: the first user who signs up after this change will claim all existing `NULL user_id` rows (one-time migration done in a server function on first admin signup).
  Make `user_id` `NOT NULL` on all 9 tables once backfilled.
- Set default `user_id = auth.uid()` on insert where applicable.
  &nbsp;

**b) Roles table (per security best practice — never store roles on profile)**

```sql
create type public.app_role as enum ('admin', 'user');
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  unique(user_id, role)
);
-- security definer has_role() function (bypasses RLS recursion)
```

First signup → automatically gets `admin` role via trigger. Subsequent signups → `user` role.

**c) Replace all `open_all` RLS policies** with per-user policies:

```sql
-- example pattern, applied to every table
drop policy open_all on public.accounts;
create policy "own rows select" on public.accounts for select using (user_id = auth.uid());
create policy "own rows insert" on public.accounts for insert with check (user_id = auth.uid());
create policy "own rows update" on public.accounts for update using (user_id = auth.uid());
create policy "own rows delete" on public.accounts for delete using (user_id = auth.uid());
```

Same for `categories`, `category_groups`, `transactions`, `recurring_rules`, `recurring_occurrences`, `settings`. For child tables (`category_budgets`, `transaction_tags`) use `EXISTS` against parent ownership.

**d) Update DB functions** to filter by `auth.uid()`:

- `process_recurring_rules`, `category_month_spending`, `ensure_month_budgets` → add `WHERE user_id = auth.uid()` (or accept user_id parameter).

**e) Auto-create `settings` row on signup** via `handle_new_user()` trigger on `auth.users`.

**f) OAuth/integration settings table (admin-only)**

```sql
create table public.auth_providers (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique, -- 'google' | 'microsoft' | 'keycloak'
  enabled boolean not null default false,
  client_id text,
  -- secrets stored as references to Supabase Vault, NOT plaintext
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
-- RLS: only admins can SELECT/UPDATE
create policy "admin read" on public.auth_providers for select using (public.has_role(auth.uid(), 'admin'));
create policy "admin write" on public.auth_providers for all using (public.has_role(auth.uid(), 'admin'));
```

## 3. Authentication UI

- New route `src/routes/auth.tsx` with **Sign in / Sign up** tabs (email + password).
  - Uses `supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })` and `signInWithPassword`.
  - Auto-confirm **disabled** by default (per Lovable guidelines) → users must verify email. We'll add a hint about checking inbox; can be toggled in Cloud settings if user wants instant signup.
- New route `src/routes/_authenticated.tsx` (pathless layout with `beforeLoad` redirecting to `/auth` if no session).
  - Move all existing routes (`/`, `/add`, `/transactions`, `/envelopes`, `/settings`) under this layout by renaming to `_authenticated.<name>.tsx`.
- `__root.tsx`: add an `AuthGate` that subscribes to `supabase.auth.onAuthStateChange` and exposes session via React context.
- `AppShell`: add user menu (email + Sign out button) in the header / mobile nav.

## 4. OAuth provider preparation

- Native Lovable Cloud Google sign-in is supported out of the box. We add a "Sign in with Google" button on `/auth` that calls `lovable.auth.signInWithOAuth('google', ...)` — gated behind the `auth_providers.google.enabled` flag (admin toggle).
- **Microsoft & Keycloak** are *not* natively supported by Lovable Cloud. We scaffold the UI + DB so you can wire them later when you self-host (Supabase supports both natively via dashboard config; for Keycloak you'd use the generic OIDC provider). The admin settings page will let you store client_id / metadata; secrets will be entered through the Cloud secrets system, not stored in DB plaintext.

## 5. Admin-only settings page

- New route `src/routes/_authenticated/settings.integrations.tsx` (sub-page of settings).
- Visible only if `has_role(uid, 'admin')`.
- Lets admin: enable/disable each provider, paste Client IDs / discovery URLs (Keycloak), and see instructions on where to set secrets (Cloud → Secrets, or env vars when self-hosting).
- Non-admins see a "Contact your administrator" message.

## 6. Code-side data scoping

- Update **all `.insert(...)` calls** to include `user_id: (await supabase.auth.getUser()).data.user?.id`. Affected files: `settings.tsx`, `add.tsx`, `envelopes.tsx`, `RecurringRulesCard.tsx`, anywhere that inserts.
- Add a small helper `getUserId()` in `src/lib/finance.ts` to centralize this.
- Queries (`.select(...)`) don't need changes — RLS will scope them automatically.

## 7. Self-hosting considerations (Coolify / docker-compose)

We won't change the build now, but the plan keeps everything compatible:

- Continue using only `import.meta.env.VITE_*` (build-time) and `process.env.*` (server runtime) — no hard-coded URLs.
- Supabase URL/key are already env-driven.
- Document in `architecture.md` how to swap the managed Supabase for a self-hosted one (Supabase has an official `docker-compose.yml`); roles/RLS work identically. Include steps how to configure Coolify.
- Keycloak: when self-hosting, you'll add it as a generic OIDC provider in Supabase's `GOTRUE_EXTERNAL_*` env vars; the admin settings page in this app stores the cosmetic config (display name, enabled flag), not the actual secrets.

## 8. Files to create / edit

**New**

- `src/routes/auth.tsx` — sign in / sign up page
- `src/routes/_authenticated.tsx` — auth guard layout
- `src/routes/_authenticated/settings.integrations.tsx` — admin OAuth settings
- `src/lib/auth.tsx` — auth context/hook (`useAuth`, `useIsAdmin`)
- 1 migration SQL file (roles, RLS replacement, backfill, triggers, auth_providers table)

**Edited**

- All existing route files moved under `_authenticated/` (rename only)
- `src/routes/__root.tsx` — auth provider wrapping
- `src/components/AppShell.tsx` — user menu + sign out
- `src/lib/finance.ts` — `getUserId()` helper, insert helpers
- `src/routes/settings.tsx`, `src/routes/add.tsx`, `src/routes/envelopes.tsx`, `src/components/RecurringRulesCard.tsx` — set `user_id` on insert
- `src/i18n/index.tsx` — auth/admin strings (DE + EN)
- `architecture.md` — document auth model + self-hosting notes

## 9. Open questions for you before implementing

1. **Existing data**: Should I (a) assign all current rows to the **first user who signs up**, or (b) you create your admin account first via email and I assign everything to that specific email? Option (b) is safer. 
  1. got with (a)
2. **Email confirmation**: Keep the standard "verify your email" flow, or auto-confirm for the first admin only (faster setup)?
  1. auto-confirm
3. **Google sign-in button on /auth**: Show it from day 1 (managed credentials) or hide until you enable it in admin settings?
  1. hide