/**
 * Notifier interface — pluggable outbound delivery (webhooks today, Gotify etc. later).
 *
 * A Notifier receives a NotificationEvent and is responsible for fanning it
 * out to whatever channels it owns (e.g. all of the user's webhooks).
 */

export type TransactionEventSource = "manual" | "recurring" | "api";

export type TransactionEventName =
  | "transaction.created.manual"
  | "transaction.created.recurring"
  | "transaction.created.api";

export interface TransactionPayload {
  id: string;
  occurred_on: string;
  amount: number;
  destination_amount: number | null;
  type: string;
  source_account_id: string | null;
  destination_account_id: string | null;
  category_id: string | null;
  description: string | null;
  note: string | null;
  tags: string[];
  split_group_id: string | null;
  recurring_rule_id: string | null;
  created_at: string;
}

export interface TransactionCreatedEvent {
  event: TransactionEventName;
  delivered_at: string;
  delivery_id: string;
  transaction: TransactionPayload;
}

export interface Notifier {
  name: string;
  deliver(userId: string, event: TransactionCreatedEvent): Promise<void>;
}

export function eventNameForSource(source: TransactionEventSource): TransactionEventName {
  switch (source) {
    case "manual": return "transaction.created.manual";
    case "recurring": return "transaction.created.recurring";
    case "api": return "transaction.created.api";
  }
}