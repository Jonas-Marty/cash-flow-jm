import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { exchangeCodeForToken, trimBaseUrl } from "@/utils/nextcloud.server";
import { verifyState } from "@/utils/nextcloud.state.server";

function htmlPage(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0b0f17;color:#e6edf3}.card{background:#161b22;padding:32px;border-radius:12px;max-width:480px;text-align:center;border:1px solid #30363d}h1{margin:0 0 12px;font-size:20px}p{margin:8px 0;color:#8b949e}a{color:#58a6ff}</style>
</head><body><div class="card">${body}</div></body></html>`;
}

export const Route = createFileRoute("/api/nextcloud/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const errParam = url.searchParams.get("error");
        if (errParam) {
          return new Response(htmlPage("Nextcloud", `<h1>Authorization cancelled</h1><p>${errParam}</p><p><a href="/settings">Back to settings</a></p>`), { status: 400, headers: { "Content-Type": "text/html" } });
        }
        if (!code || !state) {
          return new Response(htmlPage("Nextcloud", `<h1>Missing parameters</h1><p><a href="/settings">Back to settings</a></p>`), { status: 400, headers: { "Content-Type": "text/html" } });
        }
        const verified = verifyState(state);
        if (!verified) {
          return new Response(htmlPage("Nextcloud", `<h1>Invalid or expired state</h1><p>Please retry from the settings page.</p><p><a href="/settings">Back to settings</a></p>`), { status: 400, headers: { "Content-Type": "text/html" } });
        }
        const userId = verified.userId;
        const { data: conn, error: cErr } = await supabaseAdmin
          .from("nextcloud_connections")
          .select("base_url, client_id, client_secret")
          .eq("user_id", userId)
          .maybeSingle();
        if (cErr || !conn) {
          return new Response(htmlPage("Nextcloud", `<h1>No connection record</h1><p><a href="/settings">Back to settings</a></p>`), { status: 400, headers: { "Content-Type": "text/html" } });
        }
        const origin = `${url.protocol}//${url.host}`;
        const redirectUri = `${origin}/api/nextcloud/callback`;
        try {
          const tok = await exchangeCodeForToken(
            { base_url: trimBaseUrl(conn.base_url), client_id: conn.client_id, client_secret: conn.client_secret },
            code,
            redirectUri,
          );
          const expires_at = new Date(Date.now() + (tok.expires_in - 30) * 1000).toISOString();
          const { error: uErr } = await supabaseAdmin
            .from("nextcloud_connections")
            .update({
              access_token: tok.access_token,
              refresh_token: tok.refresh_token,
              token_expires_at: expires_at,
              scope: tok.scope ?? null,
              nextcloud_user: tok.user_id ?? null,
            })
            .eq("user_id", userId);
          if (uErr) throw new Error(uErr.message);
          return new Response(htmlPage("Nextcloud", `<h1>Connected ✓</h1><p>You can close this tab.</p><p><a href="/settings">Back to settings</a></p>`), { status: 200, headers: { "Content-Type": "text/html" } });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(htmlPage("Nextcloud", `<h1>Connection failed</h1><p>${msg.replace(/[<>]/g, "")}</p><p><a href="/settings">Back to settings</a></p>`), { status: 500, headers: { "Content-Type": "text/html" } });
        }
      },
    },
  },
});