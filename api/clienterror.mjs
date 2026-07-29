// Saves crash reports sent by the game so we can read them back later
// Takes plain text from any site, the CrazyGames build runs on their domain
import { createStore } from "../store.mjs";

const MAX_STACK = 2000;
let store = null;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!store) store = createStore();

  // Reading the reports back needs the stats key when one is set
  if (req.method === "GET") {
    const token = process.env.STATS_TOKEN;
    const url = new URL(req.url, "http://x");
    if (token && url.searchParams.get("key") !== token) return res.status(401).json({ ok: false, error: "bad key" });
    try {
      const n = Math.min(300, Math.max(1, Number(url.searchParams.get("n")) || 100));
      const errors = await store.readClientErrors(n);
      return res.status(200).json({ ok: true, count: errors.length, errors });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST or GET" });

  try {
    const raw = typeof req.body === "string" ? req.body : req.body ? JSON.stringify(req.body) : await readBody(req);
    const b = JSON.parse(raw || "{}");
    if (!b || typeof b.msg !== "string") return res.status(200).json({ ok: true, stored: 0 });
    const clip = (v, n) => (v == null ? "" : String(v).slice(0, n));
    await store.saveClientError({
      kind: clip(b.kind, 24),
      msg: clip(b.msg, 500),
      src: clip(b.src, 300),
      line: Number(b.line) || 0,
      col: Number(b.col) || 0,
      stack: clip(b.stack, MAX_STACK),
      ua: clip(b.ua, 300),
      at: Number(b.at) || Date.now(),
      seen: new Date().toISOString(),
    });
    res.status(200).json({ ok: true, stored: 1 });
  } catch (e) {
    res.status(200).json({ ok: false }); // A crashing game shouldn't keep retrying
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
    req.on("error", () => resolve(""));
  });
}
