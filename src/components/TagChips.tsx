import * as React from "react";
import type { Transaction } from "@/lib/finance";
import { extractTags } from "@/lib/finance";
import { cn } from "@/lib/utils";

export function TagChips({
  transactions,
  currentNote,
  onAppend,
  onRemove,
  className,
}: {
  transactions: Transaction[];
  currentNote: string;
  onAppend: (tag: string) => void;
  onRemove?: (tag: string) => void;
  className?: string;
}) {
  const present = React.useMemo(() => extractTags(currentNote), [currentNote]);
  const presentSet = React.useMemo(() => new Set(present), [present]);

  const top = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of transactions) {
      for (const tag of extractTags(t.note)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t]) => t);
  }, [transactions]);

  // Merge: active (in-note) tags first, then top suggestions not already shown.
  const merged = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of present) { if (!seen.has(t)) { seen.add(t); out.push(t); } }
    for (const t of top) { if (!seen.has(t)) { seen.add(t); out.push(t); } }
    return out;
  }, [present, top]);

  if (merged.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {merged.map((t) => {
        const isOn = presentSet.has(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => {
              if (isOn) onRemove?.(t);
              else onAppend(t);
            }}
            aria-pressed={isOn}
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
              isOn
                ? "border-primary/50 bg-primary/15 text-primary hover:bg-primary/20"
                : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {`#${t}`}
          </button>
        );
      })}
    </div>
  );
}
