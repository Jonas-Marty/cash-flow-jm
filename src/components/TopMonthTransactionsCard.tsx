import * as React from "react";
import { format } from "date-fns";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtMoney, type Transaction, type Account } from "@/lib/finance";
import { useI18n } from "@/i18n";

export function TopMonthTransactionsCard({
  transactions, accountById, symbol, monthStart,
}: {
  transactions: Transaction[];
  accountById: Map<string, Account>;
  symbol: string;
  monthStart: Date;
}) {
  const { t, locale } = useI18n();
  const monthEnd = React.useMemo(
    () => new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1),
    [monthStart],
  );
  const ms = monthStart.getTime();
  const me = monthEnd.getTime();

  const inMonth = transactions.filter((tx) => {
    if (tx.recurring_rule_id) return false;
    if (tx.type !== "expense" && tx.type !== "income") return false;
    const d = new Date(tx.occurred_on).getTime();
    return d >= ms && d < me;
  });
  const expenses = inMonth.filter((t) => t.type === "expense")
    .sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5);
  const incomes = inMonth.filter((t) => t.type === "income")
    .sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5);

  if (expenses.length === 0 && incomes.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t("dashboard.top_month.title")}</CardTitle></CardHeader>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {t("dashboard.top_month.empty")}
        </CardContent>
      </Card>
    );
  }

  const renderList = (
    items: Transaction[],
    kind: "expense" | "income",
  ) => {
    const Icon = kind === "expense" ? ArrowDown : ArrowUp;
    const tone = kind === "expense" ? "text-destructive" : "text-success";
    const sign = kind === "expense" ? "-" : "+";
    if (items.length === 0) {
      return <div className="px-4 py-3 text-sm text-muted-foreground">—</div>;
    }
    return (
      <div className="divide-y">
        {items.map((tx) => {
          const srcAcc = accountById.get(tx.source_account_id);
          const txSym = srcAcc?.currency_symbol ?? symbol;
          return (
            <div key={tx.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className={cn("flex h-8 w-8 items-center justify-center rounded-full bg-muted", tone)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {tx.description || (kind === "income" ? t("add.income") : t("add.expense"))}
                </div>
                <div className="text-xs text-muted-foreground">{format(new Date(tx.occurred_on), "MMM d", { locale })}</div>
              </div>
              <div className={cn("text-sm font-semibold tabular-nums", tone)}>
                {sign}{fmtMoney(Number(tx.amount), txSym).replace("-", "")}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("dashboard.top_month.title")}</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{t("dashboard.top_month.expenses")}</CardTitle></CardHeader>
          <CardContent className="p-0">{renderList(expenses, "expense")}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{t("dashboard.top_month.income")}</CardTitle></CardHeader>
          <CardContent className="p-0">{renderList(incomes, "income")}</CardContent>
        </Card>
      </div>
    </section>
  );
}