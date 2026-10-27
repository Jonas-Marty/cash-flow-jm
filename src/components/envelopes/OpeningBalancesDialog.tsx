import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EntityChip } from "@/components/EntityChip";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { accountOpeningsTotal, cents, holdsOpening, parseOpening } from "@/lib/openingBalances";
import {
  fetchAccounts,
  fetchCategories,
  fetchCategoryGroups,
  fetchSavingsBalances,
  fetchSettings,
  fmtMoney,
  setOpeningBalances,
  type Category,
} from "@/lib/finance";

/**
 * Distributes the accounts' opening money over the rolling budgets, all at once.
 * Opens from Settings and from "Nicht zugeordnet" on Budgets. While money is
 * left it reads "verteilen", once everything is distributed "bearbeiten".
 */
export function OpeningBalancesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings, enabled: open });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, enabled: open });
  const categoriesQ = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories,
    enabled: open,
  });
  const groupsQ = useQuery({
    queryKey: ["category_groups"],
    queryFn: fetchCategoryGroups,
    enabled: open,
  });
  const balancesQ = useQuery({
    queryKey: ["savings-balances", "today"],
    queryFn: () => fetchSavingsBalances(),
    enabled: open,
  });

  const symbol = settingsQ.data?.currency_symbol ?? "CHF";
  const cats = React.useMemo(
    () => (categoriesQ.data ?? []).filter(holdsOpening),
    [categoriesQ.data],
  );
  const active = cats.filter((c) => !c.archived);
  // An archived budget only shows when it has an opening balance to change.
  const archived = cats.filter(
    (c) => c.archived && Math.abs(Number(c.opening_balance ?? 0)) >= 0.005,
  );
  const todayById = React.useMemo(
    () => new Map((balancesQ.data ?? []).map((b) => [b.category_id, Number(b.cumulative_balance)])),
    [balancesQ.data],
  );

  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setDraft({});
      setShowArchived(false);
    }
  }, [open]);

  const saved = (c: Category) => cents(Number(c.opening_balance ?? 0));
  const valueOf = (c: Category) => (c.id in draft ? parseOpening(draft[c.id]) : saved(c));
  const changed = (c: Category) => {
    const v = valueOf(c);
    return v !== null && Math.abs(v - saved(c)) >= 0.005;
  };

  const onAccounts = accountOpeningsTotal(accountsQ.data ?? []);
  const savedTotal = cents(cats.reduce((s, c) => s + saved(c), 0));
  const invalid = cats.some((c) => valueOf(c) === null);
  const distributed = cents(cats.reduce((s, c) => s + (valueOf(c) ?? saved(c)), 0));
  const left = cents(onAccounts - distributed);
  const over = left < -0.005;
  const dirty = cats.some(changed);
  const editing = Math.abs(onAccounts - savedTotal) < 0.005;

  const sweepTarget = active.find((c) => c.id === settingsQ.data?.default_sweep_category_id);
  const fillRest = () => {
    if (!sweepTarget) return;
    const v = cents((valueOf(sweepTarget) ?? saved(sweepTarget)) + left);
    setDraft((d) => ({ ...d, [sweepTarget.id]: v.toFixed(2) }));
  };

  const save = async () => {
    const payload = cats
      .filter(changed)
      .map((c) => ({ category_id: c.id, amount: valueOf(c) as number }));
    setBusy(true);
    try {
      const reopened = await setOpeningBalances(payload);
      toast.success(t("opening.saved"));
      for (const id of reopened) {
        const name = cats.find((c) => c.id === id)?.name ?? "";
        toast.info(t("opening.reopened", { name }));
      }
      // The opening balance counts before the first booking, so every balance,
      // ledger and check that reads a changed budget moves.
      await qc.invalidateQueries();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const row = (c: Category) => {
    const today = todayById.get(c.id);
    const v = valueOf(c);
    const isChanged = changed(c);
    const after = today != null && v !== null ? cents(today - saved(c) + v) : null;
    return (
      <li key={c.id} className="space-y-1.5 py-1.5">
        <div
          className={cn(
            "-mx-1.5 flex items-center gap-2 rounded px-1.5 py-0.5",
            isChanged && "bg-primary/5",
          )}
        >
          <EntityChip
            entity={{
              id: c.id,
              name: c.name,
              icon: c.icon,
              emoji: c.emoji,
              image_url: c.image_url,
              color: c.color,
            }}
            showLabel={false}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{c.name}</div>
            <div className="truncate text-[11px] tabular-nums text-muted-foreground">
              {today == null
                ? "…"
                : isChanged && after != null
                  ? t("opening.today_to", {
                      today: fmtMoney(today, symbol),
                      after: fmtMoney(after, symbol),
                    })
                  : t("opening.today", { today: fmtMoney(today, symbol) })}
            </div>
          </div>
          <Input
            inputMode="decimal"
            aria-label={t("opening.amount_for", { name: c.name })}
            aria-invalid={v === null}
            className={cn(
              "h-8 w-28 shrink-0 text-right tabular-nums",
              v === null && "border-destructive",
              isChanged && "border-primary/60",
            )}
            value={c.id in draft ? draft[c.id] : saved(c).toFixed(2)}
            onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))}
            onFocus={(e) => e.target.select()}
          />
        </div>
        {c.archived && isChanged && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span>{t("opening.archived_warning", { name: c.name })}</span>
          </div>
        )}
      </li>
    );
  };

  const sections: React.ReactNode[] = [];
  for (const g of groupsQ.data ?? []) {
    const inGroup = active.filter((c) => c.group_id === g.id);
    if (inGroup.length > 0) sections.push(section(g.id, g.name, inGroup.map(row)));
  }
  const ungrouped = active.filter(
    (c) => !c.group_id || !(groupsQ.data ?? []).some((g) => g.id === c.group_id),
  );
  if (ungrouped.length > 0)
    sections.push(section("__none", t("settings.ungrouped_envelopes"), ungrouped.map(row)));

  const loading = !accountsQ.data || !categoriesQ.data || !groupsQ.data;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        className="flex max-h-[90vh] flex-col gap-3 sm:max-w-lg"
        // The first focusable element is a budget's chip, whose tooltip would
        // cover the first row; nothing needs focus until you pick a field.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {editing ? t("opening.title_edit") : t("opening.title_distribute")}
          </DialogTitle>
          <DialogDescription>{t("opening.description")}</DialogDescription>
        </DialogHeader>

        <div
          className="grid grid-cols-3 gap-2 rounded-md bg-muted px-3 py-2 text-xs"
          aria-live="polite"
        >
          <div>
            <div className="text-muted-foreground">{t("opening.on_accounts")}</div>
            <div className="font-medium tabular-nums">{fmtMoney(onAccounts, symbol)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{t("opening.distributed")}</div>
            <div className="font-medium tabular-nums">{fmtMoney(distributed, symbol)}</div>
          </div>
          <div>
            <div className={cn("text-muted-foreground", over && "text-destructive")}>
              {over ? t("opening.over") : t("opening.left")}
            </div>
            <div
              className={cn(
                "font-medium tabular-nums",
                over
                  ? "text-destructive"
                  : Math.abs(left) < 0.005
                    ? "text-success"
                    : "text-warning",
              )}
            >
              {fmtMoney(Math.abs(left), symbol)}
              {Math.abs(left) < 0.005 && " ✓"}
            </div>
          </div>
        </div>

        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
          {loading ? (
            <p className="py-4 text-sm text-muted-foreground">…</p>
          ) : cats.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t("opening.none")}</p>
          ) : (
            <div className="space-y-3">
              {sections}
              {archived.length > 0 && (
                <div className="space-y-1">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    aria-expanded={showArchived}
                    onClick={() => setShowArchived((v) => !v)}
                  >
                    {t("opening.archived_section", { n: archived.length })}
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        showArchived && "rotate-180",
                      )}
                    />
                  </button>
                  {showArchived && <ul className="divide-y">{archived.map(row)}</ul>}
                </div>
              )}
            </div>
          )}
        </div>

        {over && <p className="text-xs text-destructive">{t("opening.over_hint")}</p>}

        <DialogFooter className="gap-2 sm:justify-between">
          {sweepTarget && Math.abs(left) >= 0.005 ? (
            <Button type="button" variant="outline" onClick={fillRest} disabled={busy || invalid}>
              {t("opening.rest_to", { name: sweepTarget.name })}
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={save} disabled={busy || !dirty || invalid || over}>
              {t("common.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function section(key: string, title: string, rows: React.ReactNode[]) {
  return (
    <div key={key} className="space-y-1">
      <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="divide-y">{rows}</ul>
    </div>
  );
}
