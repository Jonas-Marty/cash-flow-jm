// Sign in to the dev app, open every page, and report what broke: any Supabase
// request that failed (4xx/5xx or no answer) and any browser error. Meant for
// after a backend change such as an image upgrade — the e2e suite stubs every
// Supabase call, so it cannot notice one.
//
// Runs inside the toolbox (scripts/dev/tools.sh), which has Playwright:
//
//   DEV_LOGIN_EMAIL=… DEV_LOGIN_PASSWORD=… scripts/dev/tools.sh node scripts/dev/smoke.mjs
//
// Exits 1 if anything failed.
import { chromium } from "playwright";

const baseUrl = (process.env.DEV_APP_URL ?? "https://dev-cash-flow.wi-wo.ch").replace(/\/$/, "");
const email = process.env.DEV_LOGIN_EMAIL;
const password = process.env.DEV_LOGIN_PASSWORD;
if (!email || !password) throw new Error("needs DEV_LOGIN_EMAIL and DEV_LOGIN_PASSWORD");

const pages = [
  "/", "/transactions", "/add", "/pending", "/statements", "/envelopes", "/insights",
  "/reconcile", "/scopes", "/links", "/assistant", "/settings",
];

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
let current = "login";
const problems = [];
const calls = new Map();
const isBackend = (url) => /\/(rest|auth|storage)\/v1\/|\/_serverFn\//.test(url);

page.on("console", (m) => {
  if (m.type() === "error") problems.push(`${current}: console: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => problems.push(`${current}: page error: ${String(e).slice(0, 200)}`));
page.on("requestfailed", (r) => {
  if (isBackend(r.url())) problems.push(`${current}: no answer: ${r.method()} ${r.url().slice(0, 140)}`);
});
page.on("response", (r) => {
  const url = r.url();
  if (!isBackend(url)) return;
  const key = url.replace(/\?.*/, "").replace(/^https?:\/\/[^/]+/, "");
  calls.set(key, (calls.get(key) ?? 0) + 1);
  if (r.status() >= 400) problems.push(`${current}: HTTP ${r.status()} ${r.request().method()} ${url.slice(0, 140)}`);
});

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.fill("#email-in", email);
await page.fill("#pw-in", password);
await page.locator("form button[type=submit]").first().click();
await page
  .waitForFunction(() => Object.keys(localStorage).some((k) => k.endsWith("-auth-token")), null, { timeout: 15_000 })
  .catch(() => {});

for (const p of pages) {
  current = p;
  await page.goto(baseUrl + p, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
}

const signedIn = await page.evaluate(() =>
  Object.keys(localStorage).some((k) => k.endsWith("-auth-token")),
);
await browser.close();
console.log(`pages: ${pages.length}, backend endpoints hit: ${calls.size}, signed in: ${signedIn}`);
if (!signedIn) problems.push("login: no session after signing in");
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.log(`  ${p}`);
  process.exit(1);
}
console.log("no problems");
