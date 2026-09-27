import { describe, expect, it } from "vitest";
import {
  isToolsUnsupportedError,
  isVisionUnsupportedError,
  looksLikeRawJson,
  looksLikeTextToolCall,
  parseToolProbe,
  parseVisionProbe,
} from "@/lib/ai/capabilities";
import { formatAttachmentBlock, userTurnText } from "@/lib/ai/attachmentTurn";

const reply = (message: unknown) => JSON.stringify({ choices: [{ message }] });

describe("parseToolProbe", () => {
  it("true when the model emits the ping call", () => {
    expect(parseToolProbe(200, reply({ tool_calls: [{ function: { name: "ping", arguments: "{}" } }] }))).toBe(true);
  });
  it("false when it answers in text instead", () => {
    expect(parseToolProbe(200, reply({ content: '{"name": "ping"}' }))).toBe(false);
  });
  it("false on an explicit tools rejection (Ollama, vLLM wording)", () => {
    expect(parseToolProbe(400, '{"error":"registry.ollama.ai/library/gemma:2b does not support tools"}')).toBe(false);
    expect(parseToolProbe(400, '{"message":"\\"auto\\" tool choice requires --enable-auto-tool-choice"}')).toBe(false);
  });
  it("unknown when a reasoning model ran out of tokens before calling", () => {
    const cut = JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "" } }] });
    expect(parseToolProbe(200, cut)).toBeNull();
    expect(parseVisionProbe(200, cut)).toBeNull();
  });
  it("unknown on server errors, auth errors and garbage", () => {
    expect(parseToolProbe(500, "upstream timeout")).toBeNull();
    expect(parseToolProbe(401, "unauthorized")).toBeNull();
    expect(parseToolProbe(200, "<html>")).toBeNull();
  });
});

describe("parseVisionProbe", () => {
  it("true when the model names the colour, in any of the app's languages", () => {
    expect(parseVisionProbe(200, reply({ content: "Red." }))).toBe(true);
    expect(parseVisionProbe(200, reply({ content: "Rot" }))).toBe(true);
  });
  it("false when it cannot tell", () => {
    expect(parseVisionProbe(200, reply({ content: "I cannot see images." }))).toBe(false);
  });
  it("false on an image rejection, unknown otherwise", () => {
    expect(parseVisionProbe(400, '{"error":{"message":"Invalid content type. image_url is only supported by certain models."}}')).toBe(false);
    expect(parseVisionProbe(503, "overloaded")).toBeNull();
  });
});

describe("error classifiers", () => {
  it("do not mistake unrelated 400s", () => {
    expect(isToolsUnsupportedError(400, "max_tokens is too large")).toBe(false);
    expect(isVisionUnsupportedError(400, "max_tokens is too large")).toBe(false);
    expect(isToolsUnsupportedError(500, "tools exploded")).toBe(false);
  });
});

describe("looksLikeRawJson", () => {
  it("spots invented JSON replies", () => {
    expect(looksLikeRawJson('{"type": "action", "elements": {"label": "Transaction saved"}}')).toBe(true);
    expect(looksLikeRawJson('```json\n[{"a":1}]\n```')).toBe(true);
  });
  it("leaves prose and prose with JSON inside alone", () => {
    expect(looksLikeRawJson("Das ist die Rechnung von Enertech.")).toBe(false);
    expect(looksLikeRawJson('Use {"a": 1} as body')).toBe(false);
    expect(looksLikeRawJson("{not json}")).toBe(false);
  });
});

describe("looksLikeTextToolCall", () => {
  const names = ["list_recurring_rules", "prepare_recurring_rule"];
  it("spots JSON and tag-style calls", () => {
    expect(looksLikeTextToolCall('{"name": "list_recurring_rules", "arguments": {}}', names)).toBe(true);
    expect(looksLikeTextToolCall('```json\n{"function":"prepare_recurring_rule"}', names)).toBe(true);
    expect(looksLikeTextToolCall("<tool_call>{...}</tool_call>", names)).toBe(true);
  });
  it("leaves normal answers alone", () => {
    expect(looksLikeTextToolCall("Soll ich eine vierteljährliche Regel einrichten?", names)).toBe(false);
    expect(looksLikeTextToolCall('Your rule "list_recurring_rules" …', names)).toBe(false);
  });
});

describe("attachment turns", () => {
  const pdf = { id: "0f3c6b1e-aaaa-bbbb-cccc-000000000001", file_name: "rechnung.pdf", mime: "application/pdf", page_count: 2, text: "Rechnung Q3\nTotal CHF 1'350.00" };

  it("carries the id, name and full text when short", () => {
    const b = formatAttachmentBlock(pdf, 1000);
    expect(b).toContain(`id=${pdf.id}`);
    expect(b).toContain('"rechnung.pdf" (application/pdf, 2 pages)');
    expect(b).toContain("Total CHF 1'350.00");
    expect(b).not.toContain("read_attachment");
  });

  it("says where to continue when cut", () => {
    const b = formatAttachmentBlock({ ...pdf, text: "x".repeat(50) }, 10);
    expect(b).toContain("first 10 of 50 characters");
    expect(b).toContain("from_char=10");
  });

  it("images: shown, or flagged as unseen", () => {
    const img = { ...pdf, file_name: "foto.jpg", mime: "image/jpeg", page_count: null, text: null };
    expect(formatAttachmentBlock(img, 100, true)).toContain("image, shown below");
    expect(formatAttachmentBlock(img, 100, false)).toContain("cannot see images");
  });

  it("an attachment without words gets the marker the system prompt reacts to", () => {
    expect(userTurnText("  ", ["BLOCK"])).toBe("BLOCK\n\n(The user attached this without saying what to do with it.)");
    expect(userTurnText("Import into UBS", ["BLOCK"])).toBe("BLOCK\n\nImport into UBS");
    expect(userTurnText("hi", [])).toBe("hi");
  });
});
