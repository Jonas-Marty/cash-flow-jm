import { createFileRoute } from "@tanstack/react-router";

/**
 * Swagger UI is loaded from a CDN, pinned and integrity-checked.
 *
 * This page is unauthenticated, served from our own origin, and sets
 * `persistAuthorization`, so a reader's API token sits in browser storage
 * while it is open. A floating `@5` tag meant unpkg could have served any
 * script it liked into that context. Pinning an exact version and giving
 * the browser a hash to verify means a substituted file simply fails to
 * load instead of running.
 *
 * Bumping the version means recomputing both hashes:
 *   curl -sL https://unpkg.com/swagger-ui-dist@<v>/<file> \
 *     | openssl dgst -sha384 -binary | openssl base64 -A
 */
const SWAGGER_UI_VERSION = "5.33.0";
const SWAGGER_UI_CSS_SRI =
  "sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW";
const SWAGGER_UI_JS_SRI =
  "sha384-YDALVcy8kj8yltLBVi1vBiBAUqdxvus673gM8XKwiy6aDUJFXivF/KCufekjYbVf";

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cash Flow API — Swagger UI</title>
  <link
    rel="stylesheet"
    href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css"
    integrity="${SWAGGER_UI_CSS_SRI}"
    crossorigin="anonymous"
  />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script
    src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js"
    integrity="${SWAGGER_UI_JS_SRI}"
    crossorigin="anonymous"
  ></script>
  <script>
    window.addEventListener('load', () => {
      window.ui = SwaggerUIBundle({
        url: '/api/public/openapi',
        dom_id: '#swagger-ui',
        deepLinking: true,
        persistAuthorization: true,
      });
    });
  </script>
</body>
</html>`;

/**
 * Swagger UI for the public API. Loads the spec from /api/public/openapi.
 */
export const Route = createFileRoute("/api/public/docs")({
  server: {
    handlers: {
      GET: async () =>
        new Response(HTML, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          },
        }),
    },
  },
});