import type { Suggestion, SuggestionContext, SuggestionProvider } from "./types";
import { historyProvider } from "./providers/history";
import { descriptionProvider } from "./providers/description";

// Register additional providers here (ai, receipt-scan, bank-import, ...)
export const providers: SuggestionProvider[] = [historyProvider, descriptionProvider];

const TOP_N = 5;
const MIN_SCORE = 0.4;

export async function runSuggestions(ctx: SuggestionContext): Promise<Suggestion[]> {
  const results = await Promise.all(
    providers.filter((p) => p.enabled()).map((p) => p.suggest(ctx).catch(() => [] as Suggestion[])),
  );
  const flat = results.flat();

  // Dedupe: prefer highest score for same (description + amount-bucket + category)
  const dedup = new Map<string, Suggestion>();
  for (const s of flat) {
    const amt = s.draft.amount != null ? Math.round(s.draft.amount * 100) / 100 : "x";
    const key = `${(s.draft.description ?? "").toLowerCase()}|${amt}|${s.draft.category_id ?? ""}`;
    const prev = dedup.get(key);
    if (!prev || s.score > prev.score) dedup.set(key, s);
  }

  return Array.from(dedup.values())
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);
}
