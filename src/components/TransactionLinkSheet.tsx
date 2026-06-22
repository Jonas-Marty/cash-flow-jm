import * as React from "react";
import { Link as RouterLink } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { Trash2, X, Search, ShoppingBag, CalendarDays, Plane, Package, Pencil } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import {
  attachTransactionToLink, deleteTransactionLink, detachTransactionFromLink,
  fetchTransactionLinks, fetchTransactionLinkMembers, updateTransactionLink,
  LINK_KINDS, type TransactionLink, type TransactionLinkKind,
} from "@/lib/links";
import { fetchAccounts, fetchCategories, fetchSettings, fetchTransactions, fmtMoney, type Transaction } from "@/lib/finance";
import { supabase } from "@/integrations/supabase/client";

export const KIND_ICON: Record<TransactionLinkKind, React.ComponentType<{ className?: string }>> = {
  purchase: ShoppingBag,
  event: CalendarDays,
  trip: Plane,
  other: Package,
};

type Props = {
  linkId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TransactionLinkSheet({ linkId, open, onOpenChange }: Props) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();

  const linksQ = useQuery({ queryKey: ["transaction_links"], queryFn: fetchTransactionLinks, enabled: open });
  const membersQ = useQuery({ queryKey: ["transaction_link_members"], queryFn: fetchTransactionLinkMembers, enabled: open });
  const txQ = useQuery({ queryKey: ["transactions", "all"], queryFn: () => fetchTransactions(), enabled: open });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts, enabled: open });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, enabled: open });
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings, enabled: open });

  const link = React.useMemo(
    () => (linksQ.data ?? []).find((l) => l.id === linkId) ?? null,
    [linksQ.data, linkId],
  );

  const memberTxs = React.useMemo<Transaction[]>(() => {
    if (!linkId) return [];
    const txIds = new Set(
      (membersQ.data ?? []).filter((m) => m.link_id === linkId).map((m) => m.transaction_id),
    );
    return (txQ.data ?? []).filter((tx) => txIds.has(tx.id));
  }, [membersQ.data, txQ.data, linkId]);

  const accountById = React.useMemo(
    () => new Map((accountsQ.data ?? []).map((a) => [a.id, a])),
    [accountsQ.data],
  );
  const categoryById = React.useMemo(
    () => new Map((categoriesQ.data ?? []).map((c) => [c.id, c])),
    [categoriesQ.data],
  );

  /** Per-currency signed total. Transfers contribute 0 (excluded). */
  const totals = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const tx of memberTxs) {
      if (tx.type === "transfer") continue;
      const sym = accountById.get(tx.source_account_id)?.currency_symbol ?? settingsQ.data?.currency_symbol ?? "CHF";
      const sign = tx.type === "expense" ? -1 : 1;
      m.set(sym, (m.get(sym) ?? 0) + sign * Number(tx.amount));
    }
    return Array.from(m.entries());
  }, [memberTxs, accountById, settingsQ.data]);

  // Edit state
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [kind, setKind] = React.useState<TransactionLinkKind>("purchase");
  const [note, setNote] = React.useState("");
  const [plannedOn, setPlannedOn] = React.useState<Date | null>(null);

  React.useEffect(() => {
    if (!link) return;
    setTitle(link.title);
    setKind(link.kind);
    setNote(link.note ?? "");
    setPlannedOn(link.planned_on ? new Date(link.planned_on) : null);
    setEditing(false);
  }, [link?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["transaction_links"] });
    qc.invalidateQueries({ queryKey: ["transaction_link_members"] });
  };

  const saveEdits = async () => {
    if (!link) return;
    try {
      await updateTransactionLink(link.id, {
        title: title.trim() || link.title,
        kind,
        note: note.trim() || null,
        planned_on: plannedOn ? format(plannedOn, "yyyy-MM-dd") : null,
      });
      toast.success(t("links.toast.saved"));
      setEditing(false);
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const deleteLink = async () => {
    if (!link) return;
    if (!confirm(t("links.confirm_delete", { title: link.title }))) return;
    try {
      await deleteTransactionLink(link.id);
      toast.success(t("links.toast.deleted"));
      invalidate();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const removeMember = async (tx: Transaction) => {
    if (!link) return;
    const isLast = memberTxs.length <= 1;
    if (isLast) {
      if (!confirm(t("links.confirm_remove_last", { title: link.title }))) return;
      try {
        await detachTransactionFromLink(tx.id);
        await deleteTransactionLink(link.id);
        toast.success(t("links.toast.deleted"));
        invalidate();
        onOpenChange(false);
      } catch (e) {
        toast.error((e as Error).message);
      }
      return;
    }
    try {
      await detachTransactionFromLink(tx.id);
      toast.success(t("links.toast.removed"));
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Inline transaction search to add a member.
  const [addQuery, setAddQuery] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const linkedIds = React.useMemo(() => new Set((membersQ.data ?? []).map((m) => m.transaction_id)), [membersQ.data]);
  const candidates = React.useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    return (txQ.data ?? [])
      .filter((tx) => !linkedIds.has(tx.id))
      .filter((tx) => {
        if (!q) return true;
        const desc = (tx.description ?? "").toLowerCase();
        const cat = (tx.category_id ? categoryById.get(tx.category_id)?.name : "")?.toLowerCase() ?? "";
        const amt = Math.abs(Number(tx.amount)).toFixed(2);
        return desc.includes(q) || cat.includes(q) || amt.includes(q);
      })
      .slice(0, 30);
  }, [txQ.data, linkedIds, addQuery, categoryById]);

  const addMember = async (tx: Transaction) => {
    if (!link) return;
    try {
      await attachTransactionToLink(tx.id, link.id);
      toast.success(t("links.toast.added"));
      setAddQuery("");
      setAddOpen(false);
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const Kicon = link ? KIND_ICON[link.kind] : ShoppingBag;
  const dateFmt = settingsQ.data?.date_format || "yyyy-MM-dd";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {!link ? (
          <div className="space-y-2 py-6">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader className="space-y-2">
              <SheetTitle className="flex items-center gap-2">
                <Kicon className="h-5 w-5 text-muted-foreground" />
                {editing ? (
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} className="flex-1" />
                ) : (
                  <span className="flex-1 truncate">{link.title}</span>
                )}
                {!editing && (
                  <Button variant="ghost" size="icon" aria-label={t("common.edit")} onClick={() => setEditing(true)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </SheetTitle>
              <SheetDescription>{t("links.sheet.subtitle")}</SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {editing && (
                <Card><CardContent className="space-y-3 py-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">{t("links.kind")}</Label>
                      <Select value={kind} onValueChange={(v) => setKind(v as TransactionLinkKind)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {LINK_KINDS.map((k) => (
                            <SelectItem key={k} value={k}>{t(`links.kind.${k}`)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">{t("links.planned_on")}</Label>
                      <Input
                        type="date"
                        value={plannedOn ? format(plannedOn, "yyyy-MM-dd") : ""}
                        onChange={(e) => setPlannedOn(e.target.value ? new Date(e.target.value) : null)}
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">{t("links.note")}</Label>
                    <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>{t("common.cancel")}</Button>
                    <Button size="sm" onClick={saveEdits}>{t("common.save")}</Button>
                  </div>
                </CardContent></Card>
              )}

              {!editing && (link.planned_on || link.note) && (
                <div className="space-y-1 text-sm text-muted-foreground">
                  {link.planned_on && (
                    <div>{t("links.planned_on")}: {format(new Date(link.planned_on), dateFmt, { locale })}</div>
                  )}
                  {link.note && <div className="whitespace-pre-wrap">{link.note}</div>}
                </div>
              )}

              {/* Totals */}
              {totals.length > 0 && (
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="text-xs uppercase text-muted-foreground">{t("links.totals.label")}</div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-3">
                    {totals.map(([sym, sum]) => (
                      <div key={sym} className="text-base font-semibold tabular-nums">
                        {fmtMoney(sum, sym)}
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{t("links.totals.hint")}</div>
                </div>
              )}

              {/* Members */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("links.members.title", { n: memberTxs.length })}
                  </div>
                  <Popover open={addOpen} onOpenChange={setAddOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1.5">
                        <Search className="h-3.5 w-3.5" />
                        {t("links.members.add")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] sm:w-96 p-0" align="end">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder={t("links.members.search")}
                          value={addQuery}
                          onValueChange={setAddQuery}
                        />
                        <CommandList>
                          <CommandEmpty>{t("links.members.empty")}</CommandEmpty>
                          {candidates.map((tx) => {
                            const cat = tx.category_id ? categoryById.get(tx.category_id)?.name : "";
                            const sym = accountById.get(tx.source_account_id)?.currency_symbol ?? "CHF";
                            return (
                              <CommandItem key={tx.id} value={tx.id} onSelect={() => addMember(tx)}>
                                <div className="flex w-full items-center justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm">{tx.description || cat || tx.type}</div>
                                    <div className="text-[11px] text-muted-foreground">
                                      {format(new Date(tx.occurred_on), dateFmt, { locale })} · {cat}
                                    </div>
                                  </div>
                                  <div className="text-sm tabular-nums">{fmtMoney(Number(tx.amount), sym)}</div>
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                {memberTxs.length === 0 ? (
                  <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
                    {t("links.members.none")}
                  </CardContent></Card>
                ) : (
                  <Card><CardContent className="divide-y p-0">
                    {memberTxs.map((tx) => {
                      const cat = tx.category_id ? categoryById.get(tx.category_id)?.name : "";
                      const sym = accountById.get(tx.source_account_id)?.currency_symbol ?? "CHF";
                      const sign = tx.type === "expense" ? "-" : tx.type === "income" ? "+" : "";
                      const tone = tx.type === "expense" ? "text-destructive" : tx.type === "income" ? "text-success" : "text-muted-foreground";
                      return (
                        <div key={tx.id} className="flex items-start justify-between gap-2 p-3 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">
                              <RouterLink to="/edit/$id" params={{ id: tx.id }} className="hover:underline">
                                {tx.description || cat || tx.type}
                              </RouterLink>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {format(new Date(tx.occurred_on), dateFmt, { locale })}
                              {cat ? ` · ${cat}` : ""}
                              {tx.type === "transfer" && <Badge variant="secondary" className="ml-1.5 text-[10px]">{t("links.transfer_excluded")}</Badge>}
                            </div>
                          </div>
                          <div className={`tabular-nums font-medium ${tone}`}>
                            {sign}{fmtMoney(Math.abs(Number(tx.amount)), sym)}
                          </div>
                          <Button
                            variant="ghost" size="icon"
                            aria-label={t("common.remove")}
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => removeMember(tx)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </CardContent></Card>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <Button variant="ghost" size="sm" className="text-destructive" onClick={deleteLink}>
                  <Trash2 className="mr-1.5 h-4 w-4" /> {t("links.delete")}
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}