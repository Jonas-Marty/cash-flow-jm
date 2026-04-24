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

  const weekdayLabel = (d: Date) => {
    const w = format(d, "EEEE", { locale });
    return `${labels.last_prefix} ${w.charAt(0).toUpperCase()}${w.slice(1)}`;
  };

  const entries = React.useMemo(() => {
    const list: { key: string; label: string; date: Date }[] = [
      { key: "today", label: labels.today, date: today },
      { key: "yesterday", label: labels.yesterday, date: yesterday },
    ];
    previous.forEach((d) => list.push({ key: d.toISOString(), label: weekdayLabel(d), date: d }));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels.today, labels.yesterday, labels.last_prefix, locale]);

  const groupRef = React.useRef<HTMLDivElement | null>(null);
  const selectedKey = entries.find((e) => sameDay(selected, e.date))?.key;
  const [activeKey, setActiveKey] = React.useState<string>(() => selectedKey ?? entries[0].key);
  React.useEffect(() => {
    setActiveKey((prev) => {
      if (selectedKey) return selectedKey;
      if (entries.some((e) => e.key === prev)) return prev;
      return entries[0].key;
    });
  }, [selectedKey, entries]);

  const focusKey = (k: string) => {
    const root = groupRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLButtonElement>(`button[data-shortcut-key="${CSS.escape(k)}"]`);
    el?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, currentKey: string) => {
    const idx = entries.findIndex((x) => x.key === currentKey);
    if (idx === -1) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = entries[(idx + 1) % entries.length];
      setActiveKey(next.key); onPick(next.date);
      requestAnimationFrame(() => focusKey(next.key));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = entries[(idx - 1 + entries.length) % entries.length];
      setActiveKey(prev.key); onPick(prev.date);
      requestAnimationFrame(() => focusKey(prev.key));
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = entries[0];
      setActiveKey(first.key); onPick(first.date);
      requestAnimationFrame(() => focusKey(first.key));
    } else if (e.key === "End") {
      e.preventDefault();
      const last = entries[entries.length - 1];
      setActiveKey(last.key); onPick(last.date);
      requestAnimationFrame(() => focusKey(last.key));
    }
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {entries.map((e) => {
        const isSelected = sameDay(selected, e.date);
        return (
          <button
            key={e.key}
            type="button"
            role="radio"
            aria-checked={isSelected}
            data-shortcut-key={e.key}
            tabIndex={e.key === activeKey ? 0 : -1}
            onClick={() => { setActiveKey(e.key); onPick(e.date); }}
            onFocus={() => setActiveKey(e.key)}
            onKeyDown={(ev) => onKey(ev, e.key)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:bg-accent",
            )}
          >
            {e.label}
          </button>
        );
      })}
    </div>
  );
}
