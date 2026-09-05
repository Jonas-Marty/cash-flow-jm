// Screenshot a page of the app at one or more viewports and report whatever the
// browser complained about while loading it.
//
// Runs inside the toolbox (scripts/dev/tools.sh), which is where Playwright
// lives — the host has no browser.
//
//   node scripts/dev/screenshot.mjs --path /pending --mobile --login
//   node scripts/dev/screenshot.mjs --url http://localhost:8080 --device "iPhone 13"
//
// Login uses DEV_LOGIN_EMAIL / DEV_LOGIN_PASSWORD and caches the session in
// screenshots/.auth-state.json, so later runs skip the form.
import { chromium, devices } from "playwright";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);
const all = (name) =>
  args.reduce((acc, a, i) => (a === `--${name}` ? [...acc, args[i + 1]] : acc), []);

const baseUrl = (opt("url") ?? process.env.DEV_APP_URL ?? "https://dev-cash-flow.wi-wo.ch").replace(/\/$/, "");
const pagePath = opt("path", "/");
const outDir = opt("out", "screenshots");
const settle = Number(opt("wait", "600"));
const wantLogin = flag("login");
const failOnConsoleError = flag("fail-on-console-error");

// Viewports: named devices, explicit WxH, or the two phone widths that matter
// most here. Default is a plain desktop window.
const targets = [];
for (const name of all("device")) {
  const preset = devices[name];
  if (!preset) throw new Error(`unknown device "${name}"`);
  targets.push({ label: name.replace(/\s+/g, "-"), context: preset });
}
for (const spec of all("viewport")) {
  const [w, h] = spec.split("x").map(Number);
  if (!w || !h) throw new Error(`bad --viewport "${spec}", expected WxH`);
  targets.push({ label: `${w}x${h}`, context: { viewport: { width: w, height: h } } });
}
if (flag("mobile")) {
  for (const [w, h] of [[360, 800], [390, 844]]) {
    targets.push({
      label: `${w}x${h}`,
      context: {
        viewport: { width: w, height: h },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
    });
  }
}
if (targets.length === 0) targets.push({ label: "1280x900", context: { viewport: { width: 1280, height: 900 } } });

const statePath = path.join(outDir, ".auth-state.json");
const exists = async (p) => access(p).then(() => true, () => false);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const slug = pagePath.replace(/^\//, "").replace(/\//g, "-") || "root";

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const results = [];

for (const target of targets) {
  const storageState = (await exists(statePath)) ? statePath : undefined;
  const context = await browser.newContext({ ...target.context, storageState });
  const page = await context.newPage();

  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push({ kind: m.type(), text: m.text() });
  });
  page.on("pageerror", (e) => problems.push({ kind: "pageerror", text: String(e) }));
  page.on("requestfailed", (r) =>
    problems.push({ kind: "requestfailed", text: `${r.url()} — ${r.failure()?.errorText ?? "failed"}` }),
  );

  const target_url = `${baseUrl}${pagePath}`;
  await page.goto(target_url, { waitUntil: "networkidle" });

  if (wantLogin && (await page.locator("#email-in").isVisible().catch(() => false))) {
    const email = process.env.DEV_LOGIN_EMAIL;
    const password = process.env.DEV_LOGIN_PASSWORD;
    if (!email || !password) throw new Error("--login needs DEV_LOGIN_EMAIL and DEV_LOGIN_PASSWORD");
    await page.fill("#email-in", email);
    await page.fill("#pw-in", password);
    await page.click("form:has(#pw-in) button[type=submit]");
    await page.locator("#email-in").waitFor({ state: "detached", timeout: 30_000 });
    await context.storageState({ path: statePath });
    await page.goto(target_url, { waitUntil: "networkidle" });
  }

  await page.waitForTimeout(settle);
  const file = path.join(outDir, `${stamp}-${slug}-${target.label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await writeFile(`${file}.console.json`, JSON.stringify(problems, null, 2));

  // A page wider than its own viewport is the horizontal-overflow smell.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  results.push({
    viewport: target.label,
    file,
    errors: problems.filter((p) => p.kind !== "warning").length,
    warnings: problems.filter((p) => p.kind === "warning").length,
    overflowsBy: Math.max(0, overflow.scrollWidth - overflow.clientWidth),
  });
  await context.close();
}

await browser.close();
console.table(results);
const errorCount = results.reduce((n, r) => n + r.errors, 0);
if (failOnConsoleError && errorCount > 0) {
  console.error(`${errorCount} console/page error(s); see the .console.json files`);
  process.exit(1);
}
