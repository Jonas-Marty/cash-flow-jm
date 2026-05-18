import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Paperclip, Trash2, ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { NextcloudFilePicker, type PickedFile } from "@/components/NextcloudFilePicker";

interface AttachmentRow {
  id: string;
  transaction_id: string;
  source: string;
  display_name: string;
  link_url: string;
  added_at: string;
}

export interface DraftAttachment {
  source: string;
  display_name: string;
  link_url: string;
}

type Props =
  | { transactionId: string; statementId?: never; draft?: never; items?: never; onItemsChange?: never }
  | { statementId: string; transactionId?: never; draft?: never; items?: never; onItemsChange?: never }
  | { draft: true; items: DraftAttachment[]; onItemsChange: (items: DraftAttachment[]) => void; transactionId?: never; statementId?: never };

export function AttachmentsSection(props: Props) {
  const isDraft = "draft" in props && props.draft === true;
  const transactionId = !isDraft && "transactionId" in props ? props.transactionId : undefined;
  const statementId = !isDraft && "statementId" in props ? props.statementId : undefined;
  const parentKey = transactionId ?? statementId ?? "";
  const parentCol = transactionId ? "transaction_id" : "statement_id";
  const { t } = useI18n();
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const q = useQuery({
    queryKey: ["attachments", parentCol, parentKey],
    enabled: !isDraft && !!parentKey,
    queryFn: async (): Promise<AttachmentRow[]> => {
      const { data, error } = await supabase
        .from("transaction_attachments")
        .select("id, transaction_id, source, display_name, link_url, added_at")
        .eq(parentCol, parentKey)
        .order("added_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AttachmentRow[];
    },
  });

  const onPick = async (f: PickedFile) => {
    if (isDraft) {
      const draftProps = props as Extract<Props, { draft: true }>;
      draftProps.onItemsChange([
        { source: "nextcloud", display_name: f.name, link_url: f.link_url },
        ...draftProps.items,
      ]);
      toast.success(t("attachments.added"));
      return;
    }
    const { error } = await supabase.from("transaction_attachments").insert({
      transaction_id: transactionId ?? null,
      statement_id: statementId ?? null,
      source: "nextcloud",
      display_name: f.name,
      link_url: f.link_url,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(t("attachments.added"));
    qc.invalidateQueries({ queryKey: ["attachments", parentCol, parentKey] });
  };

  const onDelete = async (id: string) => {
    if (!confirm(t("attachments.confirm_delete"))) return;
    const { error } = await supabase.from("transaction_attachments").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["attachments", parentCol, parentKey] });
  };

  const onDeleteDraft = (idx: number) => {
    if (!confirm(t("attachments.confirm_delete"))) return;
    const draftProps = props as Extract<Props, { draft: true }>;
    draftProps.onItemsChange(draftProps.items.filter((_, i) => i !== idx));
  };

  const items = isDraft
    ? (props as Extract<Props, { draft: true }>).items.map((it, i) => ({
        id: `draft-${i}`,
        transaction_id: "",
        source: it.source,
        display_name: it.display_name,
        link_url: it.link_url,
        added_at: "",
        _draftIdx: i,
      }))
    : (q.data ?? []).map((a) => ({ ...a, _draftIdx: -1 }));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Paperclip className="h-4 w-4" /> {t("attachments.title")}
          {items.length > 0 && <span className="text-muted-foreground">({items.length})</span>}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
          <Plus className="mr-1 h-3 w-3" /> {t("attachments.add")}
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("attachments.empty")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
              <a
                href={a.link_url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate hover:underline"
                title={a.link_url}
              >
                {a.display_name}
              </a>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{a.source}</span>
              <a href={a.link_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                type="button"
                onClick={() => (isDraft ? onDeleteDraft(a._draftIdx) : onDelete(a.id))}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <NextcloudFilePicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={onPick} />
    </div>
  );
}