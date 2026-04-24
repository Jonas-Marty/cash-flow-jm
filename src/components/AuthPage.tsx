import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Wallet } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";

export function AuthPage() {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<"signin" | "signup">("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Show enabled OAuth providers (admins haven't enabled any by default)
  const providersQ = useQuery({
    queryKey: ["auth_providers_enabled"],
    queryFn: async () => {
      const { data } = await supabase
        .from("auth_providers")
        .select("provider, display_name, enabled")
        .eq("enabled", true);
      return data ?? [];
    },
  });

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
  };

  const onSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("auth.check_email"));
  };

  const onOAuth = async (provider: "google") => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
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
                <Button type="submit" className="w-full" disabled={busy}>
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
                  onClick={() => p.provider === "google" && onOAuth("google")}
                  disabled={p.provider !== "google"}
                  title={p.provider !== "google" ? t("auth.provider_not_wired") : undefined}
                >
                  {t("auth.continue_with", { p: p.display_name ?? p.provider })}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
