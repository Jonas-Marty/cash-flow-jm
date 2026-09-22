import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashToken } from "@/utils/api-tokens.server";
import { log } from "@/lib/logger";
import {
  pendingTransactionInputSchema,
  normalizePendingTransactionInput,
} from "@/lib/pendingTransactionSchema";
import { isBetterFix, locationFromRow, locationToColumns } from "@/lib/location";
import {
  suggestLocationLabel,
  suggestPlaceFromProximity,
  type LocationHistoryEntry,
} from "@/lib/locationSuggest";
import { enrichPending } from "@/utils/pending.enrich.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function authenticate(request: Request): Promise<{ userId: string } | null> {
  const auth = request.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const raw = auth.slice("Bearer ".length).trim();
  if (!raw) return null;
  const token_hash = hashToken(raw);
  const { data, error } = await supabaseAdmin
    .from("api_tokens")
    .select("id, user_id, revoked_at")
    .eq("token_hash", token_hash)
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  void supabaseAdmin
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  return { userId: data.user_id };
}

/**
 * A phone posts coordinates, never a name — it has no idea it was standing in
 * "Coop Bahnhof". The places the user has already labelled by hand do know, so
 * a row that arrives with a fix borrows a name from them: the nearest place
 * whose description matches, or failing that one that several visits on
 * separate days agree on. Only the name: the coordinates stay as measured, and
 * /pending offers the curated pin itself as a one-tap upgrade.
 *
 * Best-effort — a failed lookup costs the row a label, not its creation.
 */
async function labelFromHistory(
  userId: string,
  fix: { latitude: number; longitude: number; accuracy_m: number | null },
  description: string | null,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("transactions")
    .select(
      "latitude, longitude, location_accuracy_m, location_label, location_source, description, occurred_on",
    )
    .eq("user_id", userId)
    .not("latitude", "is", null)
    .not("location_label", "is", null)
    .order("occurred_on", { ascending: false })
    .limit(200);
  if (error || !data) return null;
  const history: LocationHistoryEntry[] = [];
  for (const row of data) {
    const loc = locationFromRow(row);
    if (loc)
      history.push({
        ...loc,
        description: row.description ?? null,
        occurred_on: row.occurred_on ?? null,
      });
  }
  // A matching description is the better evidence, so it goes first. Failing
  // that, a till the user has stood at on separate days names itself — which is
  // the common case, because terminals mostly send "Kartenzahlung" and the
  // description has nothing to match.
  return (
    suggestLocationLabel(history, fix, description) ??
    suggestPlaceFromProximity(history, fix)?.location.label ??
    null
  );
}

/**
 * Lets a second POST improve the location on a row that already exists.
 *
 * A phone at a till often has no usable fix at the moment the notification
 * fires — indoors, GPS cold, the payment already done. A better reading a few
 * seconds later is real evidence, and the dedup branch used to discard it: it
 * returned the stored row without ever reading the payload.
 *
 * Narrow on purpose:
 *
 * - **Only while the row is still pending.** A confirmed row has already copied
 *   its location into a real transaction; moving it afterwards would leave the
 *   two disagreeing about where the same payment happened. A rejected row is
 *   finished with.
 * - **Only the location.** Amount, description and category are what the user
 *   reviews, and Android redelivers notifications — a second, worse parse of the
 *   same text must never rewrite them.
 * - **Only an improvement.** `isBetterFix` requires a meaningfully tighter
 *   reading, so a redelivery carrying the same coordinates changes nothing.
 *
 * Returns the updated row, or null when nothing was worth changing.
 */
async function refineLocation(
  userId: string,
  existing: {
    id: string;
    status: string;
    description: string | null;
    latitude: number | string | null;
    longitude: number | string | null;
    location_accuracy_m: number | string | null;
    location_label: string | null;
    location_source: string | null;
  },
  payload: ReturnType<typeof normalizePendingTransactionInput>,
) {
  if (existing.status !== "pending") return null;
  const incoming = locationFromRow(payload);
  if (!incoming || !isBetterFix(locationFromRow(existing), incoming)) return null;

  // The stored label, if the server borrowed one, was derived from the fix this
  // one replaces — so it is re-derived rather than carried over. A name the
  // client supplied itself is its own claim and is kept.
  const label =
    payload.location_label ??
    (await labelFromHistory(
      userId,
      {
        latitude: incoming.latitude,
        longitude: incoming.longitude,
        accuracy_m: incoming.accuracy_m,
      },
      existing.description ?? null,
    ));

  const { data, error } = await supabaseAdmin
    .from("pending_transactions")
    .update({
      ...locationToColumns({ ...incoming, label }),
      // The suggestion pass stamps this when it has looked at a row, and the
      // automatic triggers skip anything stamped. Clearing it is what lets the
      // new coordinates actually reach the place matcher.
      suggested_at: null,
    })
    .eq("id", existing.id)
    .eq("user_id", userId)
    .select(SELECT_COLS)
    .single();
  if (error) {
    log.warn({ event: "api.public.pending.refine_error", err: error.message, userId });
    return null;
  }
  log.info({ event: "api.public.pending.location_refined", userId, id: existing.id });
  return data;
}

const SELECT_COLS =
  "id, status, source_account_id, amount, type, occurred_on, destination_account_id, destination_amount, category_id, description, note, external_source, external_ref, external_info, latitude, longitude, location_accuracy_m, location_label, location_source, suggested_description, suggested_category_id, suggested_tags, suggestion_source, suggestion_confidence, suggested_at, confirmed_transaction_id, confirmed_at, rejected_at, reject_reason, created_at, updated_at";

export const Route = createFileRoute("/api/public/pending-transactions")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      GET: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        let q = supabaseAdmin
          .from("pending_transactions")
          .select(SELECT_COLS)
          .eq("user_id", auth.userId)
          .order("created_at", { ascending: false })
          .limit(200);
        if (status === "pending" || status === "confirmed" || status === "rejected") {
          q = q.eq("status", status);
        }
        const externalSource = url.searchParams.get("external_source");
        if (externalSource) q = q.eq("external_source", externalSource);
        // Comma-separated, so a client can ask about a whole batch at once.
        const externalRef = url.searchParams.get("external_ref");
        if (externalRef !== null) {
          const refs = [...new Set(externalRef.split(",").map((r) => r.trim()).filter(Boolean))];
          if (refs.length === 0) return json({ pending_transactions: [] });
          q = q.in("external_ref", refs.slice(0, 200));
        }
        const { data, error } = await q;
        if (error) {
          log.error({ event: "api.public.pending.db_error", err: error.message });
          return json({ error: "Database error" }, 500);
        }
        return json({ pending_transactions: data ?? [] });
      },
      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        const parsed = pendingTransactionInputSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
        }
        const payload = normalizePendingTransactionInput(parsed.data);

        // Verify referenced accounts/category belong to this user.
        const accountIds = [payload.source_account_id, payload.destination_account_id].filter(
          (v): v is string => !!v,
        );
        const { data: accs, error: accErr } = await supabaseAdmin
          .from("accounts")
          .select("id, user_id")
          .in("id", accountIds);
        if (accErr) return json({ error: "Database error" }, 500);
        if (!accs || accs.length !== accountIds.length || accs.some((a) => a.user_id !== auth.userId)) {
          return json({ error: "Account not found" }, 404);
        }
        if (payload.category_id) {
          const { data: cat, error: catErr } = await supabaseAdmin
            .from("categories")
            .select("id, user_id")
            .eq("id", payload.category_id)
            .maybeSingle();
          if (catErr) return json({ error: "Database error" }, 500);
          if (!cat || cat.user_id !== auth.userId) {
            return json({ error: "Category not found" }, 404);
          }
        }

        // Idempotency: if (external_source, external_ref) is supplied and we
        // already have a row, return it instead of duplicating — but let a
        // better fix through first. See refineLocation.
        if (payload.external_source && payload.external_ref) {
          const { data: existing } = await supabaseAdmin
            .from("pending_transactions")
            .select(SELECT_COLS)
            .eq("user_id", auth.userId)
            .eq("external_source", payload.external_source)
            .eq("external_ref", payload.external_ref)
            .maybeSingle();
          if (existing) {
            const refined = await refineLocation(auth.userId, existing, payload);
            // Same fire-and-forget as a fresh insert: the new coordinates only
            // become a place suggestion once the pass has run against them, and
            // the phone must not wait for that.
            if (refined && !refined.category_id) {
              void enrichPending(auth.userId).catch((e: unknown) =>
                log.warn({
                  event: "api.public.pending.enrich_failed",
                  userId: auth.userId,
                  err: String(e),
                }),
              );
            }
            return json(
              {
                pending_transaction: refined ?? existing,
                deduplicated: true,
                location_updated: !!refined,
              },
              200,
            );
          }
        }

        // Only when the device gave a point and nothing to call it.
        const label =
          payload.latitude != null && payload.longitude != null && !payload.location_label
            ? await labelFromHistory(
                auth.userId,
                {
                  latitude: payload.latitude,
                  longitude: payload.longitude,
                  accuracy_m: payload.location_accuracy_m ?? null,
                },
                payload.description ?? null,
              )
            : null;

        const { data: ins, error: insErr } = await supabaseAdmin
          .from("pending_transactions")
          .insert({ ...payload, location_label: label ?? payload.location_label, user_id: auth.userId })
          .select(SELECT_COLS)
          .single();
        if (insErr) {
          log.error({ event: "api.public.pending.insert_error", err: insErr.message, userId: auth.userId });
          return json({ error: "Internal server error" }, 500);
        }
        // Category suggestions are filled in behind the response so the phone
        // never waits on a model. The pass also drains rows left over from
        // earlier, when no AI connection was reachable.
        if (!ins.category_id) {
          void enrichPending(auth.userId).catch((e: unknown) =>
            log.warn({
              event: "api.public.pending.enrich_failed",
              userId: auth.userId,
              err: String(e),
            }),
          );
        }
        return json({ pending_transaction: ins }, 201);
      },
      DELETE: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        const externalSource = url.searchParams.get("external_source");
        const externalRef = url.searchParams.get("external_ref");

        let find = supabaseAdmin
          .from("pending_transactions")
          .select("id, status")
          .eq("user_id", auth.userId);
        if (id) {
          find = find.eq("id", id);
        } else if (externalSource && externalRef) {
          find = find.eq("external_source", externalSource).eq("external_ref", externalRef);
        } else {
          return json({ error: "Provide id, or external_source and external_ref" }, 400);
        }
        const { data: row, error: findErr } = await find.maybeSingle();
        if (findErr) {
          log.error({ event: "api.public.pending.delete_lookup_error", err: findErr.message });
          return json({ error: "Database error" }, 500);
        }
        if (!row) return json({ error: "Pending transaction not found" }, 404);
        // A confirmed row already produced a real transaction; deleting it here
        // would leave that transaction orphaned, so it has to be undone in the
        // web app first.
        if (row.status === "confirmed") {
          return json({ error: "Pending transaction already confirmed" }, 409);
        }

        const { error: delErr } = await supabaseAdmin
          .from("pending_transactions")
          .delete()
          .eq("id", row.id)
          .eq("user_id", auth.userId);
        if (delErr) {
          log.error({ event: "api.public.pending.delete_error", err: delErr.message, userId: auth.userId });
          return json({ error: "Internal server error" }, 500);
        }
        return json({ deleted: true, id: row.id });
      },
    },
  },
});