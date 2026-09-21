import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Standalone Vitest config so the test runner doesn't depend on the
 * full TanStack/Cloudflare Vite pipeline. Pure helpers in src/lib/**
 * only need the `@/*` path alias and a node environment.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    env: {
      // A fixture, not a default: deliberately unreachable so nothing can
      // mistake it for the real origin. The suite only ever compares URLs
      // against HELP_BASE, so the value itself does not matter — that it is
      // non-empty and absolute does, which is what helpUrl.test.ts asserts.
      VITE_HELP_URL: "https://help.test.invalid",
    },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["src/__tests__/integration/**", "node_modules/**", "dist/**"],
  },
});