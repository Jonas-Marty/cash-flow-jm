import { ArrowDown, ArrowLeftRight, ArrowUp, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import type { TxType } from "@/lib/finance";
import { TYPE_TEXT } from "@/lib/txTypeStyle";

/** Same icons as the type tabs on /add. */
const ICON = { expense: ArrowDown, income: ArrowUp, transfer: ArrowLeftRight } as const;

const TYPES: TxType[] = ["expense", "income", "transfer"];

/** The type of a /pending row, as an icon in front of its amount. */
export function PendingTypeMenu({
  value,
  onChange,
  className,
}: {
  value: TxType;
  onChange: (type: TxType) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const Icon = ICON[value];
  const label = t(`add.${value}`);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={`h-8 w-8 shrink-0 p-0 ${TYPE_TEXT[value]} ${className ?? ""}`}
          title={`${t("common.type")}: ${label}`}
          aria-label={`${t("common.type")}: ${label}`}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {TYPES.map((ty) => {
          const ItemIcon = ICON[ty];
          return (
            <DropdownMenuItem key={ty} onSelect={() => ty !== value && onChange(ty)}>
              <ItemIcon className={`mr-2 h-4 w-4 ${TYPE_TEXT[ty]}`} />
              <span className="flex-1">{t(`add.${ty}`)}</span>
              {ty === value ? <Check className="h-4 w-4" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
