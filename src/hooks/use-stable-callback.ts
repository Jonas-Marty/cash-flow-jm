import * as React from "react";

/**
 * A callback whose identity never changes but which always runs the latest
 * `fn`. For handlers passed to memoised rows: a new closure on every render
 * would re-render every row.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = React.useRef(fn);
  React.useLayoutEffect(() => {
    ref.current = fn;
  });
  return React.useCallback((...args: A) => ref.current(...args), []);
}
