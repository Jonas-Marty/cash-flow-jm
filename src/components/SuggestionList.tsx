import * as React from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The dropdown under a text field that suggests values as you type (past
 * descriptions, tags). The field keeps the focus and owns the keyboard; this
 * only draws the options and reports a pick.
 *
 * It renders in a portal, positioned against the field. Drawn inside the
 * field's own box instead, it was clipped by any scrolling ancestor, which is
 * what the pending table is on a wide screen, so the last rows' suggestions
 * vanished under the fold. The popover also flips above the field when there
 * is no room below, as on a phone with the keyboard up.
 */
export function SuggestionList<T>({
  open,
  onClose,
  field,
  items,
  active,
  onActive,
  onPick,
  itemKey,
  renderItem,
  listId,
  optionId,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** The input or textarea the suggestions belong to. */
  field: React.ReactNode;
  items: T[];
  active: number;
  onActive: (index: number) => void;
  onPick: (item: T) => void;
  itemKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  listId?: string;
  optionId?: (index: number) => string;
  /** Classes for the wrapper around the field. */
  className?: string;
}) {
  const anchorRef = React.useRef<HTMLDivElement>(null);
  // A press or focus inside the field is not "outside": clicking into the
  // text to move the caret must not close the list under the user's hand.
  const insideField = (e: Event) => !!anchorRef.current?.contains(e.target as Node);
  return (
    <Popover open={open && items.length > 0} onOpenChange={(o) => !o && onClose()}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className={cn("relative", className)}>
          {field}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="max-h-64 w-(--radix-popover-trigger-width) min-w-48 overflow-y-auto p-1"
        // The field keeps the focus; the list is never tabbed into.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => insideField(e) && e.preventDefault()}
        onFocusOutside={(e) => insideField(e) && e.preventDefault()}
      >
        <div role="listbox" id={listId}>
          {items.map((item, i) => (
            <div
              key={itemKey(item)}
              id={optionId?.(i)}
              role="option"
              aria-selected={i === active}
              // mousedown, not click, and no default: the field must not blur
              // before the pick lands, or the list would close first.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(item);
              }}
              onMouseEnter={() => onActive(i)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm",
                i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
              )}
            >
              {renderItem(item)}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
