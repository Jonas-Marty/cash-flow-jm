import * as React from "react";
import { Link2, Plus, Check } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import {
  attachTransactionToLink,
  createTransactionLink,
  detachTransactionFromLink,
  fetchTransactionLinks,
  fetchTransactionLinkMembers,
  type TransactionLink,
} from "@/lib/links";

type Props = {
  /** Transaction the picker acts on. */
  transactionId: string;
  /** Current link id (if known), so the picker shows "current" and asks to confirm moves. */
  currentLinkId?: string | null;
  /** Optional render override for the trigger button. */
  triggerLabel?: string;
  /** Compact ghost icon-only trigger (used in transaction rows). */
  compact?: boolean;
  /** Called after attach/move/detach succeeds. */
  onChanged?: (linkId: string | null) => void;
};

/**
 * Small popover combobox to attach a transaction to a link (or move it).
 * Membership is exclusive (DB PK on transaction_id), so picking another
 * link asks the user to confirm a move.
 */
export function TransactionLinkPicker({ transactionId, currentLinkId, triggerLabel, compact, onChanged }: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const linksQ = useQuery({ queryKey: ["transaction_links"], queryFn: fetchTransactionLinks, enabled: open });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["transaction_links"] });
    qc.invalidateQueries({ queryKey: ["transaction_link_members"] });
  };

  const handleAttach = async (link: TransactionLink) => {
    if (link.id === currentLinkId) { setOpen(false); return; }
    if (currentLinkId) {
      const currentTitle = (linksQ.data ?? []).find((l) => l.id === currentLinkId)?.title ?? "";
      if (!confirm(t("links.confirm_move", { from: currentTitle, to: link.title }))) return;
    }
    setBusy(true);
    try {
      await attachTransactionToLink(transactionId, link.id);
      toast.success(t("links.toast.attached", { title: link.title }));
      invalidate();
      onChanged?.(link.id);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const link = await createTransactionLink({ title: trimmed });
      await attachTransactionToLink(transactionId, link.id);
      toast.success(t("links.toast.created_and_attached", { title: link.title }));
      invalidate();
      onChanged?.(link.id);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDetach = async () => {
    setBusy(true);
    try {
      await detachTransactionFromLink(transactionId);
      toast.success(t("links.toast.detached"));
      invalidate();
      onChanged?.(null);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const [query, setQuery] = React.useState("");
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return linksQ.data ?? [];
    return (linksQ.data ?? []).filter((l) => l.title.toLowerCase().includes(q));
  }, [linksQ.data, query]);
  const showCreate = query.trim().length > 0 && !filtered.some((l) => l.title.toLowerCase() === query.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("links.picker.aria")}
          >
            <Link2 className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Link2 className="h-4 w-4" />
            {triggerLabel ?? t("links.picker.button")}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("links.picker.search")}
            value={query}
            onValueChange={setQuery}
            disabled={busy}
          />
          <CommandList>
            <CommandEmpty>{t("links.picker.empty")}</CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup heading={t("links.picker.existing")}>
                {filtered.map((l) => (
                  <CommandItem
                    key={l.id}
                    value={l.id}
                    onSelect={() => handleAttach(l)}
                    disabled={busy}
                  >
                    <span className="flex-1 truncate">{l.title}</span>
                    {l.id === currentLinkId && <Check className="h-3.5 w-3.5 text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showCreate && (
              <CommandGroup heading={t("links.picker.create_heading")}>
                <CommandItem value={`__create__${query}`} onSelect={() => handleCreate(query)} disabled={busy}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  {t("links.picker.create", { title: query.trim() })}
                </CommandItem>
              </CommandGroup>
            )}
            {currentLinkId && (
              <CommandGroup heading={t("links.picker.actions")}>
                <CommandItem value="__detach" onSelect={handleDetach} disabled={busy} className="text-destructive">
                  {t("links.picker.detach")}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}