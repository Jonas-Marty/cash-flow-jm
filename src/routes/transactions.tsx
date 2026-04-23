import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, ArrowLeftRight, Trash2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import {
  fetchAccounts, fetchCategories, fetchSettings, fetchTransactions, fetchTransactionTags,
  fmtMoney, type TxType,
} from "@/lib/finance";

export const Route = createFileRoute("/transactions")({
  component: TransactionsPage,
});

function TransactionsPage() {
  const { t: tr, locale } = useI18n();
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const txQ = useQuery({ queryKey: ["transactions", "all"], queryFn: () => fetchTransactions() });
  const tagsQ = useQuery({ queryKey: ["transaction_tags"], queryFn: fetchTransactionTags });

  const symbol = settingsQ.data?.currency_symbol ?? "CHF";
  const accountById = new Map((accountsQ.data ?? []).map((a) => [a.id, a]));
  const categoryById = new Map((categoriesQ.data ?? []).map((c) => [c.id, c]));
  const tagsByTx = React.useMemo(() => {
    const m = new Map<string, string[]>();
    (tagsQ.data ?? []).forEach((r) => {
      const arr = m.get(r.transaction_id) ?? [];
      arr.push(r.tag);
      m.set(r.transaction_id, arr);
    });
    return m;
  }, [tagsQ.data]);

  const [filterType, setFilterType] = React.useState<"all" | TxType>("all");
  const [filterAccount, setFilterAccount] = React.useState("all");
  const [filterCategory, setFilterCategory] = React.useState("all");
  const [filterTag, setFilterTag] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  const allTags = React.useMemo(() => {
    const s = new Set<string>();
    (tagsQ.data ?? []).forEach((r) => s.add(r.tag));
    return Array.from(s).sort();
  }, [tagsQ.data]);

  const filtered = (txQ.data ?? []).filter((t) => {
    if (filterType !== "all" && t.type !== filterType) return false;
    if (filterAccount !== "all" && t.source_account_id !== filterAccount && t.destination_account_id !== filterAccount) return false;
    if (filterCategory !== "all" && t.category_id !== filterCategory) return false;
    if (filterTag !== "all" && !(tagsByTx.get(t.id) ?? []).includes(filterTag)) return false;
    if (search && !((t.payee ?? "") + " " + (t.note ?? "")).toLowerCase().includes(search.toLowerCase())) return false;
    if (from && t.occurred_on < from) return false;
    if (to && t.occurred_on > to) return false;
    return true;
  });

  // Group by date
  const groups = React.useMemo(() => {
    const m = new Map<string, typeof filtered>();
    filtered.forEach((t) => {
      const k = t.occurred_on;
      const arr = m.get(k) ?? [];
      arr.push(t);
      m.set(k, arr);
    });
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  const del = async (id: string) => {
    if (!confirm(tr("confirm.delete_transaction"))) return;
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(tr("toast.deleted"));
    qc.invalidateQueries();
  };

  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{tr("tx.title")}</h1>

        <Card><CardContent className="space-y-3 py-4">
          <Input placeholder={tr("tx.search_placeholder")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Select value={filterType} onValueChange={(v) => setFilterType(v as "all" | TxType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tr("tx.all_types")}</SelectItem>
                <SelectItem value="expense">{tr("add.expense")}</SelectItem>
                <SelectItem value="income">{tr("add.income")}</SelectItem>
                <SelectItem value="transfer">{tr("add.transfer")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterAccount} onValueChange={setFilterAccount}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tr("tx.all_accounts")}</SelectItem>
                {(accountsQ.data ?? []).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tr("tx.all_categories")}</SelectItem>
                {(categoriesQ.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterTag} onValueChange={setFilterTag}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tr("tx.all_tags")}</SelectItem>
                {allTags.map((t) => <SelectItem key={t} value={t}>#{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs text-muted-foreground">{tr("common.from")}</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label className="text-xs text-muted-foreground">{tr("common.to")}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        </CardContent></Card>

        {txQ.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : groups.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            {tr("tx.no_match")} <Link to="/add" className="text-primary underline-offset-2 hover:underline">{tr("tx.add_one")}</Link>.
          </CardContent></Card>
        ) : groups.map(([date, items]) => (
          <div key={date}>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{format(new Date(date), "EEE, MMM d, yyyy", { locale })}</div>
            <Card><CardContent className="divide-y p-0">
              {items.map((t) => {
                const Icon = t.type === "expense" ? ArrowDown : t.type === "income" ? ArrowUp : ArrowLeftRight;
                const tone = t.type === "expense" ? "text-destructive" : t.type === "income" ? "text-success" : "text-muted-foreground";
                const sign = t.type === "expense" ? "-" : t.type === "income" ? "+" : "";
                const isReimb = t.type === "income" && !!t.category_id;
                const src = accountById.get(t.source_account_id)?.name ?? "?";
                const dst = t.destination_account_id ? accountById.get(t.destination_account_id)?.name : null;
                const cat = t.category_id ? categoryById.get(t.category_id)?.name : null;
                const tags = tagsByTx.get(t.id) ?? [];
                return (
                  <div key={t.id} className="flex items-start gap-3 px-4 py-3">
                    <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted", tone)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="truncate text-sm font-medium">
                          {t.payee || (t.type === "transfer" ? tr("tx.transfer_label") : t.type === "income" ? tr("add.income") : tr("add.expense"))}
                          {isReimb && <span className="ml-2 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-success">{tr("tx.reimbursement")}</span>}
                        </div>
                        <div className={cn("text-sm font-semibold tabular-nums whitespace-nowrap", tone)}>
                          {sign}{fmtMoney(Number(t.amount), symbol).replace("-", "")}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t.type === "transfer" ? `${src} → ${dst}` : src}{cat ? ` · ${cat}` : ""}
                      </div>
                      {(t.note || tags.length > 0) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {t.note && <span className="text-xs text-muted-foreground">{t.note}</span>}
                          {tags.map((tg) => (
                            <span key={tg} className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">#{tg}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => del(t.id)} aria-label={tr("common.delete")}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </CardContent></Card>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
