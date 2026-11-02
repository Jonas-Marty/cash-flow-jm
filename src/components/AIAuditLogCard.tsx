import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles, RefreshCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";

type Row = {
  id: string;
  occurred_at: string;
  kind: Kind;
  model: string | null;
  provider_host: string | null;
  endpoint_name: string | null;
  tool_name: string | null;
  conversation_id: string | null;
  duration_ms: number | null;
  ok: boolean | null;
  error_message: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  payload: Record<string, unknown> | null;
};

const KINDS = [
  "chat_request",
  "tool_call",
  "document_extract",
  "statement_classify",
  "pending_enrich",
  "recurring_extract",
  "transcribe",
] as const;
type Kind = (typeof KINDS)[number];

const ALL = "__all";

export interface AIAuditFilter {
  /** A connection id, or `name:<connection name>` for entries that never matched one. */
  conn: string;
  model: string;
  kind: string;
}

/**
 * The AI log. Filters live in the Settings URL so the usage page can link
 * straight to the entries behind one of its lines.
 */
export function AIAuditLogCard({
  filter,
  onFilterChange,
}: {
  filter: AIAuditFilter;
  onFilterChange: (f: AIAuditFilter) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [limit, setLimit] = React.useState(50);

  // Connections and models the log has seen, for the filters.
  const optionsQ = useQuery({
    queryKey: ["ai_usage", "all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ai_usage", {
        p_from: "1970-01-01",
        p_to: "2999-12-31",
      });
      if (error) throw error;
      const conns = new Map<string, string>();
      const models = new Set<string>();
      for (const r of data ?? []) {
        conns.set(r.endpoint_id ?? `name:${r.connection}`, r.connection);
        models.add(r.model);
      }
      return {
        conns: [...conns.entries()].sort((a, b) => a[1].localeCompare(b[1])),
        models: [...models].sort(),
      };
    },
  });

  const q = useQuery({
    queryKey: ["ai_audit_logs", filter, limit],
    queryFn: async (): Promise<Row[]> => {
      let query = supabase
        .from("ai_audit_logs")
        .select(
          "id, occurred_at, kind, model, provider_host, endpoint_name, tool_name, conversation_id, duration_ms, ok, error_message, prompt_tokens, completion_tokens, total_tokens, payload",
        )
        .is("cleared_at", null)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (filter.kind) query = query.eq("kind", filter.kind);
      if (filter.model) query = query.eq("model", filter.model);
      if (filter.conn.startsWith("name:")) {
        const name = filter.conn.slice(5);
        query = query
          .is("endpoint_id", null)
          .or(`endpoint_name.eq."${name}",provider_host.eq."${name}"`);
      } else if (filter.conn) {
        query = query.eq("endpoint_id", filter.conn);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const clearAll = async () => {
    if (!confirm(t("ai.audit.clear_confirm"))) return;
    const { error } = await supabase.rpc("clear_ai_audit_log");
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("ai.audit.cleared"));
    qc.invalidateQueries({ queryKey: ["ai_audit_logs"] });
  };

  const set = (patch: Partial<AIAuditFilter>) => onFilterChange({ ...filter, ...patch });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" /> {t("ai.audit.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("ai.audit.intro")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            id="ai-log-kind"
            label={t("ai.audit.filter.kind")}
            value={filter.kind}
            onChange={(v) => set({ kind: v })}
            options={KINDS.map((k) => [k, t(`ai.audit.kind.${k}`)])}
          />
          <FilterSelect
            id="ai-log-conn"
            label={t("ai.audit.filter.connection")}
            value={filter.conn}
            onChange={(v) => set({ conn: v })}
            options={optionsQ.data?.conns ?? []}
          />
          <FilterSelect
            id="ai-log-model"
            label={t("ai.audit.filter.model")}
            value={filter.model}
            onChange={(v) => set({ model: v })}
            options={(optionsQ.data?.models ?? []).map((m) => [m, m])}
          />
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="outline" onClick={() => q.refetch()}>
              <RefreshCcw className="h-3.5 w-3.5" /> {t("audit.refresh")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLimit((n) => (n >= 500 ? 50 : n + 50))}
            >
              {limit >= 500 ? t("audit.reset_limit") : t("audit.load_more")}
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={clearAll}>
              <Trash2 className="h-3.5 w-3.5" /> {t("ai.audit.clear")}
            </Button>
          </div>
        </div>

        <div className="max-h-[480px] overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60">
              <tr className="text-left">
                <th className="px-2 py-1 font-medium">{t("audit.when")}</th>
                <th className="px-2 py-1 font-medium">{t("ai.audit.col.kind")}</th>
                <th className="px-2 py-1 font-medium">{t("ai.audit.col.detail")}</th>
                <th className="px-2 py-1 font-medium">{t("ai.audit.col.duration")}</th>
                <th className="px-2 py-1 font-medium">{t("ai.audit.col.tokens")}</th>
                <th className="px-2 py-1 font-medium">{t("ai.audit.col.status")}</th>
                <th className="px-2 py-1 font-medium">{t("ai.audit.col.payload")}</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((row) => (
                <tr key={row.id} className="border-t align-top">
                  <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                    {new Date(row.occurred_at).toLocaleString()}
                  </td>
                  <td className="px-2 py-1">
                    <Badge
                      variant={row.kind === "tool_call" ? "secondary" : "outline"}
                      className="whitespace-nowrap text-[10px]"
                    >
                      {t(`ai.audit.kind.${row.kind}`)}
                    </Badge>
                  </td>
                  <td className="px-2 py-1 font-mono text-muted-foreground">
                    {row.kind === "tool_call"
                      ? (row.tool_name ?? "—")
                      : [row.endpoint_name ?? row.provider_host, row.model]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                  </td>
                  <td className="px-2 py-1 text-muted-foreground">
                    {row.duration_ms != null ? `${row.duration_ms} ms` : "—"}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                    {row.total_tokens != null ? (
                      <span
                        title={`in ${row.prompt_tokens ?? "?"} / out ${row.completion_tokens ?? "?"}`}
                      >
                        {row.total_tokens.toLocaleString()}
                        <span className="ml-1 text-[10px] opacity-70">
                          ({row.prompt_tokens ?? "?"}/{row.completion_tokens ?? "?"})
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {row.ok == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : row.ok ? (
                      <span className="text-emerald-600">ok</span>
                    ) : (
                      <span className="text-destructive" title={row.error_message ?? undefined}>
                        error
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <PayloadDetails payload={row.payload} error={row.error_message} />
                  </td>
                </tr>
              ))}
              {(q.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">
                    {q.isLoading ? t("common.loading") : t("ai.audit.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground">{t("ai.audit.footer_note")}</p>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  const { t } = useI18n();
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger id={id} aria-label={label} className="h-8 w-auto min-w-[9rem] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("ai.audit.filter.all", { what: label })}</SelectItem>
        {options.map(([v, text]) => (
          <SelectItem key={v} value={v}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PayloadDetails({
  payload,
  error,
}: {
  payload: Record<string, unknown> | null;
  error: string | null;
}) {
  const hasPayload = payload && Object.keys(payload).length > 0;
  if (!hasPayload && !error) return <span className="text-muted-foreground">—</span>;
  const summary = error ? error.slice(0, 60) : Object.keys(payload!).slice(0, 4).join(", ");
  return (
    <details>
      <summary className="cursor-pointer truncate text-foreground/80">{summary}</summary>
      <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted/40 p-2 text-[10px] leading-snug">
        {JSON.stringify({ ...(error ? { error } : {}), ...(payload ?? {}) }, null, 2)}
      </pre>
    </details>
  );
}
