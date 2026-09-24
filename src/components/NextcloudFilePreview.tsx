import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadNextcloudFile } from "@/utils/nextcloud.functions";
import { previewKind, type NcEntry } from "@/lib/nextcloudDav";
import { useI18n } from "@/i18n";

// Long statements would render dozens of canvases for a glance; the rest is
// one click away in Nextcloud's own viewer.
const MAX_PDF_PAGES = 10;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Draws a PDF's pages into canvases, fitted to the panel width. pdf.js comes
 * from unpdf (already used server-side for statement text) and is imported
 * only when a PDF is previewed, so it never weighs on the normal bundle. A
 * canvas renders the same on every device, unlike an <iframe>, which Chrome on
 * Android does not render PDFs in at all.
 */
function PdfPages({ bytes }: { bytes: Uint8Array }) {
  const { t } = useI18n();
  // Read through a ref so a new `t` identity does not re-render every page.
  const tRef = React.useRef(t);
  tRef.current = t;
  const hostRef = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<{ shown: number; total: number } | "error" | null>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    host.replaceChildren();
    setState(null);
    (async () => {
      const { getDocumentProxy } = await import("unpdf");
      // pdf.js may detach the buffer it is given; keep the cached bytes intact.
      const pdf = await getDocumentProxy(bytes.slice());
      const shown = Math.min(pdf.numPages, MAX_PDF_PAGES);
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(host.clientWidth, 280);
      for (let n = 1; n <= shown && !cancelled; n++) {
        const page = await pdf.getPage(n);
        const scale = (width * dpr) / page.getViewport({ scale: 1 }).width;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.className = "w-full rounded border bg-white shadow-sm";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", tRef.current("attachments.preview.page", { n: String(n) }));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no canvas");
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (cancelled) return;
        host.appendChild(canvas);
      }
      if (!cancelled) setState({ shown, total: pdf.numPages });
      await pdf.loadingTask.destroy();
    })().catch(() => {
      if (!cancelled) setState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  return (
    <div className="space-y-3">
      <div ref={hostRef} className="space-y-3" />
      {state === null && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      )}
      {state === "error" && <p className="text-sm text-muted-foreground">{t("attachments.preview.unavailable")}</p>}
      {state !== null && state !== "error" && state.total > state.shown && (
        <p className="text-center text-xs text-muted-foreground">
          {t("attachments.preview.more_pages", { shown: String(state.shown), total: String(state.total) })}
        </p>
      )}
    </div>
  );
}

function ImageView({ bytes, mime, name }: { bytes: Uint8Array; mime: string; name: string }) {
  const { t } = useI18n();
  const [failed, setFailed] = React.useState(false);
  const url = React.useMemo(() => URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })), [bytes, mime]);
  React.useEffect(() => () => URL.revokeObjectURL(url), [url]);
  if (failed) return <p className="text-sm text-muted-foreground">{t("attachments.preview.unavailable")}</p>;
  return <img src={url} alt={name} onError={() => setFailed(true)} className="mx-auto max-w-full rounded border" />;
}

/**
 * The preview beside the picker's list (or over it on a phone). The file is
 * fetched through our server, which holds the Nextcloud token; the browser
 * never talks to Nextcloud directly.
 */
export function NextcloudFilePreview({
  entry,
  onClose,
  onChoose,
}: {
  entry: NcEntry;
  onClose: () => void;
  onChoose: () => void;
}) {
  const { t } = useI18n();
  const download = useServerFn(downloadNextcloudFile);
  const kind = previewKind(entry.mime);
  const fileQ = useQuery({
    queryKey: ["nc-file", entry.path, entry.modified],
    queryFn: async () => {
      const r = await download({ data: { path: entry.path } });
      return { bytes: base64ToBytes(r.base64), mime: r.mime ?? entry.mime ?? "" };
    },
    enabled: kind !== null,
    retry: false,
    staleTime: 5 * 60_000,
    // Up to 15 MB each; do not keep closed previews around.
    gcTime: 60_000,
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b pb-2">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onClose} aria-label={t("common.back")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1 truncate text-sm font-medium" title={entry.path}>
          {entry.name}
        </div>
        <Button type="button" variant="ghost" size="icon" className="hidden h-8 w-8 md:inline-flex" onClick={onClose} aria-label={t("attachments.preview.close")}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        {kind === null ? (
          <p className="text-sm text-muted-foreground">{t("attachments.preview.unavailable")}</p>
        ) : fileQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
          </div>
        ) : fileQ.error ? (
          <p className="text-sm text-destructive">{fileQ.error instanceof Error ? fileQ.error.message : String(fileQ.error)}</p>
        ) : fileQ.data && kind === "pdf" ? (
          <PdfPages bytes={fileQ.data.bytes} />
        ) : fileQ.data ? (
          <ImageView bytes={fileQ.data.bytes} mime={fileQ.data.mime} name={entry.name} />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
        <a
          href={entry.link_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" /> {t("attachments.preview.open_nextcloud")}
        </a>
        <Button type="button" size="sm" onClick={onChoose}>
          <Check className="mr-1 h-4 w-4" /> {t("attachments.preview.choose")}
        </Button>
      </div>
    </div>
  );
}
