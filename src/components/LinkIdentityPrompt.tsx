import * as React from "react";
import { toast } from "sonner";
import { Link2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { toSupabaseProvider, providerLabel } from "@/lib/authProviders";
import { startLinkIdentity, useEnabledProviders, useUserIdentities } from "@/components/LinkedAccountsCard";

const SESSION_KEY = "link-prompt-dismissed";
const NEVER_KEY = "link-prompt-never";

/**
 * After sign-in, offer to link the sign-in methods the user has not connected
 * yet, so one person keeps one account instead of accumulating duplicates.
 */
export function LinkIdentityPrompt() {
  const { t } = useI18n();
  const { user } = useAuth();
  const identitiesQ = useUserIdentities();
  const providersQ = useEnabledProviders();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const identities = identitiesQ.data;
  const providers = providersQ.data;

  const missing = React.useMemo(() => {
    if (!identities || !providers) return [];
    const linked = new Set(identities.map((i) => i.provider));
    return providers.filter((p) => {
      const mapped = toSupabaseProvider(p.provider);
      return !!mapped && !linked.has(mapped);
    });
  }, [identities, providers]);

  React.useEffect(() => {
    if (!user || missing.length === 0) return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(`${NEVER_KEY}:${user.id}`)) return;
    if (window.sessionStorage.getItem(`${SESSION_KEY}:${user.id}`)) return;
    setOpen(true);
  }, [user, missing.length]);

  const dismiss = (never: boolean) => {
    if (user && typeof window !== "undefined") {
      window.sessionStorage.setItem(`${SESSION_KEY}:${user.id}`, "1");
      if (never) window.localStorage.setItem(`${NEVER_KEY}:${user.id}`, "1");
    }
    setOpen(false);
  };

  const link = async (provider: string) => {
    setBusy(provider);
    const { error } = await startLinkIdentity(provider);
    setBusy(null);
    if (error === "unsupported") {
      toast.error(t("linked.unsupported"));
      return;
    }
    if (error && /manual.linking.is.disabled/i.test(error)) {
      toast.error(t("linked.manual_disabled"));
      return;
    }
    if (error) {
      toast.error(`${t("linked.link_failed")}: ${error}`);
      return;
    }
    dismiss(false);
  };

  if (!user || missing.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(false); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("linked.prompt.title")}</DialogTitle>
          <DialogDescription>
            {t("linked.prompt.body", { email: user.email ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {missing.map((p) => (
            <Button
              key={p.provider}
              variant="outline"
              disabled={busy === p.provider}
              onClick={() => link(p.provider)}
            >
              <Link2 className="h-4 w-4" />{" "}
              {t("linked.link_with", { p: providerLabel(p.provider, p.display_name) })}
            </Button>
          ))}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => dismiss(true)}>
            {t("linked.prompt.never")}
          </Button>
          <Button variant="secondary" onClick={() => dismiss(false)}>
            {t("linked.prompt.later")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
