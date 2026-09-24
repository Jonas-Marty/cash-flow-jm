import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, ExternalLink, Loader2, PanelRightClose } from "lucide-react";
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
  const [width, setWidth] = React.useState(0);
  const [state, setState] = React.useState<{ shown: number; total: number } | "error" | null>(null);

  // Pages are drawn for one exact width. Drawn for one width and shown at
  // another, the browser rescales the bitmap and text goes soft, so a width
  // change (window resize, the panel opening) redraws them.
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let measured = false;
    const measure = () => {
      const w = Math.floor(host.clientWidth);
      clearTimeout(timer);
      // The first width applies at once; later ones wait for resizing to settle.
      const delay = measured ? 150 : 0;
      measured = true;
      timer = setTimeout(() => setWidth((prev) => (Math.abs(prev - w) >= 2 ? w : prev)), delay);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, []);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || width <= 0) return;
    let cancelled = false;
    setState(null);
    (async () => {
      const { getDocumentProxy } = await import("unpdf");
      // pdf.js may detach the buffer it is given; keep the cached bytes intact.
      const pdf = await getDocumentProxy(bytes.slice());
      const shown = Math.min(pdf.numPages, MAX_PDF_PAGES);
      const dpr = window.devicePixelRatio || 1;
      const canvases: HTMLCanvasElement[] = [];
      for (let n = 1; n <= shown && !cancelled; n++) {
        const page = await pdf.getPage(n);
        const pixels = Math.round(width * dpr);
        const viewport = page.getViewport({ scale: pixels / page.getViewport({ scale: 1 }).width });
        const canvas = document.createElement("canvas");
        canvas.width = pixels;
        canvas.height = Math.round(viewport.height);
        canvas.style.width = `${width}px`;
        canvas.className = "block h-auto max-w-full rounded border bg-white shadow-sm";
        canvas.setAttribute("role", "img");
        canvas.setAttribute(
          "aria-label",
          tRef.current("attachments.preview.page", { n: String(n) }),
        );
        // Only the canvas, not a context made here: pdf.js then opens it the way
        // it is built for (opaque, CPU-backed), which is what keeps text crisp.
        // A default context is transparent, and Chrome turns off its sharper
        // text smoothing on transparent canvases.
        await page.render({ canvas, viewport }).promise;
        canvases.push(canvas);
      }
      await pdf.loadingTask.destroy();
      if (cancelled) return;
      // Swap all pages at once, so a redraw never shows a half-empty panel.
      host.replaceChildren(...canvases);
      setState({ shown, total: pdf.numPages });
    })().catch(() => {
      if (!cancelled) setState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [bytes, width]);

  return (
    <div className="space-y-3">
      <div ref={hostRef} className="space-y-3" />
      {state === null && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </div>
      )}
      {state === "error" && (
        <p className="text-sm text-muted-foreground">{t("attachments.preview.unavailable")}</p>
      )}
      {state !== null && state !== "error" && state.total > state.shown && (
        <p className="text-center text-xs text-muted-foreground">
          {t("attachments.preview.more_pages", {
            shown: String(state.shown),
            total: String(state.total),
          })}
        </p>
      )}
    </div>
  );
}

function ImageView({ bytes, mime, name }: { bytes: Uint8Array; mime: string; name: string }) {
  const { t } = useI18n();
  const [failed, setFailed] = React.useState(false);
  const url = React.useMemo(
    () => URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })),
    [bytes, mime],
  );
  React.useEffect(() => () => URL.revokeObjectURL(url), [url]);
  if (failed)
    return <p className="text-sm text-muted-foreground">{t("attachments.preview.unavailable")}</p>;
  return (
    <img
      src={url}
      alt={name}
      onError={() => setFailed(true)}
      className="mx-auto max-w-full rounded border"
    />
  );
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
      {/* One close control, on the left: the dialog's own X already sits top
          right, and a second X beside it read as "close everything". The
          right padding keeps a long name from running under that X. */}
      <div className="flex items-start gap-2 border-b pb-2 pr-8">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onClose}
          aria-label={t("attachments.preview.close")}
          title={t("attachments.preview.close")}
        >
          <ArrowLeft className="h-4 w-4 md:hidden" />
          <PanelRightClose className="hidden h-4 w-4 md:block" />
        </Button>
        <div
          className="min-w-0 flex-1 pt-1.5 text-sm font-medium [overflow-wrap:anywhere]"
          title={entry.path}
        >
          {entry.name}
        </div>
      </div>
      {/* A stable gutter: a scrollbar appearing would otherwise narrow the
          pages after they were drawn and blur them. */}
      <div className="min-h-0 flex-1 overflow-y-auto py-3 [scrollbar-gutter:stable]">
        {kind === null ? (
          <p className="text-sm text-muted-foreground">{t("attachments.preview.unavailable")}</p>
        ) : fileQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
          </div>
        ) : fileQ.error ? (
          <p className="text-sm text-destructive">
            {fileQ.error instanceof Error ? fileQ.error.message : String(fileQ.error)}
          </p>
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
