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
export const AI_ACTIONS = ["chat", "statement_extract"] as const;
export type AIAction = (typeof AI_ACTIONS)[number];

export interface AIEndpoint {
  id: string;
  name: string;
  base_url: string;
  model: string;
  enabled: boolean;
  priority: number;
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
}