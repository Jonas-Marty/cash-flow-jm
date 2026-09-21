// Build config for the self-hosted Node target (Coolify, plain VMs, etc.).
// The default vite.config.ts targets Cloudflare Workers via the Lovable preset.
// Used by Dockerfile: `vite build --config vite.config.node.ts`.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // The preset ships importProtection with `files: ["**/server/**"]`, which
  // matches nothing in this repo — there is no src/server/ directory and all
  // twelve server modules use the *.server.ts convention. Verified: a client
  // route importing @/utils/ai.server built clean under the preset's pattern
  // and shipped the AI tool definitions into dist/client. This pattern denies
  // it, names the import chain, and exits 1.
  tanstackStart: {
    importProtection: {
      behavior: "error",
      client: {
        files: ["**/*.server.ts", "**/*.server.tsx"],
        specifiers: ["server-only"],
      },
    },
  },

  // Skip the nitro deploy plugin so the SSR bundle targets Node rather than
  // being wrapped for Cloudflare Workers. Spelled `cloudflare: false` until
  // v2 of the preset removed that option; it still worked through a
  // compatibility shim, and warned three times per build.
  nitro: false,
});