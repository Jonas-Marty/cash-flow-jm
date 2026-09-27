// Server-only: turn an uploaded document into something a model can read.
// Shared by chat attachments and the recurring-rule extractor.

import { decodeTextFile, extractPdfText } from "./statements.server";

export type ReadDocument =
  | { kind: "text"; mime: string; text: string; pages: number | null }
  | { kind: "image"; mime: string };

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|heic|heif)$/i;
const TEXT_EXT = /\.(csv|tsv|txt|md)$/i;

export function isImageFile(fileName: string, mime: string | null | undefined): boolean {
  const m = (mime || "").toLowerCase();
  return m.startsWith("image/") || IMAGE_EXT.test(fileName);
}

export function imageMime(fileName: string, mime: string | null | undefined): string {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return m.split(";")[0];
  const ext = IMAGE_EXT.exec(fileName)?.[1]?.toLowerCase();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext ? `image/${ext}` : "image/png";
}

/**
 * Text for PDFs and plain-text files, a marker for images (the caller sends
 * those to a vision model as they are). A PDF without a text layer throws
 * the same advice the statement import gives.
 */
export async function readDocument(
  fileName: string,
  mime: string | null | undefined,
  bytes: Uint8Array,
): Promise<ReadDocument> {
  const m = (mime || "").toLowerCase();
  if (isImageFile(fileName, m)) return { kind: "image", mime: imageMime(fileName, m) };
  if (m.startsWith("text/") || m.includes("csv") || TEXT_EXT.test(fileName)) {
    return { kind: "text", mime: m || "text/plain", text: decodeTextFile(bytes), pages: null };
  }
  if (m.includes("pdf") || /\.pdf$/i.test(fileName)) {
    const { text, pages } = await extractPdfText(bytes);
    if (text.replace(/--- page \d+ ---/g, "").trim().length < 20) {
      throw new Error(
        "This PDF has no readable text layer (it looks scanned). Upload a photo/screenshot of it instead.",
      );
    }
    return { kind: "text", mime: "application/pdf", text, pages };
  }
  throw new Error(`Unsupported file type: ${mime || fileName}`);
}
