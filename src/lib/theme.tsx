import * as React from "react";

export type ThemeMode = "light" | "dark" | "system";

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const dark = mode === "dark" || (mode === "system" && mql.matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeApplier({ mode }: { mode: ThemeMode }) {
  React.useEffect(() => {
    applyTheme(mode);
    if (mode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [mode]);
  return null;
}
