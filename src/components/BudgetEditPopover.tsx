import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { setCategoryBudget, monthKey, type BudgetScope } from "@/lib/finance";
import { monthStatus } from "@/lib/month";
import { useI18n } from "@/i18n";
import { invalidateBudgetQueries } from "@/lib/budgetQueries";

/**
 * The one budget editor. Used from the envelope rows on /envelopes and from the
 * envelope list in Settings, so the scope choice is learned once.
 *
 * The header names both the envelope and the month on purpose: the whole point of
 * the feature is editing a month you are not currently living in, and "Groceries"
 * alone would not say which one.
 */
export function BudgetEditPopover({
  categoryId,
  categoryName,
  month,
  amount,
  locale,
  children,
}: {
  categoryId: string;
  categoryName: string;
  month: Date;
  amount: number;
  locale?: Locale;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(() => String(amount));
  const [scope, setScope] = React.useState<BudgetScope>("forward");
  const [saving, setSaving] = React.useState(false);

  const status = monthStatus(month);
  const elapsed = status === "past";
  const monthLabel = format(month, "MMMM yyyy", { locale });

  // Reset on each open: the row's value may have changed underneath, and the default
  // scope depends on the month. A correction to a month that has already closed is
  // normally a one-off; a change to this month or a future one is the new plan.
  React.useEffect(() => {
    if (!open) return;
    setValue(String(amount));
    setScope(elapsed ? "month" : "forward");
  }, [open, amount, elapsed]);

  const save = async () => {
    const next = Number(value.replace(",", "."));
    if (!Number.isFinite(next)) {
      toast.error(t("budget.edit.invalid"));
      return;
    }
    setSaving(true);
    try {
      await setCategoryBudget(categoryId, monthKey(month), next, scope);
      await invalidateBudgetQueries(qc);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 space-y-3 p-3" align="end">
        <div>
          <div className="text-sm font-semibold">{categoryName}</div>
          <div className="text-xs text-muted-foreground">{monthLabel}</div>
        </div>

        <div>
          <Label htmlFor="budget-amount" className="mb-1 block text-xs text-muted-foreground">
            {t("settings.monthly_budget")}
          </Label>
          <Input
            id="budget-amount"
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void save(); }
            }}
            className="text-right tabular-nums"
          />
        </div>

        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">{t("budget.edit.scope")}</Label>
          <ToggleGroup
            type="single"
            value={scope}
            onValueChange={(v) => { if (v) setScope(v as BudgetScope); }}
            variant="outline"
            size="sm"
            className="grid grid-cols-2 gap-1"
          >
            <ToggleGroupItem value="month" className="h-auto whitespace-normal py-1.5 text-xs leading-tight">
              {t("budget.edit.scope.month", { month: monthLabel })}
            </ToggleGroupItem>
            <ToggleGroupItem value="forward" className="h-auto whitespace-normal py-1.5 text-xs leading-tight">
              {t("budget.edit.scope.forward")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {elapsed && (
          <p className="rounded-md bg-warning/10 p-2 text-[11px] leading-snug text-muted-foreground">
            {t("budget.edit.past_warning")}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
