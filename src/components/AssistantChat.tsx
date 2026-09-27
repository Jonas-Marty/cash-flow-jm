import * as React from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { SendHorizonal, Sparkles, Loader2, ExternalLink, Paperclip, X, FileText, Mic, Square, Plus, Camera, Cloud, Image as ImageIcon, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chat, listAIEndpoints, getConversation, transcribeAudio, getAttachmentUrl } from "@/utils/ai.functions";
import { startVoiceRecording, blobToBase64, type VoiceRecorderHandle } from "@/lib/voiceRecorder";
import { getNextcloudStatus, downloadNextcloudFile } from "@/utils/nextcloud.functions";
import { NextcloudFilePicker, type PickedFile } from "@/components/NextcloudFilePicker";
import { getChatDraft, setChatDraft, resetChatDraft } from "@/lib/ai/chatDraft";
import type { AssistantAction, ChatAttachmentRef, ChatMessage, ChatNotice, AIEndpoint, AIEndpointOfflinePayload } from "@/lib/ai/types";
import { setPendingRuleDraft } from "@/lib/ai/recurringHandoff";
import { parseEndpointOffline } from "@/lib/ai/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useI18n } from "@/i18n";

type LocalMsg = {
  role: "user" | "assistant";
  text: string;
  action?: AssistantAction | null;
  /** Link to a statement import result (messages from before attachments became context). */
  importId?: string;
  /** Files the user attached to this message (ids once the server stored them). */
  attachments?: (ChatAttachmentRef | { id?: undefined; file_name: string; mime: string })[];
  notices?: ChatNotice[];
  /** Token usage reported by the provider for this reply. */
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; steps: number } | null;
};

const ACCEPT =
  "application/pdf,text/csv,text/plain,.csv,.tsv,.txt,image/png,image/jpeg,image/webp,image/gif";
const MAX_FILES = 3;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ACCEPT_MIME = ACCEPT.split(",").filter((x) => !x.startsWith("."));
const isSupportedFile = (f: File) =>
  ACCEPT_MIME.includes(f.type) ||
  /\.(csv|tsv)$/i.test(f.name) ||
  (f.type === "" && /\.(csv|tsv|pdf|txt)$/i.test(f.name));

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

/** The model a connection uses for chat: the action binding's model, else its default. */
function chatModel(e: AIEndpoint, bindingModel: string | null, bound: boolean): string {
  return bound && bindingModel ? bindingModel : e.model;
}

const EXAMPLES = [
  "ai.example.add",
  "ai.example.rule",
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
  const attachmentUrlFn = useServerFn(getAttachmentUrl);
  const transcribeFn = useServerFn(transcribeAudio);
  const ncStatusFn = useServerFn(getNextcloudStatus);
  const ncDownloadFn = useServerFn(downloadNextcloudFile);
  const ncStatusQ = useQuery({ queryKey: ["nextcloud_status"], queryFn: () => ncStatusFn() });
  const nextcloudReady = !!ncStatusQ.data?.connected;
  const [ncOpen, setNcOpen] = React.useState(false);
  const [ncLoading, setNcLoading] = React.useState(false);

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
  const [files, setFiles] = React.useState<File[]>(() => (keepDraft ? draft.files : []));
  const [dragging, setDragging] = React.useState(false);
  const recorderRef = React.useRef<VoiceRecorderHandle | null>(null);
  const [recording, setRecording] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [transcribing, setTranscribing] = React.useState(false);
  const [offline, setOffline] = React.useState<{
    payload: AIEndpointOfflinePayload;
    retry: (id: string) => void;
  } | null>(null);
  const [retryId, setRetryId] = React.useState<string>("");

  React.useEffect(() => {
    if (!offline) return;
    const first = offline.payload.alternatives.find((a) => a.available) ?? offline.payload.alternatives[0];
    setRetryId(first?.id ?? "");
  }, [offline]);


  const pickFromNextcloud = React.useCallback(
    async (picked: PickedFile) => {
      setNcLoading(true);
      try {
        const r = await ncDownloadFn({ data: { path: picked.path } });
        const bin = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
        const type = (r.mime ?? "").split(";")[0] || "";
        addFiles([new File([bin], r.name, { type })]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setNcLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ncDownloadFn],
  );

  React.useEffect(() => {
    if (!keepDraft) return;
    setChatDraft("messages", messages as never);
  }, [keepDraft, messages]);
  React.useEffect(() => {
    if (keepDraft) setChatDraft("input", input);
  }, [keepDraft, input]);
  React.useEffect(() => {
    if (keepDraft) setChatDraft("files", files);
  }, [keepDraft, files]);
  React.useEffect(() => {
    if (keepDraft) setChatDraft("endpointId", endpointId);
  }, [keepDraft, endpointId]);

  const clearChat = React.useCallback(() => {
    setMessages([]);
    setInput("");
    setFiles([]);
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
      const items = Array.from(e.clipboardData?.files ?? []).filter(isAccepted);
      if (items.length) {
        e.preventDefault();
        addFiles(items);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAccepted],
  );

  React.useEffect(() => {
    if (historyQ.data?.messages) {
      setMessages(
        historyQ.data.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          text: m.text,
          action: m.action,
          attachments: m.attachments,
          notices: m.notices,
        })),
      );
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

  // What the connection that will answer can do. With "auto", attachments are
  // only blocked when no enabled connection is known to handle tools.
  const chatBinding = settingsQ.data?.bindings.find((b) => b.action === "chat");
  const capsOf = (e: AIEndpoint) =>
    e.capabilities?.[chatModel(e, chatBinding?.model ?? null, chatBinding?.endpoint_id === e.id)];
  const candidates = endpointId === "auto" ? endpoints : endpoints.filter((e) => e.id === endpointId);
  const toolsBlocked = candidates.length > 0 && candidates.every((e) => capsOf(e)?.tools === false);
  const visionBlocked = candidates.length > 0 && candidates.every((e) => capsOf(e)?.vision === false);

  const addFiles = (incoming: File[]) => {
    const ok: File[] = [];
    for (const f of incoming) {
      if (!isSupportedFile(f)) {
        toast.error(t("ai.attach.unsupported", { name: f.name }));
      } else if (f.size > MAX_FILE_BYTES) {
        toast.error(t("ai.attach.too_big", { name: f.name }));
      } else if (visionBlocked && f.type.startsWith("image/")) {
        toast.error(t("ai.attach.no_vision"));
      } else {
        ok.push(f);
      }
    }
    if (ok.length === 0) return;
    setFiles((prev) => {
      const next = [...prev, ...ok];
      if (next.length > MAX_FILES) toast.info(t("ai.attach.max", { n: String(MAX_FILES) }));
      return next.slice(0, MAX_FILES);
    });
  };

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

  const send = async (text: string, overrideEndpointId?: string, filesOverride?: File[]) => {
    const toSend = filesOverride ?? files;
    if ((!text.trim() && toSend.length === 0) || busy) return;
    if (!enabled) {
      toast.error(t("ai.error.disabled"));
      return;
    }
    // Earlier turns go along for the sidebar chat, which the server does not store.
    const history = persist
      ? undefined
      : messages
          .filter((m) => m.text || m.attachments?.length)
          .slice(-30)
          .map((m) => ({
            role: m.role,
            text: m.text.slice(0, 20_000),
            attachment_ids: (m.attachments ?? []).map((a) => a.id).filter((id): id is string => !!id),
          }));
    setMessages((prev) => [
      ...prev,
      { role: "user", text, attachments: toSend.map((f) => ({ file_name: f.name, mime: f.type })) },
    ]);
    setInput("");
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setBusy(true);
    try {
      const attachments = await Promise.all(
        toSend.map(async (f) => ({ file_name: f.name, file_type: f.type || null, file_base64: await readFileAsBase64(f) })),
      );
      const r = await chatFn({
        data: {
          conversation_id: conversationId ?? null,
          message: text,
          persist,
          endpoint_id: overrideEndpointId ?? (endpointId === "auto" ? null : endpointId),
          ...(attachments.length ? { attachments } : {}),
          ...(history ? { history } : {}),
        },
      });
      setMessages((prev) => {
        const next = [...prev];
        // Swap the local file names for the stored attachments (with ids).
        const lastUser = next.length - 1;
        if (next[lastUser]?.role === "user" && r.attachments.length) {
          next[lastUser] = { ...next[lastUser], attachments: r.attachments };
        }
        next.push({
          role: "assistant",
          text: r.message.text,
          action: r.message.action,
          usage: r.message.usage ?? null,
          notices: r.message.notices,
        });
        return next;
      });
      if (r.endpoint?.fell_back) toast.info(t("ai.conn.fell_back", { name: r.endpoint.name }));
      if (r.conversation_id && r.conversation_id !== conversationId) onConversationChange?.(r.conversation_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const offline = parseEndpointOffline(msg);
      // Drop the echoed user message and give the input and files back.
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
      setFiles(toSend);
      if (offline) {
        setOffline({ payload: offline, retry: (id) => void send(text, id, toSend) });
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const openAttachment = async (id: string) => {
    try {
      const { url } = await attachmentUrlFn({ data: { id } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const runAction = (action: AssistantAction, searchOverride?: Record<string, string>) => {
    if (action.kind === "open_add") {
      navigate({ to: "/add", search: (searchOverride ?? action.search) as never });
    } else if (action.kind === "open_recurring") {
      setPendingRuleDraft({
        draft: action.draft,
        warnings: action.warnings ?? [],
        notes: action.notes ?? [],
        similar_rule: action.similar_rule ?? null,
        source_file: action.source_file ?? null,
      });
      navigate({ to: "/settings", hash: "recurring" });
    } else if (action.kind === "open_statement") {
      navigate({ to: "/statements", search: { import: action.import_id } as never });
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
        const dropped = Array.from(e.dataTransfer.files ?? []);
        if (dropped.length && !toolsBlocked) addFiles(dropped);
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
          disabled={busy || (messages.length === 0 && !input && files.length === 0)}
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
              {m.attachments && m.attachments.length > 0 && (
                <div className={cn("flex flex-wrap gap-1.5", m.text && "mb-1.5")}>
                  {m.attachments.map((a, j) => (
                    <button
                      key={a.id ?? j}
                      type="button"
                      disabled={!a.id}
                      onClick={() => a.id && void openAttachment(a.id)}
                      className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary-foreground/15 px-2 py-0.5 text-xs hover:bg-primary-foreground/25 disabled:cursor-default"
                      title={a.file_name}
                    >
                      {a.mime.startsWith("image/") ? <ImageIcon className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
                      <span className="truncate">{a.file_name}</span>
                    </button>
                  ))}
                </div>
              )}
              {m.role === "assistant" ? <Markdown>{m.text || ""}</Markdown> : m.text ? <p className="whitespace-pre-wrap">{m.text}</p> : null}
              {m.action?.kind === "open_add" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => runAction(m.action!)}>
                    <ExternalLink className="mr-1 h-3 w-3" />
                    {m.action.alternate && m.action.proposed_category_name
                      ? t("ai.action.use_proposed", { name: m.action.proposed_category_name })
                      : m.action.label}
                  </Button>
                  {m.action.alternate && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => m.action?.kind === "open_add" && runAction(m.action, m.action.alternate!.search)}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      {m.action.active_scope_name
                        ? t("ai.action.use_scope", { name: m.action.active_scope_name })
                        : m.action.alternate.label}
                    </Button>
                  )}
                </div>
              )}
              {(m.action?.kind === "open_recurring" || m.action?.kind === "open_statement") && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => runAction(m.action!)}>
                    <ExternalLink className="mr-1 h-3 w-3" />
                    {m.action.kind === "open_recurring" ? t("ai.action.open_rule") : t("ai.attach.open")}
                  </Button>
                </div>
              )}
              {m.role === "assistant" && m.notices && m.notices.length > 0 && (
                <div className="mt-1.5 flex items-start gap-1 text-[11px] text-muted-foreground">
                  <Info className="mt-px h-3 w-3 shrink-0" />
                  <span>{m.notices.map((n) => t(`ai.notice.${n}`)).join(" ")}</span>
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
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-xs">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex max-w-[45%] items-center gap-1 rounded bg-background px-2 py-0.5">
              {f.type.startsWith("image/") ? (
                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate font-medium">{f.name}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                aria-label={t("common.remove")}
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <span className="text-muted-foreground">{t("ai.attach.staged_hint")}</span>
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
          multiple
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={busy || toolsBlocked || files.length >= MAX_FILES}
          title={toolsBlocked ? t("ai.attach.no_tools") : t("ai.attach.title")}
          aria-label={t("ai.attach.title")}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={busy || toolsBlocked || visionBlocked || files.length >= MAX_FILES}
          title={toolsBlocked ? t("ai.attach.no_tools") : visionBlocked ? t("ai.attach.no_vision") : t("ai.attach.camera")}
          aria-label={t("ai.attach.camera")}
          onClick={() => cameraInputRef.current?.click()}
        >
          <Camera className="h-4 w-4" />
        </Button>
        {nextcloudReady && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={busy || ncLoading || toolsBlocked || files.length >= MAX_FILES}
            title={toolsBlocked ? t("ai.attach.no_tools") : t("ai.attach.nextcloud")}
            aria-label={t("ai.attach.nextcloud")}
            onClick={() => setNcOpen(true)}
          >
            {ncLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
          </Button>
        )}
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
        <Button type="submit" size="icon" disabled={!enabled || busy || (!input.trim() && files.length === 0)}>
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </form>
      {nextcloudReady && (
        <NextcloudFilePicker
          open={ncOpen}
          onOpenChange={setNcOpen}
          onPick={(f) => void pickFromNextcloud(f)}
          kind="statement"
        />
      )}
      <Dialog open={!!offline} onOpenChange={(o) => !o && setOffline(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("ai.conn.offline_title")}</DialogTitle>
            <DialogDescription>
              {t("ai.conn.offline_body", { name: offline?.payload.endpoint.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          {offline?.payload.error && (
            <p className="text-xs text-muted-foreground break-words">{offline.payload.error}</p>
          )}
          <Select value={retryId} onValueChange={setRetryId}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder={t("ai.conn.offline_pick")} />
            </SelectTrigger>
            <SelectContent>
              {(offline?.payload.alternatives ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id} disabled={!a.available}>
                  {a.name} · {a.model} {a.available ? "" : `· ${t("ai.conn.offline")}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOffline(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!retryId || !(offline?.payload.alternatives.find((a) => a.id === retryId)?.available ?? false)}
              onClick={() => {
                const target = offline;
                const id = retryId;
                setOffline(null);
                setEndpointId(id);
                target?.retry(id);
              }}
            >
              {t("ai.conn.offline_retry")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

  );
}