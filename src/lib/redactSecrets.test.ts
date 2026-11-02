import { describe, expect, it } from "vitest";
import { isSecretKey, redactSecrets } from "./redactSecrets";

describe("redactSecrets", () => {
  it("blanks credentials", () => {
    for (const k of [
      "api_token",
      "token",
      "access_token",
      "refreshToken",
      "Authorization",
      "api_key",
      "apiKey",
      "client_secret",
      "password",
      "Cookie",
      "set-cookie",
      "id_token_hint",
    ])
      expect(isSecretKey(k), k).toBe(true);
  });

  it("keeps token counts", () => {
    for (const k of [
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "max_tokens",
      "prompt_tokens_details",
      "cached_tokens",
      "reasoning_tokens",
    ])
      expect(isSecretKey(k), k).toBe(false);
  });

  it("walks nested objects and arrays", () => {
    const p = {
      usage: { prompt_tokens: 120, prompt_tokens_details: { cached_tokens: 80 } },
      headers: [{ authorization: "Bearer abc" }],
      nested: { config: { api_token: "sk-1" } },
    };
    redactSecrets(p);
    expect(p.usage).toEqual({ prompt_tokens: 120, prompt_tokens_details: { cached_tokens: 80 } });
    expect(p.headers[0].authorization).toBe("[redacted]");
    expect(p.nested.config.api_token).toBe("[redacted]");
  });
});
