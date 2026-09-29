import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { acceptedEncodings, safeJoin, serveStatic } from "../../server/static-files.mjs";

describe("acceptedEncodings", () => {
  const names = (h?: string) => acceptedEncodings(h).map((v) => v.encoding);
  it("prefers brotli, then gzip", () => {
    expect(names("gzip, deflate, br, zstd")).toEqual(["br", "gzip"]);
    expect(names("gzip")).toEqual(["gzip"]);
  });
  it("honours q=0 and *", () => {
    expect(names("br;q=0, gzip")).toEqual(["gzip"]);
    expect(names("*")).toEqual(["br", "gzip"]);
    expect(names("*, br;q=0")).toEqual(["gzip"]);
  });
  it("nothing for identity or no header", () => {
    expect(names("identity")).toEqual([]);
    expect(names(undefined)).toEqual([]);
  });
});

describe("safeJoin", () => {
  it("refuses paths outside the public dir", () => {
    expect(safeJoin("/app/dist/client", "/../../etc/passwd")).toBeNull();
    expect(safeJoin("/app/dist/client", "/%2e%2e/secret")).toBeNull();
    expect(safeJoin("/app/dist/client", "/%E0%A4%A")).toBeNull(); // malformed escape
    expect(safeJoin("/app/dist/client", "/assets/a.js?v=1")).toBe("/app/dist/client/assets/a.js");
  });
});

function fakeRes() {
  const res = {
    status: 0,
    headers: {} as Record<string, string | number>,
    body: undefined as Buffer | undefined,
    writeHead(status: number, headers: Record<string, string | number>) {
      res.status = status;
      res.headers = headers;
    },
    end(body?: Buffer) {
      res.body = body;
    },
  };
  return res;
}

describe("serveStatic", () => {
  const dir = mkdtempSync(join(tmpdir(), "static-"));
  mkdirSync(join(dir, "assets"));
  const js = Buffer.from("console.log('hello');".repeat(200));
  writeFileSync(join(dir, "assets", "app.js"), js);
  writeFileSync(join(dir, "assets", "app.js.br"), brotliCompressSync(js));
  writeFileSync(join(dir, "assets", "app.js.gz"), gzipSync(js));
  writeFileSync(join(dir, "logo.png"), Buffer.from([1, 2, 3]));

  const get = async (url: string, acceptEncoding?: string, method = "GET") => {
    const res = fakeRes();
    const req = { method, url, headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {} };
    const served = await serveStatic(req as never, res as never, dir);
    return { served, res };
  };

  it("sends the brotli copy when accepted, with the original type and cache headers", async () => {
    const { served, res } = await get("/assets/app.js", "gzip, br");
    expect(served).toBe(true);
    expect(res.headers["Content-Encoding"]).toBe("br");
    expect(res.headers["Content-Type"]).toBe("application/javascript; charset=utf-8");
    expect(res.headers["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers.Vary).toBe("Accept-Encoding");
    expect(res.body!.length).toBeLessThan(js.length);
    expect(res.headers["Content-Length"]).toBe(res.body!.length);
  });

  it("falls back to gzip, then to the raw file", async () => {
    expect((await get("/assets/app.js", "gzip")).res.headers["Content-Encoding"]).toBe("gzip");
    const raw = (await get("/assets/app.js")).res;
    expect(raw.headers["Content-Encoding"]).toBeUndefined();
    expect(raw.body!.equals(js)).toBe(true);
  });

  it("never compresses images, answers HEAD without a body, and passes unknown paths on", async () => {
    const png = (await get("/logo.png", "br")).res;
    expect(png.headers["Content-Encoding"]).toBeUndefined();
    expect(png.headers.Vary).toBeUndefined();
    const head = (await get("/assets/app.js", "br", "HEAD")).res;
    expect(head.body).toBeUndefined();
    expect((await get("/transactions")).served).toBe(false);
    expect((await get("/assets/app.js", "br", "POST")).served).toBe(false);
  });
});
