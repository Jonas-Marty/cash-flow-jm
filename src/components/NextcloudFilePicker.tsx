import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, FileText } from "lucide-react";
import { searchNextcloud } from "@/utils/nextcloud.functions";
import { useI18n } from "@/i18n";

export interface PickedFile {
  name: string;
  path: string;
  link_url: string;
}

export function NextcloudFilePicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (f: PickedFile) => void;
}) {
  const { t } = useI18n();
  const search = useServerFn(searchNextcloud);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<PickedFile[]>([]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setError(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = setTimeout(async () => {
      try {
        const res = await search({ data: { query: q } });
        if (!cancelled) setResults(res.results);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query, open, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("attachments.picker.title")}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder={t("attachments.picker.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="min-h-[160px] max-h-[420px] overflow-y-auto rounded-md border">
          {loading && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
            </div>
          )}
          {!loading && error && (
            <div className="p-4 text-sm text-destructive">{error}</div>
          )}
          {!loading && !error && query.trim().length < 2 && (
            <div className="p-4 text-sm text-muted-foreground">{t("attachments.picker.hint")}</div>
          )}
          {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">{t("attachments.picker.no_results")}</div>
          )}
          {!loading && results.length > 0 && (
            <ul className="divide-y">
              {results.map((r) => {
                const dir = r.path.substring(0, r.path.length - r.name.length).replace(/\/+$/, "") || "/";
                return (
                  <li key={r.path}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-accent"
                      onClick={() => { onPick(r); onOpenChange(false); }}
                    >
                      <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{r.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{dir}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}