// Sign in to the DEV stack as an existing user, without a password, and save
// the session where the browser scripts pick it up.
//
//   node scripts/dev/dev-session.mjs                      # the only dev user
//   node scripts/dev/dev-session.mjs --email a@b.ch       # a specific one
//   node scripts/dev/dev-session.mjs --origin http://localhost:8080
//
// Why: the dev database is a scrubbed clone of production (clone-prod-db.sh),
// so its users sign in through Authentik or with their production password —
// neither of which a script has. A test account would vanish with the next
// clone. Instead this asks the dev GoTrue's admin API for a magic link and
// verifies it right away, server to server: no e-mail is sent, no password is
// needed, and it works again after every clone.
//
// Output: a Playwright storage state (default screenshots/.auth-state.json,
// which screenshot.mjs and smoke.mjs load) holding the session in the
// localStorage key supabase-js reads. The refresh token keeps it usable after
// the one-hour access token expires.
//
// Dev only: it refuses any Supabase URL whose host does not contain "dev".
// It reads the service key from .env.dev-supabase and never prints it.
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const all = (name) => args.reduce((acc, a, i) => (a === `--${name}` ? [...acc, args[i + 1]] : acc), []);

function readEnv(file) {
  const out = {};
  for (const line of readFileSync(path.join(REPO, file), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const sup = readEnv(".env.dev-supabase");
const app = readEnv(".env.dev-app");
const supabaseUrl = (app.VITE_SUPABASE_URL || sup.SUPABASE_PUBLIC_URL || "").replace(/\/$/, "");
const serviceKey = sup.SERVICE_ROLE_KEY;
const anonKey = sup.ANON_KEY || app.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("need VITE_SUPABASE_URL (.env.dev-app), SERVICE_ROLE_KEY and ANON_KEY (.env.dev-supabase)");
const host = new URL(supabaseUrl).hostname;
if (!host.includes("dev")) throw new Error(`refusing: ${host} does not look like the dev stack`);

const origins = all("origin").length
  ? all("origin")
  : [(process.env.DEV_APP_URL ?? "https://dev-cash-flow.wi-wo.ch").replace(/\/$/, "")];
const outPath = opt("out") ?? path.join(REPO, "screenshots", ".auth-state.json");

const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

async function call(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${url.replace(supabaseUrl, "")}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

let email = opt("email") ?? process.env.DEV_LOGIN_EMAIL ?? null;
if (!email) {
  const { users } = await call(`${supabaseUrl}/auth/v1/admin/users?per_page=50`, { headers: admin });
  const real = users.filter((u) => u.email);
  if (real.length !== 1) {
    throw new Error(`dev has ${real.length} users; pick one with --email (${real.map((u) => u.email).join(", ")})`);
  }
  email = real[0].email;
}

// 1. Admin: a magic link for that user (GoTrue returns the token, sends nothing).
const link = await call(`${supabaseUrl}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: admin,
  body: JSON.stringify({ type: "magiclink", email }),
});
const tokenHash = link?.properties?.hashed_token ?? link?.hashed_token;
if (!tokenHash) throw new Error("generate_link returned no hashed_token");

// 2. Verify it like the browser would after clicking the link.
const session = await call(`${supabaseUrl}/auth/v1/verify`, {
  method: "POST",
  headers: { apikey: anonKey, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
});
if (!session?.access_token || !session?.refresh_token) throw new Error("verify returned no session");
if (!session.expires_at) session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);

// supabase-js' default key: sb-<first label of the Supabase host>-auth-token.
const storageKey = `sb-${host.split(".")[0]}-auth-token`;
const state = {
  cookies: [],
  origins: origins.map((origin) => ({
    origin,
    localStorage: [{ name: storageKey, value: JSON.stringify(session) }],
  })),
};
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(state, null, 2), { mode: 0o600 });
console.log(`signed in as ${email} (user ${session.user?.id}) for ${origins.join(", ")}`);
console.log(`session saved to ${path.relative(REPO, outPath)} (refreshable; access token valid until ${new Date(session.expires_at * 1000).toISOString()})`);
