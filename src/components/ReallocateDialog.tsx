import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/DateInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createReallocation,
  fetchCategories,
  fetchSettings,
  todayISO,
  type Category,
} from "@/lib/finance";
import { toast } from "sonner";

interface Props {
  open: boolean;
  /** Pre-selected source envelope (savings) */
  defaultFromId?: string | null;
  /** Pre-selected target envelope (savings) */
  defaultToId?: string | null;
  /** Pre-filled amount (e.g. when archiving) */
  defaultAmount?: number | null;
  onOpenChange: (open: boolean) => void;
  onReallocated?: () => void;
}

export function ReallocateDialog({ open, defaultFromId, defaultToId, defaultAmount, onOpenChange, onReallocated }: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings, enabled: open });
  const cats = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, enabled: open });

  const symbol = settingsQ.data?.currency_symbol ?? "CHF";
  const savings = React.useMemo<Category[]>(
    () => (cats.data ?? []).filter((c) => c.is_savings && !c.archived),
    [cats.data],
  );

  const [fromId, setFromId] = React.useState<string>("");
  const [toId, setToId] = React.useState<string>("");
  const [amount, setAmount] = React.useState<string>("");
  const [date, setDate] = React.useState<Date>(new Date());
  const [note, setNote] = React.useState<string>("");

  React.useEffect(() => {
    if (!open) return;
    setFromId(defaultFromId ?? "");
    setToId(defaultToId ?? "");
    setAmount(defaultAmount != null ? String(defaultAmount) : "");
    setDate(new Date());
    setNote("");
  }, [open, defaultFromId, defaultToId, defaultAmount]);

  const mut = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error(t("envelopes.reallocate.invalid_amount"));
      if (!fromId || !toId) throw new Error(t("envelopes.reallocate.same_endpoint"));
      if (fromId === toId) throw new Error(t("envelopes.reallocate.same_endpoint"));
      await createReallocation({
        from_category_id: fromId,
        to_category_id: toId,
        amount: amt,
        occurred_on: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
        note: note.trim() || null,
      });
    },
    onSuccess: async () => {
      toast.success(t("envelopes.reallocate.success"));
      await qc.invalidateQueries({ queryKey: ["savings-balances-v2"] });
      await qc.invalidateQueries({ queryKey: ["reallocations"] });
      await qc.invalidateQueries({ queryKey: ["reconciliation"] });
      onReallocated?.();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("envelopes.reallocate.title")}</DialogTitle>
          <DialogDescription>{t("envelopes.reallocate.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{t("envelopes.reallocate.from")}</Label>
            <Select value={fromId} onValueChange={setFromId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {savings.map((c) => (
                  <SelectItem key={c.id} value={c.id} disabled={c.id === toId}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("envelopes.reallocate.to")}</Label>
            <Select value={toId} onValueChange={setToId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {savings.map((c) => (
                  <SelectItem key={c.id} value={c.id} disabled={c.id === fromId}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("envelopes.reallocate.amount")} ({symbol})</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("envelopes.reallocate.date")}</Label>
              <DateInput value={date} onChange={setDate} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("envelopes.reallocate.note")} {t("common.optional")}</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !fromId || !toId || !amount}>
            {mut.isPending ? t("common.saving") : t("envelopes.reallocate.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}