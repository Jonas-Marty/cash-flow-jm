import * as React from "react";

/**
 * Whether a CSS media query matches, kept up to date. The server snapshot is
 * `serverDefault`, so server render and hydration agree; the real value takes
 * over right after hydration.
 */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}

/** Tailwind's `md` breakpoint and up. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 768px)");
}
