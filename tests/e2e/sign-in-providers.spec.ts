import { test, expect, type Page } from "@playwright/test";
import { stubSupabase, SUPABASE_HOST } from "./support/stub";
import { DEFAULT_FIXTURES } from "./support/fixtures";
import { stubServerFns } from "./support/serverFn";

/**
 * Sign-in with a generic OIDC provider (Authentik & co.), which the auth
 * service now knows as the custom provider `custom:oidc`.
 *
 * The login page used to show a button for every row enabled in Settings, even
 * with nothing behind it in the auth service — a click ended on its raw JSON
 * error. It also asked to come back to the bare origin, which the allow list
 * (`https://app/*`) does not match, so the auth service sent people to its own
 * API host instead.
 */

const AUTHENTIK = { provider: "oidc", supabaseProvider: "custom:oidc", label: "Authentik" };

/** The login page, signed out, with the auth service's /authorize captured. */
async function openLogin(page: Page, providers: unknown[], hash = "") {
  const authorize: string[] = [];
  await page.route(`https://${SUPABASE_HOST}/**`, async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/authorize")) {
      authorize.push(url);
      return route.fulfill({ status: 200, contentType: "text/html", body: "<p>provider</p>" });
    }
    return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
  });
  await stubServerFns(page, { listSignInProviders: () => providers });
  await page.goto(`/${hash}`, { waitUntil: "networkidle" });
  return authorize;
}

test.describe("login page", () => {
  test("offers the provider and sends it to custom:oidc, returning to a URL the allow list matches", async ({
    page,
  }) => {
    const authorize = await openLogin(page, [AUTHENTIK]);
    await page.getByRole("button", { name: "Mit Authentik fortfahren" }).click();
    await expect.poll(() => authorize.length).toBe(1);
    const url = new URL(authorize[0]);
    expect(url.searchParams.get("provider")).toBe("custom:oidc");
    // With the trailing slash: a bare origin fell through to the API host.
    expect(url.searchParams.get("redirect_to")).toMatch(/^http:\/\/[^/]+\/$/);
  });

  test("shows no provider button when the auth service has none working", async ({ page }) => {
    await openLogin(page, []);
    await expect(page.getByRole("button", { name: "Anmelden" }).first()).toBeVisible();
    await expect(page.getByText("Oder", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /fortfahren/ })).toHaveCount(0);
  });

  test("says why a provider sign-in failed, once", async ({ page }) => {
    await openLogin(
      page,
      [AUTHENTIK],
      "#error=server_error&error_code=provider_email_needs_verification&error_description=Unverified+email+with+custom%3Aoidc",
    );
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Anmeldung beim Anbieter fehlgeschlagen");
    await expect(alert).toContainText("Unverified email with custom:oidc");
    // Dropped from the address bar, so a reload does not repeat it.
    await expect.poll(() => new URL(page.url()).hash).toBe("");
  });
});

test.describe("Settings → Integrations", () => {
  const oidcRow = {
    id: "p-oidc",
    provider: "oidc",
    display_name: null,
    enabled: false,
    client_id: null,
    discovery_url: null,
  };

  async function openSettings(page: Page, configured: boolean) {
    await stubSupabase(page, {
      ...DEFAULT_FIXTURES,
      tables: {
        ...DEFAULT_FIXTURES.tables,
        user_roles: [{ role: "admin" }],
        auth_providers: [oidcRow],
      },
    });
    const state = { configured, saved: [] as string[] };
    await stubServerFns(page, {
      getOidcProviderStatus: () =>
        state.configured
          ? {
              configured: true,
              enabled: false,
              client_id: "cashflow",
              issuer: "https://auth.example.com/application/o/cashflow/",
            }
          : { configured: false, enabled: false, client_id: null, issuer: null },
      getBuiltInProviderStatus: () => ({ google: false, microsoft: false }),
      listSignInProviders: () => [],
      saveOidcProvider: (body) => {
        state.saved.push(body);
        state.configured = true;
        return {
          configured: true,
          enabled: true,
          client_id: "cashflow",
          issuer: "https://auth.example.com/application/o/cashflow/",
        };
      },
    });
    await page.goto("/settings#integrations", { waitUntil: "networkidle" });
    return state;
  }

  test("saves the provider, secret included, to the auth service", async ({ page }) => {
    const state = await openSettings(page, false);
    await expect(page.getByTestId("oidc-status")).toContainText("Not set up yet");
    // Nothing to switch on before the auth service has it.
    await expect(page.locator("#en-oidc")).toBeDisabled();
    const save = page.getByRole("button", { name: "Save to auth service" });
    await page.locator("#oidc-discovery").fill("https://auth.example.com/application/o/cashflow/");
    await page.locator("#oidc-client-id").fill("cashflow");
    // A first save needs the secret.
    await expect(save).toBeDisabled();
    await page.locator("#oidc-secret").fill("s3cret-value");
    await save.click();
    await expect.poll(() => state.saved.length).toBe(1);
    expect(state.saved[0]).toContain("s3cret-value");
    expect(state.saved[0]).toContain("https://auth.example.com/application/o/cashflow/");
    await expect(page.getByTestId("oidc-status")).toContainText("Set up in the auth service");
    await expect(page.locator("#oidc-secret")).toHaveValue("");
    await expect(page.locator("#en-oidc")).toBeEnabled();
  });

  test("keeps the stored secret when the field is left empty", async ({ page }) => {
    const state = await openSettings(page, true);
    await expect(page.locator("#oidc-secret")).toHaveAttribute("placeholder", /leave empty/);
    await expect(page.locator("#oidc-client-id")).toHaveValue("cashflow");
    await page.locator("#oidc-discovery").fill("https://auth.example.com/application/o/cashflow/");
    await page.getByRole("button", { name: "Save to auth service" }).click();
    await expect.poll(() => state.saved.length).toBe(1);
    expect(state.saved[0]).not.toContain("s3cret");
  });
});
