import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface StringAutocompleteProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  options: string[];
  placeholder?: string;
  maxItems?: number;
  className?: string;
}

/**
 * Lightweight autocomplete for free-text fields backed by a list of known
 * string values (e.g. reimbursable counterparties). Matches by case-insensitive
 * substring and sorts exact > startsWith > contains, then alphabetically.
 */
export function StringAutocomplete({
  id,
  value,
  onChange,
  onSelect,
  options,
  placeholder,
  maxItems = 8,
  className,
}: StringAutocompleteProps) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const items = React.useMemo(() => {
    const q = value.trim().toLowerCase();
    const seen = new Set<string>();
    const scored: { v: string; rank: number }[] = [];
    for (const opt of options) {
      if (!opt) continue;
      const key = opt.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!q) {
        scored.push({ v: opt, rank: 3 });
        continue;
      }
      if (key === q) scored.push({ v: opt, rank: 0 });
      else if (key.startsWith(q)) scored.push({ v: opt, rank: 1 });
      else if (key.includes(q)) scored.push({ v: opt, rank: 2 });
    }
    scored.sort((a, b) => a.rank - b.rank || a.v.localeCompare(b.v));
    return scored.slice(0, maxItems).map((s) => s.v);
  }, [options, value, maxItems]);

  React.useEffect(() => { setActive(0); }, [value, items.length]);

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
    !(items.length === 1 && items[0].toLowerCase() === value.trim().toLowerCase());

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
            commit(items[active]);
          } else if (e.key === "Tab") {
            commit(items[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showList && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {items.map((it, i) => (
            <div
              key={it}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); commit(it); }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
              )}
            >
              <span className="truncate">{it}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}