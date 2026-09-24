import { test, expect, type Page, type Route } from "@playwright/test";
import { stubSupabase } from "./support/stub";
import { DEFAULT_FIXTURES } from "./support/fixtures";

/**
 * The Nextcloud file picker and its preview.
 *
 * Nextcloud is reached only through our server functions, so those are what is
 * faked here: a server function that answers plain JSON (no x-tss-serialized
 * header) is unwrapped from its `result` field and reaches the component as-is. The PDF is a real one-page document, so
 * the preview goes through pdf.js exactly as it does in production.
 */

// Long on purpose: the part that tells statements apart is at the end.
const LONG =
  "2026.08.18 TopCard Coop Kreditkarte Abrechnung 1789 Visa Gold Monatsabrechnung August 2026 Karte endend 4417.pdf";
const PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAxNDEgPj4Kc3RyZWFtCkJUIC9GMSAyOCBUZiA2MCA3NDAgVGQgKFJlY2hudW5nIDkyNTM2MzYpIFRqIEVUCkJUIC9GMSAxNCBUZiA2MCA3MDAgVGQgKEludGVybmV0IEhvbWUgTCAgIENIRiAzOS45MCkgVGogRVQKMCAwIDAgUkcgMiB3IDYwIDY4MCBtIDU1MCA2ODAgbCBTCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwNDMyIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNTAyCiUlRU9GCg==";

const entry = (name: string, modified: string, over: Record<string, unknown> = {}) => ({
  name,
  path: `/${name}`,
  file_id: String(name.length),
  link_url: `https://cloud.example.com/f/${name.length}`,
  mime: "application/pdf",
  size: 55_000,
  modified,
  is_dir: false,
  ...over,
});

const FOLDER = [
  { ...entry("Scans", "2026-09-20T10:00:00Z"), mime: null, size: null, is_dir: true },
  entry(LONG, "2026-09-14T10:00:00Z"),
  entry("Quittung Migros.jpg", "2026-08-30T10:00:00Z", { mime: "image/jpeg" }),
  entry("Rechnung alt.pdf", "2026-01-05T10:00:00Z"),
];

/** Fakes the Nextcloud server functions and records what search was asked for. */
async function stubNextcloud(page: Page) {
  const searches: string[] = [];
  await page.route("**/_serverFn/**", async (route: Route) => {
    const req = route.request();
    const seg = new URL(req.url()).pathname.split("/_serverFn/")[1] ?? "";
    let id = decodeURIComponent(seg);
    try {
      id += Buffer.from(seg, "base64url").toString("utf8");
    } catch {
      /* not base64: the raw id is enough */
    }
    const body = req.postData() ?? "";
    const reply = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: data }),
      });
    if (id.includes("getNextcloudStatus")) {
      return reply({
        configured: true,
        connected: true,
        lost: false,
        has_credentials: true,
        base_url: "https://cloud.example.com",
        nextcloud_user: "jonas",
      });
    }
    if (id.includes("listNextcloudFolder")) return reply({ path: "/", entries: FOLDER });
    if (id.includes("searchNextcloud")) {
      searches.push(body);
      const files = FOLDER.filter((e) => !e.is_dir);
      // FOLDER lists the files A to Z; the server sorts Z to A unless asked.
      return reply({ results: body.includes('"asc"') ? files : [...files].reverse() });
    }
    if (id.includes("downloadNextcloudFile")) {
      return reply({ name: LONG, mime: "application/pdf", base64: PDF_BASE64 });
    }
    return route.continue();
  });
  return { searches };
}

async function openPicker(page: Page) {
  await stubSupabase(page, DEFAULT_FIXTURES);
  const nc = await stubNextcloud(page);
  // The picker remembers the last folder per device; start every test at the top.
  // (Only its keys: the Supabase stub keeps the signed-in session in there too.)
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("nc-picker-folder:")) localStorage.removeItem(k);
  });
  await page.goto("/add", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Attach file" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Quittung Migros.jpg")).toBeVisible();
  return { dialog, ...nc };
}

const fileNames = async (page: Page) =>
  (await page.getByRole("dialog").locator("li").allInnerTexts()).map((t) => t.split("\n")[0]);

test("wraps a long file name instead of cutting off its end", async ({ page }) => {
  const { dialog } = await openPicker(page);
  const name = dialog.getByText(LONG, { exact: true });
  await expect(name).toBeVisible();
  const box = await name.evaluate((el) => ({
    overflow: getComputedStyle(el).textOverflow,
    clipped: el.scrollWidth > el.clientWidth,
    lines: el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight),
  }));
  expect(box.overflow).not.toBe("ellipsis");
  expect(box.clipped).toBe(false);
  expect(box.lines).toBeGreaterThan(1.5);
});

test("sorts a folder by name, flips to A to Z, and forgets it on close", async ({ page }) => {
  const { dialog } = await openPicker(page);
  // Z to A: date-prefixed names come newest first. Folders stay on top.
  expect(await fileNames(page)).toEqual(["Scans", "Rechnung alt.pdf", "Quittung Migros.jpg", LONG]);
  await dialog.getByRole("button", { name: "Name Z–A" }).click();
  expect(await fileNames(page)).toEqual(["Scans", LONG, "Quittung Migros.jpg", "Rechnung alt.pdf"]);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Attach file" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Name Z–A" })).toBeVisible();
});

test("asks the server for the first names, not the last ones reversed", async ({ page }) => {
  const { dialog, searches } = await openPicker(page);
  await dialog.getByPlaceholder("Search all of Nextcloud…").fill("rechnung");
  await expect.poll(() => searches.length).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Name Z–A" }).click();
  await expect.poll(() => searches.some((b) => b.includes('"asc"'))).toBe(true);
  await expect(dialog.locator("li").first()).toContainText(LONG);
});

test("the preview has its own close control, not a second X beside the dialog's", async ({
  page,
}) => {
  const { dialog } = await openPicker(page);
  await dialog.getByRole("button", { name: `Preview ${LONG}` }).click();
  await expect(dialog.getByRole("button", { name: "Choose this file" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Close preview" }).click();
  await expect(dialog.getByRole("button", { name: "Choose this file" })).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test.describe("on a sharp screen", () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  test("draws PDF pages at exactly the pixels they are shown at", async ({ page }, info) => {
    const { dialog } = await openPicker(page);
    await dialog.getByRole("button", { name: `Preview ${LONG}` }).click();
    const canvas = dialog.getByRole("img", { name: "Page 1" });
    await expect(canvas).toBeVisible();
    const m = await canvas.evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, Math.floor(c.height / 4)).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 128) ink++;
      return { pixels: c.width, shown: c.getBoundingClientRect().width * devicePixelRatio, ink };
    });
    // A bitmap stretched or squeezed to fit is what made the text soft.
    expect(Math.abs(m.pixels - m.shown)).toBeLessThanOrEqual(1);
    expect(m.ink).toBeGreaterThan(100);
    await page.screenshot({ path: info.outputPath("desktop-preview.png") });
  });
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  test("the preview covers the list and goes back to it", async ({ page }, info) => {
    const { dialog } = await openPicker(page);
    await dialog.getByRole("button", { name: `Preview ${LONG}` }).click();
    await expect(dialog.getByRole("img", { name: "Page 1" })).toBeVisible();
    await page.screenshot({ path: info.outputPath("phone-preview.png") });
    const choose = await dialog.getByRole("button", { name: "Choose this file" }).boundingBox();
    expect(choose!.y).toBeLessThan(844);
    await dialog.getByRole("button", { name: "Close preview" }).click();
    await expect(dialog.getByText("Quittung Migros.jpg")).toBeVisible();
    await page.screenshot({ path: info.outputPath("phone-list.png") });
  });
});
