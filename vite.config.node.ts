// Build config for the self-hosted Node target (Coolify, plain VMs, etc.).
// The default vite.config.ts targets Cloudflare Workers via the Lovable preset.
// Used by Dockerfile: `vite build --config vite.config.node.ts`.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Disable the Cloudflare Workers plugin so the SSR bundle targets Node.
  cloudflare: false,
});