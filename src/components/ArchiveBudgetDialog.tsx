import { format } from "date-fns";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/i18n";
import { fmtMoney } from "@/lib/finance";
import type { ArchiveImpact } from "@/lib/archiveImpact";

/**
 * Asks before archiving a budget that is still in use this month.
 *
 * Archiving takes it out of the month's overview and the month editor, but its
 * bookings stay, and so does the plan already stored for the month: at month end
 * the remainder of a monthly budget is settled as before. Saying so keeps the
 * figures from changing under the user unexpectedly.
 */
export function ArchiveBudgetDialog({
  impact,
  symbol,
  onOpenChange,
  onConfirm,
}: {
  impact: ArchiveImpact | null;
  symbol: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t, locale } = useI18n();
  const month = format(new Date(), "MMMM", { locale });
  const name = impact?.category.name ?? "";
  const hasPlan = !!impact && Math.abs(impact.plan) >= 0.005;
  const usage = !impact
    ? ""
    : impact.bookings > 0 && hasPlan
      ? t("archive_budget.usage_both", {
          n: impact.bookings,
          plan: fmtMoney(impact.plan, symbol),
          month,
        })
      : impact.bookings > 0
        ? t("archive_budget.usage_bookings", { n: impact.bookings, month })
        : t("archive_budget.usage_plan", { plan: fmtMoney(impact.plan, symbol), month });

  return (
    <AlertDialog open={!!impact} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("archive_budget.title", { name })}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{usage}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{t("archive_budget.hidden")}</li>
                {impact && impact.bookings > 0 && <li>{t("archive_budget.bookings_stay")}</li>}
                {hasPlan && !impact?.category.rolls_over && (
                  <li>{t("archive_budget.plan_stays", { month })}</li>
                )}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t("common.archive")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
