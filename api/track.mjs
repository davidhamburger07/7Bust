// Takes batches of play events from the game and adds them to the stats
// Open to any site and sent as plain text, the CrazyGames build runs on their domain
import { createStore } from "../store.mjs";
import { countersFor } from "../src/engine/analytics.js";

const MAX_BATCH = 50;
let store = null;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  try {
    const raw = typeof req.body === "string" ? req.body : req.body ? JSON.stringify(req.body) : await readBody(req);
    const parsed = JSON.parse(raw || "{}");
    const records = (Array.isArray(parsed) ? parsed : parsed.events || []).slice(0, MAX_BATCH).filter((r) => r && typeof r.event === "string");
    if (!records.length) return res.status(200).json({ ok: true, counted: 0 });

    const fields = {};
    for (const rec of records) {
      for (const [k, v] of Object.entries(countersFor(rec))) fields[k] = (fields[k] || 0) + v;
    }
    if (!store) store = createStore();
    const day = new Date().toISOString().slice(0, 10);
    // Leave out round end records, there are too many of them
    await store.bumpStats(day, fields, records.filter((r) => r.event !== "round_end").slice(0, 10));
    res.status(200).json({ ok: true, counted: records.length });
  } catch (e) {
    res.status(200).json({ ok: false }); // A game shouldn't keep retrying over stats
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
