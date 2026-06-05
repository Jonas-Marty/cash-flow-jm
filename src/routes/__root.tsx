import * as React from "react";
import { Link, Outlet, createRootRouteWithContext, HeadContent, Scripts, useLocation } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider, type Lang } from "@/i18n";
import { fetchSettings } from "@/lib/finance";
import { supabase } from "@/integrations/supabase/client";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AuthPage } from "@/components/AuthPage";
import { ThemeApplier, type ThemeMode } from "@/lib/theme";

import appCss from "../styles.css?url";

interface RouterContext {
  queryClient: QueryClient;
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate>
          <I18nGate>
            <Outlet />
          </I18nGate>
        </AuthGate>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const loc = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        …
      </div>
    );
  }
  if (!session) {
    // Allow the privacy/GDPR page without a session, so the sign-up GDPR link works.
    if (loc.pathname.startsWith("/privacy")) {
      return (
        <I18nProvider lang="de" setLang={async () => {}}>
          <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
        </I18nProvider>
      );
    }
    // AuthPage uses useI18n, so wrap it in a minimal i18n provider with no settings fetch.
    return (
      <I18nProvider lang="de" setLang={async () => {}}>
        <AuthPage />
      </I18nProvider>
    );
  }
  return <>{children}</>;
}

function I18nGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const lang = ((settingsQ.data?.language as Lang | undefined) ?? "de") as Lang;
  const theme = ((settingsQ.data?.theme as ThemeMode | undefined) ?? "system") as ThemeMode;
  const setLang = React.useCallback(
    async (l: Lang) => {
      if (!settingsQ.data) return;
      const { error } = await supabase
        .from("settings")
        .update({ language: l })
        .eq("id", settingsQ.data.id);
      if (error) return;
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    [qc, settingsQ.data],
  );
  return (
    <I18nProvider lang={lang} setLang={setLang}>
      <ThemeApplier mode={theme} />
      {children}
    </I18nProvider>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Cashflow — Personal Finance" },
      { name: "description", content: "Track daily cash flow, envelope budgets, and credit-card liabilities." },
      { property: "og:title", content: "Cashflow — Personal Finance" },
      { name: "twitter:title", content: "Cashflow — Personal Finance" },
      { property: "og:description", content: "Track daily cash flow, envelope budgets, and credit-card liabilities." },
      { name: "twitter:description", content: "Track daily cash flow, envelope budgets, and credit-card liabilities." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/82b6ea51-4032-4d11-8a80-af7194ddb3a5/id-preview-0f7cdb6f--dc583b35-4198-44ed-820e-de70acfe1c58.lovable.app-1777208399385.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/82b6ea51-4032-4d11-8a80-af7194ddb3a5/id-preview-0f7cdb6f--dc583b35-4198-44ed-820e-de70acfe1c58.lovable.app-1777208399385.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});
