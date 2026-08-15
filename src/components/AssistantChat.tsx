import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { SendHorizonal, Sparkles, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chat, listAIEndpoints, getConversation } from "@/utils/ai.functions";
import type { AssistantAction, ChatMessage } from "@/lib/ai/types";
import { useI18n } from "@/i18n";

type LocalMsg = { role: "user" | "assistant"; text: string; action?: AssistantAction | null };

const EXAMPLES = [
  "ai.example.add",
  "ai.example.spend",
  "ai.example.help",
  "ai.example.privacy",
];

export function AssistantChat({
  conversationId,
  onConversationChange,
  persist = false,
  compact = false,
}: {
  conversationId?: string | null;
  onConversationChange?: (id: string) => void;
  persist?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const chatFn = useServerFn(chat);
  const listFn = useServerFn(listAIEndpoints);
  const convFn = useServerFn(getConversation);

  const settingsQ = useQuery({ queryKey: ["ai_endpoints"], queryFn: () => listFn() });
  const historyQ = useQuery({
    queryKey: ["ai_conv", conversationId],
    queryFn: () => (conversationId ? convFn({ data: { id: conversationId } }) : Promise.resolve({ messages: [] as ChatMessage[] })),
    enabled: !!conversationId,
  });

  const [messages, setMessages] = React.useState<LocalMsg[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [endpointId, setEndpointId] = React.useState<string>("auto");
  const scrollerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (historyQ.data?.messages) {
      setMessages(historyQ.data.messages.map((m) => ({ role: m.role as "user" | "assistant", text: m.text, action: m.action })));
    }
  }, [historyQ.data?.messages]);

  React.useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, busy]);

  const endpoints = React.useMemo(
    () => (settingsQ.data?.endpoints ?? []).filter((e) => e.enabled),
    [settingsQ.data?.endpoints],
  );
  const enabled = endpoints.length > 0;

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    if (!enabled) {
      toast.error(t("ai.error.disabled"));
      return;
    }
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const r = await chatFn({
        data: {
          conversation_id: conversationId ?? null,
          message: text,
          persist,
          endpoint_id: endpointId === "auto" ? null : endpointId,
        },
      });
      setMessages((prev) => [...prev, { role: "assistant", text: r.message.text, action: r.message.action }]);
      if (r.endpoint?.fell_back) toast.info(t("ai.conn.fell_back", { name: r.endpoint.name }));
      if (r.conversation_id && r.conversation_id !== conversationId) onConversationChange?.(r.conversation_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => [...prev, { role: "assistant", text: `⚠️ ${msg}` }]);
    } finally {
      setBusy(false);
    }
  };

  const runAction = (action: AssistantAction) => {
    if (action.kind === "open_add") {
      navigate({ to: "/add", search: action.search as never });
    }
  };

  return (
    <div className={cn("flex flex-col", compact ? "h-[70vh]" : "h-[calc(100vh-8rem)]")}>
      {endpoints.length > 1 && (
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={endpointId} onValueChange={setEndpointId}>
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t("ai.conn.auto")}</SelectItem>
              {endpoints.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name} · {e.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto px-1 py-2">
        {messages.length === 0 && (
          <div className="space-y-3 p-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" /> {t("ai.empty.title")}
            </div>
            <p className="text-xs text-muted-foreground">{t("ai.empty.body")}</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((k) => (
                <button
                  key={k}
                  onClick={() => send(t(k))}
                  className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-foreground hover:bg-accent"
                >
                  {t(k)}
                </button>
              ))}
            </div>
            {!enabled && (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-xs">
                {t("ai.error.disabled")}
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              {m.role === "assistant" ? <Markdown>{m.text || ""}</Markdown> : <p className="whitespace-pre-wrap">{m.text}</p>}
              {m.action && (
                <div className="mt-2 flex">
                  <Button size="sm" variant="secondary" onClick={() => runAction(m.action!)}>
                    <ExternalLink className="mr-1 h-3 w-3" />
                    {m.action.label}
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> {t("ai.thinking")}
          </div>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-2 flex items-end gap-2 border-t pt-2"
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={enabled ? t("ai.input.placeholder") : t("ai.input.placeholder_disabled")}
          rows={2}
          className="resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          disabled={!enabled || busy}
        />
        <Button type="submit" size="icon" disabled={!enabled || busy || !input.trim()}>
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}