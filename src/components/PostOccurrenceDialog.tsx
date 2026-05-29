import * as React from "react";
import { format, parseISO } from "date-fns";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/DateInput";
import { useI18n } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import {
  fetchSettings, postOccurrence,
  type RecurringOccurrence, type RecurringRule,
} from "@/lib/finance";
import { interpolate, resolveFormatLocale, describeTokens } from "@/lib/placeholders";
import { toast } from "sonner";

type Occ = RecurringOccurrence & { rule: RecurringRule };

interface Props {
  occurrence: Occ | null;
  /** runNumber computed by caller (1-based count for this rule including current) */
  runNumber: number;
  /** previous effective date (or rule's starts_on if none) */
  prevDate: string;
  /** next effective date (ISO) or null */
  nextDate: string | null;
  /** initial amount override (e.g. value typed on the dashboard for variable-amount rules) */
  initialAmount?: string;
  onClose: () => void;
  onPosted: () => void;
}

export function PostOccurrenceDialog({ occurrence, runNumber, prevDate, nextDate, initialAmount, onClose, onPosted }: Props) {
  const { t, lang } = useI18n();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });

  const [date, setDate] = React.useState<string>("");
  const [description, setDescription] = React.useState<string>("");
  const [note, setNote] = React.useState<string>("");
  const [amount, setAmount] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!occurrence) return;
    setDate(occurrence.effective_on);
    setDescription(occurrence.rule.description ?? "");
    setNote(occurrence.rule.note ?? "");
    if (occurrence.rule.is_variable_amount) {
      if (initialAmount && initialAmount.trim() !== "") {
        setAmount(initialAmount);
      } else if (occurrence.rule.estimated_amount != null) {
        setAmount(String(occurrence.rule.estimated_amount));
      } else {
        setAmount("");
      }
    } else {
      setAmount("");
    }
    setBusy(false);
  }, [occurrence, initialAmount]);

  const ctx = React.useMemo(() => {
    if (!occurrence) return null;
    return {
      date: parseISO(date || occurrence.effective_on),
      dueDate: parseISO(occurrence.due_on),
      prevDate: parseISO(prevDate),
      nextDate: nextDate ? parseISO(nextDate) : null,
      today: new Date(),
      runNumber,
      locale: resolveFormatLocale(settingsQ.data?.format_locale),
    };
  }, [date, occurrence, prevDate, nextDate, runNumber, settingsQ.data?.format_locale]);

  if (!occurrence || !ctx) return null;
  const r = occurrence.rule;

  const resolvedDesc = interpolate(description, ctx);
  const resolvedNote = interpolate(note, ctx);

  const onPost = async () => {
    if (r.is_variable_amount) {
      const a = Number(amount);
      if (!Number.isFinite(a) || a <= 0) { toast.error(t("dashboard.upcoming.amount_required")); return; }
    }
    setBusy(true);
    try {
      await postOccurrence(occurrence, {
        occurred_on: date,
        description: resolvedDesc || null,
        note: resolvedNote || null,
        ...(r.is_variable_amount ? { amount: Number(amount) } : {}),
      });
      toast.success(t("recurring.toast.posted"));
      onPosted();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const insertToken = (token: string) => {
    setDescription((prev) => `${prev}\${${token}}`);
  };

  return (
    <Dialog open={!!occurrence} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest("[data-radix-popper-content-wrapper], [role='listbox'], [data-radix-select-content], [data-radix-popover-content]")) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest("[data-radix-popper-content-wrapper], [role='listbox'], [data-radix-select-content], [data-radix-popover-content]")) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("recurring.post_dialog.title")} — {r.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">{t("recurring.post_dialog.date")}</Label>
            <DateInput
              value={parseISO(date || occurrence.effective_on)}
              onChange={(d) => setDate(format(d, "yyyy-MM-dd"))}
              formatStr={settingsQ.data?.date_format}
              lang={lang}
            />
          </div>
          {r.is_variable_amount && (
            <div>
              <Label className="text-xs">{t("recurring.post_dialog.amount")}</Label>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={r.estimated_amount != null ? Number(r.estimated_amount).toFixed(2) : ""}
              />
            </div>
          )}
          <div>
            <Label className="text-xs">{t("recurring.post_dialog.description")}</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="mt-1 text-xs text-muted-foreground">
              {t("recurring.post_dialog.preview")}: <span className="font-mono">{resolvedDesc || "—"}</span>
            </div>
          </div>
          <div>
            <Label className="text-xs">{t("recurring.post_dialog.note")}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
            {note && (
              <div className="mt-1 text-xs text-muted-foreground">
                <span className="font-mono">{resolvedNote || "—"}</span>
              </div>
            )}
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
                  onClick={() => insertToken(tok.token)}
                  className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
                  title={tok.help}
                >
                  {`\${${tok.token}}`}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button onClick={onPost} disabled={busy}>{t("dashboard.upcoming.post")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
