import type { Suggestion, SuggestionContext, SuggestionProvider } from "../types";

const HALF_LIFE_DAYS = 30;
const MAX_AGE_DAYS = 180;

function recencyBoost(occurredOn: string): number {
  const t = new Date(occurredOn).getTime();
  const ageDays = (Date.now() - t) / (1000 * 60 * 60 * 24);
  if (ageDays < 0) return 0.3;
  return 0.3 * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

function amountScore(target: number | null, candidate: number): number {
  if (target == null || target <= 0) return 0;
  const ratio = Math.abs(candidate - target) / target;
  if (ratio < 0.001) return 1.0;
  if (ratio <= 0.05) return 0.7;
  if (ratio <= 0.2) return 0.3;
  return 0;
}

function payeeScore(query: string, description: string | null): number {
  if (!description) return 0;
  if (!query) return 0;
  const q = query.trim().toLowerCase();
  const p = description.toLowerCase();
  if (p === q) return 0.8;
  if (p.startsWith(q)) return 0.5;
  if (p.includes(q)) return 0.3;
  return 0;
}

const amountBucket = (n: number) => Math.round(n * 100) / 100;

export const historyProvider: SuggestionProvider = {
  id: "history",
  enabled: () => true,
  async suggest(ctx: SuggestionContext): Promise<Suggestion[]> {
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const userDom = ctx.date.getDate();
    const hasAmount = ctx.amountNum != null && ctx.amountNum > 0;
    const hasDescription = ctx.description.trim().length > 0;
    if (!hasAmount && !hasDescription) return [];

    type Group = {
      key: string;
      best: Suggestion;
      count: number;
      maxScore: number;
    };
    const groups = new Map<string, Group>();

    for (const t of ctx.recentTransactions) {
      if (t.type !== ctx.type) continue;
      if (new Date(t.occurred_on).getTime() < cutoff) continue;

      const aScore = hasAmount ? amountScore(ctx.amountNum, Number(t.amount)) : 0;
      const pScore = hasDescription ? payeeScore(ctx.description, t.description) : 0;

      // Need at least one positive signal
      if (aScore === 0 && pScore === 0) continue;

      const recency = recencyBoost(t.occurred_on);
      const dom = new Date(t.occurred_on).getDate() === userDom ? 0.05 : 0;

      let score = aScore * 0.55 + pScore * 0.35 + recency + dom;
      score = Math.min(1, score);

      const key = `${(t.description ?? "").toLowerCase()}|${t.category_id ?? ""}|${amountBucket(Number(t.amount))}|${t.source_account_id}`;
      const existing = groups.get(key);
      if (!existing || score > existing.maxScore) {
        const draft = {
          type: t.type,
          amount: Number(t.amount),
          source_account_id: t.source_account_id,
          destination_account_id: t.destination_account_id,
          category_id: t.category_id,
          description: t.description,
          note: t.note,
        };
        const cat = ctx.categories.find((c) => c.id === t.category_id);
        const acc = ctx.accounts.find((a) => a.id === t.source_account_id);
        const parts = [
          cat?.name,
          acc?.name,
        ].filter(Boolean) as string[];
        const sug: Suggestion = {
          id: `history:${key}`,
          score,
          label: `${t.description || "—"} · ${Number(t.amount).toFixed(2)}`,
          sublabel: parts.join(" · ") || undefined,
          source: "history",
          draft,
        };
        groups.set(key, {
          key,
          best: sug,
          count: (existing?.count ?? 0) + 1,
          maxScore: score,
        });
      } else {
        existing.count += 1;
      }
    }

    // Apply frequency boost and finalise sublabel
    const out: Suggestion[] = [];
    for (const g of groups.values()) {
      const freqBoost = Math.min(0.2, Math.log(1 + g.count) / Math.log(10) * 0.2);
      const finalScore = Math.min(1, g.best.score + freqBoost);
      const subParts = [g.best.sublabel, g.count > 1 ? `${g.count}×` : null]
        .filter(Boolean) as string[];
      out.push({ ...g.best, score: finalScore, sublabel: subParts.join(" · ") || undefined });
    }
    return out;
  },
};
