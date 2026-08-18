import * as React from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { SendHorizonal, Sparkles, Loader2, ExternalLink, Paperclip, X, FileText, Mic, Square, Plus, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chat, listAIEndpoints, getConversation, transcribeAudio } from "@/utils/ai.functions";
import { startVoiceRecording, blobToBase64, type VoiceRecorderHandle } from "@/lib/voiceRecorder";
import { extractStatement, getStatementImport } from "@/utils/statements.functions";
import { fetchAccounts } from "@/lib/finance";
import { getChatDraft, setChatDraft, resetChatDraft } from "@/lib/ai/chatDraft";
import type { AssistantAction, ChatMessage } from "@/lib/ai/types";
import { useI18n } from "@/i18n";

type LocalMsg = {
  role: "user" | "assistant";
  text: string;
  action?: AssistantAction | null;
  /** Link to a statement import result, if this message reports one. */
  importId?: string;
  /** Token usage reported by the provider for this reply. */
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; steps: number } | null;
};

const ACCEPT =
  "application/pdf,text/csv,text/plain,.csv,.tsv,image/png,image/jpeg,image/webp,image/gif";
const ACCEPT_MIME = ACCEPT.split(",").filter((x) => !x.startsWith("."));
const isSupportedFile = (f: File) =>
  ACCEPT_MIME.includes(f.type) ||
  /\.(csv|tsv)$/i.test(f.name) ||
  (f.type === "" && /\.(csv|tsv|pdf)$/i.test(f.name));

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Could not read the file"));
    fr.onload = () => {
      const res = String(fr.result || "");
      resolve(res.slice(res.indexOf(",") + 1));
    };
    fr.readAsDataURL(file);
  });
}

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
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const chatFn = useServerFn(chat);
  const listFn = useServerFn(listAIEndpoints);
  const convFn = useServerFn(getConversation);
  const extractFn = useServerFn(extractStatement);
  const importFn = useServerFn(getStatementImport);
  const transcribeFn = useServerFn(transcribeAudio);

  const settingsQ = useQuery({ queryKey: ["ai_endpoints"], queryFn: () => listFn() });
  const historyQ = useQuery({
    queryKey: ["ai_conv", conversationId],
    queryFn: () => (conversationId ? convFn({ data: { id: conversationId } }) : Promise.resolve({ messages: [] as ChatMessage[] })),
    enabled: !!conversationId,
  });

  // Non-persisted chats (sidebar) keep their draft in a module store so closing
  // the sheet does not throw away messages, input or the pending attachment.
  const draft = getChatDraft();
  const keepDraft = !persist;
  const [messages, setMessages] = React.useState<LocalMsg[]>(() =>
    keepDraft ? (draft.messages as LocalMsg[]) : [],
  );
  const [input, setInput] = React.useState(() => (keepDraft ? draft.input : ""));
  const [busy, setBusy] = React.useState(false);
  const [endpointId, setEndpointId] = React.useState<string>(() => (keepDraft ? draft.endpointId : "auto"));
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const cameraInputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(() => (keepDraft ? draft.file : null));
  const [accountId, setAccountId] = React.useState<string>(() => (keepDraft ? draft.accountId : ""));
  const [dragging, setDragging] = React.useState(false);
  const recorderRef = React.useRef<VoiceRecorderHandle | null>(null);
  const [recording, setRecording] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [transcribing, setTranscribing] = React.useState(false);

  React.useEffect(() => {
    if (!keepDraft) return;
    setChatDraft("messages", messages as never);
  }, [keepDraft, messages]);
  React.useEffect(() => {
    if (keepDraft) setChatDraft("input", input);
  }, [keepDraft, input]);
  React.useEffect(() => {
    if (keepDraft) setChatDraft("file", file);
  }, [keepDraft, file]);
  React.useEffect(() => {
    if (keepDraft) setChatDraft("endpointId", endpointId);
  }, [keepDraft, endpointId]);
  React.useEffect(() => {
    if (keepDraft) setChatDraft("accountId", accountId);
  }, [keepDraft, accountId]);

  const clearChat = React.useCallback(() => {
    setMessages([]);
    setInput("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (keepDraft) resetChatDraft();
  }, [keepDraft]);

  const isAccepted = React.useCallback(
    isSupportedFile,
    [],
  );

  const onPaste = React.useCallback(
    (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.files ?? []);
      const f = items.find(isAccepted);
      if (f) {
        e.preventDefault();
        setFile(f);
      }
    },
    [isAccepted],
  );

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, enabled: !!file });
  const accounts = React.useMemo(
    () => (accountsQ.data ?? []).filter((a) => !a.archived),
    [accountsQ.data],
  );
  React.useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

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
  const voiceAvailable = endpoints.some((e) => !!e.transcribe_model);

  const stopRecording = React.useCallback(
    async (send: boolean) => {
      const rec = recorderRef.current;
      recorderRef.current = null;
      setRecording(false);
      if (!rec) return;
      if (!send) {
        rec.cancel();
        return;
      }
      const clip = await rec.stop();
      if (clip.durationMs < 400 || clip.peak < 0.01) {
        toast.error(t("ai.voice.empty"));
        return;
      }
      setTranscribing(true);
      try {
        const audio_base64 = await blobToBase64(clip.blob);
        const r = await transcribeFn({
          data: {
            audio_base64,
            mime_type: "audio/wav",
            file_name: "recording.wav",
            language: lang,
            duration_ms: clip.durationMs,
            endpoint_id: endpointId === "auto" ? null : endpointId,
          },
        });
        setInput((prev) => (prev.trim() ? `${prev.trim()} ${r.text}` : r.text));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setTranscribing(false);
      }
    },
    [endpointId, lang, t, transcribeFn],
  );

  const startRecording = React.useCallback(async () => {
    if (recorderRef.current) return;
    try {
      recorderRef.current = await startVoiceRecording();
      setElapsed(0);
      setRecording(true);
    } catch {
      toast.error(t("ai.voice.denied"));
    }
  }, [t]);

  // Live timer + hard stop after two minutes.
  React.useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);
  React.useEffect(() => {
    if (recording && elapsed >= 120) void stopRecording(true);
  }, [recording, elapsed, stopRecording]);
  React.useEffect(() => () => recorderRef.current?.cancel(), []);

  const analyseFile = async (f: File) => {
    if (!accountId) {
      toast.error(t("statements.err.no_account"));
      return;
    }
    setMessages((prev) => [...prev, { role: "user", text: `📎 ${f.name}` }]);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setBusy(true);
    try {
      const base64 = await readFileAsBase64(f);
      const { import_id } = await extractFn({
        data: {
          account_id: accountId,
          file_name: f.name,
          file_base64: base64,
          file_type: f.type || null,
          endpoint_id: endpointId === "auto" ? null : endpointId,
        },
      });
      const detail = await importFn({ data: { id: import_id } });
      const lines = detail.lines;
      const count = (s: string) => lines.filter((l) => l.match_status === s).length;
      const text = t("ai.attach.result", {
        total: String(lines.length),
        matched: String(count("exact") + count("resolved")),
        probable: String(count("probable")),
        missing: String(count("unmatched")),
        extra: String(detail.unmatched_app.length),
      });
      setMessages((prev) => [...prev, { role: "assistant", text, importId: import_id }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => [...prev, { role: "assistant", text: `⚠️ ${msg}` }]);
    } finally {
      setBusy(false);
    }
  };

  const send = async (text: string) => {
    if (file) {
      const f = file;
      void analyseFile(f);
      return;
    }
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
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: r.message.text, action: r.message.action, usage: (r.message as any).usage ?? null },
      ]);
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
    <div
      className={cn("relative flex flex-col", compact ? "h-[70vh]" : "h-[calc(100vh-8rem)]")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onPaste={onPaste}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) setFile(f);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5 text-sm font-medium">
          {t("ai.attach.drop")}
        </div>
      )}
      <div className="mb-2 flex items-center gap-2">
        {endpoints.length > 1 && (
          <>
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
          </>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-8 text-xs"
          disabled={busy || (messages.length === 0 && !input && !file)}
          onClick={clearChat}
        >
          <Plus className="mr-1 h-3 w-3" />
          {t("ai.new_chat")}
        </Button>
      </div>
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
              {m.importId && (
                <div className="mt-2 flex">
                  <Button size="sm" variant="secondary" asChild>
                    <Link to="/statements" search={{ import: m.importId } as never}>
                      <ExternalLink className="mr-1 h-3 w-3" />
                      {t("ai.attach.open")}
                    </Link>
                  </Button>
                </div>
              )}
              {m.role === "assistant" && m.usage && (
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  {t("ai.usage.tokens", {
                    total: String(m.usage.total_tokens),
                    prompt: String(m.usage.prompt_tokens),
                    completion: String(m.usage.completion_tokens),
                  })}
                  {m.usage.steps > 1 ? ` · ${t("ai.usage.steps", { n: String(m.usage.steps) })}` : ""}
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
      {file && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-xs">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="max-w-[40%] truncate font-medium">{file.name}</span>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="h-7 w-[180px] text-xs">
              <SelectValue placeholder={t("statements.field.account")} />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-7" disabled={busy || !accountId} onClick={() => void analyseFile(file)}>
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            {t("ai.attach.analyse")}
          </Button>
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => {
              setFile(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-2 flex items-end gap-2 border-t pt-2"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={busy}
          title={t("ai.attach.title")}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={busy}
          title={t("ai.attach.camera")}
          aria-label={t("ai.attach.camera")}
          onClick={() => cameraInputRef.current?.click()}
        >
          <Camera className="h-4 w-4" />
        </Button>
        {voiceAvailable && (
          <Button
            type="button"
            size="icon"
            variant={recording ? "destructive" : "ghost"}
            disabled={busy || transcribing}
            title={recording ? t("ai.voice.stop") : t("ai.voice.start")}
            aria-label={recording ? t("ai.voice.stop") : t("ai.voice.start")}
            onClick={() => (recording ? void stopRecording(true) : void startRecording())}
          >
            {transcribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : recording ? (
              <Square className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
        )}
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            recording
              ? t("ai.voice.recording", { time: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}` })
              : transcribing
                ? t("ai.voice.transcribing")
                : enabled
                  ? t("ai.input.placeholder")
                  : t("ai.input.placeholder_disabled")
          }
          rows={2}
          className="resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          disabled={!enabled || busy || recording || transcribing}
        />
        <Button type="submit" size="icon" disabled={!enabled || busy || !input.trim()}>
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}