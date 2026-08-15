import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, Plus, ListOrdered, Settings as SettingsIcon, Wallet, PiggyBank, LogOut, LineChart, Inbox, MoreHorizontal, Scale, Sun, Moon, Monitor, Languages, Check, HelpCircle, Sparkles, Link2 } from "lucide-react";
import { AssistantBubble } from "@/components/AssistantBubble";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useI18n, LANGUAGES, type Lang } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchPendingTransactions, fetchSettings, processRecurringRulesIfStale } from "@/lib/finance";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { ActiveScopeChip } from "@/components/ActiveScopeChip";

type Tab = {
  to: "/" | "/transactions" | "/add" | "/envelopes" | "/insights" | "/settings" | "/pending" | "/reconcile" | "/help" | "/assistant" | "/links";
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
  { to: "/links", labelKey: "nav.links", icon: Link2 },
  { to: "/assistant", labelKey: "nav.assistant", icon: Sparkles },
  { to: "/help", labelKey: "nav.help", icon: HelpCircle },
  { to: "/settings", labelKey: "nav.settings", icon: SettingsIcon },
];

const mobileTabs: MobileTab[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, exact: true },
  { to: "/transactions", labelKey: "nav.transactions", icon: ListOrdered },
  { to: "/add", labelKey: "nav.add", icon: Plus, primary: true },
  { to: "/envelopes", labelKey: "nav.envelopes", icon: PiggyBank },
  { kind: "more", labelKey: "nav.more", icon: MoreHorizontal },
];

export function AppShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const loc = useLocation();
  const { t } = useI18n();
  const { user } = useAuth();
  const pendingCountQ = useQuery({
    queryKey: ["pending_transactions", "pending", "count"],
    queryFn: async () => (await fetchPendingTransactions("pending")).length,
    enabled: !!user,
    refetchInterval: 60_000,
  });
  const pendingCount = pendingCountQ.data ?? 0;
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateKeyboardState = () => {
      const keyboardOpen = window.innerWidth < 768 && window.innerHeight - viewport.height > 120;
      document.documentElement.toggleAttribute("data-mobile-keyboard-open", keyboardOpen);
    };

    updateKeyboardState();
    viewport.addEventListener("resize", updateKeyboardState);
    viewport.addEventListener("scroll", updateKeyboardState);
    return () => {
      viewport.removeEventListener("resize", updateKeyboardState);
      viewport.removeEventListener("scroll", updateKeyboardState);
      document.documentElement.removeAttribute("data-mobile-keyboard-open");
    };
  }, []);
  const moreActive = mobileMoreItems.some((t) =>
    t.exact ? loc.pathname === t.to : loc.pathname.startsWith(t.to),
  );
  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
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
                <ActiveScopeChip />
                <Link
                  to="/help"
                  className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                    loc.pathname.startsWith("/help") && "bg-accent text-accent-foreground",
                  )}
                  aria-label={t("nav.help")}
                  title={t("nav.help")}
                >
                  <HelpCircle className="h-4 w-4" />
                </Link>
                <AccountMenu />
              </div>
            )}
          </nav>
        </div>
      </header>

      <main
        className={cn(
          "app-main mx-auto w-full overflow-x-clip px-4 pb-28 pt-4 md:pb-10 md:pt-6",
          // Dense admin-style pages (Settings) need more horizontal room than
          // the reading-width default used everywhere else.
          wide ? "max-w-3xl xl:max-w-[1100px]" : "max-w-3xl",
        )}
      >
        {/* Mobile-visible active-scope chip (header is hidden on mobile). */}
        <div className="mb-2 flex justify-end md:hidden">
          <ActiveScopeChip compact />
        </div>
        {children}
      </main>

      <nav className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t bg-background md:hidden">
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
      {user && <AssistantBubble />}
    </div>
  );
}

function initials(email: string | undefined | null) {
  if (!email) return "?";
  const name = email.split("@")[0] ?? "";
  return name.slice(0, 2).toUpperCase() || "?";
}

function AccountMenu() {
  const { t, lang, setLang } = useI18n();
  const { user, signOut } = useAuth();
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings, enabled: !!user });
  const theme = ((settingsQ.data?.theme as string) ?? "system") as "light" | "dark" | "system";

  const setTheme = async (mode: "light" | "dark" | "system") => {
    if (!settingsQ.data) return;
    const { error } = await supabase.from("settings").update({ theme: mode }).eq("id", settingsQ.data.id);
    if (!error) qc.invalidateQueries({ queryKey: ["settings"] });
  };

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full bg-muted text-xs font-semibold text-foreground hover:bg-muted/80"
          aria-label={t("settings.account")}
        >
          {initials(user.email)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-xs text-muted-foreground">{t("settings.you")}</div>
          <div className="truncate text-sm font-medium">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings" className="cursor-pointer">
            <SettingsIcon className="h-4 w-4" />
            <span>{t("nav.settings")}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {theme === "dark" ? <Moon className="h-4 w-4" /> : theme === "light" ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
            <span>{t("settings.theme")}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              {(["system", "light", "dark"] as const).map((m) => (
                <DropdownMenuItem key={m} onClick={() => setTheme(m)}>
                  {m === "system" ? <Monitor className="h-4 w-4" /> : m === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  <span className="flex-1">{t(`settings.theme.${m}`)}</span>
                  {theme === m && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages className="h-4 w-4" />
            <span>{t("settings.language")}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              {LANGUAGES.map((l) => (
                <DropdownMenuItem key={l.code} onClick={() => setLang(l.code as Lang)}>
                  <span className="flex-1">{l.label}</span>
                  {lang === l.code && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()} className="text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4" />
          <span>{t("auth.signout")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
