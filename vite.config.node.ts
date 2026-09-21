// Build config for the self-hosted Node target (Coolify, plain VMs, etc.).
// The default vite.config.ts targets Cloudflare Workers via the Lovable preset.
// Used by Dockerfile: `vite build --config vite.config.node.ts`.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Skip the nitro deploy plugin so the SSR bundle targets Node rather than
  // being wrapped for Cloudflare Workers. Spelled `cloudflare: false` until
  // v2 of the preset removed that option; it still worked through a
  // compatibility shim, and warned three times per build.
  nitro: false,
});