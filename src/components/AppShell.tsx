import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, Plus, ListOrdered, Settings as SettingsIcon, Wallet, PiggyBank, LogOut, LineChart, Inbox, MoreHorizontal, Scale } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchPendingTransactions } from "@/lib/finance";

type Tab = {
  to: "/" | "/transactions" | "/add" | "/envelopes" | "/insights" | "/settings" | "/pending" | "/reconcile";
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
  { to: "/pending", labelKey: "nav.pending", icon: Inbox },
  { to: "/reconcile", labelKey: "nav.reconcile", icon: Scale },
  { to: "/settings", labelKey: "nav.settings", icon: SettingsIcon },
];

type MobileTab =
  | Tab
  | { kind: "more"; labelKey: string; icon: typeof LayoutDashboard };

const mobileMoreItems: Tab[] = [
  { to: "/insights", labelKey: "nav.insights", icon: LineChart },
  { to: "/pending", labelKey: "nav.pending", icon: Inbox },
  { to: "/reconcile", labelKey: "nav.reconcile", icon: Scale },
  { to: "/settings", labelKey: "nav.settings", icon: SettingsIcon },
];

const mobileTabs: MobileTab[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, exact: true },
  { to: "/transactions", labelKey: "nav.transactions", icon: ListOrdered },
  { to: "/add", labelKey: "nav.add", icon: Plus, primary: true },
  { to: "/envelopes", labelKey: "nav.envelopes", icon: PiggyBank },
  { kind: "more", labelKey: "nav.more", icon: MoreHorizontal },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const { t } = useI18n();
  const { user, signOut } = useAuth();
  const pendingCountQ = useQuery({
    queryKey: ["pending_transactions", "pending", "count"],
    queryFn: async () => (await fetchPendingTransactions("pending")).length,
    enabled: !!user,
    refetchInterval: 60_000,
  });
  const pendingCount = pendingCountQ.data ?? 0;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = mobileMoreItems.some((t) =>
    t.exact ? loc.pathname === t.to : loc.pathname.startsWith(t.to),
  );
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
              const showBadge = tab.to === "/pending" && pendingCount > 0;
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
                  {showBadge && (
                    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-warning-foreground">
                      {pendingCount}
                    </span>
                  )}
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
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
          {mobileTabs.map((tab) => {
            const Icon = tab.icon;
            if ("kind" in tab && tab.kind === "more") {
              const showBadge = pendingCount > 0;
              return (
                <li key="more">
                  <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "relative flex w-full flex-col items-center gap-0.5 px-2 py-2.5 text-[11px] font-medium",
                          moreActive ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        <Icon className="h-5 w-5" />
                        {t(tab.labelKey)}
                        {showBadge && (
                          <span className="absolute right-2 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-warning-foreground">
                            {pendingCount}
                          </span>
                        )}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="end"
                      sideOffset={8}
                      className="w-48 p-1"
                    >
                      <ul className="flex flex-col">
                        {mobileMoreItems.map((item) => {
                          const active = item.exact
                            ? loc.pathname === item.to
                            : loc.pathname.startsWith(item.to);
                          const ItemIcon = item.icon;
                          const itemBadge = item.to === "/pending" && pendingCount > 0;
                          return (
                            <li key={item.to}>
                              <Link
                                to={item.to}
                                onClick={() => setMoreOpen(false)}
                                className={cn(
                                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                                  active
                                    ? "bg-accent text-accent-foreground"
                                    : "text-foreground hover:bg-accent hover:text-accent-foreground",
                                )}
                              >
                                <ItemIcon className="h-4 w-4" />
                                <span className="flex-1">{t(item.labelKey)}</span>
                                {itemBadge && (
                                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-warning-foreground">
                                    {pendingCount}
                                  </span>
                                )}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </PopoverContent>
                  </Popover>
                </li>
              );
            }
            const navTab = tab as Tab;
            const active = navTab.exact ? loc.pathname === navTab.to : loc.pathname.startsWith(navTab.to);
            const showBadge = navTab.to === "/pending" && pendingCount > 0;
            if (navTab.primary) {
              return (
                <li key={navTab.to} className="flex items-center justify-center">
                  <Link
                    to={navTab.to}
                    className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background"
                    aria-label={t("nav.add_transaction")}
                  >
                    <Icon className="h-6 w-6" />
                  </Link>
                </li>
              );
            }
            return (
              <li key={navTab.to}>
                <Link
                  to={navTab.to}
                  className={cn(
                    "relative flex flex-col items-center gap-0.5 px-2 py-2.5 text-[11px] font-medium",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {t(tab.labelKey)}
                  {showBadge && (
                    <span className="absolute right-2 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-warning-foreground">
                      {pendingCount}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
