// Single-player chips, kept fully apart from the multiplayer wallet. Nothing here touches that wallet
// These chips live in the browser and could be faked, so they can never turn into real chips

import * as storage from "../net/storage.js";
import { ARENAS, FIRST_ARENA, unlockedFor, highestUnlocked, nextLocked } from "./arenas.js";

// Named with the game's prefix so it can't clash with another game on the same site
export const PVE_CHIPS_KEY = "7bust:pve_chips";
export const PVE_CAREER_KEY = "7bust:pve:career:v1";

export const PVE_START_CHIPS = 1000;
// Chips the house gives a broke player, less than the starting stack so going broke isn't worth it
export const PVE_RESTAKE = 500;

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function getChips() {
  try {
    const raw = storage.getItem(PVE_CHIPS_KEY);
    if (raw === null) return PVE_START_CHIPS; // Never played, so give them the starting chips
    return Math.round(num(raw, PVE_START_CHIPS)); // A null would turn into 0, so it's checked first
  } catch {
    return PVE_START_CHIPS;
  }
}

export function setChips(v) {
  const n = Math.max(0, Math.round(v));
  try {
    storage.setItem(PVE_CHIPS_KEY, String(n));
  } catch {
    // Saving failed, the game still plays, it just won't be saved
  }
  touchPeak(n);
  return n;
}

export const addChips = (delta) => setChips(getChips() + delta);

const emptyCareer = () => ({
  peak: PVE_START_CHIPS, // Highest net worth ever, rooms unlock by this
  winnings: 0, // Every pot payout added up, before taking off buy-ins
  wagered: 0,
  hands: 0,
  wins: 0,
  busts: 0,
  biggestPot: 0,
  bestArena: FIRST_ARENA.id,
  restakes: 0,
  byArena: {},
  startedAt: Date.now(),
});

export function getCareer() {
  try {
    const raw = storage.getItem(PVE_CAREER_KEY);
    if (!raw) return emptyCareer();
    const c = { ...emptyCareer(), ...JSON.parse(raw) };
    c.byArena = c.byArena || {};
    return c;
  } catch {
    return emptyCareer();
  }
}

function saveCareer(c) {
  try {
    storage.setItem(PVE_CAREER_KEY, JSON.stringify(c));
  } catch {
    // Storage isn't available, the game still works without it
  }
  return c;
}

// Peak net worth only goes up, so losing chips never locks a room you already opened
function touchPeak(chips) {
  const c = getCareer();
  if (chips <= c.peak) return c;
  c.peak = chips;
  c.bestArena = highestUnlocked(chips).id;
  return saveCareer(c);
}

export const peakNetWorth = () => getCareer().peak;
export const unlockedArenas = () => unlockedFor(peakNetWorth());
export const highestArena = () => highestUnlocked(peakNetWorth());
export const nextLockedArena = () => nextLocked(peakNetWorth());

export const canEnter = (arena) => peakNetWorth() >= arena.unlockAt && getChips() >= arena.buyIn;

export function progressToNext() {
  const next = nextLockedArena();
  if (!next) return null;
  const peak = peakNetWorth();
  const from = ARENAS[ARENAS.indexOf(next) - 1];
  const floor = from ? from.unlockAt : 0;
  const span = Math.max(1, next.unlockAt - floor);
  return {
    arena: next,
    need: next.unlockAt,
    have: peak,
    short: Math.max(0, next.unlockAt - peak),
    // How far along the current room the player is, for the ladder's fill bar
    pct: Math.max(0, Math.min(1, (peak - floor) / span)),
  };
}

// The buy-in was already taken at the deal, so only the payout gets added or it'd be charged twice
export function recordHand({ arena, payout, wager, won, busted, potShare }) {
  const c = getCareer();
  c.hands += 1;
  c.wagered += wager;
  if (won) {
    c.wins += 1;
    c.winnings += payout;
    c.biggestPot = Math.max(c.biggestPot, potShare || payout);
  }
  if (busted) c.busts += 1;

  const a = (c.byArena[arena.id] = c.byArena[arena.id] || { hands: 0, wins: 0, winnings: 0, best: 0 });
  a.hands += 1;
  if (won) {
    a.wins += 1;
    a.winnings += payout;
    a.best = Math.max(a.best, potShare || payout);
  }
  saveCareer(c);

  const chips = addChips(payout); // Adding chips also updates the peak, so new rooms open here
  return { chips, career: getCareer() };
}

// Rooms that just opened, so the game can show a new room moment instead of changing quietly
export function roomsOpenedBetween(peakBefore, peakAfter) {
  return ARENAS.filter((a) => a.unlockAt > peakBefore && a.unlockAt <= peakAfter);
}

export const isBroke = () => getChips() < FIRST_ARENA.buyIn;

export function restake() {
  if (!isBroke()) return getChips();
  const c = getCareer();
  c.restakes += 1;
  saveCareer(c);
  // Not counted as winnings, free chips shouldn't move a leaderboard
  // It can't open a room either, the restake is far below the first unlock
  return setChips(PVE_RESTAKE);
}

export function resetPve() {
  try {
    storage.removeItem(PVE_CHIPS_KEY);
    storage.removeItem(PVE_CAREER_KEY);
  } catch {
    // Analytics failing never affects the game
  }
  return { chips: getChips(), career: getCareer() };
}

export function pveSummary() {
  const career = getCareer();
  const chips = getChips();
  return {
    chips,
    career,
    peak: career.peak,
    winnings: career.winnings,
    hands: career.hands,
    wins: career.wins,
    winRate: career.hands ? career.wins / career.hands : 0,
    biggestPot: career.biggestPot,
    highest: highestUnlocked(career.peak),
    unlocked: unlockedFor(career.peak),
    next: progressToNext(),
    broke: chips < FIRST_ARENA.buyIn,
  };
}
