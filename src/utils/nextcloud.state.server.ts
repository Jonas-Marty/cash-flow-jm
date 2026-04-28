import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  // Prefer a dedicated state-signing secret; fall back ONLY to the service role key.
  // We must NOT fall back to the publishable/anon key — it is exposed to browsers and
  // would let anyone forge OAuth state tokens.
  const s = process.env.NEXTCLOUD_STATE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) {
    throw new Error(
      "OAuth state signing secret not configured (NEXTCLOUD_STATE_SECRET or SUPABASE_SERVICE_ROLE_KEY required)",
    );
  }
  return s;
}

export function signState(userId: string): string {
  const ts = Date.now().toString();
  const payload = `${userId}.${ts}`;
  const sig = createHmac("sha256", getSecret()).update(payload).digest("hex").slice(0, 32);
  // url-safe base64 of payload + sig
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyState(state: string, maxAgeMs = 10 * 60 * 1000): { userId: string } | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf-8");
    const parts = decoded.split(".");
    if (parts.length !== 3) return null;
    const [userId, tsStr, sig] = parts;
    const payload = `${userId}.${tsStr}`;
    const expected = createHmac("sha256", getSecret()).update(payload).digest("hex").slice(0, 32);
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const ts = Number(tsStr);
    if (!Number.isFinite(ts)) return null;
    if (Date.now() - ts > maxAgeMs) return null;
    return { userId };
  } catch {
    return null;
  }
}