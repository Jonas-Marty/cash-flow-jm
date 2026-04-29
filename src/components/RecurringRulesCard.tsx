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
  describeSchedule, previewRecurringRule, archiveRecurringRule, applyRecurringRuleBackfill, fetchSettings,
  type RecurringRule, type RecurringDayRule, type WeekendAdjust, type TxType, type RecurringFrequency,
} from "@/lib/finance";
import { useI18n } from "@/i18n";
import { DateInput } from "@/components/DateInput";
import { useQuery as useRQuery } from "@tanstack/react-query";
import { interpolate, resolveFormatLocale, describeTokens } from "@/lib/placeholders";
import { parseISO as parseISO2 } from "date-fns";

type Draft = {
  id?: string;
  name: string;
  type: TxType;
  amount: string;
  is_variable_amount: boolean;
  estimated_amount: string;
  source_account_id: string;
  destination_account_id: string;
  category_id: string;
  description: string;
  note: string;
  day_rule: RecurringDayRule;
  day_of_month: string;
  weekend_adjust: WeekendAdjust;
  frequency: RecurringFrequency;
  starts_on: string;
  ends_on: string;
  auto_post: boolean;
  backfill: "none" | "post";
};

const todayStr = () => new Date().toISOString().slice(0, 10);

function emptyDraft(): Draft {
  return {
    name: "", type: "expense", amount: "0",
    is_variable_amount: false, estimated_amount: "",
    source_account_id: "", destination_account_id: "", category_id: "",
    description: "", note: "",
    day_rule: "fixed_day", day_of_month: "1", weekend_adjust: "none",
    frequency: "monthly",
    starts_on: todayStr(), ends_on: "",
    auto_post: true,
    backfill: "none",
  };
}

function ruleToDraft(r: RecurringRule): Draft {
  return {
    id: r.id, name: r.name, type: r.type,
    amount: r.amount != null ? String(r.amount) : "0",
    is_variable_amount: !!r.is_variable_amount,
    estimated_amount: r.estimated_amount != null ? String(r.estimated_amount) : "",
    source_account_id: r.source_account_id,
    destination_account_id: r.destination_account_id ?? "",
    category_id: r.category_id ?? "",
    description: r.description ?? "", note: r.note ?? "",
    day_rule: r.day_rule, day_of_month: String(r.day_of_month ?? 1),
    weekend_adjust: r.weekend_adjust,
    frequency: r.frequency ?? "monthly",
    starts_on: r.starts_on, ends_on: r.ends_on ?? "",
    auto_post: r.auto_post,
    backfill: "none",
  };
}

function nextDueDate(r: RecurringRule, from = new Date()): Date | null {
  const start = parseISO(r.starts_on);
  const end = r.ends_on ? parseISO(r.ends_on) : null;
  const step = r.frequency === "quarterly" ? 3 : r.frequency === "yearly" ? 12 : 1;
  let cursor = new Date(Math.max(start.getTime(), from.getTime()));
  // Align cursor to the start month, then advance in `step` increments to/past `from`.
  cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor < new Date(from.getFullYear(), from.getMonth(), 1)) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + step, 1);
  }
  for (let i = 0; i < 48; i++) {
    const d = computeDue(cursor, r.day_rule, r.day_of_month ?? 1);
    const e = adjust(d, r.weekend_adjust);
    if (e >= from && e >= start && (!end || e <= end)) return e;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + step, 1);
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
  const { t, locale, lang } = useI18n();
  const qc = useQueryClient();
  const rulesQ = useQuery({ queryKey: ["recurring_rules"], queryFn: fetchRecurringRules });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(emptyDraft());

  const openAdd = () => { setDraft(emptyDraft()); setOpen(true); };
  const openEdit = (r: RecurringRule) => { setDraft(ruleToDraft(r)); setOpen(true); };

  const save = async () => {
    if (!draft.name.trim()) { toast.error(t("toast.name_required")); return; }
    if (!draft.source_account_id) { toast.error(t("toast.account_required")); return; }
    if (draft.type === "transfer" && !draft.destination_account_id) { toast.error(t("toast.dest_required")); return; }
    if (!draft.is_variable_amount) {
      const amt = Number(draft.amount);
      if (!Number.isFinite(amt) || amt <= 0) { toast.error(t("toast.amount_required")); return; }
    }
    const estParsed = draft.estimated_amount.trim() === "" ? null : Number(draft.estimated_amount);
    if (draft.is_variable_amount && estParsed != null && (!Number.isFinite(estParsed) || estParsed < 0)) {
      toast.error(t("toast.amount_required")); return;
    }
    const payload = {
      name: draft.name.trim(),
      type: draft.type,
      amount: draft.is_variable_amount ? null : (Number(draft.amount) || 0),
      is_variable_amount: draft.is_variable_amount,
      estimated_amount: draft.is_variable_amount ? estParsed : null,
      source_account_id: draft.source_account_id,
      destination_account_id: draft.type === "transfer" ? draft.destination_account_id : null,
      category_id: draft.type !== "transfer" && draft.category_id ? draft.category_id : null,
      description: draft.description.trim() || null,
      note: draft.note.trim() || null,
      day_rule: draft.day_rule,
      day_of_month: draft.day_rule === "fixed_day" ? Number(draft.day_of_month) || 1 : null,
      weekend_adjust: draft.weekend_adjust,
      frequency: draft.frequency,
      starts_on: draft.starts_on,
      ends_on: draft.ends_on || null,
      auto_post: draft.is_variable_amount ? false : draft.auto_post,
    };
    let savedId: string | undefined = draft.id;
    const isNew = !draft.id;
    if (isNew) {
      const { data, error } = await supabase.from("recurring_rules").insert(payload).select("id").single();
      if (error) { toast.error(error.message); return; }
      savedId = data?.id;
    } else {
      const { error } = await supabase.from("recurring_rules").update(payload).eq("id", draft.id!);
      if (error) { toast.error(error.message); return; }
      // Schedule/amount/account/etc. may have changed — wipe pending occurrences
      // so they get regenerated from the new rule. Posted ones stay (they have
      // real transactions attached).
      const { error: delErr } = await supabase
        .from("recurring_occurrences")
        .delete()
        .eq("rule_id", draft.id!)
        .eq("status", "pending");
      if (delErr) { toast.error(delErr.message); return; }
    }
    // If new rule and starts in the past, apply backfill choice
    if (isNew && savedId && draft.starts_on < todayStr()) {
      try {
        await applyRecurringRuleBackfill(savedId, draft.backfill);
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    // Process to generate future pending occurrences immediately
    try {
      await supabase.rpc("process_recurring_rules", { p_today: todayStr() });
    } catch { /* non-fatal */ }
    toast.success(t("recurring.toast.saved"));
    setOpen(false);
    qc.invalidateQueries();
  };

  const del = async (id: string) => {
    if (!confirm(t("recurring.confirm_delete"))) return;
    try {
      await archiveRecurringRule(id, true);
    } catch (e) {
      return toast.error((e as Error).message);
    }
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
            {r.is_variable_amount && (
              <Badge variant="outline" className="text-[10px]">{t("recurring.variable_badge")}</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {r.is_variable_amount
              ? (r.estimated_amount != null ? `~${Number(r.estimated_amount).toFixed(2)}` : t("recurring.variable_badge"))
              : Number(r.amount ?? 0).toFixed(2)} · {describeSchedule(r, t)} · {accountName(r.source_account_id)}
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
        <DialogContent
          className="max-h-[90vh] overflow-y-auto"
          onPointerDownOutside={(e) => {
            // Radix Select / Popover content lives in a portal outside the Dialog.
            // Clicking an item there fires pointerdown-outside on the Dialog and
            // would otherwise close it, losing the user's draft. Ignore those.
            const target = e.target as HTMLElement | null;
            if (target?.closest("[data-radix-popper-content-wrapper], [role='listbox'], [role='option'], [data-radix-select-content], [data-radix-popover-content]")) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest("[data-radix-popper-content-wrapper], [role='listbox'], [role='option'], [data-radix-select-content], [data-radix-popover-content]")) {
              e.preventDefault();
            }
          }}
        >
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
                <Label className="text-xs">
                  {draft.is_variable_amount ? t("recurring.estimated_amount") : t("recurring.field.amount")}
                </Label>
                <Input
                  inputMode="decimal"
                  placeholder={draft.is_variable_amount ? t("common.optional") : ""}
                  value={draft.is_variable_amount ? draft.estimated_amount : draft.amount}
                  onChange={(e) => setDraft(draft.is_variable_amount
                    ? { ...draft, estimated_amount: e.target.value }
                    : { ...draft, amount: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="min-w-0 pr-3">
                <Label htmlFor="variable-amount" className="text-sm">{t("recurring.variable_amount")}</Label>
                <div className="text-xs text-muted-foreground">{t("recurring.variable_amount.help")}</div>
              </div>
              <Switch
                id="variable-amount"
                checked={draft.is_variable_amount}
                onCheckedChange={(v) => setDraft({ ...draft, is_variable_amount: v, auto_post: v ? false : draft.auto_post })}
              />
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
                <Label className="text-xs">{t("add.description")}</Label>
                <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">{t("add.note")}</Label>
                <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
              </div>
            </div>
            <div className="rounded-md border p-2">
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                {t("recurring.placeholders.title")}
              </div>
              <div className="flex flex-wrap gap-1">
                {describeTokens().map((tok) => (
                  <button
                    key={tok.token}
                    type="button"
                    onClick={() => setDraft({ ...draft, description: `${draft.description}\${${tok.token}}` })}
                    className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
                    title={tok.help}
                  >
                    {`\${${tok.token}}`}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">{t("recurring.field.frequency")}</Label>
                <Select value={draft.frequency} onValueChange={(v) => setDraft({ ...draft, frequency: v as RecurringFrequency })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">{t("recurring.freq.monthly")}</SelectItem>
                    <SelectItem value="quarterly">{t("recurring.freq.quarterly")}</SelectItem>
                    <SelectItem value="yearly">{t("recurring.freq.yearly")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
                <DateInput
                  value={parseISO(draft.starts_on)}
                  onChange={(d) => setDraft({ ...draft, starts_on: format(d, "yyyy-MM-dd") })}
                  formatStr={settingsQ.data?.date_format}
                  lang={lang}
                  locale={locale}
                />
              </div>
              <div>
                <Label className="text-xs">{t("recurring.field.ends_on")} {t("common.optional")}</Label>
                {draft.ends_on ? (
                  <div className="flex gap-2">
                    <DateInput
                      value={parseISO(draft.ends_on)}
                      onChange={(d) => setDraft({ ...draft, ends_on: format(d, "yyyy-MM-dd") })}
                      formatStr={settingsQ.data?.date_format}
                      lang={lang}
                      locale={locale}
                      className="flex-1"
                    />
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDraft({ ...draft, ends_on: "" })}>
                      {t("common.clear")}
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setDraft({ ...draft, ends_on: todayStr() })}>
                    {t("common.set")}
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="min-w-0 pr-3">
                <Label htmlFor="auto-post" className="text-sm">{t("recurring.auto_post")}</Label>
                {draft.is_variable_amount && (
                  <div className="text-xs text-muted-foreground">{t("recurring.variable_no_autopost")}</div>
                )}
              </div>
              <Switch
                id="auto-post"
                checked={draft.auto_post && !draft.is_variable_amount}
                disabled={draft.is_variable_amount}
                onCheckedChange={(v) => setDraft({ ...draft, auto_post: v })}
              />
            </div>
            {!draft.id && draft.starts_on < todayStr() && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="text-sm font-medium">{t("recurring.backfill.title")}</div>
                <div className="grid gap-2">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="backfill"
                      className="mt-1"
                      checked={draft.backfill === "none"}
                      onChange={() => setDraft({ ...draft, backfill: "none" })}
                    />
                    <span>{t("recurring.backfill.none")}</span>
                  </label>
                  {!draft.is_variable_amount && (
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="backfill"
                        className="mt-1"
                        checked={draft.backfill === "post"}
                        onChange={() => setDraft({ ...draft, backfill: "post" })}
                      />
                      <span>{t("recurring.backfill.post")}</span>
                    </label>
                  )}
                </div>
              </div>
            )}
            <PreviewPanel draft={draft} formatLocaleCode={settingsQ.data?.format_locale} />
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

function PreviewPanel({ draft }: { draft: Draft }) {
  const { t, locale } = useI18n();
  const today = todayStr();
  // Window: 12 months ahead, and far enough back to always cover starts_on.
  // Default look-back is 3 months; if the user picked a starts_on further in
  // the past (backfill scenario) we extend the window to that date so the
  // preview actually shows the past entries that would be created.
  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - 3);
  if (draft.starts_on) {
    const startsDate = parseISO(draft.starts_on);
    if (startsDate < fromDate) {
      fromDate.setTime(startsDate.getTime());
    }
  }
  const toDate = new Date();
  toDate.setMonth(toDate.getMonth() + 12);
  const fromISO = fromDate.toISOString().slice(0, 10);
  const toISO = toDate.toISOString().slice(0, 10);

  const dom = draft.day_rule === "fixed_day" ? Number(draft.day_of_month) || 1 : null;
  const enabled = !!draft.starts_on;
  const previewQ = useRQuery({
    queryKey: ["preview_recurring", draft.frequency, draft.day_rule, dom, draft.weekend_adjust, draft.starts_on, draft.ends_on || null, fromISO, toISO],
    queryFn: () => previewRecurringRule({
      day_rule: draft.day_rule,
      day_of_month: dom,
      weekend_adjust: draft.weekend_adjust,
      starts_on: draft.starts_on,
      ends_on: draft.ends_on || null,
      from: fromISO,
      to: toISO,
      frequency: draft.frequency,
    }),
    enabled,
    staleTime: 30_000,
  });

  const rows = previewQ.data ?? [];
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{t("recurring.preview.title")}</div>
      {!enabled || rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t("recurring.preview.empty")}</div>
      ) : (
        <div className="max-h-40 overflow-y-auto pr-1">
          <ul className="space-y-1">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-xs">
                <span className={r.in_past ? "text-muted-foreground" : ""}>
                  {format(parseISO(r.effective_on), "PP", { locale })}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {r.in_past ? t("recurring.preview.past") : t("recurring.preview.future")}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {draft.starts_on < today && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          {t("recurring.preview.note_past")}
        </div>
      )}
    </div>
  );
}