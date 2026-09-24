import type { Page, Route } from "@playwright/test";

/**
 * Fakes the app's own server functions by name.
 *
 * A server function's URL carries its id as base64url JSON naming the export
 * (e.g. `getNextcloudStatus_createServerFn_handler`), and a reply of plain JSON
 * without the `x-tss-serialized` header is unwrapped from its `result` field
 * and handed to the caller as-is. Functions not listed go to the dev server.
 */
export async function stubServerFns(
  page: Page,
  handlers: Record<string, (body: string) => unknown>,
): Promise<void> {
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
    for (const [name, handler] of Object.entries(handlers)) {
      if (id.includes(`"${name}_`) || id.includes(`${name}_createServerFn`)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ result: handler(body) }),
        });
      }
    }
    return route.continue();
  });
}
