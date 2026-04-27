## Transactions page improvements

Rework `/transactions` filters and list rendering to support fuzzy recall of vaguely remembered transactions.

### 1. Searchable, multi-select filter dropdowns

Replace each plain `Select` (Type, Account, Category, Tag) with a new reusable `MultiSelectCombobox` component built on `Popover` + `cmdk` `Command` (already in the project, see `src/components/ui/command.tsx`).

- Search input at top of each popover.
- Checkbox per option, multi-select.
- Trigger button shows: nothing selected → "All X"; 1 selected → its label; >1 → "N selected".
- Clear button inside the popover.
- For Account/Category options, show the same icon/emoji/image as configured (reuse `EntityChip` visual logic — `image_url` → `<img>`, `emoji`, `icon` via `getIcon`, fallback monogram with `colorFromName`).
- Tag option labels render as `#tag` correctly (see fix in §6).

Filter state changes from single string to `string[]` (empty array = no filter).

### 2. Locale-aware From/To date inputs

Replace native `<Input type="date">` with the existing `DateInput` component, passing `formatStr={settings.date_format}`, `lang`, `locale`. Store the value as `Date | null`; convert to `yyyy-MM-dd` only when comparing against `t.occurred_on`. Add a small "Clear" affordance next to each (mirrors the pattern used in `RecurringRulesCard`).

### 3. Amount filter with operators + fuzzy

Add a new "Amount" filter row with two inputs:
- Operator select: `<`, `<=`, `=`, `>=`, `>`, `≈ around`.
- Numeric input (locale-friendly; parse comma/dot).
- For `≈ around`: a small tolerance picker (10% / 25% / 50%, default 15%). Matches if `|amount - target| / target ≤ tolerance`. (Helps when the user only roughly remembers "around 80 bucks".)
- Comparison is on `Math.abs(Number(t.amount))` so it works regardless of expense/income sign.

### 4. Smarter free-text search

The existing search box continues to match `description + note`, but additionally:
- If the trimmed query parses as a number, also match transactions whose `Math.abs(amount)` equals it (exact, two-decimal tolerance `< 0.005`).
- Match the resolved category name and account name(s) of each transaction (so typing "Coop" or "Groceries" finds them).
- Match tags (with or without leading `#`).
- Tokenize on whitespace; ALL tokens must match somewhere (AND), each token can hit any of the fields above. This lets the user combine vague terms like `coop migros 80`.
- Case-insensitive; diacritic-insensitive via `String.prototype.normalize("NFD").replace(/\p{Diacritic}/gu, "")`.

### 5. Highlighted matches in the list

Add a small helper `highlightTokens(text, tokens)` that returns React nodes wrapping matched substrings in `<mark className="bg-yellow-200/60 dark:bg-yellow-500/30 rounded px-0.5">`. Apply it to:
- Description text
- Note text
- Account name(s) and category name in the meta line
- Tag chips (highlight the matching letters inside the chip)
- Amount (wrap whole amount in `<mark>` when an amount/operator filter or numeric search token matches it)

### 6. Tag chip rendering fix (`#alaxus` bug)

Cause: when a JSX text node starts with `#` directly followed by an interpolation (`#{t}`), some downstream tooling/CSS treats the `#` oddly; more reliably, Radix's `SelectItem` exposes the text content for typeahead and the `#` followed by certain characters renders inconsistently. Fix by:
- Wrapping the `#` in its own span: `<span>#</span>{t}` (or `{`#${t}`}` template literal) inside both the dropdown item and the inline tag chip in the list.
- Apply the same fix in `TagChips.tsx` for consistency (it already uses `#{t}` — verify and harden).

### 7. Show entity icon/emoji/image in transaction rows

In each transaction row, replace the plain type-icon circle with a stack:
- Primary visual: the **category** chip (icon/emoji/image/color via `EntityChip` size `sm`, `showLabel=false`) when the row has a category, otherwise the **source account** chip.
- Tiny corner badge with the type arrow (expense/income/transfer) overlaid bottom-right on the chip so type is still glanceable.
- For transfer rows without a category, show source-account chip with a small arrow → destination-account chip beside it.
- Apply same chip in the meta line for category and account names (chip + name) so the user sees the visual identity consistently.

### 8. Other recall helpers

- **Quick chips above the filter bar:** "This month", "Last month", "Last 7 days", "Last 30 days", "This year" — each sets `from`/`to`.
- **Amount range presets:** small buttons "< 20", "20–100", "100–500", "> 500" using the new amount filter.
- **Sort options:** dropdown for "Newest", "Oldest", "Highest amount", "Lowest amount".
- **Result count + active filter chips:** show "N results" plus removable chips for every active filter (type, accounts, categories, tags, amount op, dates, search). One-click "Clear all".
- **"Did you mean?" hint:** if a numeric search yields 0 exact matches, show a one-line suggestion linking to the same query as `≈ around X (±15%)`.
- **Persist filters in URL search params** (`useSearch`/`navigate`) so a recall query is shareable/bookmarkable and survives reloads.
- **Keyboard:** `/` focuses the search box; `Esc` clears it.

### Technical details

Files to add:
- `src/components/MultiSelectCombobox.tsx` — generic multi-select with `cmdk`. Props: `options: { value: string; label: string; visual?: ReactNode }[]`, `value: string[]`, `onChange`, `placeholder`, `emptyText`, `searchPlaceholder`.
- `src/lib/highlight.tsx` — `tokenize(query)`, `normalize(s)`, `matchesAll(text, tokens)`, `highlightTokens(text, tokens)` returning `ReactNode[]`.
- `src/lib/amountFilter.ts` — `type AmountOp = "lt"|"lte"|"eq"|"gte"|"gt"|"around"`; `matchesAmount(amount, op, target, tolerance)`.

Files to edit:
- `src/routes/transactions.tsx` — wire all of the above; switch filter state to arrays + URL sync.
- `src/components/TagChips.tsx` — harden `#` rendering.
- `src/i18n/index.tsx` — add new strings (around, operator labels, presets, sort, "N results", "Clear all", "Did you mean", quick range labels) for `de` and `en`.

No DB or schema changes. No new dependencies (cmdk, Popover, date-fns already present).

### Out of scope
- Server-side filtering / pagination (current page already loads all transactions).
- Saved filter presets (can follow up).
