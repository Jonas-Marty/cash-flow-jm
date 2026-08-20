import * as React from "react";
import { ClientOnly } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { formatAccuracy, formatCoords, osmLink, type TxLocation } from "@/lib/location";

const LazyMap = React.lazy(() => import("@/components/LocationMiniMap"));

/** Read-only map preview for a stored transaction location. */
export function LocationPeekDialog({
  location,
  onOpenChange,
}: {
  location: TxLocation | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t: tr } = useI18n();
  const acc = formatAccuracy(location?.accuracy_m);
  return (
    <Dialog open={!!location} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{location?.label ?? tr("loc.title")}</DialogTitle>
        </DialogHeader>
        {location ? (
          <div className="space-y-2">
            <ClientOnly fallback={<div className="h-56 rounded-md bg-muted" />}>
              <React.Suspense fallback={<div className="h-56 rounded-md bg-muted" />}>
                <LazyMap
                  latitude={location.latitude}
                  longitude={location.longitude}
                  accuracyM={location.accuracy_m}
                  className="h-56 w-full overflow-hidden rounded-md border"
                />
              </React.Suspense>
            </ClientOnly>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{formatCoords(location)}</span>
              {acc ? <span>{acc}</span> : null}
              <a
                href={osmLink(location)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 underline"
              >
                <ExternalLink className="h-3 w-3" /> OpenStreetMap
              </a>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}