// Runs the game on Newgrounds. There's no ad SDK here so the free chips wheel doesn't show
// The encryption key is meant to ship in the game, it isn't a secret

let ngio = null;
let walletToken = null; // Our own token from the backend, ties the chips to this Newgrounds player
let authCb = null; // Called once the chips are tied to the account, so the wallet can use the server

// The token arrives a moment after boot, once Newgrounds confirms the session
export function ngOnAuth(fn) {
  authCb = fn;
}

// Copied rather than imported to avoid an import loop
function backendHttpOrigin() {
  return String((typeof window !== "undefined" && window.__WS_BACKEND__) || "").replace(/^ws/, "http").replace(/\/api\/ws$/, "");
}

export const ngAvailable = () =>
  typeof window !== "undefined" && !!window.__NG_APP_ID__ && !!(window.Newgrounds && window.Newgrounds.io && window.Newgrounds.io.core);
export const ngUser = () => (ngio && ngio.user) || null;
export const ngWalletToken = () => walletToken;

// Our backend checks the Newgrounds session and sends back a wallet token for this player
// Logged out players have no session, so they stay a guest on free tables
async function bindWallet() {
  try {
    const sessionId = ngio && (ngio.session_id || (ngio.session && ngio.session.id));
    if (!sessionId) return;
    const res = await fetch(`${backendHttpOrigin()}/api/newgrounds-auth`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" }, // Kept simple so the browser skips the preflight check
      body: JSON.stringify({ sessionId }),
    });
    const json = await res.json();
    if (json && json.ok && json.walletToken) {
      walletToken = json.walletToken;
      if (authCb) authCb(); // So the wallet switches to this account's balance on the server
    }
  } catch {
    // Offline, logged out or the backend is down, so they stay a guest
  }
}

// Nothing waits on this and it must never stop the game loading
export function ngBoot() {
  if (!ngAvailable() || ngio) return !!ngio;
  try {
    ngio = new window.Newgrounds.io.core(window.__NG_APP_ID__, window.__NG_ENC_KEY__ || "");
    // Newgrounds hands the game its session, then the play is logged so it counts
    ngio.getValidSession(() => {
      try {
        ngio.callComponent("App.logView", { host: (typeof location !== "undefined" && location.host) || "" });
      } catch {
        // Fine if logging the play fails
      }
      // A valid session means a signed in player, so tie their chips to their Newgrounds account
      if (ngio.user) bindWallet();
    });
    return true;
  } catch {
    ngio = null;
    return false;
  }
}

// Unlocks a Newgrounds medal by its ID. Nothing in the game gives medals yet
export function ngUnlockMedal(id) {
  if (!ngio || !id) return;
  try {
    ngio.callComponent("Medal.unlock", { id }, () => {});
  } catch {
    // No session, or offline
  }
}
