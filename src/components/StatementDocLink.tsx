import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { getStatementFileUrl } from "@/utils/statements.functions";

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
