// Hands an AI-prepared recurring-rule draft from the chat to the rule editor
// in Settings. Module-level, like chatDraft.ts: it only has to survive the
// navigation, and the sidebar chat can hand over while Settings is already open.

import type { Draft } from "@/lib/recurringDraft";

export interface RuleHandoff {
  draft: Draft;
  warnings: string[];
  notes: string[];
  similar_rule: { id: string; name: string } | null;
  source_file: string | null;
}

let pending: RuleHandoff | null = null;
const listeners = new Set<() => void>();

export function setPendingRuleDraft(h: RuleHandoff): void {
  pending = h;
  for (const l of listeners) l();
}

/** Returns the waiting draft once; later calls get null. */
export function takePendingRuleDraft(): RuleHandoff | null {
  const h = pending;
  pending = null;
  return h;
}

export function subscribePendingRuleDraft(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
