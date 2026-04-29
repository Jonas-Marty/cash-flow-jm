# Copilot / AI Agent Instructions

These rules apply to **any** AI assistant (GitHub Copilot, Cursor, Claude, Codex, etc.) editing this repo. The project is built and primarily edited inside [Lovable](https://lovable.dev), so all changes must remain **Lovable-compliant**: they must build, run, and round-trip through Lovable's bidirectional GitHub sync without breaking the platform's conventions.

Read [`architecture.md`](../architecture.md) and [`.lovable/plan.md`](../.lovable/plan.md) before non-trivial work — they are the source of truth for the domain model and in-flight plans. Update `architecture.md` in the same change set as any new feature, schema change, or business-rule decision.

---

## 1. Tech stack (do not change)

- **Framework:** TanStack Start v1 (React 19, Vite 7) targeting **Cloudflare Workers** (edge runtime).
- **Styling:** Tailwind CSS v4 via `src/styles.css` (`@import "tailwindcss"` + `@theme`). No `tailwind.config.js`.
- **UI:** shadcn/ui (Radix) components in `src/components/ui/`. Don't fork them ad-hoc — extend with variants.
- **State / data:** `@tanstack/react-query`, `react-hook-form` + `zod`.
- **Backend:** Lovable Cloud (managed Supabase). Client at `src/integrations/supabase/client.ts`. Types at `src/integrations/supabase/types.ts`.
- **Routing:** file-based, see §3.
- **Package manager:** `bun`. Use `bun add <pkg>` before importing a new dependency.

Other frameworks (Next.js, Remix, React Router DOM, Vue, native) are **not** supported.

## 2. Hard "do-not-touch" files

These are auto-generated or platform-managed. Never edit by hand:

- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/types.ts`
- `src/routeTree.gen.ts`
- `.env` (Supabase URL/keys are injected automatically)
- `supabase/migrations/*.sql` — migrations are immutable. Add a **new** timestamped file instead of editing an old one.
- `supabase/config.toml` project-level keys (you may add per-edge-function blocks).

## 3. File-based routing (TanStack Start)

Routes live in `src/routes/` with **flat dot-separated** names:

- `index.tsx` → `/`
- `envelopes.tsx` → `/envelopes`
- `edit.$id.tsx` → `/edit/:id`
- `api.public.transactions.ts` → `/api/public/transactions`

Required shell files (must always exist):

- `src/router.tsx`
- `src/routes/__root.tsx` (the root layout, with `shellComponent`)
- `src/routes/index.tsx`

Rules:

- Do **not** create `src/pages/`, `app/layout.tsx`, or `_app/` folders.
- Import navigation primitives from `@tanstack/react-router` (never `react-router-dom`).
- Create the route file **before** linking to it (`<Link to="...">` is type-checked).
- No trailing slashes on paths.
- Every route with a loader needs `errorComponent` + `notFoundComponent`. Root needs `notFoundComponent`. Router config needs `defaultErrorComponent`.
- Public/webhook/cron endpoints go under `src/routes/api/public/*` and **must** verify signatures / validate input themselves.

## 4. Server functions (`createServerFn`)

Folder convention under `src/server/`:

- `*.server.ts(x)` — server-only modules (DB queries, secret access). Vite blocks these from client bundles.
- `*.functions.ts(x)` — exports `createServerFn` wrappers. Safe to import from components.
- Components import `*.functions.ts`, never `*.server.ts` directly.

Canonical shape:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getUser = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.API_KEY!; // read inside .handler(), not at module top
    return fetchUser(data.id, apiKey);
  });
```

Common failure modes:

- Wrong import → must be `@tanstack/react-start` (not `@tanstack/start`, not `@tanstack/react-router`).
- `window is not defined` during SSR → a client-only module is imported at module scope. Move the import inside a function or rename the file `*.client.ts`.
- `process.env.X` undefined → you read it at module top instead of inside `.handler()`.

## 5. Cloudflare Worker runtime constraints

Server functions and SSR run on Cloudflare Workers with `nodejs_compat`. **Do not use:**

- `child_process` (spawn/exec/fork) — stubbed, throws at runtime.
- `sharp`, `canvas`, `puppeteer`, anything needing native binaries.
- `fs.watch`, `os.cpus()`, packages with `.node` files or `node-gyp`.
- `__dirname` / `__filename`.

Safe: `fs` (virtual), `path`, `crypto`, `Buffer`, `stream`, `url`, `events`, `timers`, `net`, `http`, `https`, `zlib`, `fetch`.

In `vite.config.ts` **never** set `ssr.external` or `resolve.external` for the Worker SSR environment — there is no runtime module resolution.

## 6. Lovable Cloud (Supabase) rules

- Use the existing client: `import { supabase } from "@/integrations/supabase/client";`.
- All schema changes go through **new** timestamped migration files in `supabase/migrations/`.
- Never `ALTER DATABASE postgres`. Never modify reserved schemas (`auth`, `storage`, `realtime`, `supabase_functions`, `vault`).
- Every new table needs **RLS enabled** with policies. Default to `auth.uid() = user_id`.
- **User roles** must live in a separate `user_roles` table with an `app_role` enum and a `SECURITY DEFINER` `has_role(uid, role)` function used inside RLS policies. **Never** store roles on `profiles` or `users` (privilege-escalation risk). Never check admin status in client storage.
- Foreign keys to users reference `auth.users(id)` only via a `profiles` table — do not query `auth.users` from the client.
- Prefer **validation triggers** over `CHECK` constraints for time-based rules (`expire_at > now()` etc.) — `CHECK` must be immutable.
- Default Postgres query limit is **1000 rows**; account for it before assuming "missing data" is a bug.
- Realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE public.<t>;` then subscribe via `supabase.channel(...).on('postgres_changes', ...)`.

### Auth defaults

- Standard email/password sign-up + login forms. **Never** anonymous sign-ups.
- Do **not** auto-confirm emails unless explicitly requested.
- Add Google OAuth unless explicitly told not to.

## 7. Design system (CRITICAL)

- **Never** use raw color classes (`text-white`, `bg-black`, `bg-blue-500`, `text-red-600`) in components.
- Always use semantic tokens defined in `src/styles.css`: `--background`, `--foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--ring`, etc.
- Tokens are defined in **`oklch`**. Add new tokens to `src/styles.css` before using them as Tailwind classes.
- Customize shadcn components via `cva` variants, not by overwriting their files.
- Ensure proper contrast in **both** light and dark mode (`ThemeApplier` in `__root.tsx` toggles `system|light|dark`).

## 8. AI features → Lovable AI Gateway

If a feature needs an LLM, default to the Lovable AI Gateway (no API key required from the user). Supported models include `google/gemini-2.5-pro`, `gemini-2.5-flash`, `openai/gpt-5`, `gpt-5-mini`, etc. Only suggest BYO-key providers if the user explicitly asks.

## 9. Secrets & env vars

- The auto-managed `.env` exposes `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`. Do not edit it.
- Private keys go through Lovable's secrets manager (server-only). Never commit secrets. Never `console.log` them.
- The Supabase **anon/publishable** key is safe in client code; the **service role** key is not — never put it in the client bundle.

## 10. i18n

The app is bilingual (DE primary, EN). All user-facing strings go through `useI18n()` from `src/i18n/index.tsx`. Add **both** German and English keys when introducing new copy. Keep product names ("Lovable Cloud", "Supabase", "GitHub") in English.

## 11. Code-syntax pitfalls TanStack will reject

The TanStack code-splitter and server-fn transformer are stricter than the bundler. Any of these = hard build failure:

- Duplicate imports/declarations after a search-replace edit.
- Unbalanced JSX tags or adjacent JSX siblings without a `<>...</>` wrapper.
- Breaking the `createServerFn().inputValidator().handler()` chain with a stray `;`.
- Importing a file or package that doesn't exist yet — create the file or `bun add` the package **first**.

## 12. Workflow expectations

1. **Discuss first** for broad/ambiguous requests; implement directly for narrow ones.
2. **Plan before sweeping refactors.** Big plans go in `.lovable/plan.md`.
3. **Read before edit.** Have file contents in context before patching.
4. **Small, focused components.** Refactor when files balloon.
5. **Verify changes.** Check build output, console, network, and the preview before claiming done.
6. **Update `architecture.md`** alongside schema or business-rule changes.
7. **Don't run** `npm run build`, `tsc`, `bun run build`, or migrations from a script — Lovable runs them automatically.
8. **Never** run stateful `git` commands (commit/push/checkout/reset/...) — Lovable manages git state via its bidirectional GitHub sync.

## 13. SEO baseline (every page route)

- One `<h1>`. Semantic HTML. `alt` on images.
- Per-route `head()` with unique `title` (<60 chars), `description` (<160), `og:title`, `og:description`. `og:image` only at leaf routes (root concatenates into every match).
- JSON-LD where applicable. Canonical tags. Responsive viewport (already in root).
- Lazy-load heavy assets.

## 14. When in doubt

- Search the official Lovable docs: <https://docs.lovable.dev/>.
- Re-read `architecture.md` and `.lovable/plan.md`.
- Prefer the smallest change that satisfies the request, in frontend code, with no schema impact, unless the user asked otherwise.
