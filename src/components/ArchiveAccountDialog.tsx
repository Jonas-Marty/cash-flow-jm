import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateInput } from "@/components/DateInput";
import { useI18n } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { fetchAccounts, fetchCategories, fmtMoney, type Account } from "@/lib/finance";

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Archiving an account that still holds money would take that money out of the
 * books while its transactions keep counting for the budgets. The database
 * refuses it, so the remainder is booked out first: to another account in the
 * same currency, or into a category (spent when money is left, income when a
 * debt is). archive_account does both in one step.
 */
export function ArchiveAccountDialog({
  account,
  balance,
  onOpenChange,
}: {
  account: Account | null;
  balance: number;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const open = !!account;
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, enabled: open });
  const catsQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, enabled: open });

  const left = balance > 0; // money left (out) vs. a debt left (in)
  const counterAccounts = React.useMemo(
    () =>
      (accountsQ.data ?? []).filter(
        (a) => !a.archived && a.id !== account?.id && a.currency_code === account?.currency_code,
      ),
    [accountsQ.data, account],
  );
  const categories = React.useMemo(
    () => (catsQ.data ?? []).filter((c) => !c.archived && !c.is_scope),
    [catsQ.data],
  );

  const [mode, setMode] = React.useState<"account" | "category">("account");
  const [counterId, setCounterId] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [date, setDate] = React.useState<Date>(new Date());
  const [description, setDescription] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setMode(counterAccounts.length > 0 ? "account" : "category");
    setCounterId("");
    setCategoryId("");
    setDate(new Date());
    setDescription(t("settings.archive.default_description"));
    // counterAccounts settles after the query; only reset on (re)open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id]);

  const mut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("archive_account", {
        p_account_id: account!.id,
        p_counter_account_id: mode === "account" ? counterId : null,
        p_category_id: mode === "category" ? categoryId : null,
        p_on: isoDate(date),
        p_description: description.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(t("settings.archive.done", { name: account!.name }));
      await qc.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ready = mode === "account" ? !!counterId : !!categoryId;
  const sym = account?.currency_symbol ?? "CHF";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings.archive.title", { name: account?.name ?? "" })}</DialogTitle>
          <DialogDescription>
            {t("settings.archive.has_balance", {
              name: account?.name ?? "",
              balance: fmtMoney(balance, sym),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as "account" | "category")}
            className="gap-3"
          >
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  id="archive-mode-account"
                  value="account"
                  disabled={counterAccounts.length === 0}
                />
                <Label htmlFor="archive-mode-account">
                  {t(left ? "settings.archive.to_account_out" : "settings.archive.to_account_in")}
                </Label>
              </div>
              {counterAccounts.length === 0 ? (
                <p className="ml-6 text-xs text-muted-foreground">
                  {t("settings.archive.to_account_none", { cur: account?.currency_code ?? "" })}
                </p>
              ) : (
                mode === "account" && (
                  <Select value={counterId} onValueChange={setCounterId}>
                    <SelectTrigger
                      className="ml-6 w-[calc(100%-1.5rem)]"
                      aria-label={t("settings.archive.account")}
                    >
                      <SelectValue placeholder={t("settings.archive.account")} />
                    </SelectTrigger>
                    <SelectContent>
                      {counterAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              )}
            </div>
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <RadioGroupItem id="archive-mode-category" value="category" />
                <Label htmlFor="archive-mode-category">
                  {t(left ? "settings.archive.to_category_out" : "settings.archive.to_category_in")}
                </Label>
              </div>
              {mode === "category" && (
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger
                    className="ml-6 w-[calc(100%-1.5rem)]"
                    aria-label={t("settings.archive.category")}
                  >
                    <SelectValue placeholder={t("settings.archive.category")} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </RadioGroup>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("settings.archive.date")}</Label>
              <DateInput value={date} onChange={setDate} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="archive-description">{t("settings.archive.description")}</Label>
              <Input
                id="archive-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => mut.mutate()} disabled={!ready || mut.isPending}>
            {mut.isPending ? t("common.saving") : t("settings.archive.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
