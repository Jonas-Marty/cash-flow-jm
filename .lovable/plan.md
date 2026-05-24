## Goal

Add **Scopes** — temporary "event" categories (vacation, wedding, project) that can be activated while adding transactions, then closed once the event ends, deducting the total from a chosen funding category in one clean reallocation.

Pure category-based model (your choice). No new tag plumbing.

---

## Concepts

- **Scope** = a regular `categories` row plus three new fields:
  - `is_scope: bool` — marks it as a scope category
  - `funding_category_id: uuid?` — where the total gets reallocated from on close (e.g. "General Savings", "Taschengeld")
  - `closed_at: timestamptz?` — when set, the scope is closed (archived from the "active scope" picker, hidden from /add category dropdown, still visible in reports)
- One scope can be **active at a time** (UI state, stored in `localStorage`). Activation is opt-in — you choose when to turn it on.
- Active scope is a *suggestion + override*: when active, the category in /add auto-fills to the scope, and is overridden if you pick something else for that transaction (e.g. the electricity bill case).

---

## UX flow

### 1. Defining scopes — `/scopes` route (no nav entry)

- Reachable from Settings → "Scopes" link and from the active-scope chip in the header.
- Lists: **Active** (open scopes) and **Closed** (history) sections.
- Each row: name, funding category, spent so far, [Activate] [Edit] [Close].
- **Create scope** form: name, funding category (dropdown of non-scope categories), optional planned budget.
- **Close scope** dialog: shows total spent, confirms "Deduct CHF 1'240 from General Savings?" → on confirm:
  - Creates one `category_reallocations` row (from = funding category, to = scope category, amount = total spent)
  - Sets `closed_at = now()`
  - Auto-deactivates if it was the active scope
  - Toast with undo (10s) that deletes the reallocation and clears `closed_at`

### 2. Activating a scope

- `/scopes` → [Activate] button on a row. Only one active at a time.
- Active scope stored in `localStorage` (key `active_scope_id`) + a tiny query cache. No DB column — it's per-device.
- A persistent **chip in the app header** (AppShell) appears when active: `🎯 Italy 2026 ▾` → click opens a popover with [Open /scopes] [Disable].

### 3. /add behavior when scope is active

- **Banner at top** of the form (colored, dismissible per-transaction):
  > 🎯 Scope active: **Italy 2026** — category will be pre-filled. Change it for unrelated transactions.
  > [Use scope ✓] [Skip for this one]
- **Per-field hint** under the Category select: "Auto-set by active scope" (muted, with a tiny "x" to clear).
- Category select is pre-filled to the scope; user can change it freely (e.g. pick "Electricity" instead) — the banner state toggles to "Skipped for this transaction" so it's obvious nothing scope-related is being applied.
- After save, the next /add visit re-applies the scope (banner shown again).
- "Save & New" preserves the scope auto-fill for the next entry.

### 4. Reporting

- Scope categories appear in normal envelope/insights views (they are categories), but get a 🎯 icon prefix and a "Scope" badge.
- On `/envelopes` and category lists, closed scopes are collapsed into a "Closed scopes" section.
- The reallocation created on close shows up in existing reallocation history (no new view needed).

---

## Technical changes

### Database (one migration)

```sql
ALTER TABLE categories
  ADD COLUMN is_scope boolean NOT NULL DEFAULT false,
  ADD COLUMN funding_category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  ADD COLUMN closed_at timestamptz;

CREATE INDEX idx_categories_is_scope ON categories(user_id, is_scope) WHERE is_scope = true;
```

No new table — scope == category with `is_scope=true`. Reuse existing `category_reallocations` for the close-out movement.

### Files to touch

- **`src/routes/scopes.tsx`** (new) — list + create + edit + close UI. Uses new helpers in finance.ts.
- **`src/components/ActiveScopeChip.tsx`** (new) — header chip, mounted in `AppShell.tsx`.
- **`src/components/AppShell.tsx`** — render the chip when an active scope exists.
- **`src/routes/add.tsx`** — read active scope (hook), render banner + per-field hint, pre-fill category, track "skip for this transaction" state. Affects the existing `category` field state and the new ImpactPreview (the scope category's "Remaining" naturally appears).
- **`src/routes/settings.tsx`** — add "Scopes" link/button in an appropriate section.
- **`src/lib/finance.ts`** — `fetchScopes()`, `fetchScopeTotal(scopeId)`, `createScope()`, `updateScope()`, `closeScope(scopeId)` (does the reallocation insert + sets closed_at atomically via server fn), `reopenScope()` for undo.
- **`src/lib/activeScope.ts`** (new) — `useActiveScope()` hook reading/writing localStorage + broadcasting changes via a small event emitter so AppShell chip and /add stay in sync.
- **`src/i18n/index.tsx`** — DE/EN keys: `scopes.title`, `scopes.create`, `scopes.funding_from`, `scopes.activate`, `scopes.deactivate`, `scopes.close`, `scopes.close_confirm`, `scopes.banner.active`, `scopes.banner.skip`, `scopes.field_hint`, `scopes.closed_label`, `scopes.empty`.
- **Category dropdowns** elsewhere (recurring rules, transactions filter) — filter out `closed_at IS NOT NULL` scopes by default; show them in archived/closed lists.

### Close-scope server function (atomicity)

`closeScope(scopeId)` runs as a single server fn:
1. Compute `total = sum(transactions where category_id = scopeId)` for this user.
2. Insert `category_reallocations` (from = funding, to = scope, amount = total, note = "Close scope: …").
3. `UPDATE categories SET closed_at = now() WHERE id = scopeId`.

If `funding_category_id IS NULL`, skip step 2 and just mark closed (with a warning toast on the client before calling).

### Edge cases handled

- Funding category deleted/archived → on close, prompt to pick a new one.
- Re-activating a closed scope (re-open) → server fn deletes the close-out reallocation if it exists and clears `closed_at`.
- Two devices → active scope is per-device (localStorage). The scope itself is shared (DB).
- ImpactPreview already shows category remaining changes, so adding to a scope category will naturally show "Italy 2026: 240 → 180 (spent)".

---

## Open questions (defaults assumed)

1. **Planned budget on scopes?** Default: yes — reuse existing `allocated_budget` column so envelope view shows progress vs plan. Free if 0.
2. **Multiple active scopes simultaneously?** Default: no, one active at a time keeps the /add UX unambiguous.
3. **Auto-deduct from funding's allocated each month while open?** Default: no — funding only moves on close, matching your choice.

Going with these defaults unless you say otherwise.