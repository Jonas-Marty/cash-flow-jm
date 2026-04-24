

# Coop gift cards — modelling pattern

## Recommendation: model the gift card as a Cash-type account

Treat each Coop gift card (or the pool of them) as its own **Asset account** named e.g. *Coop Geschenkkarten*. This is exactly what asset accounts are for: a place where money physically sits. Then book two transactions to load it.

### The pattern (1000 CHF card bought for 960)

1. **Expense** — 960 CHF, source = *Migros Cumulus*, category = **none** (leave empty).
2. **Income** — 1000 CHF, source = *Coop Geschenkkarten*, category = **none**.

Result:
- Migros Cumulus −960 (real cash out).
- Coop Geschenkkarten +1000 (real spending power loaded).
- Net worth +40 — the 4 % discount surfaces as an account-balance gain, not as budget income, which matches your intuition.
- Neither leg touches an envelope, so the budget is untouched at load time.
- Later, when you buy groceries with the card: **Expense** 87.50 CHF, source = *Coop Geschenkkarten*, category = **Lebensmittel**. The full sticker price hits the Lebensmittel envelope (no 4 % discount visible there — exactly what you said you want), and the gift-card balance ticks down. When the card runs dry, the account hits 0 and you stop using it. Net worth and audit trail stay correct throughout.

### Why a dedicated account beats the alternatives

- **Two free-floating transactions without a gift-card account**: the 1000 income would either inflate income envelopes or sit in limbo, and the spending power isn't tracked — you'd have no idea how much card balance is left. Rejected.
- **Booking only the 960 against Lebensmittel directly when you spend**: loses the audit trail (no record of card load), and you'd need to mentally divide every grocery bill by 0.96. Rejected.
- **A new "voucher" account type**: cash-type asset accounts already model this perfectly. No schema change needed.

## On linking the two load transactions

Short answer: **don't link them at the row level.** They're already implicitly linked by sharing the same date and being the only two non-budget movements between Migros Cumulus and Coop Geschenkkarten. The pattern below makes that link explicit and searchable without new schema.

Concrete recommendation: **use a hashtag convention** — put `#giftcard-load` (or `#giftcard-load-2026-04` for the specific batch) in the note of both transactions. Tags are already extracted into `transaction_tags` and filterable on the Transactions page, so searching `#giftcard-load` instantly shows every load pair grouped by date. Zero new code, zero new schema, leverages an existing feature.

Why not a true row-to-row link:
- Adds a new table (`transaction_links` or similar) and CRUD UI for a single use case.
- The reimbursement pattern (§3.7) deliberately avoids this for the same reason — implicit linkage via shared category/date/tag has been the project's consistent design choice.
- A dedicated transfer between the two accounts won't work either: a transfer enforces equal amounts on both sides, and the whole point here is that 960 ≠ 1000.

## Small changes to make this discoverable

1. **`architecture.md`** — add §3.8 *Gift cards & stored-value accounts* documenting the Coop pattern: dedicated asset account, two-leg load (expense + income, no category), tag convention `#giftcard-load`, spend transactions go directly against the gift-card account with normal envelopes.
2. **Settings → Accounts hint** — under the account-type selector, add a one-line helper text: *"Use an asset account for gift cards or stored-value (e.g. Coop Geschenkkarten)."* (DE + EN).
3. **i18n** — two new keys: `settings.accounts.asset_hint` and a tag suggestion key `add.tag_suggestion.giftcard_load` shown as a chip under the note field when both source/destination accounts are involved in a no-category pair (optional polish — happy to drop if you'd rather keep Add minimal).
4. **Change-log entry** in `architecture.md` dated today.

## Files touched

- `architecture.md` — new §3.8 + change-log entry.
- `src/routes/settings.tsx` — render the helper text under account type.
- `src/i18n/index.tsx` — DE + EN keys.
- *(Optional)* `src/routes/add.tsx` — tag-suggestion chip; skip if you want to keep this round minimal.

## Out of scope

A formal `transaction_links` table, automatic profit reporting on gift-card purchases, multi-leg stored-value reconciliation (e.g. expiring vouchers), and tracking individual physical card serial numbers.

