// Client-safe: how chat attachments are shown to the model.

export interface AttachmentForPrompt {
  id: string;
  file_name: string;
  mime: string;
  page_count: number | null;
  /** Extracted text; null for images. */
  text: string | null;
}

/** Characters of a document's text put into the turn it was attached in. */
export const ATTACHMENT_CHARS_CURRENT = 30_000;
/** …and into later turns, where it is only a reminder of what the file was. */
export const ATTACHMENT_CHARS_HISTORY = 3_000;

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * One text block per attachment. The header carries the id the tools take
 * (`read_attachment`, `import_statement`), and says when the text was cut so
 * the model knows to page on instead of answering from half a document.
 */
export function formatAttachmentBlock(a: AttachmentForPrompt, maxChars: number, visionSent = false): string {
  const pages = a.page_count ? `, ${a.page_count} page${a.page_count === 1 ? "" : "s"}` : "";
  const head = `📎 Attachment id=${a.id} "${a.file_name}" (${a.mime}${pages})`;
  if (a.text == null) {
    return visionSent
      ? `${head}: image, shown below.`
      : `${head}: image. This model cannot see images, so its content is unknown; tell the user.`;
  }
  const text = a.text.trim();
  if (text.length <= maxChars) return `${head}:\n<<<\n${text}\n>>>`;
  return `${head}: first ${maxChars} of ${text.length} characters (call read_attachment with from_char=${maxChars} for more):\n<<<\n${text.slice(0, maxChars)}\n>>>`;
}

/** The user's words, or a marker the system prompt reacts to when there are none. */
export function userTurnText(message: string, blocks: string[]): string {
  const said = message.trim() ? message.trim() : "(The user attached this without saying what to do with it.)";
  return blocks.length ? `${blocks.join("\n\n")}\n\n${said}` : said;
}
