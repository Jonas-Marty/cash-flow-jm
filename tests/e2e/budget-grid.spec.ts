import { test, expect, type Page } from "@playwright/test";
import { stubSupabase, type CallLog } from "./support/stub";
import { DEFAULT_FIXTURES, month } from "./support/fixtures";

/**
 * The budget grid, exercised in a browser.
 *
 * Every bug found in this component so far lived in the layer vitest cannot see:
 * a cell that wrote on blur without being edited, and a hover target that unmounted
 * itself when hovered. Both were invisible to unit tests and obvious in a browser,
 * which is the whole reason this suite exists.
 */

const bulkCalls = (calls: CallLog) =>
  calls.rpc.filter((c) => c.name === "set_category_budgets_bulk");

/** A cell by envelope row and column index, addressed the way the grid renders it. */
const cell = (page: Page, row: number, col: number) =>
  page.locator(`input[data-row="${row}"][data-col="${col}"]`);

async function openGrid(page: Page) {
  const calls = await stubSupabase(page, DEFAULT_FIXTURES);
  await page.goto(`/envelopes?view=grid&month=${month(0).slice(0, 7)}`, {
    waitUntil: "networkidle",
  });
  // Row 0 is the first envelope; its presence means the grid has data, not a skeleton.
  await expect(cell(page, 0, 0)).toBeVisible();
  return calls;
}

test.describe("budget grid", () => {
  test("renders twelve months and every non-scope envelope", async ({ page }) => {
    await openGrid(page);
    await expect(page.getByRole("button", { name: /Select / })).toHaveCount(12);
    for (const name of ["Lohn", "Miete", "Lebensmittel"]) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
  });

  test("focusing an undecided cell and leaving writes nothing", async ({ page }) => {
    // The regression: the dirty check asked "is this stored and unchanged", which is
    // never true for a month with no row, so tabbing across the grid materialised
    // months and claimed it had saved them.
    const calls = await openGrid(page);
    const undecided = cell(page, 0, 0); // twelve months back, no stored row

    await undecided.click();
    await expect(undecided).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(undecided).not.toBeFocused();

    expect(bulkCalls(calls)).toHaveLength(0);
  });

  test("focusing a decided cell and leaving writes nothing either", async ({ page }) => {
    const calls = await openGrid(page);
    const decided = cell(page, 0, 11); // the current month, stored

    await decided.click();
    await page.keyboard.press("Tab");
    await expect(decided).not.toBeFocused();

    expect(bulkCalls(calls)).toHaveLength(0);
  });

  test("a real edit writes exactly one cell", async ({ page }) => {
    const calls = await openGrid(page);
    const target = cell(page, 0, 11);

    await target.click();
    await target.fill("1234");
    await page.keyboard.press("Enter");

    await expect.poll(() => bulkCalls(calls).length).toBe(1);
    const edits = (bulkCalls(calls)[0].body as { p_edits: unknown[] }).p_edits;
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ amount: 1234, month: month(0) });
  });

  test("the fill-right arrow survives being hovered", async ({ page }) => {
    // It used to render only while `previewValue === null`, so hovering it set the
    // preview, which unmounted it mid-hover: its own mouseleave never fired, the
    // preview stuck, and it could never be clicked.
    await openGrid(page);
    const source = cell(page, 0, 9);
    await source.click();

    const arrow = page.locator('button[title*="into every later month"]');
    await expect(arrow).toBeVisible();

    await arrow.hover();
    await expect(arrow).toBeVisible();

    // Moving away clears the preview rather than leaving it painted on.
    await page.mouse.move(0, 0);
    await expect(page.locator("text=/^—$/")).toHaveCount(0);
  });

  test("the fill-right arrow is clickable and fills to the right edge", async ({ page }) => {
    const calls = await openGrid(page);
    const source = cell(page, 0, 9);

    await source.click();
    await source.fill("4321");
    const arrow = page.locator('button[title*="into every later month"]');
    await arrow.hover();
    await arrow.click();

    await expect.poll(() => bulkCalls(calls).length).toBe(1);
    const edits = (bulkCalls(calls)[0].body as { p_edits: Array<{ month: string }> }).p_edits;
    // Columns 9, 10 and 11 — the source and everything right of it.
    expect(edits.map((e) => e.month)).toEqual([month(-2), month(-1), month(0)]);
  });

  test("undo outlives the toast", async ({ page }) => {
    const calls = await openGrid(page);
    const target = cell(page, 0, 11);

    await target.click();
    await target.fill("999");
    await page.keyboard.press("Enter");
    await expect.poll(() => bulkCalls(calls).length).toBe(1);

    const undo = page.getByRole("button", { name: /^Undo:/ });
    await expect(undo).toBeVisible();

    // Outlast the toast, then undo anyway. This is the whole point of the stack.
    await page.waitForTimeout(6_000);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    await expect(undo).toBeVisible();

    await undo.click();
    await expect.poll(() => bulkCalls(calls).length).toBe(2);
  });

  test("stepping the month keeps you in the grid", async ({ page }) => {
    // setMonth rebuilt the search params from scratch and dropped `view`, so the
    // chevrons quietly threw you back to the card view.
    await openGrid(page);
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(page).toHaveURL(/view=grid/);
    await expect(cell(page, 0, 0)).toBeVisible();
  });

  test("clicking a month heading selects it without leaving the grid", async ({ page }) => {
    await openGrid(page);
    await page.getByRole("button", { name: /Select / }).first().click();
    await expect(page).toHaveURL(/view=grid/);
    await expect(cell(page, 0, 0)).toBeVisible();
  });

  test("the eraser offers trimming on a past month", async ({ page }) => {
    await openGrid(page);
    const erasers = page.locator('button[title*="every earlier month"]');
    await expect(erasers.first()).toBeVisible();
  });
});
