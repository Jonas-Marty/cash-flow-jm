# Faster account & category picker on Add Transaction

Replace the Select dropdowns for **source account**, **destination account**, and **category** on `/add` with a chip picker: each item shows an **icon, emoji, or uploaded image** + name, sorted by **manual pin** then **recency-weighted usage**. Responsive: horizontally scrollable row on mobile, wrapping grid on desktop. Tooltip-on-hover (desktop) and long-press-to-name (mobile) so icon-only chips remain discoverable.

## What changes for the user

- **Add screen**: account and category dropdowns become rows of chips. The most relevant items are visible immediately — no two-tap dropdown, no scrolling through a long list. An overflow `…` chip opens a searchable popover with the full list (covers archived items, search, and the rare ones).
- **Visual identity**: every account and category can carry an icon (Lucide), an emoji, or a custom uploaded image (e.g. bank logo, gift-card photo). Icon-only chips show the name on hover (desktop) and on long-press (mobile, ~500 ms) via an accessible tooltip. Chips with no custom visual fall back to a generated colored monogram (first letter), so the picker still works without setup.
- **Pinning**: a "pin" toggle in Settings keeps favorites at the front of the chip row regardless of usage. Everything else sorts by recency-weighted usage (30-day half-life — same scoring as the existing suggestion engine, §3.9).
- **Settings**: each account and category row gains an "Edit visual" button (icon picker, emoji picker, image upload) and a pin toggle. Hint text added.

## Layout rules

- **Mobile (<768 px)**: single horizontal scroll row, snap, hide scrollbar. Top ~10 items visible by scroll, then `…` opens the full searchable popover.
- **Desktop (≥768 px)**: chips wrap onto multiple lines, all non-archived items shown inline. No `…` overflow needed unless count exceeds ~30, then it appears.
- Selected chip: filled background + ring, others: outline. Disabled (e.g. destination = source) chips are dimmed.

## Technical details

### Schema (one migration)

Add to `accounts` and `categories`:
- `icon text` — Lucide icon name (e.g. `"wallet"`) OR `null`.
- `emoji text` — single emoji char OR `null`. (Mutually exclusive with `icon` and `image_url` at the UI level; DB allows any combo, UI picks first non-null in priority: `image_url > emoji > icon > monogram`.)
- `image_url text` — public URL to uploaded image OR `null`.
- `color text` — hex like `"#3B82F6"` for the chip background tint and monogram fallback. Default a deterministic hash-of-name color.
- `pinned boolean default false`.
- `pin_order int` — manual order among pinned items, nullable.

Storage:
- New public bucket `account-category-images` (5 MB max per file, image/* only) created via SQL migration. Anyone can read; insert/update/delete restricted to authenticated users (open RLS to match the rest of the schema for now).

### Usage stats (client-side, no schema)

Reuse the already-cached `recentTransactions` query (`fetchTransactions(200)`). Compute a `Map<id, score>` for accounts (`source_account_id` + `destination_account_id`) and categories (`category_id`) where each occurrence contributes `exp(-ageDays / 30)`. Sort: pinned (by `pin_order`) first, then by score desc, then by name. Tie-break by name. Memoised in `useMemo` keyed on the recent-tx query data.

### New components

- `src/components/ChipPicker.tsx` — generic, accepts `items: { id, name, icon?, emoji?, image_url?, color?, pinned? }[]`, `value`, `onChange`, `disabledIds?`, `responsiveLayout: "scroll-mobile-wrap-desktop"`, `overflowAfter?: number`. Renders chips, handles overflow `…` opening a `Command` (cmdk) popover with search.
- `src/components/EntityChip.tsx` — single chip: renders image | emoji | Lucide icon | monogram, name label (optionally hidden on mobile to save space), tooltip + long-press handler that triggers the same tooltip.
- `src/components/IconPicker.tsx` — small Settings widget: tabs for Icon (filtered Lucide list ~120 finance-relevant names), Emoji (native emoji picker via `<input>` or a small grid of common ones — no extra dep), Image (file upload to the storage bucket via `supabase.storage`), Color swatch. Plus pin toggle.
- `src/lib/usageScoring.ts` — pure helpers: `scoreAccounts(transactions)`, `scoreCategories(transactions)`, `sortByPinAndScore(items, scoreMap)`.
- `src/lib/iconRegistry.ts` — curated `{ name: string, Component: LucideIcon }[]` of ~120 icons grouped (banking, food, transport, home, leisure, health, gifts, generic). Lookup helper `getIcon(name)` returns `Wallet` fallback when missing.

### Edits

- `src/routes/add.tsx`:
  - Replace each `<Select>` for source/destination/category with `<ChipPicker />`.
  - Pass `disabledIds={[sourceId]}` to the destination picker.
  - Mark `mark("sourceId" | "categoryId")` on selection (preserves sticky-typing behaviour with suggestions).
  - For category, group chips visually by category-group with small group labels (only if multiple groups present). The "None" option becomes a dedicated outline chip at the start.
- `src/routes/settings.tsx`:
  - Account row: add `<EntityChip>` preview + "Edit visual" button (opens `IconPicker` in a Popover) + `Pin` toggle button (Pin/PinOff icons).
  - Category row: same treatment.
- `src/lib/finance.ts`: extend `Account` and `Category` interfaces with the new fields; no changes to fetch functions (selecting `*` already brings them in).
- `src/i18n/index.tsx`: add DE+EN keys: `picker.more`, `picker.search`, `picker.no_match`, `picker.long_press_hint`, `settings.visual.edit`, `settings.visual.icon_tab`, `settings.visual.emoji_tab`, `settings.visual.image_tab`, `settings.visual.color`, `settings.pin`, `settings.unpin`, `settings.upload_too_large`.
- `architecture.md`: new §3.10 *Entity visuals & quick-pick chips* documenting the schema fields, scoring, layout rules, and storage bucket. Change-log entry dated today.

### Long-press tooltip

Use Radix `Tooltip` with manual `open` control. Long-press handler: `onPointerDown` starts a 500 ms timer; `onPointerUp`/`onPointerLeave`/`onPointerCancel` clears it. When timer fires, open tooltip and auto-close after 1.5 s. Desktop hover uses default Radix behaviour. On touch devices, the same chip tap also selects — long-press only opens the tooltip without changing selection (we suppress the synthetic click via `e.preventDefault()` once tooltip opens).

### Out of scope

- Drag-to-reorder pinned items (use up/down arrows in Settings if needed; can add later).
- Image cropping / resizing — store as uploaded; CSS `object-cover` handles display. We cap at 5 MB upload, but no server-side resize.
- Bulk import of icons from a third-party set; just curated Lucide subset + emoji + custom upload.
- Applying chip pickers to recurring-rule editor or Settings dropdowns (deferred — Add only this round).
- Per-user pin order (project is single-tenant via open RLS; pin is global like everything else).

## Files touched

- New: `src/components/ChipPicker.tsx`, `src/components/EntityChip.tsx`, `src/components/IconPicker.tsx`, `src/lib/usageScoring.ts`, `src/lib/iconRegistry.ts`.
- Edited: `src/routes/add.tsx`, `src/routes/settings.tsx`, `src/lib/finance.ts`, `src/i18n/index.tsx`, `architecture.md`.
- Migration: add columns to `accounts` and `categories`; create `account-category-images` storage bucket with open-read policy.
