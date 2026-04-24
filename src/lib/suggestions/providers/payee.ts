import type { Suggestion, SuggestionContext, SuggestionProvider } from "../types";

export const payeeProvider: SuggestionProvider = {
  id: "payee_match",
  enabled: () => true,
  async suggest(ctx: SuggestionContext): Promise<Suggestion[]> {
    const q = ctx.payee.trim().toLowerCase();
    if (q.length < 2) return [];

    // Group by payee, pick the most recent transaction for each matching payee
    const seen = new Map<string, { tx: SuggestionContext["recentTransactions"][number]; count: number }>();
    for (const t of ctx.recentTransactions) {
      if (t.type !== ctx.type) continue;
      if (!t.payee) continue;
      const p = t.payee.toLowerCase();
      if (!p.includes(q)) continue;
      const existing = seen.get(p);
      if (!existing) {
        seen.set(p, { tx: t, count: 1 });
      } else {
        existing.count += 1;
        if (new Date(t.occurred_on) > new Date(existing.tx.occurred_on)) existing.tx = t;
      }
    }

    const out: Suggestion[] = [];
    for (const { tx, count } of seen.values()) {
      const p = (tx.payee ?? "").toLowerCase();
      const score = p === q ? 0.55 : p.startsWith(q) ? 0.4 : 0.25;
      const cat = ctx.categories.find((c) => c.id === tx.category_id);
      out.push({
        id: `payee:${p}`,
        score,
        label: tx.payee ?? "",
        sublabel: [cat?.name, count > 1 ? `${count}×` : null].filter(Boolean).join(" · ") || undefined,
        source: "payee_match",
        draft: {
          payee: tx.payee,
          category_id: tx.category_id,
          source_account_id: tx.source_account_id,
        },
      });
    }
    return out;
  },
};
