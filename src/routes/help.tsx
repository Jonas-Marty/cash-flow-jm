import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { helpUrl, helpUrlFromLegacyHash } from "@/lib/helpUrl";

/**
 * The guide moved out of the app to help.cash-flow.wi-wo.ch, where it is a
 * static Blume site built from help-site/ and readable without signing in.
 *
 * This route stays behind only to honour links taken while the guide lived
 * here — `/help#oidc` and friends, which are in the wild in screenshots and
 * bookmarks. Each old section id is now a page, so the fragment maps straight
 * onto a path.
 */
export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [{ title: "Help & Guide — Cashflow" }, { name: "robots", content: "noindex" }],
  }),
  component: HelpRedirect,
});

function HelpRedirect() {
  const { lang, t } = useI18n();

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    // replace(), not assign(): the redirect should not sit in the history
    // stack, or Back from the guide bounces straight forward again.
    window.location.replace(helpUrlFromLegacyHash(lang, window.location.hash));
  }, [lang]);

  const target = helpUrl(lang);
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      <p>{t("help.redirecting")}</p>
      <a href={target} className="text-primary underline underline-offset-2">
        {target}
      </a>
    </div>
  );
}
