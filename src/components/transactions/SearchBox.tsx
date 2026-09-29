import * as React from "react";
import { Input } from "@/components/ui/input";

/** Pause after the last keystroke before the search is applied. */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * The Transactions search box. It keeps what is being typed in its own state,
 * so a keystroke re-renders only this input — not the page and its hundreds
 * of rows — and reports the text through `onCommit` once typing pauses
 * (Enter and Escape commit at once).
 *
 * `value` is the applied search (the URL's `q`). It is adopted when it
 * changes from outside — history navigation, "clear all" — but never while
 * the box has focus: a navigation resolving mid-word would otherwise rewind
 * the text under the caret.
 */
export const SearchBox = React.memo(
  React.forwardRef<
    HTMLInputElement,
    { value: string; onCommit: (v: string) => void; placeholder?: string }
  >(function SearchBox({ value, onCommit, placeholder }, ref) {
    const inputRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
    const [draft, setDraft] = React.useState(value);
    const committed = React.useRef(value);
    const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const onCommitRef = React.useRef(onCommit);
    onCommitRef.current = onCommit;

    const commit = React.useCallback((v: string) => {
      clearTimeout(timer.current);
      if (v === committed.current) return;
      committed.current = v;
      onCommitRef.current(v);
    }, []);

    React.useEffect(() => {
      if (value === committed.current) return;
      if (typeof document !== "undefined" && document.activeElement === inputRef.current) return;
      clearTimeout(timer.current);
      committed.current = value;
      setDraft(value);
    }, [value]);

    React.useEffect(() => () => clearTimeout(timer.current), []);

    return (
      <Input
        ref={inputRef}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(v), SEARCH_DEBOUNCE_MS);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft("");
            commit("");
          }
          if (e.key === "Enter") commit(draft);
        }}
      />
    );
  }),
);
