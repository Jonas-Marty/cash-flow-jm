import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readDocument } from "@/utils/documents.server";

const pdf = () => new Uint8Array(readFileSync(new URL("./__fixtures__/invoice-quarterly.pdf", import.meta.url)));

describe("readDocument", () => {
  it("extracts a PDF's text", async () => {
    const doc = await readDocument("rechnung.pdf", "application/pdf", pdf());
    expect(doc.kind).toBe("text");
    expect(doc.kind === "text" && doc.text).toContain("Wohnheimbeitrag Quartal 3");
  });

  // pdf.js detaches the buffer it is handed; the chat stores the same bytes
  // right after reading them, and once stored 0-byte files that way.
  it("leaves the caller's bytes intact", async () => {
    const bytes = pdf();
    const before = bytes.length;
    await readDocument("rechnung.pdf", "application/pdf", bytes);
    expect(before).toBeGreaterThan(100);
    expect(bytes.length).toBe(before);
  });

  it("passes images through and rejects unknown types", async () => {
    expect(await readDocument("foto.JPG", "", new Uint8Array([1, 2, 3]))).toEqual({ kind: "image", mime: "image/jpeg" });
    await expect(readDocument("x.zip", "application/zip", new Uint8Array([1]))).rejects.toThrow(/Unsupported/);
  });
});
