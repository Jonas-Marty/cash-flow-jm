import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseISO } from "date-fns";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/DateInput";
import { useI18n } from "@/i18n";
import {
  deleteReallocation,
  fetchCategories,
  fetchReallocations,
  fetchSettings,
  updateReallocation,
} from "@/lib/finance";
import { invalidateReallocationQueries } from "@/lib/budgetQueries";

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Edit or delete one reallocation. The budgets stay as they are: moving it to
 * other budgets is a different reallocation, so that is delete and redo.
 */
export function ReallocationEditDialog({
  reallocationId,
  onOpenChange,
}: {
  reallocationId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const open = !!reallocationId;
  const reallocQ = useQuery({
    queryKey: ["reallocations"],
    queryFn: fetchReallocations,
    enabled: open,
  });
  const catsQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, enabled: open });
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings, enabled: open });
  const symbol = settingsQ.data?.currency_symbol ?? "CHF";

  const r = React.useMemo(
    () => (reallocQ.data ?? []).find((x) => x.id === reallocationId) ?? null,
    [reallocQ.data, reallocationId],
  );
  const catById = React.useMemo(
    () => new Map((catsQ.data ?? []).map((c) => [c.id, c])),
    [catsQ.data],
  );

  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState<Date>(new Date());
  const [note, setNote] = React.useState("");
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    if (!r) return;
    setAmount(Number(r.amount).toFixed(2));
    setDate(parseISO(r.occurred_on));
    setNote(r.note ?? "");
    setConfirmDelete(false);
  }, [r]);

  const done = async (message: string) => {
    await invalidateReallocationQueries(qc);
    toast.success(message);
    onOpenChange(false);
  };

  const save = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0)
        throw new Error(t("envelopes.reallocate.invalid_amount"));
      await updateReallocation(reallocationId!, {
        amount: Math.round(amt * 100) / 100,
        occurred_on: isoDate(date),
        note: note.trim() || null,
      });
    },
    onSuccess: () => done(t("toast.saved")),
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: () => deleteReallocation(reallocationId!),
    onSuccess: () => done(t("env.realloc_edit.deleted")),
    onError: (e: Error) => toast.error(e.message),
  });
  const busy = save.isPending || del.isPending;

  const from = r?.from_category_id ? catById.get(r.from_category_id) : null;
  const to = r?.to_category_id ? catById.get(r.to_category_id) : null;
  // An empty side is money no envelope held: "Nicht zugeordnet".
  const sideName = (id: string | null | undefined, c: typeof from) =>
    id ? (c?.name ?? t("env.ledger.unknown_category")) : t("env.moves.unassigned");
  const scope = to?.is_scope ? to : from?.is_scope ? from : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("env.realloc_edit.title")}</DialogTitle>
          <DialogDescription>{t("env.realloc_edit.description")}</DialogDescription>
        </DialogHeader>
        {!r ? (
          <p className="py-4 text-sm text-muted-foreground">
            {reallocQ.isLoading ? t("common.loading") : t("env.realloc_edit.missing")}
          </p>
        ) : (
          <div className="grid gap-3">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">{t("envelopes.reallocate.from")}</span>
              <span className="truncate font-medium">{sideName(r.from_category_id, from)}</span>
              <span className="text-muted-foreground">{t("envelopes.reallocate.to")}</span>
              <span className="truncate font-medium">{sideName(r.to_category_id, to)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="realloc-edit-amount">
                  {t("envelopes.reallocate.amount")} ({symbol})
                </Label>
                <Input
                  id="realloc-edit-amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("envelopes.reallocate.date")}</Label>
                <DateInput value={date} onChange={setDate} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="realloc-edit-note">
                {t("envelopes.reallocate.note")} {t("common.optional")}
              </Label>
              <Textarea
                id="realloc-edit-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {scope && (
              <p className="text-xs text-muted-foreground">
                {t("env.realloc_edit.scope_hint", { name: scope.name })}
              </p>
            )}
          </div>
        )}
        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          {r ? (
            <Button
              variant={confirmDelete ? "destructive" : "ghost"}
              className={confirmDelete ? "" : "text-destructive hover:text-destructive"}
              disabled={busy}
              onClick={() => (confirmDelete ? del.mutate() : setConfirmDelete(true))}
            >
              {confirmDelete ? t("env.realloc_edit.delete_confirm") : t("common.delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            {r && (
              <Button onClick={() => save.mutate()} disabled={busy || !amount}>
                {save.isPending ? t("common.saving") : t("common.save")}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
