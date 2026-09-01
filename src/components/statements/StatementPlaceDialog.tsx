import * as React from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LocationSection, type RecentLocation } from "@/components/LocationSection";
import { useI18n } from "@/i18n";
import type { TxLocation } from "@/lib/location";

/**
 * Small overlay around the shared LocationSection so a table row can pick a
 * place (search + map + recent pins) without leaving the statement view.
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("statements.table.place")}</DialogTitle>
        </DialogHeader>
        <LocationSection value={value} onChange={onChange} dateIsToday={false} recent={recent} />
      </DialogContent>
    </Dialog>
  );
}
