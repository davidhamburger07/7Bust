// Swaps a Discord login code for an access token
// Done here because it needs the client secret, which can't live in the browser
import { verifyDiscordToken } from "../src/server/discordAuth.mjs";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ ok: false, error: "DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET are not set" });
  }

  let body = {};
  try {
    const raw = typeof req.body === "string" ? req.body : req.body ? JSON.stringify(req.body) : await readBody(req);
    body = JSON.parse(raw || "{}");
  } catch {
    return res.status(400).json({ ok: false, error: "bad body" });
  }
  if (!body.code) return res.status(400).json({ ok: false, error: "no code" });

  try {
    const r = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: String(body.code),
      }),
    });
    if (!r.ok) return res.status(401).json({ ok: false, error: "code rejected by Discord" });
    const { access_token } = await r.json();
    if (!access_token) return res.status(401).json({ ok: false, error: "no access token returned" });

    // Check the token really belongs to someone before saying ok
    const who = await verifyDiscordToken(access_token);
    return res.status(200).json({ ok: true, access_token, user: { id: who.id, username: who.username } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
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
