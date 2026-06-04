import * as React from "react";
import { useLocation, Link } from "@tanstack/react-router";
import { Sparkles, ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AssistantChat } from "@/components/AssistantChat";
import { useI18n } from "@/i18n";

const HIDDEN_PREFIXES = ["/add", "/auth", "/privacy", "/assistant", "/edit"];

export function AssistantBubble() {
  const { t } = useI18n();
  const loc = useLocation();
  const [open, setOpen] = React.useState(false);
  const [convId, setConvId] = React.useState<string | null>(null);
  if (HIDDEN_PREFIXES.some((p) => loc.pathname.startsWith(p))) return null;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          aria-label={t("ai.bubble.label")}
          className="fixed bottom-20 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-2 ring-background hover:opacity-90 md:bottom-6"
        >
          <Sparkles className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-2 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> {t("ai.title")}</span>
            <Button asChild variant="ghost" size="sm" onClick={() => setOpen(false)}>
              <Link to="/assistant"><ExternalLink className="mr-1 h-3 w-3" />{t("ai.open_full")}</Link>
            </Button>
          </SheetTitle>
        </SheetHeader>
        <AssistantChat conversationId={convId} onConversationChange={setConvId} persist={false} compact />
      </SheetContent>
    </Sheet>
  );
}