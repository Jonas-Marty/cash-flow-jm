# Inline calendar with daily heatmap on Add Transaction

Replace the date popover with an always-visible calendar that color-codes each day by net cash flow (income − expense, transfers ignored), and reveals that day's transactions on hover (desktop) or long-press (mobile).

## Behavior

- **Always visible**: The calendar renders inline on the Add screen instead of a popover trigger. The "Today / Yesterday / Last weekend" shortcuts and the selected-day indicator remain.
- **Color coding per day** (transfers excluded — they don't affect net flow):
  - No transactions → default day background (white / theme background).
  - `net == 0` and transactions exist → neutral muted tint.
  - `net < 0` (more expense than income): light red if `|net| ≤ threshold`, deeper red if above.
  - `net > 0` (more income than expense): light green if `net ≤ threshold`, deeper green if above.
- **Threshold**: configurable per user in Settings (`day_heatmap_threshold`, default `100`, in the user's currency). Stored on `settings`.
- **Day preview**:
  - Desktop: hovering a day for ~250 ms shows a popover anchored to the cell with that day's transactions (date, payee/note, signed amount, category/account chip), grouped by type, with the net at the top.
  - Mobile: same popover triggered by a ~500 ms long-press; tap-away dismisses. A tap still selects the date as before.
- **Month navigation**: standard prev/next month chevrons. Heatmap recomputes for the visible month using transactions already in the React Query cache (no extra fetch — the existing `recentQ` already loads 200 most-recent rows; we extend to a per-month query when the user navigates outside that window).
- **Selected date**: keeps the existing primary-color highlight on top of the heatmap tint.

## Layout

The calendar sits where the popover trigger button currently lives, below the Date shortcuts. On mobile it spans the full card width; on desktop it stays at its natural width, left-aligned. The old `Popover + Calendar` block is removed.

## Settings

New row in `Settings → Preferences`: "Day heatmap threshold" — numeric input with the currency symbol suffix. Persisted on the existing `settings` row.

## Technical changes

- **Migration**: add `day_heatmap_threshold numeric not null default 100` to `public.settings`.
- **`src/lib/finance.ts`**: extend `Settings` interface with `day_heatmap_threshold: number`; ensure `fetchSettings` insert defaults it.
- **`src/components/DayHeatmapCalendar.tsx`** (new): wraps `react-day-picker` (already used by `Calendar`) with:
  - `modifiers` map computed from a `Map<dateKey, { net, count, txs }>` for the visible month.
  - Custom `modifiersClassNames` for the 5 buckets (`heatExpHi`, `heatExpLo`, `heatNeutral`, `heatIncLo`, `heatIncHi`). Classes defined locally with Tailwind utilities using semantic destructive/success tokens (HSL with opacity), e.g. `bg-destructive/15`, `bg-destructive/35`, `bg-success/15`, `bg-success/35`, `bg-muted/40`.
  - Custom `DayButton` component that wraps `CalendarDayButton` in a Radix `HoverCard` (desktop) and a long-press handler (mobile, via pointerdown timer + cancel on move/up). Shared `DayPreview` content.
  - `onMonthChange` callback so the parent can prefetch transactions for the visible month if outside the cached window.
- **`src/components/DayPreview.tsx`** (new): small component listing that day's transactions with the running net, reusing `EntityChip` for the account/category visual.
- **`src/routes/add.tsx`**:
  - Remove the `Popover`-wrapped calendar.
  - Render `<DayHeatmapCalendar />` inline; pass `selected`, `onSelect`, `transactions`, `accounts`, `categories`, `threshold`, `symbol`, `locale`.
  - Drop the unused `CalendarIcon` import.
- **`src/routes/settings.tsx`**: add the threshold input in the Preferences card; on blur, `update settings` and invalidate.
- **`src/i18n/index.tsx`**: new keys (DE + EN):
  - `settings.preferences.heatmap_threshold` / `.hint`
  - `add.day_preview.title` (e.g. "Buchungen am {date}")
  - `add.day_preview.empty`
  - `add.day_preview.net`
- **`src/styles.css`** (or inline): no new tokens needed — leverages existing `--destructive` and `--success`. The 4 tint levels are simple opacity steps via Tailwind arbitrary opacity.
- **`architecture.md`**: new §3.11 *Day heatmap calendar* documenting the buckets, the threshold setting, transfer exclusion, and the hover/long-press affordance. Change-log entry dated today.

## Edge cases handled

- Transfers are excluded from net (they're internal moves).
- Days outside the current month show muted heatmap tints (or none — design choice: muted, since the user may navigate-then-pick).
- When `recentQ` (200 rows) doesn't cover the visible month, the calendar fetches the month range on demand (`occurred_on >= first` and `<= last`) and merges into a local `byDay` map.
- Long-press doesn't fire if the user starts dragging/scrolling.

## Files touched

- New: `src/components/DayHeatmapCalendar.tsx`, `src/components/DayPreview.tsx`.
- Edited: `src/routes/add.tsx`, `src/routes/settings.tsx`, `src/lib/finance.ts`, `src/i18n/index.tsx`, `architecture.md`.
- Migration: add `day_heatmap_threshold` column to `settings`.

## Out of scope

- Showing the heatmap on other screens (Transactions list, Dashboard) — easy follow-up using the same component.
- Per-account or per-category filtering of the heatmap.
- Animated transitions when navigating months.
- Configurable color palette or color-blind-friendly alternative scheme (can be added later as a settings toggle).
