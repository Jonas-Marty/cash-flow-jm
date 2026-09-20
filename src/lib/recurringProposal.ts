import * as z from "zod";
import { amountSchema, isoDate, trimmedNullable } from "@/lib/pendingTransactionSchema";

/**
 * A bill proposal: an outside system (FinReader, reading the phone's
 * notifications) saw a bill and proposes the amount and date for the matching
 * not-yet-posted occurrence of a variable-amount recurring rule. The user
 * still posts it by hand. See architecture.md §3.6.
 */

/**
 * How far before the bill's date an occurrence may lie and still be the one
 * the bill is for. Bills normally arrive ahead of their due date; the grace
 * catches one that arrives a few days late.
 */
export const PROPOSAL_GRACE_DAYS = 7;

export const recurringProposalInputSchema = z.object({
  recurring_rule_id: z.string().uuid(),
  amount: amountSchema,
  /** The bill's date; becomes the transaction date when the user posts. */
  occurred_on: isoDate,
  /** Shown to the user as the provider, e.g. "FinReader". */
  external_source: z.string().trim().min(1).max(120),
  /** Idempotency key, unique per source. */
  external_ref: z.string().trim().min(1).max(200),
  external_info: trimmedNullable(2000),
});

export type RecurringProposalInput = z.infer<typeof recurringProposalInputSchema>;

/** Columns of `recurring_occurrences` that make up a proposal. */
export const PROPOSAL_COLUMNS =
  "proposed_amount, proposed_occurred_on, proposal_source, proposal_ref, proposal_info, proposed_at";

export const CLEARED_PROPOSAL = {
  proposed_amount: null,
  proposed_occurred_on: null,
  proposal_source: null,
  proposal_ref: null,
  proposal_info: null,
  proposed_at: null,
} as const;

function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The occurrence a bill dated `occurredOn` belongs to: the first one, of any
 * status, scheduled no more than [PROPOSAL_GRACE_DAYS] before the bill and no
 * further ahead than one interval of the rule.
 *
 * Any status on purpose: when that first occurrence is already posted, the bill
 * arrived late and has to be refused, not quietly moved to next month.
 */
export function pickOccurrenceForBill<T extends { effective_on: string }>(
  occurrences: T[],
  occurredOn: string,
  intervalMonths: number,
): T | null {
  const from = shiftIsoDate(occurredOn, -PROPOSAL_GRACE_DAYS);
  const until = shiftIsoDate(occurredOn, Math.max(1, intervalMonths) * 31 + PROPOSAL_GRACE_DAYS);
  const inWindow = occurrences
    .filter((o) => o.effective_on >= from && o.effective_on <= until)
    .sort((a, b) => a.effective_on.localeCompare(b.effective_on));
  return inWindow[0] ?? null;
}

/**
 * Whether a proposed amount is far enough from the rule's estimate that the
 * pattern on the phone probably grabbed the wrong figure.
 */
export function proposalDeviates(proposed: number, estimate: number | null | undefined): boolean {
  if (estimate == null || !(estimate > 0)) return false;
  const ratio = proposed / estimate;
  return ratio > 2 || ratio < 0.5;
}
