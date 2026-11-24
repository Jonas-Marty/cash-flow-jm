import type * as React from "react";
import { CalendarDays, Package, Plane, ShoppingBag } from "lucide-react";
import type { TransactionLinkKind } from "@/lib/links";

/** The icon for each kind of transaction link. */
export const KIND_ICON: Record<TransactionLinkKind, React.ComponentType<{ className?: string }>> = {
  purchase: ShoppingBag,
  event: CalendarDays,
  trip: Plane,
  other: Package,
};
