import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Target, Plus, Check, X, Trash2, RotateCcw } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  fetchCategories, fetchScopes, fetchScopeTotal, createScope, updateScope,
  closeScope, reopenScope, deleteScope, fetchSettings, fmtMoney,
  type Category,
} from "@/lib/finance";
import { useActiveScopeId } from "@/lib/activeScope";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/scopes")({
  component: ScopesRoute,
});

const NONE = "__none";

function ScopesRoute() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useActiveScopeId();
  const scopesQ = useQuery({ queryKey: ["scopes"], queryFn: fetchScopes });
  const catsQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const sym = settingsQ.data?.currency_symbol ?? "CHF";

  const fundingCandidates: Category[] = React.useMemo(
    () => (catsQ.data ?? []).filter((c) => !c.archived && !c.is_scope),
    [catsQ.data],
  );

  // Create form
  const [name, setName] = React.useState("");
  const [fundingId, setFundingId] = React.useState<string>(NONE);
  const [budget, setBudget] = React.useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error(t("scopes.toast.name_required"));
      return createScope({
        name: name.trim(),
        funding_category_id: fundingId === NONE ? null : fundingId,
        allocated_budget: budget ? Number(budget.replace(",", ".")) || 0 : 0,
      });
    },
    onSuccess: async () => {
      setName(""); setFundingId(NONE); setBudget("");
      await qc.invalidateQueries({ queryKey: ["scopes"] });
      await qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success(t("scopes.toast.created"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const active = (scopesQ.data ?? []).filter((s) => !s.closed_at);
  const closed = (scopesQ.data ?? []).filter((s) => s.closed_at);

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            {t("scopes.title")}
          </h1>
          <Button asChild variant="ghost" size="sm">
            <Link to="/settings">{t("common.back")}</Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t("scopes.subtitle")}</p>

        {/* Create */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="h-4 w-4" /> {t("scopes.create")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_auto]">
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">{t("common.name")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("scopes.name_placeholder")} />
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">{t("scopes.funding_from")}</Label>
                <Select value={fundingId} onValueChange={setFundingId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("scopes.no_funding")}</SelectItem>
                    {fundingCandidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">{t("scopes.planned")}</Label>
                <Input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" />
              </div>
              <div className="flex items-end">
                <Button onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>
                  {t("scopes.create_action")}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("scopes.create_hint")}</p>
          </CardContent>
        </Card>

        {/* Active scopes */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("scopes.active")}</h2>
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground italic">{t("scopes.empty_active")}</p>
          )}
          <div className="space-y-2">
            {active.map((s) => (
              <ScopeRow
                key={s.id}
                scope={s}
                fundingCandidates={fundingCandidates}
                symbol={sym}
                isActive={activeId === s.id}
                onActivate={() => { setActiveId(s.id); toast.success(t("scopes.toast.activated", { name: s.name })); }}
                onDeactivate={() => setActiveId(null)}
              />
            ))}
          </div>
        </div>

        {/* Closed scopes */}
        {closed.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("scopes.closed")}</h2>
            <div className="space-y-2">
              {closed.map((s) => (
                <ScopeRow
                  key={s.id}
                  scope={s}
                  fundingCandidates={fundingCandidates}
                  symbol={sym}
                  isActive={false}
                  onActivate={() => {}}
                  onDeactivate={() => {}}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ScopeRow({
  scope, fundingCandidates, symbol, isActive, onActivate, onDeactivate,
}: {
  scope: Category;
  fundingCandidates: Category[];
  symbol: string;
  isActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [, setActiveId] = useActiveScopeId();
  const totalQ = useQuery({
    queryKey: ["scope_total", scope.id],
    queryFn: () => fetchScopeTotal(scope.id),
  });
  const [editing, setEditing] = React.useState(false);
  const [editName, setEditName] = React.useState(scope.name);
  const [editFunding, setEditFunding] = React.useState<string>(scope.funding_category_id ?? NONE);
  const [editBudget, setEditBudget] = React.useState(String(scope.allocated_budget ?? 0));

  const funding = fundingCandidates.find((c) => c.id === scope.funding_category_id);
  const closed = !!scope.closed_at;

  const update = useMutation({
    mutationFn: () => updateScope(scope.id, {
      name: editName.trim(),
      funding_category_id: editFunding === NONE ? null : editFunding,
      allocated_budget: Number(editBudget.replace(",", ".")) || 0,
    }),
    onSuccess: async () => {
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["scopes"] });
      await qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success(t("common.save"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const close = useMutation({
    mutationFn: () => closeScope(scope.id),
    onSuccess: async (res) => {
      if (isActive) setActiveId(null);
      await qc.invalidateQueries({ queryKey: ["scopes"] });
      await qc.invalidateQueries({ queryKey: ["categories"] });
      await qc.invalidateQueries({ queryKey: ["reallocations"] });
      toast.success(
        t("scopes.toast.closed", { amount: fmtMoney(res.total, symbol) }),
        {
          action: {
            label: t("common.undo"),
            onClick: async () => {
              await reopenScope(scope.id, res.reallocationId);
              await qc.invalidateQueries({ queryKey: ["scopes"] });
              await qc.invalidateQueries({ queryKey: ["categories"] });
              await qc.invalidateQueries({ queryKey: ["reallocations"] });
              toast.success(t("scopes.toast.reopened"));
            },
          },
        },
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reopen = useMutation({
    mutationFn: () => reopenScope(scope.id, null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["scopes"] });
      await qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success(t("scopes.toast.reopened"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: () => deleteScope(scope.id),
    onSuccess: async () => {
      if (isActive) setActiveId(null);
      await qc.invalidateQueries({ queryKey: ["scopes"] });
      await qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success(t("common.deleted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const spent = totalQ.data?.spent ?? 0;
  const plan = Number(scope.allocated_budget ?? 0);

  return (
    <Card className={cn(isActive && "border-primary/60 ring-1 ring-primary/20")}>
      <CardContent className="space-y-3 py-3">
        {editing ? (
          <div className="space-y-2">
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_120px]">
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              <Select value={editFunding} onValueChange={setEditFunding}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("scopes.no_funding")}</SelectItem>
                  {fundingCandidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input inputMode="decimal" value={editBudget} onChange={(e) => setEditBudget(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => update.mutate()} disabled={update.isPending || !editName.trim()}>
                <Check className="mr-1 h-4 w-4" /> {t("common.save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                <X className="mr-1 h-4 w-4" /> {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <span className="font-medium truncate">{scope.name}</span>
                  {isActive && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      {t("scopes.active_badge")}
                    </span>
                  )}
                  {closed && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {t("scopes.closed_badge")}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {funding
                    ? t("scopes.funded_from", { name: funding.name })
                    : t("scopes.no_funding_hint")}
                </div>
              </div>
              <div className="text-right tabular-nums">
                <div className="text-sm font-semibold">{fmtMoney(spent, symbol)}</div>
                {plan > 0 && (
                  <div className="text-xs text-muted-foreground">{t("scopes.of_planned", { plan: fmtMoney(plan, symbol) })}</div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!closed && !isActive && (
                <Button size="sm" onClick={onActivate}>{t("scopes.activate")}</Button>
              )}
              {!closed && isActive && (
                <Button size="sm" variant="outline" onClick={onDeactivate}>{t("scopes.deactivate")}</Button>
              )}
              {!closed && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{t("common.edit")}</Button>
              )}
              {!closed && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline">{t("scopes.close")}</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("scopes.close_confirm_title", { name: scope.name })}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {funding
                          ? t("scopes.close_confirm", {
                              amount: fmtMoney(spent, symbol),
                              from: funding.name,
                            })
                          : t("scopes.close_confirm_no_funding", { amount: fmtMoney(spent, symbol) })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => close.mutate()}>
                        {t("scopes.close")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {closed && (
                <Button size="sm" variant="ghost" onClick={() => reopen.mutate()}>
                  <RotateCcw className="mr-1 h-4 w-4" /> {t("scopes.reopen")}
                </Button>
              )}
              {totalQ.data && totalQ.data.count === 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                      <Trash2 className="mr-1 h-4 w-4" /> {t("common.delete")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("scopes.delete_confirm")}</AlertDialogTitle>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => del.mutate()}>{t("common.delete")}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}