// Works out the wallet owner whatever site the player signed in on. Throwing means guest
// CrazyGames keeps its old wallet key so existing balances aren't lost

import { createHash } from "node:crypto";
import { verifyUserToken, walletKeyFor } from "./cgAuth.mjs";
import { verifySession } from "./sessionToken.mjs";

const SESSION_PLATFORMS = new Set(["discord", "newgrounds"]);
const platformKey = (platform, uid) => createHash("sha256").update(`7bust:${platform}:${uid}`).digest("hex").slice(0, 32);

// No platform means CrazyGames, so older games that only send a token still work
export async function resolveIdentity({ platform, token } = {}) {
  if (SESSION_PLATFORMS.has(platform)) {
    const s = verifySession(token);
    if (s.platform !== platform) throw new Error("session platform mismatch");
    return { platform, userId: s.uid, username: s.username, key: platformKey(platform, s.uid) };
  }
  // CrazyGames keeps the same check and the same wallet key as before
  const u = await verifyUserToken(token);
  return { platform: "crazygames", userId: u.userId, username: u.username, key: walletKeyFor(u.userId) };
}
