import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!s) throw new Error("Server secret not configured");
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