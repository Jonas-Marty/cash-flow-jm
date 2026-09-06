// Client-safe URL helpers for OpenAI-compatible endpoints.

/**
 * Bases to look for a provider `/health` endpoint on.
 *
 * OpenAI-compatible base URLs usually end in a version prefix ("/v1"), but the
 * health route often does not live under it — LiteLLM, for one, serves
 * `/health` at the proxy root while chat completions sit under `/v1`. Returns
 * the base itself first, then the version-stripped parent when there is one.
 */
export function healthBases(base: string): string[] {
  const trimmed = base.trim().replace(/\/+$/, "");
  const stripped = trimmed.replace(/\/v\d+$/, "");
  return stripped !== trimmed && stripped !== "" ? [trimmed, stripped] : [trimmed];
}
