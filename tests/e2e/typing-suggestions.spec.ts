import { test, expect, type Locator, type Page } from "@playwright/test";
import { stubSupabase, USER_ID } from "./support/stub";
import { DEFAULT_FIXTURES } from "./support/fixtures";
import { stubServerFns } from "./support/serverFn";

/**
 * Suggestions while typing a description or a tag, everywhere a transaction is
 * written: the Add form, the pending table and cards, and the statement table.
 * They used to exist only in the Add form; the other screens had plain inputs.
 */

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const tx = (id: string, description: string, note: string, age: number) => ({
  id,
  user_id: USER_ID,
  occurred_on: daysAgo(age),
  created_at: `${daysAgo(age)}T10:00:00Z`,
  description,
  note,
  amount: 12.5,
  type: "expense",
  category_id: "c-food",
  source_account_id: null,
  destination_account_id: null,
  destination_amount: null,
  split_group_id: null,
  recurring_rule_id: null,
  latitude: null,
  longitude: null,
  location_label: null,
  location_source: null,
  location_accuracy_m: null,
});

/** What the suggestions are drawn from. */
const HISTORY = [
  tx("t-1", "Coop Pronto", "#coop #lebensmittel", 2),
  tx("t-2", "Coop Pronto", "#coop", 5),
  tx("t-3", "Migros Bahnhof", "#migros #lebensmittel", 3),
  tx("t-4", "Restaurant Bären", "#ausgang", 9),
];

const pendingRow = (n: number) => ({
  id: `p-${n}`,
  user_id: USER_ID,
  occurred_on: daysAgo(1),
  description: `Kartenzahlung ${n}`,
  amount: 10 + n,
  type: "expense",
  status: "pending",
  source_account_id: null,
  category_id: null,
  external_source: "finreader",
  external_ref: `r${n}`,
  external_info: null,
  note: null,
  created_at: `${daysAgo(1)}T10:00:0${n % 10}Z`,
  latitude: null,
  longitude: null,
  location_label: null,
  location_source: null,
  location_accuracy_m: null,
  suggested_description: null,
  suggested_category_id: null,
  suggested_note: null,
  suggested_location: null,
  suggested_tags: [],
  suggestion_source: null,
  suggestion_confidence: null,
  suggested_at: null,
  confirmed_transaction_id: null,
  confirmed_at: null,
  rejected_at: null,
  reject_reason: null,
  updated_at: `${daysAgo(1)}T10:00:00Z`,
});

async function withHistory(page: Page, extra: Record<string, unknown[]> = {}) {
  await stubSupabase(page, {
    ...DEFAULT_FIXTURES,
    tables: { ...DEFAULT_FIXTURES.tables, transactions: HISTORY, ...extra },
  });
}

const options = (page: Page) => page.getByRole("listbox").getByRole("option");

/**
 * The whole list is on screen and on top: both corners hit the list itself.
 * A centre point is not enough; a list clipped by the table's scrolling box
 * can still show its first half, and it did.
 */
async function expectWhollyOnScreen(list: Locator) {
  await expect(list).toBeVisible();
  const corners = await list.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hits = (x: number, y: number) => {
      const top = document.elementFromPoint(x, y);
      return !!top && el.contains(top);
    };
    return [hits(r.left + 3, r.top + 3), hits(r.right - 3, r.bottom - 3)];
  });
  expect(corners).toEqual([true, true]);
}

test.describe("statement table", () => {
  const imp = {
    id: "imp-1",
    account_id: "acc-1",
    file_name: "2026.08.18 TopCard.pdf",
    file_source: "none",
    storage_path: null,
    external_url: null,
    file_type: "application/pdf",
    period_from: daysAgo(30),
    period_to: daysAgo(1),
    closing_balance: null,
    currency_code: "CHF",
    status: "extracted",
    model: "test",
    match_window_days: 3,
    created_at: `${daysAgo(1)}T10:00:00Z`,
  };
  const line = {
    id: "l-1",
    line_no: 1,
    booking_date: daysAgo(4),
    value_date: null,
    description: "COOP-2716 GOLDAU",
    amount: -9.95,
    raw_text: null,
    match_status: "unmatched",
    matched_transaction_id: null,
    match_score: null,
    decision: null,
    suggested_description: "Lebensmittelgeschäft",
    suggested_category_id: "c-food",
    suggested_tags: ["coop"],
  };

  async function openStatement(page: Page) {
    await withHistory(page);
    await stubServerFns(page, {
      listStatementImports: () => ({ imports: [imp] }),
      getStatementImport: () => ({ import: imp, lines: [line], matched: {}, unmatched_app: [] }),
    });
    await page.goto("/statements?import=imp-1", { waitUntil: "networkidle" });
    await expect(page.getByRole("textbox", { name: "Tags" })).toBeVisible();
  }

  test("shows suggested tags with #, like its own placeholder", async ({ page }) => {
    await openStatement(page);
    // Was "coop": the bare stored name, next to a "#migros #coop" placeholder.
    await expect(page.getByRole("textbox", { name: "Tags" })).toHaveValue("#coop");
  });

  test("suggests past descriptions while typing", async ({ page }) => {
    await openStatement(page);
    const desc = page.locator("#stmt-desc-l-1");
    await desc.fill("Coo");
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toContainText("Coop Pronto");
    await options(page).first().click();
    await expect(desc).toHaveValue("Coop Pronto");
  });

  test("suggests tags as words are typed, # or not, and skips those already there", async ({
    page,
  }) => {
    await openStatement(page);
    const tags = page.getByRole("textbox", { name: "Tags" });
    await tags.click();
    await tags.press("End");
    await tags.pressSequentially(" mi");
    // "lebensmittel" contains "mi" too; the name starting with it comes first.
    await expect(options(page)).toHaveText(["#migros", "#lebensmittel"]);
    await tags.press("Enter");
    await expect(tags).toHaveValue("#coop #migros ");
    // The next tag is offered straight away; coop and migros are taken.
    await expect(options(page)).toHaveText(["#lebensmittel", "#ausgang"]);
  });
});

test.describe("pending table", () => {
  test("suggests descriptions, and tags after # in the note", async ({ page }) => {
    await withHistory(page, { pending_transactions: [pendingRow(1)] });
    await page.goto("/pending", { waitUntil: "networkidle" });
    const desc = page.locator("#pending-desc-p-1");
    await desc.fill("Mig");
    await expect(options(page)).toHaveText([/Migros Bahnhof/]);
    await desc.press("Enter");
    await expect(desc).toHaveValue("Migros Bahnhof");

    const note = page.getByRole("textbox", { name: "Remarks" });
    await note.fill("Wocheneinkauf #le");
    await expect(options(page)).toHaveText(["#lebensmittel"]);
    // Tab takes the tag and stays in the field for the next one.
    await note.press("Tab");
    await expect(note).toHaveValue("Wocheneinkauf #lebensmittel");
    await expect(note).toBeFocused();
  });

  test("the last rows' suggestions are not cut off by the table's own scrolling", async ({
    page,
  }) => {
    // Enough rows that the wide table scrolls inside its own box.
    const rows = Array.from({ length: 12 }, (_, i) => pendingRow(i + 1));
    await withHistory(page, { pending_transactions: rows });
    await page.goto("/pending", { waitUntil: "networkidle" });
    const last = page.locator(`#pending-desc-${rows.at(-1)!.id}`);
    // Scroll the table's own box to the end, so the last row sits on its lower
    // edge, where a list drawn inside the box has nowhere to go but under it.
    const scrolls = await last.evaluate((el) => {
      let box = el.parentElement;
      while (box && getComputedStyle(box).overflowY !== "auto") box = box.parentElement;
      if (!box) return false;
      box.scrollTop = box.scrollHeight;
      return box.scrollHeight > box.clientHeight;
    });
    expect(scrolls).toBe(true);
    await last.fill("Coo");
    await expectWhollyOnScreen(page.getByRole("listbox"));
  });
});

test.describe("pending card", () => {
  test("works like the Add form: description suggestions, # tags, tag chips", async ({ page }) => {
    await withHistory(page, { pending_transactions: [pendingRow(1)] });
    await page.goto("/pending", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Cards" }).click();
    await page.getByText("Kartenzahlung 1").click();

    const desc = page.locator("#pending-card-desc-p-1");
    await desc.fill("Rest");
    await expect(options(page)).toHaveText([/Restaurant Bären/]);
    await options(page).first().click();
    await expect(desc).toHaveValue("Restaurant Bären");

    const note = page.locator("#pending-card-note-p-1");
    await note.fill("#co");
    await expect(options(page)).toHaveText(["#coop"]);
    await note.press("Enter");
    await expect(note).toHaveValue("#coop");

    // The chips under the note, as in the Add form.
    await page.getByRole("button", { name: "#migros" }).click();
    await expect(note).toHaveValue("#coop #migros");
  });
});

test("the Add form's suggestions still work on the shared list", async ({ page }) => {
  await withHistory(page);
  await page.goto("/add", { waitUntil: "networkidle" });
  const desc = page.locator("#description");
  await desc.fill("Coo");
  await expect(options(page)).toHaveText([/Coop Pronto/]);
  await desc.press("ArrowDown");
  await desc.press("Enter");
  await expect(desc).toHaveValue("Coop Pronto");

  const note = page.locator("#note");
  await note.fill("Znüni #aus");
  await expect(options(page)).toHaveText(["#ausgang"]);
  await options(page).first().click();
  await expect(note).toHaveValue("Znüni #ausgang");
  await expect(note).toBeFocused();
});

test.describe("recurring rule dialog", () => {
  async function openRuleDialog(page: Page) {
    await withHistory(page);
    await page.goto("/settings", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Add rule" }).click();
    return page.getByRole("dialog");
  }

  // The list now renders outside the dialog's DOM; a click in it must still
  // count as inside, and Escape must close the list before the dialog.
  test("suggests tags in the note; Escape closes the list, not the dialog", async ({ page }) => {
    const dialog = await openRuleDialog(page);
    const note = dialog.locator("#rec-note");
    await note.fill("Abo #aus");
    await expect(options(page)).toHaveText(["#ausgang"]);
    await options(page).first().click();
    await expect(note).toHaveValue("Abo #ausgang");

    await note.pressSequentially(" #co");
    await expect(options(page)).toHaveText(["#coop"]);
    await note.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  // The dialog tracks the focused field through the note's onFocus to know
  // where a placeholder goes. The field's own focus handler must not replace it.
  test("placeholders still land in the note once it has focus", async ({ page }) => {
    const dialog = await openRuleDialog(page);
    const note = dialog.locator("#rec-note");
    await note.click();
    await dialog.getByRole("button", { name: /^\$\{/ }).first().click();
    await expect(note).toHaveValue(/\$\{/);
    await expect(dialog.locator("#rec-description")).toHaveValue("");
  });
});
