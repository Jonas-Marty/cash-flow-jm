import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getIcon } from "@/lib/iconRegistry";
import { colorFromName, monogram } from "@/lib/usageScoring";

export interface EntityVisual {
  id: string;
  name: string;
  icon?: string | null;
  emoji?: string | null;
  image_url?: string | null;
  color?: string | null;
}

interface Props {
  entity: EntityVisual;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  showLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
  tabIndex?: number;
  role?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  onFocus?: () => void;
}

const LONG_PRESS_MS = 500;

export const EntityChip = React.forwardRef<HTMLButtonElement, Props>(function EntityChip(
  { entity, selected, disabled, onClick, showLabel = true, size = "md", className, tabIndex, role, onKeyDown, onFocus },
  ref,
) {
  const [tipOpen, setTipOpen] = React.useState(false);
  const timer = React.useRef<number | null>(null);
  const longPressed = React.useRef(false);

  const color = entity.color || colorFromName(entity.name);
  const Icon = getIcon(entity.icon);

  const startPress = () => {
    longPressed.current = false;
    timer.current = window.setTimeout(() => {
      longPressed.current = true;
      setTipOpen(true);
      window.setTimeout(() => setTipOpen(false), 1800);
    }, LONG_PRESS_MS);
  };
  const endPress = () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
  };
  const handleClick = (e: React.MouseEvent) => {
    if (longPressed.current) { e.preventDefault(); longPressed.current = false; return; }
    if (!disabled) onClick?.();
  };

  const dim = size === "sm" ? "h-6 w-6 text-[11px]" : "h-7 w-7 text-xs";
  const visual = entity.image_url ? (
    <img src={entity.image_url} alt="" className={cn(dim, "rounded-full object-cover")} />
  ) : entity.emoji ? (
    <span className={cn(dim, "flex items-center justify-center rounded-full bg-muted text-base leading-none")}>{entity.emoji}</span>
  ) : entity.icon ? (
    <span className={cn(dim, "flex items-center justify-center rounded-full text-white")} style={{ backgroundColor: color }}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  ) : (
    <span className={cn(dim, "flex items-center justify-center rounded-full font-semibold text-white")} style={{ backgroundColor: color }}>
      {monogram(entity.name)}
    </span>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip open={showLabel ? undefined : tipOpen} onOpenChange={showLabel ? undefined : setTipOpen}>
        <TooltipTrigger asChild>
          <button
            ref={ref}
            type="button"
            disabled={disabled}
            tabIndex={tabIndex}
            role={role}
            aria-checked={role === "radio" ? !!selected : undefined}
            aria-pressed={role !== "radio" ? !!selected : undefined}
            aria-label={entity.name}
            data-chip-id={entity.id}
            onFocus={onFocus}
            onKeyDown={onKeyDown}
            onClick={handleClick}
            onPointerDown={startPress}
            onPointerUp={endPress}
            onPointerLeave={endPress}
            onPointerCancel={endPress}
            onContextMenu={(e) => e.preventDefault()}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-sm transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                : "border-border bg-background text-foreground hover:bg-accent",
              disabled && "opacity-40 cursor-not-allowed",
              className,
            )}
          >
            {visual}
            {showLabel && <span className="max-w-[10rem] truncate pr-1">{entity.name}</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{entity.name}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
