import { TriangleAlert } from "lucide-react";

import { IS_DEV_ENV } from "@/lib/env";

/**
 * A yellow strip on every page of the dev environment, the sign-in page
 * included, so it is never mistaken for prod. Prod renders nothing.
 */
export function DevEnvBanner() {
  if (!IS_DEV_ENV) return null;
  return (
    <>
      {/* Stays at the top edge while the strip scrolls away with the page. */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-1 bg-warning" />
      <div
        role="note"
        className="flex items-center justify-center gap-2 bg-warning px-4 pb-1.5 pt-[calc(env(safe-area-inset-top,0px)+0.375rem)] text-center text-xs font-semibold text-warning-foreground"
      >
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          DEV · Entwicklungsumgebung
          <span className="hidden sm:inline">: Kopie der Prod-Daten, Änderungen bleiben hier</span>
        </span>
      </div>
    </>
  );
}
