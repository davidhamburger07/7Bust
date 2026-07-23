// Checks a Newgrounds session on the server, then gives that player our own wallet token
// If anything is wrong it fails and the player stays on the guest wallet
import { signSession } from "../src/server/sessionToken.mjs";

const GATEWAY = "https://newgrounds.io/gateway_v3.php";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  const appId = process.env.NG_APP_ID;
  if (!appId) return res.status(401).json({ ok: false, error: "NG_APP_ID not set" });

  let body = {};
  try {
    const raw = typeof req.body === "string" ? req.body : req.body ? JSON.stringify(req.body) : await readBody(req);
    body = JSON.parse(raw || "{}");
  } catch {
    return res.status(400).json({ ok: false, error: "bad body" });
  }
  const sessionId = body.sessionId;
  if (!sessionId || typeof sessionId !== "string") return res.status(400).json({ ok: false, error: "no sessionId" });

  try {
    const input = { app_id: appId, session_id: sessionId, call: { component: "App.checkSession", parameters: {} } };
    const form = new FormData();
    form.append("input", JSON.stringify(input));
    const r = await fetch(GATEWAY, { method: "POST", body: form });
    if (!r.ok) return res.status(401).json({ ok: false, error: "gateway error" });
    const j = await r.json();

    // One call comes back as an object, but allow a list just in case
    const result = Array.isArray(j && j.result) ? j.result[0] : j && j.result;
    const session = result && result.data && result.data.session;
    const ok = j && j.success && result && result.data && result.data.success && session && !session.expired && session.user && session.user.id != null;
    if (!ok) return res.status(401).json({ ok: false, error: "session not valid" });

    const uid = String(session.user.id);
    const name = session.user.name || null;
    const walletToken = signSession({ platform: "newgrounds", uid, username: name });
    return res.status(200).json({ ok: true, user: { id: uid, name }, walletToken });
  } catch (e) {
    return res.status(401).json({ ok: false, error: String((e && e.message) || e) });
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
