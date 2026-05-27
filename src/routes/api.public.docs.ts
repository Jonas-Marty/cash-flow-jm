import { createFileRoute } from "@tanstack/react-router";

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cash Flow API — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
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