// Client-safe: reading what a model can do from provider responses.
// Used by the capability probe and by the chat loop's runtime fallbacks.

/** Does this provider error say the model cannot take tools? */
export function isToolsUnsupportedError(status: number, body: string): boolean {
  return (
    (status === 400 || status === 404 || status === 422 || status === 501) &&
    /\btools?\b|tool_choice|function[ _]call|does not support tool|tool use/i.test(body)
  );
}

/** Does this provider error say the model cannot take images? */
export function isVisionUnsupportedError(status: number, body: string): boolean {
  return (
    (status === 400 || status === 415 || status === 422 || status === 501) &&
    /image|vision|multimodal|multi-modal|image_url|content.*(array|list|type)/i.test(body)
  );
}

/**
 * Tool probe verdict: true/false when the answer is conclusive, null otherwise.
 *
 * A reply cut off by the token limit says nothing: reasoning models spend
 * their budget thinking before they emit the call.
 */
export function parseToolProbe(status: number, body: string): boolean | null {
  if (status >= 200 && status < 300) {
    try {
      const json = JSON.parse(body);
      const choice = json?.choices?.[0];
      const calls = choice?.message?.tool_calls;
      if (Array.isArray(calls) && calls.some((c: { function?: { name?: string } }) => c?.function?.name === "ping")) return true;
      if (choice?.finish_reason === "length") return null;
      // Some models print the call as text instead of emitting tool_calls.
      return false;
    } catch {
      return null;
    }
  }
  return isToolsUnsupportedError(status, body) ? false : null;
}

/** Vision probe verdict: the model must name the colour of a solid red square. */
export function parseVisionProbe(status: number, body: string): boolean | null {
  if (status >= 200 && status < 300) {
    try {
      const choice = JSON.parse(body)?.choices?.[0];
      const text = String(choice?.message?.content ?? "");
      if (/\b(red|rot|rouge|rosso|rojo)\b/i.test(text)) return true;
      return choice?.finish_reason === "length" ? null : false;
    } catch {
      return null;
    }
  }
  return isVisionUnsupportedError(status, body) ? false : null;
}

/** A reply that is nothing but a JSON object or array (optionally fenced). */
export function looksLikeRawJson(text: string): boolean {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!/^[[{]/.test(t) || !/[\]}]$/.test(t)) return false;
  try {
    const v = JSON.parse(t);
    return typeof v === "object" && v !== null;
  } catch {
    return false;
  }
}

/**
 * A reply that spells out a tool call as text instead of emitting
 * `tool_calls` — what models without real tool support tend to do.
 */
export function looksLikeTextToolCall(text: string, toolNames: string[]): boolean {
  const names = toolNames.map((n) => n.replace(/[^a-z0-9_]/gi, "")).join("|");
  return (
    /<\/?tool_call>|<\|?(tool|function)_?call/i.test(text) ||
    new RegExp(`^\\s*\`{0,3}(json)?\\s*\\{\\s*"(name|function|tool)"\\s*:\\s*"(${names})"`, "i").test(text)
  );
}
