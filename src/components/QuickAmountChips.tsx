import * as React from "react";
import type { Transaction, TxType } from "@/lib/finance";
import { cn } from "@/lib/utils";

export function QuickAmountChips({
  transactions,
  type,
  symbol,
  onPick,
  className,
  excludeTransactionIds,
}: {
  transactions: Transaction[];
  type: TxType;
  symbol: string;
  onPick: (amount: string) => void;
  className?: string;
  excludeTransactionIds?: Set<string>;
}) {
  const top = React.useMemo(() => {
    const counts = new Map<number, number>();
    for (const t of transactions) {
      if (t.type !== type) continue;
      if (excludeTransactionIds?.has(t.id)) continue;
      const a = Math.round(Number(t.amount) * 100) / 100;
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([a]) => a);
  }, [transactions, type, excludeTransactionIds]);

  if (top.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {top.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onPick(a.toFixed(2))}
          className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium tabular-nums text-foreground shadow-sm hover:bg-accent"
        >
          {symbol} {a.toFixed(2)}
        </button>
      ))}
    </div>
  );
}
