// CrazyGames SDK wrapper. Off their domains its calls throw, and this build runs elsewhere too
// So every call goes through here and a throw or missing SDK does nothing

const sdk = () => (typeof window !== "undefined" && window.CrazyGames && window.CrazyGames.SDK) || null;
export const cgAvailable = () => !!sdk();

// Runs an SDK call, ignoring the throw it does off CrazyGames domains
async function safe(fn) {
  const s = sdk();
  if (!s) return null;
  try {
    return await fn(s);
  } catch {
    return null; // Blocked domain or an SDK error, never break the game
  }
}

export const cgLoadingStart = () => safe((s) => s.game.sdkGameLoadingStart());
export const cgLoadingStop = () => safe((s) => s.game.sdkGameLoadingStop());

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

// Rewarded ads only resolve when watched to the end, a skipped or missing one pays nothing
// Midgame ads are just a break, callers carry on either way
function requestAd(type, { onStart, onEnd } = {}) {
  const s = sdk();
  if (!s || !s.ad) return Promise.reject(new Error("no-ad"));
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
  if (!s || !s.user) return (accountsCached = false);
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
  if (!s || !s.user) return null;
  try {
    return (await s.user.getUserToken()) || null;
  } catch {
    return null; // Not signed in
  }
}

// CrazyGames sign in box, gives the user or null if they close it
export async function cgSignIn() {
  const s = sdk();
  if (!s || !s.user) return null;
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
