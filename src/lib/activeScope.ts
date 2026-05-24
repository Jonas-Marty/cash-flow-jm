import * as React from "react";

/**
 * Per-device "active scope" — the scope category that auto-fills
 * the /add form. Stored in localStorage so it survives reloads but
 * does not sync across devices.
 */
const KEY = "active_scope_id";
const EVENT = "active-scope-change";

function read(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function write(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function getActiveScopeId(): string | null {
  return read();
}

export function setActiveScopeId(id: string | null): void {
  write(id);
}

export function useActiveScopeId(): [string | null, (id: string | null) => void] {
  const [id, setId] = React.useState<string | null>(() => read());
  React.useEffect(() => {
    const handler = () => setId(read());
    window.addEventListener(EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return [id, (v: string | null) => write(v)];
}