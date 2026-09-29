import * as React from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { Layers, Link2, Repeat, Undo2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { KIND_ICON } from "@/components/TransactionLinkSheet";
import type { TransactionLinkKind } from "@/lib/links";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { EntityVisual } from "@/components/EntityVisual";
import { fmtMoney, type Account, type Category, type Transaction } from "@/lib/finance";

/** What the 🔗 marker shows about the link a transaction belongs to. */
export interface LinkSummary {
  id: string;
  title: string;
  kind: TransactionLinkKind;
  note: string | null;
  /** Transactions in the link, this one included. */
  count: number;
  /** Signed total per currency symbol (transfers excluded). */
  totals: [string, number][];
}

interface Props {
  rows: Transaction[];
  accountById: Map<string, Account>;
  categoryById: Map<string, Category>;
  tagsByTx: Map<string, string[]>;
  reimbursementIds: Set<string>;
  selected: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  symbol: string;
  dateFmt?: string;
  locale: Locale;
  backSearch: Record<string, unknown>;
  /** Per-row action controls (edit / link / delete) rendered by the parent. */
  renderActions?: (t: Transaction) => React.ReactNode;
  /** Link membership per transaction id; rows in a link get a 🔗 marker. */
  linkByTx?: Map<string, LinkSummary>;
  /** Opens the link sheet when the marker is clicked. */
  onOpenLink?: (linkId: string) => void;
}

/**
 * Small 🔗 marker for a transaction that belongs to a link. Hover (desktop)
 * shows what the link is; click opens it, as the chip in the card view does.
 */
function LinkMarker({ link, onOpen }: { link: LinkSummary; onOpen?: (id: string) => void }) {
  const { t: tr } = useI18n();
  const KindIcon = KIND_ICON[link.kind];
  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpen?.(link.id);
          }}
          className="inline-flex shrink-0 items-center rounded p-0.5 text-primary hover:bg-primary/10"
          aria-label={tr("tx.link.marker", { title: link.title })}
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 space-y-1.5 p-3 text-xs">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <KindIcon className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{link.title}</span>
        </div>
        <div className="text-muted-foreground">
          {tr(`links.kind.${link.kind}` as never)} · {tr(link.count === 1 ? "tx.link.count_one" : "tx.link.count", { n: link.count })}
        </div>
        {link.totals.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-muted-foreground">{tr("links.totals.label")}:</span>
            {link.totals.map(([sym, sum]) => (
              <span key={sym} className={cn("font-medium tabular-nums", sum < 0 ? "text-destructive" : "text-success")}>
                {fmtMoney(sum, sym)}
              </span>
            ))}
          </div>
        )}
        {link.note && <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">{link.note}</p>}
        <div className="pt-0.5 text-[11px] text-muted-foreground">{tr("tx.link.open_hint")}</div>
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Compact, high-density listing of transactions. Complements the rich card
 * view: same data, one line per transaction, so large filtered result sets
 * stay scannable.
 */
export function TransactionTable({
  rows,
  accountById,
  categoryById,
  tagsByTx,
  reimbursementIds,
  selected,
  onToggle,
  onToggleAll,
  symbol,
  dateFmt,
  locale,
  backSearch,
  renderActions,
  linkByTx,
  onOpenLink,
}: Props) {
  const { t: tr } = useI18n();
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const df = dateFmt || "dd.MM.yyyy";

  const markers = (t: Transaction) => (
    <>
      {t.split_group_id && (
        <Layers className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={tr("tx.split.label")} />
      )}
      {t.recurring_rule_id && (
        <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={tr("tx.from_rule")} />
      )}
      {reimbursementIds.has(t.id) && (
        <Undo2 className="h-3 w-3 shrink-0 text-success" aria-label={tr("tx.reimbursement")} />
      )}
    </>
  );

  const amountCell = (t: Transaction) => {
    const src = accountById.get(t.source_account_id) ?? null;
    const sym = src?.currency_symbol ?? symbol;
    const tone =
      t.type === "expense" ? "text-destructive" : t.type === "income" ? "text-success" : "text-muted-foreground";
    const sign = t.type === "expense" ? "-" : t.type === "income" ? "+" : "";
    return (
      <span className={cn("font-medium tabular-nums whitespace-nowrap", tone)}>
        {sign}
        {fmtMoney(Number(t.amount), sym).replace("-", "")}
      </span>
    );
  };

  const title = (t: Transaction) =>
    t.description ||
    (t.type === "transfer" ? tr("tx.transfer_label") : t.type === "income" ? tr("add.income") : tr("add.expense"));

  return (
    <div>
      {/* Desktop table */}
      <div className="hidden overflow-auto rounded-md md:block max-h-[calc(100vh-280px)]">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card shadow-sm">
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-9 px-2 py-2">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(v) => onToggleAll(v === true)}
                  aria-label={tr("tx.bulk.select_all")}
                />
              </th>
              <th className="px-2 py-2 text-left font-medium">{tr("add.date")}</th>
              <th className="px-2 py-2 text-left font-medium">{tr("add.description")}</th>
              <th className="px-2 py-2 text-left font-medium">{tr("add.category")}</th>
              <th className="px-2 py-2 text-left font-medium">{tr("add.account")}</th>
              <th className="px-2 py-2 text-left font-medium">{tr("tx.all_tags")}</th>
              <th className="px-2 py-2 text-right font-medium">{tr("tx.amount")}</th>
              {renderActions && <th className="w-px px-2 py-2 text-right font-medium">{tr("tx.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const cat = t.category_id ? categoryById.get(t.category_id) ?? null : null;
              const src = accountById.get(t.source_account_id) ?? null;
              const tags = tagsByTx.get(t.id) ?? [];
              const isSel = selected.has(t.id);
              return (
                <tr key={t.id} className={cn("border-b hover:bg-muted/40", isSel && "bg-primary/5")}>
                  <td className="px-2 py-1.5 align-middle">
                    <Checkbox
                      checked={isSel}
                      onCheckedChange={(v) => onToggle(t.id, v === true)}
                      aria-label={title(t)}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 align-middle text-xs text-muted-foreground tabular-nums">
                    {format(new Date(t.occurred_on), df, { locale })}
                  </td>
                  <td className="max-w-[22rem] px-2 py-1.5 align-middle">
                    <div className="flex min-w-0 items-center gap-1">
                      <Link
                        to="/edit/$id"
                        params={{ id: t.id }}
                        search={{ back: backSearch }}
                        className="flex min-w-0 items-center gap-1.5 hover:underline"
                      >
                        {markers(t)}
                        <span className="truncate">{title(t)}</span>
                      </Link>
                      {linkByTx?.get(t.id) && <LinkMarker link={linkByTx.get(t.id)!} onOpen={onOpenLink} />}
                    </div>
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
                  <td className="px-2 py-1.5 text-right align-middle">{amountCell(t)}</td>
                  {renderActions && (
                    <td className="whitespace-nowrap px-2 py-1 text-right align-middle">
                      <div className="flex items-center justify-end">{renderActions(t)}</div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile condensed list */}
      <ul className="divide-y md:hidden">
        {rows.map((t) => {
          const cat = t.category_id ? categoryById.get(t.category_id) ?? null : null;
          const src = accountById.get(t.source_account_id) ?? null;
          const tags = tagsByTx.get(t.id) ?? [];
          const isSel = selected.has(t.id);
          return (
            <li key={t.id} className={cn("flex items-start gap-2 px-3 py-2", isSel && "bg-primary/5")}>
              <Checkbox
                className="mt-0.5"
                checked={isSel}
                onCheckedChange={(v) => onToggle(t.id, v === true)}
                aria-label={title(t)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1">
                    <Link
                      to="/edit/$id"
                      params={{ id: t.id }}
                      search={{ back: backSearch }}
                      className="flex min-w-0 items-center gap-1.5 text-sm"
                    >
                      {markers(t)}
                      <span className="truncate">{title(t)}</span>
                    </Link>
                    {linkByTx?.get(t.id) && <LinkMarker link={linkByTx.get(t.id)!} onOpen={onOpenLink} />}
                  </div>
                  {amountCell(t)}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{format(new Date(t.occurred_on), df, { locale })}</span>
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
                {renderActions && <div className="mt-0.5 flex items-center">{renderActions(t)}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
