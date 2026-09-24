import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/client-auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { getRequestHost } from "@tanstack/react-start/server";
import { callbackUrlForHost, downloadFile, listFolder, searchFiles, trimBaseUrl } from "./nextcloud.server";

// nextcloud_connections is server-only: the browser has no grant on it, so
// every function here uses the service role and filters by the caller's id.

const kindSchema = z.enum(["receipt", "statement", "any"]).default("any");

export const getNextcloudStatus = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("nextcloud_connections")
      .select("base_url, client_id, client_secret, nextcloud_user, access_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const connected = !!data?.access_token;
    return {
      configured: !!data,
      connected,
      // Once connected, then tokens dropped: renewal was refused or the app
      // login was revoked in Nextcloud. Distinct from "never connected".
      lost: !!data && !connected && !!data.nextcloud_user,
      // Whether the stored credentials are complete, so the form can leave
      // the fields empty and say they are kept. Never the values themselves.
      has_credentials: !!(data?.client_id && data?.client_secret),
      base_url: data?.base_url ?? null,
      nextcloud_user: data?.nextcloud_user ?? null,
    };
  });

export const saveNextcloudConfig = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: { base_url: string; client_id?: string; client_secret?: string }) =>
    z
      .object({
        base_url: z.string().url().max(500),
        // Empty means "keep what is stored".
        client_id: z.string().trim().max(200).optional(),
        client_secret: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const base_url = trimBaseUrl(data.base_url);
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("nextcloud_connections")
      .select("base_url, client_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);

    if (!existing) {
      if (!data.client_id || !data.client_secret) throw new Error("Client ID and client secret are required.");
      const { error } = await supabaseAdmin.from("nextcloud_connections").insert({
        user_id: userId,
        base_url,
        client_id: data.client_id,
        client_secret: data.client_secret,
      });
      if (error) throw new Error(error.message);
      return { ok: true, reconnect: true };
    }

    const patch: Database["public"]["Tables"]["nextcloud_connections"]["Update"] = { base_url };
    if (data.client_id) patch.client_id = data.client_id;
    if (data.client_secret) patch.client_secret = data.client_secret;
    // Tokens belong to one server and one app login. Pointing at another
    // makes them meaningless, and keeping them would show "connected" to a
    // server that never granted anything.
    const changed = existing.base_url !== base_url || (!!data.client_id && existing.client_id !== data.client_id);
    if (changed) {
      Object.assign(patch, { access_token: null, refresh_token: null, token_expires_at: null, nextcloud_user: null });
    }
    const { error } = await supabaseAdmin.from("nextcloud_connections").update(patch).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true, reconnect: changed };
  });

export const disconnectNextcloud = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await supabaseAdmin.from("nextcloud_connections").delete().eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Returns the Nextcloud authorize URL. `state` is a random nonce stored on the
 * user's row; the callback, which has no session, finds the user by it and
 * clears it, so it works once and needs no signing secret.
 */
export const startNextcloudOAuth = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("nextcloud_connections")
      .select("base_url, client_id, client_secret")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Please save the Nextcloud URL and OAuth credentials first.");
    if (!data.client_id || !data.client_secret) throw new Error("Please enter the client ID and client secret first.");
    const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const { error: upErr } = await supabaseAdmin
      .from("nextcloud_connections")
      .update({ oauth_state: state, oauth_state_created_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    if (upErr) throw new Error(upErr.message);
    const redirectUri = callbackUrlForHost(getRequestHost());
    const authUrl = `${trimBaseUrl(data.base_url)}/apps/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(data.client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    return { authUrl };
  });

export const searchNextcloud = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: { query: string; kind?: "receipt" | "statement" | "any" }) =>
    z.object({ query: z.string().trim().min(1).max(200), kind: kindSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    return { results: await searchFiles(context.userId, data.query, data.kind, 25) };
  });

export const listNextcloudFolder = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: { path: string; kind?: "receipt" | "statement" | "any" }) =>
    z.object({ path: z.string().max(1000), kind: kindSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    return await listFolder(context.userId, data.path, data.kind);
  });

/** Download a Nextcloud file (base64) so it can be attached to the assistant chat. */
export const downloadNextcloudFile = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: { path: string }) => z.object({ path: z.string().min(1).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    const f = await downloadFile(context.userId, data.path);
    return { name: f.name, mime: f.mime, base64: Buffer.from(f.bytes).toString("base64") };
  });
