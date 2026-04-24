import * as React from "react";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { ArrowDown, ArrowUp, ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney, type Transaction, type Account, type Category } from "@/lib/finance";

interface Props {
  date: Date;
  txs: Transaction[];
  accounts: Account[];
  categories: Category[];
  symbol: string;
  locale?: Locale;
  labels: { title: string; empty: string; net: string };
}

export function DayPreview({ date, txs, accounts, categories, symbol, locale, labels }: Props) {
  const accById = React.useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const catById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const net = txs.reduce((s, t) => {
    if (t.type === "income") return s + Number(t.amount);
    if (t.type === "expense") return s - Number(t.amount);
    return s;
  }, 0);

  const dateLabel = format(date, "PPP", { locale });

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-baseline justify-between gap-3 border-b pb-1.5">
        <div className="font-medium">{dateLabel}</div>
        {txs.length > 0 && (
          <div className={cn("text-xs tabular-nums", net > 0 ? "text-success" : net < 0 ? "text-destructive" : "text-muted-foreground")}>
            {labels.net}: {fmtMoney(net, symbol)}
          </div>
        )}
      </div>
      {txs.length === 0 ? (
        <div className="text-xs text-muted-foreground">{labels.empty}</div>
      ) : (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto">
          {txs.map((t) => {
            const Icon = t.type === "income" ? ArrowUp : t.type === "expense" ? ArrowDown : ArrowLeftRight;
            const sign = t.type === "income" ? "+" : t.type === "expense" ? "−" : "";
            const tone = t.type === "income" ? "text-success" : t.type === "expense" ? "text-destructive" : "text-muted-foreground";
            const acc = accById.get(t.source_account_id);
            const cat = t.category_id ? catById.get(t.category_id) : null;
            const sub = [cat?.name, acc?.name].filter(Boolean).join(" · ");
            return (
              <li key={t.id} className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-1.5">
                  <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone)} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{t.payee || t.note || sub || "—"}</div>
                    {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
                  </div>
                </div>
                <div className={cn("shrink-0 tabular-nums", tone)}>
                  {sign}{fmtMoney(Number(t.amount), symbol).replace(/^-/, "")}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}