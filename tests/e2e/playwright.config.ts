import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end config. Runs inside the toolbox container (scripts/dev/e2e.sh) —
 * the host has no browser.
 *
 * `--mode e2e` makes Vite load `.env.e2e` over `.env`, pointing the app at a
 * Supabase host that cannot resolve. Every call to it is intercepted, so the suite
 * never touches a real database and needs no credentials.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  // Bugs in here are interaction bugs; a retry that hides a flaky hover is worse
  // than a red run that shows one.
  retries: 0,
  fullyParallel: true,
  reporter: process.env.CI ? [["list"]] : [["list"]],
  // Generous, because the first navigation makes the dev server transform the whole
  // route tree on demand — cold, that is far slower than anything the test does.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 2,
  // No `webServer` block: Playwright's readiness probe never settles against this
  // dev server inside the toolbox, while curl answers instantly. scripts/dev/e2e.sh
  // starts vite, waits for a real 200, and tears it down afterwards.
  use: {
    baseURL: "http://127.0.0.1:5199",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
