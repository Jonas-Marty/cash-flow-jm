import { describe, expect, it } from "vitest";
import { healthBases } from "./endpointUrls";

describe("healthBases", () => {
  it("also probes the proxy root when the base carries a version prefix", () => {
    // LiteLLM serves /health at the root, /chat/completions under /v1.
    expect(healthBases("https://ai.example.ch/v1")).toEqual([
      "https://ai.example.ch/v1",
      "https://ai.example.ch",
    ]);
  });

  it("returns a single base when there is no version prefix", () => {
    expect(healthBases("http://ollama.local:11434")).toEqual(["http://ollama.local:11434"]);
  });

  it("strips trailing slashes and whitespace before deriving bases", () => {
    expect(healthBases("  https://ai.example.ch/v1//  ")).toEqual([
      "https://ai.example.ch/v1",
      "https://ai.example.ch",
    ]);
  });

  it("handles version prefixes other than v1", () => {
    expect(healthBases("https://host/api/v2")).toEqual(["https://host/api/v2", "https://host/api"]);
  });

  it("does not strip a path segment that merely starts with v", () => {
    expect(healthBases("https://host/vertex")).toEqual(["https://host/vertex"]);
  });
});
