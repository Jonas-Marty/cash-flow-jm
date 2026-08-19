import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { getStatementFileUrl, getStatementRefsForTransactions } from "@/utils/statements.functions";

/**
 * Opens the source document of a statement import in a new browser tab.
 * Internal files get a short-lived signed URL; external ones open their own link.
 */
export function StatementDocButton({
  importId,
  hasDocument,
  size = "sm",
  variant = "outline",
  label,
  className,
}: {
  importId: string;
  hasDocument: boolean;
  size?: "sm" | "icon" | "default";
  variant?: "outline" | "ghost" | "secondary";
  label?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const getUrl = useServerFn(getStatementFileUrl);
  const [busy, setBusy] = React.useState(false);

  if (!hasDocument) return null;

  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      disabled={busy}
      title={t("statements.doc.open")}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setBusy(true);
        // Open synchronously-ish: popup blockers allow this because it follows a click.
        try {
          const res = await getUrl({ data: { id: importId } });
          if (!res.url) {
            toast.error(t("statements.doc.missing"));
            return;
          }
          window.open(res.url, "_blank", "noopener,noreferrer");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
      {size !== "icon" && <span className="ml-1">{label ?? t("statements.doc.open")}</span>}
    </Button>
  );
}

/** Shows the statement a transaction was matched on, with links to it. */
export function TransactionStatementRow({ transactionId }: { transactionId: string }) {
  const { t } = useI18n();
  const refsFn = useServerFn(getStatementRefsForTransactions);
  const q = useQuery({
    queryKey: ["statement_ref", transactionId],
    queryFn: () => refsFn({ data: { transaction_ids: [transactionId] } }),
  });
  const ref = q.data?.refs?.[0];
  if (!ref) return null;

  const period = [ref.period_from, ref.period_to].filter(Boolean).join(" – ");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3 text-sm">
      <FileText className="h-4 w-4 text-muted-foreground" />
      <span className="min-w-0 break-all font-medium">{ref.file_name}</span>
      {period && <span className="text-xs text-muted-foreground">{period}</span>}
      <span className="text-xs text-muted-foreground">#{ref.line_no}</span>
      <div className="ml-auto flex items-center gap-2">
        <StatementDocButton importId={ref.import_id} hasDocument={ref.file_source !== "none"} />
        <Button asChild size="sm" variant="ghost">
          <Link to="/statements" search={{ import: ref.import_id }}>
            {t("statements.doc.open_import")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
