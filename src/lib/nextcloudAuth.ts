// Token-renewal rules for the Nextcloud connection, kept free of I/O so the
// race handling is testable. nextcloud.server.ts wires them to the database.
//
// Nextcloud access tokens live exactly one hour. Each refresh token works once:
// redeeming it returns a new pair and voids the old one. Two requests that
// both see an expired token and both redeem the same refresh token therefore
// race, and the loser gets 400 back although the connection is fine.

/**
 * The message every "you must reconnect" failure carries, so the browser can
 * tell it apart from an ordinary error and point at Settings instead.
 */
export const NC_RECONNECT = "NEXTCLOUD_RECONNECT";

export class NextcloudReconnectError extends Error {
  constructor(detail?: string) {
    super(detail ? `${NC_RECONNECT}: ${detail}` : NC_RECONNECT);
    this.name = "NextcloudReconnectError";
  }
}

export function isReconnectError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return msg.includes(NC_RECONNECT);
}

/**
 * Run at most one `fn` per key at a time. Callers arriving while it runs get
 * the same promise, so one user's parallel searches renew the token once.
 */
export function singleFlight<T>() {
  const inflight = new Map<string, Promise<T>>();
  return (key: string, fn: () => Promise<T>): Promise<T> => {
    const running = inflight.get(key);
    if (running) return running;
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}

/** True once the token is past its stored expiry. Unknown expiry is not expired. */
export function isExpired(expiresAt: string | null, now: number = Date.now()): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) && t <= now;
}

/**
 * Only a 400/401 from the token endpoint means the refresh token was refused.
 * A 5xx, a timeout or a network error says nothing about the token, and
 * treating it as refused would throw away a connection that still works.
 */
export function refreshRefused(status: number): boolean {
  return status === 400 || status === 401;
}

/**
 * Nextcloud refused the refresh token we sent. If the stored row now holds a
 * different one, something else renewed first (another request, another app
 * instance) and the stored pair is good. If it still holds the one we sent,
 * that token was the only one and it is spent: the user has to reconnect.
 */
export function afterRefusedRefresh(
  sent: string,
  stored: { refresh_token: string | null; access_token: string | null } | null,
): "use-stored" | "reconnect" {
  if (stored?.access_token && stored.refresh_token && stored.refresh_token !== sent) return "use-stored";
  return "reconnect";
}
