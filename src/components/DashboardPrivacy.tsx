import * as React from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "cashflow.dashboard.privacy-hidden";

type DashboardPrivacyContextValue = {
  hidden: boolean;
  toggle: () => void;
};

const DashboardPrivacyContext = React.createContext<DashboardPrivacyContextValue | null>(null);

export function readDashboardPrivacy(storage: Pick<Storage, "getItem"> | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

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
        window.localStorage.setItem(STORAGE_KEY, String(next));
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

export function useDashboardPrivacy() {
  return React.useContext(DashboardPrivacyContext) ?? { hidden: false, toggle: () => {} };
}

export function PrivacyValue({ children, className }: { children: React.ReactNode; className?: string }) {
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