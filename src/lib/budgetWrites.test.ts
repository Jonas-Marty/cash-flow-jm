import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, listSourceFiles } from "./docsAudit";

/**
 * Budgets have exactly one writer.
 *
 * The bug this guards against already happened: Settings wrote `category_budgets`
 * directly, with the month hard-coded to `new Date()` and a blind delete of every
 * later row. That was not a decision anyone took — it was a constant nobody revisited,
 * and it made every past month unreachable while looking like a rule.
 *
 * The rule now lives in `set_category_budget`, which owns the scope semantics, refuses
 * scope envelopes, and audits edits to months that have already elapsed. A second
 * writer would silently opt out of all three.
 */
describe("budget writes", () => {
  const rel = (f: string) => path.relative(REPO_ROOT, f);

  it("never touches category_budgets from client code", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles()) {
      if (file.endsWith("docsAudit.ts") || file.endsWith("budgetWrites.test.ts")) continue;
      const text = readFileSync(file, "utf8");
      // `.from("category_budgets")` is the supabase-js table accessor; reads are fine,
      // but the helpers below are what a write goes through.
      const re = /\.from\(\s*["']category_budgets["']\s*\)([\s\S]{0,200})/g;
      for (const m of text.matchAll(re)) {
        if (/\.(insert|upsert|update|delete)\s*\(/.test(m[1])) {
          offenders.push(rel(file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("routes every budget change through the set_category_budget RPC", () => {
    const finance = readFileSync(path.join(REPO_ROOT, "src/lib/finance.ts"), "utf8");
    expect(finance).toContain('supabase.rpc("set_category_budget"');
    expect(finance).toContain("export async function setCategoryBudget");
  });

  it("offers both scopes and nothing else", () => {
    const finance = readFileSync(path.join(REPO_ROOT, "src/lib/finance.ts"), "utf8");
    const m = /export type BudgetScope = ([^;]+);/.exec(finance);
    expect(m).not.toBeNull();
    const scopes = [...(m?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((x) => x[1]).sort();
    expect(scopes).toEqual(["forward", "month"]);
  });

  it("routes bulk grid actions through the bulk RPC", () => {
    const finance = readFileSync(path.join(REPO_ROOT, "src/lib/finance.ts"), "utf8");
    expect(finance).toContain('supabase.rpc("set_category_budgets_bulk"');
    // Undo has to be able to restore a cell to *undecided*, not to the value it
    // happened to inherit, so the payload must admit null.
    expect(finance).toMatch(/interface BudgetEdit[\s\S]{0,400}amount: number \| null;/);
  });

  it("never materialises past the current month, and says so in one place", () => {
    const finance = readFileSync(path.join(REPO_ROOT, "src/lib/finance.ts"), "utf8");

    // The grid reads twelve columns at once. If its reader seeded rows, opening it
    // would commit a year of copied-forward budgets nobody asked for.
    const range = /export async function fetchCategoryBudgetRange[\s\S]*?\n}/.exec(finance);
    expect(range).not.toBeNull();
    expect(range?.[0]).not.toContain("ensureMonthBudgets");

    // The cap belongs to the database, not to a client-side comparison that a second
    // caller could forget. `ensure_month_budgets` is therefore always safe to call.
    const sql = readFileSync(
      path.join(REPO_ROOT, "supabase/migrations/20260922160000_backfill_month_budgets.sql"),
      "utf8",
    );
    expect(sql).toMatch(/v_target date := date_trunc\('month', CURRENT_DATE\)::date;/);
  });

  it("backfills every gap up to the current month", () => {
    // Away from 22 July until 3 December, seeding only December left August through
    // November missing — and a month with no row contributes no allocation and no
    // sweep, so every rolling envelope's balance came out short.
    const sql = readFileSync(
      path.join(REPO_ROOT, "supabase/migrations/20260922160000_backfill_month_budgets.sql"),
      "utf8",
    );
    expect(sql).toContain("generate_series(");
    // Each gap resolves against its own nearest prior row, so an interior gap gets
    // what applied at the time rather than today's figure.
    expect(sql).toMatch(/cb1\.month <= gs\.month::date[\s\S]{0,80}ORDER BY cb1\.month DESC/);
    // Bounded by the envelope's own history: a category created last week must not
    // acquire a year of rows.
    expect(sql).toMatch(/min\(cb0\.month\)[\s\S]{0,120}v_target/);
    // Both views must read a monthless month the same way.
    expect(sql).toMatch(/cb\.month <= v_start[\s\S]{0,120}c\.allocated_budget/);
  });

  it("has a migration whose guards match what the type promises", () => {
    const sql = readFileSync(
      path.join(REPO_ROOT, "supabase/migrations/20260922120000_set_category_budget.sql"),
      "utf8",
    );
    // Authenticated only, owned rows only, no scope envelopes — the three things a
    // direct table write would have bypassed.
    expect(sql).toContain("requires an authenticated user");
    expect(sql).toContain("c.user_id = v_uid");
    expect(sql).toContain("scope envelopes have no monthly budget");
    // An elapsed month leaves a trace.
    expect(sql).toContain("log_audit_event");
    expect(sql).toContain("budget.retroactive_change");
    // `forward` updates later rows rather than deleting them for regeneration.
    expect(sql).toMatch(/UPDATE public\.category_budgets[\s\S]{0,120}month > v_month/);
    expect(sql).not.toMatch(/DELETE FROM public\.category_budgets/);
  });

  it("applies the same guards on the bulk path as on the single one", () => {
    const sql = readFileSync(
      path.join(REPO_ROOT, "supabase/migrations/20260922140000_set_category_budgets_bulk.sql"),
      "utf8",
    );
    // A bulk path that skipped these would be a loophole around the single-cell RPC.
    expect(sql).toContain("requires an authenticated user");
    expect(sql).toContain("category not found");
    expect(sql).toContain("scope envelopes have no monthly budget");
    expect(sql).toContain("budget.bulk_change");
    // Guards run before any write, so a bad batch is rejected whole.
    const firstWrite = Math.min(
      sql.indexOf("INSERT INTO public.category_budgets"),
      sql.indexOf("DELETE FROM public.category_budgets"),
    );
    expect(sql.indexOf("scope envelopes have no monthly budget")).toBeLessThan(firstWrite);
    // A null amount clears rather than writing zero, so undo can restore undecided.
    expect(sql).toMatch(/DELETE FROM public\.category_budgets[\s\S]{0,300}amount IS NULL/);
  });
});
