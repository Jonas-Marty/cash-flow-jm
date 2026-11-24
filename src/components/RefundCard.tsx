import * as React from "react";
import { format } from "date-fns";
import { Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StringAutocomplete } from "@/components/StringAutocomplete";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { fmtMoney, type Transaction } from "@/lib/finance";
import { formatAmountInput } from "@/lib/amountInput";
import { findSubsetSumMatch, defaultTolerance, REIMB_MATCH_MAX_CANDIDATES } from "@/lib/reimbMatch";
import {
  defaultDecision,
  isMyShare,
  pickIssue,
  r2,
  rankRefundCandidates,
  restOf,
  type RefundDecision,
  type RefundPicks,
} from "@/lib/refundPlan";

/** How many expenses the list shows besides the ticked ones. */
const SHOWN = 8;

export interface RefundCardProps {
  /** What this income (or split line) brings. */
  lineAmount: number | null;
  picks: RefundPicks;
  onPicksChange: (next: RefundPicks) => void;
  /** Expenses to choose from, plus the ticked ones. */
  candidates: Transaction[];
  /** What each expense can still take from this line. */
  openById: Map<string, number>;
  /** Expenses this row already repaid before the form opened. */
  existingIds: Set<string>;
  /** Of those, written off or cancelled: they stay exactly as they are. */
  lockedIds: Set<string>;
  loading: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  /** Matches left out because they are in another currency. */
  otherCurrency: number;
  counterparty: string;
  onCounterpartyChange: (v: string) => void;
  counterpartyOptions: string[];
  categories: Array<{ id: string; name: string }>;
  /** Category for whatever the income brings beyond the expenses. */
  surplusCategoryId: string | null;
  onSurplusCategoryChange: (id: string | null) => void;
  /** Present when the surplus may become its own line of the income. */
  onSplitSurplus?: () => void;
  incomeDate: Date;
  symbol: string;
  dateFmt: string;
  className?: string;
}

const NONE = "__none__";

function CategorySelect({
  value,
  onChange,
  categories,
  placeholder,
  id,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  categories: Array<{ id: string; name: string }>;
  placeholder: string;
  id?: string;
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} className="h-8 w-auto min-w-[10rem] max-w-full text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE} className="text-xs text-muted-foreground">
          {placeholder}
        </SelectItem>
        {categories.map((c) => (
          <SelectItem key={c.id} value={c.id} className="text-xs">
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap overflow-hidden rounded-md border border-border"
    >
      {options.map(([v, text], i) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={cn(
            "px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            i > 0 && "border-l border-border",
            v === value ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Amount typed freely, tidied to cents when left. */
function AmountField({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  const [text, setText] = React.useState(() => formatAmountInput(String(value)));
  React.useEffect(() => {
    setText((cur) =>
      Math.abs((Number(cur.replace(",", ".")) || 0) - value) < 0.005
        ? cur
        : formatAmountInput(String(value)),
    );
  }, [value]);
  return (
    <Input
      inputMode="decimal"
      aria-label={label}
      className="h-8 w-28 text-right tabular-nums"
      value={text}
      onChange={(e) => {
        const v = e.target.value.replace(/[^0-9.,]/g, "");
        setText(v);
        const n = Number(v.replace(",", "."));
        if (Number.isFinite(n)) onChange(Math.round(n * 100) / 100);
      }}
      onBlur={() => setText((v) => formatAmountInput(v))}
    />
  );
}

export function RefundCard(props: RefundCardProps) {
  const {
    lineAmount,
    picks,
    onPicksChange,
    candidates,
    openById,
    existingIds,
    lockedIds,
    loading,
    query,
    onQueryChange,
    otherCurrency,
    counterparty,
    onCounterpartyChange,
    counterpartyOptions,
    categories,
    surplusCategoryId,
    onSurplusCategoryChange,
    onSplitSurplus,
    incomeDate,
    symbol,
    dateFmt,
    className,
  } = props;
  const { t: tr, locale } = useI18n();
  const money = (n: number) => fmtMoney(n, symbol);
  const catName = (id: string | null | undefined) =>
    (id && categories.find((c) => c.id === id)?.name) || tr("refund.no_category");
  const month = (d: Date) => format(d, "LLL yyyy", { locale });

  const pickedIds = Object.keys(picks);
  const linked = r2(pickedIds.reduce((s, id) => s + (Number(picks[id].amount) || 0), 0));
  const amount = lineAmount ?? 0;
  const unassigned = r2(amount - linked);
  const open = (id: string, fallback: number) => openById.get(id) ?? fallback;

  const ranked = React.useMemo(() => {
    const rows = candidates.map((t) => ({
      ...t,
      open: open(t.id, Number(t.amount)),
      counterparty: t.reimbursable_counterparty ?? null,
    }));
    const target = unassigned > 0.005 ? unassigned : amount > 0 ? amount : null;
    return rankRefundCandidates(rows, target, counterparty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, openById, unassigned, amount, counterparty]);

  const picked = ranked.filter((t) => picks[t.id]);
  const rest = ranked.filter((t) => !picks[t.id] && t.open > 0.005);
  const shown = [...picked, ...rest.slice(0, SHOWN)];

  const suggestion = React.useMemo(() => {
    if (pickedIds.length > 0 || !(amount > 0)) return null;
    const pool = rest.slice(0, REIMB_MATCH_MAX_CANDIDATES);
    const m = findSubsetSumMatch(
      pool.map((t) => t.open),
      amount,
      defaultTolerance(amount),
    );
    if (!m) return null;
    return { items: m.indices.map((i) => pool[i]), total: m.total, exact: m.exact };
  }, [pickedIds.length, amount, rest]);

  const setPick = (id: string, next: RefundPicks[string] | null) => {
    const copy = { ...picks };
    if (next) copy[id] = next;
    else delete copy[id];
    onPicksChange(copy);
  };
  const setDecision = (id: string, patch: Partial<RefundDecision>) => {
    const p = picks[id];
    if (!p?.decision) return;
    setPick(id, { ...p, decision: { ...p.decision, ...patch } });
  };
  const toggle = (t: Transaction & { open: number }) => {
    if (picks[t.id]) {
      setPick(t.id, null);
      return;
    }
    const amt = unassigned > 0.005 ? Math.min(t.open, unassigned) : t.open;
    setPick(
      t.id,
      existingIds.has(t.id)
        ? { amount: r2(amt) }
        : { amount: r2(amt), decision: defaultDecision(t) },
    );
  };
  const takeSuggestion = () => {
    if (!suggestion) return;
    const copy = { ...picks };
    let left = amount;
    for (const t of suggestion.items) {
      const amt = r2(Math.min(t.open, Math.max(left, 0)) || t.open);
      left = r2(left - amt);
      copy[t.id] = existingIds.has(t.id)
        ? { amount: amt }
        : { amount: amt, decision: defaultDecision(t) };
    }
    onPicksChange(copy);
  };

  const needsCounterparty = picked.some(
    (t) => picks[t.id]?.decision && !t.reimbursable_counterparty,
  );
  const unticked = [...existingIds].filter((id) => !picks[id]);

  return (
    <Card className={cn(pickedIds.length > 0 && "border-primary/60", className)}>
      <CardContent className="space-y-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LinkIcon className="h-4 w-4" aria-hidden />
            {tr("refund.title")}
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px]",
              pickedIds.length ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            {pickedIds.length
              ? tr("refund.selected", { n: pickedIds.length })
              : tr("refund.optional")}
          </span>
        </div>

        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={tr("refund.search_placeholder")}
          aria-label={tr("refund.search_placeholder")}
        />

        {suggestion && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs">
            <span>
              {tr("refund.suggest", {
                list: suggestion.items.map((t) => t.description || tr("add.expense")).join(" + "),
                amount: money(suggestion.total),
              })}
              {suggestion.exact && <> · {tr("refund.suggest.exact")}</>}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              onClick={takeSuggestion}
            >
              {tr("refund.suggest.take")}
            </Button>
          </div>
        )}

        <ul className="space-y-1.5">
          {shown.map((t) => {
            const pick = picks[t.id];
            const on = !!pick;
            const locked = lockedIds.has(t.id);
            const isNew = !!pick?.decision;
            const badges: React.ReactNode[] = [];
            if (t.is_reimbursable && t.reimbursable_counterparty) {
              badges.push(
                <span key="r" className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">
                  {tr("refund.badge.reimb", { name: t.reimbursable_counterparty })}
                </span>,
              );
            } else if (on && isNew && !t.is_reimbursable) {
              badges.push(
                <span key="b" className="rounded-full bg-primary/15 px-2 py-0.5 text-primary">
                  {tr("refund.badge.becomes")}
                </span>,
              );
            }
            if (existingIds.has(t.id) && !on && t.reimbursable_flagged_by_link) {
              badges.push(
                <span key="u" className="rounded-full bg-muted px-2 py-0.5">
                  {tr("refund.badge.unflag")}
                </span>,
              );
            }
            if (existingIds.has(t.id) && on)
              badges.push(
                <span key="c" className="rounded-full bg-muted px-2 py-0.5">
                  {tr("add.reimb.link.covered_now")}
                </span>,
              );
            if (t.split_group_id)
              badges.push(
                <span key="s" className="rounded-full bg-muted px-2 py-0.5">
                  {tr("refund.badge.split")}
                </span>,
              );
            const paidBefore = r2(Number(t.amount) - t.open);
            return (
              <li
                key={t.id}
                className={cn(
                  "rounded-md border border-border/70 px-2.5 py-2",
                  on && "border-primary/60 bg-primary/5",
                )}
              >
                <label
                  className={cn(
                    "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5",
                    locked ? "cursor-not-allowed" : "cursor-pointer",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={on}
                    disabled={locked}
                    onChange={() => toggle(t)}
                  />
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium">
                      {t.description || tr("add.expense")}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="tabular-nums">
                        {format(new Date(t.occurred_on + "T00:00:00"), dateFmt)}
                      </span>
                      <span>· {catName(t.category_id)}</span>
                      {badges}
                    </span>
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums">
                    {money(Number(t.amount))}
                    {paidBefore > 0.005 && !on && (
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {tr("refund.open", { amount: money(t.open) })}
                      </span>
                    )}
                  </span>
                </label>
                {locked && (
                  <p className="mt-1 pl-6 text-[11px] text-muted-foreground">
                    {tr(
                      t.reimbursable_status === "written_off"
                        ? "add.reimb.link.locked_written_off"
                        : "add.reimb.link.locked_cancelled",
                    )}
                  </p>
                )}
                {on && !locked && pickDetails(t)}
              </li>
            );
          })}
        </ul>

        {loading && <p className="text-xs text-muted-foreground">{tr("refund.loading")}</p>}
        {!loading && shown.length === 0 && (
          <p className="text-xs text-muted-foreground">{tr("refund.none_found")}</p>
        )}
        {(rest.length > SHOWN || otherCurrency > 0) && (
          <p className="text-[11px] text-muted-foreground">
            {rest.length > SHOWN && tr("refund.more", { n: rest.length - SHOWN })}{" "}
            {otherCurrency > 0 && tr("refund.other_currency", { n: otherCurrency })}
          </p>
        )}
        {unticked.length > 0 && (
          <p className="text-[11px] text-muted-foreground">{tr("add.reimb.link.edit_hint")}</p>
        )}

        {pickedIds.length > 0 && needsCounterparty && (
          <div>
            <label className="mb-1 block text-xs font-medium">{tr("refund.counterparty")}</label>
            <StringAutocomplete
              value={counterparty}
              onChange={onCounterpartyChange}
              options={counterpartyOptions}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {tr("refund.counterparty_hint")}
            </p>
          </div>
        )}

        {pickedIds.length > 0 &&
          amount > 0 &&
          (unassigned < -0.005 ? (
            <div className="flex flex-wrap justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span>{tr("refund.bar.assigned", { sel: money(linked), inc: money(amount) })}</span>
              <span>{tr("refund.bar.over", { amount: money(-unassigned) })}</span>
            </div>
          ) : unassigned > 0.005 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs">
                <span>{tr("refund.bar.assigned", { sel: money(linked), inc: money(amount) })}</span>
                <span>{tr("refund.bar.surplus", { amount: money(unassigned) })}</span>
              </div>
              {onSplitSurplus && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="min-w-[8rem] text-muted-foreground">
                    {tr("refund.surplus", { amount: money(unassigned) })}
                  </span>
                  <Seg
                    label={tr("refund.surplus", { amount: money(unassigned) })}
                    value={"credit" as const}
                    options={[
                      ["credit", tr("refund.surplus.credit")],
                      ["split", tr("refund.surplus.split")],
                    ]}
                    onChange={(v) => {
                      if (v === "split") onSplitSurplus();
                    }}
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="min-w-[8rem] text-muted-foreground">
                  {tr("refund.surplus.cat")}
                </span>
                <CategorySelect
                  value={surplusCategoryId}
                  onChange={onSurplusCategoryChange}
                  categories={categories}
                  placeholder={tr("refund.no_category")}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap justify-between gap-2 rounded-md bg-success/10 px-3 py-2 text-xs text-success">
              <span>{tr("refund.bar.assigned", { sel: money(linked), inc: money(amount) })}</span>
              <span>{tr("refund.bar.exact")}</span>
            </div>
          ))}
      </CardContent>
    </Card>
  );

  // A plain function, not a component: a component declared in here would be
  // new on every render and lose the amount field's focus while typing.
  function pickDetails(t: Transaction & { open: number }) {
    const pick = picks[t.id];
    const d = pick.decision;
    const rest = restOf(t.open, pick);
    const issue = pickIssue(t.open, pick);
    const expDate = new Date(t.occurred_on + "T00:00:00");
    const pastMonth = format(expDate, "yyyy-MM") !== format(incomeDate, "yyyy-MM");
    const mine = isMyShare(t.open, pick);
    return (
      <div className="mt-2 space-y-2 border-t border-dashed border-border pt-2 pl-6 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-[8rem] text-muted-foreground">{tr("refund.amount_label")}</span>
          <AmountField
            value={Number(pick.amount) || 0}
            onChange={(n) => setPick(t.id, { ...pick, amount: n })}
            label={tr("refund.amount_label")}
          />
          <span className="text-muted-foreground">
            {tr("refund.of_open", { amount: money(t.open) })}
          </span>
        </div>
        {issue && <p className="text-destructive">{tr(issue)}</p>}
        {d && rest > 0.005 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-[8rem] text-muted-foreground">
              {tr("refund.rest_is", { amount: money(rest) })}
            </span>
            <Seg
              label={tr("refund.rest_is", { amount: money(rest) })}
              value={d.rest}
              options={[
                ["coming", tr("refund.rest.coming")],
                ["mine", tr("refund.rest.mine")],
              ]}
              onChange={(v) => setDecision(t.id, { rest: v })}
            />
          </div>
        )}
        {d && mine && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-[8rem] text-muted-foreground">{tr("refund.share_as")}</span>
              <Seg
                label={tr("refund.share_as")}
                value={d.how}
                options={[
                  ["writeoff", tr("refund.how.writeoff")],
                  ["split", tr("refund.how.split")],
                ]}
                onChange={(v) => setDecision(t.id, { how: v })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-[8rem] text-muted-foreground">
                {tr(d.how === "writeoff" ? "refund.cat.writeoff" : "refund.cat.split")}
              </span>
              <CategorySelect
                value={d.mineCategoryId}
                onChange={(v) => setDecision(t.id, { mineCategoryId: v })}
                categories={categories}
                placeholder={tr("refund.cat.choose")}
              />
            </div>
            {d.mineCategoryId && (
              <p className="text-muted-foreground">
                {d.how === "writeoff"
                  ? tr("refund.effect.writeoff", {
                      amount: money(Number(t.amount)),
                      cat: catName(d.mineCategoryId),
                      rest: money(rest),
                    })
                  : tr("refund.effect.split", {
                      amount: money(Number(pick.amount) || 0),
                      cat: catName(d.mineCategoryId),
                      rest: money(rest),
                    })}
              </p>
            )}
          </>
        )}
        {d && !mine && rest > 0.005 && (
          <p className="text-muted-foreground">
            {tr("refund.effect.coming", {
              rest: money(rest),
              name: t.reimbursable_counterparty || counterparty || "—",
            })}
          </p>
        )}
        {d &&
          !mine &&
          (t.category_id ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-[8rem] text-muted-foreground">{tr("refund.budget")}</span>
                <Seg
                  label={tr("refund.budget")}
                  value={d.budget === "credit" ? "credit" : "remove"}
                  options={[
                    ["remove", tr("refund.budget.remove")],
                    ["credit", tr("refund.budget.credit")],
                  ]}
                  onChange={(v) => setDecision(t.id, { budget: v })}
                />
              </div>
              {d.budget === "credit" && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[8rem] text-muted-foreground">
                    {tr("refund.income_cat")}
                  </span>
                  <CategorySelect
                    value={d.incomeCategoryId}
                    onChange={(v) => setDecision(t.id, { incomeCategoryId: v })}
                    categories={categories}
                    placeholder={tr("refund.no_category")}
                  />
                  {d.incomeCategoryId !== t.category_id && (
                    <span className="text-muted-foreground">
                      {tr("refund.income_cat_differs", { cat: catName(t.category_id) })}
                    </span>
                  )}
                </div>
              )}
              <p className="text-muted-foreground">
                {d.budget === "credit"
                  ? tr("refund.effect.credit", {
                      cat: catName(t.category_id),
                      expMonth: month(expDate),
                      icat: catName(d.incomeCategoryId),
                      incMonth: month(incomeDate),
                      amount: money(Number(pick.amount) || 0),
                    })
                  : tr("refund.effect.remove", {
                      cat: catName(t.category_id),
                      month: month(expDate),
                      amount: money(Number(t.amount)),
                    }) + (pastMonth ? tr("refund.effect.past_month") : "")}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">{tr("refund.effect.no_cat")}</p>
          ))}
      </div>
    );
  }
}
