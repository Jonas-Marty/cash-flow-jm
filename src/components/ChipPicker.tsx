import * as React from "react";
import { MoreHorizontal, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

  const renderRow = (visible: ChipPickerItem[], hasOverflow: boolean) => (
    <>
      {allowClear && (
        <button
          type="button"
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
        />
      ))}
      {hasOverflow && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-sm text-muted-foreground hover:bg-accent"
        >
          <MoreHorizontal className="h-3.5 w-3.5" /> {moreLabel}
        </button>
      )}
    </>
  );

  return (
    <>
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

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <span className="sr-only">{selectedLabel ?? placeholder}</span>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyLabel}</CommandEmpty>
              <CommandGroup>
                {items.map((it) => (
                  <CommandItem
                    key={it.id}
                    value={it.name}
                    disabled={disabledSet.has(it.id)}
                    onSelect={() => { onChange(it.id); setOpen(false); }}
                  >
                    <EntityChip entity={it} showLabel={false} size="sm" />
                    <span className="ml-2">{it.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
