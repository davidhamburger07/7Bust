// A token our backend gives out once it has checked a Discord or Newgrounds login
// Without the secret set nothing is signed, so those players just stay guests

import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.WALLET_SECRET || "";
const TTL_S = 24 * 60 * 60; // The game signs in again on its next load

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function signSession({ platform, uid, username = null }) {
  if (!SECRET || !platform || uid == null) return null;
  const body = b64url(
    JSON.stringify({
      p: String(platform),
      uid: String(uid),
      name: username ? String(username).slice(0, 64) : null,
      exp: Math.floor(Date.now() / 1000) + TTL_S,
    }),
  );
  const mac = b64url(createHmac("sha256", SECRET).update(body).digest());
  return `${body}.${mac}`;
}

// Only trust what comes out of here, never anything the player sends with the token
export function verifySession(token) {
  if (!SECRET) throw new Error("WALLET_SECRET not set");
  if (typeof token !== "string" || !token.includes(".")) throw new Error("malformed session token");
  const dot = token.lastIndexOf(".");
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", SECRET).update(body).digest());
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("bad session signature");
  let claims;
  try {
    claims = JSON.parse(unb64url(body).toString("utf8"));
  } catch {
    throw new Error("malformed session payload");
  }
  if (typeof claims.exp === "number" && claims.exp < Math.floor(Date.now() / 1000)) throw new Error("session expired");
  if (!claims.p || !claims.uid) throw new Error("session missing identity");
  return { platform: String(claims.p), uid: String(claims.uid), username: claims.name || null };
}
