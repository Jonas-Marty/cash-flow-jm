import * as React from "react";
import { cn } from "@/lib/utils";
import {
  DASHBOARD_PRIVACY_KEY,
  DashboardPrivacyContext,
  readDashboardPrivacy,
  useDashboardPrivacy,
} from "@/lib/dashboardPrivacy";

export function DashboardPrivacyProvider({ children }: { children: React.ReactNode }) {
  // Start concealed on SSR and during hydration so a persisted private dashboard
  // can never flash readable values before browser storage is checked.
  const [hidden, setHidden] = React.useState(true);

  React.useEffect(() => {
    setHidden(readDashboardPrivacy(window.localStorage));
  }, []);

  const toggle = React.useCallback(() => {
    setHidden((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(DASHBOARD_PRIVACY_KEY, String(next));
      } catch {
        // Privacy mode remains usable for this visit when storage is unavailable.
      }
      return next;
    });
  }, []);

  return (
    <DashboardPrivacyContext.Provider value={{ hidden, toggle }}>
      {children}
    </DashboardPrivacyContext.Provider>
  );
}

export function PrivacyValue({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { hidden } = useDashboardPrivacy();
  return (
    <span
      className={cn(
        "inline-block transition-[filter] duration-150",
        hidden && "select-none blur-sm",
        className,
      )}
      data-dashboard-private={hidden ? "hidden" : "visible"}
    >
      {children}
    </span>
  );
}
