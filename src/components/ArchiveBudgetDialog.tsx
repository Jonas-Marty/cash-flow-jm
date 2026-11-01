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
import { supabase } from "@/integrations/supabase/client";
import { fmtMoney, monthKey, type Category } from "@/lib/finance";

export interface ArchiveImpact {
  category: Category;
  /** Bookings on the budget in the current month. */
  bookings: number;
  /** The plan stored for the current month; 0 when there is none. */
  plan: number;
}

/**
 * What archiving a budget would leave behind in the current month, or null when
 * nothing: then it can be archived without asking.
 */
export async function archiveImpact(
  category: Category,
  today = new Date(),
): Promise<ArchiveImpact | null> {
  const month = monthKey(today);
  const next = monthKey(new Date(today.getFullYear(), today.getMonth() + 1, 1));
  const [tx, plan] = await Promise.all([
    supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("category_id", category.id)
      .gte("occurred_on", month)
      .lt("occurred_on", next),
    category.is_scope
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from("category_budgets")
          .select("amount")
          .eq("category_id", category.id)
          .eq("month", month)
          .maybeSingle(),
  ]);
  if (tx.error) throw tx.error;
  if (plan.error) throw plan.error;
  const bookings = tx.count ?? 0;
  const amount = Number(plan.data?.amount ?? 0);
  if (bookings === 0 && Math.abs(amount) < 0.005) return null;
  return { category, bookings, plan: amount };
}

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
