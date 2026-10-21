import * as React from "react";
import { format, parseISO, subMonths } from "date-fns";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  Pencil,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PrivacyValue } from "@/components/DashboardPrivacy";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { fmtMoney, type Category } from "@/lib/finance";
import {
  filterMoves,
  moveTotals,
  type Move,
  type MoveFilter,
  type MoveKind,
  type MovePart,
  type ShownMove,
} from "@/lib/allocations";

const ALL = "__all__";

const KIND = {
  plan: { Icon: Plus, cls: "bg-success/15 text-success" },
  sweep: { Icon: ArrowDownToLine, cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  realloc: { Icon: ArrowLeftRight, cls: "bg-warning/20 text-warning" },
  transfer: { Icon: ArrowUpRight, cls: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" },
} as const;

function KindIcon({ kind }: { kind: MoveKind }) {
  const { Icon, cls } = KIND[kind];
  return (
    <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-md", cls)}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

const plain = (v: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Budgets → Zuteilungen: every movement between budgets in the month, with a
 * summary by kind and filters by kind and budget. A table on desktop, a list
 * grouped by day on a phone.
 */
export function AllocationsView({
  moves,
  categoriesById,
  symbol,
  onEditReallocation,
  onOpenTransaction,
}: {
  moves: Move[];
  categoriesById: Map<string, Category>;
  symbol: string;
  onEditReallocation: (id: string) => void;
  /** A transfer's difference is edited on the transfer. */
  onOpenTransaction: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const isDesktop = useIsDesktop();
  const [filter, setFilter] = React.useState<MoveFilter>("all");
  const [budget, setBudget] = React.useState<string>(ALL);
  // The plan is the long one: open on desktop, closed on a phone until asked for.
  const [toggled, setToggled] = React.useState<Set<string>>(() => new Set());
  const isOpen = (m: Move) => (m.kind === "plan" && isDesktop) !== toggled.has(m.key);
  const toggle = (key: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const totals = React.useMemo(() => moveTotals(moves), [moves]);
  // Transfers with a difference are rare; their tile and chip appear when present.
  const hasTransfers = totals.transfer.count > 0;
  const filters: MoveFilter[] = hasTransfers
    ? ["all", "plan", "sweep", "realloc", "transfer"]
    : ["all", "plan", "sweep", "realloc"];
  const shown = React.useMemo(
    () => filterMoves(moves, filter, budget === ALL ? null : budget),
    [moves, filter, budget],
  );

  // Budgets that appear in any move this month, for the budget filter.
  const budgetOptions = React.useMemo(() => {
    const ids = new Set<string>();
    for (const m of moves) {
      if (m.fromId) ids.add(m.fromId);
      if (m.toId) ids.add(m.toId);
      for (const p of m.parts) ids.add(p.categoryId);
    }
    return [...ids]
      .map((id) => ({ id, name: categoriesById.get(id)?.name ?? "" }))
      .filter((o) => o.name)
      .sort((a, b) => a.name.localeCompare(b.name, locale.code));
  }, [moves, categoriesById, locale.code]);
  React.useEffect(() => {
    if (budget !== ALL && !budgetOptions.some((o) => o.id === budget)) setBudget(ALL);
  }, [budget, budgetOptions]);

  const name = (id: string | null) =>
    id
      ? (categoriesById.get(id)?.name ?? t("env.ledger.unknown_category"))
      : t("env.moves.unassigned");
  const count = (n: number) =>
    n === 1 ? t("env.moves.one_budget") : t("env.moves.n_budgets", { n: String(n) });
  const fromLabel = (m: Move) =>
    m.kind === "plan"
      ? t("env.moves.plan")
      : m.fromId || m.kind === "realloc" || m.kind === "transfer"
        ? name(m.fromId)
        : count(m.parts.length);
  const toLabel = (m: Move) => (m.toId ? name(m.toId) : count(m.parts.length));
  const day = (d: string) => format(parseISO(d), "d MMM", { locale });
  // Leftovers arrive on the first of the month and come from the month before.
  const sweepDate = moves.find((m) => m.kind === "sweep")?.date ?? null;
  const sweptMonth = sweepDate ? subMonths(parseISO(sweepDate), 1) : null;

  const amountText = (s: ShownMove) =>
    s.signed === null
      ? fmtMoney(s.move.amount, symbol)
      : `${s.signed > 0 ? "+" : s.signed < 0 ? "−" : ""}${fmtMoney(Math.abs(s.signed), symbol)}`;
  const amountTone = (s: ShownMove) =>
    s.signed === null ? "" : s.signed > 0 ? "text-success" : s.signed < 0 ? "text-destructive" : "";
  const expandable = (m: Move) => m.parts.length > 1;
  const activate = (m: Move) => {
    if (m.kind === "transfer" && m.transactionId) onOpenTransaction(m.transactionId);
    else if (m.kind === "realloc" && m.reallocationId) onEditReallocation(m.reallocationId);
    else if (expandable(m)) toggle(m.key);
  };
  const partDetail = (m: Move, p: MovePart) =>
    m.kind === "sweep" && p.allocated != null && p.actual != null
      ? t(p.income ? "env.ledger.sweep_income" : "env.ledger.sweep_expense", {
          a: plain(p.allocated),
          b: plain(p.actual),
        })
      : null;

  const summary = (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-lg border bg-border",
        hasTransfers ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
      )}
    >
      {(
        [
          [
            "plan",
            t("env.moves.plan"),
            totals.plan.amount,
            t("env.moves.sum.plan_sub", { n: String(totals.plan.count) }),
          ],
          [
            "sweep",
            sweptMonth
              ? t("env.moves.sum.sweep", { month: format(sweptMonth, "MMMM", { locale }) })
              : t("env.moves.sum.sweep_none"),
            totals.sweep.amount,
            t("env.moves.sum.sweep_sub", { n: String(totals.sweep.count) }),
          ],
          [
            "realloc",
            t("env.moves.filter.realloc"),
            totals.realloc.amount,
            t("env.moves.sum.realloc_sub", { n: String(totals.realloc.count) }),
          ],
          [
            "transfer",
            t("env.moves.filter.transfer"),
            totals.transfer.amount,
            t("env.moves.sum.realloc_sub", { n: String(totals.transfer.count) }),
          ],
        ] as Array<[MoveKind, string, number, string]>
      )
        .filter(([k]) => k !== "transfer" || hasTransfers)
        .map(([k, label, amount, sub]) => (
          <div key={k} className="flex min-w-0 items-center gap-3 bg-card px-2 py-2 sm:px-3">
            <span className="hidden sm:block">
              <KindIcon kind={k} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[11px] text-muted-foreground sm:text-xs">{label}</div>
              <PrivacyValue className="block truncate text-sm font-semibold tabular-nums sm:text-base">
                {fmtMoney(amount, symbol)}
              </PrivacyValue>
              <div className="truncate text-[11px] text-muted-foreground sm:text-xs">{sub}</div>
            </div>
          </div>
        ))}
    </div>
  );

  const controls = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-1.5" role="group">
        {filters.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            className="h-7 rounded-full px-3 text-xs"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(`env.moves.filter.${f}`)}
          </Button>
        ))}
      </div>
      <Select value={budget} onValueChange={setBudget}>
        <SelectTrigger
          className="h-8 w-full text-xs sm:w-52"
          aria-label={t("env.moves.all_budgets")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("env.moves.all_budgets")}</SelectItem>
          {budgetOptions.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const parts = (m: Move) =>
    m.parts.map((p) => ({
      key: `${m.key}-${p.categoryId}`,
      name: name(p.categoryId),
      detail: partDetail(m, p),
      amount: p.amount,
    }));

  let body: React.ReactNode;
  if (shown.length === 0) {
    body = (
      <div className="rounded-lg border py-8 text-center text-sm text-muted-foreground">
        {t("env.moves.empty")}
      </div>
    );
  } else if (isDesktop) {
    body = (
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("env.moves.col.date")}</th>
              <th className="px-3 py-2 font-medium">{t("env.moves.col.kind")}</th>
              <th className="px-3 py-2 font-medium">{t("env.moves.col.from")}</th>
              <th className="px-1 py-2" aria-hidden="true" />
              <th className="px-3 py-2 font-medium">{t("env.moves.col.to")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("env.moves.col.amount")}</th>
              <th className="px-3 py-2 font-medium">{t("env.moves.col.note")}</th>
              <th className="w-8 px-2 py-2" aria-hidden="true" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((s) => {
              const m = s.move;
              const open = expandable(m) && isOpen(m);
              const clickable = m.kind === "realloc" || m.kind === "transfer" || expandable(m);
              return (
                <React.Fragment key={m.key}>
                  <tr
                    className={cn(clickable && "cursor-pointer hover:bg-muted/50")}
                    onClick={clickable ? () => activate(m) : undefined}
                  >
                    <td className="whitespace-nowrap px-3 py-2">{day(m.date)}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <KindIcon kind={m.kind} />
                        {t(`env.moves.kind.${m.kind}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {fromLabel(m)}
                      {m.kind === "sweep" && !m.fromId && expandable(m) && (
                        <ChevronDown
                          className={cn(
                            "ml-1 inline h-3.5 w-3.5 text-muted-foreground",
                            open && "rotate-180",
                          )}
                        />
                      )}
                    </td>
                    <td className="px-1 py-2 text-muted-foreground">→</td>
                    <td className="px-3 py-2">
                      {toLabel(m)}
                      {m.kind === "plan" && expandable(m) && (
                        <ChevronDown
                          className={cn(
                            "ml-1 inline h-3.5 w-3.5 text-muted-foreground",
                            open && "rotate-180",
                          )}
                        />
                      )}
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums",
                        amountTone(s),
                      )}
                    >
                      <PrivacyValue>{amountText(s)}</PrivacyValue>
                    </td>
                    <td className="max-w-[16rem] truncate px-3 py-2 text-muted-foreground">
                      {m.note}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {m.kind === "realloc" && (
                        <button
                          type="button"
                          className="grid place-items-center rounded p-1 hover:bg-muted"
                          aria-label={t("env.realloc_edit.title")}
                          onClick={(e) => {
                            e.stopPropagation();
                            activate(m);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                  {open &&
                    parts(m).map((p) => (
                      <tr key={p.key} className="bg-muted/40 text-xs">
                        <td />
                        <td />
                        <td className="px-3 py-1.5">{m.kind === "sweep" ? p.name : ""}</td>
                        <td className="px-1 py-1.5 text-muted-foreground">→</td>
                        <td className="px-3 py-1.5">{m.kind === "plan" ? p.name : name(m.toId)}</td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-3 py-1.5 text-right tabular-nums",
                            m.kind === "sweep" &&
                              (p.amount >= 0 ? "text-success" : "text-destructive"),
                          )}
                        >
                          <PrivacyValue>{fmtMoney(p.amount, symbol)}</PrivacyValue>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{p.detail}</td>
                        <td />
                      </tr>
                    ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  } else {
    const days: [string, ShownMove[]][] = [];
    for (const s of shown) {
      const last = days[days.length - 1];
      if (last && last[0] === s.move.date) last[1].push(s);
      else days.push([s.move.date, [s]]);
    }
    body = (
      <div className="space-y-3">
        {days.map(([d, list]) => (
          <section key={d}>
            <div className="border-b pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              {format(parseISO(d), "EEE, d. MMMM", { locale })}
            </div>
            <ul className="divide-y">
              {list.map((s) => {
                const m = s.move;
                const open = expandable(m) && isOpen(m);
                const clickable = m.kind === "realloc" || m.kind === "transfer" || expandable(m);
                const inner = (
                  <>
                    <KindIcon kind={m.kind} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        {fromLabel(m)} → {toLabel(m)}
                      </div>
                      <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <span className="truncate">{m.note || t(`env.moves.kind.${m.kind}`)}</span>
                        {expandable(m) && (
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 shrink-0 transition-transform",
                              open && "rotate-180",
                            )}
                          />
                        )}
                      </div>
                    </div>
                    <PrivacyValue
                      className={cn("whitespace-nowrap font-medium tabular-nums", amountTone(s))}
                    >
                      {amountText(s)}
                    </PrivacyValue>
                  </>
                );
                return (
                  <li key={m.key} className="py-2 text-sm">
                    {clickable ? (
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded text-left hover:bg-muted/50"
                        aria-expanded={expandable(m) ? open : undefined}
                        onClick={() => activate(m)}
                      >
                        {inner}
                      </button>
                    ) : (
                      <div className="flex items-center gap-3">{inner}</div>
                    )}
                    {open && (
                      <div className="ml-9 mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2 text-xs tabular-nums">
                        {parts(m).map((p) => (
                          <React.Fragment key={p.key}>
                            <span className="min-w-0">
                              <span className="block truncate">{p.name}</span>
                              {p.detail && (
                                <span className="block truncate text-muted-foreground">
                                  {p.detail}
                                </span>
                              )}
                            </span>
                            <span
                              className={cn(
                                m.kind === "sweep" &&
                                  (p.amount >= 0 ? "text-success" : "text-destructive"),
                              )}
                            >
                              {fmtMoney(p.amount, symbol)}
                            </span>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {summary}
      {controls}
      <p className="text-xs leading-snug text-muted-foreground">{t("env.moves.hint")}</p>
      {body}
    </div>
  );
}
