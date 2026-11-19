import * as React from "react";
import { format, parseISO } from "date-fns";
import { FilePenLine, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { useDateFormat } from "@/lib/dateFormat";
import { fmtMoney, type Account, type Category, type PendingTransaction } from "@/lib/finance";
import { formatCoords } from "@/lib/location";
import {
  changedFields,
  originalValues,
  type PendingField,
  type PendingValues,
} from "@/lib/pendingEdits";

const LABEL_KEY: Record<PendingField, string> = {
  type: "common.type",
  amount: "statements.table.col.amount",
  occurred_on: "statements.table.col.date",
  description: "statements.table.col.description",
  note: "pending.table.col.note",
  category_id: "statements.table.col.category",
  source_account_id: "add.account",
  destination_account_id: "add.to_account",
  destination_amount: "pending.original.dest_amount",
  location: "loc.title",
};

/**
 * Shown only on a row someone changed: the values it arrived with, for the
 * fields that differ, and one button that puts the whole row back.
 */
export function PendingOriginalPopover({
  p,
  current,
  accounts,
  categories,
  symbol,
  onRestore,
  className,
}: {
  p: PendingTransaction;
  current: PendingValues;
  accounts: Account[];
  categories: Category[];
  symbol: string;
  onRestore: (original: PendingValues) => void;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const dateFmt = useDateFormat();
  const [open, setOpen] = React.useState(false);
  const changed = changedFields(p, current);
  const orig = originalValues(p);
  if (!orig || changed.length === 0) return null;

  const empty = <span className="italic text-muted-foreground">{t("pending.original.empty")}</span>;
  const show = (f: PendingField): React.ReactNode => {
    switch (f) {
      case "type":
        return t(`add.${orig.type}`);
      case "destination_account_id":
        return orig.destination_account_id
          ? (accounts.find((a) => a.id === orig.destination_account_id)?.name ?? "?")
          : empty;
      case "destination_amount": {
        if (!orig.destination_amount) return empty;
        const dest = accounts.find((a) => a.id === orig.destination_account_id);
        return fmtMoney(Number(orig.destination_amount), dest?.currency_symbol ?? symbol);
      }
      case "amount": {
        const acc = accounts.find((a) => a.id === orig.source_account_id);
        return fmtMoney(Number(orig.amount), acc?.currency_symbol ?? symbol);
      }
      case "occurred_on":
        return orig.occurred_on ? format(parseISO(orig.occurred_on), dateFmt, { locale }) : empty;
      case "category_id":
        return orig.category_id
          ? (categories.find((c) => c.id === orig.category_id)?.name ?? "?")
          : empty;
      case "source_account_id":
        return accounts.find((a) => a.id === orig.source_account_id)?.name ?? "?";
      case "location":
        return orig.location ? (orig.location.label ?? formatCoords(orig.location)) : empty;
      default:
        return orig[f].trim() ? orig[f] : empty;
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-amber-600 hover:bg-muted dark:text-amber-400 ${className ?? ""}`}
          title={t("pending.original.changed")}
          aria-label={t("pending.original.changed")}
        >
          <FilePenLine className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3 text-xs">
        <p className="mb-2 font-medium">{t("pending.original.title")}</p>
        <dl className="space-y-1">
          {changed.map((f) => (
            <div key={f} className="grid grid-cols-[80px_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">{t(LABEL_KEY[f])}</dt>
              <dd className="break-words">{show(f)}</dd>
            </div>
          ))}
        </dl>
        <Button
          size="sm"
          variant="outline"
          className="mt-3 h-7 w-full"
          onClick={() => {
            onRestore(orig);
            setOpen(false);
          }}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          {t("pending.original.restore")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
