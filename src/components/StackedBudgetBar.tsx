import * as React from "react";
import { cn } from "@/lib/utils";

export interface StackedBudgetBarProps {
  allocated: number;
  committed: number;
  pending: number;
  className?: string;
}

/**
 * Stacked progress bar:
 *  - committed segment (success / warning when projected ≥80%)
 *  - pending segment (warning / orange)
 *  - over-projected tail (destructive) when projected > allocated
 * Scale: 0 .. max(allocated, projected). When over, the bar fills 100%
 * and the destructive segment marks the overshoot.
 */
export function StackedBudgetBar({ allocated, committed, pending, className }: StackedBudgetBarProps) {
  const safeCommitted = Math.max(0, committed);
  const safePending = Math.max(0, pending);
  const projected = safeCommitted + safePending;
  const denom = Math.max(allocated, projected, 1);

  const over = allocated > 0 && projected > allocated;
  const projectedRatio = projected / allocated; // for tone selection only

  // Committed tone: green normally, warning at ≥80% projected, destructive when projected over.
  let committedTone = "bg-success";
  if (over) committedTone = "bg-destructive";
  else if (allocated > 0 && projectedRatio >= 0.8) committedTone = "bg-warning";

  // Widths are relative to denom so segments add up correctly even when over.
  // When over: render committed (capped at allocated), then pending up to allocated, then a destructive tail = overshoot.
  let committedW: number;
  let pendingW: number;
  let overW = 0;

  if (over) {
    // Allocate committed first (up to allocated), then pending fills the rest of the allocated band,
    // any leftover (committed+pending - allocated) is the overshoot tail.
    const committedInBand = Math.min(safeCommitted, allocated);
    const pendingInBand = Math.max(0, Math.min(safePending, allocated - committedInBand));
    const overshoot = projected - allocated;
    committedW = (committedInBand / denom) * 100;
    pendingW = (pendingInBand / denom) * 100;
    overW = (overshoot / denom) * 100;
  } else {
    committedW = (safeCommitted / denom) * 100;
    pendingW = (safePending / denom) * 100;
  }

  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted flex", className)}>
      {committedW > 0 && (
        <div className={cn("h-full transition-all", committedTone)} style={{ width: `${committedW}%` }} />
      )}
      {pendingW > 0 && (
        <div className="h-full bg-warning/70 transition-all" style={{ width: `${pendingW}%` }} />
      )}
      {overW > 0 && (
        <div className="h-full bg-destructive transition-all" style={{ width: `${overW}%` }} />
      )}
    </div>
  );
}