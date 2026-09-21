import type { Page, Route } from "@playwright/test";

/**
 * A Supabase that never existed.
 *
 * The app has no route loaders — every REST, RPC and auth call is made by the
 * browser — so intercepting them replaces the entire backend. No database, no
 * Supabase stack, no credentials, and the same fixtures every run.
 *
 * `VITE_SUPABASE_URL` points at a host that cannot resolve, so anything this file
 * forgets to answer fails loudly rather than reaching something real.
 */

export const SUPABASE_HOST = "e2etest.supabase.invalid";
/** supabase-js derives this from the URL's first hostname label. */
export const STORAGE_KEY = "sb-e2etest-auth-token";

export const USER_ID = "11111111-1111-1111-1111-111111111111";

export interface StubOptions {
  /**
   * Artificial delay on every Supabase answer.
   *
   * Without it the stub replies within a tick, so loading states never become
   * observable and a test asserting "this never shows a skeleton" passes whether or
   * not the code is correct. Opt in where the test is about a transition.
   */
  latencyMs?: number;
}

export interface Fixtures {
  /** Keyed by RPC name, e.g. `category_month_spending`. */
  rpc?: Record<string, unknown>;
  /** Keyed by table name, e.g. `categories`. */
  tables?: Record<string, unknown>;
}

/** Every call the stub actually served, so a test can assert what did *not* happen. */
export interface CallLog {
  rpc: Array<{ name: string; body: unknown }>;
  writes: Array<{ table: string; method: string; body: unknown }>;
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/**
 * Seeds a session and answers every Supabase call from `fixtures`.
 *
 * Returns the call log. Anything not in `fixtures` resolves to an empty list, which
 * is what an unseeded table would legitimately return — the app then renders its
 * empty state rather than hanging on a pending query.
 */
interface BudgetRow { category_id: string; month: string; amount: number }

export async function stubSupabase(
  page: Page,
  fixtures: Fixtures = {},
  options: StubOptions = {},
): Promise<CallLog> {
  const calls: CallLog = { rpc: [], writes: [] };

  /**
   * Budgets are held live rather than served from a frozen fixture.
   *
   * A static backend makes the app look buggy when it is not — after a write it
   * refetches, gets the old numbers back, and concludes the cell is still dirty. It
   * also hides real bugs, because a redundant second write is indistinguishable from
   * a correct one. The rules here mirror `set_category_budgets_bulk`: last write
   * wins, and a null amount deletes.
   */
  const budgets: BudgetRow[] = structuredClone(
    (fixtures.tables?.category_budgets as BudgetRow[]) ?? [],
  );
  const applyEdits = (edits: Array<{ category_id: string; month: string; amount: number | null }>) => {
    for (const e of edits) {
      const i = budgets.findIndex((b) => b.category_id === e.category_id && b.month === e.month);
      if (e.amount === null) {
        if (i >= 0) budgets.splice(i, 1);
      } else if (i >= 0) {
        budgets[i].amount = e.amount;
      } else {
        budgets.push({ category_id: e.category_id, month: e.month, amount: e.amount });
      }
    }
    return edits.length;
  };

  // A session in localStorage is all `getSession()` looks at, so this skips the
  // login form entirely. The token is nonsense; nothing verifies it here.
  await page.addInitScript(
    ([key, uid]) => {
      const oneHour = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(
        key as string,
        JSON.stringify({
          access_token: "e2e-access-token",
          refresh_token: "e2e-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: oneHour,
          user: {
            id: uid as string,
            aud: "authenticated",
            role: "authenticated",
            email: "e2e@example.invalid",
            app_metadata: { provider: "email", providers: ["email"] },
            user_metadata: {},
            identities: [],
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        }),
      );
    },
    [STORAGE_KEY, USER_ID] as const,
  );

  await page.route(`https://${SUPABASE_HOST}/**`, async (route) => {
    if (options.latencyMs) await new Promise((r) => setTimeout(r, options.latencyMs));
    const url = new URL(route.request().url());
    const method = route.request().method();
    let body: unknown = null;
    try {
      body = route.request().postDataJSON();
    } catch {
      /* GETs have no body, and that is fine */
    }

    if (url.pathname.startsWith("/auth/v1/")) {
      if (url.pathname.endsWith("/logout")) return route.fulfill({ status: 204, body: "" });
      return json(route, {
        id: USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "e2e@example.invalid",
        app_metadata: {},
        user_metadata: {},
      });
    }

    const rpcMatch = /^\/rest\/v1\/rpc\/(.+)$/.exec(url.pathname);
    if (rpcMatch) {
      const name = rpcMatch[1];
      calls.rpc.push({ name, body });

      if (name === "set_category_budgets_bulk") {
        const edits = (body as { p_edits?: Array<{ category_id: string; month: string; amount: number | null }> })?.p_edits ?? [];
        return json(route, applyEdits(edits));
      }
      if (name === "set_category_budget") {
        const b = body as { p_category_id: string; p_month: string; p_amount: number };
        applyEdits([{ category_id: b.p_category_id, month: b.p_month, amount: b.p_amount }]);
        return json(route, null);
      }

      const canned = fixtures.rpc?.[name];
      // `void`-returning functions legitimately answer with nothing.
      return json(route, canned === undefined ? null : canned);
    }

    const tableMatch = /^\/rest\/v1\/([^/?]+)$/.exec(url.pathname);
    if (tableMatch) {
      const table = tableMatch[1];
      if (method !== "GET" && method !== "HEAD") {
        calls.writes.push({ table, method, body });
        return json(route, []);
      }
      const rows = table === "category_budgets" ? budgets : (fixtures.tables?.[table] ?? []);
      // `.single()` / `.maybeSingle()` ask PostgREST for a bare object rather than
      // a list, and supabase-js chokes on the wrong shape.
      const accept = route.request().headers()["accept"] ?? "";
      if (accept.includes("pgrst.object")) {
        const first = Array.isArray(rows) ? rows[0] : rows;
        return first === undefined ? json(route, null, 406) : json(route, first);
      }
      return json(route, rows);
    }

    return json(route, []);
  });

  // Browser-side third parties the app reaches for. Left unstubbed they would be
  // real network calls from a test, which is both slow and rude.
  await page.route("https://api.frankfurter.dev/**", (route) => json(route, { rates: {} }));
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());

  return calls;
}
