/**
 * Build/version information.
 *
 * The VITE_* values are injected at build time (see Dockerfile build args).
 * When they are missing (local dev), we fall back to a "dev" marker.
 */
const env = import.meta.env as Record<string, string | undefined>;

export const APP_VERSION = env.VITE_APP_VERSION || "dev";
export const APP_COMMIT = env.VITE_APP_COMMIT || "";
export const APP_BUILD_TIME = env.VITE_APP_BUILD_TIME || "";

export const APP_COMMIT_SHORT = APP_COMMIT ? APP_COMMIT.slice(0, 7) : "";

/** e.g. "1.4.2 (a1b2c3d)" or "dev" */
export function formatVersion(version = APP_VERSION, commit = APP_COMMIT_SHORT) {
  return commit ? `${version} (${commit})` : version;
}
