import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Trash2, Copy } from "lucide-react";
import { useI18n } from "@/i18n";
import { listApiTokens, createApiToken, revokeApiToken, deleteApiToken } from "@/utils/api-tokens.functions";

export function ApiTokensCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const list = useServerFn(listApiTokens);
  const create = useServerFn(createApiToken);
  const revoke = useServerFn(revokeApiToken);
  const del = useServerFn(deleteApiToken);

  const q = useQuery({ queryKey: ["api_tokens"], queryFn: () => list() });
  const [name, setName] = React.useState("");
  const [newToken, setNewToken] = React.useState<string | null>(null);

  const onCreate = async () => {
    if (!name.trim()) return;
    try {
      const r = await create({ data: { name: name.trim() } });
      setNewToken(r.raw_token);
      setName("");
      qc.invalidateQueries({ queryKey: ["api_tokens"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("apitokens.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("apitokens.intro")}</p>
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs">{t("apitokens.name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="nextcloud-bridge" />
          </div>
          <Button size="sm" className="self-end" onClick={onCreate}>{t("apitokens.create")}</Button>
        </div>
        {newToken && (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3">
            <p className="text-xs font-medium">{t("apitokens.shown_once")}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{newToken}</code>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(newToken); toast.success(t("apitokens.copied")); }}>
                <Copy className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNewToken(null)}>{t("common.close")}</Button>
            </div>
          </div>
        )}
        <ul className="divide-y rounded-md border">
          {(q.data?.tokens ?? []).length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">{t("apitokens.empty")}</li>
          )}
          {(q.data?.tokens ?? []).map((tok) => (
            <li key={tok.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex-1 truncate">{tok.name}</span>
              {tok.revoked_at && <span className="text-[10px] uppercase text-destructive">{t("apitokens.revoked")}</span>}
              {!tok.revoked_at && (
                <Button size="sm" variant="ghost" onClick={async () => {
                  try { await revoke({ data: { id: tok.id } }); qc.invalidateQueries({ queryKey: ["api_tokens"] }); }
                  catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
                }}>{t("apitokens.revoke")}</Button>
              )}
              <button onClick={async () => {
                if (!confirm(t("apitokens.confirm_delete"))) return;
                try { await del({ data: { id: tok.id } }); qc.invalidateQueries({ queryKey: ["api_tokens"] }); }
                catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
              }} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("apitokens.endpoint_hint")}</p>
      </CardContent>
    </Card>
  );
}