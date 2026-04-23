import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, ArchiveRestore, Archive } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAccounts, fetchCategories, fetchCategoryGroups, fetchSettings,
  type AccountType, type GroupKind,
} from "@/lib/finance";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const CURRENCIES: { code: string; symbol: string }[] = [
  { code: "CHF", symbol: "CHF" },
  { code: "EUR", symbol: "€" },
  { code: "USD", symbol: "$" },
  { code: "GBP", symbol: "£" },
  { code: "JPY", symbol: "¥" },
  { code: "CAD", symbol: "C$" },
  { code: "AUD", symbol: "A$" },
];

function SettingsPage() {
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const groupsQ = useQuery({ queryKey: ["category_groups"], queryFn: fetchCategoryGroups });

  // Currency
  const setCurrency = async (code: string) => {
    const sym = CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
    if (!settingsQ.data) return;
    const { error } = await supabase
      .from("settings")
      .update({ currency_code: code, currency_symbol: sym })
      .eq("id", settingsQ.data.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Currency updated");
    qc.invalidateQueries({ queryKey: ["settings"] });
  };

  // Account form
  const [aName, setAName] = React.useState("");
  const [aType, setAType] = React.useState<AccountType>("asset");
  const [aOpening, setAOpening] = React.useState("0");
  const addAccount = async () => {
    if (!aName.trim()) { toast.error("Name required"); return; }
    const { error } = await supabase.from("accounts").insert({
      name: aName.trim(), type: aType, opening_balance: Number(aOpening) || 0,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Account added");
    setAName(""); setAOpening("0");
    qc.invalidateQueries();
  };
  const toggleArchiveAccount = async (id: string, archived: boolean) => {
    const { error } = await supabase.from("accounts").update({ archived: !archived }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();
  };
  const delAccount = async (id: string) => {
    if (!confirm("Delete this account? Its transactions must be removed first.")) return;
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries();
  };

  // Category form
  const [cName, setCName] = React.useState("");
  const [cBudget, setCBudget] = React.useState("0");
  const addCategory = async () => {
    if (!cName.trim()) { toast.error("Name required"); return; }
    const sortOrder = (categoriesQ.data ?? []).length;
    const { error } = await supabase.from("categories").insert({
      name: cName.trim(), allocated_budget: Number(cBudget) || 0, sort_order: sortOrder,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Envelope added");
    setCName(""); setCBudget("0");
    qc.invalidateQueries();
  };
  const updateCategoryBudget = async (id: string, value: string) => {
    const v = Number(value); if (Number.isNaN(v)) return;
    const { error } = await supabase.from("categories").update({ allocated_budget: v }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();
  };
  const toggleArchiveCategory = async (id: string, archived: boolean) => {
    const { error } = await supabase.from("categories").update({ archived: !archived }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries();
  };
  const delCategory = async (id: string) => {
    if (!confirm("Delete this envelope?")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries();
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

        {/* Currency */}
        <Card>
          <CardHeader><CardTitle className="text-base">Currency</CardTitle></CardHeader>
          <CardContent>
            <Select value={settingsQ.data?.currency_code ?? "CHF"} onValueChange={setCurrency}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} ({c.symbol})</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Accounts */}
        <Card>
          <CardHeader><CardTitle className="text-base">Accounts</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-[1fr_140px_140px_auto]">
              <div><Label className="mb-1 block text-xs text-muted-foreground">Name</Label><Input value={aName} onChange={(e) => setAName(e.target.value)} placeholder="Main Bank" /></div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">Type</Label>
                <Select value={aType} onValueChange={(v) => setAType(v as AccountType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asset">Asset</SelectItem>
                    <SelectItem value="liability">Liability</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="mb-1 block text-xs text-muted-foreground">Opening balance</Label><Input inputMode="decimal" value={aOpening} onChange={(e) => setAOpening(e.target.value)} /></div>
              <div className="flex items-end"><Button className="w-full" onClick={addAccount}><Plus className="h-4 w-4" /> Add</Button></div>
            </div>

            <ul className="divide-y">
              {(accountsQ.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className={a.archived ? "text-muted-foreground line-through" : "font-medium"}>{a.name}</div>
                    <div className="text-xs text-muted-foreground">{a.type} · opening {Number(a.opening_balance).toFixed(2)}</div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => toggleArchiveAccount(a.id, a.archived)} aria-label="Archive">
                      {a.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => delAccount(a.id)} aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
              {(accountsQ.data ?? []).length === 0 && <li className="py-2 text-sm text-muted-foreground">No accounts yet.</li>}
            </ul>
          </CardContent>
        </Card>

        {/* Categories */}
        <Card>
          <CardHeader><CardTitle className="text-base">Envelopes (Categories)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
              <div><Label className="mb-1 block text-xs text-muted-foreground">Name</Label><Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Groceries" /></div>
              <div><Label className="mb-1 block text-xs text-muted-foreground">Monthly budget</Label><Input inputMode="decimal" value={cBudget} onChange={(e) => setCBudget(e.target.value)} /></div>
              <div className="flex items-end"><Button className="w-full" onClick={addCategory}><Plus className="h-4 w-4" /> Add</Button></div>
            </div>

            <ul className="divide-y">
              {(categoriesQ.data ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <div className={c.archived ? "min-w-0 text-muted-foreground line-through" : "min-w-0 font-medium"}>{c.name}</div>
                  <div className="flex items-center gap-2">
                    <Input
                      defaultValue={Number(c.allocated_budget).toString()}
                      inputMode="decimal"
                      className="w-28 text-right tabular-nums"
                      onBlur={(e) => updateCategoryBudget(c.id, e.target.value)}
                    />
                    <Button variant="ghost" size="icon" onClick={() => toggleArchiveCategory(c.id, c.archived)} aria-label="Archive">
                      {c.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => delCategory(c.id)} aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
              {(categoriesQ.data ?? []).length === 0 && <li className="py-2 text-sm text-muted-foreground">No envelopes yet.</li>}
            </ul>
          </CardContent>
        </Card>

        <p className="pb-4 text-xs text-muted-foreground">
          Single-user mode · monthly envelopes reset each calendar month with no rollover · authentication will plug in later.
        </p>
      </div>
    </AppShell>
  );
}
