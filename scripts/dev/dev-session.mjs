// Sign in to the DEV stack as an existing user, without a password, and save
// the session where the browser scripts pick it up.
//
//   node scripts/dev/dev-session.mjs                      # the only dev user
//   node scripts/dev/dev-session.mjs --email a@b.ch       # a specific one
//   node scripts/dev/dev-session.mjs --origin http://127.0.0.1:5180
//
// Why: the dev database is a scrubbed clone of production (clone-prod-db.sh),
// so its users sign in through Authentik or with their production password —
// neither of which a script has. A test account would vanish with the next
// clone. Instead this asks the dev GoTrue's admin API for a magic link and
// verifies it right away, server to server (lib-session.mjs): no e-mail is
// sent, no password is needed, and it works again after every clone.
//
// Output: a Playwright storage state (default screenshots/.auth-state.json,
// which screenshot.mjs and smoke.mjs load) holding the session in the
// localStorage key supabase-js reads. The refresh token keeps it usable after
// the one-hour access token expires. perf-transactions.mjs mints its own
// session in memory and needs none of this.
//
// Dev only: it refuses any Supabase URL whose host does not contain "dev".
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPO, mintDevSession, storageStateFor } from "./lib-session.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const all = (name) => args.reduce((acc, a, i) => (a === `--${name}` ? [...acc, args[i + 1]] : acc), []);

const origins = all("origin").length
  ? all("origin")
  : [(process.env.DEV_APP_URL ?? "https://dev-cash-flow.wi-wo.ch").replace(/\/$/, "")];
const outPath = opt("out") ?? path.join(REPO, "screenshots", ".auth-state.json");

const minted = await mintDevSession(opt("email"));
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(storageStateFor(minted, origins), null, 2), { mode: 0o600 });
const { session } = minted;
console.log(`signed in as ${minted.email} (user ${session.user?.id}) for ${origins.join(", ")}`);
console.log(`session saved to ${path.relative(REPO, outPath)} (refreshable; access token valid until ${new Date(session.expires_at * 1000).toISOString()})`);
