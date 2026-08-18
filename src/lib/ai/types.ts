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

export type AssistantAction =
  | {
      kind: "open_add";
      label: string;
      /** URL search params for `/add`. */
      search: Record<string, string>;
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

/** AI actions that can be bound to a specific connection. */
export const AI_ACTIONS = ["chat", "statement_extract", "transcribe"] as const;
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