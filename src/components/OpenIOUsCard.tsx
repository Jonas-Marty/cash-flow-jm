import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  fetchOpenReimbursables,
  fetchReimbursementLinks,
  fetchAccounts,
  fetchCategories,
  setReimbursableStatus,
  writeOffReimbursable,
  fmtMoney,
  type Transaction,
  type ReimbursementLink,
} from "@/lib/finance";
import { useI18n } from "@/i18n";
import { Plus, Check, Ban, Pencil, MinusCircle, HelpCircle } from "lucide-react";
import { format, parseISO } from "date-fns";

type Direction = "owed_to_me" | "i_owe";

function directionOf(tx: Transaction): Direction {
  return tx.type === "income" ? "i_owe" : "owed_to_me";
}

export function OpenIOUsCard({ symbol, headless = false }: { symbol: string; headless?: boolean }) {
  const { t: tr, locale } = useI18n();
  const qc = useQueryClient();
  const openQ = useQuery({ queryKey: ["reimbursables", "open"], queryFn: fetchOpenReimbursables });
  const linksQ = useQuery({ queryKey: ["reimbursement_links"], queryFn: fetchReimbursementLinks });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });

  const [cancelTx, setCancelTx] = React.useState<Transaction | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [settleTx, setSettleTx] = React.useState<Transaction | null>(null);
  const [writeOffTx, setWriteOffTx] = React.useState<Transaction | null>(null);
  const [writeOffCategoryId, setWriteOffCategoryId] = React.useState("");
  const [writeOffNote, setWriteOffNote] = React.useState("");
  const [writeOffBusy, setWriteOffBusy] = React.useState(false);

  const accountById = React.useMemo(
    () => new Map((accountsQ.data ?? []).map((a) => [a.id, a])),
    [accountsQ.data],
  );
  const linkedSumByOrig = React.useMemo(() => {
    const m = new Map<string, number>();
    (linksQ.data ?? []).forEach((l: ReimbursementLink) => {
      m.set(l.original_transaction_id, (m.get(l.original_transaction_id) ?? 0) + Number(l.amount));
    });
    return m;
  }, [linksQ.data]);

  const items = openQ.data ?? [];
  const isEmpty = !openQ.isLoading && items.length === 0;
  if (!headless && (openQ.isLoading || isEmpty)) return null;

  const owedToMe = items.filter((t) => directionOf(t) === "owed_to_me");
  const iOwe = items.filter((t) => directionOf(t) === "i_owe");

  const fmtAmt = (tx: Transaction) => {
    const acc = accountById.get(tx.source_account_id);
    return fmtMoney(Number(tx.amount), acc?.currency_symbol ?? symbol);
  };
  const remaining = (tx: Transaction) =>
    Math.max(0, Number(tx.amount) - (linkedSumByOrig.get(tx.id) ?? 0));

  const invalidateReimbursables = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["reimbursables"] }),
      qc.invalidateQueries({ queryKey: ["reimbursement_links"] }),
      qc.invalidateQueries({ queryKey: ["transactions"] }),
    ]);
  };
  const onMarkSettledConfirm = async () => {
    if (!settleTx) return;
    try {
      await setReimbursableStatus(settleTx.id, "settled");
      toast.success(tr("toast.saved"));
      await invalidateReimbursables();
      setSettleTx(null);
    } catch (e) { toast.error((e as Error).message); }
  };
  const onCancelConfirm = async () => {
    if (!cancelTx) return;
    try {
      await setReimbursableStatus(cancelTx.id, "cancelled", cancelReason.trim() || null);
      toast.success(tr("toast.saved"));
      await invalidateReimbursables();
      setCancelTx(null);
      setCancelReason("");
    } catch (e) { toast.error((e as Error).message); }
  };
  const onWriteOffConfirm = async () => {
    if (!writeOffTx || !writeOffCategoryId) return;
    setWriteOffBusy(true);
    try {
      await writeOffReimbursable(writeOffTx.id, {
        categoryId: writeOffCategoryId,
        note: writeOffNote.trim() || null,
      });
      toast.success(tr("iou.writeoff.toast"));
      await invalidateReimbursables();
      setWriteOffTx(null);
      setWriteOffCategoryId("");
      setWriteOffNote("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setWriteOffBusy(false);
    }
  };

  const repaymentLink = (tx: Transaction) => {
    const rem = remaining(tx);
    const dir = directionOf(tx);
    const origName = (tx.description || tx.reimbursable_counterparty || tr("add.expense")).trim();
    const params = new URLSearchParams({
      reimburse_for: tx.id,
      // owed_to_me: original was expense → repayment is income.
      // i_owe:      original was income  → repayment is expense.
      type: dir === "owed_to_me" ? "income" : "expense",
      amount: rem.toFixed(2),
      description: tr("iou.repayment.prefill_description", { name: origName }),
      note: tx.note || "",
    });
    if (tx.reimbursable_counterparty) params.set("counterparty", tx.reimbursable_counterparty);
    return `/add?${params.toString()}`;
  };

  const renderRow = (tx: Transaction) => {
    const linked = linkedSumByOrig.get(tx.id) ?? 0;
    const partial = linked > 0 && linked < Number(tx.amount);
    const sampleAcc = accountById.get(tx.source_account_id);
    const groupSym = sampleAcc?.currency_symbol ?? symbol;
    return (
      <li key={tx.id} className="flex flex-wrap items-start gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {tx.description || tr("add.expense")}
            </span>
            <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning">
              {tr("tx.reimb.status.open")}
            </Badge>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {format(parseISO(tx.occurred_on), "dd.MM.yyyy", { locale })}
            {" · "}
            {sampleAcc?.name ?? "?"}
            {tx.reimbursable_counterparty && ` · ${tx.reimbursable_counterparty}`}
            {tx.reimbursable_reason && ` · ${tx.reimbursable_reason}`}
          </div>
          {partial && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {tr("dash.reimb.partial", {
                paid: fmtMoney(linked, groupSym),
                total: fmtMoney(Number(tx.amount), groupSym),
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="tabular-nums text-sm font-semibold">{fmtAmt(tx)}</span>
        </div>
        <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild size="sm" variant="default" className="h-7 px-2 text-xs">
                <a href={repaymentLink(tx)} aria-label={tr("iou.add_repayment")}>
                  <Plus className="mr-1 h-3 w-3" /> {tr("iou.add_repayment")}
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs"><p>{tr("iou.help.add_repayment")}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm" variant="ghost" className="h-7 px-2 text-xs"
                onClick={() => setSettleTx(tx)}
                aria-label={tr("dash.reimb.mark_settled")}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs"><p>{tr("iou.help.mark_settled")}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => {
                  setWriteOffTx(tx);
                  setWriteOffCategoryId("");
                  setWriteOffNote("");
                }}
                aria-label={tr("iou.writeoff.action")}
              >
                <MinusCircle className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs"><p>{tr("iou.help.writeoff")}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => { setCancelTx(tx); setCancelReason(""); }}
                aria-label={tr("dash.reimb.mark_cancelled")}
              >
                <Ban className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs"><p>{tr("iou.help.cancel")}</p></TooltipContent>
          </Tooltip>
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-label={tr("common.edit")}>
            <Link to="/edit/$id" params={{ id: tx.id }}><Pencil className="h-3.5 w-3.5" /></Link>
          </Button>
        </div>
      </li>
    );
  };

  const renderSection = (title: string, rows: Transaction[]) => {
    if (rows.length === 0) return null;
    const total = rows.reduce((s, x) => s + remaining(x), 0);
    const sampleAcc = accountById.get(rows[0].source_account_id);
    const groupSym = sampleAcc?.currency_symbol ?? symbol;
    return (
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-sm font-medium">{title}</div>
          <div className="tabular-nums text-sm font-semibold text-warning">
            {fmtMoney(total, groupSym)}
          </div>
        </div>
        <ul className="divide-y rounded-md border border-border/60">
          {rows.map(renderRow)}
        </ul>
      </div>
    );
  };

  const body = (
    <>
      {isEmpty ? (
        <p className="py-2 text-center text-sm text-muted-foreground">{tr("iou.empty.both")}</p>
      ) : (
        <TooltipProvider delayDuration={200}>
          {renderSection(tr("iou.owed_to_me"), owedToMe)}
          {renderSection(tr("iou.i_owe"), iOwe)}
        </TooltipProvider>
      )}

      <AlertDialog open={!!settleTx} onOpenChange={(v) => { if (!v) setSettleTx(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("iou.mark_settled.confirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>{tr("iou.mark_settled.confirm.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onMarkSettledConfirm}>{tr("common.confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!cancelTx} onOpenChange={(v) => { if (!v) setCancelTx(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("dash.reimb.mark_cancelled")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{tr("iou.help.cancel")}</p>
            <p className="text-sm text-muted-foreground">{tr("dash.reimb.cancel.prompt")}</p>
            <Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTx(null)}>{tr("common.cancel")}</Button>
            <Button onClick={onCancelConfirm}>{tr("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!writeOffTx} onOpenChange={(v) => { if (!v) setWriteOffTx(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("iou.writeoff.dialog.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {writeOffTx?.type === "income"
                ? tr("iou.writeoff.dialog.body.income")
                : tr("iou.writeoff.dialog.body.expense")}
            </p>
            <div className="space-y-1">
              <Label>{tr("iou.writeoff.category")}</Label>
              <Select value={writeOffCategoryId} onValueChange={setWriteOffCategoryId}>
                <SelectTrigger><SelectValue placeholder="…" /></SelectTrigger>
                <SelectContent>
                  {(categoriesQ.data ?? []).filter((c) => !c.archived).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{tr("iou.writeoff.note")}</Label>
              <Textarea rows={2} value={writeOffNote} onChange={(e) => setWriteOffNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWriteOffTx(null)} disabled={writeOffBusy}>
              {tr("common.cancel")}
            </Button>
            <Button onClick={onWriteOffConfirm} disabled={!writeOffCategoryId || writeOffBusy}>
              {tr("iou.writeoff.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (headless) {
    return (
      <div className="space-y-4">
        <IouHelpPopover />
        {body}
      </div>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle className="flex items-center gap-1 text-base">
            {tr("iou.title")}
            <IouHelpPopover />
          </CardTitle>
          <span className="text-xs text-muted-foreground">{tr("dash.reimb.subtitle")}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{body}</CardContent>
    </Card>
  );
}

function IouHelpPopover() {
  const { t: tr } = useI18n();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-muted-foreground"
          aria-label={tr("iou.help.title")}
        >
          <HelpCircle className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm">
        <p className="mb-2 font-medium">{tr("iou.help.title")}</p>
        <ul className="space-y-2 text-xs text-muted-foreground">
          <li>{tr("iou.help.add_repayment")}</li>
          <li>{tr("iou.help.mark_settled")}</li>
          <li>{tr("iou.help.writeoff")}</li>
          <li>{tr("iou.help.cancel")}</li>
        </ul>
        <div className="mt-3 border-t pt-2 text-xs">
          <Link to="/help" hash="iou-actions" className="text-primary hover:underline">
            {tr("iou.help.full_guide")} →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
