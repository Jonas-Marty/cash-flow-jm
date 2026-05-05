import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  fetchPendingTransactions,
  fetchAccounts,
  fmtMoney,
} from "@/lib/finance";
import { useI18n } from "@/i18n";
import { Inbox } from "lucide-react";

export function PendingConfirmationsCard({ symbol }: { symbol: string }) {
  const { t, locale } = useI18n();
  const pendingQ = useQuery({
    queryKey: ["pending_transactions", "pending"],
    queryFn: () => fetchPendingTransactions("pending"),
  });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

  const items = pendingQ.data ?? [];
  if (pendingQ.isLoading || items.length === 0) return null;

  const accountById = new Map((accountsQ.data ?? []).map((a) => [a.id, a]));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="h-4 w-4" />
            {t("pending.dash.title")}
            <Badge variant="secondary">{items.length}</Badge>
          </CardTitle>
          <Link to="/pending" className="text-xs text-muted-foreground hover:text-foreground">
            {t("common.viewAll")}
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-md border border-border/60">
          {items.slice(0, 5).map((p) => {
            const acc = accountById.get(p.source_account_id);
            const sym = acc?.currency_symbol ?? symbol;
            return (
              <li key={p.id} className="flex flex-wrap items-start gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {p.description || t("pending.row.untitled")}
                    </span>
                    {p.external_source && (
                      <Badge variant="outline" className="text-[10px]">
                        {p.external_source}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {format(parseISO(p.occurred_on), "dd.MM.yyyy", { locale })}
                    {" · "}
                    {acc?.name ?? "?"}
                    {p.external_info && ` · ${p.external_info}`}
                  </div>
                </div>
                <span className="tabular-nums text-sm font-semibold">
                  {fmtMoney(Number(p.amount), sym)}
                </span>
                <Button asChild size="sm" variant="default" className="h-7 px-2 text-xs">
                  <Link to="/pending">{t("pending.review")}</Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}