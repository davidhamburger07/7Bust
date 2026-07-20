// Builds the CrazyGames upload zip with only the files that run in the browser
// Checks the build before zipping, including their size and file count limits

import { cp, mkdir, readFile, rm, stat, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const OUT_DIR = join(ROOT, "build");
const STAGE = join(OUT_DIR, "crazygames");
const ZIP = join(OUT_DIR, "7bust-crazygames.zip");

const INCLUDE = ["index.html", "src", join("audio", "Voicelines"), join("audio", "Casino-1.mp3")];

const MAX_TOTAL_MB = 250;
const MAX_FILES = 1500;
const MAX_INITIAL_MB = 50; // Ours is far under this, the audio loads when it is needed

const mb = (bytes) => bytes / 1024 / 1024;
const fmt = (bytes) => `${mb(bytes).toFixed(2)} MB`;

// Our own zip writer, Compress-Archive uses backslashes in paths
// Linux unzips those as odd file names and every asset breaks after upload
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const ALREADY_COMPRESSED = /\.(mp3|mp4|m4a|ogg|png|jpe?g|webp|gif|woff2?|zip)$/i;

async function writeZip(entries, outPath) {
  const parts = [];
  const central = [];
  const now = new Date();
  const time = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() / 2) & 31);
  const date = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
  let offset = 0;

  for (const e of entries) {
    const data = await readFile(e.path);
    const crc = crc32(data);
    const packed = ALREADY_COMPRESSED.test(e.name) ? null : deflateRawSync(data, { level: 9 });
    const deflated = packed && packed.length < data.length;
    const body = deflated ? packed : data;
    const method = deflated ? 8 : 0;
    const name = Buffer.from(e.name, "utf8"); // Always uses forward slashes

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // Names are unicode
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(0, 38); // External file attributes
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + body.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  await writeFile(outPath, Buffer.concat([...parts, cdBuf, eocd]));
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function main() {
  console.log("Building the CrazyGames bundle…\n");

  for (const rel of INCLUDE) {
    if (!existsSync(join(ROOT, rel))) {
      console.error(`MISSING required path: ${rel}`);
      process.exit(1);
    }
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });
  for (const rel of INCLUDE) {
    await cp(join(ROOT, rel), join(STAGE, rel), { recursive: true });
    console.log(`  + ${rel}`);
  }

  const html = await readFile(join(STAGE, "index.html"), "utf8");
  const problems = [];
  if (!/sdk\.crazygames\.com/.test(html)) problems.push("index.html is missing the CrazyGames SDK script tag");
  const backend = /__WS_BACKEND__\s*=\s*"([^"]*)"/.exec(html);
  if (!backend || !backend[1]) problems.push("window.__WS_BACKEND__ is empty, multiplayer would not reach the server from their CDN");
  else if (!/^wss:\/\//.test(backend[1])) problems.push(`window.__WS_BACKEND__ should be a wss:// URL (got "${backend[1]}")`);
  if (/(src|href)="\//.test(html)) problems.push("index.html uses an absolute path, CrazyGames requires relative paths");

  const files = await walk(STAGE);
  let total = 0;
  const sizes = [];
  for (const f of files) {
    const s = await stat(f);
    total += s.size;
    sizes.push({ f: relative(STAGE, f), s: s.size });
  }
  if (mb(total) > MAX_TOTAL_MB) problems.push(`bundle is ${fmt(total)}, over the ${MAX_TOTAL_MB}MB limit`);
  if (files.length > MAX_FILES) problems.push(`${files.length} files, over the ${MAX_FILES}-file limit`);

  // index.html sits at the top of the zip and paths use forward slashes
  await writeZip(
    files.map((f) => ({ path: f, name: relative(STAGE, f).split(/[\\/]/).join("/") })),
    ZIP
  );

  const zipSize = (await stat(ZIP)).size;
  console.log(`\n  ${files.length} files, ${fmt(total)} uncompressed`);
  console.log("  largest:");
  sizes.sort((a, b) => b.s - a.s).slice(0, 5).forEach((x) => console.log(`    ${fmt(x.s).padStart(10)}  ${x.f}`));
  console.log(`\n  limits: ${fmt(total)} / ${MAX_TOTAL_MB}MB total · ${files.length} / ${MAX_FILES} files · initial download stays well under ${MAX_INITIAL_MB}MB (audio streams on demand)`);
  console.log(`  backend: ${backend ? backend[1] : "(none)"}`);
  console.log(`\n  ZIP: ${ZIP}  (${fmt(zipSize)})`);

  if (problems.length) {
    console.log("\nPROBLEMS:");
    problems.forEach((p) => console.log(`  ✗ ${p}`));
    process.exit(1);
  }
  console.log("\nAll checks passed, ready to upload.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
