import * as React from "react";
import { MoreHorizontal, X, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { EntityChip, type EntityVisual } from "./EntityChip";
import { cn } from "@/lib/utils";

export interface ChipPickerItem extends EntityVisual {
  pinned?: boolean;
  groupLabel?: string;
}

interface Props {
  items: ChipPickerItem[];
  value: string | null;
  onChange: (id: string) => void;
  disabledIds?: string[];
  placeholder?: string;
  moreLabel?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  allowClear?: boolean;
  clearLabel?: string;
  /** Mobile: cap chips before the "more" overflow opens. Default 8. */
  mobileTopN?: number;
  /** Desktop: cap before overflow. Default Infinity. */
  desktopTopN?: number;
}

export function ChipPicker({
  items, value, onChange, disabledIds, placeholder, moreLabel = "More",
  searchPlaceholder = "Search…", emptyLabel = "No matches",
  allowClear, clearLabel = "None",
  mobileTopN = 8, desktopTopN = Infinity,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const groupRef = React.useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = React.useRef<HTMLElement | null>(null);
  const commandRef = React.useRef<HTMLDivElement | null>(null);
  const disabledSet = React.useMemo(() => new Set(disabledIds ?? []), [disabledIds]);

  // Always show the selected one even if it would be cut off
  const ensureSelected = (visible: ChipPickerItem[]): ChipPickerItem[] => {
    if (!value) return visible;
    if (visible.some((i) => i.id === value)) return visible;
    const sel = items.find((i) => i.id === value);
    return sel ? [sel, ...visible] : visible;
  };

  const mobileVisible = ensureSelected(items.slice(0, mobileTopN));
  const desktopVisible = ensureSelected(items.slice(0, desktopTopN));
  const hasMobileOverflow = items.length > mobileVisible.length;
  const hasDesktopOverflow = items.length > desktopVisible.length;

  const selectedLabel = items.find((i) => i.id === value)?.name;

  // Roving focus: only one chip is in the tab order at a time
  const focusableIds = React.useMemo(
    () => items.filter((i) => !disabledSet.has(i.id)).map((i) => i.id),
    [items, disabledSet],
  );
  // Track which chip is "active" for tab order. Updated on focus/selection so
  // arrow navigation always reads the latest position even if `value` lags.
  const [activeId, setActiveId] = React.useState<string | undefined>(
    () => (value && focusableIds.includes(value) ? value : focusableIds[0]),
  );
  React.useEffect(() => {
    // When the externally-selected value changes (or the list of focusable ids
    // shifts), make sure the active chip is still valid.
    setActiveId((prev) => {
      if (value && focusableIds.includes(value)) return value;
      if (prev && focusableIds.includes(prev)) return prev;
      return focusableIds[0];
    });
  }, [value, focusableIds]);

  const focusChip = (id: string | undefined) => {
    if (!id) return;
    const root = groupRef.current;
    if (!root) return;
    // The chip is rendered in BOTH the mobile and desktop rows; focus the one
    // currently visible (offsetParent !== null) so arrow keys keep working.
    const els = root.querySelectorAll<HTMLButtonElement>(`button[data-chip-id="${CSS.escape(id)}"]`);
    const visible = Array.from(els).find((el) => el.offsetParent !== null) ?? els[0];
    visible?.focus();
  };

  const openSearch = () => {
    lastFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
    setOpen(true);
  };

  React.useEffect(() => {
    if (open) return;
    const el = lastFocusedRef.current;
    if (el && document.body.contains(el)) {
      // Restore focus when popover closes
      requestAnimationFrame(() => el.focus());
      lastFocusedRef.current = null;
    }
  }, [open]);

  const onChipKey = (e: React.KeyboardEvent<HTMLButtonElement>, currentId: string) => {
    const list = focusableIds;
    const idx = list.indexOf(currentId);
    if (idx === -1) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = list[(idx + 1) % list.length];
      if (next) { setActiveId(next); onChange(next); requestAnimationFrame(() => focusChip(next)); }
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = list[(idx - 1 + list.length) % list.length];
      if (prev) { setActiveId(prev); onChange(prev); requestAnimationFrame(() => focusChip(prev)); }
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = list[0]; if (first) { setActiveId(first); onChange(first); requestAnimationFrame(() => focusChip(first)); }
    } else if (e.key === "End") {
      e.preventDefault();
      const last = list[list.length - 1]; if (last) { setActiveId(last); onChange(last); requestAnimationFrame(() => focusChip(last)); }
    } else if (e.key === "/" || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      openSearch();
    } else if (
      e.key.length === 1 &&
      !e.ctrlKey && !e.metaKey && !e.altKey &&
      /[a-zA-Z0-9]/.test(e.key)
    ) {
      // Type-ahead: open search popover with first character pre-filled
      lastFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
      setSearch(e.key);
      setOpen(true);
      e.preventDefault();
    }
  };

  const [search, setSearch] = React.useState("");
  React.useEffect(() => { if (!open) setSearch(""); }, [open]);

  // Confirm the currently highlighted cmdk item (if any) and select it.
  const commitHighlighted = (): boolean => {
    const root = commandRef.current;
    if (!root) return false;
    const el = root.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]:not([data-disabled="true"])');
    const id = el?.getAttribute("data-chip-pick-id");
    if (!id) return false;
    onChange(id);
    setActiveId(id);
    setOpen(false);
    return true;
  };

  const renderRow = (visible: ChipPickerItem[], hasOverflow: boolean) => (
    <>
      {allowClear && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onChange("")}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors",
            !value ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-dashed border-border text-muted-foreground hover:bg-accent",
          )}
        >
          <X className="h-3 w-3" /> {clearLabel}
        </button>
      )}
      {visible.map((it) => (
        <EntityChip
          key={it.id}
          entity={it}
          selected={value === it.id}
          disabled={disabledSet.has(it.id)}
          onClick={() => onChange(it.id)}
          role="radio"
          tabIndex={it.id === activeId ? 0 : -1}
          onKeyDown={(e) => onChipKey(e, it.id)}
          onFocus={() => setActiveId(it.id)}
        />
      ))}
      {hasOverflow && (
        <button
          type="button"
          tabIndex={-1}
          onClick={openSearch}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-sm text-muted-foreground hover:bg-accent"
        >
          <MoreHorizontal className="h-3.5 w-3.5" /> {moreLabel}
        </button>
      )}
      {!hasOverflow && items.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          onClick={openSearch}
          aria-label={searchPlaceholder}
          title={searchPlaceholder + " (/)"}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <Search className="h-3 w-3" />
        </button>
      )}
    </>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={groupRef} role="radiogroup" aria-label={selectedLabel ?? placeholder ?? "Picker"}>
          {/* Mobile: horizontal scroll */}
          <div className="flex gap-2 overflow-x-auto pb-1 md:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {items.length === 0 && <span className="text-sm text-muted-foreground">{placeholder}</span>}
            {renderRow(mobileVisible, hasMobileOverflow)}
          </div>

          {/* Desktop: wrap */}
          <div className="hidden flex-wrap gap-2 md:flex">
            {items.length === 0 && <span className="text-sm text-muted-foreground">{placeholder}</span>}
            {renderRow(desktopVisible, hasDesktopOverflow)}
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent className="w-72 p-0" align="start">
        <Command ref={commandRef}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              // Tab confirms the highlighted item, then advances focus naturally.
              if (e.key === "Tab") {
                const ok = commitHighlighted();
                if (ok) {
                  // Let the browser perform the default tab navigation so focus
                  // jumps to the next focusable element after the picker.
                  // Don't preventDefault; just close the popover (already done).
                }
              }
            }}
          />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {items.map((it) => (
                <CommandItem
                  key={it.id}
                  value={it.name}
                  disabled={disabledSet.has(it.id)}
                  data-chip-pick-id={it.id}
                  onSelect={() => { onChange(it.id); setActiveId(it.id); setOpen(false); }}
                >
                  <EntityChip entity={it} showLabel={false} size="sm" tabIndex={-1} />
                  <span className="ml-2">{it.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
