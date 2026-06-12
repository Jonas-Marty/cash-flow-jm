import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAccounts, fetchCategories, fetchRecurringRules,
  describeSchedule, previewRecurringRule, archiveRecurringRule, applyRecurringRuleBackfill, fetchSettings, fetchTransactions,
  type RecurringRule, type RecurringDayRule, type WeekendAdjust, type TxType, type RecurringFrequency,
} from "@/lib/finance";
import { useI18n } from "@/i18n";
import { DateInput } from "@/components/DateInput";
import { useQuery as useRQuery } from "@tanstack/react-query";
import { interpolate, resolveFormatLocale, describeTokens, type TokenInfo } from "@/lib/placeholders";
import { TagAutocompleteTextarea } from "@/components/TagAutocompleteTextarea";
import { validateSliceTemplate } from "@/lib/recurringSlices";
import { computeSliceAmounts } from "@/lib/recurringSlices";
import { Markdown } from "@/components/Markdown";
import { Trash2 as TrashIcon } from "lucide-react";

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
  backfill: "none" | "post" | "pending";
  is_variable_date: boolean;
  is_split: boolean;
  reporting_offset_months: string;
  slices: SliceDraft[];
};

type SliceDraft = {
  id?: string;
  amount: string;        // used when !is_variable_amount
  amount_ratio: string;  // used when is_variable_amount (decimal, e.g. "0.5")
  category_id: string;
  description: string;
  note: string;
  is_reimbursable: boolean;
  reimbursable_counterparty: string;
  reimbursable_reason: string;
};

function emptySlice(): SliceDraft {
  return {
    amount: "",
    amount_ratio: "",
    category_id: "",
    description: "",
    note: "",
    is_reimbursable: false,
    reimbursable_counterparty: "",
    reimbursable_reason: "",
  };
}

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
    is_variable_date: false,
    is_split: false,
    reporting_offset_months: "0",
    slices: [emptySlice(), emptySlice()],
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
    is_variable_date: !!r.is_variable_date,
    is_split: !!r.is_split,
    reporting_offset_months: String(r.reporting_offset_months ?? 0),
    slices: r.slices && r.slices.length >= 2
      ? r.slices.map((s) => ({
          id: s.id,
          amount: s.amount != null ? String(s.amount) : "",
          amount_ratio: s.amount_ratio != null ? String(s.amount_ratio) : "",
          category_id: s.category_id ?? "",
          description: s.description ?? "",
          note: s.note ?? "",
          is_reimbursable: !!s.is_reimbursable,
          reimbursable_counterparty: s.reimbursable_counterparty ?? "",
          reimbursable_reason: s.reimbursable_reason ?? "",
        }))
      : [emptySlice(), emptySlice()],
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
  // Past transactions feed the #tag autocomplete in the note field, mirroring
  // the experience in the Add Transaction dialog.
  const txQ = useQuery({ queryKey: ["transactions"], queryFn: () => fetchTransactions() });

  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(emptyDraft());

  // When editing, fetch the rule's existing occurrences so we can show what is
  // already posted vs. pending and decide whether to expose the "fill past
  // dates" backfill block or the smaller "fill the gap" variant.
  const occStatsQ = useQuery({
    queryKey: ["recurring_occurrences_for_rule", draft.id],
    enabled: !!draft.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_occurrences")
        .select("status, effective_on")
        .eq("rule_id", draft.id!);
      if (error) throw error;
      return (data ?? []) as Array<{ status: string; effective_on: string }>;
    },
  });
  const occStats = React.useMemo(() => {
    const all = occStatsQ.data ?? [];
    const posted = all.filter((o) => o.status === "posted");
    const pending = all.filter((o) => o.status === "pending");
    const lastPostedEffOn = posted.length
      ? posted.reduce((a, b) => (a.effective_on > b.effective_on ? a : b)).effective_on
      : null;
    return { postedCount: posted.length, pendingCount: pending.length, lastPostedEffOn };
  }, [occStatsQ.data]);

  const isNew = !draft.id;
  const startsPast = !!draft.starts_on && draft.starts_on < todayStr();
  // "Fresh" past start: new rule, or editing a rule that has nothing posted yet.
  // User picks from 3 backfill modes (none / post / pending).
  const freshPastMode = startsPast && (isNew || occStats.postedCount === 0);
  // "Gap" mode: editing a rule that already has posted history, but starts_on
  // is in the past (gap between last posted and today, or simply the user just
  // changed starts_on backwards). Only 2 choices to avoid silent auto-post.
  const gapPastMode = !isNew && occStats.postedCount > 0 && startsPast && !freshPastMode;
  const showBackfill = freshPastMode || gapPastMode;

  // Will the save trigger any past auto-post?
  // - Fresh mode + backfill="post" → applyRecurringRuleBackfill creates posted txs.
  // - Edit with auto_post on + past pending occurrences that will remain (or be
  //   re-created): Pass 1 of process_recurring_rules will auto-post them.
  const deterministicAuto =
    draft.auto_post && !draft.is_variable_amount && !draft.is_variable_date;

  // Reset backfill choice when the mode changes so a stale "post" choice from a
  // previous draft doesn't silently apply in gap mode (where it's hidden).
  React.useEffect(() => {
    if (!showBackfill && draft.backfill !== "none") {
      setDraft((d) => ({ ...d, backfill: "none" }));
    } else if (gapPastMode && draft.backfill === "post") {
      setDraft((d) => ({ ...d, backfill: "none" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBackfill, gapPastMode]);

  // Pre-save confirm gate state.
  const [pendingConfirm, setPendingConfirm] = React.useState<{
    count: number;
    sum: number;
  } | null>(null);

  // Track which text field is focused so a placeholder click inserts at the
  // caret of that field (description Input or note Textarea). Defaults to
  // description when the dialog opens.
  const descRef = React.useRef<HTMLInputElement | null>(null);
  const noteRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [activeField, setActiveField] = React.useState<"description" | "note">("description");

  // For slice fields, remember which slice + which field (description/note) is
  // currently focused so the shared PlaceholderPalette inserts at the right caret.
  const sliceDescRefs = React.useRef<Array<HTMLInputElement | null>>([]);
  const sliceNoteRefs = React.useRef<Array<HTMLTextAreaElement | null>>([]);
  const [activeSlice, setActiveSlice] = React.useState<{ idx: number; field: "description" | "note" } | null>(null);

  const openAdd = () => { setDraft(emptyDraft()); setOpen(true); };
  const openEdit = (r: RecurringRule) => { setDraft(ruleToDraft(r)); setOpen(true); };

  const save = async (opts: { confirmedPastPost?: boolean } = {}) => {
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
    // Split rules cannot be transfers and need slice validation.
    if (draft.is_split && draft.type === "transfer") {
      toast.error(t("recurring.split.no_transfer")); return;
    }
    let slicePayload: Array<{
      sort_order: number; amount: number | null; amount_ratio: number | null;
      category_id: string | null; description: string | null; note: string | null;
      is_reimbursable: boolean; reimbursable_counterparty: string | null; reimbursable_reason: string | null;
    }> = [];
    if (draft.is_split) {
      slicePayload = draft.slices.map((s, idx) => ({
        sort_order: idx,
        amount: draft.is_variable_amount ? null : (Number(s.amount.replace(",", ".")) || 0),
        amount_ratio: draft.is_variable_amount ? (Number(s.amount_ratio.replace(",", ".")) || 0) : null,
        category_id: s.category_id || null,
        description: s.description.trim() || null,
        note: s.note.trim() || null,
        is_reimbursable: s.is_reimbursable,
        reimbursable_counterparty: s.is_reimbursable ? (s.reimbursable_counterparty.trim() || null) : null,
        reimbursable_reason: s.is_reimbursable ? (s.reimbursable_reason.trim() || null) : null,
      }));
      const validationErr = validateSliceTemplate(
        slicePayload.map((p) => ({ amount: p.amount, amount_ratio: p.amount_ratio })),
        draft.is_variable_amount ? null : (Number(draft.amount) || 0),
      );
      if (validationErr) { toast.error(validationErr); return; }
    }
    // Pre-save confirmation gate: if the save will silently create real past
    // transactions, open a confirm dialog before touching the DB.
    if (!opts.confirmedPastPost && deterministicAuto && startsPast) {
      const willPostPast =
        (freshPastMode && draft.backfill === "post") ||
        // Edit case: pending past occurrences (existing or about to be
        // regenerated by process_recurring_rules) will be auto-posted.
        (!isNew && (occStats.pendingCount > 0 || (occStats.postedCount === 0 && draft.backfill !== "none")));
      if (willPostPast) {
        const totalAmt = draft.is_variable_amount
          ? Number(draft.estimated_amount) || 0
          : Number(draft.amount) || 0;
        // We don't know the exact count without re-querying the preview, so
        // use a conservative estimate: posted+pending count from preview
        // (computed inside ImpactSummary). The ConfirmDialog re-uses pendingConfirm
        // values set by ImpactSummary via a ref-like callback. Fallback to 1.
        const n = (window as unknown as { __recImpactPastCount?: number }).__recImpactPastCount ?? 1;
        setPendingConfirm({ count: n, sum: totalAmt * n });
        return;
      }
    }
    const payload = {
      name: draft.name.trim(),
      type: draft.type,
      amount: draft.is_variable_amount ? null : (Number(draft.amount) || 0),
      is_variable_amount: draft.is_variable_amount,
      estimated_amount: draft.is_variable_amount ? estParsed : null,
      source_account_id: draft.source_account_id,
      destination_account_id: draft.type === "transfer" ? draft.destination_account_id : null,
      category_id: draft.type !== "transfer" && !draft.is_split && draft.category_id ? draft.category_id : null,
      description: draft.is_split ? null : (draft.description.trim() || null),
      note: draft.is_split ? null : (draft.note.trim() || null),
      day_rule: draft.day_rule,
      day_of_month: draft.day_rule === "fixed_day" ? Number(draft.day_of_month) || 1 : null,
      weekend_adjust: draft.weekend_adjust,
      frequency: draft.frequency,
      starts_on: draft.starts_on,
      ends_on: draft.ends_on || null,
      auto_post: (draft.is_variable_amount || draft.is_variable_date) ? false : draft.auto_post,
      is_variable_date: draft.is_variable_date,
      is_split: draft.is_split,
    };
    let savedId: string | undefined = draft.id;
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
    // Replace slices wholesale (simpler than diffing).
    if (savedId) {
      await supabase.from("recurring_rule_slices").delete().eq("rule_id", savedId);
      if (draft.is_split && slicePayload.length >= 2) {
        const rows = slicePayload.map((p) => ({ ...p, rule_id: savedId! }));
        const { error: insErr } = await supabase.from("recurring_rule_slices").insert(rows);
        if (insErr) { toast.error(insErr.message); return; }
      }
    }
    // Apply the explicit backfill choice when the user actually saw the block
    // (fresh past mode for new/edited rules without history, or gap mode for
    // edits that already have posted occurrences).
    if (savedId && draft.starts_on < todayStr() && (freshPastMode || gapPastMode)) {
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
    setPendingConfirm(null);
    qc.invalidateQueries();
  };

  const del = async (id: string) => {
    // Count posted transactions linked to this rule. If none, allow a full
    // hard-delete. If any exist, we cannot drop the rule (transactions keep
    // a FK to it) — fall back to archiving and explain why.
    const { count, error: cntErr } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("recurring_rule_id", id);
    if (cntErr) { toast.error(cntErr.message); return; }
    const linked = count ?? 0;
    const rule = rules.find((r) => r.id === id);
    if (linked === 0) {
      if (!confirm(t("recurring.confirm_delete_full"))) return;
      // Wipe dependents first to avoid FK errors.
      await supabase.from("recurring_occurrences").delete().eq("rule_id", id);
      await supabase.from("recurring_rule_slices").delete().eq("rule_id", id);
      const { error } = await supabase.from("recurring_rules").delete().eq("id", id);
      if (error) { toast.error(error.message); return; }
      toast.success(t("toast.deleted"));
      qc.invalidateQueries();
      return;
    }
    if (rule?.archived) {
      toast.error(t("recurring.cannot_delete_has_tx", { n: linked }));
      return;
    }
    if (!confirm(t("recurring.archive_instead", { n: linked }))) return;
    try {
      await archiveRecurringRule(id, true);
    } catch (e) {
      return toast.error((e as Error).message);
    }
    toast.success(t("toast.archived"));
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

  const [archivedOpen, setArchivedOpen] = React.useState(false);

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
            {r.is_variable_date && (
              <Badge variant="outline" className="text-[10px]">{t("recurring.variable_date_badge")}</Badge>
            )}
            {r.is_split && (
              <Badge variant="outline" className="text-[10px]">{t("recurring.split_badge")}</Badge>
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
          {r.is_split && r.slices && r.slices.length > 0 && (
            <ul className="mt-1 space-y-0.5 border-l border-dashed border-border/60 pl-2 text-xs text-muted-foreground">
              {r.slices.map((s) => {
                const cat = categories.find((c) => c.id === s.category_id);
                const amt = s.amount_ratio != null
                  ? `${Math.round(Number(s.amount_ratio) * 100)}%`
                  : (s.amount != null ? Number(s.amount).toFixed(2) : "—");
                return (
                  <li key={s.id} className="flex items-center gap-1.5">
                    <span className="tabular-nums">{amt}</span>
                    <span>·</span>
                    <span className="truncate">{cat?.name ?? t("common.none")}</span>
                    {s.description && <><span>·</span><span className="truncate">{s.description}</span></>}
                    {s.is_reimbursable && <Badge variant="outline" className="ml-1 text-[10px]">🔁</Badge>}
                  </li>
                );
              })}
            </ul>
          )}
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
                <button
                  type="button"
                  onClick={() => setArchivedOpen((v) => !v)}
                  className="mb-1 inline-flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground hover:text-foreground"
                  aria-expanded={archivedOpen}
                >
                  {archivedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {t("recurring.section_archived")} ({sections.archived.length})
                </button>
                {archivedOpen && (
                  <ul className="divide-y opacity-50">{sections.archived.map(renderRule)}</ul>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto"
          // Never close the dialog from outside interactions or Esc — only the
          // Cancel / Save buttons should dismiss, so users can't accidentally
          // lose a partially filled rule (especially when Radix Select/Popover
          // portals fire outside-events from within the dialog).
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
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
            {draft.type !== "transfer" && !draft.is_split && (
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
            {!draft.is_split && (
            <>
            <div>
              <Label className="text-xs" htmlFor="rec-description">{t("add.description")}</Label>
              <Input
                id="rec-description"
                ref={descRef}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                onFocus={() => setActiveField("description")}
              />
            </div>
            <PlaceholderPalette
              formatLocaleCode={settingsQ.data?.format_locale}
              onInsert={(snippet) => insertPlaceholder({
                snippet,
                target: activeField,
                draft, setDraft,
                descRef, noteRef,
              })}
            />
            <div>
              <Label className="text-xs" htmlFor="rec-note">{t("add.note")}</Label>
              <TagAutocompleteTextarea
                id="rec-note"
                ref={noteRef as never}
                value={draft.note}
                onChange={(v) => setDraft({ ...draft, note: v })}
                transactions={txQ.data ?? []}
                onFocus={() => setActiveField("note")}
                rows={3}
              />
            </div>
            </>
            )}
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
                {(draft.is_variable_amount || draft.is_variable_date) && (
                  <div className="text-xs text-muted-foreground">{t("recurring.variable_no_autopost")}</div>
                )}
              </div>
              <Switch
                id="auto-post"
                checked={draft.auto_post && !draft.is_variable_amount && !draft.is_variable_date}
                disabled={draft.is_variable_amount || draft.is_variable_date}
                onCheckedChange={(v) => setDraft({ ...draft, auto_post: v })}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="min-w-0 pr-3">
                <Label htmlFor="variable-date" className="text-sm">{t("recurring.variable_date")}</Label>
                <div className="text-xs text-muted-foreground">{t("recurring.variable_date.help")}</div>
              </div>
              <Switch
                id="variable-date"
                checked={draft.is_variable_date}
                onCheckedChange={(v) => setDraft({ ...draft, is_variable_date: v, auto_post: v ? false : draft.auto_post })}
              />
            </div>
            {draft.type !== "transfer" && (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="min-w-0 pr-3">
                  <Label htmlFor="split-rule" className="text-sm">{t("recurring.split.toggle")}</Label>
                  <div className="text-xs text-muted-foreground">{t("recurring.split.help")}</div>
                </div>
                <Switch
                  id="split-rule"
                  checked={draft.is_split}
                  onCheckedChange={(v) => setDraft({ ...draft, is_split: v })}
                />
              </div>
            )}
            {draft.is_split && draft.type !== "transfer" && (
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{t("recurring.split.slices")}</div>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => setDraft({ ...draft, slices: [...draft.slices, emptySlice()] })}>
                    <Plus className="mr-1 h-4 w-4" /> {t("recurring.split.add_slice")}
                  </Button>
                </div>
                <PlaceholderPalette
                  formatLocaleCode={settingsQ.data?.format_locale}
                  onInsert={(snippet) => insertSlicePlaceholder({
                    snippet,
                    active: activeSlice,
                    draft, setDraft,
                    sliceDescRefs, sliceNoteRefs,
                  })}
                />
                {draft.slices.map((s, idx) => (
                  <div key={idx} className="rounded-md border bg-muted/30 p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-muted-foreground">
                        {t("recurring.split.slice", { n: idx + 1 })}
                      </div>
                      {draft.slices.length > 2 && (
                        <Button type="button" variant="ghost" size="icon"
                          onClick={() => setDraft({ ...draft, slices: draft.slices.filter((_, i) => i !== idx) })}
                          aria-label={t("recurring.split.remove_slice")}>
                          <TrashIcon className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">
                          {draft.is_variable_amount ? t("recurring.split.ratio") : t("recurring.split.amount")}
                        </Label>
                        <Input
                          inputMode="decimal"
                          placeholder={draft.is_variable_amount ? "0.5" : ""}
                          value={draft.is_variable_amount ? s.amount_ratio : s.amount}
                          onChange={(e) => {
                            const next = [...draft.slices];
                            next[idx] = draft.is_variable_amount
                              ? { ...s, amount_ratio: e.target.value }
                              : { ...s, amount: e.target.value };
                            setDraft({ ...draft, slices: next });
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">{t("add.category")}</Label>
                        <Select value={s.category_id || "__none"} onValueChange={(v) => {
                          const next = [...draft.slices];
                          next[idx] = { ...s, category_id: v === "__none" ? "" : v };
                          setDraft({ ...draft, slices: next });
                        }}>
                          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">{t("common.none")}</SelectItem>
                            {categories.filter((c) => !c.archived).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">{t("recurring.split.description")}</Label>
                      <Input
                        ref={(el) => { sliceDescRefs.current[idx] = el; }}
                        value={s.description}
                        onFocus={() => setActiveSlice({ idx, field: "description" })}
                        onChange={(e) => {
                          const next = [...draft.slices]; next[idx] = { ...s, description: e.target.value };
                          setDraft({ ...draft, slices: next });
                        }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{t("recurring.split.note")}</Label>
                      <TagAutocompleteTextarea
                        ref={((el: HTMLTextAreaElement | null) => { sliceNoteRefs.current[idx] = el; }) as never}
                        value={s.note}
                        onChange={(v) => {
                          const next = [...draft.slices]; next[idx] = { ...s, note: v };
                          setDraft({ ...draft, slices: next });
                        }}
                        onFocus={() => setActiveSlice({ idx, field: "note" })}
                        transactions={txQ.data ?? []}
                        rows={2}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-md border bg-background p-2">
                      <Label htmlFor={`slice-reimb-${idx}`} className="text-xs">
                        {t("recurring.split.reimbursable")}
                      </Label>
                      <Switch
                        id={`slice-reimb-${idx}`}
                        checked={s.is_reimbursable}
                        onCheckedChange={(v) => {
                          const next = [...draft.slices]; next[idx] = { ...s, is_reimbursable: v };
                          setDraft({ ...draft, slices: next });
                        }}
                      />
                    </div>
                    {s.is_reimbursable && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">{t("recurring.split.counterparty")}</Label>
                          <Input value={s.reimbursable_counterparty} onChange={(e) => {
                            const next = [...draft.slices]; next[idx] = { ...s, reimbursable_counterparty: e.target.value };
                            setDraft({ ...draft, slices: next });
                          }} />
                        </div>
                        <div>
                          <Label className="text-xs">{t("recurring.split.reason")}</Label>
                          <Input value={s.reimbursable_reason} onChange={(e) => {
                            const next = [...draft.slices]; next[idx] = { ...s, reimbursable_reason: e.target.value };
                            setDraft({ ...draft, slices: next });
                          }} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {freshPastMode && (
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
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="backfill"
                      className="mt-1"
                      checked={draft.backfill === "pending"}
                      onChange={() => setDraft({ ...draft, backfill: "pending" })}
                    />
                    <span>{t("recurring.backfill.pending")}</span>
                  </label>
                </div>
              </div>
            )}
            {gapPastMode && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="text-sm font-medium">{t("recurring.backfill.gap_title")}</div>
                <div className="grid gap-2">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="backfill"
                      className="mt-1"
                      checked={draft.backfill === "none"}
                      onChange={() => setDraft({ ...draft, backfill: "none" })}
                    />
                    <span>{t("recurring.backfill.gap_none")}</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="backfill"
                      className="mt-1"
                      checked={draft.backfill === "pending"}
                      onChange={() => setDraft({ ...draft, backfill: "pending" })}
                    />
                    <span>{t("recurring.backfill.gap_pending")}</span>
                  </label>
                </div>
              </div>
            )}
            <PreviewPanel
              draft={draft}
              formatLocaleCode={settingsQ.data?.format_locale}
              isNew={isNew}
              postedCount={occStats.postedCount}
              pendingCount={occStats.pendingCount}
              lastPostedEffOn={occStats.lastPostedEffOn}
              showBackfillBlock={showBackfill}
              deterministicAuto={deterministicAuto}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => save()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!pendingConfirm} onOpenChange={(o) => { if (!o) setPendingConfirm(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("recurring.confirm_post_past.title")}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            {t("recurring.confirm_post_past.body", {
              n: pendingConfirm?.count ?? 0,
              sum: (pendingConfirm?.sum ?? 0).toFixed(2),
            })}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingConfirm(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => { setPendingConfirm(null); save({ confirmedPastPost: true }); }}>
              {t("recurring.confirm_post_past.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Insert `snippet` at the caret of the currently focused field. Falls back to
 * appending if the field's selection isn't accessible (e.g. lost focus).
 */
function insertPlaceholder({
  snippet,
  target,
  draft,
  setDraft,
  descRef,
  noteRef,
}: {
  snippet: string;
  target: "description" | "note";
  draft: Draft;
  setDraft: (d: Draft) => void;
  descRef: React.RefObject<HTMLInputElement | null>;
  noteRef: React.RefObject<HTMLTextAreaElement | null>;
}): void {
  const isDesc = target === "description";
  const el: HTMLInputElement | HTMLTextAreaElement | null =
    isDesc ? descRef.current : noteRef.current;
  const current = isDesc ? draft.description : draft.note;
  const start = el && typeof el.selectionStart === "number" ? el.selectionStart : current.length;
  const end = el && typeof el.selectionEnd === "number" ? el.selectionEnd : current.length;
  const next = current.slice(0, start) + snippet + current.slice(end);
  if (isDesc) setDraft({ ...draft, description: next });
  else setDraft({ ...draft, note: next });
  // Restore focus + caret position after React re-render.
  const newCaret = start + snippet.length;
  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    try { el.setSelectionRange(newCaret, newCaret); } catch { /* unsupported */ }
  });
}

function insertSlicePlaceholder({
  snippet,
  active,
  draft,
  setDraft,
  sliceDescRefs,
  sliceNoteRefs,
}: {
  snippet: string;
  active: { idx: number; field: "description" | "note" } | null;
  draft: Draft;
  setDraft: (d: Draft) => void;
  sliceDescRefs: React.MutableRefObject<Array<HTMLInputElement | null>>;
  sliceNoteRefs: React.MutableRefObject<Array<HTMLTextAreaElement | null>>;
}): void {
  // Fall back to appending to the first slice's description if nothing focused.
  const a = active ?? { idx: 0, field: "description" as const };
  const slice = draft.slices[a.idx];
  if (!slice) return;
  const isDesc = a.field === "description";
  const el: HTMLInputElement | HTMLTextAreaElement | null =
    isDesc ? sliceDescRefs.current[a.idx] : sliceNoteRefs.current[a.idx];
  const current = isDesc ? slice.description : slice.note;
  const start = el && typeof el.selectionStart === "number" ? el.selectionStart : current.length;
  const end = el && typeof el.selectionEnd === "number" ? el.selectionEnd : current.length;
  const text = current.slice(0, start) + snippet + current.slice(end);
  const next = [...draft.slices];
  next[a.idx] = isDesc ? { ...slice, description: text } : { ...slice, note: text };
  setDraft({ ...draft, slices: next });
  const newCaret = start + snippet.length;
  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    try { el.setSelectionRange(newCaret, newCaret); } catch { /* unsupported */ }
  });
}

function PlaceholderPalette({
  onInsert,
  formatLocaleCode,
}: {
  onInsert: (snippet: string) => void;
  formatLocaleCode?: string;
}) {
  const { t } = useI18n();
  const fmtLocale = resolveFormatLocale(formatLocaleCode);
  const sampleCtx = React.useMemo(() => {
    const today = new Date();
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
    const next = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
    return { date: today, dueDate: today, prevDate: prev, nextDate: next, today, runNumber: 3, locale: fmtLocale };
  }, [fmtLocale]);
  const [showFormatHelp, setShowFormatHelp] = React.useState(false);
  return (
    <div className="rounded-md border p-2">
      <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
        {t("recurring.placeholders.title")}
      </div>
      <div className="flex flex-wrap gap-1">
        {describeTokens().map((tok) => (
          <PlaceholderChip key={tok.token} tok={tok} sampleCtx={sampleCtx} onInsert={onInsert} />
        ))}
      </div>
      <button
        type="button"
        onClick={() => setShowFormatHelp((v) => !v)}
        className="mt-2 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        aria-expanded={showFormatHelp}
      >
        {showFormatHelp ? "▾ " : "▸ "}{t("recurring.placeholders.format_help.title")}
      </button>
      {showFormatHelp && (
        <div className="mt-1 whitespace-pre-line rounded border bg-muted/30 p-2 text-[11px] text-muted-foreground">
          {t("recurring.placeholders.format_help.body")}
        </div>
      )}
    </div>
  );
}

function PlaceholderChip({
  tok,
  sampleCtx,
  onInsert,
}: {
  tok: TokenInfo;
  sampleCtx: Parameters<typeof interpolate>[1];
  onInsert: (snippet: string) => void;
}) {
  const snippet = `\${${tok.token}}`;
  const exampleResolved = interpolate(tok.example, sampleCtx);
  return (
    <HoverCard openDelay={200} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          // Prevent the field from losing focus before the click handler runs,
          // so we can read its selection range to insert at the caret.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(snippet)}
          className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
        >
          {snippet}
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        collisionPadding={12}
        avoidCollisions
        className="w-72 space-y-1 text-xs"
      >
        <div className="font-medium">{snippet}</div>
        <div className="text-muted-foreground">{tok.help}</div>
        <div className="font-mono text-[11px]">
          <span className="text-muted-foreground">e.g. </span>
          <span>{tok.example}</span>
          <span className="text-muted-foreground"> → </span>
          <span>{exampleResolved}</span>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function PreviewPanel({
  draft, formatLocaleCode,
  isNew, postedCount, pendingCount, lastPostedEffOn,
  showBackfillBlock, deterministicAuto,
}: {
  draft: Draft;
  formatLocaleCode?: string;
  isNew: boolean;
  postedCount: number;
  pendingCount: number;
  lastPostedEffOn: string | null;
  showBackfillBlock: boolean;
  deterministicAuto: boolean;
}) {
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
  const fmtLocale = resolveFormatLocale(formatLocaleCode);
  const startsOnDate = draft.starts_on ? parseISO(draft.starts_on) : new Date();
  // Past rows = preview rows scheduled before today. For edits with existing
  // posted history, only count those beyond the last posted occurrence (the
  // "gap"); for fresh/new, count all past rows.
  const pastRows = React.useMemo(() => {
    return rows.filter((r) => {
      if (!r.in_past) return false;
      if (lastPostedEffOn && r.effective_on <= lastPostedEffOn) return false;
      return true;
    });
  }, [rows, lastPostedEffOn]);
  const futureCount = rows.filter((r) => !r.in_past).length;
  const totalAmt = draft.is_variable_amount
    ? Number(draft.estimated_amount) || 0
    : Number(draft.amount) || 0;
  // Will the save trigger actual past auto-posting?
  const willAutoPostPast =
    deterministicAuto && pastRows.length > 0 && (
      (showBackfillBlock && draft.backfill === "post") ||
      // Edit case: past dates not yet covered by posted rows will become
      // pending occurrences and get auto-posted by process_recurring_rules.
      (!isNew && draft.backfill !== "none")
    );
  // Stash count on window so save() confirm dialog can pick it up.
  React.useEffect(() => {
    (window as unknown as { __recImpactPastCount?: number }).__recImpactPastCount = pastRows.length;
  }, [pastRows.length]);
  // For split preview, compute slice amounts from the rule total.
  const splitTotal = draft.is_variable_amount
    ? Number(draft.estimated_amount || draft.amount) || 0
    : Number(draft.amount) || 0;
  let sliceAmounts: number[] | null = null;
  if (draft.is_split && splitTotal > 0 && draft.slices.length >= 2) {
    try {
      sliceAmounts = computeSliceAmounts(
        draft.slices.map((s) => ({
          amount: draft.is_variable_amount ? null : (Number(s.amount.replace(",", ".")) || 0),
          amount_ratio: draft.is_variable_amount ? (Number(s.amount_ratio.replace(",", ".")) || 0) : null,
        })),
        splitTotal,
      );
    } catch { sliceAmounts = null; }
  }
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{t("recurring.preview.title")}</div>
      {!enabled || rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t("recurring.preview.empty")}</div>
      ) : (
        <div className="max-h-40 overflow-y-auto pr-1">
          <ul className="space-y-1">
            {rows.map((r, i) => {
              const eff = parseISO(r.effective_on);
              const due = parseISO(r.due_on);
              const prev = i === 0 ? startsOnDate : parseISO(rows[i - 1].effective_on);
              const next = i < rows.length - 1 ? parseISO(rows[i + 1].effective_on) : null;
              const ctx = {
                date: eff, dueDate: due, prevDate: prev, nextDate: next,
                today: new Date(), runNumber: i + 1, locale: fmtLocale,
              };
              const resolved = interpolate(draft.description, ctx);
              const resolvedNote = interpolate(draft.note, ctx);
              return (
                <li key={i} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className={r.in_past ? "text-muted-foreground" : ""}>
                      {format(eff, "PP", { locale })}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {r.in_past ? t("recurring.preview.past") : t("recurring.preview.future")}
                    </Badge>
                  </div>
                  {!draft.is_split && resolved && draft.description && (
                    <div className="truncate font-mono text-[11px] text-muted-foreground" title={resolved}>
                      {resolved}
                    </div>
                  )}
                  {!draft.is_split && draft.note.trim() && (
                    <div className="text-[11px] text-muted-foreground">
                      <Markdown>{resolvedNote.trim()}</Markdown>
                    </div>
                  )}
                  {draft.is_split && draft.slices.length > 0 && (
                    <ul className="mt-1 space-y-0.5 border-l border-dashed border-border/60 pl-2">
                      {draft.slices.map((s, si) => {
                        const sResolvedDesc = interpolate(s.description, ctx);
                        const sResolvedNote = interpolate(s.note, ctx);
                        const amt = sliceAmounts ? sliceAmounts[si]?.toFixed(2) : "—";
                        return (
                          <li key={si} className="text-[11px] text-muted-foreground">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate">{sResolvedDesc || `${t("recurring.split.slice", { n: si + 1 })}`}</span>
                              <span className="tabular-nums">{amt}</span>
                            </div>
                            {s.note.trim() && (
                              <div className="text-[11px]"><Markdown>{sResolvedNote.trim()}</Markdown></div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {draft.starts_on < today && showBackfillBlock && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          {t("recurring.preview.note_past")}
        </div>
      )}
      <div className="mt-3 rounded-md border bg-muted/30 p-2 text-[11px]">
        <div className="mb-1 font-semibold uppercase text-muted-foreground">
          {t("recurring.impact.title")}
        </div>
        <ul className="space-y-0.5">
          {willAutoPostPast && (
            <li className="text-destructive">
              {t("recurring.impact.auto_post_past", {
                n: pastRows.length,
                sum: (totalAmt * pastRows.length).toFixed(2),
              })}
            </li>
          )}
          {!willAutoPostPast && pastRows.length > 0 && draft.backfill === "pending" && (
            <li>{t("recurring.impact.pending_past", { n: pastRows.length })}</li>
          )}
          {!willAutoPostPast && pastRows.length > 0 && draft.backfill === "none" && showBackfillBlock && (
            <li className="text-muted-foreground">{t("recurring.impact.skipped_past", { n: pastRows.length })}</li>
          )}
          <li className="text-muted-foreground">
            {t("recurring.impact.future", { n: futureCount })}
          </li>
          {!isNew && (
            <li className="text-muted-foreground">
              {t("recurring.impact.regenerated", { pending: pendingCount, posted: postedCount })}
            </li>
          )}
          {draft.is_split && draft.slices.length >= 2 && (
            <li className="text-muted-foreground">
              {t("recurring.impact.split_note", { k: draft.slices.length })}
            </li>
          )}
          {(draft.is_variable_amount || draft.is_variable_date) && (
            <li className="text-muted-foreground">
              {t("recurring.impact.variable_note")}
            </li>
          )}
          {pastRows.length === 0 && isNew && (
            <li className="text-muted-foreground">{t("recurring.impact.no_change")}</li>
          )}
        </ul>
      </div>
    </div>
  );
}