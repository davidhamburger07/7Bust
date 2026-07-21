// On CrazyGames progress saves to the player's account so it follows them to other devices
// Saves go to both places, so a session where the SDK fails doesn't open to a wiped save

// These belong to this browser, not the player, so they don't sync to other devices
// Synced, two devices would try to take the same seat
const DEVICE_LOCAL = new Set(["7bust:net", "7bust:cid"]);

// The SDK throws on any site that isn't CrazyGames, so every call is wrapped
function dataModule(key) {
  if (DEVICE_LOCAL.has(key)) return null;
  try {
    const d = typeof window !== "undefined" && window.CrazyGames && window.CrazyGames.SDK && window.CrazyGames.SDK.data;
    return d && typeof d.getItem === "function" ? d : null;
  } catch {
    return null;
  }
}

export function getItem(key) {
  const d = dataModule(key);
  if (d) {
    try {
      const v = d.getItem(key);
      if (v != null) return v;
    } catch {
      // Falls back to the local copy
    }
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // Storage is turned off in private mode or some in-app browsers
  }
}

export function setItem(key, value) {
  const v = String(value);
  const d = dataModule(key);
  if (d) {
    try {
      d.setItem(key, v);
    } catch {
      // Storage full or the SDK failed, the local copy still has it
    }
  }
  try {
    localStorage.setItem(key, v);
  } catch {
    // Storage isn't available, the game still works without it
  }
}

export function removeItem(key) {
  const d = dataModule(key);
  if (d) {
    try {
      d.removeItem(key);
    } catch {
      // Analytics failing never affects the game
    }
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // Analytics failing never affects the game
  }
}
