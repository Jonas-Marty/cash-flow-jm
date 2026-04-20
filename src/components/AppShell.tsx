import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, Plus, ListOrdered, Settings as SettingsIcon, Wallet, PiggyBank } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = {
  to: "/" | "/transactions" | "/add" | "/envelopes" | "/settings";
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  primary?: boolean;
};
const tabs: Tab[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/transactions", label: "Transactions", icon: ListOrdered },
  { to: "/add", label: "Add", icon: Plus, primary: true },
  { to: "/envelopes", label: "Envelopes", icon: PiggyBank },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop top nav */}
      <header className="hidden md:block sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Wallet className="h-5 w-5" />
            <span>Cashflow</span>
          </Link>
          <nav className="flex items-center gap-1">
            {tabs.map((t) => {
              const active = t.exact ? loc.pathname === t.to : loc.pathname.startsWith(t.to);
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <t.icon className="h-4 w-4" />
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-4 md:pb-10 md:pt-6">
        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background md:hidden">
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
          {tabs.map((t) => {
            const active = t.exact ? loc.pathname === t.to : loc.pathname.startsWith(t.to);
            const Icon = t.icon;
            if (t.primary) {
              return (
                <li key={t.to} className="flex items-center justify-center">
                  <Link
                    to={t.to}
                    className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background"
                    aria-label="Add transaction"
                  >
                    <Icon className="h-6 w-6" />
                  </Link>
                </li>
              );
            }
            return (
              <li key={t.to}>
                <Link
                  to={t.to}
                  className={cn(
                    "flex flex-col items-center gap-0.5 px-2 py-2.5 text-[11px] font-medium",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
