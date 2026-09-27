import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Cloud, FileText, Loader2, Sparkles, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NextcloudFilePicker, type PickedFile } from "@/components/NextcloudFilePicker";
import { analyseRuleDocument, analyseRuleDocumentFromNextcloud } from "@/utils/recurringAi.functions";
import { getNextcloudStatus } from "@/utils/nextcloud.functions";
import type { RuleHandoff } from "@/lib/ai/recurringHandoff";
import { parseEndpointOffline } from "@/lib/ai/types";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const ACCEPT = "application/pdf,text/plain,.txt,image/png,image/jpeg,image/webp,image/gif,.heic";

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

type Source = { kind: "file"; file: File } | { kind: "nextcloud"; picked: PickedFile };

/**
 * ✨ Create a recurring rule from an invoice. Reads the document with the
 * AI connection bound to "recurring_extract" and hands the proposal to the
 * normal rule editor via `onDraft`; nothing is saved here.
 */
export function RecurringAiDialog({
  open,
  onOpenChange,
  onDraft,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDraft: (h: RuleHandoff) => void;
}) {
  const { t } = useI18n();
  const analyseFn = useServerFn(analyseRuleDocument);
  const analyseNcFn = useServerFn(analyseRuleDocumentFromNextcloud);
  const ncStatusFn = useServerFn(getNextcloudStatus);
  const ncStatusQ = useQuery({ queryKey: ["nextcloud_status"], queryFn: () => ncStatusFn(), enabled: open });
  const [source, setSource] = React.useState<Source | null>(null);
  const [hint, setHint] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [ncOpen, setNcOpen] = React.useState(false);
  const [notInvoice, setNotInvoice] = React.useState<{ kind: "statement" | "other"; notes: string[] } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) {
      setSource(null);
      setHint("");
      setNotInvoice(null);
      setBusy(false);
    }
  }, [open]);

  const sourceName = source ? (source.kind === "file" ? source.file.name : source.picked.name) : "";

  const analyse = async (endpointId?: string) => {
    if (!source) return;
    setBusy(true);
    setNotInvoice(null);
    try {
      const common = { hint: hint.trim() || null, endpoint_id: endpointId ?? null };
      const r =
        source.kind === "file"
          ? await analyseFn({
              data: {
                file_name: source.file.name,
                file_type: source.file.type || null,
                file_base64: await readFileAsBase64(source.file),
                ...common,
              },
            })
          : await analyseNcFn({ data: { path: source.picked.path, ...common } });
      if (r.endpoint.fell_back) toast.info(t("ai.conn.fell_back", { name: r.endpoint.name }));
      if (r.document_kind !== "invoice" || !r.draft) {
        setNotInvoice({ kind: r.document_kind === "statement" ? "statement" : "other", notes: r.notes });
        return;
      }
      onDraft({
        draft: r.draft,
        warnings: r.warnings,
        notes: r.notes,
        similar_rule: r.similar_rule,
        source_file: sourceName,
      });
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const offline = parseEndpointOffline(msg);
      toast.error(offline ? t("ai.conn.offline_body", { name: offline.endpoint.name }) : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> {t("recurring.ai.title")}
          </DialogTitle>
          <DialogDescription>{t("recurring.ai.body")}</DialogDescription>
        </DialogHeader>

        {source ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm">
            {source.kind === "nextcloud" ? <Cloud className="h-4 w-4 shrink-0" /> : <FileText className="h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1 truncate font-medium">{sourceName}</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() => {
                setSource(null);
                setNotInvoice(null);
              }}
              aria-label={t("common.remove")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col items-center gap-2 rounded-md border-2 border-dashed p-6 text-center text-sm text-muted-foreground",
              dragging && "border-primary bg-primary/5",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) setSource({ kind: "file", file: f });
            }}
          >
            <Upload className="h-5 w-5" />
            <span>{t("recurring.ai.drop")}</span>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
                {t("recurring.ai.choose")}
              </Button>
              {ncStatusQ.data?.connected && (
                <Button type="button" size="sm" variant="outline" onClick={() => setNcOpen(true)}>
                  <Cloud className="mr-1 h-3.5 w-3.5" /> Nextcloud
                </Button>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setSource({ kind: "file", file: f });
                e.target.value = "";
              }}
            />
          </div>
        )}

        <div>
          <Label className="text-xs">{t("recurring.ai.hint")}</Label>
          <Input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder={t("recurring.ai.hint_placeholder")}
            maxLength={500}
            disabled={busy}
          />
        </div>

        {notInvoice && (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-xs">
            {notInvoice.kind === "statement" ? (
              <>
                {t("recurring.ai.is_statement")}{" "}
                <Link to="/statements" className="underline">
                  {t("recurring.ai.to_statements")}
                </Link>
              </>
            ) : (
              t("recurring.ai.not_invoice")
            )}
            {notInvoice.notes.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {notInvoice.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void analyse()} disabled={!source || busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
            {busy ? t("recurring.ai.reading") : t("recurring.ai.analyse")}
          </Button>
        </DialogFooter>
      </DialogContent>
      {ncStatusQ.data?.connected && (
        <NextcloudFilePicker
          open={ncOpen}
          onOpenChange={setNcOpen}
          onPick={(p) => setSource({ kind: "nextcloud", picked: p })}
          kind="receipt"
        />
      )}
    </Dialog>
  );
}
