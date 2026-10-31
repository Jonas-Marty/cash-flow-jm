/**
 * True when the app talks to the dev database (the dev deployment, or the
 * local app pointed at the dev stack). Same rule as scripts/dev/dev-session.mjs:
 * a Supabase host with "dev" in its name. Baked in at build time.
 */
export const IS_DEV_ENV = (() => {
  const url = import.meta.env.VITE_SUPABASE_URL ?? "";
  try {
    return new URL(url).hostname.includes("dev");
  } catch {
    return false;
  }
})();
