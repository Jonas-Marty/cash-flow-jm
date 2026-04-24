import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Row { keys: string; label: string }

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  rows: Row[];
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-border bg-muted px-1.5 text-[10px] font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

function renderKeys(combo: string) {
  // "Ctrl+Enter" → <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
  return combo.split(" / ").map((seq, i, arr) => (
    <React.Fragment key={i}>
      <span className="inline-flex items-center gap-1">
        {seq.split("+").map((k, j, ks) => (
          <React.Fragment key={j}>
            <Kbd>{k}</Kbd>
            {j < ks.length - 1 && <span className="text-muted-foreground">+</span>}
          </React.Fragment>
        ))}
      </span>
      {i < arr.length - 1 && <span className="mx-1 text-muted-foreground">/</span>}
    </React.Fragment>
  ));
}

export function ShortcutsDialog({ open, onOpenChange, title, rows }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <ul className="divide-y text-sm">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="flex items-center">{renderKeys(r.keys)}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}