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
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["src/__tests__/integration/**", "node_modules/**", "dist/**"],
  },
});