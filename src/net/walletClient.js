// Signed in, the server owns the balance and the browser can only ask
// Guests keep a local balance, moved to the server the first time they sign in

import { backendHttpOrigin } from "./netClient.js";
import { walletCredential } from "./credential.js";
import { MIN_TABLE_BUYIN } from "../engine/rewards.js";
import { CHIPS } from "../engine/cosmeticsData.js";
import * as storage from "./storage.js";

const LOCAL_KEY = "7bust:chips";
const STARTING_BALANCE = 1000;

let mode = "local"; // Local for guests, server for signed in players
let balance = STARTING_BALANCE;
let username = null;
let serverCos = []; // Empty for guests

const readLocal = () => {
  try {
    const raw = storage.getItem(LOCAL_KEY);
    if (raw === null) return STARTING_BALANCE; // Never played before, give them the starting chips
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : STARTING_BALANCE;
  } catch {
    return STARTING_BALANCE;
  }
};
const writeLocal = (v) => {
  try {
    storage.setItem(LOCAL_KEY, String(Math.max(0, Math.round(v))));
  } catch {
    // Storage isn't available, the game still works without it
  }
};

async function post(action, extra = {}) {
  const cred = await walletCredential();
  if (!cred) return null; // Guest, not signed in on any site
  try {
    const res = await fetch(`${backendHttpOrigin()}/api/wallet`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" }, // Kept simple so the browser skips the preflight check
      body: JSON.stringify({ platform: cred.platform, token: cred.token, action, ...extra }),
    });
    const j = await res.json();
    return j && j.ok ? j : null;
  } catch {
    return null; // Network trouble, fall back to local instead of stopping play
  }
}

// Moves chips from old saves made before accounts
// Only fills an empty wallet so it can't pay out twice
export function seedLocalIfUnset(amount) {
  if (!Number.isFinite(amount) || amount < 0) return false;
  try {
    if (storage.getItem(LOCAL_KEY) != null) return false;
  } catch {
    return false;
  }
  writeLocal(amount);
  balance = readLocal();
  return true;
}

export const walletMode = () => mode;
export const walletUser = () => username;
export const getBalance = () => balance;

// The "Bankrupt Bailout" button checks these to know if it can be used
export const MIN_BUYIN = MIN_TABLE_BUYIN;
export const isBankrupt = () => balance < MIN_TABLE_BUYIN;

// Connects to the CrazyGames, Discord or Newgrounds account if there is one
// Guests keep the local wallet and nothing is sent
export async function initWallet() {
  balance = readLocal();
  writeLocal(balance); // A new browser starts with the starting chips, save them now
  const local = balance;
  const res = await post("balance");
  if (!res) return { mode: (mode = "local"), balance };
  mode = "server";
  balance = res.balance;
  username = res.username || null;
  serverCos = Array.isArray(res.cos) ? res.cos : [];
  // First time this account has played, move the guest's chips over
  if (res.newWallet && local > STARTING_BALANCE) {
    const m = await post("migrate", { amount: local });
    if (m) balance = m.balance;
  }
  return { mode, balance, migrated: !!res.newWallet };
}

// "Bankrupt Bailout" tops the player up to the cheapest buy-in, only when they're below it
// Signed in, the server checks it so it can't be farmed
export async function claimBailout() {
  if (balance >= MIN_TABLE_BUYIN) return { ok: true, granted: 0, balance, reason: "solvent" };
  if (mode === "server") {
    const res = await post("bailout");
    if (res) {
      balance = res.balance;
      return { ok: true, granted: res.granted, balance, reason: res.reason };
    }
    return { ok: false, reason: "network", balance };
  }
  // Guests get topped up locally to exactly the buy-in
  const granted = MIN_TABLE_BUYIN - balance;
  balance = MIN_TABLE_BUYIN;
  writeLocal(balance);
  return { ok: true, granted, balance };
}

// Signed in, the server spins and pays and the wheel just shows where it landed
// Guests spin locally. A money win goes to the single player stack, chips stay the same
export async function spinPrizeWheel(localSpin) {
  if (mode === "server") {
    const res = await post("wheel");
    if (res) {
      balance = res.balance; // Stays the same when the slice paid money
      return { index: res.index, amount: res.granted, cur: res.cur, jackpot: res.jackpot, balance, limited: res.reason === "daily-ad-limit" };
    }
  }
  const spin = localSpin();
  if (spin.cur === CHIPS) {
    balance = readLocal() + spin.amount;
    writeLocal(balance);
  }
  return { ...spin, balance };
}

// Guests only. Signed in players get buy-ins and payouts from the server
export function adjustLocal(delta) {
  balance = Math.max(0, balance + Math.round(delta));
  if (mode === "local") writeLocal(balance);
  return balance;
}

export async function refreshBalance() {
  if (mode !== "server") {
    balance = readLocal();
    return balance;
  }
  const res = await post("balance");
  if (res) {
    balance = res.balance;
    if (Array.isArray(res.cos)) serverCos = res.cos;
  }
  return balance;
}

// Comes from the server, chips cosmetics can't be given out locally
export const walletCosmetics = () => serverCos;

// The server holds the price and takes the chips, we only send the item
export async function purchaseWithChips(itemId) {
  const cred = await walletCredential();
  if (!cred) return { ok: false, reason: "guest" }; // No account, the caller uses local chips
  try {
    const res = await fetch(`${backendHttpOrigin()}/api/wallet`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ platform: cred.platform, token: cred.token, action: "purchase", item: itemId }),
    });
    const j = await res.json();
    if (j && j.ok) {
      if (typeof j.balance === "number") balance = j.balance;
      if (Array.isArray(j.owned)) serverCos = j.owned;
    }
    return j || { ok: false, reason: "network" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

// Day 7 streak reward. The server picks the cosmetic and only allows it once a week
export async function claimStreak7() {
  const cred = await walletCredential();
  if (!cred) return { ok: false, reason: "guest" };
  try {
    const res = await fetch(`${backendHttpOrigin()}/api/wallet`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ platform: cred.platform, token: cred.token, action: "streak" }),
    });
    const j = await res.json();
    if (j && j.ok) {
      if (typeof j.balance === "number") balance = j.balance;
      if (Array.isArray(j.owned)) serverCos = j.owned;
    }
    return j || { ok: false, reason: "network" };
  } catch {
    return { ok: false, reason: "network" };
  }
}
