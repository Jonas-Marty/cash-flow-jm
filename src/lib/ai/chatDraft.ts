// Ephemeral, module-level draft state for the non-persisted assistant chat.
// Survives unmounts (e.g. closing the assistant sidebar) for the browser session.

export type DraftMsg = {
  role: "user" | "assistant";
  text: string;
  action?: unknown;
  importId?: string;
  attachments?: unknown;
  notices?: unknown;
  usage?: unknown;
};

export interface ChatDraft {
  messages: DraftMsg[];
  input: string;
  /** Files staged for the next message. */
  files: File[];
  endpointId: string;
}

const draft: ChatDraft = {
  messages: [],
  input: "",
  files: [],
  endpointId: "auto",
};

export function getChatDraft(): ChatDraft {
  return draft;
}

export function setChatDraft<K extends keyof ChatDraft>(key: K, value: ChatDraft[K]) {
  draft[key] = value;
}

export function resetChatDraft() {
  draft.messages = [];
  draft.input = "";
  draft.files = [];
}
