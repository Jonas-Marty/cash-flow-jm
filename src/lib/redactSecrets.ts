/**
 * Blanks credentials in a payload before it is written to the AI log.
 *
 * Matches keys, not values, and only keys that name a secret: a bearer or API
 * token, a password, a cookie. Token *counts* stay: `prompt_tokens`,
 * `max_tokens` and the provider's `*_tokens_details` are usage figures, and
 * blanking them hid cached and reasoning tokens from the log. The difference is
 * the plural — a key ending in "token" holds one, a key ending in "tokens"
 * counts them.
 */
const SECRET_KEY =
  /token($|[_-]?hint)|authorization|api[_-]?key|secret|password|passwd|cookie|credential|private[_-]?key/;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key.toLowerCase());
}

export function redactSecrets(obj: unknown): void {
  if (!obj || typeof obj !== "object") return;
  const rec = obj as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    if (isSecretKey(k)) rec[k] = "[redacted]";
    else redactSecrets(rec[k]);
  }
}
