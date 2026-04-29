import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  fetchPendingOccurrences, postOccurrence, skipOccurrence, fmtMoney,
  type RecurringOccurrence, type RecurringRule,
} from "@/lib/finance";
import { useI18n } from "@/i18n";
import { PostOccurrenceDialog } from "@/components/PostOccurrenceDialog";

export function UpcomingCard({ symbol }: { symbol: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const occQ = useQuery({ queryKey: ["pending_occurrences"], queryFn: fetchPendingOccurrences });
  const occs = occQ.data ?? [];
  const [amounts, setAmounts] = React.useState<Record<string, string>>({});
  const [visibleCount, setVisibleCount] = React.useState(10);
  const [dialogOcc, setDialogOcc] = React.useState<(RecurringOccurrence & { rule: RecurringRule }) | null>(null);

  React.useEffect(() => {
    setVisibleCount(10);
  }, [occs.length]);

  if (occQ.isLoading || occs.length === 0) return null;

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const visibleOccs = occs.slice(0, visibleCount);
  const hasMore = visibleCount < occs.length;

  const onPost = async (o: RecurringOccurrence & { rule: RecurringRule }) => {
    // Non-auto-post rules: open the rich dialog so the user can edit
    // date / description / note (with placeholder interpolation) before
    // the transaction is created.
    if (!o.rule.auto_post) {
      setDialogOcc(o);
      return;
    }
    try {
      if (o.rule.is_variable_amount) {
        const raw = amounts[o.id];
        const amt = Number(raw);
        if (!raw || !Number.isFinite(amt) || amt <= 0) {
          toast.error(t("dashboard.upcoming.amount_required"));
          return;
        }
        await postOccurrence(o, { amount: amt });
      } else {
        await postOccurrence(o);
      }
      toast.success(t("recurring.toast.posted"));
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const onSkip = async (id: string) => {
    try {
      await skipOccurrence(id);
      toast.success(t("recurring.toast.skipped"));
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{t("dashboard.upcoming")}</CardTitle></CardHeader>
      <CardContent className="divide-y p-0">
        {visibleOccs.map((o) => {
          const eff = parseISO(o.effective_on);
          const diff = differenceInCalendarDays(eff, today);
          let label: string; let late = false;
          if (diff < 0) {
            label = Math.abs(diff) === 1 ? t("dashboard.upcoming.late_by_one") : t("dashboard.upcoming.late_by", { n: Math.abs(diff) });
            late = true;
          } else if (diff === 0) {
            label = t("dashboard.upcoming.due_today");
          } else if (diff === 1) {
            label = t("dashboard.upcoming.due_in_one");
          } else {
            label = t("dashboard.upcoming.due_in", { n: diff });
          }
          const sign = o.rule.type === "expense" ? "-" : o.rule.type === "income" ? "+" : "";
          const tone = o.rule.type === "expense" ? "text-destructive" : o.rule.type === "income" ? "text-success" : "text-muted-foreground";
          const isVar = o.rule.is_variable_amount;
          const inputVal = amounts[o.id] ?? "";
          const canPost = !isVar || (inputVal !== "" && Number(inputVal) > 0);
          return (
            <div key={o.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{o.rule.name}</span>
                  <Badge variant="outline" className={cn("text-[10px]", late && "border-destructive text-destructive")}>{label}</Badge>
                  {isVar && <Badge variant="outline" className="text-[10px]">{t("recurring.variable_badge")}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">{format(eff, "PP", { locale })}</div>
              </div>
              {isVar ? (
                <Input
                  inputMode="decimal"
                  className="w-24 text-right"
                  placeholder={o.rule.estimated_amount != null ? Number(o.rule.estimated_amount).toFixed(2) : t("dashboard.upcoming.enter_amount")}
                  value={inputVal}
                  onChange={(e) => setAmounts((m) => ({ ...m, [o.id]: e.target.value }))}
                />
              ) : (
                <div className={cn("text-sm font-semibold tabular-nums", tone)}>
                  {sign}{fmtMoney(Number(o.rule.amount ?? 0), symbol).replace("-", "")}
                </div>
              )}
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => onSkip(o.id)}>{t("dashboard.upcoming.skip")}</Button>
                <Button size="sm" onClick={() => onPost(o)} disabled={!canPost}>{t("dashboard.upcoming.post")}</Button>
              </div>
            </div>
          );
        })}
        {hasMore && (
          <div className="flex items-center justify-center gap-2 px-4 py-3">
            <Button size="sm" variant="outline" onClick={() => setVisibleCount((n) => n + 10)}>
              {t("dashboard.upcoming.show_more")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setVisibleCount(occs.length)}>
              {t("dashboard.upcoming.show_all", { n: occs.length })}
            </Button>
          </div>
        )}
      </CardContent>
      <PostOccurrenceDialog
        occurrence={dialogOcc}
        runNumber={dialogOcc ? computeRunNumber(occs, dialogOcc) : 1}
        prevDate={dialogOcc ? computePrevDate(occs, dialogOcc) : (dialogOcc?.rule.starts_on ?? "")}
        nextDate={dialogOcc ? computeNextDate(occs, dialogOcc) : null}
        onClose={() => setDialogOcc(null)}
        onPosted={() => qc.invalidateQueries()}
      />
    </Card>
  );
}

/** Count of posted+skipped+this occurrences for the rule up to and including `target`.
 * We approximate by counting pending occurrences for the same rule that are
 * scheduled on or before the target's effective_on plus 1 (the target itself
 * not yet posted). For the run-number we need ALL historic posts too; since
 * we only have pendings here, fall back to: position among pendings of this
 * rule sorted by effective_on (1-based). This is a best-effort counter that
 * matches what the user sees on screen. */
function computeRunNumber(all: (RecurringOccurrence & { rule: RecurringRule })[], target: RecurringOccurrence & { rule: RecurringRule }): number {
  const sameRule = all
    .filter((o) => o.rule.id === target.rule.id)
    .sort((a, b) => a.effective_on.localeCompare(b.effective_on));
  const idx = sameRule.findIndex((o) => o.id === target.id);
  return Math.max(1, idx + 1);
}

function computePrevDate(all: (RecurringOccurrence & { rule: RecurringRule })[], target: RecurringOccurrence & { rule: RecurringRule }): string {
  const sameRule = all
    .filter((o) => o.rule.id === target.rule.id)
    .sort((a, b) => a.effective_on.localeCompare(b.effective_on));
  const idx = sameRule.findIndex((o) => o.id === target.id);
  if (idx > 0) return sameRule[idx - 1].effective_on;
  return target.rule.starts_on;
}

function computeNextDate(all: (RecurringOccurrence & { rule: RecurringRule })[], target: RecurringOccurrence & { rule: RecurringRule }): string | null {
  const sameRule = all
    .filter((o) => o.rule.id === target.rule.id)
    .sort((a, b) => a.effective_on.localeCompare(b.effective_on));
  const idx = sameRule.findIndex((o) => o.id === target.id);
  return idx >= 0 && idx < sameRule.length - 1 ? sameRule[idx + 1].effective_on : null;
}