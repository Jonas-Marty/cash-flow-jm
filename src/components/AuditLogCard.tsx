import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/auth";
import { useI18n } from "@/i18n";

/**
 * Recent audit log entries.
 * Visible to all signed-in users, but admins see entries from every user
 * (RLS policy on audit_logs takes care of this automatically).
 */
export function AuditLogCard() {
  const { t } = useI18n();
  const isAdminQ = useIsAdmin();
  const [tableFilter, setTableFilter] = React.useState("");
  const [actionFilter, setActionFilter] = React.useState("");
  const [limit, setLimit] = React.useState(50);

  const q = useQuery({
    queryKey: ["audit_logs", tableFilter, actionFilter, limit],
    queryFn: async () => {
      let query = supabase
        .from("audit_logs")
        .select("id, occurred_at, user_id, action, table_name, row_id, diff, metadata")
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (tableFilter.trim()) query = query.eq("table_name", tableFilter.trim());
      if (actionFilter.trim()) query = query.eq("action", actionFilter.trim());
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("audit.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {isAdminQ.data ? t("audit.intro_admin") : t("audit.intro_user")}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">{t("audit.table")}</Label>
            <Input
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              placeholder="transactions"
              className="h-8 w-44"
            />
          </div>
          <div>
            <Label className="text-xs">{t("audit.action")}</Label>
            <Input
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              placeholder="update"
              className="h-8 w-32"
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            {t("audit.refresh")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLimit((n) => (n >= 500 ? 50 : n + 50))}
          >
            {limit >= 500 ? t("audit.reset_limit") : t("audit.load_more")}
          </Button>
        </div>

        <div className="max-h-[420px] overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60">
              <tr className="text-left">
                <th className="px-2 py-1 font-medium">{t("audit.when")}</th>
                <th className="px-2 py-1 font-medium">{t("audit.action")}</th>
                <th className="px-2 py-1 font-medium">{t("audit.table")}</th>
                <th className="px-2 py-1 font-medium">{t("audit.row")}</th>
                {isAdminQ.data && <th className="px-2 py-1 font-medium">{t("audit.user")}</th>}
                <th className="px-2 py-1 font-medium">{t("audit.changes")}</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((row) => (
                <tr key={row.id} className="border-t align-top">
                  <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                    {new Date(row.occurred_at).toLocaleString()}
                  </td>
                  <td className="px-2 py-1 font-mono">{row.action}</td>
                  <td className="px-2 py-1 font-mono">{row.table_name ?? "—"}</td>
                  <td className="px-2 py-1 font-mono text-muted-foreground">
                    {row.row_id ? row.row_id.slice(0, 8) : "—"}
                  </td>
                  {isAdminQ.data && (
                    <td className="px-2 py-1 font-mono text-muted-foreground">
                      {row.user_id ? row.user_id.slice(0, 8) : "—"}
                    </td>
                  )}
                  <td className="px-2 py-1">
                    <DiffSummary diff={row.diff as Record<string, unknown> | null} />
                  </td>
                </tr>
              ))}
              {(q.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={isAdminQ.data ? 6 : 5} className="px-2 py-3 text-center text-muted-foreground">
                    {q.isLoading ? t("common.loading") : t("audit.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function DiffSummary({ diff }: { diff: Record<string, unknown> | null }) {
  if (!diff) return <span className="text-muted-foreground">—</span>;
  const keys = Object.keys(diff);
  if (keys.length === 0) return <span className="text-muted-foreground">—</span>;
  const preview = keys.slice(0, 4).join(", ");
  const more = keys.length > 4 ? ` +${keys.length - 4}` : "";
  return (
    <details>
      <summary className="cursor-pointer truncate text-foreground/80">
        {preview}
        {more}
      </summary>
      <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[10px] leading-snug">
        {JSON.stringify(diff, null, 2)}
      </pre>
    </details>
  );
}