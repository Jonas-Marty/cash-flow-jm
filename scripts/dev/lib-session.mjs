// Shared by the dev scripts: sign in to the DEV Supabase stack as an existing
// user without a password. See dev-session.mjs for why this exists.
//
// The service key comes from .env.dev-supabase and is never printed. Any
// Supabase URL whose host does not contain "dev" is refused.
import { readFileSync } from "node:fs";
import path from "node:path";

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

export function readEnv(file) {
  const out = {};
  for (const line of readFileSync(path.join(REPO, file), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function devConfig() {
  const sup = readEnv(".env.dev-supabase");
  const app = readEnv(".env.dev-app");
  const supabaseUrl = (app.VITE_SUPABASE_URL || sup.SUPABASE_PUBLIC_URL || "").replace(/\/$/, "");
  const serviceKey = sup.SERVICE_ROLE_KEY;
  const anonKey = sup.ANON_KEY || app.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new Error("need VITE_SUPABASE_URL (.env.dev-app), SERVICE_ROLE_KEY and ANON_KEY (.env.dev-supabase)");
  }
  const host = new URL(supabaseUrl).hostname;
  if (!host.includes("dev")) throw new Error(`refusing: ${host} does not look like the dev stack`);
  return { supabaseUrl, serviceKey, anonKey, host };
}

/**
 * A fresh session for `email`, or for the only dev user when `email` is not
 * given: GoTrue's admin API issues a magic link and it is verified right
 * away, server to server. No e-mail is sent.
 */
export async function mintDevSession(email = process.env.DEV_LOGIN_EMAIL ?? null) {
  const { supabaseUrl, serviceKey, anonKey, host } = devConfig();
  const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const call = async (url, init) => {
    const r = await fetch(url, init);
    const text = await r.text();
    if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${url.replace(supabaseUrl, "")}: ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
  if (!email) {
    const { users } = await call(`${supabaseUrl}/auth/v1/admin/users?per_page=50`, { headers: admin });
    const real = users.filter((u) => u.email);
    if (real.length !== 1) {
      throw new Error(`dev has ${real.length} users; pick one with --email (${real.map((u) => u.email).join(", ")})`);
    }
    email = real[0].email;
  }
  const link = await call(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const tokenHash = link?.properties?.hashed_token ?? link?.hashed_token;
  if (!tokenHash) throw new Error("generate_link returned no hashed_token");
  const session = await call(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
  });
  if (!session?.access_token || !session?.refresh_token) throw new Error("verify returned no session");
  if (!session.expires_at) session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);
  // supabase-js' default key: sb-<first label of the Supabase host>-auth-token.
  return { email, session, storageKey: `sb-${host.split(".")[0]}-auth-token` };
}

/** A Playwright storage state that is signed in on each of `origins`. */
export function storageStateFor({ session, storageKey }, origins) {
  return {
    cookies: [],
    origins: origins.map((origin) => ({
      origin,
      localStorage: [{ name: storageKey, value: JSON.stringify(session) }],
    })),
  };
}
