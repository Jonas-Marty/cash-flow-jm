import { test, expect, type Page } from "@playwright/test";
import { stubSupabase, USER_ID } from "./support/stub";
import { DEFAULT_FIXTURES } from "./support/fixtures";

/**
 * The place suggestion on a pending row.
 *
 * The chip is seeded from the row's own coordinates, so the guard that decides
 * whether to offer a suggestion has to distinguish "the draft holds the raw fix
 * this row arrived with" from "the user chose this". Getting that wrong hid the
 * chip for every row that carried a fix — which is every row a place suggestion
 * is for — and stayed invisible because no row had ever carried one.
 */

const CURATED = {
  latitude: 47.050123,
  longitude: 8.309456,
  accuracy_m: null,
  label: "Coop Bahnhof, Luzern",
  source: "search",
};

function pendingRow(over: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    user_id: USER_ID,
    occurred_on: "2026-09-21",
    description: "Kartenzahlung",
    amount: 23.4,
    type: "expense",
    status: "pending",
    source_account_id: null,
    category_id: null,
    external_source: "finreader",
    external_ref: "r1",
    external_info: "KARTENZAHLUNG CHF 23.40",
    note: null,
    created_at: "2026-09-21T10:00:00Z",
    // What the phone measured: near the curated pin, coarse, and nameless.
    latitude: 47.050201,
    longitude: 8.309502,
    location_accuracy_m: 45,
    location_label: null,
    location_source: "device",
    suggested_description: null,
    suggested_category_id: null,
    suggested_note: null,
    suggested_location: CURATED,
    suggested_tags: [],
    suggestion_source: "history",
    suggestion_confidence: 0.72,
    suggested_at: "2026-09-21T10:00:05Z",
    confirmed_transaction_id: null,
    confirmed_at: null,
    rejected_at: null,
    reject_reason: null,
    updated_at: "2026-09-21T10:00:05Z",
    ...over,
  };
}

async function openPending(page: Page, row: Record<string, unknown>) {
  await stubSupabase(page, {
    ...DEFAULT_FIXTURES,
    tables: { ...DEFAULT_FIXTURES.tables, pending_transactions: [row], transactions: [] },
  });
  await page.goto("/pending", { waitUntil: "networkidle" });
}

test.describe("place suggestion on a pending row", () => {
  test("offers the curated pin to a row that arrived with a device fix", async ({ page }) => {
    // The regression. With the old `!d.location` guard the draft is seeded from
    // the row's own coordinates, so this chip never renders.
    await openPending(page, pendingRow());
    await expect(page.getByRole("button", { name: /Coop Bahnhof, Luzern/ }).first()).toBeVisible();
  });

  test("still offers it to a row that arrived with no location at all", async ({ page }) => {
    await openPending(
      page,
      pendingRow({ latitude: null, longitude: null, location_accuracy_m: null, location_source: null }),
    );
    await expect(page.getByRole("button", { name: /Coop Bahnhof, Luzern/ }).first()).toBeVisible();
  });

  test("offers nothing when there is no place to propose", async ({ page }) => {
    // Guards the assertion above from passing on the place *button* rather than
    // the suggestion chip: the row still has a location, so a selector matching
    // the row's own place would still find something here.
    await openPending(page, pendingRow({ suggested_location: null, suggestion_source: null }));
    await expect(page.getByRole("button", { name: /Coop Bahnhof, Luzern/ })).toHaveCount(0);
  });
});
