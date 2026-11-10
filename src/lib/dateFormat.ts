import { useQuery } from "@tanstack/react-query";
import { fetchSettings } from "@/lib/finance";

export const DEFAULT_DATE_FORMAT = "dd.MM.yyyy";

/** The date format chosen in settings — every date field and full date reads this way. */
export function useDateFormat(): string {
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  return settingsQ.data?.date_format || DEFAULT_DATE_FORMAT;
}
