// Client-safe shared types for the AI assistant.

export type ChatRole = "user" | "assistant" | "tool" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** Plain text for user/assistant; serialized tool result for role=tool. */
  text: string;
  /** Action card the assistant wants the user to take, if any. */
  action?: AssistantAction | null;
  created_at: string;
}

export type AssistantActionTarget = {
  label: string;
  /** URL search params for `/add`. */
  search: Record<string, string>;
};

export type AssistantAction = AssistantActionTarget & {
  kind: "open_add";
  /** Second route target shown when the draft conflicts with the active scope. */
  alternate?: AssistantActionTarget;
  /** Optional names let the client localize the two explicit choices. */
  proposed_category_name?: string | null;
  active_scope_name?: string | null;
};

export interface AISettings {
  enabled: boolean;
  base_url: string | null;
  model: string | null;
  /** Whether a token is stored. The token itself is never returned to clients. */
  has_token: boolean;
}

export interface AIConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

/**
 * AI actions that can be bound to a specific connection. Every call site of
 * `resolveEndpoint` names one of these; an action missing here silently
 * takes the highest-priority connection with no way to change that.
 */
export const AI_ACTIONS = [
  "chat",
  "statement_extract",
  "statement_classify",
  "pending_enrich",
  "transcribe",
] as const;
export type AIAction = (typeof AI_ACTIONS)[number];

/** How much real finance data is pasted into the assistant's system prompt. */
export type AIContextLevel = "off" | "compact" | "full" | "xl";

/** How thoroughly a connection's availability is probed. */
export type AIHealthMode = "fast" | "model_listed" | "real";

/** Which probe produced a health result. */
export type AIHealthProbe = "models" | "health" | "chat";

export interface AIEndpoint {
  id: string;
  name: string;
  base_url: string;
  model: string;
  enabled: boolean;
  priority: number;
  /** Amount of recent-activity context sent to this connection. */
  context_level: AIContextLevel;
  /** Model used for speech-to-text (/audio/transcriptions). Empty = no voice. */
  transcribe_model: string | null;
  /** How thoroughly availability is checked for this connection. */
  health_mode: AIHealthMode;
  /** Whether a token is stored. The token itself never leaves the server. */
  has_token: boolean;
}

export interface AIActionBinding {
  action: AIAction;
  endpoint_id: string | null;
  allow_fallback: boolean;
  /** Model to use on the bound connection. Null = the connection's default. */
  model: string | null;
}

export interface AIEndpointHealth {
  id: string;
  ok: boolean;
  latency_ms: number | null;
  error?: string | null;
  /** Which probe answered. */
  probe?: AIHealthProbe;
  /** Endpoint answered but the model/upstream did not. */
  degraded?: boolean;
  /** ISO timestamp of the check (server clock). */
  checked_at?: string;
}

/** Marker prefix for "explicitly selected connection is offline" errors. */
export const AI_ENDPOINT_OFFLINE_PREFIX = "AI_ENDPOINT_OFFLINE:";

export interface AIEndpointOfflinePayload {
  endpoint: { id: string; name: string; model: string };
  error: string;
  alternatives: { id: string; name: string; model: string; available: boolean }[];
}

/** Parse an error message thrown when the chosen connection was unreachable. */
export function parseEndpointOffline(message: string): AIEndpointOfflinePayload | null {
  const i = message.indexOf(AI_ENDPOINT_OFFLINE_PREFIX);
  if (i < 0) return null;
  try {
    return JSON.parse(message.slice(i + AI_ENDPOINT_OFFLINE_PREFIX.length)) as AIEndpointOfflinePayload;
  } catch {
    return null;
  }
}
