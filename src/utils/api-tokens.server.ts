// Server-only helpers for API tokens.
// These run only inside server functions / server routes.

import { createHash, randomBytes } from "node:crypto";

export function generateRawToken(): string {
  // 32 random bytes, base64url-ish, prefixed for easy identification
  return "lvbl_" + randomBytes(32).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}