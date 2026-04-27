import * as React from "react";
import type { Transaction } from "@/lib/finance";
import { extractTags } from "@/lib/finance";
import { cn } from "@/lib/utils";

export function TagChips({
  transactions,
  currentNote,
  onAppend,
  className,
}: {
  transactions: Transaction[];
  currentNote: string;
  onAppend: (tag: string) => void;
  className?: string;
}) {
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

  if (top.length === 0) return null;
  const present = new Set(extractTags(currentNote));
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {top.map((t) => {
        const isOn = present.has(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => onAppend(t)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
              isOn
                ? "border-primary/40 bg-primary/10 text-primary"
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
