import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, subMonths, subDays, startOfYear } from "date-fns";
import {
  ArrowDown, ArrowUp, ArrowLeftRight, Trash2, ChevronRight, ChevronDown, Layers, X, Pencil,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import {
  fetchAccounts, fetchCategories, fetchSettings, fetchTransactions, fetchTransactionTags,
  fetchRecurringRules, fetchReimbursementLinks,
  fmtMoney, type TxType, type Transaction,
} from "@/lib/finance";
import { MultiSelectCombobox, type MSCOption } from "@/components/MultiSelectCombobox";
import { DateInput } from "@/components/DateInput";
import { EntityVisual } from "@/components/EntityVisual";
import { highlightTokens, tokenize, normalize, parseLooseNumber } from "@/lib/highlight";
import { matchesAmount, type AmountOp } from "@/lib/amountFilter";
import { fetchTransactionLinks, fetchTransactionLinkMembers } from "@/lib/links";
import { TransactionLinkPicker } from "@/components/TransactionLinkPicker";
import { TransactionLinkSheet, KIND_ICON } from "@/components/TransactionLinkSheet";

export const Route = createFileRoute("/transactions")({
  component: TransactionsPage,
});

type SortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

/**
 * Render a note string with inline #hashtags shown as chips. Plain text
 * segments still get search-token highlighting; tag chips highlight when a
 * search token matches the tag body.
 */
function renderNoteWithTags(note: string, tokens: string[]): React.ReactNode {
  const re = /#([\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(note)) !== null) {
    if (m.index > last) {
      const text = note.slice(last, m.index);
      out.push(<span key={`t${i}`}>{highlightTokens(text, tokens)}</span>);
    }
    const tagBody = m[1];
    const matched = tokens.some((tok) => normalize(tagBody).includes(normalize(tok.replace(/^#/, ""))));
    out.push(
      <Badge
        key={`g${i}`}
        variant="secondary"
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
          matched && "ring-1 ring-yellow-400/60",
        )}
      >
        {`#${tagBody}`}
      </Badge>,
    );
    last = m.index + m[0].length;
    i++;
  }
  if (last < note.length) {
    out.push(<span key={`t${i}`}>{highlightTokens(note.slice(last), tokens)}</span>);
  }
  return out;
}

function TagBadges({ tags, tokens }: { tags: string[]; tokens: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {tags.map((t) => {
        const matched = tokens.some((tok) => normalize(t).includes(normalize(tok.replace(/^#/, ""))));
        return (
          <Badge
            key={t}
            variant="secondary"
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              matched && "ring-1 ring-yellow-400/60",
            )}
          >
            {`#${t}`}
          </Badge>
        );
      })}
    </div>
  );
}

function TransactionsPage() {
  const { t: tr, locale, lang } = useI18n();
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const txQ = useQuery({ queryKey: ["transactions", "all"], queryFn: () => fetchTransactions() });
  const tagsQ = useQuery({ queryKey: ["transaction_tags"], queryFn: fetchTransactionTags });
  const rulesQ = useQuery({ queryKey: ["recurring_rules"], queryFn: fetchRecurringRules });
  const reimbLinksQ = useQuery({ queryKey: ["reimbursement_links"], queryFn: fetchReimbursementLinks });
  const linksQ = useQuery({ queryKey: ["transaction_links"], queryFn: fetchTransactionLinks });
  const linkMembersQ = useQuery({ queryKey: ["transaction_link_members"], queryFn: fetchTransactionLinkMembers });
  const linkByTx = React.useMemo(() => {
    const map = new Map<string, string>();
    (linkMembersQ.data ?? []).forEach((m) => map.set(m.transaction_id, m.link_id));
    return map;
  }, [linkMembersQ.data]);
  const linkById = React.useMemo(
    () => new Map((linksQ.data ?? []).map((l) => [l.id, l])),
    [linksQ.data],
  );
  const [openLinkId, setOpenLinkId] = React.useState<string | null>(null);

  const symbol = settingsQ.data?.currency_symbol ?? "CHF";
  const dateFmt = settingsQ.data?.date_format;
  const accountById = React.useMemo(
    () => new Map((accountsQ.data ?? []).map((a) => [a.id, a])),
    [accountsQ.data],
  );
  const categoryById = React.useMemo(
    () => new Map((categoriesQ.data ?? []).map((c) => [c.id, c])),
    [categoriesQ.data],
  );
  const ruleById = new Map((rulesQ.data ?? []).map((r) => [r.id, r]));
  const tagsByTx = React.useMemo(() => {
    const m = new Map<string, string[]>();
    (tagsQ.data ?? []).forEach((r) => {
      const arr = m.get(r.transaction_id) ?? [];
      arr.push(r.tag);
      m.set(r.transaction_id, arr);
    });
    return m;
  }, [tagsQ.data]);

  // Sum of amounts per split_group_id, so amount filters/search/highlight
  // can match the group total in addition to individual leg amounts.
  const splitGroupTotals = React.useMemo(() => {
    const m = new Map<string, number>();
    (txQ.data ?? []).forEach((t) => {
      if (!t.split_group_id) return;
      m.set(t.split_group_id, (m.get(t.split_group_id) ?? 0) + Number(t.amount));
    });
    return m;
  }, [txQ.data]);

  // ----- Filter state (multi-select arrays) -----
  const [filterTypes, setFilterTypes] = React.useState<TxType[]>([]);
  const [filterAccounts, setFilterAccounts] = React.useState<string[]>([]);
  const [filterCategories, setFilterCategories] = React.useState<string[]>([]);
  const [filterTags, setFilterTags] = React.useState<string[]>([]);
  const [search, setSearch] = React.useState("");
  const [from, setFrom] = React.useState<Date | null>(null);
  const [to, setTo] = React.useState<Date | null>(null);
  const [amountOp, setAmountOp] = React.useState<AmountOp>("any");
  const [amountVal, setAmountVal] = React.useState("");
  const [tolerance, setTolerance] = React.useState(0.15);
  const [sort, setSort] = React.useState<SortKey>("date_desc");
  // Reimbursable filter: 'any' shows all, others narrow to flagged tx with that status.
  const [filterReimb, setFilterReimb] = React.useState<"any" | "open" | "settled" | "cancelled" | "all">("any");

  const searchRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const inField = tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || (tgt as HTMLElement).isContentEditable);
      if (e.key === "/" && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const allTags = React.useMemo(() => {
    const s = new Set<string>();
    (tagsQ.data ?? []).forEach((r) => s.add(r.tag));
    return Array.from(s).sort();
  }, [tagsQ.data]);

  // ----- Search tokens -----
  const tokens = React.useMemo(() => tokenize(search), [search]);
  const numericTokens = React.useMemo(
    () => tokens.map((t) => parseLooseNumber(t)).filter((n): n is number => n != null),
    [tokens],
  );

  const matchesSearch = (t: Transaction) => {
    if (tokens.length === 0) return true;
    const desc = t.description ?? "";
    const note = t.note ?? "";
    const cat = t.category_id ? categoryById.get(t.category_id)?.name ?? "" : "";
    const src = accountById.get(t.source_account_id)?.name ?? "";
    const dst = t.destination_account_id ? accountById.get(t.destination_account_id)?.name ?? "" : "";
    const tags = tagsByTx.get(t.id) ?? [];
    const amtAbs = Math.abs(Number(t.amount));
    const groupAbs = t.split_group_id
      ? Math.abs(splitGroupTotals.get(t.split_group_id) ?? 0)
      : null;
    const amtStrs = [
      amtAbs.toFixed(2),
      String(Math.round(amtAbs)),
      amtAbs.toLocaleString(lang === "de" ? "de-CH" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ];
    if (groupAbs != null) {
      amtStrs.push(
        groupAbs.toFixed(2),
        String(Math.round(groupAbs)),
        groupAbs.toLocaleString(lang === "de" ? "de-CH" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      );
    }
    const haystack = normalize([desc, note, cat, src, dst, tags.join(" "), amtStrs.join(" ")].join("  "));
    return tokens.every((tok) => {
      const ntok = normalize(tok);
      if (haystack.includes(ntok)) return true;
      const num = parseLooseNumber(tok);
      if (num != null) {
        const target = Math.abs(num);
        if (Math.abs(amtAbs - target) < 0.005) return true;
        if (groupAbs != null && Math.abs(groupAbs - target) < 0.005) return true;
      }
      return false;
    });
  };

  const fromStr = from ? format(from, "yyyy-MM-dd") : "";
  const toStr = to ? format(to, "yyyy-MM-dd") : "";
  const amountTarget = amountOp === "any" ? null : parseLooseNumber(amountVal);

  const filtered = React.useMemo(() => {
    return (txQ.data ?? []).filter((t) => {
      if (filterTypes.length && !filterTypes.includes(t.type)) return false;
      if (filterAccounts.length) {
        const hit = filterAccounts.includes(t.source_account_id) ||
          (t.destination_account_id != null && filterAccounts.includes(t.destination_account_id));
        if (!hit) return false;
      }
      if (filterCategories.length) {
        if (!t.category_id || !filterCategories.includes(t.category_id)) return false;
      }
      if (filterTags.length) {
        const txTags = tagsByTx.get(t.id) ?? [];
        if (!filterTags.some((tg) => txTags.includes(tg))) return false;
      }
      if (filterReimb !== "any") {
        if (!t.is_reimbursable) return false;
        if (filterReimb !== "all" && t.reimbursable_status !== filterReimb) return false;
      }
      if (fromStr && t.occurred_on < fromStr) return false;
      if (toStr && t.occurred_on > toStr) return false;
      if (amountOp !== "any" && amountTarget != null) {
        const ownMatch = matchesAmount(Number(t.amount), amountOp, amountTarget, tolerance);
        const groupTotal = t.split_group_id ? splitGroupTotals.get(t.split_group_id) : undefined;
        const groupMatch = groupTotal != null && matchesAmount(groupTotal, amountOp, amountTarget, tolerance);
        if (!ownMatch && !groupMatch) return false;
      }
      if (!matchesSearch(t)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txQ.data, filterTypes, filterAccounts, filterCategories, filterTags, filterReimb, fromStr, toStr,
      amountOp, amountTarget, tolerance, tokens, accountById, categoryById, tagsByTx, splitGroupTotals]);

  const sorted = React.useMemo(() => {
    const arr = filtered.slice();
    switch (sort) {
      case "date_asc": arr.sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : a.occurred_on > b.occurred_on ? 1 : 0)); break;
      case "amount_desc": arr.sort((a, b) => Math.abs(Number(b.amount)) - Math.abs(Number(a.amount))); break;
      case "amount_asc": arr.sort((a, b) => Math.abs(Number(a.amount)) - Math.abs(Number(b.amount))); break;
      default: arr.sort((a, b) => (a.occurred_on > b.occurred_on ? -1 : a.occurred_on < b.occurred_on ? 1 : 0));
    }
    return arr;
  }, [filtered, sort]);

  // Group by date (only for date sort)
  const groups = React.useMemo(() => {
    if (sort !== "date_desc" && sort !== "date_asc") {
      return [["__flat__", sorted]] as [string, Transaction[]][];
    }
    const m = new Map<string, Transaction[]>();
    sorted.forEach((t) => {
      const k = t.occurred_on;
      const arr = m.get(k) ?? [];
      arr.push(t);
      m.set(k, arr);
    });
    const entries = Array.from(m.entries());
    if (sort === "date_asc") entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    else entries.sort((a, b) => (a[0] < b[0] ? 1 : -1));
    return entries;
  }, [sorted, sort]);

  const del = async (id: string) => {
    if (!confirm(tr("confirm.delete_transaction"))) return;
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(tr("toast.deleted"));
    qc.invalidateQueries();
  };

  const delGroup = async (groupId: string) => {
    if (!confirm(tr("confirm.delete_transaction"))) return;
    const { error } = await supabase.from("transactions").delete().eq("split_group_id", groupId);
    if (error) { toast.error(error.message); return; }
    toast.success(tr("toast.deleted"));
    qc.invalidateQueries();
  };

  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});
  const toggleGroup = (gid: string) =>
    setOpenGroups((p) => ({ ...p, [gid]: !p[gid] }));

  // ----- Dropdown options -----
  const typeOptions: MSCOption[] = [
    { value: "expense", label: tr("add.expense") },
    { value: "income", label: tr("add.income") },
    { value: "transfer", label: tr("add.transfer") },
  ];
  const accountOptions: MSCOption[] = (accountsQ.data ?? []).map((a) => ({
    value: a.id,
    label: a.name,
    visual: <EntityVisual entity={a} size="xs" />,
  }));
  const categoryOptions: MSCOption[] = (categoriesQ.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
    visual: <EntityVisual entity={c} size="xs" />,
  }));
  const tagOptions: MSCOption[] = allTags.map((t) => ({
    value: t,
    label: `#${t}`,
    keywords: t,
  }));

  // ----- Quick range presets -----
  const setRange = (preset: "this_month" | "last_month" | "last_7" | "last_30" | "this_year") => {
    const now = new Date();
    if (preset === "this_month") { setFrom(startOfMonth(now)); setTo(endOfMonth(now)); }
    else if (preset === "last_month") {
      const lm = subMonths(now, 1);
      setFrom(startOfMonth(lm)); setTo(endOfMonth(lm));
    }
    else if (preset === "last_7") { setFrom(subDays(now, 7)); setTo(now); }
    else if (preset === "last_30") { setFrom(subDays(now, 30)); setTo(now); }
    else if (preset === "this_year") { setFrom(startOfYear(now)); setTo(now); }
  };

  const clearAll = () => {
    setFilterTypes([]); setFilterAccounts([]); setFilterCategories([]); setFilterTags([]);
    setSearch(""); setFrom(null); setTo(null); setAmountOp("any"); setAmountVal(""); setFilterReimb("any");
  };

  const activeFilterCount =
    filterTypes.length + filterAccounts.length + filterCategories.length + filterTags.length +
    (fromStr ? 1 : 0) + (toStr ? 1 : 0) + (amountOp !== "any" && amountTarget != null ? 1 : 0) +
    (search.trim() ? 1 : 0) + (filterReimb !== "any" ? 1 : 0);

  // Did-you-mean hint: numeric search with no exact-match results
  const showAroundHint = filtered.length === 0 && tokens.length === 1 && numericTokens.length === 1 &&
    amountOp === "any";

  // amount-match flag for highlighting
  const amountMatchedFor = (amt: number): boolean => {
    if (amountOp !== "any" && amountTarget != null && matchesAmount(amt, amountOp, amountTarget, tolerance)) return true;
    if (numericTokens.length > 0) {
      const a = Math.abs(amt);
      return numericTokens.some((n) => Math.abs(a - Math.abs(n)) < 0.005);
    }
    return false;
  };

  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{tr("tx.title")}</h1>

        <Card><CardContent className="space-y-3 py-4">
          <Input
            ref={searchRef}
            placeholder={tr("tx.search_placeholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setSearch(""); }}
          />

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <MultiSelectCombobox
              options={typeOptions}
              value={filterTypes}
              onChange={(v) => setFilterTypes(v as TxType[])}
              placeholder={tr("tx.all_types")}
              searchPlaceholder={tr("msc.search")}
              emptyText={tr("msc.empty")}
              selectedLabel={(n) => tr("msc.n_selected", { n })}
            />
            <MultiSelectCombobox
              options={accountOptions}
              value={filterAccounts}
              onChange={setFilterAccounts}
              placeholder={tr("tx.all_accounts")}
              searchPlaceholder={tr("msc.search")}
              emptyText={tr("msc.empty")}
              selectedLabel={(n) => tr("msc.n_selected", { n })}
            />
            <MultiSelectCombobox
              options={categoryOptions}
              value={filterCategories}
              onChange={setFilterCategories}
              placeholder={tr("tx.all_categories")}
              searchPlaceholder={tr("msc.search")}
              emptyText={tr("msc.empty")}
              selectedLabel={(n) => tr("msc.n_selected", { n })}
            />
            <MultiSelectCombobox
              options={tagOptions}
              value={filterTags}
              onChange={setFilterTags}
              placeholder={tr("tx.all_tags")}
              searchPlaceholder={tr("msc.search")}
              emptyText={tr("msc.empty")}
              selectedLabel={(n) => tr("msc.n_selected", { n })}
            />
          </div>

          {/* Date range */}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div>
              <Label className="text-xs text-muted-foreground">{tr("common.from")}</Label>
              <div className="flex items-center gap-1">
                {from ? (
                  <DateInput value={from} onChange={(d) => setFrom(d)} formatStr={dateFmt} lang={lang} locale={locale} />
                ) : (
                  <Button type="button" variant="outline" className="h-9 w-full justify-start font-normal text-muted-foreground" onClick={() => setFrom(new Date())}>
                    {tr("common.set")}
                  </Button>
                )}
                {from && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => setFrom(null)} aria-label={tr("common.clear")}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{tr("common.to")}</Label>
              <div className="flex items-center gap-1">
                {to ? (
                  <DateInput value={to} onChange={(d) => setTo(d)} formatStr={dateFmt} lang={lang} locale={locale} />
                ) : (
                  <Button type="button" variant="outline" className="h-9 w-full justify-start font-normal text-muted-foreground" onClick={() => setTo(new Date())}>
                    {tr("common.set")}
                  </Button>
                )}
                {to && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => setTo(null)} aria-label={tr("common.clear")}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Quick range chips */}
          <div className="flex flex-wrap gap-1.5">
            {([
              ["this_month", tr("tx.range.this_month")],
              ["last_month", tr("tx.range.last_month")],
              ["last_7", tr("tx.range.last_7")],
              ["last_30", tr("tx.range.last_30")],
              ["this_year", tr("tx.range.this_year")],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRange(k)}
                className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Reimbursable filter */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{tr("tx.reimb.filter")}:</span>
            {(["any", "open", "settled", "cancelled", "all"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilterReimb(k)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs",
                  filterReimb === k
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {k === "any" ? tr("tx.amount_op.any") : tr(`tx.reimb.filter.${k}` as never)}
              </button>
            ))}
          </div>

          {/* Amount filter + sort */}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div>
              <Label className="text-xs text-muted-foreground">{tr("tx.amount")}</Label>
              <div className="flex items-center gap-1">
                <Select value={amountOp} onValueChange={(v) => setAmountOp(v as AmountOp)}>
                  <SelectTrigger className="w-[44%]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{tr("tx.amount_op.any")}</SelectItem>
                    <SelectItem value="lt">{tr("tx.amount_op.lt")}</SelectItem>
                    <SelectItem value="lte">{tr("tx.amount_op.lte")}</SelectItem>
                    <SelectItem value="eq">{tr("tx.amount_op.eq")}</SelectItem>
                    <SelectItem value="gte">{tr("tx.amount_op.gte")}</SelectItem>
                    <SelectItem value="gt">{tr("tx.amount_op.gt")}</SelectItem>
                    <SelectItem value="around">{tr("tx.amount_op.around")}</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amountVal}
                  disabled={amountOp === "any"}
                  onChange={(e) => setAmountVal(e.target.value)}
                  className="flex-1"
                />
              </div>
              {amountOp === "around" && (
                <div className="mt-1 flex gap-1">
                  {[0.1, 0.15, 0.25, 0.5].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setTolerance(p)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px]",
                        tolerance === p
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {tr("tx.amount.tolerance", { x: Math.round(p * 100) })}
                    </button>
                  ))}
                </div>
              )}
              {/* Amount range presets */}
              <div className="mt-1 flex flex-wrap gap-1">
                {([["lt", "20"], ["lt", "100"], ["gte", "100"], ["gte", "500"]] as const).map(([op, v], i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setAmountOp(op); setAmountVal(v); }}
                    className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {op === "lt" ? `< ${v}` : `≥ ${v}`}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{tr("tx.sort")}</Label>
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="date_desc">{tr("tx.sort.newest")}</SelectItem>
                  <SelectItem value="date_asc">{tr("tx.sort.oldest")}</SelectItem>
                  <SelectItem value="amount_desc">{tr("tx.sort.amount_desc")}</SelectItem>
                  <SelectItem value="amount_asc">{tr("tx.sort.amount_asc")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end justify-end">
              {activeFilterCount > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                  <X className="mr-1 h-3.5 w-3.5" /> {tr("tx.clear_all")}
                </Button>
              )}
            </div>
          </div>

          {/* Result count + active filter pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-muted-foreground">{tr("tx.results_count", { n: filtered.length })}</span>
            {filterTypes.map((v) => (
              <FilterPill key={`t-${v}`} onRemove={() => setFilterTypes(filterTypes.filter((x) => x !== v))}>
                {tr(`add.${v}` as never)}
              </FilterPill>
            ))}
            {filterAccounts.map((v) => (
              <FilterPill key={`a-${v}`} onRemove={() => setFilterAccounts(filterAccounts.filter((x) => x !== v))}>
                {tr("tx.search.label.account")}: {accountById.get(v)?.name ?? v}
              </FilterPill>
            ))}
            {filterCategories.map((v) => (
              <FilterPill key={`c-${v}`} onRemove={() => setFilterCategories(filterCategories.filter((x) => x !== v))}>
                {tr("tx.search.label.category")}: {categoryById.get(v)?.name ?? v}
              </FilterPill>
            ))}
            {filterTags.map((v) => (
              <FilterPill key={`tg-${v}`} onRemove={() => setFilterTags(filterTags.filter((x) => x !== v))}>
                {`#${v}`}
              </FilterPill>
            ))}
            {amountOp !== "any" && amountTarget != null && (
              <FilterPill onRemove={() => { setAmountOp("any"); setAmountVal(""); }}>
                {tr(`tx.amount_op.${amountOp}` as never)} {amountVal}
              </FilterPill>
            )}
            {fromStr && <FilterPill onRemove={() => setFrom(null)}>{tr("common.from")}: {format(from!, dateFmt || "yyyy-MM-dd")}</FilterPill>}
            {toStr && <FilterPill onRemove={() => setTo(null)}>{tr("common.to")}: {format(to!, dateFmt || "yyyy-MM-dd")}</FilterPill>}
          </div>

          {showAroundHint && (
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-2 text-xs text-muted-foreground">
              {tr("tx.search_amount_hint", { x: search.trim() })}{" "}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => {
                  setAmountOp("around");
                  setAmountVal(String(numericTokens[0]));
                  setSearch("");
                }}
              >
                {tr("tx.amount_op.around")} ({tr("tx.amount.tolerance", { x: Math.round(tolerance * 100) })})
              </button>
            </div>
          )}
        </CardContent></Card>

        {txQ.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : groups.length === 0 || sorted.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            {tr("tx.no_match")} <Link to="/add" className="text-primary underline-offset-2 hover:underline">{tr("tx.add_one")}</Link>.
          </CardContent></Card>
        ) : groups.map(([date, items]) => (
          <div key={date}>
            {date !== "__flat__" && (
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {format(new Date(date), "EEE, MMM d, yyyy", { locale })}
              </div>
            )}
            <Card><CardContent className="divide-y p-0">
              {(() => {
                type Row =
                  | { kind: "single"; tx: Transaction }
                  | { kind: "group"; groupId: string; txs: Transaction[] };
                const seen = new Set<string>();
                const rows: Row[] = [];
                for (const t of items) {
                  if (t.split_group_id) {
                    if (seen.has(t.split_group_id)) continue;
                    seen.add(t.split_group_id);
                    const grp = items.filter((x) => x.split_group_id === t.split_group_id);
                    rows.push({ kind: "group", groupId: t.split_group_id, txs: grp });
                  } else {
                    rows.push({ kind: "single", tx: t });
                  }
                }
                return rows.map((row) => {
                  if (row.kind === "group") {
                    const first = row.txs[0];
                    const total = row.txs.reduce((s, x) => s + Number(x.amount), 0);
                    const Icon = first.type === "expense" ? ArrowDown : first.type === "income" ? ArrowUp : ArrowLeftRight;
                    const tone = first.type === "expense" ? "text-destructive" : first.type === "income" ? "text-success" : "text-muted-foreground";
                    const sign = first.type === "expense" ? "-" : first.type === "income" ? "+" : "";
                    const src = accountById.get(first.source_account_id);
                    const grpSym = src?.currency_symbol ?? symbol;
                    const open = !!openGroups[row.groupId];
                    const ChevIcon = open ? ChevronDown : ChevronRight;
                    const headerLabel = row.txs.map((x) => x.description).filter(Boolean).slice(0, 2).join(", ") || tr("tx.split.label");
                    const amtMatch = amountMatchedFor(total);
                    const perSliceTags = row.txs.map((x) => tagsByTx.get(x.id) ?? []);
                    const unionTags = Array.from(new Set(perSliceTags.flat()));
                    const sharedTags = perSliceTags.length > 0
                      ? perSliceTags.reduce<string[]>((acc, cur, idx) => (idx === 0 ? [...cur] : acc.filter((t) => cur.includes(t))), [])
                      : [];
                    return (
                      <div key={`g-${row.groupId}`} className="bg-muted/20">
                        <div className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/40 sm:flex-nowrap">
                          <button
                            type="button"
                            onClick={() => toggleGroup(row.groupId)}
                            className="flex min-w-0 basis-full items-start gap-3 text-left sm:basis-auto sm:flex-1"
                          >
                          <RowVisual entity={src ?? null} typeIcon={<Icon className="h-3 w-3" />} tone={tone} />
                          <div className="min-w-0 flex-1">
                             <div className="grid min-w-0 grid-cols-1 items-start gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-2">
                               <div className="min-w-0">
                                <div className="flex min-w-0 items-start gap-1.5">
                                <ChevIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                 <span className="min-w-0 break-words text-sm font-medium">{highlightTokens(headerLabel, tokens)}</span>
                                </div>
                                <span className="ml-5 mt-1 inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-foreground sm:ml-5">
                                  <Layers className="h-3 w-3" /> {tr("tx.split.label")}
                                 </span>
                              </div>
                               <div className={cn("ml-5 text-sm font-semibold tabular-nums whitespace-nowrap sm:ml-0 sm:text-right", tone)}>
                                {amtMatch ? (
                                  <mark className="rounded bg-yellow-200/70 px-1 dark:bg-yellow-500/30">{sign}{fmtMoney(total, grpSym).replace("-", "")}</mark>
                                ) : (
                                  <>{sign}{fmtMoney(total, grpSym).replace("-", "")}</>
                                )}
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {highlightTokens(src?.name ?? "?", tokens)} · {open ? tr("tx.split.collapse") : tr("tx.split.expand", { n: row.txs.length })}
                            </div>
                            <TagBadges tags={open ? sharedTags : unionTags} tokens={tokens} />
                          </div>
                          </button>
                          <div className="ml-auto flex items-center">
                            <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" aria-label={tr("common.edit")}>
                              <Link to="/edit/$id" params={{ id: first.id }}><Pencil className="h-4 w-4" /></Link>
                            </Button>
                            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" aria-label={tr("common.delete")} onClick={() => delGroup(row.groupId)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        {open && (
                          <ul className="border-t bg-background">
                            {row.txs.map((t) => {
                              const cat = t.category_id ? categoryById.get(t.category_id) : null;
                              const sliceTags = tagsByTx.get(t.id) ?? [];
                              return (
                                 <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-2 pl-14 text-sm">
                                   <div className="min-w-0">
                                     <div className="break-words font-medium">{highlightTokens(t.description || tr("add.split.no_category"), tokens)}</div>
                                    <div className="text-xs text-muted-foreground">{highlightTokens(cat?.name ?? tr("add.split.no_category"), tokens)}</div>
                                    <TagBadges tags={sliceTags} tokens={tokens} />
                                  </div>
                                  <div className={cn("tabular-nums font-medium", tone)}>
                                    {sign}{fmtMoney(Number(t.amount), grpSym).replace("-", "")}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  }
                  const t = row.tx;
                  const Icon = t.type === "expense" ? ArrowDown : t.type === "income" ? ArrowUp : ArrowLeftRight;
                  const tone = t.type === "expense" ? "text-destructive" : t.type === "income" ? "text-success" : "text-muted-foreground";
                  const sign = t.type === "expense" ? "-" : t.type === "income" ? "+" : "";
                  const isReimb = t.type === "income" && (reimbLinksQ.data ?? []).some(
                    (l) => l.settling_transaction_id === t.id,
                  );
                  const src = accountById.get(t.source_account_id) ?? null;
                  const dst = t.destination_account_id ? accountById.get(t.destination_account_id) ?? null : null;
                  const cat = t.category_id ? categoryById.get(t.category_id) ?? null : null;
                  const tags = tagsByTx.get(t.id) ?? [];
                  const primary = cat ?? src;
                  const amtMatch = amountMatchedFor(Number(t.amount));
                  const txSym = src?.currency_symbol ?? symbol;
                  const dstSym = dst?.currency_symbol ?? txSym;
                  const showDstAmount = t.type === "transfer" && dst && t.destination_amount != null && (src?.currency_code ?? "") !== (dst?.currency_code ?? "");
                  return (
                    <div key={t.id} className="flex items-start gap-3 px-4 py-3">
                      <RowVisual entity={primary} typeIcon={<Icon className="h-3 w-3" />} tone={tone} />
                      <div className="min-w-0 flex-1">
                         <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                           <div className="min-w-0 break-words text-sm font-medium">
                            {highlightTokens(
                              t.description || (t.type === "transfer" ? tr("tx.transfer_label") : t.type === "income" ? tr("add.income") : tr("add.expense")),
                              tokens,
                            )}
                            {isReimb && <span className="ml-2 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-success">{tr("tx.reimbursement")}</span>}
                            {t.is_reimbursable && t.reimbursable_status && (
                              <span
                                className={cn(
                                  "ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                                  t.reimbursable_status === "open" && "bg-warning/15 text-warning",
                                  t.reimbursable_status === "settled" && "bg-success/15 text-success",
                                  t.reimbursable_status === "cancelled" && "bg-muted text-muted-foreground",
                                )}
                                title={t.reimbursable_counterparty ?? ""}
                              >
                                {tr(`tx.reimb.status.${t.reimbursable_status}` as never)}
                              </span>
                            )}
                            {t.recurring_rule_id && (
                              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground" title={ruleById.get(t.recurring_rule_id)?.name ?? ""}>
                                {tr("tx.from_rule")}{ruleById.get(t.recurring_rule_id) ? `: ${ruleById.get(t.recurring_rule_id)!.name}` : ""}
                              </span>
                            )}
                            {t.occurred_on > new Date().toISOString().slice(0, 10) && (
                              <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning">
                                {tr("dashboard.top_month.upcoming")}
                              </span>
                            )}
                          </div>
                          <div className={cn("text-sm font-semibold tabular-nums whitespace-nowrap", tone)}>
                            {amtMatch ? (
                              <mark className="rounded bg-yellow-200/70 px-1 dark:bg-yellow-500/30">{sign}{fmtMoney(Number(t.amount), txSym).replace("-", "")}</mark>
                            ) : (
                              <>{sign}{fmtMoney(Number(t.amount), txSym).replace("-", "")}</>
                            )}
                            {showDstAmount && (
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                → {fmtMoney(Number(t.destination_amount), dstSym).replace("-", "")}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          {/* account / transfer chain */}
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
                          {sort !== "date_desc" && sort !== "date_asc" && (
                            <>
                              <span>·</span>
                              <span>{format(new Date(t.occurred_on), "MMM d, yyyy", { locale })}</span>
                            </>
                          )}
                        </div>
                        {t.note && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {renderNoteWithTags(t.note, tokens)}
                          </div>
                        )}
                      </div>
                      <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" aria-label={tr("common.edit")}>
                        <Link to="/edit/$id" params={{ id: t.id }}><Pencil className="h-4 w-4" /></Link>
                      </Button>
                      <TransactionLinkPicker
                        transactionId={t.id}
                        currentLinkId={linkByTx.get(t.id) ?? null}
                        compact
                      />
                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => del(t.id)} aria-label={tr("common.delete")}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                });
              })()}
            </CardContent></Card>
          </div>
        ))}
      </div>
    </AppShell>
  );
}

function FilterPill({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-accent/40 px-2 py-0.5 text-xs">
      {children}
      <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-foreground" aria-label="remove">
        <X className="h-3 w-3" />
      </button>
    </span>
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
