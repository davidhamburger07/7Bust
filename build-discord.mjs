// Builds the Discord Activity folder to deploy, plus a zip
// Discord blocks outside requests, so everything is bundled and the server goes through their proxy

import { cp, mkdir, readFile, rm, stat, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const OUT_DIR = join(ROOT, "build");
const STAGE = join(OUT_DIR, "discord");
const ZIP = join(OUT_DIR, "7bust-discord.zip");

const INCLUDE = ["src", "fonts", join("audio", "Voicelines"), join("audio", "Casino-1.mp3")];
const EXCLUDE = ["src/server/cgAuth.mjs", "src/server/discordAuth.mjs", "src/engine/profanity.js"];

const BUNDLE_ENTRY = "src/main.js";
const BUNDLE_OUT = "game.js";
const SDK_OUT = "discord-sdk.js";

const mb = (b) => b / 1024 / 1024;
const fmt = (b) => `${mb(b).toFixed(2)} MB`;

// Same zip writer the CrazyGames build uses
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
  console.log("Building the Discord Activity…\n");

  for (const rel of ["index.discord.html", ...INCLUDE]) {
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
  await cp(join(ROOT, "index.discord.html"), join(STAGE, "index.html"));
  console.log("  + index.discord.html -> index.html");
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

  // Bundles the Discord SDK instead of loading it from a CDN
  // Discord blocks outside requests, so the game would never know it's in an Activity
  const sdkEntry = join(OUT_DIR, "_discord-sdk-entry.js");
  await writeFile(
    sdkEntry,
    [
      'import { DiscordSDK, patchUrlMappings, Orientation, Events } from "@discord/embedded-app-sdk";',
      "window.__DISCORD_SDK__ = { DiscordSDK, patchUrlMappings, Orientation, Events };",
      "",
    ].join("\n"),
  );
  await esbuild.build({
    entryPoints: [sdkEntry],
    bundle: true,
    format: "iife",
    target: "es2020",
    outfile: join(STAGE, SDK_OUT),
    logLevel: "warning",
    absWorkingDir: ROOT,
  });
  await rm(sdkEntry, { force: true });
  console.log(`  = ${SDK_OUT} (${fmt((await stat(join(STAGE, SDK_OUT))).size)})`);

  // Vercel serves this repo as it is, so the copy at the root gets refreshed here too
  // Building it in one place keeps the hosted Activity and the folder the same
  await cp(join(STAGE, SDK_OUT), join(ROOT, SDK_OUT));
  console.log(`  = ${SDK_OUT} refreshed at the repo root (for the Vercel deployment)`);

  for (const f of await walk(join(STAGE, "src"))) if (/\.(js|mjs)$/.test(f)) await rm(f);

  let html = await readFile(join(STAGE, "index.html"), "utf8");
  const moduleTag = /<script\s+type="module"\s+src="\.\/src\/main\.js"><\/script>/;
  if (!moduleTag.test(html)) {
    console.error("index.discord.html no longer has the expected module tag, the bundle swap needs updating");
    process.exit(1);
  }
  html = html.replace(moduleTag, `<script src="./${BUNDLE_OUT}"></script>`);
  await writeFile(join(STAGE, "index.html"), html);
  const problems = [];

  if (/sdk\.crazygames\.com/.test(html)) {
    problems.push("the CrazyGames SDK tag is still in index.html, Discord's CSP would block it");
  }
  if (!/__DISCORD_CLIENT_ID__/.test(html)) problems.push("index.html does not set window.__DISCORD_CLIENT_ID__");
  if (/REPLACE_WITH_DISCORD_APPLICATION_ID/.test(html)) {
    console.log("\n  ! __DISCORD_CLIENT_ID__ is still the placeholder, set your application id before deploying");
  }
  const backend = /__WS_BACKEND__\s*=\s*"([^"]*)"/.exec(html);
  if (!backend || !/^wss:\/\//.test(backend[1] || "")) problems.push("window.__WS_BACKEND__ must be a wss:// URL");
  if (/(src|href)="\//.test(html)) problems.push("index.html uses an absolute path, keep every path relative");

  // Every file the stylesheets load must be in the folder
  // Outside links are blocked here and a missing font quietly falls back
  for (const css of (await walk(STAGE)).filter((f) => f.endsWith(".css"))) {
    const rel = relative(STAGE, css).split(/[\\/]/).join("/");
    const dir = rel.split("/").slice(0, -1);
    for (const m of (await readFile(css, "utf8")).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      const spec = m[1].trim();
      if (spec.startsWith("data:")) continue;
      if (/^(https?:)?\/\//.test(spec)) {
        problems.push(`${rel} loads "${spec}" from the network, Discord will block it`);
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

  // Check the bundle really has the Discord code in it
  const game = await readFile(join(STAGE, BUNDLE_OUT), "utf8");
  for (const [what, needle] of [
    ["the Discord boot", "discordBoot"],
    ["the instance-to-room mapping", "roomCodeFor"],
    ["joinOrCreate", "joinOrCreate"],
  ]) {
    if (!game.includes(needle)) problems.push(`${what} is missing from ${BUNDLE_OUT}`);
  }
  const sdkJs = await readFile(join(STAGE, SDK_OUT), "utf8");
  for (const needle of ["patchUrlMappings", "DiscordSDK"]) {
    if (!sdkJs.includes(needle)) problems.push(`${SDK_OUT} does not contain ${needle}`);
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
  console.log(`  backend: ${backend ? backend[1] : "(none)"} (reached via /backend through Discord's proxy)`);

  if (problems.length) {
    await rm(ZIP, { force: true });
    console.log("\nPROBLEMS:");
    problems.forEach((p) => console.log(`  ✗ ${p}`));
    console.log("\nThe zip was deleted. Fix the above and build again.");
    process.exit(1);
  }
  console.log("\nAll checks passed.");
  // Only list what's still left to do, a list of done steps stops getting read
  const clientId = (html.match(/__DISCORD_CLIENT_ID__\s*=\s*"([^"]*)"/) || [])[1] || "";
  const todo = [];
  if (!/^\d{17,20}$/.test(clientId)) {
    todo.push("set window.__DISCORD_CLIENT_ID__ in index.discord.html to your application id");
  }
  todo.push("Activities -> URL Mappings: map prefix  /backend  ->  7-bust-cg.vercel.app");
  todo.push("set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in the backend environment");
  console.log("\nStill to do in the Discord developer portal / Vercel:");
  todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  if (clientId) console.log(`\n  (client id baked into the build: ${clientId})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
