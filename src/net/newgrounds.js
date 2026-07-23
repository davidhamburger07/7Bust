// Runs the game on Newgrounds. There's no ad SDK here so the free chips wheel doesn't show
// The encryption key is meant to ship in the game, it isn't a secret

let ngio = null;

export const ngAvailable = () =>
  typeof window !== "undefined" && !!window.__NG_APP_ID__ && !!(window.Newgrounds && window.Newgrounds.io && window.Newgrounds.io.core);
export const ngUser = () => (ngio && ngio.user) || null;

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
