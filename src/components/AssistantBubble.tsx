import * as React from "react";
import { useLocation, Link } from "@tanstack/react-router";
import { Sparkles, ExternalLink, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

// The chat (with the Markdown renderer and file pickers) is most of a chunk on
// its own and the sheet is closed on most visits, so it loads on demand.
// Hovering or focusing the button starts the download before the click.
const loadChat = () => import("@/components/AssistantChat");
const AssistantChat = React.lazy(() => loadChat().then((m) => ({ default: m.AssistantChat })));
const prefetchChat = () => void loadChat();

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
          onPointerEnter={prefetchChat}
          onFocus={prefetchChat}
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
        <React.Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          }
        >
          <AssistantChat conversationId={convId} onConversationChange={setConvId} persist={false} compact />
        </React.Suspense>
      </SheetContent>
    </Sheet>
  );
}