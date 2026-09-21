import * as React from "react";
import { addMonths, format, isSameMonth, setMonth as setMonthOfYear, startOfMonth } from "date-fns";
import type { Locale } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

/**
 * Month stepper with a picker on the label.
 *
 * The label opens a year stepper and a twelve-month grid rather than the `Calendar`
 * component, which is day-granular — picking "January" should not require choosing a
 * day, and a grid of twelve buttons is the same interaction on a phone as on a desktop.
 *
 * Deliberately unbounded in both directions: every month's budget is editable, so
 * there is nothing to disable.
 */
export function MonthNavigator({
  month,
  onChange,
  locale,
  className,
}: {
  month: Date;
  onChange: (d: Date) => void;
  locale?: Locale;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [year, setYear] = React.useState(() => month.getFullYear());

  // Reopening after navigating with the chevrons should land on the year you can see.
  React.useEffect(() => {
    if (open) setYear(month.getFullYear());
  }, [open, month]);

  const today = startOfMonth(new Date());
  const pick = (m: Date) => {
    onChange(startOfMonth(m));
    setOpen(false);
  };

  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <Button
        variant="outline"
        size="sm"
        aria-label={t("env.month.prev")}
        onClick={() => onChange(addMonths(month, -1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="font-medium" aria-label={t("env.month.pick")}>
            {format(month, "MMMM yyyy", { locale })}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="center">
          <div className="mb-2 flex items-center justify-between">
            <Button variant="ghost" size="sm" aria-label={t("env.month.prev_year")} onClick={() => setYear((y) => y - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-medium tabular-nums">{year}</div>
            <Button variant="ghost" size="sm" aria-label={t("env.month.next_year")} onClick={() => setYear((y) => y + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 12 }, (_, i) => {
              const candidate = setMonthOfYear(new Date(year, 0, 1), i);
              const selected = isSameMonth(candidate, month);
              const current = isSameMonth(candidate, today);
              return (
                <Button
                  key={i}
                  variant={selected ? "default" : "ghost"}
                  size="sm"
                  className={cn("text-xs", !selected && current && "ring-1 ring-inset ring-border")}
                  onClick={() => pick(candidate)}
                >
                  {format(candidate, "MMM", { locale })}
                </Button>
              );
            })}
          </div>

          {!isSameMonth(month, today) && (
            <Button variant="ghost" size="sm" className="mt-2 w-full text-xs" onClick={() => pick(today)}>
              {t("env.month.this_month")}
            </Button>
          )}
        </PopoverContent>
      </Popover>

      <Button
        variant="outline"
        size="sm"
        aria-label={t("env.month.next")}
        onClick={() => onChange(addMonths(month, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
