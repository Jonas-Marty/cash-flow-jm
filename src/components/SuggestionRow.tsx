import * as React from "react";
import { Sparkles, History, Tag as TagIcon, Receipt as ReceiptIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Suggestion } from "@/lib/suggestions/types";

const sourceIcon = (src: Suggestion["source"]) => {
  switch (src) {
    case "history": return History;
    case "payee_match": return TagIcon;
    case "ai": return Sparkles;
    case "receipt": return ReceiptIcon;
    default: return History;
  }
};

export function SuggestionRow({
  suggestions,
  onApply,
  symbol,
  applyAllLabel,
}: {
  suggestions: Suggestion[];
  onApply: (s: Suggestion, mode: "sticky" | "all") => void;
  symbol: string;
  applyAllLabel: string;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="-mx-1 flex h-full gap-2 overflow-x-auto px-1 pb-1">
      {suggestions.map((s) => {
        const Icon = sourceIcon(s.source);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onApply(s, "sticky")}
            className={cn(
              "group flex h-full min-w-[180px] max-w-[260px] shrink-0 flex-col rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/40",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Icon className="h-3 w-3" />
                {s.source === "history" ? "Recent" : s.source === "payee_match" ? "Description" : s.source}
              </div>
              {s.draft.amount != null && (
                <div className="text-sm font-semibold tabular-nums">
                  {symbol} {s.draft.amount.toFixed(2)}
                </div>
              )}
            </div>
            <div className="mt-1.5 truncate text-sm font-medium">{s.draft.description || s.label}</div>
            {s.sublabel && (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{s.sublabel}</div>
            )}
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onApply(s, "all"); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onApply(s, "all"); } }}
              className="mt-2 inline-block text-[11px] text-primary underline-offset-2 hover:underline"
            >
              {applyAllLabel}
            </div>
          </button>
        );
      })}
    </div>
  );
}
