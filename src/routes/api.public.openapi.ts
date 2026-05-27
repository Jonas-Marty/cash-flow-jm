import { createFileRoute } from "@tanstack/react-router";
import { openApiSpec } from "@/lib/openapi-spec";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Serves the OpenAPI 3.1 specification for the public REST API as YAML.
 * Unauthenticated — the spec itself contains no secrets.
 */
export const Route = createFileRoute("/api/public/openapi")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      GET: async () =>
        new Response(openApiSpec, {
          status: 200,
          headers: {
            "Content-Type": "application/yaml; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            ...corsHeaders,
          },
        }),
    },
  },
});