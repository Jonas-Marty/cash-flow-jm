import * as React from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { Layers, Repeat, Undo2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@/hooks/use-media-query";
import { EntityVisual } from "@/components/EntityVisual";
import { LinkMarker, RowActions, type RowContext } from "@/components/transactions/rows";
import { fmtMoney, type Transaction } from "@/lib/finance";

interface Props {
  /** The rows to render (the visible window of the filtered list). */
  rows: Transaction[];
  ctx: RowContext;
  selected: Set<string>;
  /** Every row of the filtered list is selected, not just the rendered ones. */
  allChecked: boolean;
  onToggleAll: (checked: boolean) => void;
  /** Rendered after the rows, inside the table's scroll container ("show more"). */
  footer?: React.ReactNode;
}

function Markers({ t, ctx }: { t: Transaction; ctx: RowContext }) {
  return (
    <>
      {t.split_group_id && <Layers className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={ctx.tr("tx.split.label")} />}
      {t.recurring_rule_id && <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={ctx.tr("tx.from_rule")} />}
      {ctx.reimbursementIds.has(t.id) && <Undo2 className="h-3 w-3 shrink-0 text-success" aria-label={ctx.tr("tx.reimbursement")} />}
    </>
  );
}

function AmountCell({ t, ctx }: { t: Transaction; ctx: RowContext }) {
  const sym = ctx.accountById.get(t.source_account_id)?.currency_symbol ?? ctx.symbol;
  const tone = t.type === "expense" ? "text-destructive" : t.type === "income" ? "text-success" : "text-muted-foreground";
  const sign = t.type === "expense" ? "-" : t.type === "income" ? "+" : "";
  return (
    <span className={cn("font-medium tabular-nums whitespace-nowrap", tone)}>
      {sign}
      {fmtMoney(Number(t.amount), sym).replace("-", "")}
    </span>
  );
}

function rowTitle(t: Transaction, ctx: RowContext) {
  return (
    t.description ||
    (t.type === "transfer" ? ctx.tr("tx.transfer_label") : t.type === "income" ? ctx.tr("add.income") : ctx.tr("add.expense"))
  );
}

function TitleLink({ t, ctx, className }: { t: Transaction; ctx: RowContext; className: string }) {
  const link = ctx.linkByTx.get(t.id);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Link to="/edit/$id" params={{ id: t.id }} search={{ back: ctx.backSearch }} className={className}>
        <Markers t={t} ctx={ctx} />
        <span className="truncate">{rowTitle(t, ctx)}</span>
      </Link>
      {link && <LinkMarker link={link} onOpen={ctx.onOpenLink} tr={ctx.tr} />}
    </div>
  );
}

const TableRow = React.memo(function TableRow({ t, selected, ctx }: { t: Transaction; selected: boolean; ctx: RowContext }) {
  const cat = t.category_id ? ctx.categoryById.get(t.category_id) ?? null : null;
  const src = ctx.accountById.get(t.source_account_id) ?? null;
  const tags = ctx.tagsByTx.get(t.id) ?? [];
  return (
    <tr className={cn("border-b hover:bg-muted/40", selected && "bg-primary/5")}>
      <td className="px-2 py-1.5 align-middle">
        <Checkbox checked={selected} onCheckedChange={(v) => ctx.onToggle(t.id, v === true)} aria-label={rowTitle(t, ctx)} />
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 align-middle text-xs text-muted-foreground tabular-nums">
        {format(new Date(t.occurred_on), ctx.dateFmt, { locale: ctx.locale })}
      </td>
      <td className="max-w-[22rem] px-2 py-1.5 align-middle">
        <TitleLink t={t} ctx={ctx} className="flex min-w-0 items-center gap-1.5 hover:underline" />
      </td>
      <td className="px-2 py-1.5 align-middle text-xs text-muted-foreground">
        {cat ? (
          <span className="inline-flex items-center gap-1">
            <EntityVisual entity={cat} size="xs" />
            <span className="truncate">{cat.name}</span>
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-2 py-1.5 align-middle text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {src && <EntityVisual entity={src} size="xs" />}
          <span className="truncate">{src?.name ?? "?"}</span>
        </span>
      </td>
      <td className="px-2 py-1.5 align-middle">
        <div className="flex flex-wrap gap-1">
          {tags.map((tg) => (
            <Badge key={tg} variant="secondary" className="rounded-full px-1.5 py-0 text-[10px]">
              {`#${tg}`}
            </Badge>
          ))}
        </div>
      </td>
      <td className="px-2 py-1.5 text-right align-middle">
        <AmountCell t={t} ctx={ctx} />
      </td>
      <td className="whitespace-nowrap px-2 py-1 text-right align-middle">
        <div className="flex items-center justify-end">
          <RowActions tx={t} ctx={ctx} />
        </div>
      </td>
    </tr>
  );
});

const ListRow = React.memo(function ListRow({ t, selected, ctx }: { t: Transaction; selected: boolean; ctx: RowContext }) {
  const cat = t.category_id ? ctx.categoryById.get(t.category_id) ?? null : null;
  const src = ctx.accountById.get(t.source_account_id) ?? null;
  const tags = ctx.tagsByTx.get(t.id) ?? [];
  return (
    <li className={cn("flex items-start gap-2 px-3 py-2", selected && "bg-primary/5")}>
      <Checkbox
        className="mt-0.5"
        checked={selected}
        onCheckedChange={(v) => ctx.onToggle(t.id, v === true)}
        aria-label={rowTitle(t, ctx)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <TitleLink t={t} ctx={ctx} className="flex min-w-0 items-center gap-1.5 text-sm" />
          <AmountCell t={t} ctx={ctx} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
          <span className="tabular-nums">{format(new Date(t.occurred_on), ctx.dateFmt, { locale: ctx.locale })}</span>
          <span>·</span>
          <span className="truncate">{src?.name ?? "?"}</span>
          {cat && (
            <>
              <span>·</span>
              <span className="truncate">{cat.name}</span>
            </>
          )}
          {tags.map((tg) => (
            <span key={tg} className="text-muted-foreground">{`#${tg}`}</span>
          ))}
        </div>
        <div className="mt-0.5 flex items-center">
          <RowActions tx={t} ctx={ctx} />
        </div>
      </div>
    </li>
  );
});

/**
 * Compact, high-density listing of transactions. Complements the card view:
 * same data, one line per transaction. Desktop gets a table, phones a list —
 * only one of the two is rendered (both at once doubled the DOM).
 */
export function TransactionTable({ rows, ctx, selected, allChecked, onToggleAll, footer }: Props) {
  const isDesktop = useIsDesktop();
  const { tr } = ctx;

  if (!isDesktop) {
    return (
      <div>
        <ul className="divide-y">
          {rows.map((t) => (
            <ListRow key={t.id} t={t} selected={selected.has(t.id)} ctx={ctx} />
          ))}
        </ul>
        {footer}
      </div>
    );
  }

  return (
    <div className="max-h-[calc(100vh-280px)] overflow-auto rounded-md">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-card shadow-sm">
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th className="w-9 px-2 py-2">
              <Checkbox checked={allChecked} onCheckedChange={(v) => onToggleAll(v === true)} aria-label={tr("tx.bulk.select_all")} />
            </th>
            <th className="px-2 py-2 text-left font-medium">{tr("add.date")}</th>
            <th className="px-2 py-2 text-left font-medium">{tr("add.description")}</th>
            <th className="px-2 py-2 text-left font-medium">{tr("add.category")}</th>
            <th className="px-2 py-2 text-left font-medium">{tr("add.account")}</th>
            <th className="px-2 py-2 text-left font-medium">{tr("tx.all_tags")}</th>
            <th className="px-2 py-2 text-right font-medium">{tr("tx.amount")}</th>
            <th className="w-px px-2 py-2 text-right font-medium">{tr("tx.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <TableRow key={t.id} t={t} selected={selected.has(t.id)} ctx={ctx} />
          ))}
        </tbody>
      </table>
      {footer}
    </div>
  );
}
