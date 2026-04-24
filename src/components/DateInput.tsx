import * as React from "react";
import { format, parse, isValid, addDays, addMonths } from "date-fns";
import type { Locale } from "date-fns";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  value: Date;
  onChange: (d: Date) => void;
  lang: "de" | "en" | string;
  locale?: Locale;
  className?: string;
  id?: string;
}

function fmtFor(lang: string): string {
  return lang === "en" ? "MM/dd/yyyy" : "dd.MM.yyyy";
}

/** Locale-aware date input. Parses on blur/Enter, supports +/- (day) and PageUp/PageDown (month). */
export function DateInput({ value, onChange, lang, locale, className, id }: Props) {
  const fmtStr = fmtFor(lang);
  const [text, setText] = React.useState<string>(() => format(value, fmtStr));
  const [invalid, setInvalid] = React.useState(false);

  // Sync external changes (calendar clicks, shortcuts) into the input
  React.useEffect(() => {
    setText(format(value, fmtStr));
    setInvalid(false);
  }, [value, fmtStr]);

  const commit = () => {
    const parsed = parse(text, fmtStr, new Date(), { locale });
    if (isValid(parsed)) {
      setInvalid(false);
      setText(format(parsed, fmtStr));
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
    } else if (e.key === "+") {
      e.preventDefault();
      onChange(addDays(value, 1));
    } else if (e.key === "-" || e.key === "_") {
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
      placeholder={fmtStr.toLowerCase()}
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      className={cn("w-40 tabular-nums", invalid && "border-destructive focus-visible:ring-destructive", className)}
      aria-invalid={invalid || undefined}
    />
  );
}