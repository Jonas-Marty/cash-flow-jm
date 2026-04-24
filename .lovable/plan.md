# Smart suggestions on Add Transaction

Make adding a transaction faster by surfacing **ranked suggestions** the user can tap to prefill the whole form (amount, account, category, payee, note, tags). Architected so we can plug in more sources later (AI inference, scanned receipts, bank-import matching) without rewriting the UI.

## Concept

A **Suggestion** is a partial transaction draft + a confidence score + a human label + a provenance tag (which provider produced it, e.g. "Recent · 4×"). The Add screen renders the top N suggestions as tappable chips/cards. Tapping one merges its fields into the form — the user can still tweak anything before saving.

A **SuggestionProvider** is an async function:

```ts
type Suggestion = {
  id: string;                // stable key
  score: number;             // 0..1, higher = more relevant
  label: string;             // "Lunch at Pizza Hut · 12.50"
  sublabel?: string;         // "Bank · Lebensmittel · 3× last 30d"
  source: "history" | "payee_match" | "tag" | "ai" | "receipt" | string;
  draft: Partial<TransactionDraft>; // amount, type, source_account_id, category_id, payee, note, tags
};

type SuggestionProvider = {
  id: string;
  enabled: () => boolean;
  suggest: (ctx: SuggestionContext) => Promise<Suggestion[]>;
};
```

`SuggestionContext` is what the user has typed/picked so far: `{ type, amount, payee, note, sourceId, categoryId, date, recentTransactions, accounts, categories }`. Providers receive it and return zero-or-more candidates. A central `useSuggestions(ctx)` hook fans out to all enabled providers in parallel, merges results, **dedupes by similar drafts** (same payee + amount bucket), sorts by score, and returns the top 5.

This means future providers — an AI inferencer that calls Lovable AI on the payee text, or a receipt-scanner that fills the form from a photo — just register themselves in `src/lib/suggestions/registry.ts`. No UI changes needed.

## What ships in round 1: two providers

### 1. `historyProvider` — similar past transactions

For each transaction in the last ~180 days, compute a relevance score against the current `ctx`:

- **Amount match** (strongest signal): exact = 1.0, within 5 % = 0.7, within 20 % = 0.3, else 0.
- **Payee prefix match** (case-insensitive) on what the user has typed so far: full = 0.8, prefix = 0.5.
- **Type match** (expense/income/transfer): mismatch → drop entirely.
- **Recency boost**: exponential decay, half-life 30 days, max +0.3.
- **Frequency boost**: log of how often this (payee, category, amount-bucket) triple appears, max +0.2.
- **Day-of-month proximity** (small): same day-of-month as `date` → +0.05.

Final score is normalised. The provider groups identical drafts (same payee + category + rounded amount) so "Lunch at Pizza Hut · 12.50 (3×)" appears once with frequency in the sublabel.

The chip prefills: amount, payee, source account, category, note. Date and type stay as the user set them.

### 2. `payeeProvider` — payee autocomplete (replaces today's plain `<datalist>`)

Same as today's `payeeSuggestions` but exposed through the registry. Keyed off the payee field; produces lower-confidence suggestions with only payee + most-recent category for that payee.

(The existing `<datalist>` stays as a graceful fallback; the new chip UI is the primary path.)

## UI

Above the form (between the amount card and the account select), a **collapsible suggestions row**:

- Shows when there is at least one suggestion with score ≥ 0.4.
- Up to 5 chip-style cards, horizontally scrollable on mobile, wrapped on desktop.
- Each chip: amount in bold, payee, small sublabel ("Lebensmittel · 3× · last week"), tiny source badge ("Recent" / later "AI" / "Receipt").
- Tap → merges draft into form fields **only for fields the user hasn't already filled** (sticky-typing rule: if the user typed a payee, we don't overwrite it; we only fill blanks). A small "Use all fields" link inside the chip bypasses sticky-typing for power users.
- After tapping a chip a subtle banner appears: "Filled from past transaction · Undo" — Undo restores prior values.

Suggestions react live as the user types amount/payee/note. Debounced 150 ms to avoid jitter.

### Other smoothness improvements (cheap, ship together)

- **Quick-amount keypad chips** under the amount card: round numbers based on history (e.g. "10", "20", "50", "12.50") — most-frequent amounts for the current type. One-tap to fill.
- **Recent tag chips** under the note field: top 6 tags from history; tap to append `#tag` to the note. (You're already extracting tags into `transaction_tags`.)
- **"Yesterday / Today / Last weekend" date shortcuts** above the calendar popover.
- **Smart category default**: when only payee is set, pre-select the category most often used with that payee (without committing — shown as a dimmed value, becomes solid on first edit).

All four can be toggled off later if they feel noisy; they live behind small flags in `suggestions/registry.ts`.

## Technical implementation

Files added:

- `src/lib/suggestions/types.ts` — `Suggestion`, `SuggestionContext`, `SuggestionProvider`, `TransactionDraft`.
- `src/lib/suggestions/registry.ts` — array of enabled providers; `runSuggestions(ctx)` orchestrator (parallel fan-out, dedupe, sort, top-N).
- `src/lib/suggestions/providers/history.ts` — scoring + grouping logic described above. Pure function over the cached `transactions` query — no extra network calls.
- `src/lib/suggestions/providers/payee.ts` — wraps current payee-autocomplete logic.
- `src/lib/suggestions/useSuggestions.ts` — debounced React hook returning `{ suggestions, isLoading }`.
- `src/components/SuggestionRow.tsx` — chip list + apply/undo behaviour.
- `src/components/QuickAmountChips.tsx`, `src/components/TagChips.tsx`, `src/components/DateShortcuts.tsx` — small UI pieces.

Files edited:

- `src/routes/add.tsx` — render `<SuggestionRow>`, `<QuickAmountChips>`, `<TagChips>`, `<DateShortcuts>`; replace ad-hoc payee suggestions with the registry-driven one. Track `userTouched` flags per field to support sticky-typing.
- `src/i18n/index.tsx` — DE + EN keys (`suggest.recent`, `suggest.use_all_fields`, `suggest.filled_from_past`, `suggest.undo`, `suggest.times_seen`, `add.quick_amounts`, `add.recent_tags`, `add.date.today`, `add.date.yesterday`, `add.date.last_weekend`).
- `architecture.md` — new §3.9 *Smart suggestions* describing the provider model, scoring, sticky-typing rule, and how to register new providers (AI / receipt scan are explicitly called out as future plug-ins). Change-log entry dated today.

No DB/schema changes. No new dependencies.

### Scoring is local, fast, and explainable

History scoring runs over the existing `recentQ` (currently 50 transactions). We bump that limit to 200 inside Add only — cheap, single query. No SQL functions, no edge functions. Everything is pure TypeScript over cached query data, so suggestions update synchronously as the user types.

### Future-proofing for AI / OCR

Because providers are async, an `aiProvider` could in future call `lovable-ai` with `(payee, amount)` and return inferred category/tags. A `receiptProvider` would expose a "Scan receipt" button that, on success, emits one Suggestion with the full draft. Both slot into the registry without touching `add.tsx`. The UI already ranks by score and shows provenance, so AI suggestions naturally appear next to recent ones, sortable by confidence.

## Out of scope this round

AI-based category inference, OCR receipt scanning, bank-statement import matching, learning per-user weights, suggestions for transfers (low-value — transfers are usually unique), cross-device suggestion ranking.
