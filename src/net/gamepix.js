// Runs the game on GamePix, which is only used for ads. Does nothing on other sites

let sdk = null;
let announced = false;

export const gpAvailable = () => typeof window !== "undefined" && !!window.GamePix;
export const gpReady = () => !!sdk && announced;

// Newer SDKs need to be created, older ones are ready to use, so this handles both
function construct() {
  const G = window.GamePix;
  if (!G) return null;
  if (typeof G === "function") {
    try {
      return new G();
    } catch {
      return G;
    }
  }
  return G;
}

// Nothing waits on this and it must never stop the game loading
export function gpBoot() {
  if (!gpAvailable() || sdk) return !!sdk;
  try {
    sdk = construct();
    return !!sdk;
  } catch {
    sdk = null;
    return false;
  }
}

// No ad shows until this is called once, it also hides GamePix's loading screen
export function gpLoaded() {
  if (!sdk || announced) return;
  try {
    if (typeof sdk.loaded === "function") sdk.loaded();
  } catch {
    // Older SDK, or it was already called
  }
  announced = true;
}

// GamePix covers the screen for the ad, so sound is muted before and turned back on after
async function show(method, { onStart, onEnd } = {}) {
  if (!sdk || typeof sdk[method] !== "function") throw new Error("no-ad");
  if (onStart) onStart();
  try {
    return (await sdk[method]()) || {};
  } finally {
    if (onEnd) onEnd();
  }
}

// GamePix only says success on a full watch, so anything else pays nothing
export async function gpRewardedAd(opts = {}) {
  const res = await show("rewardAd", opts);
  if (!res.success) throw new Error("not-rewarded");
}

// Nothing is earned here, so a failed ad doesn't matter
export async function gpMidgameAd(opts = {}) {
  await show("interstitialAd", opts);
}
