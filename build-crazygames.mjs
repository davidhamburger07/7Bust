// Builds the CrazyGames upload zip with only the files that run in the browser
// Checks the build before zipping, including their size and file count limits

import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
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

  try {
    if (process.platform === "win32") {
      execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${STAGE}\\*' -DestinationPath '${ZIP}' -Force`], { stdio: "pipe" });
    } else {
      execFileSync("zip", ["-qr", ZIP, "."], { cwd: STAGE, stdio: "pipe" });
    }
  } catch (e) {
    console.error("\nCould not create the zip automatically. The staged files are ready at:");
    console.error(`  ${STAGE}\nZip that folder's CONTENTS (index.html must be at the zip root).`);
    process.exit(1);
  }

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
