import * as React from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LocationSection, type RecentLocation } from "@/components/LocationSection";
import { useI18n } from "@/i18n";
import type { TxLocation } from "@/lib/location";

/**
 * Overlay around the shared LocationSection so a table row can pick a place
 * (search + map + recent pins) without leaving the table.
 *
 * Wider than the default dialog, and the section runs in its `picker` variant: this
 * overlay exists *because* the user asked to choose a place, so starting collapsed
 * with a thumbnail — which is right on the Add form, where location is one optional
 * field among many — puts a click between them and the only thing on screen.
 */
export function StatementPlaceDialog({
  open,
  onOpenChange,
  value,
  onChange,
  recent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: TxLocation | null;
  onChange: (loc: TxLocation | null) => void;
  recent?: RecentLocation[];
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("statements.table.place")}</DialogTitle>
        </DialogHeader>
        <LocationSection
          value={value}
          onChange={onChange}
          dateIsToday={false}
          recent={recent}
          variant="picker"
        />
      </DialogContent>
    </Dialog>
  );
}
