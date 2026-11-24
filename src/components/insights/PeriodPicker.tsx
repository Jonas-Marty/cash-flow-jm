import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/i18n";
import type { PeriodKey } from "@/lib/period";

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
