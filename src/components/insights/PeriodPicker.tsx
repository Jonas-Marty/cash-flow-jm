import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/i18n";

export type PeriodKey =
  | "this_month"
  | "last_month"
  | "ytd"
  | "last_12mo"
  | "last_24mo"
  | "all";

export function periodToRange(p: PeriodKey): { from: string; to: string } {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (p === "this_month") {
    return {
      from: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  }
  if (p === "last_month") {
    return {
      from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: iso(new Date(today.getFullYear(), today.getMonth(), 0)),
    };
  }
  if (p === "ytd") {
    return {
      from: iso(new Date(today.getFullYear(), 0, 1)),
      to: iso(today),
    };
  }
  if (p === "last_12mo") {
    return {
      from: iso(new Date(today.getFullYear() - 1, today.getMonth(), 1)),
      to: iso(today),
    };
  }
  if (p === "last_24mo") {
    return {
      from: iso(new Date(today.getFullYear() - 2, today.getMonth(), 1)),
      to: iso(today),
    };
  }
  return { from: "1970-01-01", to: iso(today) };
}

export function PeriodPicker({
  value,
  onChange,
}: {
  value: PeriodKey;
  onChange: (v: PeriodKey) => void;
}) {
  const { t } = useI18n();
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PeriodKey)}>
      <SelectTrigger className="h-9 w-[180px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="this_month">{t("insights.period.this_month")}</SelectItem>
        <SelectItem value="last_month">{t("insights.period.last_month")}</SelectItem>
        <SelectItem value="ytd">{t("insights.period.ytd")}</SelectItem>
        <SelectItem value="last_12mo">{t("insights.period.last_12mo")}</SelectItem>
        <SelectItem value="last_24mo">{t("insights.period.last_24mo")}</SelectItem>
        <SelectItem value="all">{t("insights.period.all")}</SelectItem>
      </SelectContent>
    </Select>
  );
}