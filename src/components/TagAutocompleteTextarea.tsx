import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { extractTags } from "@/lib/finance";
import type { Transaction } from "@/lib/finance";
import { cn } from "@/lib/utils";

interface Props extends Omit<React.ComponentProps<typeof Textarea>, "onChange" | "value"> {
  value: string;
  onChange: (next: string) => void;
  transactions: Transaction[];
  /** Optional extra suggestion source (already-known tags). */
  extraTags?: string[];
  className?: string;
}

/**
 * Detect a `#partial` token at the cursor. Returns null when not in a tag context.
 * Triggers right after typing `#` (empty query) and while typing tag chars.
 */
function detectActiveTag(value: string, caret: number): { start: number; end: number; query: string } | null {
  if (caret < 1) return null;
  // Walk back from caret to find a '#' that starts a token.
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === "#") {
      // Must be at start or preceded by whitespace / newline.
      const prev = i === 0 ? " " : value[i - 1];
      if (!/\s/.test(prev)) return null;
      const query = value.slice(i + 1, caret);
      if (!/^[\p{L}\p{N}_-]*$/u.test(query)) return null;
      // Only show while caret is at the end of the token (no chars right after that are tag chars).
      const after = value[caret];
      if (after && /[\p{L}\p{N}_-]/u.test(after)) return null;
      return { start: i, end: caret, query };
    }
    if (!/[\p{L}\p{N}_-]/u.test(ch)) return null;
    i--;
  }
  return null;
}

export const TagAutocompleteTextarea = React.forwardRef<HTMLTextAreaElement, Props>(function TagAutocompleteTextarea({
  value,
  onChange,
  transactions,
  extraTags,
  className,
  ...rest
}, forwardedRef) {
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const setRefs = React.useCallback((el: HTMLTextAreaElement | null) => {
    taRef.current = el;
    if (typeof forwardedRef === "function") forwardedRef(el);
    else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
  }, [forwardedRef]);
  const [caret, setCaret] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);

  // Build a ranked tag dictionary from history + extras.
  const ranked = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of transactions) {
      for (const tag of extractTags(t.note)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    for (const tag of extraTags ?? []) {
      if (!counts.has(tag)) counts.set(tag, 0);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t);
  }, [transactions, extraTags]);

  const active = detectActiveTag(value, caret);
  const presentTags = React.useMemo(() => new Set(extractTags(value)), [value]);

  const suggestions = React.useMemo(() => {
    if (!active) return [];
    const q = active.query.toLowerCase();
    const list = ranked.filter((t) => !presentTags.has(t) && (q === "" || t.toLowerCase().includes(q)));
    // Prefer prefix matches first.
    list.sort((a, b) => {
      const ap = a.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp;
    });
    return list.slice(0, 8);
  }, [active, ranked, presentTags]);

  React.useEffect(() => {
    setOpen(!!active && suggestions.length > 0);
    setActiveIdx(0);
  }, [active?.start, active?.query, suggestions.length]);

  const insertTag = (tag: string) => {
    if (!active) return;
    const before = value.slice(0, active.start);
    const after = value.slice(active.end);
    const needsSpace = after.length > 0 && !/^\s/.test(after);
    const inserted = `#${tag}${needsSpace ? " " : ""}`;
    const next = before + inserted + after;
    onChange(next);
    const newCaret = (before + inserted).length;
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(newCaret, newCaret);
        setCaret(newCaret);
      }
    });
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertTag(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const updateCaret = () => {
    const el = taRef.current;
    if (el) setCaret(el.selectionStart ?? 0);
  };

  return (
    <div className={cn("relative", className)}>
      <Textarea
        {...rest}
        ref={setRefs}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          // selectionStart reflects the post-change caret
          setCaret(e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={updateCaret}
        onClick={updateCaret}
        onSelect={updateCaret}
        onBlur={() => {
          // Delay so click on suggestion can fire first.
          setTimeout(() => setOpen(false), 120);
        }}
      />
      {open && suggestions.length > 0 && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {suggestions.map((t, i) => (
            <button
              key={t}
              type="button"
              role="option"
              aria-selected={i === activeIdx}
              onMouseDown={(e) => {
                // prevent textarea blur before click handler runs
                e.preventDefault();
              }}
              onClick={() => insertTag(t)}
              onMouseEnter={() => setActiveIdx(i)}
              className={cn(
                "block w-full rounded-sm px-2 py-1 text-left text-sm",
                i === activeIdx ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
              )}
            >
              <span className="text-muted-foreground">#</span>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});