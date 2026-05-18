import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, CheckCircle2, AlertTriangle, Wand2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DateInput } from "@/components/DateInput";
import { useI18n } from "@/i18n";
import { AttachmentsSection } from "@/components/AttachmentsSection";
import { type DraftAttachment } from "@/components/AttachmentsSection";
import { Markdown } from "@/components/Markdown";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAccounts,
  fetchAccountStatements,
  fetchAccountBalanceAsOf,
  upsertAccountStatement,
  matchStatement,
  postCompensationForStatement,
  deleteAccountStatement,
  fmtMoney,
  todayISO,
  type Account,
  type AccountStatement,
} from "@/lib/finance";

export const Route = createFileRoute("/reconcile")({
  component: ReconcileRoute,
});

function ReconcileRoute() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const [accountFilter, setAccountFilter] = React.useState<string>("all");
  const accounts = (accountsQ.data ?? []).filter((a) => !a.archived);
  const accountById = React.useMemo(() => {
    const m = new Map<string, Account>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  const stmtsQ = useQuery({
    queryKey: ["account_statements", accountFilter],
    queryFn: () => fetchAccountStatements(accountFilter === "all" ? undefined : accountFilter),
  });
  const statements = stmtsQ.data ?? [];

  // Fetch computed balance per statement (as-of date + account).
  const balanceQs = useQueries({
    queries: statements.map((s) => ({
      queryKey: ["account_balance_as_of", s.account_id, s.as_of],
      queryFn: () => fetchAccountBalanceAsOf(s.account_id, s.as_of),
      staleTime: 60_000,
    })),
  });

  const [addOpen, setAddOpen] = React.useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["account_statements"] });
    qc.invalidateQueries({ queryKey: ["account_balance_as_of"] });
    qc.invalidateQueries({ queryKey: ["account_balances"] });
    qc.invalidateQueries({ queryKey: ["account_balances_as_of"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
  };

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{t("reconcile.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("reconcile.subtitle")}</p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("reconcile.add")}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">{t("reconcile.filter.account")}</Label>
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="h-9 w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("reconcile.list.title")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {statements.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                {t("reconcile.empty")}
              </p>
            ) : (
              <div className="divide-y">
                {statements.map((s, i) => {
                  const acc = accountById.get(s.account_id);
                  const sym = acc?.currency_symbol ?? "";
                  const computed = balanceQs[i]?.data ?? 0;
                  const loading = balanceQs[i]?.isLoading;
                  const diff = Number(s.statement_balance) - computed;
                  const isZero = Math.abs(diff) < 0.005;
                  return (
                    <StatementRow
                      key={s.id}
                      s={s}
                      accountName={acc?.name ?? "—"}
                      sym={sym}
                      computed={computed}
                      diff={diff}
                      isZero={isZero}
                      loading={!!loading}
                      onChanged={refresh}
                    />
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AddStatementDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        accounts={accounts}
        onCreated={() => {
          refresh();
          setAddOpen(false);
        }}
      />
    </AppShell>
  );
}

function StatementRow({
  s, accountName, sym, computed, diff, isZero, loading, onChanged,
}: {
  s: AccountStatement;
  accountName: string;
  sym: string;
  computed: number;
  diff: number;
  isZero: boolean;
  loading: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = React.useState<null | "match" | "comp" | "delete">(null);
  const [confirmComp, setConfirmComp] = React.useState(false);

  const doMatch = async () => {
    setBusy("match");
    try {
      await matchStatement(s.id);
      toast.success(t("reconcile.toast.matched"));
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };

  const doCompensate = async () => {
    setBusy("comp");
    try {
      const res = await postCompensationForStatement(s.id);
      toast.success(t("reconcile.toast.compensated", { amount: fmtMoney(Math.abs(res.diff), sym) }));
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); setConfirmComp(false); }
  };

  const doDelete = async (deleteComp: boolean) => {
    setBusy("delete");
    try {
      await deleteAccountStatement(s.id, { deleteCompensation: deleteComp });
      toast.success(t("reconcile.toast.deleted"));
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{accountName}</span>
          <span className="text-muted-foreground">·</span>
          <span className="tabular-nums">{s.as_of}</span>
          <StatusBadge status={s.status} isZero={isZero} />
          {s.source !== "manual" && (
            <Badge variant="outline" className="text-[10px]">{s.source}</Badge>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <Field label={t("reconcile.col.statement")} value={fmtMoney(Number(s.statement_balance), sym)} />
          <Field label={t("reconcile.col.computed")} value={loading ? "…" : fmtMoney(computed, sym)} />
          <Field
            label={t("reconcile.col.diff")}
            value={loading ? "…" : fmtMoney(diff, sym)}
            tone={isZero ? "ok" : diff > 0 ? "pos" : "neg"}
          />
        </div>
        {s.note && (
          <div className="text-xs text-muted-foreground">
            <Markdown>{s.note}</Markdown>
          </div>
        )}
        <div className="pt-2">
          <AttachmentsSection statementId={s.id} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm" variant="outline"
          disabled={!isZero || busy !== null || s.status === "matched"}
          onClick={doMatch}
        >
          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
          {t("reconcile.action.match")}
        </Button>
        <Button
          size="sm" variant="outline"
          disabled={isZero || busy !== null}
          onClick={() => setConfirmComp(true)}
        >
          <Wand2 className="mr-1 h-3.5 w-3.5" />
          {t("reconcile.action.compensate")}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" disabled={busy !== null}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("reconcile.delete.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {s.compensation_transaction_id
                  ? t("reconcile.delete.with_comp")
                  : t("reconcile.delete.confirm")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              {s.compensation_transaction_id && (
                <AlertDialogAction onClick={() => doDelete(true)}>
                  {t("reconcile.delete.with_comp_action")}
                </AlertDialogAction>
              )}
              <AlertDialogAction onClick={() => doDelete(false)}>
                {t("reconcile.delete.keep_comp_action")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Dialog open={confirmComp} onOpenChange={setConfirmComp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reconcile.comp.title")}</DialogTitle>
            <DialogDescription>
              {t("reconcile.comp.body", {
                type: diff > 0 ? t("reconcile.comp.income") : t("reconcile.comp.expense"),
                amount: fmtMoney(Math.abs(diff), sym),
                date: s.as_of,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmComp(false)} disabled={busy === "comp"}>
              {t("common.cancel")}
            </Button>
            <Button onClick={doCompensate} disabled={busy === "comp"}>
              {busy === "comp" ? t("common.saving") : t("reconcile.comp.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "ok" | "pos" | "neg" }) {
  const cls =
    tone === "ok" ? "text-success" :
    tone === "pos" ? "text-success" :
    tone === "neg" ? "text-destructive" : "";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`tabular-nums font-medium ${cls}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status, isZero }: { status: AccountStatement["status"]; isZero: boolean }) {
  const { t } = useI18n();
  if (status === "matched") {
    return <Badge variant="secondary" className="text-[10px]">{t("reconcile.status.matched")}</Badge>;
  }
  if (status === "compensated") {
    return <Badge variant="secondary" className="text-[10px]">{t("reconcile.status.compensated")}</Badge>;
  }
  return (
    <Badge variant={isZero ? "secondary" : "destructive"} className="text-[10px]">
      {isZero ? t("reconcile.status.matches") : <><AlertTriangle className="mr-1 inline h-3 w-3" />{t("reconcile.status.diff")}</>}
    </Badge>
  );
}

function AddStatementDialog({
  open, onOpenChange, accounts, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: Account[];
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [accountId, setAccountId] = React.useState<string>("");
  const [asOf, setAsOf] = React.useState<string>(todayISO());
  const [amount, setAmount] = React.useState<string>("");
  const [note, setNote] = React.useState<string>("");
  const [saving, setSaving] = React.useState(false);
  const [draftAttachments, setDraftAttachments] = React.useState<DraftAttachment[]>([]);

  React.useEffect(() => {
    if (open && !accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [open, accountId, accounts]);

  const onSave = async () => {
    if (!accountId) return;
    const n = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(n)) {
      toast.error(t("reconcile.add.invalid_amount"));
      return;
    }
    setSaving(true);
    try {
      const stmt = await upsertAccountStatement({
        account_id: accountId,
        as_of: asOf,
        statement_balance: Math.round(n * 100) / 100,
        note: note.trim() || null,
      });
      if (draftAttachments.length > 0) {
        const rows = draftAttachments.map((a) => ({
          transaction_id: null,
          statement_id: stmt.id,
          source: a.source,
          display_name: a.display_name,
          link_url: a.link_url,
        }));
        const { error: aErr } = await supabase.from("transaction_attachments").insert(rows);
        if (aErr) toast.error(aErr.message);
      }
      toast.success(t("reconcile.toast.saved"));
      setAmount("");
      setNote("");
      setDraftAttachments([]);
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("reconcile.add.title")}</DialogTitle>
          <DialogDescription>{t("reconcile.add.help")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("reconcile.add.account")}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("reconcile.add.date")}</Label>
            <DateInput
              value={new Date(asOf)}
              onChange={(d) =>
                setAsOf(
                  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
                )
              }
            />
          </div>
          <div className="space-y-1">
            <Label>{t("reconcile.add.amount")}</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1">
            <Label>{t("reconcile.add.note")}</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">{t("common.markdown_hint")}</p>
            {note.trim() && (
              <div className="rounded-md border border-dashed border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                <Markdown>{note.trim()}</Markdown>
              </div>
            )}
          </div>
          <div className="pt-1">
            <AttachmentsSection
              draft
              items={draftAttachments}
              onItemsChange={setDraftAttachments}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onSave} disabled={saving || !accountId}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}