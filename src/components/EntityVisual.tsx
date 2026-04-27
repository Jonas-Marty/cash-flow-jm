import * as React from "react";
import { cn } from "@/lib/utils";
import { getIcon } from "@/lib/iconRegistry";
import { colorFromName, monogram } from "@/lib/usageScoring";

export interface EntityLike {
  name: string;
  icon?: string | null;
  emoji?: string | null;
  image_url?: string | null;
  color?: string | null;
}

interface Props {
  entity: EntityLike;
  size?: "xs" | "sm" | "md";
  className?: string;
}

/** Static icon/emoji/image circle for an account or category. */
export function EntityVisual({ entity, size = "sm", className }: Props) {
  const dim =
    size === "xs" ? "h-5 w-5 text-[10px]" : size === "md" ? "h-9 w-9 text-sm" : "h-7 w-7 text-xs";
  const iconSize = size === "xs" ? "h-3 w-3" : size === "md" ? "h-5 w-5" : "h-3.5 w-3.5";
  const color = entity.color || colorFromName(entity.name);
  const Icon = getIcon(entity.icon);

  if (entity.image_url) {
    return <img src={entity.image_url} alt="" className={cn(dim, "rounded-full object-cover", className)} />;
  }
  if (entity.emoji) {
    return (
      <span className={cn(dim, "flex items-center justify-center rounded-full bg-muted leading-none", className)}>
        {entity.emoji}
      </span>
    );
  }
  if (entity.icon) {
    return (
      <span
        className={cn(dim, "flex items-center justify-center rounded-full text-white", className)}
        style={{ backgroundColor: color }}
      >
        <Icon className={iconSize} />
      </span>
    );
  }
  return (
    <span
      className={cn(dim, "flex items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ backgroundColor: color }}
    >
      {monogram(entity.name)}
    </span>
  );
}
