// Checks a Discord player by asking Discord who the token belongs to
// Answers are cached briefly so a match doesn't spam the API and a revoked token stops fast

import { createHash } from "node:crypto";

const CACHE_MS = 60 * 1000;
const cache = new Map();

export async function verifyDiscordToken(accessToken) {
  if (typeof accessToken !== "string" || accessToken.length < 8) throw new Error("malformed token");

  const hit = cache.get(accessToken);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;

  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`token rejected (${res.status})`);
  const u = await res.json();
  if (!u || !u.id) throw new Error("no user id on the token");

  const user = { id: String(u.id), username: u.global_name || u.username || null };
  cache.set(accessToken, { at: Date.now(), user });
  // Stops the cache growing forever on a server that stays up a long time
  if (cache.size > 500) for (const k of [...cache.keys()].slice(0, 200)) cache.delete(k);
  return user;
}

// Wallets use a hash of the user ID so the raw ID is never saved
// The discord prefix stops a Discord and a CrazyGames ID sharing a wallet
export const discordWalletKey = (userId) => createHash("sha256").update(`7bust:discord:${userId}`).digest("hex").slice(0, 32);
