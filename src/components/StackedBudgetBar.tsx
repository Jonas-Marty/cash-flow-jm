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
 *  - committed segment (success, or destructive once projected exceeds allocated)
 *  - pending segment: the same colour, lighter — pending money is the same kind of
 *    thing as spent money, just not settled. It used to be amber, which read as a
 *    warning about money that is merely expected.
 *  - over-projected tail (destructive) when projected > allocated
 *
 * There is no "approaching budget" amber band. Spending exactly your budget is the
 * plan working, not a problem, so anything at or under allocated is green and only
 * going over turns red.
 *
 * Scale: 0 .. max(allocated, projected). When over, the bar fills 100%
 * and the destructive segment marks the overshoot.
 */
export function StackedBudgetBar({ allocated, committed, pending, className }: StackedBudgetBarProps) {
  const safeCommitted = Math.max(0, committed);
  const safePending = Math.max(0, pending);
  const projected = safeCommitted + safePending;
  const denom = Math.max(allocated, projected, 1);

  // Strictly over: at exactly the allocated amount the plan held, so it stays green.
  const over = allocated > 0 && projected > allocated + 0.005;

  const committedTone = over ? "bg-destructive" : "bg-success";
  const pendingTone = over ? "bg-destructive/45" : "bg-success/45";

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
        <div className={cn("h-full transition-all", pendingTone)} style={{ width: `${pendingW}%` }} />
      )}
      {overW > 0 && (
        <div className="h-full bg-destructive transition-all" style={{ width: `${overW}%` }} />
      )}
    </div>
  );
}