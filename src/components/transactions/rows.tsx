import * as React from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import {
  ArrowDown, ArrowUp, ArrowLeftRight, ChevronDown, ChevronRight, FileText, Layers, Link2, MapPin, Pencil, Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { EntityVisual } from "@/components/EntityVisual";
import { TransactionLinkPicker } from "@/components/TransactionLinkPicker";
import { KIND_ICON } from "@/components/TransactionLinkSheet";
import { cn } from "@/lib/utils";
import { highlightTokens, normalize } from "@/lib/highlight";
import { locationFromRow, type TxLocation } from "@/lib/location";
import type { TransactionLinkKind } from "@/lib/links";
import { fmtMoney, type Account, type Category, type Transaction } from "@/lib/finance";

/**
 * Row components of the Transactions page (card view, split groups, table).
 *
 * They are memoised and take everything shared through one `RowContext`
 * built once per data or filter change, plus per-row booleans. Ticking a
 * checkbox therefore re-renders one row, and a refetch that brings nothing
 * new re-renders none — with inline rows each of those re-rendered the whole
 * list (0.4 s at 500 transactions, 1.4 s at 2,000).
 */

/** What the 🔗 marker and the link chip show about a transaction's link. */
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

export interface StatementRef {
  importId: string;
  fileName: string;
  hasDoc: boolean;
}

export interface RowContext {
  accountById: Map<string, Account>;
  categoryById: Map<string, Category>;
  tagsByTx: Map<string, string[]>;
  reimbursementIds: Set<string>;
  stmtRefs: Record<string, StatementRef>;
  linkByTx: Map<string, LinkSummary>;
  ruleById: Map<string, { name: string }>;
  tokens: string[];
  /** Whether an amount matches the amount filter or a numeric search token. */
  amountMatched: (amount: number) => boolean;
  symbol: string;
  /** Show the date in the row (sorts that are not grouped by day). */
  showDate: boolean;
  dateFmt: string;
  locale: Locale;
  tr: (key: string, vars?: Record<string, string | number>) => string;
  backSearch: Record<string, unknown>;
  /** ≥ 640 px: amount top right, actions in their own column. */
  isSm: boolean;
  /** YYYY-MM-DD (UTC), for the "upcoming" chip. */
  today: string;
  onToggle: (id: string, checked: boolean) => void;
  onToggleMany: (ids: string[], checked: boolean) => void;
  onDelete: (id: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onOpenLink: (linkId: string) => void;
  onPeekLocation: (loc: TxLocation) => void;
  onToggleGroup: (groupId: string) => void;
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/**
 * A note with inline #hashtags shown as chips. Plain text segments keep
 * search-token highlighting; a chip highlights when a token matches the tag.
 */
function renderNoteWithTags(note: string, tokens: string[]): React.ReactNode {
  const re = /#([\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(note)) !== null) {
    if (m.index > last) {
      out.push(<span key={`t${i}`}>{highlightTokens(note.slice(last, m.index), tokens)}</span>);
    }
    const tagBody = m[1];
    const matched = tokens.some((tok) => normalize(tagBody).includes(normalize(tok.replace(/^#/, ""))));
    out.push(
      <Badge
        key={`g${i}`}
        variant="secondary"
        className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", matched && "ring-1 ring-yellow-400/60")}
      >
        {`#${tagBody}`}
      </Badge>,
    );
    last = m.index + m[0].length;
    i++;
  }
  if (last < note.length) out.push(<span key={`t${i}`}>{highlightTokens(note.slice(last), tokens)}</span>);
  return out;
}

export function TagBadges({ tags, tokens }: { tags: string[]; tokens: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {tags.map((t) => {
        const matched = tokens.some((tok) => normalize(t).includes(normalize(tok.replace(/^#/, ""))));
        return (
          <Badge
            key={t}
            variant="secondary"
            className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", matched && "ring-1 ring-yellow-400/60")}
          >
            {`#${t}`}
          </Badge>
        );
      })}
    </div>
  );
}

function RowVisual({
  entity,
  typeIcon,
  tone,
}: {
  entity: { name: string; icon?: string | null; emoji?: string | null; image_url?: string | null; color?: string | null } | null;
  typeIcon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="relative mt-0.5 shrink-0">
      {entity ? (
        <EntityVisual entity={entity} size="md" />
      ) : (
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-full bg-muted", tone)}>{typeIcon}</div>
      )}
      {entity && (
        <div className={cn("absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background ring-1 ring-border", tone)}>
          {typeIcon}
        </div>
      )}
    </div>
  );
}

function ArrowRightDot() {
  return <span className="text-muted-foreground">→</span>;
}

function typeStyle(type: Transaction["type"]) {
  return {
    Icon: type === "expense" ? ArrowDown : type === "income" ? ArrowUp : ArrowLeftRight,
    tone: type === "expense" ? "text-destructive" : type === "income" ? "text-success" : "text-muted-foreground",
    sign: type === "expense" ? "-" : type === "income" ? "+" : "",
  };
}

function Amount({ value, sym, sign, tone, marked }: { value: number; sym: string; sign: string; tone: string; marked: boolean }) {
  const text = `${sign}${fmtMoney(value, sym).replace("-", "")}`;
  return (
    <div className={cn("text-sm font-semibold tabular-nums whitespace-nowrap", tone)}>
      {marked ? <mark className="rounded bg-yellow-200/70 px-1 dark:bg-yellow-500/30">{text}</mark> : text}
    </div>
  );
}

/**
 * The 🔗 marker for a transaction in a link. Hover shows what the link is;
 * click opens it, as the chip in the card view does.
 */
export function LinkMarker({ link, onOpen, tr }: { link: LinkSummary; onOpen?: (id: string) => void; tr: RowContext["tr"] }) {
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
          {tr(`links.kind.${link.kind}`)} · {tr(link.count === 1 ? "tx.link.count_one" : "tx.link.count", { n: link.count })}
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

/** Edit, link and delete — the same three actions in every view. */
export function RowActions({ tx, ctx }: { tx: Transaction; ctx: RowContext }) {
  const { tr } = ctx;
  return (
    <>
      <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label={tr("common.edit")}>
        <Link to="/edit/$id" params={{ id: tx.id }} search={{ back: ctx.backSearch }}>
          <Pencil className="h-4 w-4" />
        </Link>
      </Button>
      <TransactionLinkPicker transactionId={tx.id} currentLinkId={ctx.linkByTx.get(tx.id)?.id ?? null} compact />
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={() => ctx.onDelete(tx.id)}
        aria-label={tr("common.delete")}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Card view
// ---------------------------------------------------------------------------

const CHIP = "shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase";

export const CardRow = React.memo(function CardRow({
  tx: t,
  selected,
  ctx,
}: {
  tx: Transaction;
  selected: boolean;
  ctx: RowContext;
}) {
  const { tr, tokens } = ctx;
  const { Icon, tone, sign } = typeStyle(t.type);
  const src = ctx.accountById.get(t.source_account_id) ?? null;
  const dst = t.destination_account_id ? ctx.accountById.get(t.destination_account_id) ?? null : null;
  const cat = t.category_id ? ctx.categoryById.get(t.category_id) ?? null : null;
  const primary = cat ?? src;
  const txSym = src?.currency_symbol ?? ctx.symbol;
  const dstSym = dst?.currency_symbol ?? txSym;
  const showDstAmount =
    t.type === "transfer" && dst && t.destination_amount != null && (src?.currency_code ?? "") !== (dst?.currency_code ?? "");
  const amount = (
    <div className="flex items-baseline">
      <Amount value={Number(t.amount)} sym={txSym} sign={sign} tone={tone} marked={ctx.amountMatched(Number(t.amount))} />
      {showDstAmount && (
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          → {fmtMoney(Number(t.destination_amount), dstSym).replace("-", "")}
        </span>
      )}
    </div>
  );

  const chips: React.ReactNode[] = [];
  if (t.type === "income" && ctx.reimbursementIds.has(t.id)) {
    chips.push(<span key="reimb" className={cn(CHIP, "bg-success/15 text-success")}>{tr("tx.reimbursement")}</span>);
  }
  if (t.is_reimbursable && t.reimbursable_status) {
    chips.push(
      <span
        key="reimb-status"
        className={cn(
          CHIP,
          t.reimbursable_status === "open" && "bg-warning/15 text-warning",
          t.reimbursable_status === "settled" && "bg-success/15 text-success",
          (t.reimbursable_status === "written_off" || t.reimbursable_status === "cancelled") && "bg-muted text-muted-foreground",
        )}
        title={t.reimbursable_counterparty ?? ""}
      >
        {tr(`tx.reimb.status.${t.reimbursable_status}`)}
      </span>,
    );
  }
  if (t.recurring_rule_id) {
    const rule = ctx.ruleById.get(t.recurring_rule_id);
    chips.push(
      <Link
        key="rule"
        to="/settings"
        hash={`rule-${t.recurring_rule_id}`}
        onClick={(ev) => ev.stopPropagation()}
        className={cn(CHIP, "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground")}
        title={rule?.name ?? ""}
      >
        {tr("tx.from_rule")}
        {rule ? `: ${rule.name}` : ""}
      </Link>,
    );
  }
  if (t.occurred_on > ctx.today) {
    chips.push(
      <span key="upcoming" className={cn(CHIP, "bg-warning/20 text-warning")}>
        {tr("dashboard.top_month.upcoming")}
      </span>,
    );
  }
  const lnk = ctx.linkByTx.get(t.id);
  if (lnk) {
    const LinkIcon = KIND_ICON[lnk.kind];
    chips.push(
      <button
        key="link"
        type="button"
        onClick={(ev) => {
          ev.preventDefault();
          ctx.onOpenLink(lnk.id);
        }}
        className={cn(CHIP, "inline-flex items-center gap-1 bg-primary/10 text-primary hover:bg-primary/20")}
        title={lnk.title}
      >
        <LinkIcon className="h-3 w-3" /> {lnk.title}
      </button>,
    );
  }
  const txLoc = locationFromRow(t as never);
  if (txLoc) {
    chips.push(
      <button
        key="loc"
        type="button"
        onClick={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          ctx.onPeekLocation(txLoc);
        }}
        className={cn(CHIP, "inline-flex items-center gap-1 bg-muted text-muted-foreground hover:bg-accent hover:text-foreground")}
        title={txLoc.label ?? tr("loc.title")}
      >
        <MapPin className="h-3 w-3" /> {txLoc.label ? txLoc.label.split(",")[0] : tr("loc.title")}
      </button>,
    );
  }
  const stmt = ctx.stmtRefs[t.id];
  if (stmt) {
    chips.push(
      <Link
        key="stmt"
        to="/statements"
        search={{ import: stmt.importId }}
        onClick={(ev) => ev.stopPropagation()}
        className={cn(CHIP, "inline-flex items-center gap-1 bg-muted text-muted-foreground hover:bg-accent hover:text-foreground")}
        title={stmt.fileName}
      >
        <FileText className="h-3 w-3" /> {stmt.fileName}
      </Link>,
    );
  }

  const actions = <RowActions tx={t} ctx={ctx} />;
  const title =
    t.description || (t.type === "transfer" ? tr("tx.transfer_label") : t.type === "income" ? tr("add.income") : tr("add.expense"));

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Checkbox
        className="mt-3"
        checked={selected}
        onCheckedChange={(v) => ctx.onToggle(t.id, v === true)}
        aria-label={tr("tx.bulk.select_row")}
      />
      <RowVisual entity={primary} typeIcon={<Icon className="h-3 w-3" />} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="grid grid-cols-1 items-start gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-2">
          <div className="min-w-0 break-words text-sm font-medium">{highlightTokens(title, tokens)}</div>
          {ctx.isSm && <div>{amount}</div>}
        </div>
        {chips.length > 0 && (
          <div className="-mx-1 mt-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {chips}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {src && <EntityVisual entity={src} size="xs" />}
            {highlightTokens(src?.name ?? "?", tokens)}
          </span>
          {t.type === "transfer" && dst && (
            <>
              <ArrowRightDot />
              <span className="inline-flex items-center gap-1">
                <EntityVisual entity={dst} size="xs" />
                {highlightTokens(dst.name, tokens)}
              </span>
            </>
          )}
          {cat && t.type !== "transfer" && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <EntityVisual entity={cat} size="xs" />
                {highlightTokens(cat.name, tokens)}
              </span>
            </>
          )}
          {ctx.showDate && (
            <>
              <span>·</span>
              <span>{format(new Date(t.occurred_on), "MMM d, yyyy", { locale: ctx.locale })}</span>
            </>
          )}
        </div>
        {t.note && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {renderNoteWithTags(t.note, tokens)}
          </div>
        )}
        {!ctx.isSm && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {amount}
            <div className="flex items-center">{actions}</div>
          </div>
        )}
      </div>
      {ctx.isSm && <div className="flex shrink-0 items-center">{actions}</div>}
    </div>
  );
});

export const SplitGroupRow = React.memo(function SplitGroupRow({
  groupId,
  txs,
  selected,
  open,
  ctx,
}: {
  groupId: string;
  txs: Transaction[];
  selected: boolean;
  open: boolean;
  ctx: RowContext;
}) {
  const { tr, tokens } = ctx;
  const first = txs[0];
  const total = txs.reduce((s, x) => s + Number(x.amount), 0);
  const { Icon, tone, sign } = typeStyle(first.type);
  const src = ctx.accountById.get(first.source_account_id);
  const grpSym = src?.currency_symbol ?? ctx.symbol;
  const ChevIcon = open ? ChevronDown : ChevronRight;
  const headerLabel = txs.map((x) => x.description).filter(Boolean).slice(0, 2).join(", ") || tr("tx.split.label");
  const perSliceTags = txs.map((x) => ctx.tagsByTx.get(x.id) ?? []);
  const unionTags = Array.from(new Set(perSliceTags.flat()));
  const sharedTags = perSliceTags.reduce<string[]>(
    (acc, cur, idx) => (idx === 0 ? [...cur] : acc.filter((tg) => cur.includes(tg))),
    [],
  );
  const amount = <Amount value={total} sym={grpSym} sign={sign} tone={tone} marked={ctx.amountMatched(total)} />;

  return (
    <div className="bg-muted/20">
      <div className="flex w-full items-start gap-3 px-4 py-3 hover:bg-muted/40">
        <Checkbox
          className="mt-3"
          checked={selected}
          onCheckedChange={(v) => ctx.onToggleMany(txs.map((x) => x.id), v === true)}
          aria-label={tr("tx.bulk.select_row")}
        />
        <button type="button" onClick={() => ctx.onToggleGroup(groupId)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <RowVisual entity={src ?? null} typeIcon={<Icon className="h-3 w-3" />} tone={tone} />
          <div className="min-w-0 flex-1">
            <div className="grid min-w-0 grid-cols-1 items-start gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-2">
              <div className="flex min-w-0 items-start gap-1.5">
                <ChevIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-words text-sm font-medium">{highlightTokens(headerLabel, tokens)}</span>
              </div>
              {ctx.isSm && <div className="sm:text-right">{amount}</div>}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-foreground">
                <Layers className="h-3 w-3" /> {tr("tx.split.label")}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {highlightTokens(src?.name ?? "?", tokens)} ·{" "}
              {open ? tr("tx.split.collapse") : tr("tx.split.expand", { n: txs.length })}
            </div>
            <TagBadges tags={open ? sharedTags : unionTags} tokens={tokens} />
            {!ctx.isSm && <div className="mt-1.5">{amount}</div>}
          </div>
        </button>
        <div className="flex shrink-0 items-center self-center">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label={tr("common.edit")}>
            <Link to="/edit/$id" params={{ id: first.id }} search={{ back: ctx.backSearch }}>
              <Pencil className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            aria-label={tr("common.delete")}
            onClick={() => ctx.onDeleteGroup(groupId)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {open && (
        <ul className="border-t bg-background">
          {txs.map((t) => {
            const cat = t.category_id ? ctx.categoryById.get(t.category_id) : null;
            return (
              <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-2 pl-14 text-sm">
                <div className="min-w-0">
                  <div className="break-words font-medium">{highlightTokens(t.description || tr("add.split.no_category"), tokens)}</div>
                  <div className="text-xs text-muted-foreground">{highlightTokens(cat?.name ?? tr("add.split.no_category"), tokens)}</div>
                  <TagBadges tags={ctx.tagsByTx.get(t.id) ?? []} tokens={tokens} />
                </div>
                <div className={cn("tabular-nums font-medium", tone)}>
                  {sign}
                  {fmtMoney(Number(t.amount), grpSym).replace("-", "")}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
