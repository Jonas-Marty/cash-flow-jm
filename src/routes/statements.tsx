import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Trash2, Upload, CheckCircle2, AlertTriangle, HelpCircle, EyeOff, RefreshCw } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n";
import { fetchAccounts, fmtMoney } from "@/lib/finance";
import {
  deleteStatementImport,
  extractStatement,
  getStatementImport,
  listStatementImports,
  rematchStatementImport,
  resolveStatementLine,
} from "@/utils/statements.functions";
import type { StatementLine } from "@/lib/ai/statementTypes";

export const Route = createFileRoute("/statements")({
  component: StatementsPage,
  validateSearch: (search: Record<string, unknown>): { import?: string } => ({
    import: typeof search.import === "string" ? search.import : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Statement import · Cashflow" },
      {
        name: "description",
        content:
          "Import a bank or credit-card statement PDF, let the assistant read the rows and compare them with your recorded transactions.",
      },
      { property: "og:title", content: "Statement import · Cashflow" },
      {
        property: "og:description",
        content: "Compare a statement PDF against your ledger and fix what is missing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Could not read the file"));
    fr.onload = () => {
      const res = String(fr.result || "");
      resolve(res.slice(res.indexOf(",") + 1));
    };
    fr.readAsDataURL(file);
  });
}

function StatusBadge({ line, t }: { line: StatementLine; t: (k: string) => string }) {
  const map: Record<string, { label: string; cls: string }> = {
    exact: { label: t("statements.status.exact"), cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" },
    probable: { label: t("statements.status.probable"), cls: "border-amber-500/50 bg-amber-500/10 text-amber-600" },
    unmatched: { label: t("statements.status.missing"), cls: "border-destructive/40 bg-destructive/10 text-destructive" },
    ignored: { label: t("statements.status.ignored"), cls: "border-muted-foreground/30 text-muted-foreground" },
    resolved: { label: t("statements.status.resolved"), cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" },
  };
  const s = map[line.match_status] ?? map.unmatched;
  return <Badge variant="outline" className={s.cls}>{s.label}</Badge>;
}

function StatementsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();

  const listFn = useServerFn(listStatementImports);
  const getFn = useServerFn(getStatementImport);
  const extractFn = useServerFn(extractStatement);
  const rematchFn = useServerFn(rematchStatementImport);
  const resolveFn = useServerFn(resolveStatementLine);
  const deleteFn = useServerFn(deleteStatementImport);

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const accounts = (accountsQ.data ?? []).filter((a) => !a.archived);
  const importsQ = useQuery({ queryKey: ["statement_imports"], queryFn: () => listFn() });

  const [accountId, setAccountId] = React.useState<string>("");
  const [invert, setInvert] = React.useState(false);
  const [windowDays, setWindowDays] = React.useState(3);
  const [file, setFile] = React.useState<File | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const search = Route.useSearch();

  React.useEffect(() => {
    if (search.import) setActiveId(search.import);
  }, [search.import]);

  React.useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const detailQ = useQuery({
    queryKey: ["statement_import", activeId],
    queryFn: () => getFn({ data: { id: activeId as string } }),
    enabled: !!activeId,
  });

  const importMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(t("statements.err.no_file"));
      if (!accountId) throw new Error(t("statements.err.no_account"));
      const file_base64 = await readFileAsBase64(file);
      return extractFn({
        data: {
          account_id: accountId,
          file_name: file.name,
          file_base64,
          file_type: file.type || null,
          invert_amounts: invert,
          window_days: windowDays,
        },
      });
    },
    onSuccess: (res) => {
      setFile(null);
      setActiveId(res.import_id);
      qc.invalidateQueries({ queryKey: ["statement_imports"] });
      toast.success(t("statements.toast.imported"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const detail = detailQ.data;
  const symbol = accounts.find((a) => a.id === detail?.import.account_id)?.currency_symbol ?? "CHF";

  const groups = React.useMemo(() => {
    const lines = detail?.lines ?? [];
    return {
      missing: lines.filter((l) => l.match_status === "unmatched"),
      probable: lines.filter((l) => l.match_status === "probable"),
      matched: lines.filter((l) => l.match_status === "exact" || l.match_status === "resolved"),
      ignored: lines.filter((l) => l.match_status === "ignored"),
    };
  }, [detail]);

  const [rematching, setRematching] = React.useState(false);
  // "Open" = still needs a decision: missing rows and unconfirmed probable rows.
  const openCount = groups.missing.length + groups.probable.length;

  async function decide(lineId: string, decision: "ignore" | "confirm" | "reset") {
    try {
      await resolveFn({ data: { line_id: lineId, decision } });
      qc.invalidateQueries({ queryKey: ["statement_import", activeId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  function addLink(line: StatementLine) {
    const tags = (line.suggested_tags ?? []).map((x) => `#${x}`).join(" ");
    const search: Record<string, string> = {
      amount: String(Math.abs(line.amount)),
      type: line.amount < 0 ? "expense" : "income",
      description: line.suggested_description || line.description,
      source: detail?.import.account_id ?? "",
      statement_line: line.id,
      statement_import: detail?.import.id ?? "",
    };
    if (line.suggested_category_id) search.category = line.suggested_category_id;
    if (tags) search.note = tags;
    if (line.booking_date) search.occurred_on = line.booking_date;
    return search;
  }

  function renderLine(l: StatementLine) {
    const m = l.matched_transaction_id ? detail?.matched[l.matched_transaction_id] : null;
    return (
      <li key={l.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{l.booking_date ?? l.value_date ?? "—"}</span>
            <StatusBadge line={l} t={t} />
          </div>
          <div className="break-words text-sm font-medium">{l.description || "—"}</div>
          {l.match_status === "unmatched" && (l.suggested_description || l.suggested_category_id || (l.suggested_tags?.length ?? 0) > 0) && (
            <div className="text-xs text-muted-foreground">
              {t("statements.suggested")}: {[l.suggested_description, (l.suggested_tags ?? []).map((x) => `#${x}`).join(" ")].filter(Boolean).join(" · ")}
            </div>
          )}
          {m && (
            <div className="truncate text-xs text-muted-foreground">
              ↔ {m.occurred_on} · {m.description || "—"} · {fmtMoney(m.amount, symbol)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={l.amount < 0 ? "text-sm font-semibold" : "text-sm font-semibold text-emerald-600"}>
            {fmtMoney(l.amount, symbol)}
          </span>
          {l.match_status === "unmatched" && (
            <Button asChild size="sm" variant="outline">
              <Link to="/add" search={addLink(l) as never}>
                {t("statements.action.create")}
              </Link>
            </Button>
          )}
          {l.match_status === "probable" && (
            <Button size="sm" variant="outline" onClick={() => decide(l.id, "confirm")}>
              {t("statements.action.confirm")}
            </Button>
          )}
          {l.match_status === "ignored" || l.match_status === "resolved" ? (
            <Button size="sm" variant="ghost" onClick={() => decide(l.id, "reset")}>
              {t("statements.action.reset")}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => decide(l.id, "ignore")}>
              <EyeOff className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </li>
    );
  }

  function section(title: string, icon: React.ReactNode, lines: StatementLine[]) {
    if (lines.length === 0) return null;
    return (
      <div className="rounded-md border">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
          {icon}
          {title}
          <Badge variant="secondary">{lines.length}</Badge>
        </div>
        <ul className="divide-y">{lines.map(renderLine)}</ul>
      </div>
    );
  }

  return (
    <AppShell wide>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t("statements.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("statements.subtitle")}</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("statements.import.title")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("statements.field.account")}</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("statements.field.file")}</Label>
              <Input
                type="file"
                accept="application/pdf,text/csv,text/plain,.csv,.tsv,image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("statements.field.window")}</Label>
              <Input
                type="number"
                min={0}
                max={30}
                value={windowDays}
                onChange={(e) => setWindowDays(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                className="h-9"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <div className="text-sm">{t("statements.field.invert")}</div>
                <div className="text-xs text-muted-foreground">{t("statements.field.invert_hint")}</div>
              </div>
              <Switch checked={invert} onCheckedChange={setInvert} />
            </div>
            <div className="sm:col-span-2 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t("statements.import.hint")}</p>
              <Button onClick={() => importMut.mutate()} disabled={importMut.isPending || !file}>
                {importMut.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-1 h-4 w-4" />
                )}
                {t("statements.import.run")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("statements.list.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 px-2">
              {(importsQ.data?.imports ?? []).map((imp) => (
                <div
                  key={imp.id}
                  className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
                    activeId === imp.id ? "bg-accent" : "hover:bg-muted"
                  }`}
                >
                  <button className="min-w-0 flex-1 text-left" onClick={() => setActiveId(imp.id)}>
                    <div className="truncate font-medium">{imp.file_name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {imp.period_from ?? "?"} – {imp.period_to ?? "?"}
                    </div>
                  </button>
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      await deleteFn({ data: { id: imp.id } });
                      if (activeId === imp.id) setActiveId(null);
                      qc.invalidateQueries({ queryKey: ["statement_imports"] });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {(importsQ.data?.imports ?? []).length === 0 && (
                <p className="px-2 py-2 text-xs text-muted-foreground">{t("statements.list.empty")}</p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-3">
            {!activeId && <p className="text-sm text-muted-foreground">{t("statements.detail.pick")}</p>}
            {activeId && detailQ.isLoading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
              </p>
            )}
            {detail && (
              <>
                <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">{t("statements.detail.period")}</Label>
                    <DatePicker
                      value={detail.import.period_from ?? ""}
                      onChange={async (v) => {
                        await rematchFn({
                          data: {
                            id: detail.import.id,
                            window_days: detail.import.match_window_days,
                            period_from: v || null,
                          },
                        });
                        qc.invalidateQueries({ queryKey: ["statement_import", detail.import.id] });
                        qc.invalidateQueries({ queryKey: ["statement_imports"] });
                      }}
                    />
                    <span className="text-muted-foreground">–</span>
                    <DatePicker
                      value={detail.import.period_to ?? ""}
                      onChange={async (v) => {
                        await rematchFn({
                          data: {
                            id: detail.import.id,
                            window_days: detail.import.match_window_days,
                            period_to: v || null,
                          },
                        });
                        qc.invalidateQueries({ queryKey: ["statement_import", detail.import.id] });
                        qc.invalidateQueries({ queryKey: ["statement_imports"] });
                      }}
                    />
                  </div>
                  {detail.import.closing_balance !== null && (
                    <span className="text-muted-foreground">
                      {t("statements.detail.closing")}: {fmtMoney(detail.import.closing_balance, symbol)}
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {t("statements.detail.lines")}: {detail.lines.length}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Label className="text-xs">{t("statements.field.window")}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={30}
                      className="h-8 w-16"
                      value={detail.import.match_window_days}
                      onChange={async (e) => {
                        const v = Math.max(0, Math.min(30, Number(e.target.value) || 0));
                        await rematchFn({ data: { id: detail.import.id, window_days: v } });
                        qc.invalidateQueries({ queryKey: ["statement_import", detail.import.id] });
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rematching}
                      onClick={async () => {
                        setRematching(true);
                        try {
                          await rematchFn({
                            data: { id: detail.import.id, window_days: detail.import.match_window_days },
                          });
                          await qc.invalidateQueries({ queryKey: ["statement_import", detail.import.id] });
                          toast.success(t("statements.toast.rematched"));
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : String(err));
                        } finally {
                          setRematching(false);
                        }
                      }}
                    >
                      {rematching ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 h-3.5 w-3.5" />
                      )}
                      {t("statements.action.reanalyze")}
                    </Button>
                  </div>
                </div>

                <div
                  className={
                    openCount === 0
                      ? "rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700"
                      : "rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
                  }
                >
                  {openCount === 0
                    ? t("statements.progress.done", { total: String(detail.lines.length) })
                    : t("statements.progress", { open: String(openCount), total: String(detail.lines.length) })}
                </div>

                {section(
                  t("statements.group.missing"),
                  <AlertTriangle className="h-4 w-4 text-destructive" />,
                  groups.missing,
                )}
                {section(
                  t("statements.group.probable"),
                  <HelpCircle className="h-4 w-4 text-amber-600" />,
                  groups.probable,
                )}
                {section(
                  t("statements.group.matched"),
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
                  groups.matched,
                )}
                {section(t("statements.group.ignored"), <EyeOff className="h-4 w-4" />, groups.ignored)}

                <div className="rounded-md border">
                  <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
                    {t("statements.group.not_on_statement")}
                    <Badge variant="secondary">{detail.unmatched_app.length}</Badge>
                  </div>
                  {detail.unmatched_app.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">{t("statements.group.none")}</p>
                  ) : (
                    <ul className="divide-y">
                      {detail.unmatched_app.map((e) => (
                        <li key={e.key} className="flex items-center justify-between gap-2 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-xs text-muted-foreground">{e.occurred_on}</div>
                            <div className="break-words text-sm">{e.description || "—"}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{fmtMoney(e.amount, symbol)}</span>
                            <Button asChild size="sm" variant="outline">
                              <Link to="/edit/$id" params={{ id: e.transaction_id }}>
                                {t("statements.action.open")}
                              </Link>
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}