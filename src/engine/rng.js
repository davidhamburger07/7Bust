// Fair shuffle the player can check. The server seed's hash is shown before the round
// and the seed itself after, so the player can replay the shuffle and see it wasn't rigged

const enc = new TextEncoder();

function toHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(message) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(message));
  return toHex(new Uint8Array(digest));
}

async function hmacSha256(keyStr, msgStr) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyStr),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msgStr));
  return new Uint8Array(sig);
}

// Same seeds always give the same bytes, more blocks are made as they're needed
export async function makeStream(serverSeed, clientSeed, nonce) {
  let counter = 0;
  let buf = new Uint8Array(0);
  let pos = 0;

  async function refill() {
    buf = await hmacSha256(serverSeed, `${clientSeed}:${nonce}:${counter}`);
    counter += 1;
    pos = 0;
  }

  async function nextByte() {
    if (pos >= buf.length) await refill();
    return buf[pos++];
  }

  async function nextUint32() {
    let v = 0;
    for (let i = 0; i < 4; i++) v = v * 256 + (await nextByte());
    return v >>> 0;
  }

  // Random whole number below n without bias, retries the rare values that would skew it
  async function randBelow(n) {
    const limit = Math.floor(0x100000000 / n) * n;
    let x;
    do {
      x = await nextUint32();
    } while (x >= limit);
    return x % n;
  }

  return { nextByte, nextUint32, randBelow };
}

export function randomSeedHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}
