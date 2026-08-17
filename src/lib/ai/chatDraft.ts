// Ephemeral, module-level draft state for the non-persisted assistant chat.
// Survives unmounts (e.g. closing the assistant sidebar) for the browser session.

export type DraftMsg = {
  role: "user" | "assistant";
  text: string;
  action?: unknown;
  importId?: string;
  usage?: unknown;
};

export interface ChatDraft {
  messages: DraftMsg[];
  input: string;
  file: File | null;
  endpointId: string;
  accountId: string;
}

const draft: ChatDraft = {
  messages: [],
  input: "",
  file: null,
  endpointId: "auto",
  accountId: "",
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
  draft.file = null;
}
