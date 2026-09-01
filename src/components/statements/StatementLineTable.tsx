import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, MapPin, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatementPlaceDialog } from "@/components/statements/StatementPlaceDialog";
import type { RecentLocation } from "@/components/LocationSection";
import { useI18n } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { fetchCategories, fmtMoney } from "@/lib/finance";
import { locationFromRow, type TxLocation } from "@/lib/location";
import { commitStatementLines } from "@/utils/statements.functions";
import type { StatementLine } from "@/lib/ai/statementTypes";

type Draft = {
  description: string;
  category_id: string;
  tags: string;
  note: string;
  amount: string;
  location: TxLocation | null;
  checked: boolean;
  error?: string | null;
};

function seed(line: StatementLine): Draft {
  return {
    description: line.suggested_description || line.description || "",
    category_id: line.suggested_category_id || "",
    tags: (line.suggested_tags ?? []).join(" "),
    note: "",
    amount: String(Math.abs(line.amount)),
    location: null,
    checked: false,
  };
}

function buildNote(note: string, tags: string): string | null {
  const cleaned = tags
    .split(/[\s,]+/)
    .map((x) => x.replace(/^#/, "").trim())
    .filter(Boolean)
    .map((x) => `#${x}`);
  const parts = [note.trim(), cleaned.join(" ")].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

export function StatementLineTable({
  importId,
  lines,
  symbol,
  renderRowActions,
}: {
  importId: string;
  lines: StatementLine[];
  symbol: string;
  renderRowActions?: (line: StatementLine) => React.ReactNode;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const commitFn = useServerFn(commitStatementLines);

  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const categories = (categoriesQ.data ?? []).filter((c) => !c.archived);

  const recentLocationsQ = useQuery({
    queryKey: ["transactions", "recent_locations"],
    queryFn: async (): Promise<RecentLocation[]> => {
      const { data, error } = await supabase
        .from("transactions")
        .select("latitude, longitude, location_accuracy_m, location_label, location_source, description, occurred_on")
        .not("latitude", "is", null)
        .order("occurred_on", { ascending: false })
        .limit(50);
      if (error) throw error;
      const out: RecentLocation[] = [];
      const seenKeys = new Set<string>();
      for (const r of data ?? []) {
        const loc = locationFromRow(r);
        if (!loc) continue;
        const key = `${loc.latitude.toFixed(4)}|${loc.longitude.toFixed(4)}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        out.push({ ...loc, description: r.description ?? null });
        if (out.length >= 12) break;
      }
      return out;
    },
  });

  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [placeFor, setPlaceFor] = React.useState<string | null>(null);

  // Seed drafts for lines we have not seen yet; keep edits for known lines.
  React.useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, Draft> = {};
      let changed = false;
      for (const l of lines) {
        next[l.id] = prev[l.id] ?? seed(l);
        if (!prev[l.id]) changed = true;
      }
      if (!changed && Object.keys(prev).length === lines.length) return prev;
      return next;
    });
  }, [lines]);

  const patch = (id: string, p: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...p } as Draft }));

  const selected = lines.filter((l) => drafts[l.id]?.checked);
  const allChecked = lines.length > 0 && selected.length === lines.length;

  const commitMut = useMutation({
    mutationFn: async () => {
      const rows = selected.map((l) => {
        const d = drafts[l.id];
        const amt = Number(String(d.amount).replace(",", "."));
        return {
          line_id: l.id,
          occurred_on: l.booking_date || l.value_date || new Date().toISOString().slice(0, 10),
          amount: Math.abs(amt),
          type: (l.amount < 0 ? "expense" : "income") as "expense" | "income",
          description: d.description.trim() || null,
          note: buildNote(d.note, d.tags),
          category_id: d.category_id || null,
          latitude: d.location?.latitude ?? null,
          longitude: d.location?.longitude ?? null,
          location_label: d.location?.label ?? null,
          location_source: d.location?.source ?? null,
        };
      });
      const bad = rows.find((r) => !Number.isFinite(r.amount) || r.amount <= 0);
      if (bad) throw new Error(t("statements.table.err.amount"));
      return commitFn({ data: { import_id: importId, rows } });
    },
    onSuccess: (res) => {
      const ok = res.results.filter((r) => r.ok).length;
      setDrafts((prev) => {
        const next = { ...prev };
        for (const r of res.results) {
          if (r.ok) delete next[r.line_id];
          else if (next[r.line_id]) next[r.line_id] = { ...next[r.line_id], error: r.error ?? "error" };
        }
        return next;
      });
      qc.invalidateQueries({ queryKey: ["statement_import", importId] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      if (ok > 0) toast.success(t("statements.toast.committed", { ok: String(ok), total: String(res.results.length) }));
      const failed = res.results.length - ok;
      if (failed > 0) toast.error(t("statements.table.err.partial", { n: String(failed) }));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  if (lines.length === 0) return null;

  const catSelect = (l: StatementLine) => (
    <Select value={drafts[l.id]?.category_id || ""} onValueChange={(v) => patch(l.id, { category_id: v })}>
      <SelectTrigger className="h-8 w-full">
        <SelectValue placeholder={t("statements.table.col.category")} />
      </SelectTrigger>
      <SelectContent>
        {categories.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const placeButton = (l: StatementLine) => (
    <Button
      type="button"
      size="sm"
      variant={drafts[l.id]?.location ? "secondary" : "outline"}
      className="h-8 w-full justify-start truncate"
      onClick={() => setPlaceFor(l.id)}
    >
      <MapPin className="mr-1 h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{drafts[l.id]?.location?.label ?? t("statements.table.place_pick")}</span>
    </Button>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Checkbox
          checked={allChecked}
          onCheckedChange={(v) =>
            setDrafts((prev) => {
              const next = { ...prev };
              for (const l of lines) next[l.id] = { ...(next[l.id] ?? seed(l)), checked: !!v };
              return next;
            })
          }
          aria-label={t("statements.table.select_all")}
        />
        <span>{t("statements.table.hint")}</span>
        <Button
          size="sm"
          className="ml-auto"
          disabled={selected.length === 0 || commitMut.isPending}
          onClick={() => commitMut.mutate()}
        >
          {commitMut.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-1 h-3.5 w-3.5" />
          )}
          {t("statements.table.commit", { n: String(selected.length) })}
        </Button>
      </div>

      {/* Desktop header */}
      <div className="hidden gap-2 px-3 text-[11px] uppercase tracking-wide text-muted-foreground lg:grid lg:grid-cols-[28px_88px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.9fr)_110px_auto]">
        <span />
        <span>{t("statements.table.col.date")}</span>
        <span>{t("statements.table.col.description")}</span>
        <span>{t("statements.table.col.category")}</span>
        <span>{t("statements.table.col.tags")}</span>
        <span>{t("statements.table.col.note")}</span>
        <span>{t("statements.table.place")}</span>
        <span className="text-right">{t("statements.table.col.amount")}</span>
        <span />
      </div>

      <ul className="space-y-2">
        {lines.map((l) => {
          const d = drafts[l.id];
          if (!d) return null;
          return (
            <li
              key={l.id}
              className="rounded-md border bg-card p-2 lg:grid lg:grid-cols-[28px_88px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.9fr)_110px_auto] lg:items-center lg:gap-2 lg:p-2"
            >
              <div className="mb-2 flex items-center gap-2 lg:mb-0">
                <Checkbox checked={d.checked} onCheckedChange={(v) => patch(l.id, { checked: !!v })} />
                <span className="text-xs text-muted-foreground lg:hidden">
                  {l.booking_date ?? l.value_date ?? "—"} · {fmtMoney(l.amount, symbol)}
                </span>
              </div>
              <div className="hidden text-xs text-muted-foreground lg:block">
                {l.booking_date ?? l.value_date ?? "—"}
              </div>
              <div className="mb-1 lg:mb-0">
                <Input
                  className="h-8"
                  value={d.description}
                  placeholder={l.description}
                  onChange={(e) => patch(l.id, { description: e.target.value })}
                />
                <div className="truncate text-[11px] text-muted-foreground lg:hidden">{l.description}</div>
              </div>
              <div className="mb-1 lg:mb-0">{catSelect(l)}</div>
              <div className="mb-1 lg:mb-0">
                <Input
                  className="h-8"
                  value={d.tags}
                  placeholder={t("statements.table.tags_placeholder")}
                  onChange={(e) => patch(l.id, { tags: e.target.value })}
                />
              </div>
              <div className="mb-1 lg:mb-0">
                <Input
                  className="h-8"
                  value={d.note}
                  placeholder={t("statements.table.col.note")}
                  onChange={(e) => patch(l.id, { note: e.target.value })}
                />
              </div>
              <div className="mb-1 lg:mb-0">{placeButton(l)}</div>
              <div className="mb-1 lg:mb-0">
                <Input
                  className="h-8 text-right"
                  inputMode="decimal"
                  value={d.amount}
                  onChange={(e) => patch(l.id, { amount: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-end gap-1">{renderRowActions?.(l)}</div>
              {d.error && <p className="col-span-full text-xs text-destructive">{d.error}</p>}
            </li>
          );
        })}
      </ul>

      <StatementPlaceDialog
        open={!!placeFor}
        onOpenChange={(v) => setPlaceFor(v ? placeFor : null)}
        value={placeFor ? (drafts[placeFor]?.location ?? null) : null}
        onChange={(loc) => placeFor && patch(placeFor, { location: loc })}
        recent={recentLocationsQ.data ?? []}
      />
    </div>
  );
}
