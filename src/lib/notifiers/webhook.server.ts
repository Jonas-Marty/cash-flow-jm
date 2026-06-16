/**
 * Webhook notifier — POSTs the event JSON to each active webhook URL the
 * user has registered. In-process retry loop (no queue): up to 3 attempts
 * with 1s / 4s backoff, 10s timeout per attempt.
 *
 * Every attempt is logged to stdout (structured JSON) and the final outcome
 * per webhook is written to public.audit_logs (action='custom').
 *
 * SERVER-ONLY — imports the service-role supabaseAdmin client.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger";
import type { Notifier, TransactionCreatedEvent } from "./types";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 4000];
const TIMEOUT_MS = 10_000;

interface WebhookRow {
  id: string;
  name: string;
  url: string;
  auth_header_name: string | null;
  auth_header_value: string | null;
  events: string[];
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function deliverOne(userId: string, wh: WebhookRow, event: TransactionCreatedEvent): Promise<void> {
  const body = JSON.stringify(event);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (wh.auth_header_name && wh.auth_header_value) {
    headers[wh.auth_header_name] = wh.auth_header_value;
  }

  let lastStatus: number | null = null;
  let lastError: string | null = null;
  let attempts = 0;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    attempts = i + 1;
    const started = Date.now();
    try {
      const res = await fetchWithTimeout(wh.url, { method: "POST", headers, body }, TIMEOUT_MS);
      const durationMs = Date.now() - started;
      lastStatus = res.status;
      if (res.ok) {
        log.info({
          event: "webhook.delivery",
          webhookId: wh.id,
          webhookName: wh.name,
          eventName: event.event,
          deliveryId: event.delivery_id,
          attempt: attempts,
          status: res.status,
          durationMs,
          ok: true,
        });
        await writeAudit(userId, wh, event, { ok: true, status: res.status, attempts, durationMs });
        return;
      }
      lastError = `HTTP ${res.status}`;
      log.warn({
        event: "webhook.delivery",
        webhookId: wh.id,
        webhookName: wh.name,
        eventName: event.event,
        deliveryId: event.delivery_id,
        attempt: attempts,
        status: res.status,
        durationMs,
        ok: false,
      });
    } catch (err) {
      const durationMs = Date.now() - started;
      lastError = err instanceof Error ? err.message : String(err);
      log.warn({
        event: "webhook.delivery",
        webhookId: wh.id,
        webhookName: wh.name,
        eventName: event.event,
        deliveryId: event.delivery_id,
        attempt: attempts,
        durationMs,
        err: lastError,
        ok: false,
      });
    }
    if (i < MAX_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
  }

  log.error({
    event: "webhook.delivery.failed",
    webhookId: wh.id,
    webhookName: wh.name,
    eventName: event.event,
    deliveryId: event.delivery_id,
    attempts,
    status: lastStatus ?? undefined,
    err: lastError,
  });
  await writeAudit(userId, wh, event, { ok: false, status: lastStatus, attempts, error: lastError });
}

async function writeAudit(
  userId: string,
  wh: WebhookRow,
  event: TransactionCreatedEvent,
  outcome: { ok: boolean; status: number | null; attempts: number; durationMs?: number; error?: string | null },
) {
  try {
    await supabaseAdmin.from("audit_logs").insert({
      user_id: userId,
      action: "custom",
      table_name: "webhooks",
      row_id: wh.id,
      diff: null,
      metadata: {
        kind: "webhook.delivery",
        webhook_name: wh.name,
        url: wh.url,
        auth_header_name: wh.auth_header_name, // value never logged
        event: event.event,
        delivery_id: event.delivery_id,
        transaction_id: event.transaction.id,
        ok: outcome.ok,
        status: outcome.status,
        attempts: outcome.attempts,
        duration_ms: outcome.durationMs ?? null,
        error: outcome.error ?? null,
      },
    });
  } catch (e) {
    log.error({ event: "webhook.audit.write_failed", err: e instanceof Error ? e.message : String(e) });
  }
}

export const webhookNotifier: Notifier = {
  name: "webhook",
  async deliver(userId: string, event: TransactionCreatedEvent): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from("webhooks")
      .select("id, name, url, auth_header_name, auth_header_value, events")
      .eq("user_id", userId)
      .eq("active", true);
    if (error) {
      log.error({ event: "webhook.list_failed", err: error.message, userId });
      return;
    }
    const matches = (data ?? []).filter((w) => (w.events ?? []).includes(event.event));
    await Promise.all(matches.map((w) => deliverOne(userId, w as WebhookRow, event).catch((e) => {
      log.error({ event: "webhook.deliver.unexpected", err: e instanceof Error ? e.message : String(e) });
    })));
  },
};