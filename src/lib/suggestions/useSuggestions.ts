import * as React from "react";
import type { Suggestion, SuggestionContext } from "./types";
import { runSuggestions } from "./registry";

export function useSuggestions(ctx: SuggestionContext): { suggestions: Suggestion[]; isLoading: boolean } {
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [isLoading, setLoading] = React.useState(false);

  // Stable signature for debounce
  const sig = JSON.stringify({
    type: ctx.type,
    amountNum: ctx.amountNum,
    payee: ctx.payee.trim().toLowerCase(),
    sourceId: ctx.sourceId,
    txCount: ctx.recentTransactions.length,
    accCount: ctx.accounts.length,
    catCount: ctx.categories.length,
    dom: ctx.date.getDate(),
  });

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      runSuggestions(ctx).then((r) => {
        if (!cancelled) {
          setSuggestions(r);
          setLoading(false);
        }
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return { suggestions, isLoading };
}
