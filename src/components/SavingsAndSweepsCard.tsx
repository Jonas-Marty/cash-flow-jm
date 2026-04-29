import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  fetchCategories,
  fetchCategoryGroups,
  fetchSettings,
  fetchReconciliationSummary,
  setDefaultSweepTarget,
  setCategorySweepTarget,
  setGroupSweepTarget,
  fmtMoney,
  type Category,
  type CategoryGroup,
} from "@/lib/finance";

const NONE = "__none";

export function SavingsAndSweepsCard() {
  const { t: tr } = useI18n();
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const cats = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const groups = useQuery({ queryKey: ["category_groups"], queryFn: fetchCategoryGroups });
  const reconQ = useQuery({ queryKey: ["reconciliation"], queryFn: () => fetchReconciliationSummary() });

  const symbol = settingsQ.data?.currency_symbol ?? "CHF";
  const savings: Category[] = (cats.data ?? []).filter((c) => c.is_savings && !c.archived);
  const expenseCats: Category[] = (cats.data ?? []).filter((c) => !c.is_savings && !c.archived);
  const expenseGroups: CategoryGroup[] = (groups.data ?? []).filter((g) => g.kind !== "income" && !g.archived);

  const defaultId = settingsQ.data?.default_sweep_category_id ?? null;

  const setDefault = useMutation({
    mutationFn: async (id: string | null) => setDefaultSweepTarget(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["reconciliation"] });
      await qc.invalidateQueries({ queryKey: ["savings-balances-v2"] });
      toast.success(tr("common.save"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setCat = useMutation({
    mutationFn: async ({ id, target }: { id: string; target: string | null }) => setCategorySweepTarget(id, target),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["categories"] });
      await qc.invalidateQueries({ queryKey: ["reconciliation"] });
      await qc.invalidateQueries({ queryKey: ["savings-balances-v2"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setGrp = useMutation({
    mutationFn: async ({ id, target }: { id: string; target: string | null }) => setGroupSweepTarget(id, target),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["category_groups"] });
      await qc.invalidateQueries({ queryKey: ["reconciliation"] });
      await qc.invalidateQueries({ queryKey: ["savings-balances-v2"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recon = reconQ.data;
  const driftAbs = recon ? Math.abs(Number(recon.drift)) : 0;
  const driftOk = driftAbs < 0.005;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{tr("settings.savings.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        {/* Default sweep target */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{tr("settings.savings.default_target")}</Label>
          <Select
            value={defaultId ?? NONE}
            onValueChange={(v) => setDefault.mutate(v === NONE ? null : v)}
          >
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{tr("common.none")}</SelectItem>
              {savings.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{tr("settings.savings.default_target_hint")}</p>
        </div>

        {/* Reconciliation */}
        {recon && (
          <div className="rounded-md border p-3 space-y-1.5 text-sm">
            <div className="font-medium">{tr("settings.savings.reconciliation")}</div>
            <div className="flex justify-between"><span className="text-muted-foreground">{tr("settings.savings.accounts_total")}</span><span className="tabular-nums">{fmtMoney(Number(recon.accounts_total), symbol)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{tr("settings.savings.savings_total")}</span><span className="tabular-nums">{fmtMoney(Number(recon.savings_total), symbol)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{tr("settings.savings.unswept")}</span><span className="tabular-nums">{fmtMoney(Number(recon.unswept_current_month), symbol)}</span></div>
            <div className="flex justify-between border-t pt-1.5">
              <span className="font-medium">{tr("settings.savings.drift")}</span>
              <span className={cn("tabular-nums font-semibold", driftOk ? "text-success" : "text-warning")}>
                {driftOk ? tr("settings.savings.drift_ok") : fmtMoney(Number(recon.drift), symbol)}
              </span>
            </div>
            {!driftOk && <p className="text-xs text-muted-foreground">{tr("settings.savings.drift_help")}</p>}
          </div>
        )}

        {/* Per-group overrides */}
        {expenseGroups.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">{tr("common.group")} → {tr("envelopes.sweep.target")}</Label>
            <ul className="divide-y rounded-md border">
              {expenseGroups.map((g) => {
                const target = g.sweep_target_category_id ?? null;
                return (
                  <li key={g.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="truncate">{g.name}</span>
                    <div className="flex items-center gap-1">
                      <Select
                        value={target ?? NONE}
                        onValueChange={(v) => setGrp.mutate({ id: g.id, target: v === NONE ? null : v })}
                      >
                        <SelectTrigger className="h-8 w-[180px]"><SelectValue placeholder={tr("envelopes.sweep.use_default")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>{tr("envelopes.sweep.use_default")}</SelectItem>
                          {savings.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Per-category overrides (only those with non-null override, to keep list short) */}
        {expenseCats.some((c) => c.sweep_target_category_id) && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">{tr("settings.envelopes")} → {tr("envelopes.sweep.target")}</Label>
            <ul className="divide-y rounded-md border">
              {expenseCats.filter((c) => c.sweep_target_category_id).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="truncate">{c.name}</span>
                  <div className="flex items-center gap-1">
                    <Select
                      value={c.sweep_target_category_id ?? NONE}
                      onValueChange={(v) => setCat.mutate({ id: c.id, target: v === NONE ? null : v })}
                    >
                      <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{tr("envelopes.sweep.use_default")}</SelectItem>
                        {savings.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="sm" onClick={() => setCat.mutate({ id: c.id, target: null })}>
                      {tr("common.clear")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}