import type { Suggestion, SuggestionContext, SuggestionProvider } from "../types";

export const descriptionProvider: SuggestionProvider = {
  id: "description_match",
  enabled: () => true,
  async suggest(ctx: SuggestionContext): Promise<Suggestion[]> {
    const q = ctx.description.trim().toLowerCase();
    if (q.length < 2) return [];

    // Group by description, pick the most recent transaction for each matching description
    const seen = new Map<string, { tx: SuggestionContext["recentTransactions"][number]; count: number }>();
    for (const t of ctx.recentTransactions) {
      if (t.type !== ctx.type) continue;
      if (!t.description) continue;
      const p = t.description.toLowerCase();
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
      const p = (tx.description ?? "").toLowerCase();
      const score = p === q ? 0.55 : p.startsWith(q) ? 0.4 : 0.25;
      const cat = ctx.categories.find((c) => c.id === tx.category_id);
      out.push({
        id: `description:${p}`,
        score,
        label: tx.description ?? "",
        sublabel: [cat?.name, count > 1 ? `${count}×` : null].filter(Boolean).join(" · ") || undefined,
        source: "description_match",
        draft: {
          description: tx.description,
          category_id: tx.category_id,
          source_account_id: tx.source_account_id,
        },
      });
    }
    return out;
  },
};
