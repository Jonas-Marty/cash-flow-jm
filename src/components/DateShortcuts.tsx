import * as React from "react";
import { cn } from "@/lib/utils";

function lastSaturday(): Date {
  const d = new Date();
  const dow = d.getDay(); // 0=Sun..6=Sat
  const diff = dow === 6 ? 7 : dow + 1; // back to previous Saturday
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function DateShortcuts({
  selected,
  onPick,
  labels,
  className,
}: {
  selected: Date;
  onPick: (d: Date) => void;
  labels: { today: string; yesterday: string; last_weekend: string };
  className?: string;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const lw = lastSaturday();

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const item = (label: string, d: Date) => (
    <button
      type="button"
      onClick={() => onPick(d)}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        sameDay(selected, d)
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {item(labels.today, today)}
      {item(labels.yesterday, yesterday)}
      {item(labels.last_weekend, lw)}
    </div>
  );
}
