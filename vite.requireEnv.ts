import { loadEnv, type Plugin } from "vite";

/**
 * Fails the build when a required `VITE_*` variable is missing or blank.
 *
 * These are inlined into the client bundle at build time, so an absent one is
 * not an error anyone sees — it becomes an empty string in the shipped code.
 * `VITE_HELP_URL` did exactly that: unset, it turned every absolute link to
 * the guide into a root-relative path, and the browser resolved it against
 * whatever host the app happened to be on. Nothing logged, nothing thrown,
 * the help button just went to the wrong site.
 *
 * Checking blank rather than merely undefined is the point — the value
 * arrives through `ARG`/`ENV` in the Dockerfile, and an unset build arg
 * becomes an empty string, not an absent one.
 */
export function requireEnv(names: string[]): Plugin {
  return {
    name: "require-env",
    // Config time, so it fails before anything is compiled.
    config(_config, { mode }) {
      const env = loadEnv(mode, process.cwd(), "VITE_");
      const missing = names.filter((n) => !(env[n] ?? process.env[n] ?? "").trim());
      if (missing.length) {
        throw new Error(
          `Missing required build-time environment ${missing.length > 1 ? "variables" : "variable"}: ${missing.join(", ")}.\n` +
            `These are baked into the client bundle, so an empty one ships as an empty string.\n` +
            `Copy .env.example to .env and fill them in, or pass them as build args.`,
        );
      }
    },
  };
}

/** Required by every build target. */
export const REQUIRED_VITE_ENV = ["VITE_HELP_URL"];
