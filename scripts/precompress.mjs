// Write Brotli (.br) and gzip (.gz) copies of the client build so the Node
// server can send them compressed (server/static-files.mjs).
//
//   node scripts/precompress.mjs dist/client
//
// Runs once per image build (Dockerfile). The main bundle is ~1.5 MB of
// JavaScript; compressed it is about a quarter of that, which is most of the
// first-visit download on a phone. Uses node:zlib only.
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const COMPRESSIBLE = new Set([".js", ".mjs", ".css", ".html", ".json", ".svg", ".map", ".txt"]);
const MIN_BYTES = 1024;

const root = process.argv[2];
if (!root) {
  console.error("usage: node scripts/precompress.mjs <dir>");
  process.exit(2);
}

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(p);
    else if (entry.isFile()) yield p;
  }
}

let count = 0;
let before = 0;
let afterBr = 0;
for await (const file of files(root)) {
  if (!COMPRESSIBLE.has(extname(file).toLowerCase())) continue;
  if ((await stat(file)).size < MIN_BYTES) continue;
  const raw = await readFile(file);
  const br = brotliCompressSync(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });
  const gz = gzipSync(raw, { level: 9 });
  // A variant that is not smaller is not worth serving.
  if (br.length < raw.length) await writeFile(`${file}.br`, br);
  if (gz.length < raw.length) await writeFile(`${file}.gz`, gz);
  count++;
  before += raw.length;
  afterBr += Math.min(br.length, raw.length);
}
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`precompressed ${count} files: ${kb(before)} → ${kb(afterBr)} (brotli)`);
