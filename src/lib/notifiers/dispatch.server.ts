/**
 * Dispatch a transaction-created event to all registered notifiers.
 *
 * Loads the full transaction (plus tags) once, builds the event payload,
 * and fans out to notifiers in parallel. Errors are swallowed/logged —
 * never block the originating insert.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger";
import { webhookNotifier } from "./webhook.server";
import {
  eventNameForSource,
  type Notifier,
  type TransactionCreatedEvent,
  type TransactionEventSource,
  type TransactionPayload,
} from "./types";

const NOTIFIERS: Notifier[] = [webhookNotifier];

function genDeliveryId(): string {
  // Edge runtime exposes crypto.randomUUID
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

async function loadTransaction(txId: string): Promise<TransactionPayload | null> {
  const { data, error } = await supabaseAdmin
    .from("transactions")
    .select(
      "id, occurred_on, amount, destination_amount, type, source_account_id, destination_account_id, category_id, description, note, split_group_id, recurring_rule_id, created_at",
    )
    .eq("id", txId)
    .maybeSingle();
  if (error || !data) {
    log.error({ event: "dispatch.load_failed", txId, err: error?.message });
    return null;
  }
  const { data: tagRows } = await supabaseAdmin
    .from("transaction_tags")
    .select("tag")
    .eq("transaction_id", txId);
  return {
    ...data,
    amount: Number(data.amount),
    destination_amount: data.destination_amount == null ? null : Number(data.destination_amount),
    tags: (tagRows ?? []).map((r: { tag: string }) => r.tag),
  };
}

/**
 * Fire-and-forget. Callers should not await unless they need the completion
 * signal — the dispatcher catches its own errors.
 */
export async function dispatchTransactionCreated(
  userId: string,
  source: TransactionEventSource,
  txId: string,
): Promise<void> {
  try {
    const tx = await loadTransaction(txId);
    if (!tx) return;
    const event: TransactionCreatedEvent = {
      event: eventNameForSource(source),
      delivered_at: new Date().toISOString(),
      delivery_id: genDeliveryId(),
      transaction: tx,
    };
    await Promise.all(
      NOTIFIERS.map((n) =>
        n.deliver(userId, event).catch((e) => {
          log.error({
            event: "notifier.error",
            notifier: n.name,
            err: e instanceof Error ? e.message : String(e),
          });
        }),
      ),
    );
  } catch (e) {
    log.error({ event: "dispatch.unhandled", err: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Variant for bulk recurring runs — accepts multiple tx ids and a single
 * source label.
 */
export async function dispatchTransactionsCreated(
  source: TransactionEventSource,
  rows: Array<{ userId: string; txId: string }>,
): Promise<void> {
  await Promise.all(rows.map((r) => dispatchTransactionCreated(r.userId, source, r.txId)));
}