// Runs the game on GameDistribution, which is only used for ads. Does nothing on other sites
// The page catches the SDK's events before this loads and keeps them until it's ready

let ready = false;
// Set while an ad plays so the music comes back as soon as it ends
let audioPause = null;
let audioResume = null;

export const gdAvailable = () => typeof window !== "undefined" && !!window.__GD_GAME_ID__;
export const gdReady = () => ready;

const gd = () => (typeof window !== "undefined" && window.gdsdk) || null;

function preloadRewarded() {
  const s = gd();
  if (s && typeof s.preloadAd === "function") s.preloadAd("rewarded").catch(() => {});
}

// SDK ready means ads can be asked for, the pause events stop and start the music
function handleEvent(e) {
  if (!e || !e.name) return;
  switch (e.name) {
    case "SDK_READY":
      ready = true;
      preloadRewarded(); // So an ad is ready before the player asks
      break;
    case "SDK_GAME_PAUSE":
      if (audioPause) audioPause();
      break;
    case "SDK_GAME_START":
      if (audioResume) {
        audioResume();
        audioResume = null; // Cleared after the ad too, so this mustn't run twice
      }
      break;
  }
}

// Also handles any events the SDK sent before this loaded
// Doesn't need waiting on, nothing connects through GameDistribution
export function gdBoot() {
  if (!gdAvailable()) return false;
  try {
    window.__gdHandler = handleEvent;
    const buffered = window.__gdEvents || [];
    window.__gdEvents = [];
    buffered.forEach(handleEvent);
    if (gd()) ready = true; // The SDK may have been ready before this loaded
    return true;
  } catch {
    return false;
  }
}

// type is rewarded for the free chips wheel, or empty for a normal ad
// Same shape as the CrazyGames one so either can be used
async function showAd(type, { onStart, onEnd } = {}) {
  const s = gd();
  if (!s || typeof s.showAd !== "function") throw new Error("no-ad");
  audioPause = onStart || null;
  audioResume = onEnd || null;
  try {
    await (type ? s.showAd(type) : s.showAd());
  } finally {
    if (audioResume) audioResume(); // Turns the sound back on even if the ad never said it ended
    audioPause = null;
    audioResume = null;
  }
}

// Throws on a skip, close or empty slot, so getting past this means the ad was watched
// Doesn't wait for the watch complete event, some SDK builds never send it
export async function gdRewardedAd(opts = {}) {
  await showAd("rewarded", opts);
  preloadRewarded();
}

// Nothing is earned here, so a failed ad doesn't matter
export async function gdMidgameAd(opts = {}) {
  await showAd(undefined, opts);
}
