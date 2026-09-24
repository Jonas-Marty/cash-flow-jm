import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowDownZA,
  ArrowDownAZ,
  ChevronRight,
  Eye,
  FileText,
  Folder,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listNextcloudFolder, searchNextcloud } from "@/utils/nextcloud.functions";
import { isReconnectError } from "@/lib/nextcloudAuth";
import {
  previewKind,
  sortEntries,
  type NcEntry,
  type NcKind,
  type NcOrder,
} from "@/lib/nextcloudDav";
import { NextcloudFilePreview } from "@/components/NextcloudFilePreview";
import { useI18n } from "@/i18n";

export interface PickedFile {
  name: string;
  path: string;
  link_url: string;
  file_id: string | null;
  mime: string | null;
}

const folderKey = (kind: NcKind) => `nc-picker-folder:${kind}`;

// The last folder is a per-device convenience: receipts and statements usually
// live in one place each, and starting there saves the walk down every time.
function readFolder(kind: NcKind): string {
  try {
    return localStorage.getItem(folderKey(kind)) || "/";
  } catch {
    return "/";
  }
}

function writeFolder(kind: NcKind, path: string) {
  try {
    localStorage.setItem(folderKey(kind), path);
  } catch {
    // Private mode or blocked storage: the picker just starts at the top.
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}

function fmtSize(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function NextcloudFilePicker({
  open,
  onOpenChange,
  onPick,
  kind = "receipt",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (f: PickedFile) => void;
  /** Decides which file types are offered: receipts are PDFs and images, statements also CSV. */
  kind?: Exclude<NcKind, "any">;
}) {
  const { t, lang } = useI18n();
  const search = useServerFn(searchNextcloud);
  const list = useServerFn(listNextcloudFolder);
  const [query, setQuery] = React.useState("");
  const [folder, setFolder] = React.useState<string>(() => readFolder(kind));
  const [onlyDocs, setOnlyDocs] = React.useState(true);
  const [preview, setPreview] = React.useState<NcEntry | null>(null);
  // Deliberately not remembered: Z to A puts date-prefixed names newest first,
  // and the other direction is for one hunt, not a preference.
  const [order, setOrder] = React.useState<NcOrder>("desc");
  const q = useDebounced(query.trim(), 300);
  const searching = q.length >= 2;
  // Statements are always filtered: extraction cannot read anything else.
  const effKind: NcKind = kind === "receipt" && !onlyDocs ? "any" : kind;

  React.useEffect(() => {
    if (open) setFolder(readFolder(kind));
    else {
      setQuery("");
      setPreview(null);
      setOrder("desc");
    }
  }, [open, kind]);

  const searchQ = useQuery({
    queryKey: ["nc-search", q, effKind, order],
    queryFn: () => search({ data: { query: q, kind: effKind, order } }),
    enabled: open && searching,
    retry: false,
    staleTime: 30_000,
  });
  const folderQ = useQuery({
    queryKey: ["nc-folder", folder, effKind],
    queryFn: () => list({ data: { path: folder, kind: effKind } }),
    enabled: open && !searching,
    retry: false,
    staleTime: 30_000,
  });

  const active = searching ? searchQ : folderQ;
  // Search results come back in order from the server; a folder is re-sorted
  // here, so flipping the order does not fetch it again.
  const folderEntries = React.useMemo(
    () => sortEntries(folderQ.data?.entries ?? [], order),
    [folderQ.data, order],
  );
  const entries: NcEntry[] = searching ? (searchQ.data?.results ?? []) : folderEntries;
  // Typing between keystrokes counts as loading, so "no matches" never
  // flashes for a query that has not been sent yet.
  const pending = query.trim() !== q && query.trim().length >= 2;
  const loading = pending || active.isFetching;

  const openFolder = (path: string) => {
    setFolder(path);
    writeFolder(kind, path);
  };

  const crumbs = React.useMemo(() => {
    const segs = folder.split("/").filter(Boolean);
    return segs.map((name, i) => ({ name, path: `/${segs.slice(0, i + 1).join("/")}` }));
  }, [folder]);

  const dateFmt = React.useMemo(
    () => new Intl.DateTimeFormat(lang === "de" ? "de-CH" : "en-GB", { dateStyle: "medium" }),
    [lang],
  );

  const pick = (e: NcEntry) => {
    onPick({ name: e.name, path: e.path, link_url: e.link_url, file_id: e.file_id, mime: e.mime });
    onOpenChange(false);
  };

  const error = active.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[92vh] flex-col",
          preview ? "max-w-[min(96vw,1500px)]" : "max-w-3xl",
        )}
      >
        <div
          className={cn(
            "grid min-h-0 flex-1 gap-4",
            preview && "md:h-[86vh] md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]",
          )}
        >
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("attachments.picker.title")}</DialogTitle>
            </DialogHeader>
            <Input
              autoFocus
              placeholder={t("attachments.picker.placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              {searching ? (
                <span className="min-w-0 flex-1">{t("attachments.picker.searching_all")}</span>
              ) : (
                <nav
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5"
                  aria-label={t("attachments.picker.folder")}
                >
                  <button
                    type="button"
                    className="hover:text-foreground hover:underline"
                    onClick={() => openFolder("/")}
                  >
                    {t("nextcloud.title")}
                  </button>
                  {crumbs.map((c) => (
                    <React.Fragment key={c.path}>
                      <ChevronRight className="h-3 w-3 shrink-0" />
                      <button
                        type="button"
                        className="truncate hover:text-foreground hover:underline"
                        onClick={() => openFolder(c.path)}
                      >
                        {c.name}
                      </button>
                    </React.Fragment>
                  ))}
                </nav>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => setOrder(order === "desc" ? "asc" : "desc")}
                >
                  {order === "desc" ? (
                    <ArrowDownZA className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownAZ className="h-3.5 w-3.5" />
                  )}
                  {order === "desc"
                    ? t("attachments.picker.name_desc")
                    : t("attachments.picker.name_asc")}
                </button>
                {kind === "receipt" ? (
                  <label className="flex items-center gap-1.5">
                    <Checkbox checked={onlyDocs} onCheckedChange={(v) => setOnlyDocs(v === true)} />
                    {t("attachments.picker.only_docs")}
                  </label>
                ) : (
                  <span>{t("attachments.picker.statement_types")}</span>
                )}
              </div>
            </div>
            <div className="min-h-[200px] flex-1 overflow-y-auto rounded-md border">
              {loading && (
                <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
                </div>
              )}
              {!loading && error && (
                <div className="space-y-2 p-4 text-sm">
                  {isReconnectError(error) ? (
                    <>
                      <p className="text-destructive">{t("nextcloud.reconnect_needed")}</p>
                      <Link
                        to="/settings"
                        hash="nextcloud"
                        className="text-primary underline"
                        onClick={() => onOpenChange(false)}
                      >
                        {t("nextcloud.open_settings")}
                      </Link>
                    </>
                  ) : (
                    <>
                      <p className="text-destructive">
                        {error instanceof Error ? error.message : String(error)}
                      </p>
                      {!searching && folder !== "/" && (
                        <Button size="sm" variant="outline" onClick={() => openFolder("/")}>
                          {t("nextcloud.title")}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
              {!loading && !error && entries.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground">
                  {searching
                    ? t("attachments.picker.no_results")
                    : t("attachments.picker.empty_folder")}
                </div>
              )}
              {!loading && !error && entries.length > 0 && (
                <ul className="divide-y">
                  {entries.map((e) => {
                    const dir =
                      e.path.slice(0, e.path.length - e.name.length).replace(/\/+$/, "") || "/";
                    const meta = [
                      searching ? dir : null,
                      e.modified ? dateFmt.format(new Date(e.modified)) : null,
                      e.is_dir ? null : fmtSize(e.size),
                    ].filter(Boolean);
                    const Icon = e.is_dir
                      ? Folder
                      : e.mime?.startsWith("image/")
                        ? ImageIcon
                        : FileText;
                    const canPreview = !e.is_dir && previewKind(e.mime) !== null;
                    return (
                      <li
                        key={e.path}
                        className={`flex items-stretch ${preview?.path === e.path ? "bg-accent" : ""}`}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2 text-left hover:bg-accent"
                          onClick={() => (e.is_dir ? openFolder(e.path) : pick(e))}
                        >
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            {/* Names wrap: the part that tells files apart is often at the end. */}
                            <div className="text-sm font-medium [overflow-wrap:anywhere]">
                              {e.name}
                            </div>
                            {meta.length > 0 && (
                              <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                                {meta.join(" · ")}
                              </div>
                            )}
                          </div>
                          {e.is_dir && (
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                        </button>
                        {canPreview && (
                          <button
                            type="button"
                            className="shrink-0 px-3 text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={() => setPreview(preview?.path === e.path ? null : e)}
                            aria-label={t("attachments.preview.show", { name: e.name })}
                            title={t("attachments.preview.show", { name: e.name })}
                            aria-pressed={preview?.path === e.path}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
          {preview && (
            // Beside the list from md up; on a phone it covers the dialog, and
            // closing it returns to the list where the user left it.
            <div className="absolute inset-0 z-10 flex flex-col rounded-lg bg-background p-4 md:static md:z-auto md:min-h-0 md:rounded-none md:border-l md:p-0 md:pl-4">
              <NextcloudFilePreview
                entry={preview}
                onClose={() => setPreview(null)}
                onChoose={() => pick(preview)}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
