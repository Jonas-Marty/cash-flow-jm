import * as React from "react";
import { Link, Outlet, createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider, type Lang } from "@/i18n";
import { fetchSettings } from "@/lib/finance";
import { supabase } from "@/integrations/supabase/client";

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
      <I18nGate>
        <Outlet />
        <Toaster />
      </I18nGate>
    </QueryClientProvider>
  );
}

function I18nGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const lang = ((settingsQ.data?.language as Lang | undefined) ?? "de") as Lang;
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
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});
