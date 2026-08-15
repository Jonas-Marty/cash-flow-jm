import { createFileRoute } from "@tanstack/react-router";
import { APP_VERSION, APP_COMMIT, APP_BUILD_TIME } from "@/lib/version";

/**
 * Public, unauthenticated build info of the running server bundle.
 * Contains no secrets — only the version/commit the container was built from.
 */
export const Route = createFileRoute("/api/public/version")({
  server: {
    handlers: {
      GET: async () => {
        const body = {
          version: process.env.APP_VERSION || APP_VERSION,
          commit: process.env.APP_COMMIT || APP_COMMIT,
          commitShort: (process.env.APP_COMMIT || APP_COMMIT || "").slice(0, 7),
          builtAt: process.env.APP_BUILD_TIME || APP_BUILD_TIME || null,
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
