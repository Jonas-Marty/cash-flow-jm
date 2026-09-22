import { test, expect, type Page } from "@playwright/test";
import { stubSupabase, USER_ID } from "./support/stub";
import { DEFAULT_FIXTURES } from "./support/fixtures";

/**
 * The place picker opened from a table row.
 *
 * It shares `LocationSection` with the Add form, where location is one optional field
 * among many and starting collapsed is right. Here the dialog exists *because* the
 * user asked to choose a place, so the same defaults are wrong.
 */

const LONG_LABEL =
  "Migros Supermarkt Filiale, 19, Bahnhofplatz, Herrenmatt-Oberdorf, " +
  "Brunnen am Vierwaldstaettersee, Ingenbohl, Kanton Schwyz, 6440, Schweiz";

const pendingRow = {
  id: "p-1",
  user_id: USER_ID,
  occurred_on: "2026-09-21",
  description: "Cola",
  amount: 3.5,
  type: "expense",
  status: "pending",
  source_account_id: null,
  category_id: null,
  external_source: "finreader",
  external_ref: "r1",
  external_info: null,
  note: null,
  created_at: "2026-09-21T10:00:00Z",
  latitude: 46.99987,
  longitude: 8.60923,
  location_label: LONG_LABEL,
  location_source: "search",
  location_accuracy_m: null,
};

/** A past transaction with a place, which is what feeds the "earlier location" list. */
const pastWithPlace = {
  id: "t-1",
  user_id: USER_ID,
  occurred_on: "2026-08-02",
  description: "Coop Bahnhof",
  amount: 12.4,
  type: "expense",
  category_id: null,
  source_account_id: null,
  latitude: 47.0501,
  longitude: 8.3093,
  location_label: "Coop, Bahnhofstrasse, Luzern",
  location_source: "search",
  location_accuracy_m: null,
  created_at: "2026-08-02T09:00:00Z",
};

/** The same row with nothing picked yet — the state the collapsed default hurt. */
const pendingRowNoPlace = {
  ...pendingRow,
  id: "p-2",
  external_ref: "r2",
  latitude: null,
  longitude: null,
  location_label: null,
  location_source: null,
};

async function openPlaceDialog(page: Page, opts: { withPlace?: boolean } = {}) {
  const withPlace = opts.withPlace ?? true;
  await stubSupabase(page, {
    ...DEFAULT_FIXTURES,
    tables: {
      ...DEFAULT_FIXTURES.tables,
      pending_transactions: [withPlace ? pendingRow : pendingRowNoPlace],
      transactions: [pastWithPlace],
    },
  });
  await page.goto("/pending", { waitUntil: "networkidle" });
  const trigger = withPlace
    ? page.locator('button[aria-label*="Bahnhofplatz"]')
    : page.locator('button[aria-label="Pick place"]');
  await trigger.first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("place picker", () => {
  test("opens with the map already showing", async ({ page }) => {
    const dialog = await openPlaceDialog(page);
    await expect(dialog.locator(".leaflet-container")).toBeVisible();
  });

  test("opens with the map showing even when no place is set yet", async ({ page }) => {
    // The case the inherited default actually hurt: `open` was `!!value`, so a row
    // with nothing picked opened collapsed — a click between the user and the only
    // thing the dialog is for. A row that already has a place hid the bug, which is
    // why asserting on that one alone proved nothing.
    const dialog = await openPlaceDialog(page, { withPlace: false });
    await expect(dialog.locator(".leaflet-container")).toBeVisible();
  });

  test("gives the map real height, not a thumbnail", async ({ page }) => {
    const dialog = await openPlaceDialog(page);
    const box = await dialog.locator(".leaflet-container").boundingBox();
    // The inline variant renders h-48 (192px); the picker should be well past that.
    expect(box?.height ?? 0).toBeGreaterThan(300);
  });

  test("a long address truncates instead of widening the dialog", async ({ page }) => {
    // `min-w-0` on the collapsible: as a grid item it defaults to `min-width: auto`,
    // so the address stretched the track and overflowed the overlay.
    const dialog = await openPlaceDialog(page);
    const header = dialog.locator("button").filter({ hasText: "Location" }).first();

    const headerBox = await header.boundingBox();
    const dialogBox = await dialog.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(dialogBox).not.toBeNull();
    expect(headerBox!.x + headerBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);
  });

  test("shows earlier places without being asked", async ({ page }) => {
    const dialog = await openPlaceDialog(page);
    await expect(dialog.getByText("Coop, Bahnhofstrasse, Luzern")).toBeVisible();
  });
});
