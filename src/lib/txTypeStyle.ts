import type { TxType } from "@/lib/finance";

/** Same colours as the amount on /add: red out, green in, neutral between accounts. */
export const TYPE_TEXT: Record<TxType, string> = {
  expense: "text-destructive",
  income: "text-success",
  transfer: "text-muted-foreground",
};
