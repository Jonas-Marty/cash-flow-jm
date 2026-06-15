# Context-aware suggestions on Add/Edit

## Goal
Today, account, category and tag chips are ranked by global recency-weighted usage (`scoreAccounts` / `scoreCategories` in `src/lib/usageScoring.ts`, and a raw `count` in `TagChips` / `TagAutocompleteTextarea`). Once the user picks an account or category, the remaining fields should re-rank toward the things actually used with that context — e.g. picking *Coop Geschenkkarten* surfaces *Groceries* first, picking *Groceries* surfaces `#migros` / `#coop` first.

## Behavior

1. **Categories react to the selected account** (and type).
   - When `type` and/or `sourceId` are set, score categories by past transactions matching those fields. Without a selection, fall back to today's global score.
2. **Accounts react to the selected category** (secondary — most users pick account first, but transfers and edits may go the other way).
3. **Tag chips & tag autocomplete react to category + account + description**.
   - Currently `TagChips` shows the 6 globally most-frequent tags. After category/account/description are filled, show tags most often used together with that combination.
4. **Pinned items stay on top** (unchanged) and ties still break by name. Score is purely a re-rank within the existing list — no items are hidden.

## Technical changes

### `src/lib/usageScoring.ts`
Add context-aware scorers; keep existing exports working as the "no context" path.

```ts
export interface SuggestionContext {
  type?: TxType;
  sourceAccountId?: string;
  destAccountId?: string;
  categoryId?: string;
  description?: string; // lowercased substring match
}

export function scoreCategories(
  transactions: Transaction[],
  ctx: SuggestionContext = {},
  now = Date.now(),
): Map<string, number>;

export function scoreAccounts(
  transactions: Transaction[],
  ctx: SuggestionContext = {},
  now = Date.now(),
): Map<string, number>;

export function scoreTags(
  transactions: Transaction[],
  ctx: SuggestionContext = {},
  now = Date.now(),
): Map<string, number>;
```

Scoring formula per transaction (sum, then attribute to its category/account/tag):

```
weight = decay(occurred_on)                      // existing 30-day half-life
       * (ctx.type        ? (t.type === ctx.type ? 1 : 0)            : 1)
       * (ctx.sourceAccountId ? (match ? 3.0 : 0.25)                 : 1)
       * (ctx.categoryId     ? (match ? 3.0 : 0.25)                  : 1)
       * (ctx.destAccountId  ? (match ? 2.0 : 0.5)                   : 1)
       * (ctx.description    ? (descriptionSim ? 1.5 : 1.0)          : 1)
```

- Mismatched-context multipliers stay > 0 (e.g. `0.25`) so a chip with a *new* combination never falls below a chip with no history — it just loses its head-start. This keeps newly-created accounts/categories reachable.
- `type` is treated as a hard filter (multiplier `0`) because mixing income/expense tag suggestions is noisy.

### `src/routes/add.tsx`
- Compute one `SuggestionContext` from `{ type, sourceId, destId, categoryId, description }` (recomputed per render via `useMemo`).
- Pass it to `scoreAccounts` / `scoreCategories` when building `accountChips` / `categoryChips`. Re-rank happens automatically as the user picks fields.
- Pass it to the tag UI (see below).
- In split mode, each slice computes its own context (`sourceId` from form, `categoryId`/`description` from the slice) so per-row tag and category suggestions follow the row.

### Tag suggestions
- `src/components/TagChips.tsx`: replace the inline count map with `scoreTags(transactions, ctx)`; sort by score, drop tags already present, take top 6. Accept an optional `ctx` prop; default to no context (backward compatible).
- `src/components/TagAutocompleteTextarea.tsx`: replace the `counts` map with `scoreTags`; keep the same prefix-match boost when the user is typing `#…`. Accept an optional `ctx` prop.
- Wire both from `add.tsx` (main form + each split slice).

### Tests
Extend `src/lib/usageScoring.test.ts` (already exists) with cases for:
- Account selection biases categories toward those used with that account.
- Category selection biases tags toward tags co-used with that category.
- A category never seen with the selected account still appears (mismatched-but-positive weight).
- Type filter excludes opposite-type history from tag scoring.

## Out of scope
- `useSuggestions` / `historyProvider` (whole-transaction suggestions) — its scoring is already multi-signal and the user's request is about chip ordering. Leave untouched.
- No DB or schema changes; everything runs client-side from the already-fetched recent transactions.
