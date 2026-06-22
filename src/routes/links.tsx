import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import {
  createTransactionLink,
  fetchTransactionLinkMembers,
  fetchTransactionLinks,
} from "@/lib/links";
import { KIND_ICON, TransactionLinkSheet } from "@/components/TransactionLinkSheet";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { fetchSettings } from "@/lib/finance";

export const Route = createFileRoute("/links")({
  component: LinksPage,
});

function LinksPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const linksQ = useQuery({ queryKey: ["transaction_links"], queryFn: fetchTransactionLinks });
  const membersQ = useQuery({ queryKey: ["transaction_link_members"], queryFn: fetchTransactionLinkMembers });
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });

  const [openId, setOpenId] = React.useState<string | null>(null);
  const [newTitle, setNewTitle] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const countByLink = React.useMemo(() => {
    const m = new Map<string, number>();
    (membersQ.data ?? []).forEach((mem) => m.set(mem.link_id, (m.get(mem.link_id) ?? 0) + 1));
    return m;
  }, [membersQ.data]);

  const dateFmt = settingsQ.data?.date_format || "yyyy-MM-dd";

  const create = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      const link = await createTransactionLink({ title });
      setNewTitle("");
      qc.invalidateQueries({ queryKey: ["transaction_links"] });
      setOpenId(link.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("links.page.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("links.page.subtitle")}</p>

        <Card><CardContent className="flex flex-wrap items-center gap-2 py-3">
          <Input
            placeholder={t("links.page.new_placeholder")}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
            className="flex-1 min-w-0"
          />
          <Button onClick={create} disabled={creating || !newTitle.trim()}>
            <Plus className="mr-1.5 h-4 w-4" />{t("links.page.new")}
          </Button>
        </CardContent></Card>

        {linksQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (linksQ.data ?? []).length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("links.page.empty")}
          </CardContent></Card>
        ) : (
          <Card><CardContent className="divide-y p-0">
            {(linksQ.data ?? []).map((l) => {
              const Icon = KIND_ICON[l.kind];
              const count = countByLink.get(l.id) ?? 0;
              return (
                <button
                  type="button"
                  key={l.id}
                  onClick={() => setOpenId(l.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{l.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(`links.kind.${l.kind}`)} · {t("links.members.title", { n: count })}
                      {l.planned_on && ` · ${format(new Date(l.planned_on), dateFmt, { locale })}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </CardContent></Card>
        )}

        <TransactionLinkSheet
          linkId={openId}
          open={openId !== null}
          onOpenChange={(o) => { if (!o) setOpenId(null); }}
        />
      </div>
    </AppShell>
  );
}