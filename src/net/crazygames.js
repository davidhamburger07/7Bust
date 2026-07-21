// CrazyGames SDK wrapper. Off their domains its calls throw, and this build runs elsewhere too
// So every call goes through here and a throw or missing SDK does nothing

const sdk = () => (typeof window !== "undefined" && window.CrazyGames && window.CrazyGames.SDK) || null;
export const cgAvailable = () => !!sdk();

// Runs an SDK call, ignoring the throw it does off CrazyGames domains
// On crazygames.com the error is shown, or a wrong method name would go unnoticed
const onPlatform = () => typeof location !== "undefined" && /(^|\.)crazygames\.(com|co\.uk)$/i.test(location.hostname);

// v3 has to start before anything touches the SDK, or every call fails quietly
// v2 has no init, so a missing init means it's already ready
let initPromise = null;
export function cgInit() {
  const s = sdk();
  if (initPromise) return initPromise;
  if (!s) return (initPromise = Promise.resolve(false));
  if (typeof s.init !== "function") return (initPromise = Promise.resolve(true));
  initPromise = Promise.resolve()
    .then(() => s.init())
    .then(() => true)
    .catch(() => false); // Not a CrazyGames domain, or the SDK said no
  return initPromise;
}

// Just reading SDK.game, user, data or ad throws off the platform and before init
// So a plain if check would crash, every access goes through this
function mod(name) {
  try {
    const s = sdk();
    const m = s && s[name];
    return m || null;
  } catch {
    return null;
  }
}

async function safe(fn, label = "sdk") {
  const s = sdk();
  if (!s) return null;
  await cgInit(); // Nothing can touch the SDK before this is done
  try {
    return await fn(s);
  } catch (e) {
    if (onPlatform()) console.warn(`[7bust] CrazyGames SDK call "${label}" failed:`, e && e.message ? e.message : e);
    return null; // Never break the game over analytics
  }
}

// Older SDKs name the loading calls differently, so use whichever exists
// Without them CrazyGames measures the whole download for size
const callFirst = (s, names) => {
  for (const n of names) if (typeof s.game[n] === "function") return s.game[n]();
  throw new Error(`none of ${names.join("/")} exist on SDK.game`);
};
export const cgLoadingStart = () => safe((s) => callFirst(s, ["loadingStart", "sdkGameLoadingStart"]), "loadingStart");
export const cgLoadingStop = () => safe((s) => callFirst(s, ["loadingStop", "sdkGameLoadingStop"]), "loadingStop");

// gameplayStart and gameplayStop decide when ads can show, so only send real changes
let playing = false;
export function cgSetPlaying(active) {
  if (active === playing) return;
  playing = active;
  safe((s) => (active ? s.game.gameplayStart() : s.game.gameplayStop()));
}
export const cgHappytime = () => safe((s) => s.game.happytime());

// Tells CrazyGames our room and if friends can still join, this replaced the old invite button
// Only sends changes, this runs on every render
let roomSig = null;
export function cgUpdateRoom(roomId, isJoinable) {
  if (!roomId) return;
  const sig = `${roomId}:${isJoinable ? 1 : 0}`;
  if (sig === roomSig) return;
  roomSig = sig;
  safe((s) => s.game.updateRoom({ roomId, isJoinable: !!isJoinable, inviteParams: { roomId } }));
}
export function cgLeftRoom() {
  if (roomSig === null) return;
  roomSig = null;
  safe((s) => s.game.leftRoom());
}
// Room code the player was invited to, or null
export const cgGetInviteRoom = () => safe((s) => s.game.getInviteParam("roomId"));

// Invite accepted with the game already open, the platform calls this instead of reloading
// Uses the same retry as settings, it isn't there until init is done
export function cgOnJoinRoom(fn) {
  let tries = 0;
  const attempt = () => {
    try {
      const s = sdk();
      if (!s || typeof s.game.addJoinRoomListener !== "function") return false;
      s.game.addJoinRoomListener((params) => {
        const roomId = params && (params.roomId || params.roomName);
        if (roomId) fn(String(roomId));
      });
      return true;
    } catch {
      return false;
    }
  };
  if (attempt()) return;
  const t = setInterval(() => {
    if (attempt() || ++tries > 30) clearInterval(t);
  }, 500);
}

// CrazyGames can launch straight into multiplayer with ?instantJoin=true
// Check the URL too, it can be read before init is done
export function cgInstantMultiplayer() {
  try {
    if (new URLSearchParams(location.search).get("instantJoin") === "true") return true;
  } catch {
    // No location to read
  }
  const s = sdk();
  try {
    const g = mod("game");
    return !!(g && g.isInstantMultiplayer);
  } catch {
    return false; // Not set up yet, or off the platform
  }
}

// CrazyGames can mute the game and turn chat off, their mute beats our sound settings
// Also read from the URL, the SDK starts late and one early read can miss it
function urlFlag(name) {
  try {
    const v = new URLSearchParams(location.search).get(name);
    return v === "" || v === "true" || v === "1";
  } catch {
    return false;
  }
}

export function cgSettings() {
  const forcedMute = urlFlag("muteAudio");
  const forcedChat = urlFlag("disableChat");
  try {
    const s = sdk();
    const g = mod("game");
    const v = g && g.settings;
    // Either one saying mute wins, nothing here turns sound back on
    return { muteAudio: forcedMute || !!(v && v.muteAudio), disableChat: forcedChat || !!(v && v.disableChat) };
  } catch {
    return { muteAudio: forcedMute, disableChat: forcedChat };
  }
}
// Adding the listener fails until the SDK is ready, so keep trying until it works
// Give up after about 15 seconds, by then there's no SDK
export function cgOnSettings(fn) {
  let tries = 0;
  const attempt = () => {
    // Even reading .game throws off the platform, so the whole check sits in the try
    try {
      const s = sdk();
      if (!s || typeof s.game.addSettingsChangeListener !== "function") return false;
      s.game.addSettingsChangeListener(fn);
      return true;
    } catch {
      return false; // Not ready, or not a CrazyGames domain
    }
  };
  if (attempt()) return;
  const t = setInterval(() => {
    if (attempt() || ++tries > 30) clearInterval(t);
  }, 500);
}

// Rewarded ads only resolve when watched to the end, a skipped or missing one pays nothing
// Midgame ads are just a break, callers carry on either way
function requestAd(type, { onStart, onEnd } = {}) {
  const s = sdk();
  if (!s || !mod("ad")) return Promise.reject(new Error("no-ad"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (onEnd) onEnd();
      fn(arg);
    };
    try {
      s.ad.requestAd(type, {
        adStarted: () => onStart && onStart(),
        adFinished: () => done(resolve),
        adError: (e) => done(reject, e || new Error("ad-error")),
      });
    } catch (e) {
      if (onEnd) onEnd();
      reject(e); // Blocked domains throw straight away
    }
    // Give up if the SDK never calls back
    setTimeout(() => done(reject, new Error("ad-timeout")), 45000);
  });
}

export const cgRewardedAd = (opts) => requestAd("rewarded", opts);
export const cgMidgameAd = (opts) => requestAd("midgame", opts);

// Accounts only exist on CrazyGames itself, everywhere else players use the guest wallet
// In SDK v2 isUserAccountAvailable is an async function, not a true or false, both are handled
let accountsCached = null;
export async function cgAccountsAvailable() {
  if (accountsCached !== null) return accountsCached;
  const s = sdk();
  if (!s || !mod("user")) return (accountsCached = false);
  try {
    const v = s.user.isUserAccountAvailable;
    accountsCached = !!(typeof v === "function" ? await v.call(s.user) : v);
  } catch {
    accountsCached = false; // Off the platform the SDK throws instead of answering
  }
  return accountsCached;
}
// Last known answer for code that can't wait
// False until checked, so we never offer a sign in that can't work
export const cgAccountsKnown = () => accountsCached === true;
export const cgGetUser = () => safe((s) => s.user.getUser());

// Signed token our backend checks, guests don't have one
// The SDK refreshes it, so just ask for a new one each time
export async function cgUserToken() {
  const s = sdk();
  if (!s || !mod("user")) return null;
  try {
    return (await s.user.getUserToken()) || null;
  } catch {
    return null; // Not signed in
  }
}

// CrazyGames sign in box, gives the user or null if they close it
export async function cgSignIn() {
  const s = sdk();
  if (!s || !mod("user")) return null;
  try {
    return (await s.user.showAuthPrompt()) || null;
  } catch {
    return null;
  }
}

// Lets the wallet switch over straight away when a player signs in mid-game
export function cgOnAuth(fn) {
  safe((s) => s.user.addAuthListener(fn));
}
