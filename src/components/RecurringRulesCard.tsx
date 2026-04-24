import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { Plus, Pencil, Trash2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAccounts, fetchCategories, fetchRecurringRules,
  describeSchedule,
  type RecurringRule, type RecurringDayRule, type WeekendAdjust, type TxType,
} from "@/lib/finance";
import { useI18n } from "@/i18n";

type Draft = {
  id?: string;
  name: string;
  type: TxType;
  amount: string;
  source_account_id: string;
  destination_account_id: string;
  category_id: string;
  payee: string;
  note: string;
  day_rule: RecurringDayRule;
  day_of_month: string;
  weekend_adjust: WeekendAdjust;
  starts_on: string;
  ends_on: string;
  auto_post: boolean;
};

const todayStr = () => new Date().toISOString().slice(0, 10);

function emptyDraft(): Draft {
  return {
    name: "", type: "expense", amount: "0",
    source_account_id: "", destination_account_id: "", category_id: "",
    payee: "", note: "",
    day_rule: "fixed_day", day_of_month: "1", weekend_adjust: "none",
    starts_on: todayStr(), ends_on: "",
    auto_post: true,
  };
}

function ruleToDraft(r: RecurringRule): Draft {
  return {
    id: r.id, name: r.name, type: r.type, amount: String(r.amount),
    source_account_id: r.source_account_id,
    destination_account_id: r.destination_account_id ?? "",
    category_id: r.category_id ?? "",
    payee: r.payee ?? "", note: r.note ?? "",
    day_rule: r.day_rule, day_of_month: String(r.day_of_month ?? 1),
    weekend_adjust: r.weekend_adjust,
    starts_on: r.starts_on, ends_on: r.ends_on ?? "",
    auto_post: r.auto_post,
  };
}

function nextDueDate(r: RecurringRule, from = new Date()): Date | null {
  const start = parseISO(r.starts_on);
  const end = r.ends_on ? parseISO(r.ends_on) : null;
  let cursor = new Date(Math.max(start.getTime(), from.getTime()));
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  for (let i = 0; i < 24; i++) {
    const d = computeDue(cursor, r.day_rule, r.day_of_month ?? 1);
    const e = adjust(d, r.weekend_adjust);
    if (e >= from && e >= start && (!end || e <= end)) return e;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return null;
}
function computeDue(month: Date, rule: RecurringDayRule, dom: number): Date {
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  if (rule === "first_of_month") return new Date(month.getFullYear(), month.getMonth(), 1);
  if (rule === "end_of_month") return last;
  return new Date(month.getFullYear(), month.getMonth(), Math.min(dom, last.getDate()));
}
function adjust(d: Date, w: WeekendAdjust): Date {
  if (w === "none") return d;
  const dow = d.getDay(); // 0=Sun..6=Sat
  const r = new Date(d);
  if (w === "before") {
    if (dow === 6) r.setDate(d.getDate() - 1);
    else if (dow === 0) r.setDate(d.getDate() - 2);
  } else {
    if (dow === 6) r.setDate(d.getDate() + 2);
    else if (dow === 0) r.setDate(d.getDate() + 1);
  }
  return r;
}

export function RecurringRulesCard() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const rulesQ = useQuery({ queryKey: ["recurring_rules"], queryFn: fetchRecurringRules });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(emptyDraft());

  const openAdd = () => { setDraft(emptyDraft()); setOpen(true); };
  const openEdit = (r: RecurringRule) => { setDraft(ruleToDraft(r)); setOpen(true); };

  const save = async () => {
    if (!draft.name.trim()) { toast.error(t("toast.name_required")); return; }
    if (!draft.source_account_id) { toast.error(t("toast.account_required")); return; }
    if (draft.type === "transfer" && !draft.destination_account_id) { toast.error(t("toast.dest_required")); return; }
    const payload = {
      name: draft.name.trim(),
      type: draft.type,
      amount: Number(draft.amount) || 0,
      source_account_id: draft.source_account_id,
      destination_account_id: draft.type === "transfer" ? draft.destination_account_id : null,
      category_id: draft.type !== "transfer" && draft.category_id ? draft.category_id : null,
      payee: draft.payee.trim() || null,
      note: draft.note.trim() || null,
      day_rule: draft.day_rule,
      day_of_month: draft.day_rule === "fixed_day" ? Number(draft.day_of_month) || 1 : null,
      weekend_adjust: draft.weekend_adjust,
      starts_on: draft.starts_on,
      ends_on: draft.ends_on || null,
      auto_post: draft.auto_post,
    };
    const res = draft.id
      ? await supabase.from("recurring_rules").update(payload).eq("id", draft.id)
      : await supabase.from("recurring_rules").insert(payload);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(t("recurring.toast.saved"));
    setOpen(false);
    qc.invalidateQueries();
  };

  const del = async (id: string) => {
    if (!confirm(t("recurring.confirm_delete"))) return;
    const { error } = await supabase.from("recurring_rules").update({ archived: true }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("toast.deleted"));
    qc.invalidateQueries();
  };

  const rules = rulesQ.data ?? [];
  const today = new Date();
  const sections = React.useMemo(() => {
    const active: RecurringRule[] = [], ended: RecurringRule[] = [], archived: RecurringRule[] = [];
    for (const r of rules) {
      if (r.archived) archived.push(r);
      else if (r.ends_on && parseISO(r.ends_on) < today) ended.push(r);
      else active.push(r);
    }
    return { active, ended, archived };
  }, [rules, today]);

  const accounts = accountsQ.data ?? [];
  const categories = categoriesQ.data ?? [];
  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "—";

  const renderRule = (r: RecurringRule) => {
    const next = nextDueDate(r, today);
    return (
      <li key={r.id} className="flex items-center justify-between gap-2 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{r.name}</span>
            <Badge variant="outline" className="text-[10px]">
              {r.auto_post ? t("recurring.auto_badge") : t("recurring.manual_badge")}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {Number(r.amount).toFixed(2)} · {describeSchedule(r, t)} · {accountName(r.source_account_id)}
          </div>
          <div className="text-xs text-muted-foreground">
            {next ? t("recurring.next_due", { x: format(next, "PP", { locale }) }) : t("recurring.no_more")}
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => openEdit(r)} aria-label={t("recurring.edit")}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => del(r.id)} aria-label={t("common.delete")}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </li>
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{t("recurring.title")}</CardTitle>
        <Button size="sm" onClick={openAdd}><Plus className="h-4 w-4" /> {t("recurring.add")}</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {rules.length === 0 ? (
          <div className="py-2 text-sm text-muted-foreground">{t("recurring.empty")}</div>
        ) : (
          <>
            {sections.active.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t("recurring.section_active")}</div>
                <ul className="divide-y">{sections.active.map(renderRule)}</ul>
              </div>
            )}
            {sections.ended.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t("recurring.section_ended")}</div>
                <ul className="divide-y opacity-70">{sections.ended.map(renderRule)}</ul>
              </div>
            )}
            {sections.archived.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t("recurring.section_archived")}</div>
                <ul className="divide-y opacity-50">{sections.archived.map(renderRule)}</ul>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft.id ? t("recurring.edit") : t("recurring.add")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label className="text-xs">{t("recurring.field.name")}</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Miete" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("common.type")}</Label>
                <Select value={draft.type} onValueChange={(v) => setDraft({ ...draft, type: v as TxType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">{t("add.expense")}</SelectItem>
                    <SelectItem value="income">{t("add.income")}</SelectItem>
                    <SelectItem value="transfer">{t("add.transfer")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("recurring.field.amount")}</Label>
                <Input inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">{draft.type === "transfer" ? t("add.from_account") : t("add.account")}</Label>
              <Select value={draft.source_account_id} onValueChange={(v) => setDraft({ ...draft, source_account_id: v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {accounts.filter((a) => !a.archived).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {draft.type === "transfer" && (
              <div>
                <Label className="text-xs">{t("add.to_account")}</Label>
                <Select value={draft.destination_account_id} onValueChange={(v) => setDraft({ ...draft, destination_account_id: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => !a.archived && a.id !== draft.source_account_id).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {draft.type !== "transfer" && (
              <div>
                <Label className="text-xs">{t("add.category")}</Label>
                <Select value={draft.category_id || "__none"} onValueChange={(v) => setDraft({ ...draft, category_id: v === "__none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{t("common.none")}</SelectItem>
                    {categories.filter((c) => !c.archived).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("add.payee")}</Label>
                <Input value={draft.payee} onChange={(e) => setDraft({ ...draft, payee: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">{t("add.note")}</Label>
                <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("recurring.field.day_rule")}</Label>
                <Select value={draft.day_rule} onValueChange={(v) => setDraft({ ...draft, day_rule: v as RecurringDayRule })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_day">{t("recurring.day_rule.fixed_day")}</SelectItem>
                    <SelectItem value="end_of_month">{t("recurring.day_rule.end_of_month")}</SelectItem>
                    <SelectItem value="first_of_month">{t("recurring.day_rule.first_of_month")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {draft.day_rule === "fixed_day" && (
                <div>
                  <Label className="text-xs">{t("recurring.field.day_of_month")}</Label>
                  <Input inputMode="numeric" min={1} max={31} type="number" value={draft.day_of_month} onChange={(e) => setDraft({ ...draft, day_of_month: e.target.value })} />
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">{t("recurring.field.weekend")}</Label>
              <Select value={draft.weekend_adjust} onValueChange={(v) => setDraft({ ...draft, weekend_adjust: v as WeekendAdjust })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("recurring.weekend.none")}</SelectItem>
                  <SelectItem value="before">{t("recurring.weekend.before")}</SelectItem>
                  <SelectItem value="after">{t("recurring.weekend.after")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("recurring.field.starts_on")}</Label>
                <Input type="date" value={draft.starts_on} onChange={(e) => setDraft({ ...draft, starts_on: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">{t("recurring.field.ends_on")} {t("common.optional")}</Label>
                <Input type="date" value={draft.ends_on} onChange={(e) => setDraft({ ...draft, ends_on: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="auto-post" className="text-sm">{t("recurring.auto_post")}</Label>
              <Switch id="auto-post" checked={draft.auto_post} onCheckedChange={(v) => setDraft({ ...draft, auto_post: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={save}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}