import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Transaction } from "@/lib/finance";

const HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 86_400_000;

function decay(occurredOn: string, now: number): number {
  const age = (now - new Date(occurredOn).getTime()) / MS_PER_DAY;
  if (age < 0) return 1;
  return Math.exp(-age / HALF_LIFE_DAYS);
}

type Scored = { description: string; score: number; lastOn: string; count: number };

function scoreDescriptions(transactions: Transaction[], query: string, now: number): Scored[] {
  const q = query.trim().toLowerCase();
  const map = new Map<string, Scored>();
  for (const t of transactions) {
    if (!t.description) continue;
    const p = t.description;
    const lower = p.toLowerCase();
    if (q && !lower.includes(q)) continue;
    const w = decay(t.occurred_on, now);
    // Match-quality boost
    let mq = 1;
    if (q) {
      if (lower === q) mq = 2.5;
      else if (lower.startsWith(q)) mq = 1.8;
      else mq = 1.0;
    }
    const existing = map.get(lower);
    if (!existing) {
      map.set(lower, { description: p, score: w * mq, lastOn: t.occurred_on, count: 1 });
    } else {
      existing.score += w * mq;
      existing.count += 1;
      if (t.occurred_on > existing.lastOn) {
        existing.lastOn = t.occurred_on;
        // Prefer the most recent casing
        existing.description = p;
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score);
}

export interface DescriptionAutocompleteProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  transactions: Transaction[];
  placeholder?: string;
  maxItems?: number;
  className?: string;
}

export function DescriptionAutocomplete({
  id,
  value,
  onChange,
  onSelect,
  transactions,
  placeholder,
  maxItems = 8,
  className,
}: DescriptionAutocompleteProps) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const items = React.useMemo(() => {
    const now = Date.now();
    return scoreDescriptions(transactions, value, now).slice(0, maxItems);
  }, [transactions, value, maxItems]);

  // Reset highlight when items change
  React.useEffect(() => { setActive(0); }, [value, items.length]);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const commit = (v: string) => {
    onChange(v);
    onSelect?.(v);
    setOpen(false);
  };

  const showList = open && items.length > 0 &&
    !(items.length === 1 && items[0].description.toLowerCase() === value.trim().toLowerCase());

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Input
        id={id}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        aria-controls={id ? `${id}-listbox` : undefined}
        aria-activedescendant={showList && id ? `${id}-opt-${active}` : undefined}
        onKeyDown={(e) => {
          if (!showList) {
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && items.length > 0) {
              setOpen(true);
              e.preventDefault();
            }
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + items.length) % items.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            commit(items[active].description);
          } else if (e.key === "Tab") {
            // Accept current highlight without preventing tab navigation
            commit(items[active].description);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showList && (
        <div
          id={id ? `${id}-listbox` : undefined}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {items.map((it, i) => (
            <div
              key={it.description}
              id={id ? `${id}-opt-${i}` : undefined}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); commit(it.description); }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm",
                i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
              )}
            >
              <span className="truncate">{it.description}</span>
              {it.count > 1 && (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{it.count}×</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}