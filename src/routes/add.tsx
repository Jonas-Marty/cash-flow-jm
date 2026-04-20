import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { CalendarIcon, ArrowDown, ArrowUp, ArrowLeftRight } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fetchAccounts, fetchCategories, fetchSettings, fetchTransactions, extractTags, type TxType } from "@/lib/finance";

export const Route = createFileRoute("/add")({
  component: AddTransaction,
});

function AddTransaction() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const recentQ = useQuery({ queryKey: ["transactions", "recent"], queryFn: () => fetchTransactions(50) });

  const accounts = (accountsQ.data ?? []).filter((a) => !a.archived);
  const categories = (categoriesQ.data ?? []).filter((c) => !c.archived);
  const symbol = settingsQ.data?.currency_symbol ?? "CHF";

  const [type, setType] = React.useState<TxType>("expense");
  const [amount, setAmount] = React.useState("");
  const [sourceId, setSourceId] = React.useState<string>("");
  const [destId, setDestId] = React.useState<string>("");
  const [categoryId, setCategoryId] = React.useState<string>("");
  const [payee, setPayee] = React.useState("");
  const [note, setNote] = React.useState("");
  const [date, setDate] = React.useState<Date>(new Date());
  const [saving, setSaving] = React.useState(false);

  // Default source = most-used account in recent transactions
  React.useEffect(() => {
    if (sourceId || accounts.length === 0) return;
    const counts = new Map<string, number>();
    (recentQ.data ?? []).forEach((t) => counts.set(t.source_account_id, (counts.get(t.source_account_id) ?? 0) + 1));
    let best = accounts[0]?.id;
    let bestN = -1;
    for (const a of accounts) {
      const n = counts.get(a.id) ?? 0;
      if (n > bestN) { bestN = n; best = a.id; }
    }
    if (best) setSourceId(best);
  }, [accounts, recentQ.data, sourceId]);

  const tags = extractTags(note);
  const payeeSuggestions = React.useMemo(() => {
    const set = new Set<string>();
    (recentQ.data ?? []).forEach((t) => { if (t.payee) set.add(t.payee); });
    return Array.from(set).slice(0, 50);
  }, [recentQ.data]);

  const reset = () => {
    setAmount(""); setPayee(""); setNote(""); setCategoryId("");
    setDate(new Date());
  };

  const save = async (andNew: boolean) => {
    const amt = Number(amount.replace(",", "."));
    if (!amt || amt <= 0) { toast.error("Enter an amount"); return; }
    if (!sourceId) { toast.error("Pick an account"); return; }
    if (type === "transfer" && !destId) { toast.error("Pick a destination account"); return; }
    if (type === "transfer" && destId === sourceId) { toast.error("Source and destination must differ"); return; }

    setSaving(true);
    const payload = {
      occurred_on: format(date, "yyyy-MM-dd"),
      amount: amt,
      payee: payee.trim() || null,
      note: note.trim() || null,
      type,
      source_account_id: sourceId,
      destination_account_id: type === "transfer" ? destId : null,
      category_id: type === "transfer" ? null : (categoryId || null),
    };
    const { error } = await supabase.from("transactions").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    qc.invalidateQueries();
    if (andNew) reset(); else navigate({ to: "/" });
  };

  const typeBtn = (t: TxType, label: string, Icon: typeof ArrowDown) => (
    <button
      type="button"
      onClick={() => setType(t)}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        type === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );

  return (
    <AppShell>
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">Add transaction</h1>

        {/* Type segmented control */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {typeBtn("expense", "Expense", ArrowDown)}
          {typeBtn("income", "Income", ArrowUp)}
          {typeBtn("transfer", "Transfer", ArrowLeftRight)}
        </div>

        {/* Big amount */}
        <Card>
          <CardContent className="py-6">
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{symbol}</div>
              <Input
                inputMode="decimal"
                autoFocus
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))}
                className={cn(
                  "mt-1 h-auto border-0 bg-transparent p-0 text-center text-5xl font-bold tabular-nums shadow-none focus-visible:ring-0",
                  type === "expense" && "text-destructive",
                  type === "income" && "text-success",
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Account(s) */}
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 block">{type === "transfer" ? "From account" : "Account"}</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger><SelectValue placeholder={accounts.length ? "Select account" : "No accounts — add one in Settings"} /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name} <span className="text-muted-foreground">· {a.type}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
            {accounts.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                <Link to="/settings" className="text-primary underline-offset-2 hover:underline">Create your first account →</Link>
              </p>
            )}
          </div>

          {type === "transfer" && (
            <div>
              <Label className="mb-1.5 block">To account</Label>
              <Select value={destId} onValueChange={setDestId}>
                <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                <SelectContent>
                  {accounts.filter((a) => a.id !== sourceId).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name} <span className="text-muted-foreground">· {a.type}</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {type !== "transfer" && (
            <div>
              <Label className="mb-1.5 block">
                Category {type === "income" && <span className="text-xs font-normal text-muted-foreground">(optional — assign for reimbursement)</span>}
              </Label>
              <Select value={categoryId || "__none"} onValueChange={(v) => setCategoryId(v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="payee" className="mb-1.5 block">Payee</Label>
          <Input
            id="payee"
            list="payee-suggestions"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            placeholder={type === "transfer" ? "(optional)" : "Where / who"}
          />
          <datalist id="payee-suggestions">
            {payeeSuggestions.map((p) => <option key={p} value={p} />)}
          </datalist>
        </div>

        <div>
          <Label htmlFor="note" className="mb-1.5 block">Note · use #tags to filter later</Label>
          <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. dinner with friends #twint #paris" />
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">#{t}</span>
              ))}
            </div>
          )}
        </div>

        <div>
          <Label className="mb-1.5 block">Date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-left font-normal">
                <CalendarIcon className="h-4 w-4" /> {format(date, "PPP")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} initialFocus className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" disabled={saving} onClick={() => save(true)}>Save & New</Button>
          <Button className="flex-1" disabled={saving} onClick={() => save(false)}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </AppShell>
  );
}
