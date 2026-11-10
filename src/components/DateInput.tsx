import * as React from "react";
import { format, parse, parseISO, isValid, addDays, addMonths } from "date-fns";
import type { Locale } from "date-fns";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDateFormat } from "@/lib/dateFormat";
import { useI18n } from "@/i18n";

interface Props {
  value: Date;
  onChange: (d: Date) => void;
  /** Explicit date-fns format string. If omitted, the format from settings. */
  formatStr?: string;
  locale?: Locale;
  className?: string;
  id?: string;
}

/** Locale-aware date input. Parses on blur/Enter; supports keyboard stepping:
 *  +/-, ArrowUp/ArrowDown, j/k → ±1 day · PageUp/PageDown → ±1 month. */
export function DateInput({ value, onChange, formatStr, locale: localeProp, className, id }: Props) {
  const settingFmt = useDateFormat();
  const { locale: uiLocale } = useI18n();
  const locale = localeProp ?? uiLocale;
  const fmtStr = formatStr || settingFmt;
  const [text, setText] = React.useState<string>(() => format(value, fmtStr, { locale }));
  const [invalid, setInvalid] = React.useState(false);

  // Sync external changes (calendar clicks, shortcuts) into the input
  React.useEffect(() => {
    setText(format(value, fmtStr, { locale }));
    setInvalid(false);
  }, [value, fmtStr]);

  const commit = () => {
    const parsed = parse(text, fmtStr, new Date(), { locale });
    if (isValid(parsed)) {
      setInvalid(false);
      setText(format(parsed, fmtStr, { locale }));
      if (parsed.getTime() !== value.getTime()) onChange(parsed);
    } else {
      setInvalid(true);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "+" || e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      onChange(addDays(value, 1));
    } else if (e.key === "-" || e.key === "_" || e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      onChange(addDays(value, -1));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      onChange(addMonths(value, 1));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      onChange(addMonths(value, -1));
    }
  };

  return (
    <Input
      id={id}
      value={text}
      onChange={(e) => { setText(e.target.value); setInvalid(false); }}
      onBlur={commit}
      onKeyDown={onKeyDown}
      placeholder={fmtStr}
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      className={cn("tabular-nums", invalid && "border-destructive focus-visible:ring-destructive", className)}
      aria-invalid={invalid || undefined}
    />
  );
}
/** DateInput for a "yyyy-MM-dd" string, as dates are stored. */
export function IsoDateInput({ value, onChange, ...rest }: Omit<Props, "value" | "onChange"> & { value: string; onChange: (iso: string) => void }) {
  const date = React.useMemo(() => {
    const d = value ? parseISO(value) : new Date();
    return isValid(d) ? d : new Date();
  }, [value]);
  return <DateInput {...rest} value={date} onChange={(d) => onChange(format(d, "yyyy-MM-dd"))} />;
}
