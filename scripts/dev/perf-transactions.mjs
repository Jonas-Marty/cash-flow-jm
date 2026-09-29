// Measure the Transactions page: load, main-thread blocking, DOM size, heap
// and interaction latency, at today's data volume and at projected volumes.
//
// Runs inside the toolbox (Playwright lives there), signed in with a session
// minted in memory (lib-session.mjs) — nothing is written to disk:
//
//   scripts/dev/tools.sh node scripts/dev/perf-transactions.mjs
//   scripts/dev/tools.sh node scripts/dev/perf-transactions.mjs --scales 1,20 --views table
//   scripts/dev/tools.sh node scripts/dev/perf-transactions.mjs --mobile --cpu 4 --net --views cards --scales 1,4
//   scripts/dev/tools.sh node scripts/dev/perf-transactions.mjs --url http://127.0.0.1:5180   # local-app.sh
//
// Projected volumes: the page's full transactions and tags responses are
// multiplied in the browser (page.route) — copies get new ids and dates
// shifted back by five months per copy — so ×20 of today's ~490 rows is about
// seven years of history, without writing anything to the database. Only the
// rendering side scales this way; the network time of the bigger payload is
// not included (it never leaves the browser).
//
// Options:
//   --url U         app origin (default https://dev-cash-flow.wi-wo.ch)
//   --scales 1,4    data multipliers (default 1,4,10,20)
//   --views a,b     table and/or cards (default table,cards)
//   --runs N        loads per scale and view (default 2; interactions on the last)
//   --mobile        390 px phone viewport
//   --cpu N         CPU slowdown factor (4 ≈ a mid-range phone)
//   --net           9 Mbit/s, 60 ms RTT ("fast 4G")
//   --no-interact   loads only
//   --refetch       also measure the refetch when the tab regains focus
//   --json          one JSON line per run instead of the summary table
import { chromium } from "playwright";
import { mintDevSession, storageStateFor } from "./lib-session.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const BASE = opt("url", process.env.DEV_APP_URL ?? "https://dev-cash-flow.wi-wo.ch").replace(/\/$/, "");
const SCALES = opt("scales", "1,4,10,20").split(",").map(Number);
const VIEWS = opt("views", "table,cards").split(",");
const RUNS = Number(opt("runs", "2"));
const MOBILE = flag("mobile");
const CPU = Number(opt("cpu", "1"));
const NET = flag("net");
const INTERACT = !flag("no-interact");
const REFETCH = flag("refetch");
const JSON_OUT = flag("json");

const storageState = storageStateFor(await mintDevSession(), [BASE]);

// In-page probes, installed before any app code runs.
const INIT = () => {
  window.__lt = [];
  window.__ev = [];
  const obs = (type, fn, opts = {}) => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...opts });
    } catch {
      // Not supported in this browser: the metric stays empty.
    }
  };
  obs("longtask", (e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]));
  obs("event", (e) => window.__ev.push([e.name, Math.round(e.duration)]), { durationThreshold: 16 });
  // Run `act`, then wait until `done` holds and one more frame has painted.
  window.__timed = async (act, done) => {
    const t0 = performance.now();
    act();
    await new Promise((res, rej) => {
      const start = performance.now();
      const tick = () => {
        let ok = false;
        try {
          ok = done();
        } catch {
          ok = false;
        }
        if (ok) return res();
        if (performance.now() - start > 120_000) return rej(new Error("timeout"));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return Math.round(performance.now() - t0);
  };
  window.__count = () => {
    const m = /([\d',]+)\s+(results|Ergebnisse)/.exec(document.body.innerText);
    return m ? Number(m[1].replace(/[',]/g, "")) : null;
  };
  window.__rows = () => document.querySelectorAll('[role="checkbox"]').length;
};

const hex4 = (k) => k.toString(16).padStart(4, "0");
const remap = (id, k) => (id ? id.slice(0, 9) + hex4(k) + id.slice(13) : id);
const shift = (d, k) => {
  if (!d) return d;
  const dayOnly = d.length === 10;
  const dt = new Date(dayOnly ? `${d}T00:00:00Z` : d);
  dt.setUTCDate(dt.getUTCDate() - k * 153);
  return dayOnly ? dt.toISOString().slice(0, 10) : dt.toISOString();
};

/** Multiply the page's full transaction and tag lists by `factor`. */
async function scaleData(ctx, factor) {
  if (factor <= 1) return;
  await ctx.route(/\/rest\/v1\/(transactions|transaction_tags)\?/, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const isTx = u.pathname.endsWith("/transactions");
    const partial =
      isTx &&
      (u.searchParams.get("select") !== "*" ||
        u.searchParams.has("limit") ||
        u.searchParams.has("occurred_on") ||
        u.searchParams.has("id"));
    if (req.method() !== "GET" || partial) return route.continue();
    const resp = await route.fetch();
    const rows = await resp.json();
    const out = rows.slice();
    for (let k = 1; k < factor; k++) {
      for (const r of rows) {
        out.push(
          isTx
            ? {
                ...r,
                id: remap(r.id, k),
                occurred_on: shift(r.occurred_on, k),
                created_at: shift(r.created_at, k),
                split_group_id: remap(r.split_group_id, k),
              }
            : { ...r, transaction_id: remap(r.transaction_id, k) },
        );
      }
    }
    const headers = { ...resp.headers() };
    delete headers["content-length"];
    delete headers["content-encoding"];
    await route.fulfill({ status: resp.status(), headers, body: JSON.stringify(out) });
  });
}

async function interactions(page, view) {
  const T = (fn, arg) => page.evaluate(fn, arg).catch((e) => `ERR ${String(e).slice(0, 60)}`);
  const I = {};
  I.checkbox = await T(async () => {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const boxes = [...document.querySelectorAll('[role="checkbox"]')].filter((b) => b.offsetParent !== null);
      const box = boxes[1 + i];
      const before = box.getAttribute("data-state");
      out.push(await window.__timed(() => box.click(), () => box.getAttribute("data-state") !== before));
    }
    // Leave nothing selected.
    for (let i = 0; i < 3; i++) {
      const boxes = [...document.querySelectorAll('[role="checkbox"]')].filter((b) => b.offsetParent !== null);
      if (boxes[1 + i].getAttribute("data-state") === "checked") boxes[1 + i].click();
    }
    return Math.max(...out);
  });
  I.search = await T(() => {
    const inp = document.querySelector("input[placeholder]");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const c0 = window.__count();
    return window.__timed(() => {
      setValue.call(inp, "coop");
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }, () => window.__count() !== c0);
  });
  I.clearSearch = await T(() => {
    const inp = document.querySelector("input[placeholder]");
    const c0 = window.__count();
    return window.__timed(
      () => inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
      () => window.__count() !== c0,
    );
  });
  I.openFilters = await T(() =>
    window.__timed(
      () => [...document.querySelectorAll("button")].find((b) => /^(Filters|Filter)\b/.test(b.textContent.trim())).click(),
      () => !!document.getElementById("tx-filters"),
    ),
  );
  I.thisMonth = await T(() => {
    const c0 = window.__count();
    return window.__timed(
      () => [...document.querySelectorAll("button")].find((b) => /^(This month|Dieser Monat)$/.test(b.textContent.trim())).click(),
      () => window.__count() !== c0,
    );
  });
  I.clearAll = await T(() => {
    const c0 = window.__count();
    return window.__timed(
      () => [...document.querySelectorAll("button")].find((b) => /(Clear all|Alle zurücksetzen)/.test(b.textContent)).click(),
      () => window.__count() !== c0,
    );
  });
  I.showMore = await T(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^(Show more|Mehr anzeigen)/.test(b.textContent.trim()));
    if (!btn) return "n/a";
    const r0 = window.__rows();
    return window.__timed(() => btn.click(), () => window.__rows() > r0);
  });
  const other = view === "table" ? "cards" : "table";
  I.switchView = await T((target) => {
    const re = target === "table" ? /Table|Tabelle/ : /Cards|Karten/;
    return window.__timed(
      () => [...document.querySelectorAll('[role="group"] button')].find((b) => re.test(b.textContent)).click(),
      () =>
        (target === "cards" ? !document.querySelector("table") : !!document.querySelector("table tbody tr")) &&
        window.__rows() > 1,
    );
  }, other);
  // Real key presses; Event Timing durations (what INP is made of).
  await page.evaluate(() => {
    window.__ev = [];
  });
  const inp = page.locator("input[placeholder]").first();
  await inp.click();
  await page.keyboard.type("lebensmittel", { delay: 35 });
  await page.waitForTimeout(700);
  I.keyMax = await page.evaluate(() =>
    Math.max(0, ...window.__ev.filter(([n]) => /key|input/.test(n)).map(([, d]) => d)),
  );
  await inp.press("Escape");
  await page.waitForTimeout(400);
  return I;
}

async function refetchCost(page) {
  // React Query refetches stale queries when the window becomes visible again.
  await page.waitForTimeout(11_000);
  return page.evaluate(async () => {
    const lt0 = window.__lt.length;
    const res0 = performance.getEntriesByType("resource").length;
    window.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 5000));
    const lt = window.__lt.slice(lt0);
    const rest = performance
      .getEntriesByType("resource")
      .slice(res0)
      .filter((x) => x.name.includes("/rest/v1/"));
    return { requests: rest.length, blockedMs: lt.reduce((a, [, d]) => a + d, 0) };
  });
}

const browser = await chromium.launch();

async function measure(view, factor, run, withInteractions) {
  const ctx = await browser.newContext({
    viewport: MOBILE ? { width: 390, height: 844 } : { width: 1400, height: 900 },
    deviceScaleFactor: MOBILE ? 3 : 1,
    isMobile: MOBILE,
    hasTouch: MOBILE,
    storageState,
  });
  await ctx.addInitScript(INIT);
  await scaleData(ctx, factor);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  if (NET) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 60,
      downloadThroughput: 9e6 / 8,
      uploadThroughput: 3e6 / 8,
    });
  }
  await page.goto(`${BASE}/transactions?view=${view}`, { waitUntil: "commit" });
  const rowsAt = await (
    await page.waitForFunction(() => window.__rows() > 1 && window.__count() != null && performance.now(), null, {
      timeout: 300_000,
      polling: "raf",
    })
  ).jsonValue();
  await page.waitForLoadState("networkidle", { timeout: 300_000 });
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const assets = performance.getEntriesByType("resource").filter((r) => r.name.includes("/assets/"));
    const lt = window.__lt;
    return {
      jsDone: Math.round(Math.max(0, ...assets.map((r) => r.responseEnd))),
      assetBytes: assets.reduce((a, r) => a + (r.transferSize || 0), 0),
      longest: Math.max(0, ...lt.map(([, d]) => d)),
      blocked: lt.reduce((a, [, d]) => a + d, 0),
      dom: document.getElementsByTagName("*").length,
      rendered: window.__rows(),
      count: window.__count(),
    };
  });
  const perf = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  const rec = {
    view,
    factor,
    run,
    rowsAt: Math.round(rowsAt),
    ...m,
    heapMB: Math.round(perf.JSHeapUsedSize / 1048576),
    errors,
  };
  if (withInteractions) rec.interact = await interactions(page, view);
  if (REFETCH && withInteractions) rec.refetch = await refetchCost(page);
  await ctx.close();
  return rec;
}

const results = [];
for (const factor of SCALES) {
  for (const view of VIEWS) {
    for (let run = 1; run <= RUNS; run++) {
      const rec = await measure(view, factor, run, INTERACT && run === RUNS);
      results.push(rec);
      if (JSON_OUT) console.log(JSON.stringify(rec));
      else process.stderr.write(`  ${view} ×${factor} run ${run}: rows at ${rec.rowsAt} ms\n`);
    }
  }
}
await browser.close();

if (!JSON_OUT) {
  const median = (xs) => {
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.floor((s.length - 1) / 2)];
  };
  const env = `${MOBILE ? "phone 390px" : "desktop 1400px"}${CPU > 1 ? `, CPU ×${CPU}` : ""}${NET ? ", fast 4G" : ""}`;
  console.log(`\nTransactions page — ${BASE} — ${env} — median of ${RUNS} load(s)\n`);
  const rows = [];
  for (const factor of SCALES) {
    for (const view of VIEWS) {
      const rs = results.filter((r) => r.factor === factor && r.view === view);
      const last = rs[rs.length - 1];
      const I = last.interact ?? {};
      rows.push({
        view,
        tx: last.count,
        "rows at ms": median(rs.map((r) => r.rowsAt)),
        "longest task": median(rs.map((r) => r.longest)),
        "DOM nodes": median(rs.map((r) => r.dom)),
        "rows in DOM": last.rendered,
        "heap MB": median(rs.map((r) => r.heapMB)),
        checkbox: I.checkbox,
        search: I.search,
        "clear all": I.clearAll,
        "switch view": I.switchView,
        "show more": I.showMore,
        "key max": I.keyMax,
        ...(last.refetch ? { "refocus blocked": last.refetch.blockedMs } : {}),
        errors: rs.reduce((a, r) => a + r.errors.length, 0),
      });
    }
  }
  console.table(rows);
}
