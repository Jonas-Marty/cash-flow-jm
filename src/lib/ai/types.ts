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