## What's actually happening

Both symptoms have the same root cause: the dashboard page is wider than the mobile viewport, so Android Chrome shrinks-to-fit. After shrinking:

- The CSS media query `@media (max-width: 767px)` no longer matches (computed width is ~864px), so `.mobile-bottom-nav` (which is `md:hidden`) disappears — that's why the bottom menu only reappears when you zoom out (zoom = bring real viewport back to actual width).
- The AI bubble uses `fixed right-4`, which pins to the (wider) layout viewport's right edge, so it floats far away from the visible content on the right.

The first screenshot confirms it: no bottom nav at all, and content laid out at ~864 CSS px even though the device is 411 px.

## Fix

1. **Stop horizontal overflow at the shell.** In `src/components/AppShell.tsx`, add `overflow-x-clip` to the root wrapper `<div className="min-h-screen ...">` and to `<main className="app-main ...">`. This prevents any single rogue child from triggering Android's shrink-to-fit behavior, which restores the `md:hidden` bottom nav and re-anchors the bubble to the real viewport.

2. **Find and fix the actual overflow source.** Reproduce locally with Playwright at 411×785, signed in, on `/`, and inspect `document.documentElement.scrollWidth`. Walk children with `scrollWidth > clientWidth` to identify the offender. Likely candidates based on a quick audit:
   - `UpcomingCard` / `OpenIOUsCard` / `PendingConfirmationsCard` rows with long descriptions or amounts that don't truncate.
   - `TopMonthTransactionsCard` amount column without `min-w-0` on the text wrapper.
   - `TrendStripCard` chart container assuming a min width.
   - The mobile `ActiveScopeChip compact` row at the top of `<main>` if the scope label is long.

   Apply targeted fixes (add `min-w-0` to flex children, `truncate` on long text, `overflow-hidden` on chart wrappers) so the page genuinely fits at 411 px even without the safety net.

3. **Re-anchor the AI bubble visually.** Once overflow is gone, `right-4` will sit correctly. No code change needed unless the user still wants it closer to content — in that case, add `right-3` on mobile and keep `md:right-6`.

## Verification

- Playwright at viewport 411×785, signed-in session restored via `LOVABLE_BROWSER_SUPABASE_*` env vars, navigate to `/`. Screenshot must show:
  - Bottom nav (Dashboard / Transactions / + / Envelopes / More) visible at the bottom.
  - AI bubble sitting ~16 px from the right edge of the visible viewport, just above the bottom nav.
  - `document.documentElement.scrollWidth === window.innerWidth` (logged to stdout).
- Repeat at 360×780 (smallest common Android) to make sure nothing else overflows.

## Out of scope

- Any redesign of the dashboard cards or the bottom nav itself.
- Desktop layout — no changes above the `md:` breakpoint.
- Other routes (transactions, envelopes, links, etc.) — only fix them if the audit finds they share the same overflow culprit (e.g. a shared card component).
