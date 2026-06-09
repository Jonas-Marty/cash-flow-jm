## Goal

Fix the misleading "This income matches X open reimbursable(s)…" banner on the Add Transaction screen. Today it shows every open reimbursable on the same account regardless of amount, so the count and total are almost never a real match. Make matching meaningful, and keep the section available (collapsed) when nothing matches so the user can still link partial / over-amount refunds.

## Current behavior (for reference)

- `autoLinkCandidates` (`src/routes/add.tsx`) = every open reimbursable on the same source account + currency. No amount check at all.
- The banner text uses `count = autoLinkCandidates.length` and `amount = Σ remaining`, so it claims a "match" that doesn't exist.
- "Link all" pre-selects everything in the list, which is wrong when only one item actually matches.

## New behavior

### 1. Candidate set

For an `income` transaction with a source account selected, the candidates are open reimbursables that:

- live on an account with the same currency as the income's source account, AND
- still have a non-zero remaining amount, AND
- share the same `reimbursable_counterparty` (case-insensitive, trimmed) as the income's "From whom" field when that field is filled in.

If "From whom" is empty, fall back to "any counterparty on the same currency" so the section is still usable, but no auto-match highlight is shown until the user types a name.

### 2. Subset-sum match (generous tolerance)

Compute a best matching subset of candidates whose remaining amounts sum to the income amount within a generous tolerance:

- tolerance = max(0.05, 1% of income amount, configurable constant)
- prefer the smallest subset; tie-break by closest sum to income, then most recent dates
- cap search to e.g. 12 candidates / 4096 combinations to stay cheap; if more, restrict to the 12 most recent

The matched subset is the "suggested match".

### 3. UI states

The reimbursable-link card replaces the current auto-link card and is rendered whenever `type === "income"` and there is at least one candidate.

```text
+-------------------------------------------------------------+
| 🔗 Link to open reimbursables  (N open · ▾)                 |
| — collapsed by default when no subset-sum match is found.   |
+-------------------------------------------------------------+
```

When a subset-sum match exists, the card is expanded by default with a clear header:

```text
+-------------------------------------------------------------+
| 🔗 Suggested match: 2 reimbursable(s) totalling CHF 20.00   |
|   ☑ Drinks 15.55 · Alice · 02.06                            |
|   ☑ Drinks  4.45 · Alice · 03.06                            |
|   ☐ Lunch  18.50 · Alice · 28.05                            |
|   [Link suggested]  [Link all]  [Clear]                     |
+-------------------------------------------------------------+
```

- Matched items are pre-checked and visually highlighted (primary ring + subtle bg).
- Non-matched but eligible items are still listed and selectable (uncheck/check anything) so the user can handle the 18.55 → 20.00 case by linking just one item and leaving the rest as overpayment / income.
- Per-item amount editor stays available for partial links (already wired through `linkSelections`).
- Total selected vs income amount is shown below the list: e.g. `Selected 20.00 / income 20.00 — exact match`, or `Selected 18.55 / income 20.00 — 1.45 remaining unlinked`.

When there is no match (subset-sum fails), the card stays collapsed and shows only the header "Link to open reimbursables (N open)". Expanding it reveals the full list with no pre-selection and no "matches" claim — the misleading text goes away.

### 4. Copy changes

- Remove `add.reimb.autolink.detail` ("This income matches X open reimbursable(s)…").
- Add:
  - `add.reimb.link.section_title` = "Link to open reimbursables"
  - `add.reimb.link.count_label` = "{n} open"
  - `add.reimb.link.suggested_title` = "Suggested match: {n} reimbursable(s) totalling {amount}"
  - `add.reimb.link.no_match_hint` = "No exact match. You can still link any of the open reimbursables manually."
  - `add.reimb.link.selected_summary.exact` = "Selected {sel} / income {inc} — exact match"
  - `add.reimb.link.selected_summary.under` = "Selected {sel} / income {inc} — {diff} remaining unlinked"
  - `add.reimb.link.selected_summary.over` = "Selected {sel} / income {inc} — {diff} over"
  - Button: `add.reimb.link.link_suggested` = "Link suggested"

German equivalents alongside.

## Technical notes (for implementation phase)

- File: `src/routes/add.tsx`.
- Replace `autoLinkCandidates` memo with two memos:
  - `linkCandidates` (counterparty-filtered, same currency, remaining > 0).
  - `suggestedMatch` (subset-sum result: `{ ids: string[]; total: number; exact: boolean } | null`).
- Add a small helper `findSubsetSumMatch(amounts, target, tolerance)` in a new module (e.g. `src/lib/reimbMatch.ts`) with unit tests covering: exact single, exact two-item sum, generous tolerance hit, no match, > cap candidates.
- When `suggestedMatch` is found and the user hasn't manually edited selections, auto-populate `linkSelections` with the matched ids. Track a "user touched" flag to avoid clobbering manual choices on every keystroke.
- Use a `Collapsible` (already in the project) around the list; default `open = !!suggestedMatch`.
- Keep the existing per-item amount editing and the `linkReimbursement` save path untouched — only the candidate set, ranking, and surrounding UI change.
- Reuse existing `remainingByOrig` for amounts.

## Out of scope

- Multi-currency conversion when matching across currencies (still currency-strict).
- Bulk operations from elsewhere in the app (Open IOUs card).
- Changing the database schema or the `reimbursement_links` table.
