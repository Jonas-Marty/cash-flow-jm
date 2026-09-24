import * as React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SuggestionList, listKeyHandler } from "@/components/SuggestionList";
import type { Transaction } from "@/lib/finance";
import {
  detectActiveTag,
  insertTag,
  suggestTags,
  tagsInField,
  type TagFieldMode,
} from "@/lib/tagAutocomplete";
import { scoreTags, type SuggestionContext } from "@/lib/usageScoring";

interface TagSource {
  value: string;
  onChange: (next: string) => void;
  /** History the tags are ranked from (how often, how recently, in what context). */
  transactions: Transaction[];
  /** Optional extra suggestion source (already-known tags). */
  extraTags?: string[];
  /** Context (selected account/category/description) used to re-rank tag suggestions. */
  ctx?: SuggestionContext;
  /** Classes for the wrapper around the field. */
  className?: string;
  /** Classes for the field itself, e.g. the tables' compact `h-8`. */
  inputClassName?: string;
}

type FieldEl = HTMLInputElement | HTMLTextAreaElement;

/** Caret tracking, ranking and insertion shared by the note textarea and the table inputs. */
function useTagAutocomplete<E extends FieldEl>(
  { value, onChange, transactions, extraTags, ctx }: TagSource,
  mode: TagFieldMode,
) {
  const elRef = React.useRef<E | null>(null);
  const [caret, setCaret] = React.useState(0);
  const [focused, setFocused] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);

  const ctxKey = JSON.stringify(ctx ?? {});
  const ranked = React.useMemo(() => {
    const scores = scoreTags(transactions, ctx ?? {});
    for (const tag of extraTags ?? []) {
      if (!scores.has(tag)) scores.set(tag, 0);
    }
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, extraTags, ctxKey]);

  const active = detectActiveTag(value, caret, mode);
  const present = React.useMemo(() => tagsInField(value, mode), [value, mode]);
  const suggestions = React.useMemo(
    () => suggestTags(ranked, active, present),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ranked, active?.start, active?.end, active?.query, present],
  );

  // Only a focused field offers anything: a tags field has a token at the
  // caret from the start, and would otherwise open on every row at once.
  React.useEffect(() => {
    setOpen(focused && !!active && suggestions.length > 0);
    setActiveIdx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, active?.start, active?.query, suggestions.length]);

  const updateCaret = () => {
    const el = elRef.current;
    if (el) setCaret(el.selectionStart ?? 0);
  };

  const pick = (tag: string) => {
    if (!active) return;
    const next = insertTag(value, active, tag, mode);
    onChange(next.value);
    requestAnimationFrame(() => {
      const el = elRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
        setCaret(next.caret);
      }
    });
    setOpen(false);
  };

  const onKeyDown = listKeyHandler({
    open,
    count: suggestions.length,
    setActive: setActiveIdx,
    pickActive: () => pick(suggestions[activeIdx]),
    close: () => setOpen(false),
    openList: () => setOpen(!!active && suggestions.length > 0),
    tab: "pick-and-stay",
  });

  const fieldProps = {
    value,
    onChange: (e: React.ChangeEvent<E>) => {
      onChange(e.target.value);
      // selectionStart reflects the post-change caret
      setCaret(e.target.selectionStart ?? e.target.value.length);
    },
    onKeyUp: updateCaret,
    onClick: updateCaret,
    onSelect: updateCaret,
    onFocus: () => {
      setFocused(true);
      updateCaret();
    },
    onBlur: () => setFocused(false),
  };

  const list = (field: React.ReactNode, className?: string) => (
    <SuggestionList
      className={className}
      open={open}
      onClose={() => setOpen(false)}
      field={field}
      items={suggestions}
      active={activeIdx}
      onActive={setActiveIdx}
      onPick={pick}
      itemKey={(t) => t}
      renderItem={(t) => (
        <span className="truncate">
          <span className="text-muted-foreground">#</span>
          {t}
        </span>
      )}
    />
  );

  return { elRef, fieldProps, onKeyDown, list };
}

type Handlers<E> = Pick<
  React.DOMAttributes<E>,
  "onFocus" | "onBlur" | "onClick" | "onKeyUp" | "onSelect"
>;

/**
 * The field's own handlers, run before any the caller passed: the recurring
 * rules dialog, for one, tracks which field has focus through onFocus, and a
 * plain spread would have replaced its handler with ours.
 */
function withCallerHandlers<
  E,
  P extends {
    onFocus: () => void;
    onBlur: () => void;
    onClick: () => void;
    onKeyUp: () => void;
    onSelect: () => void;
  },
>(ours: P, theirs: Handlers<E>): P {
  const chain =
    <Ev,>(a: () => void, b?: (e: Ev) => void) =>
    (e: Ev) => {
      a();
      b?.(e);
    };
  return {
    ...ours,
    onFocus: chain(ours.onFocus, theirs.onFocus),
    onBlur: chain(ours.onBlur, theirs.onBlur),
    onClick: chain(ours.onClick, theirs.onClick),
    onKeyUp: chain(ours.onKeyUp, theirs.onKeyUp),
    onSelect: chain(ours.onSelect, theirs.onSelect),
  };
}

function useMergedRef<E>(inner: React.MutableRefObject<E | null>, outer: React.ForwardedRef<E>) {
  return React.useCallback(
    (el: E | null) => {
      inner.current = el;
      if (typeof outer === "function") outer(el);
      else if (outer) outer.current = el;
    },
    [inner, outer],
  );
}

type TextareaProps = TagSource & Omit<React.ComponentProps<typeof Textarea>, "onChange" | "value">;

/**
 * A note textarea that suggests known tags once `#` is typed. Used by the Add
 * form, recurring rules and the pending card.
 */
export const TagAutocompleteTextarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function TagAutocompleteTextarea(
    {
      value,
      onChange,
      transactions,
      extraTags,
      ctx,
      className,
      inputClassName,
      onKeyDown,
      onFocus,
      onBlur,
      onClick,
      onKeyUp,
      onSelect,
      ...rest
    },
    ref,
  ) {
    const ac = useTagAutocomplete<HTMLTextAreaElement>(
      { value, onChange, transactions, extraTags, ctx },
      "note",
    );
    const setRef = useMergedRef(ac.elRef, ref);
    return ac.list(
      <Textarea
        {...rest}
        className={inputClassName}
        ref={setRef}
        {...withCallerHandlers(ac.fieldProps, { onFocus, onBlur, onClick, onKeyUp, onSelect })}
        onKeyDown={(e) => {
          ac.onKeyDown(e);
          if (!e.defaultPrevented) onKeyDown?.(e);
        }}
      />,
      className,
    );
  },
);

type InputProps = TagSource &
  Omit<React.ComponentProps<typeof Input>, "onChange" | "value"> & {
    /**
     * "note" (default): free text, suggestions after `#`. "tags": the field
     * holds only tags, so every word is one and suggestions open on focus.
     */
    mode?: TagFieldMode;
  };

/** The single-line version, for the table rows of /pending and /statements. */
export const TagAutocompleteInput = React.forwardRef<HTMLInputElement, InputProps>(
  function TagAutocompleteInput(
    {
      value,
      onChange,
      transactions,
      extraTags,
      ctx,
      className,
      inputClassName,
      mode = "note",
      onKeyDown,
      onFocus,
      onBlur,
      onClick,
      onKeyUp,
      onSelect,
      ...rest
    },
    ref,
  ) {
    const ac = useTagAutocomplete<HTMLInputElement>(
      { value, onChange, transactions, extraTags, ctx },
      mode,
    );
    const setRef = useMergedRef(ac.elRef, ref);
    return ac.list(
      <Input
        autoComplete="off"
        {...rest}
        className={inputClassName}
        ref={setRef}
        {...withCallerHandlers(ac.fieldProps, { onFocus, onBlur, onClick, onKeyUp, onSelect })}
        onKeyDown={(e) => {
          ac.onKeyDown(e);
          if (!e.defaultPrevented) onKeyDown?.(e);
        }}
      />,
      className,
    );
  },
);
