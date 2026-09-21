// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // The preset ships importProtection with `files: ["**/server/**"]`, which
  // matches nothing in this repo — there is no src/server/ directory and all
  // twelve server modules use the *.server.ts convention. Verified: a client
  // route importing @/utils/ai.server built clean under the preset's pattern
  // and shipped the AI tool definitions into dist/client. This pattern denies
  // it, names the import chain, and exits 1.
  //
  // Verified on the node target's build and on `vite dev`, which uses this
  // file. The Workers build could not be completed where this was written
  // (node_modules/.nitro is root-owned from an earlier container build and
  // vite cannot clear it) — it fails identically without this change, and
  // gets past the transform stage with it, so the guard is not the cause.
  tanstackStart: {
    importProtection: {
      behavior: "error",
      client: {
        files: ["**/*.server.ts", "**/*.server.tsx"],
        specifiers: ["server-only"],
      },
    },
  },
});
