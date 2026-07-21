// Runs the game inside Discord. Off Discord every call here does nothing

let sdk = null;
let user = null;
let ready = false;

export const discordAvailable = () => typeof window !== "undefined" && !!window.__DISCORD_CLIENT_ID__;
export const discordReady = () => ready;
export const discordUser = () => user;
export const discordInstanceId = () => (sdk ? sdk.instanceId : null);

// Room codes skip I, O, 0 and 1 as they're hard to read out
// Hashing the Discord instance puts everyone in it at the same table
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function roomCodeFor(instanceId) {
  let h = 0x811c9dc5;
  const s = String(instanceId || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[h % CODE_ALPHABET.length];
    h = Math.floor(h / CODE_ALPHABET.length) || Math.imul(h ^ (i + 1), 0x01000193) >>> 0;
  }
  return out;
}

// Returns false off Discord so callers can just wait on it and carry on
// Never throws, a broken SDK shouldn't cost the player the game
export async function discordBoot() {
  if (!discordAvailable()) return false;
  try {
    const boot = window.__DISCORD_SDK__;
    if (!boot || !boot.DiscordSDK) return false;
    const { DiscordSDK, patchUrlMappings } = boot;

    // 1. Set up the proxy before anything opens a connection
    const backend = String(window.__WS_BACKEND__ || "");
    const host = backend.replace(/^wss?:\/\//, "").split("/")[0];
    if (host) patchUrlMappings([{ prefix: "/backend", target: host }], { patchFetch: true, patchWebSocket: true, patchXhr: true });

    sdk = new DiscordSDK(window.__DISCORD_CLIENT_ID__);
    await sdk.ready();
    ready = true;

    // 3. Sign in. The browser only gets a short code, the backend swaps it for a token
    // so nothing in here can fake who the player is
    try {
      const { code } = await sdk.commands.authorize({
        client_id: window.__DISCORD_CLIENT_ID__,
        response_type: "code",
        state: "",
        prompt: "none",
        scope: ["identify"],
      });
      const res = await fetch(`${backendHttpOrigin()}/api/discord-auth`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" }, // Kept simple so the browser skips the preflight check
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (json && json.ok && json.access_token) {
        const auth = await sdk.commands.authenticate({ access_token: json.access_token });
        if (auth && auth.user) user = { id: auth.user.id, username: auth.user.global_name || auth.user.username };
      }
    } catch {
      // The player said no or sign in isn't there, so they play as a guest
    }

    // Phones play this in portrait, landscape doesn't fit the other players on screen
    try {
      const O = boot.Orientation;
      if (O && sdk.commands.setOrientationLockState) {
        await sdk.commands.setOrientationLockState({ lock_state: O.PORTRAIT, picture_in_picture_lock_state: O.UNLOCKED, grid_lock_state: O.UNLOCKED });
      }
    } catch {
      // Fails on older Discord apps or when it isn't a phone
    }
    return true;
  } catch {
    ready = false;
    return false; // Discord failing should never stop the game loading
  }
}

// Copied rather than imported so this file works on its own
function backendHttpOrigin() {
  const backend = String(window.__WS_BACKEND__ || "");
  return backend.replace(/^ws/, "http").replace(/\/api\/ws$/, "");
}

// What Discord shows other people in the channel about this player
export async function discordSetActivity(details, state) {
  if (!ready || !sdk) return;
  try {
    await sdk.commands.setActivity({ activity: { type: 0, details: String(details).slice(0, 128), state: String(state).slice(0, 128) } });
  } catch {
    // Presence is just for show, a failure doesn't matter
  }
}

export async function discordInvite() {
  if (!ready || !sdk) return false;
  try {
    await sdk.commands.openInviteDialog();
    return true;
  } catch {
    return false;
  }
}
