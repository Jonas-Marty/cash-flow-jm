import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import type { Provider } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { authReturnUrl, oauthErrorFromUrl, withoutOAuthError } from "@/lib/authProviders";
import { listSignInProviders } from "@/utils/oidc.functions";

export function AuthPage() {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<"signin" | "signup">("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [gdprAccepted, setGdprAccepted] = React.useState(false);
  const [oauthError, setOauthError] = React.useState<string | null>(null);

  // Only providers that are enabled in Settings AND configured in the auth
  // service, so the page never offers a button that ends on an error.
  const providersQ = useQuery({
    queryKey: ["sign_in_providers"],
    queryFn: () => listSignInProviders(),
  });

  // A failed provider sign-in lands back here with the reason in the URL.
  // Say it once, then drop it from the address bar.
  React.useEffect(() => {
    const failed = oauthErrorFromUrl(window.location.href);
    if (!failed) return;
    setOauthError(failed.description);
    window.history.replaceState(null, "", withoutOAuthError(window.location.href));
  }, []);

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
  };

  const onSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gdprAccepted) {
      toast.error(t("auth.gdpr.required"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: authReturnUrl(window.location.origin) },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("auth.check_email"));
  };

  const onOAuth = async (provider: Provider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: authReturnUrl(window.location.origin) },
    });
    if (error) toast.error(error.message);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            <span>{t("app.name")}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {oauthError && (
            <div role="alert" className="mb-3 rounded-md border border-destructive/60 bg-destructive/10 p-3 text-sm">
              <div className="font-medium">{t("auth.provider_failed")}</div>
              <div className="break-words text-muted-foreground">{oauthError}</div>
            </div>
          )}
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">{t("auth.signin")}</TabsTrigger>
              <TabsTrigger value="signup">{t("auth.signup")}</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={onSignIn} className="space-y-3 pt-3">
                <div className="space-y-1">
                  <Label htmlFor="email-in">{t("auth.email")}</Label>
                  <Input id="email-in" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pw-in">{t("auth.password")}</Label>
                  <Input id="pw-in" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "…" : t("auth.signin")}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={onSignUp} className="space-y-3 pt-3">
                <div className="space-y-1">
                  <Label htmlFor="email-up">{t("auth.email")}</Label>
                  <Input id="email-up" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pw-up">{t("auth.password")}</Label>
                  <Input id="pw-up" type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3">
                  <Checkbox
                    id="gdpr"
                    checked={gdprAccepted}
                    onCheckedChange={(v) => setGdprAccepted(v === true)}
                    className="mt-0.5"
                  />
                  <Label htmlFor="gdpr" className="cursor-pointer text-xs font-normal leading-snug">
                    {t("auth.gdpr.accept_prefix")}{" "}
                    <Link to="/privacy" target="_blank" className="text-primary underline">
                      {t("auth.gdpr.policy_link")}
                    </Link>{" "}
                    {t("auth.gdpr.accept_suffix")}
                  </Label>
                </div>
                <Button type="submit" className="w-full" disabled={busy || !gdprAccepted}>
                  {busy ? "…" : t("auth.signup")}
                </Button>
                <p className="text-xs text-muted-foreground">{t("auth.signup_hint")}</p>
              </form>
            </TabsContent>
          </Tabs>

          {!!(providersQ.data?.length) && (
            <div className="mt-4 space-y-2">
              <div className="text-center text-xs uppercase text-muted-foreground">{t("auth.or")}</div>
              {providersQ.data.map((p) => (
                <Button
                  key={p.provider}
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => onOAuth(p.supabaseProvider)}
                >
                  {t("auth.continue_with", { p: p.label })}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
