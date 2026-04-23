import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, Plus, ListOrdered, Settings as SettingsIcon, Wallet, PiggyBank } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

type Tab = {
  to: "/" | "/transactions" | "/add" | "/envelopes" | "/settings";
  labelKey: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  primary?: boolean;
};
const tabs: Tab[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, exact: true },
  { to: "/transactions", labelKey: "nav.transactions", icon: ListOrdered },
  { to: "/add", labelKey: "nav.add", icon: Plus, primary: true },
  { to: "/envelopes", labelKey: "nav.envelopes", icon: PiggyBank },
  { to: "/settings", labelKey: "nav.settings", icon: SettingsIcon },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="hidden md:block sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Wallet className="h-5 w-5" />
            <span>{t("app.name")}</span>
          </Link>
          <nav className="flex items-center gap-1">
            {tabs.map((tab) => {
              const active = tab.exact ? loc.pathname === tab.to : loc.pathname.startsWith(tab.to);
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <tab.icon className="h-4 w-4" />
                  {t(tab.labelKey)}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-4 md:pb-10 md:pt-6">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background md:hidden">
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
          {tabs.map((tab) => {
            const active = tab.exact ? loc.pathname === tab.to : loc.pathname.startsWith(tab.to);
            const Icon = tab.icon;
            if (tab.primary) {
              return (
                <li key={tab.to} className="flex items-center justify-center">
                  <Link
                    to={tab.to}
                    className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background"
                    aria-label={t("nav.add_transaction")}
                  >
                    <Icon className="h-6 w-6" />
                  </Link>
                </li>
              );
            }
            return (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  className={cn(
                    "flex flex-col items-center gap-0.5 px-2 py-2.5 text-[11px] font-medium",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {t(tab.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
