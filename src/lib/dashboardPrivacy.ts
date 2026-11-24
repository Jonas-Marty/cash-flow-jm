import * as React from "react";

export const DASHBOARD_PRIVACY_KEY = "cashflow.dashboard.privacy-hidden";

type DashboardPrivacyContextValue = {
  hidden: boolean;
  toggle: () => void;
};

export const DashboardPrivacyContext = React.createContext<DashboardPrivacyContextValue | null>(
  null,
);

export function readDashboardPrivacy(storage: Pick<Storage, "getItem"> | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(DASHBOARD_PRIVACY_KEY) === "true";
  } catch {
    return false;
  }
}

export function useDashboardPrivacy() {
  return React.useContext(DashboardPrivacyContext) ?? { hidden: false, toggle: () => {} };
}
