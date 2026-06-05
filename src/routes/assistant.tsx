import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AssistantChat } from "@/components/AssistantChat";
import { Button } from "@/components/ui/button";
import { listConversations, deleteConversation } from "@/utils/ai.functions";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assistant")({
  component: AssistantPage,
});

function AssistantPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listConversations);
  const delFn = useServerFn(deleteConversation);
  const q = useQuery({ queryKey: ["ai_conversations"], queryFn: () => listFn() });
  const [active, setActive] = React.useState<string | null>(null);

  return (
    <AppShell>
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <aside className="space-y-2">
          <Button size="sm" className="w-full" onClick={() => setActive(null)}>
            <Plus className="mr-1 h-3 w-3" />
            {t("ai.new_chat")}
          </Button>
          <ul className="space-y-1">
            {(q.data?.conversations ?? []).map((c) => (
              <li
                key={c.id}
                className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
                  active === c.id ? "bg-accent" : "hover:bg-muted",
                )}
              >
                <button className="flex-1 truncate text-left" onClick={() => setActive(c.id)}>
                  {c.title}
                </button>
                <button
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    if (!confirm(t("ai.delete_confirm"))) return;
                    try {
                      await delFn({ data: { id: c.id } });
                      if (active === c.id) setActive(null);
                      qc.invalidateQueries({ queryKey: ["ai_conversations"] });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {(q.data?.conversations ?? []).length === 0 && (
              <li className="px-2 py-2 text-xs text-muted-foreground">{t("ai.no_chats")}</li>
            )}
          </ul>
        </aside>
        <div className="rounded-lg border bg-card p-3">
          <AssistantChat
            conversationId={active}
            persist
            onConversationChange={(id) => {
              setActive(id);
              qc.invalidateQueries({ queryKey: ["ai_conversations"] });
            }}
          />
        </div>
      </div>
    </AppShell>
  );
}