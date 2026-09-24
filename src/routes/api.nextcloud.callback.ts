import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { callbackUrlForHost, exchangeCodeForToken, trimBaseUrl } from "@/utils/nextcloud.server";

// The state nonce is written by startNextcloudOAuth and is only good this long.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function htmlPage(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0b0f17;color:#e6edf3}.card{background:#161b22;padding:32px;border-radius:12px;max-width:480px;text-align:center;border:1px solid #30363d}h1{margin:0 0 12px;font-size:20px}p{margin:8px 0;color:#8b949e}a{color:#58a6ff}</style>
</head><body><div class="card">${body}</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  } as Record<string, string>)[c]!);
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
          return new Response(htmlPage("Nextcloud", `<h1>Authorization cancelled</h1><p>${escapeHtml(errParam)}</p><p><a href="/settings">Back to settings</a></p>`), { status: 400, headers: { "Content-Type": "text/html" } });
        }
        if (!code || !state) {
          return new Response(htmlPage("Nextcloud", `<h1>Missing parameters</h1><p><a href="/settings">Back to settings</a></p>`), { status: 400, headers: { "Content-Type": "text/html" } });
        }
        // No session here: the nonce is what identifies the user. It is looked
        // up and cleared before anything else, so a replayed callback finds nothing.
        const { data: conn, error: cErr } = await supabaseAdmin
          .from("nextcloud_connections")
          .select("user_id, base_url, client_id, client_secret, oauth_state_created_at")
          .eq("oauth_state", state)
          .maybeSingle();
        if (cErr || !conn) {
          return new Response(htmlPage("Nextcloud", `<h1>Invalid or expired state</h1><p>Please retry from the settings page.</p><p><a href="/settings">Back to settings</a></p>`), { status: 400, headers: { "Content-Type": "text/html" } });
        }
        const userId = conn.user_id;
        await supabaseAdmin
          .from("nextcloud_connections")
          .update({ oauth_state: null, oauth_state_created_at: null })
          .eq("user_id", userId);
        const issued = conn.oauth_state_created_at ? new Date(conn.oauth_state_created_at).getTime() : 0;
        if (!(Date.now() - issued <= STATE_MAX_AGE_MS)) {
          return new Response(htmlPage("Nextcloud", `<h1>Invalid or expired state</h1><p>Please retry from the settings page.</p><p><a href="/settings">Back to settings</a></p>`), { status: 400, headers: { "Content-Type": "text/html" } });
        }
        const redirectUri = callbackUrlForHost(url.host);
        try {
          const tok = await exchangeCodeForToken(
            { base_url: trimBaseUrl(conn.base_url), client_id: conn.client_id, client_secret: conn.client_secret },
            code,
            redirectUri,
          );
          const { error: uErr } = await supabaseAdmin
            .from("nextcloud_connections")
            .update({
              access_token: tok.access_token,
              refresh_token: tok.refresh_token,
              token_expires_at: tok.expires_at,
              scope: tok.scope ?? null,
              nextcloud_user: tok.user_id ?? null,
            })
            .eq("user_id", userId);
          if (uErr) throw new Error(uErr.message);
          return new Response(null, { status: 302, headers: { Location: "/settings#nextcloud" } });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(htmlPage("Nextcloud", `<h1>Connection failed</h1><p>${escapeHtml(msg)}</p><p><a href="/settings">Back to settings</a></p>`), { status: 500, headers: { "Content-Type": "text/html" } });
        }
      },
    },
  },
});