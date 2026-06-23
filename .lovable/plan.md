# Persist Transaction Filters

Currently filter state on `/transactions` lives in component `useState`. Editing a transaction navigates to `/edit/$id`, which unmounts the route and discards state. Going back re-mounts with defaults.

Below are the realistic options, with trade-offs. Pick one and I'll implement.

---

## Option A — URL search params (recommended)

Encode filters into the URL via TanStack Router `validateSearch` (Zod). The transactions route becomes e.g. `/transactions?q=foo&cats=abc,___none__&from=2026-01-01&to=2026-06-30&type=expense`.

**Pros**

- Survives navigation, refresh, and browser back/forward naturally.
- Shareable / bookmarkable filtered views (e.g. send a link to "uncategorized last month").
- Plays well with TanStack Router's typed search + `useNavigate({ search })`.
- No stale-state risk across devices or sessions — what you see is what's in the URL.
- Back button after edit restores the exact view because the URL was preserved on navigation away.

**Cons**

- Slightly more code: define a Zod schema, map state ↔ search, debounce text input writes.
- URL gets long with many active filters (cosmetic).
- Need to decide defaults vs. encoded values (use `stripSearchParams` to keep URL clean).

---

## Option B — `localStorage` (or `sessionStorage`)

Persist the filter object under a key like `tx.filters.v1`; hydrate on mount, write on change.

**Pros**

- Tiny change: one `useEffect` to load, one to save. No route refactor.
- `localStorage` survives refresh and new tabs; `sessionStorage` clears with the tab.

**Cons**

- Not shareable, not bookmarkable.
- "Sticky" filters can confuse users — they come back tomorrow and wonder why the list looks empty.
- Per-browser, per-device; no sync.
- Needs a version key and migration if filter shape changes.
- SSR-unsafe at module scope (must read inside effect).

---

## Option C — In-memory store (Zustand / React context at the router level)

Lift filter state into a store that lives above the route so it survives unmount/remount within the same tab session.

**Pros**

- No URL noise, no storage I/O.
- Instant restore on back nav.

**Cons**

- Lost on refresh and new tabs (unless combined with storage).
- Not shareable.
- Adds a global store just for one screen.

---

## Option D — Server-side saved filters (per user, in DB)

New `transaction_filter_presets` table; persist "last used" plus optional named presets ("Groceries 2026", "Uncategorized").

**Pros**

- Syncs across devices.
- Enables named presets / favorites as a real feature.

**Cons**

- Largest scope: migration, RLS, server fn, UI for managing presets.
- Overkill if the goal is just "don't lose filters after editing one transaction".

---

## Option E — Hybrid: URL + remembered last view

URL is the source of truth (Option A), and on first visit with no params we hydrate from `localStorage` of the last URL used. Best UX, slightly more code than A alone.

---

## Recommendation

**Option A**. It directly fixes the back-from-edit case (the URL is preserved), adds shareability for free, and is idiomatic for TanStack Start. If you later want named presets, layer Option D on top without throwing A away.

## Technical sketch (for the chosen option)

For A: add `validateSearch` with Zod + `fallback`/defaults on `/transactions`, replace each `useState` with `Route.useSearch()` reads and `navigate({ search: prev => ({...prev, ...}) })` writes (debounced for the text query), and use `search: { middlewares: [stripSearchParams(defaults)] }` to keep URLs clean. Arrays (categories, accounts, tags) encode as comma-joined strings, dates as ISO `yyyy-MM-dd`.  
  
  
Ok please go with option A.