import * as React from "react";
import type { Locale } from "date-fns";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export function DateShortcuts({
  selected,
  onPick,
  labels,
  locale,
  className,
}: {
  selected: Date;
  onPick: (d: Date) => void;
  labels: {
    today: string;
    yesterday: string;
    /** Prefix like "Last" / "Letzten" applied to weekday names (e.g. "Last Friday"). */
    last_prefix: string;
  };
  locale?: Locale;
  className?: string;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  // Four days before yesterday (i.e. today − 2 … today − 5).
  const previous: Date[] = [];
  for (let i = 2; i <= 5; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    previous.push(d);
  }

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const item = (label: string, d: Date) => (
    <button
      key={d.toISOString()}
      type="button"
      onClick={() => onPick(d)}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        sameDay(selected, d)
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:bg-accent",
      )}
    >
      {label}
    </button>
  );

  const weekdayLabel = (d: Date) => {
    const w = format(d, "EEEE", { locale });
    return `${labels.last_prefix} ${w.charAt(0).toUpperCase()}${w.slice(1)}`;
  };

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {item(labels.today, today)}
      {item(labels.yesterday, yesterday)}
      {previous.map((d) => item(weekdayLabel(d), d))}
    </div>
  );
}
