import * as React from "react";
import { DayPicker, type DayButtonProps } from "react-day-picker";
import type { Locale } from "date-fns";
import { format } from "date-fns";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { DayPreview } from "@/components/DayPreview";
import type { Transaction, Account, Category } from "@/lib/finance";

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Bucket = "expHi" | "expLo" | "incHi" | "incLo" | "neutral" | null;

function bucketFor(net: number, count: number, threshold: number): Bucket {
  if (count === 0) return null;
  if (net === 0) return "neutral";
  if (net < 0) return Math.abs(net) > threshold ? "expHi" : "expLo";
  return net > threshold ? "incHi" : "incLo";
}

const bucketClass: Record<Exclude<Bucket, null>, string> = {
  expHi: "bg-destructive/35 hover:bg-destructive/40",
  expLo: "bg-destructive/15 hover:bg-destructive/20",
  incHi: "bg-success/35 hover:bg-success/40",
  incLo: "bg-success/15 hover:bg-success/20",
  neutral: "bg-muted/60 hover:bg-muted/70",
};

const LONG_PRESS_MS = 500;

interface Props {
  selected: Date;
  onSelect: (d: Date) => void;
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  threshold: number;
  symbol: string;
  locale?: Locale;
  labels: { title: string; empty: string; net: string };
  className?: string;
}

export function DayHeatmapCalendar({
  selected, onSelect, transactions, accounts, categories,
  threshold, symbol, locale, labels, className,
}: Props) {
  const [month, setMonth] = React.useState<Date>(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  React.useEffect(() => {
    setMonth((m) =>
      m.getFullYear() === selected.getFullYear() && m.getMonth() === selected.getMonth()
        ? m
        : new Date(selected.getFullYear(), selected.getMonth(), 1),
    );
  }, [selected]);

  const handleMonthChange = React.useCallback((m: Date) => {
    console.log("onMonthChange", m);
    setMonth(m);
  }, []);
  const handlePrevClick = React.useCallback(() => {
    console.log("prev click");
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }, []);
  const handleNextClick = React.useCallback(() => {
    console.log("next click");
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }, []);

  const byDay = React.useMemo(() => {
    const m = new Map<string, { net: number; count: number; txs: Transaction[] }>();
    for (const t of transactions) {
      const k = t.occurred_on; // YYYY-MM-DD already
      const entry = m.get(k) ?? { net: 0, count: 0, txs: [] };
      entry.txs.push(t);
      entry.count += 1;
      if (t.type === "income") entry.net += Number(t.amount);
      else if (t.type === "expense") entry.net -= Number(t.amount);
      m.set(k, entry);
    }
    return m;
  }, [transactions]);

  const DayButton = React.useCallback(
    ({ day, modifiers, className: btnCls, ...rest }: DayButtonProps) => {
      const date = day.date;
      const k = dayKey(date);
      const entry = byDay.get(k);
      const bucket = bucketFor(entry?.net ?? 0, entry?.count ?? 0, threshold);
      const tint = bucket ? bucketClass[bucket] : "";

      const [open, setOpen] = React.useState(false);
      const timer = React.useRef<number | null>(null);
      const longPressed = React.useRef(false);

      const startPress = () => {
        longPressed.current = false;
        timer.current = window.setTimeout(() => {
          longPressed.current = true;
          setOpen(true);
        }, LONG_PRESS_MS);
      };
      const cancelPress = () => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      };

      return (
        <HoverCard open={open} onOpenChange={setOpen} openDelay={250} closeDelay={100}>
          <HoverCardTrigger asChild>
            <button
              {...rest}
              type="button"
              data-selected-single={modifiers.selected || undefined}
              data-today={modifiers.today || undefined}
              onPointerDown={(e) => { rest.onPointerDown?.(e); startPress(); }}
              onPointerUp={(e) => { rest.onPointerUp?.(e); cancelPress(); }}
              onPointerLeave={(e) => { rest.onPointerLeave?.(e as never); cancelPress(); }}
              onPointerCancel={(e) => { rest.onPointerCancel?.(e as never); cancelPress(); }}
              onPointerMove={(e) => { rest.onPointerMove?.(e as never); cancelPress(); }}
              onClick={(e) => {
                if (longPressed.current) { e.preventDefault(); e.stopPropagation(); longPressed.current = false; return; }
                rest.onClick?.(e);
              }}
              className={cn(
                "relative flex aspect-square w-full items-center justify-center rounded-md text-sm transition-colors",
                "hover:ring-1 hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[selected-single=true]:font-semibold",
                "data-[today=true]:ring-1 data-[today=true]:ring-primary/40",
                modifiers.outside && "text-muted-foreground/60",
                modifiers.disabled && "opacity-40",
                !modifiers.selected && tint,
                btnCls as string,
              )}
            >
              {format(date, "d")}
              {entry && entry.count > 0 && !modifiers.selected && (
                <span className="pointer-events-none absolute bottom-0.5 right-1 text-[9px] font-medium tabular-nums opacity-70">
                  {entry.count}
                </span>
              )}
            </button>
          </HoverCardTrigger>
          <HoverCardContent side="top" align="center" className="w-72 p-3">
            <DayPreview
              date={date}
              txs={entry?.txs ?? []}
              accounts={accounts}
              categories={categories}
              symbol={symbol}
              locale={locale}
              labels={labels}
            />
          </HoverCardContent>
        </HoverCard>
      );
    },
    [byDay, threshold, accounts, categories, symbol, locale, labels],
  );

  return (
    <div className={cn("rounded-lg border bg-card p-2 md:mx-auto md:max-w-sm", className)}>
      <DayPicker
        mode="single"
        selected={selected}
        onSelect={(d) => d && onSelect(d)}
        month={month}
        onMonthChange={handleMonthChange}
        onPrevClick={handlePrevClick}
        onNextClick={handleNextClick}
        locale={locale}
        showOutsideDays
        weekStartsOn={1}
        className="pointer-events-auto"
        classNames={{
          months: "relative flex flex-col",
          month: "space-y-2",
          month_caption: "flex h-8 items-center justify-center px-8 text-sm font-medium",
          caption_label: "select-none",
          nav: "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1 px-2",
          button_previous: "h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
          button_next: "h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
          month_grid: "w-full border-collapse",
          weekdays: "flex",
          weekday: "flex-1 text-center text-[10px] font-medium uppercase text-muted-foreground py-1",
          week: "flex gap-0.5 mt-0.5",
          day: "flex-1 p-0",
        }}
        components={{
          DayButton,
          Chevron: ({ className, orientation, ...props }) => {
            if (orientation === "left") {
              return <ChevronLeftIcon className={cn("size-4", className)} {...props} />;
            }
            if (orientation === "right") {
              return <ChevronRightIcon className={cn("size-4", className)} {...props} />;
            }
            return <ChevronDownIcon className={cn("size-4", className)} {...props} />;
          },
        }}
      />
    </div>
  );
}