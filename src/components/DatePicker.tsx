import * as React from "react";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDateFormat } from "@/lib/dateFormat";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateInput } from "@/components/DateInput";

interface DatePickerProps {
  value: Date | null;
  onChange: (d: Date | null) => void;
  /** Explicit date-fns format string. If omitted, the format from settings. */
  formatStr?: string;
  locale?: Locale;
  placeholder?: string;
  id?: string;
  className?: string;
  clearLabel?: string;
}

/** Date input with an attached calendar popover. Keeps full keyboard editing. */
export function DatePicker({
  value,
  onChange,
  formatStr,
  locale,
  placeholder,
  id,
  className,
  clearLabel = "Clear",
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const settingFmt = useDateFormat();
  const { locale: uiLocale } = useI18n();
  const fmt = formatStr || settingFmt;

  const handleSelect = (d: Date | undefined) => {
    if (!d) return;
    onChange(d);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("flex items-center gap-1", className)}>
        {value ? (
          <>
            <DateInput
              id={id}
              value={value}
              onChange={onChange}
              formatStr={formatStr}
              locale={locale}
              className="flex-1"
            />
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="Open calendar"
              >
                <CalendarIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => onChange(null)}
              aria-label={clearLabel}
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <PopoverTrigger asChild>
            <Button
              type="button"
              id={id}
              variant="outline"
              className="h-9 w-full justify-start font-normal text-muted-foreground"
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {placeholder ?? format(new Date(), fmt, { locale: locale ?? uiLocale })}
            </Button>
          </PopoverTrigger>
        )}
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ?? undefined}
          onSelect={handleSelect}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}
