import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, addMonths } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fetchCategories, fetchSettings, fmtMoney, type Transaction } from "@/lib/finance";

export const Route = createFileRoute("/envelopes")({
  component: EnvelopesPage,
});

async function fetchMonthCategoryTx(monthStart: Date): Promise<Transaction[]> {
  const from = format(startOfMonth(monthStart), "yyyy-MM-dd");
  const to = format(endOfMonth(monthStart), "yyyy-MM-dd");
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .gte("occurred_on", from)
    .lte("occurred_on", to)
    .not("category_id", "is", null)
    .order("occurred_on", { ascending: false });
  if (error) throw error;
  return (data || []) as Transaction[];
}

function EnvelopesPage() {
  const [month, setMonth] = React.useState(() => startOfMonth(new Date()));
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const txQ = useQuery({
    queryKey: ["envelope_month_tx", format(month, "yyyy-MM")],
    queryFn: () => fetchMonthCategoryTx(month),
  });

  const symbol = settingsQ.data?.currency_symbol ?? "CHF";
  const categories = (categoriesQ.data ?? []).filter((c) => !c.archived);
  const txs = txQ.data ?? [];

  const byCategory = new Map<string, Transaction[]>();
  txs.forEach((t) => {
    if (!t.category_id) return;
    const arr = byCategory.get(t.category_id) ?? [];
    arr.push(t);
    byCategory.set(t.category_id, arr);
  });

  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Envelopes</h1>

        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="font-medium">{format(month, "MMMM yyyy")}</div>
          <Button variant="outline" size="sm" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {categoriesQ.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : categories.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            No envelopes yet. <Link to="/settings" className="text-primary underline-offset-2 hover:underline">Create one in Settings</Link>.
          </CardContent></Card>
        ) : categories.map((c) => {
          const items = byCategory.get(c.id) ?? [];
          const spent = items.reduce((s, t) => s + (t.type === "expense" ? Number(t.amount) : t.type === "income" ? -Number(t.amount) : 0), 0);
          const allocated = Number(c.allocated_budget);
          const pct = allocated > 0 ? Math.min(100, (spent / allocated) * 100) : (spent > 0 ? 100 : 0);
          const over = allocated > 0 && spent > allocated;
          const remaining = allocated - spent;
          const barTone = over ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-success";
          return (
            <Card key={c.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-sm tabular-nums text-muted-foreground">
                    <span className={cn(over && "text-destructive font-semibold")}>{fmtMoney(spent, symbol)}</span>
                    <span> / {fmtMoney(allocated, symbol)}</span>
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full transition-all", barTone)} style={{ width: `${pct}%` }} />
                </div>
                <div className={cn("text-xs tabular-nums", over ? "text-destructive" : "text-muted-foreground")}>
                  {over ? `Over by ${fmtMoney(-remaining, symbol)}` : `${fmtMoney(remaining, symbol)} remaining`}
                </div>
                {items.length > 0 && (
                  <ul className="divide-y border-t pt-2">
                    {items.map((t) => {
                      const isReimb = t.type === "income";
                      return (
                        <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{t.payee || (isReimb ? "Reimbursement" : "Expense")}
                              {isReimb && <span className="ml-2 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-success">Reimb.</span>}
                            </div>
                            <div className="text-xs text-muted-foreground">{format(new Date(t.occurred_on), "MMM d")}</div>
                          </div>
                          <div className={cn("tabular-nums font-medium", isReimb ? "text-success" : "text-destructive")}>
                            {isReimb ? "+" : "-"}{fmtMoney(Number(t.amount), symbol).replace("-", "")}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
