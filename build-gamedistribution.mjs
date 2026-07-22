// Builds the GameDistribution upload zip
// Their ad SDK loads from their site, everything else is in the zip

import { cp, mkdir, readFile, rm, stat, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const OUT_DIR = join(ROOT, "build");
const STAGE = join(OUT_DIR, "gamedistribution");
const ZIP = join(OUT_DIR, "7bust-gamedistribution.zip");

const INCLUDE = ["src", "fonts", join("audio", "Voicelines"), join("audio", "Casino-1.mp3")];
const EXCLUDE = ["src/server/cgAuth.mjs", "src/server/discordAuth.mjs", "src/engine/profanity.js"];

const BUNDLE_ENTRY = "src/main.js";
const BUNDLE_OUT = "game.js";

const GD_SDK_HOST = "html5.api.gamedistribution.com";
const GD_ID_PLACEHOLDER = "REPLACE_WITH_GD_GAME_ID";

const mb = (b) => b / 1024 / 1024;
const fmt = (b) => `${mb(b).toFixed(2)} MB`;

// Same zip writer the other builds use
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
    const name = Buffer.from(e.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
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
    cd.writeUInt32LE(0, 38);
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
  console.log("Building the GameDistribution bundle…\n");

  for (const rel of ["index.gamedistribution.html", ...INCLUDE]) {
    if (!existsSync(join(ROOT, rel))) {
      console.error(`MISSING required path: ${rel}`);
      process.exit(1);
    }
  }

  await rm(STAGE, { recursive: true, force: true });
  await rm(ZIP, { force: true });
  await mkdir(STAGE, { recursive: true });
  for (const rel of INCLUDE) {
    await cp(join(ROOT, rel), join(STAGE, rel), { recursive: true });
    console.log(`  + ${rel}`);
  }
  await cp(join(ROOT, "index.gamedistribution.html"), join(STAGE, "index.html"));
  console.log("  + index.gamedistribution.html -> index.html");
  for (const rel of EXCLUDE) {
    const p = join(STAGE, rel);
    if (existsSync(p)) {
      await rm(p);
      console.log(`  - ${rel} (backend only)`);
    }
  }

  await esbuild.build({
    entryPoints: [join(STAGE, BUNDLE_ENTRY)],
    bundle: true,
    format: "iife",
    target: "es2020",
    outfile: join(STAGE, BUNDLE_OUT),
    logLevel: "warning",
  });
  console.log(`  = ${BUNDLE_OUT} (${fmt((await stat(join(STAGE, BUNDLE_OUT))).size)})`);

  for (const f of await walk(join(STAGE, "src"))) if (/\.(js|mjs)$/.test(f)) await rm(f);

  let html = await readFile(join(STAGE, "index.html"), "utf8");
  const moduleTag = /<script\s+type="module"\s+src="\.\/src\/main\.js"><\/script>/;
  if (!moduleTag.test(html)) {
    console.error("index.gamedistribution.html no longer has the expected module tag, the bundle swap needs updating");
    process.exit(1);
  }
  html = html.replace(moduleTag, `<script src="./${BUNDLE_OUT}"></script>`);
  await writeFile(join(STAGE, "index.html"), html);
  const problems = [];

  // Their own SDK must be there and no other ad network's
  if (!html.includes(GD_SDK_HOST)) problems.push(`index.html does not load the GameDistribution SDK (${GD_SDK_HOST})`);
  if (/sdk\.crazygames\.com/.test(html)) problems.push("the CrazyGames SDK tag is in index.html, it does not belong on a GameDistribution build");
  if (!/GD_OPTIONS/.test(html)) problems.push("index.html does not define window.GD_OPTIONS");
  if (!/__GD_GAME_ID__/.test(html)) problems.push("index.html does not set window.__GD_GAME_ID__");

  const backend = /__WS_BACKEND__\s*=\s*"([^"]*)"/.exec(html);
  if (!backend || !/^wss:\/\//.test(backend[1] || "")) problems.push("window.__WS_BACKEND__ must be a wss:// URL");
  if (/(src|href)="\//.test(html)) problems.push("index.html uses an absolute path, keep every path relative so it runs from any iframe origin");

  // Every file the stylesheets load must be in the folder
  // The game runs on unknown sites, so outside links are unreliable and missing fonts quietly fall back
  for (const css of (await walk(STAGE)).filter((f) => f.endsWith(".css"))) {
    const rel = relative(STAGE, css).split(/[\\/]/).join("/");
    const dir = rel.split("/").slice(0, -1);
    for (const m of (await readFile(css, "utf8")).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      const spec = m[1].trim();
      if (spec.startsWith("data:")) continue;
      if (/^(https?:)?\/\//.test(spec)) {
        problems.push(`${rel} loads "${spec}" from the network, bundle it instead`);
        continue;
      }
      const parts = [...dir];
      for (const seg of spec.split("/")) {
        if (seg === "." || seg === "") continue;
        else if (seg === "..") parts.pop();
        else parts.push(seg);
      }
      if (!existsSync(join(STAGE, ...parts))) problems.push(`${rel} references "${spec}" but it is not in the bundle`);
    }
  }

  // Check the bundle really has the GameDistribution ad code in it
  const game = await readFile(join(STAGE, BUNDLE_OUT), "utf8");
  for (const [what, needle] of [
    ["the GameDistribution boot", "gdBoot"],
    ["the rewarded-ad path", "gdRewardedAd"],
    ["the platform marker", "__GD_GAME_ID__"],
  ]) {
    if (!game.includes(needle)) problems.push(`${what} is missing from ${BUNDLE_OUT}`);
  }

  const files = await walk(STAGE);
  let total = 0;
  const sizes = [];
  for (const f of files) {
    const s = await stat(f);
    total += s.size;
    sizes.push({ f: relative(STAGE, f), s: s.size });
  }

  await writeZip(
    files.map((f) => ({ path: f, name: relative(STAGE, f).split(/[\\/]/).join("/") })),
    ZIP,
  );

  console.log(`\n  ${files.length} files, ${fmt(total)}`);
  console.log("  largest:");
  sizes.sort((a, b) => b.s - a.s).slice(0, 4).forEach((x) => console.log(`    ${fmt(x.s).padStart(10)}  ${x.f}`));
  console.log(`\n  folder: ${STAGE}`);
  console.log(`  zip:    ${ZIP}  (${fmt((await stat(ZIP)).size)})`);
  console.log(`  backend: ${backend ? backend[1] : "(none)"} (cross-origin WebSocket, allowed from any iframe)`);

  if (problems.length) {
    await rm(ZIP, { force: true });
    console.log("\nPROBLEMS:");
    problems.forEach((p) => console.log(`  ✗ ${p}`));
    console.log("\nThe zip was deleted. Fix the above and build again.");
    process.exit(1);
  }
  console.log("\nAll checks passed.");

  const gameId = (html.match(/__GD_GAME_ID__\s*=\s*"([^"]*)"/) || [])[1] || "";
  const idSet = gameId && gameId !== GD_ID_PLACEHOLDER;
  const todo = [];
  if (!idSet) todo.push(`set window.__GD_GAME_ID__ in index.gamedistribution.html to your GD game id, then rebuild`);
  todo.push("upload build/7bust-gamedistribution.zip on the GameDistribution developer portal (Upload tab)");
  todo.push("turn ON the Rewarded Ads flag for the game, or the FREE CHIPS wheel gets nothing to show");
  todo.push("play through the iframe test, then press Request Activation");
  console.log("\nStill to do:");
  todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  if (idSet) console.log(`\n  (game id baked into the build: ${gameId})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
