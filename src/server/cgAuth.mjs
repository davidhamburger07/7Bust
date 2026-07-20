// Checks CrazyGames sign in tokens. The browser can't fake the signature
// so the backend can trust who the player is

import { createHash, createPublicKey, createVerify } from "node:crypto";

// Can be changed so tests can use their own key. Live uses the real CrazyGames key
const KEY_URL = process.env.CG_PUBLIC_KEY_URL || "https://sdk.crazygames.com/publicKey.json";
const KEY_TTL_MS = 60 * 60 * 1000; // Also loaded again whenever a check fails

let cachedKey = null;
let cachedAt = 0;

async function publicKey({ force = false } = {}) {
  if (!force && cachedKey && Date.now() - cachedAt < KEY_TTL_MS) return cachedKey;
  const res = await fetch(KEY_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`public key fetch failed: ${res.status}`);
  const { publicKey: pem } = await res.json();
  if (!pem) throw new Error("public key missing from response");
  // CrazyGames sends the key in the older RSA format
  cachedKey = createPublicKey({ key: pem, format: "pem", type: "pkcs1" });
  cachedAt = Date.now();
  return cachedKey;
}

const b64urlToBuf = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

// Only trust what comes out of here, never anything the player sends with the token
export async function verifyUserToken(token, { gameId = process.env.CG_GAME_ID } = {}) {
  if (typeof token !== "string" || token.split(".").length !== 3) throw new Error("malformed token");
  const [h, p, sig] = token.split(".");

  let header;
  try {
    header = JSON.parse(b64urlToBuf(h).toString("utf8"));
  } catch {
    throw new Error("malformed header");
  }
  if (header.alg !== "RS256") throw new Error(`unexpected alg ${header.alg}`); // Never accept unsigned tokens

  const signed = `${h}.${p}`;
  const signature = b64urlToBuf(sig);
  const check = async (force) => {
    const key = await publicKey({ force });
    return createVerify("RSA-SHA256").update(signed).verify(key, signature);
  };
  // A new key looks just like a bad signature, so try once more with a fresh key
  let ok = await check(false).catch(() => false);
  if (!ok) ok = await check(true).catch(() => false);
  if (!ok) throw new Error("bad signature");

  let claims;
  try {
    claims = JSON.parse(b64urlToBuf(p).toString("utf8"));
  } catch {
    throw new Error("malformed payload");
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp < now - 60) throw new Error("token expired"); // Allows for clocks being a bit off
  if (typeof claims.iat === "number" && claims.iat > now + 300) throw new Error("token from the future");
  if (!claims.userId) throw new Error("token has no userId");
  if (gameId && claims.gameId && String(claims.gameId) !== String(gameId)) throw new Error("token is for another game");

  return { userId: String(claims.userId), gameId: claims.gameId ? String(claims.gameId) : null, username: claims.username || null };
}

// Wallets use a hash of the user ID so the raw ID is never saved
export const walletKeyFor = (userId) => createHash("sha256").update(`7bust:${userId}`).digest("hex").slice(0, 32);
