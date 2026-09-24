import * as React from "react";
import { Input } from "@/components/ui/input";
import { SuggestionList, listKeyHandler } from "@/components/SuggestionList";
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
  /** Classes for the input itself, e.g. the tables' compact `h-8`. */
  inputClassName?: string;
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
  inputClassName,
}: DescriptionAutocompleteProps) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);

  const items = React.useMemo(() => {
    const now = Date.now();
    return scoreDescriptions(transactions, value, now).slice(0, maxItems);
  }, [transactions, value, maxItems]);

  // Reset highlight when items change
  React.useEffect(() => { setActive(0); }, [value, items.length]);

  const commit = (v: string) => {
    onChange(v);
    onSelect?.(v);
    setOpen(false);
  };

  // Nothing to suggest when the only match is what is already typed.
  const showList = open && items.length > 0 &&
    !(items.length === 1 && items[0].description.toLowerCase() === value.trim().toLowerCase());

  return (
    <SuggestionList
      className={className}
      open={showList}
      onClose={() => setOpen(false)}
      items={items}
      active={active}
      onActive={setActive}
      onPick={(it) => commit(it.description)}
      itemKey={(it) => it.description}
      listId={id ? `${id}-listbox` : undefined}
      optionId={id ? (i) => `${id}-opt-${i}` : undefined}
      renderItem={(it) => (
        <>
          <span className="truncate">{it.description}</span>
          {it.count > 1 && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{it.count}×</span>
          )}
        </>
      )}
      field={
        <Input
          id={id}
          value={value}
          className={inputClassName}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
          aria-controls={id ? `${id}-listbox` : undefined}
          aria-activedescendant={showList && id ? `${id}-opt-${active}` : undefined}
          onKeyDown={listKeyHandler({
            open: showList,
            count: items.length,
            setActive,
            pickActive: () => commit(items[active].description),
            close: () => setOpen(false),
            openList: () => setOpen(true),
          })}
        />
      }
    />
  );
}
