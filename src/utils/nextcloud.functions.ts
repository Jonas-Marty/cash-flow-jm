import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/client-auth-middleware";
import { getRequestHost } from "@tanstack/react-start/server";
import { downloadFile, getValidConnection, searchFiles, trimBaseUrl } from "./nextcloud.server";

const urlSchema = z.string().url().max(500);

function originFromHost(): string {
  const host = getRequestHost();
  // Assume https in deployed envs; localhost fallback.
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${proto}://${host}`;
}

export const getNextcloudStatus = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("nextcloud_connections")
      .select("base_url, nextcloud_user, token_expires_at, access_token, scope")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      configured: !!data,
      connected: !!(data?.access_token),
      base_url: data?.base_url ?? null,
      nextcloud_user: data?.nextcloud_user ?? null,
      scope: data?.scope ?? null,
    };
  });

export const saveNextcloudConfig = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: { base_url: string; client_id: string; client_secret: string }) =>
    z.object({
      base_url: urlSchema,
      client_id: z.string().min(1).max(200),
      client_secret: z.string().min(1).max(500),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const base_url = trimBaseUrl(data.base_url);
    const { error } = await supabase
      .from("nextcloud_connections")
      .upsert(
        { user_id: userId, base_url, client_id: data.client_id, client_secret: data.client_secret },
        { onConflict: "user_id" }
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const disconnectNextcloud = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("nextcloud_connections").delete().neq("user_id", "00000000-0000-0000-0000-000000000000");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Returns an authorize URL to open in the browser. We pass the user id in `state`
 * so the callback (which has no Supabase session) can know which user just connected.
 * The state is signed (HMAC) to prevent forging.
 */
export const startNextcloudOAuth = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("nextcloud_connections")
      .select("base_url, client_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Please save Nextcloud URL and OAuth credentials first.");
    const origin = originFromHost();
    const redirectUri = `${origin}/api/nextcloud/callback`;
    const { signState } = await import("./nextcloud.state.server");
    const state = signState(userId);
    const authUrl = `${trimBaseUrl(data.base_url)}/apps/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(data.client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    return { authUrl };
  });

export const searchNextcloud = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: { query: string }) => z.object({ query: z.string().trim().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const conn = await getValidConnection(userId);
    const results = await searchFiles(conn, data.query, 25);
    return { results };
  });

/** Download a Nextcloud file (base64) so it can be attached to the assistant chat. */
export const downloadNextcloudFile = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: { path: string }) => z.object({ path: z.string().min(1).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    const conn = await getValidConnection(context.userId);
    return await downloadFile(conn, data.path);
  });