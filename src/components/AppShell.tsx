import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, Plus, ListOrdered, Settings as SettingsIcon, Wallet, PiggyBank, LogOut, LineChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

type Tab = {
  to: "/" | "/transactions" | "/add" | "/envelopes" | "/insights" | "/settings";
  labelKey: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  primary?: boolean;
};
const tabs: Tab[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, exact: true },
  { to: "/transactions", labelKey: "nav.transactions", icon: ListOrdered },
  { to: "/envelopes", labelKey: "nav.envelopes", icon: PiggyBank },
  { to: "/add", labelKey: "nav.add", icon: Plus, primary: true },
  { to: "/insights", labelKey: "nav.insights", icon: LineChart },
  { to: "/settings", labelKey: "nav.settings", icon: SettingsIcon },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const { t } = useI18n();
  const { user, signOut } = useAuth();
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
            {user && (
              <div className="ml-3 flex items-center gap-2 border-l pl-3">
                <span className="text-xs text-muted-foreground">{user.email}</span>
                <Button size="icon" variant="ghost" onClick={signOut} title={t("auth.signout")}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-4 md:pb-10 md:pt-6">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background md:hidden">
        <ul className="mx-auto grid max-w-3xl grid-cols-6">
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
