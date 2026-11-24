import { supabase } from "@/integrations/supabase/client";
import { monthKey, type Category } from "@/lib/finance";

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
