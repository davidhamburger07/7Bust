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

// Shows the SDK's invite button with our room code, only when the code changes
// Off the platform this does nothing, the room code and link still work
let shownRoom = null;
export function cgShowInvite(roomId) {
  if (!roomId || roomId === shownRoom) return;
  shownRoom = roomId;
  safe((s) => s.game.showInviteButton({ roomId }));
}
export function cgHideInvite() {
  if (shownRoom === null) return;
  shownRoom = null;
  safe((s) => s.game.hideInviteButton());
}
// Room code the player was invited to, or null
export const cgGetInviteRoom = () => safe((s) => s.game.getInviteParam("roomId"));
