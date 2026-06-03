# Plan: In-app Help / Wiki page

Add a dedicated `/help` route that explains the app's concepts and UI for new users. Content-only feature — no business logic changes.

## Route & navigation

- New file `src/routes/help.tsx` → URL `/help`, using the existing `AppShell`.
- Reachable from:
  - **Desktop**: an `?` icon button in the header next to `ActiveScopeChip` / `AccountMenu` (less crowded than adding another nav tab).
  - **Mobile**: an entry in the "More" popover (`mobileMoreItems` in `AppShell.tsx`), labelled "Help".
  - **First-run hint**: a small "New here? Read the guide" link on the empty-state of the Dashboard (only when the user has 0 transactions). Non-blocking, dismissible via localStorage.
- Each section has a stable `id` so we can deep-link from anywhere in the app (e.g. the existing IOU help popover can link to `/help#iou-actions`).

## Page layout

Single scrollable page with a sticky **table of contents** on the left (desktop) / collapsible at the top (mobile). Built from shadcn primitives only — `Card`, `Accordion`, `Separator`, `Badge`, lucide icons. No new dependencies.

```text
┌─────────────────────────────────────────────┐
│  Help & Guide                       [search]│
├──────────────┬──────────────────────────────┤
│ ToC (sticky) │  Section 1: Getting started  │
│  - Start     │  Section 2: Core concepts    │
│  - Concepts  │  Section 3: Screens          │
│  - Screens   │  …                           │
│  - Workflows │                              │
│  - Glossary  │                              │
│  - FAQ       │                              │
└──────────────┴──────────────────────────────┘
```

Each section is an `<section id="…">` with an `h2`. Sub-topics use `Accordion` so the page stays scannable. A small client-side filter input at the top hides accordion items whose title/body don't match (pure string match, no fuzzy lib).

## Sections (content outline)

1. **Getting started** — what the app is for (personal cash-flow + envelope budgeting + IOU tracking), the 3-minute setup: create accounts → create categories/envelopes → add first transaction → review dashboard.
2. **Core concepts** — short cards (icon + 1–2 sentences) for: Account, Transaction, Category, Category group, Envelope / budget, Scope, IOU / reimbursable, Pending transaction, Recurring rule, Reconciliation, Sweep / savings target, Attachment, Tag.
3. **Screens** — one accordion per route, mirroring `AppShell` tabs:
   - Dashboard (`/`) — what each card means (Budget balance, Open IOUs, Pending confirmations, Upcoming, Trend strip, Top transactions, Day heatmap).
   - Transactions (`/transactions`) — filters, amount filter syntax, tag search, edit/delete flow.
   - Add (`/add`) — required vs optional fields, smart suggestions, reimbursable flag, attachments.
   - Envelopes (`/envelopes`) — month budgets, rollover, reallocate, sweeps to savings.
   - Insights (`/insights`) — overview / breakdown / trends / projection tabs, period picker.
   - Pending (`/pending`) — Pending vs Open IOUs vs Rejected vs Confirmed tabs (reuse the same wording added recently).
   - Reconcile (`/reconcile`) — what drift means, how to fix it.
   - Scopes (`/scopes`) — personal vs shared scope, switching the active scope.
   - Settings (`/settings`) — accounts, categories, savings & sweeps, API tokens, Nextcloud, recurring rules, audit log, data export, self-host migration pointer.
4. **Common workflows** — step-by-step recipes:
   - Recording a shared expense and getting repaid (IOU lifecycle: add → repayment / mark settled / write off / cancel; deep-link `#iou-actions`).
   - Importing transactions via the public API and confirming them.
   - Monthly close: reconcile → sweep leftovers → review insights.
   - Recurring bills: create rule → post occurrences.
   - Connecting Nextcloud for attachments.
5. **Glossary** — alphabetised one-liners for every term used in the UI (sourced from existing i18n strings so wording matches).
6. **FAQ / troubleshooting** — pulled from real issues we've already addressed: "An IOU I settled came back" (→ now fixed, what to do if it happens again), "Why is my drift not zero?", "Where do skipped recurring occurrences go?", "How do I move my data to a self-hosted instance?" (link to the existing migration doc), "How do I delete my account / data?".

## i18n

All new strings go into `src/i18n/index.tsx` under a new `help.*` namespace, with English + German in the same edit (matches the project's existing pattern). No content is hard-coded in JSX — every paragraph is a `t("help.…")` call so future languages just translate one file.

## Technical summary

Files added / changed:
- **New**: `src/routes/help.tsx` — the page, with section components defined inline (or split into `src/components/help/*.tsx` if it grows beyond ~400 lines).
- **Edit**: `src/components/AppShell.tsx` — add desktop header `?` icon link and a "Help" entry in `mobileMoreItems`.
- **Edit**: `src/i18n/index.tsx` — add `help.*` keys (EN + DE) and `nav.help`.
- **Edit (small)**: `src/components/OpenIOUsCard.tsx` — change the existing `IouHelpPopover` footer to include a "Full guide →" link to `/help#iou-actions` (optional polish, keeps the popover for quick lookup).
- **Edit (small)**: `src/routes/index.tsx` — empty-state "New here? Read the guide" link, gated on zero transactions and a `localStorage` dismiss flag.

No DB migrations, no new packages, no server functions. The route is static content rendered from i18n strings, so it works offline-friendly and is cheap to maintain.

## Out of scope (suggested follow-ups, not part of this plan)

- Per-screen "?" buttons that deep-link into the exact help section (can be added incrementally once `/help` exists).
- A guided product tour (e.g. driver.js) — heavier dependency, decide later.
- Versioned changelog / "What's new" section — separate route if wanted.
