import * as React from "react";

/**
 * How many rows a long list renders, growing while the user scrolls.
 *
 * The list's data stays complete (filters, search, select-all see every row);
 * only the DOM is limited, so the page costs about the same with 500 or
 * 10,000 transactions. Rendering all of them at once took 18 s at ~10,000.
 *
 * `resetKey` identifies what is shown (filters, sort, search, view): a new key
 * starts from `initial` again. The count reached for a key is remembered for
 * the browser session, so coming back from the edit page restores the same
 * depth and scroll restoration has rows to scroll to.
 */

const MAX_REMEMBERED = 20;
const remembered = new Map<string, number>();

export function recallCount(key: string, initial: number): number {
  return Math.max(initial, remembered.get(key) ?? initial);
}

export function rememberCount(key: string, count: number): void {
  remembered.delete(key);
  remembered.set(key, count);
  while (remembered.size > MAX_REMEMBERED) {
    remembered.delete(remembered.keys().next().value as string);
  }
}

/** For tests. */
export function forgetCounts(): void {
  remembered.clear();
}

/** The nearest ancestor that scrolls vertically, or null for the page itself. */
function scrollParent(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export function useProgressiveCount({
  total,
  resetKey,
  initial = 100,
  step = 200,
}: {
  total: number;
  resetKey: string;
  initial?: number;
  step?: number;
}) {
  // The remembered depth only applies when the list mounts (coming back from
  // another page). A change of filters while here starts over at `initial`.
  const [state, setState] = React.useState(() => ({ key: resetKey, count: recallCount(resetKey, initial) }));
  let count = state.count;
  if (state.key !== resetKey) {
    // Adjust during render (not in an effect) so the old depth never flashes.
    count = initial;
    rememberCount(resetKey, initial);
    setState({ key: resetKey, count });
  }

  const showMore = React.useCallback(() => {
    setState((s) => {
      const next = s.count + step;
      rememberCount(s.key, next);
      return { ...s, count: next };
    });
  }, [step]);

  const hasMore = count < total;
  const hasMoreRef = React.useRef(hasMore);
  hasMoreRef.current = hasMore;

  // Load the next step when the sentinel below the list comes near the
  // viewport (or near the bottom of the list's own scroll container).
  const observer = React.useRef<IntersectionObserver | null>(null);
  const target = React.useRef<Element | null>(null);
  const sentinelRef = React.useCallback(
    (el: Element | null) => {
      observer.current?.disconnect();
      observer.current = null;
      target.current = el;
      if (!el || typeof IntersectionObserver === "undefined") return;
      const io = new IntersectionObserver(
        (entries) => {
          if (hasMoreRef.current && entries.some((e) => e.isIntersecting)) showMore();
        },
        { root: scrollParent(el), rootMargin: "800px 0px" },
      );
      io.observe(el);
      observer.current = io;
    },
    [showMore],
  );

  // After each step, look again: on a tall screen the sentinel can still be
  // in range, and an observer only reports changes.
  React.useEffect(() => {
    const io = observer.current;
    const el = target.current;
    if (!io || !el || !hasMore) return;
    io.unobserve(el);
    io.observe(el);
  }, [count, hasMore]);

  React.useEffect(() => () => observer.current?.disconnect(), []);

  return {
    count: Math.min(count, total),
    hasMore,
    remaining: Math.max(0, total - count),
    showMore,
    sentinelRef,
  };
}
