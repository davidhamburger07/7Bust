// Signed in, the server owns the balance and the browser can only ask
// Guests keep a local balance, moved to the server the first time they sign in

import { backendHttpOrigin } from "./netClient.js";
import { cgUserToken, cgAccountsAvailable } from "./crazygames.js";

const LOCAL_KEY = "7bust:chips";
const STARTING_BALANCE = 1000;

let mode = "local"; // Local for guests, server for signed in players
let balance = STARTING_BALANCE;
let username = null;

const readLocal = () => {
  try {
    const v = Number(localStorage.getItem(LOCAL_KEY));
    return Number.isFinite(v) && v >= 0 ? v : STARTING_BALANCE;
  } catch {
    return STARTING_BALANCE;
  }
};
const writeLocal = (v) => {
  try {
    localStorage.setItem(LOCAL_KEY, String(Math.max(0, Math.round(v))));
  } catch {
    // Storage isn't available, the game still works without it
  }
};

async function post(action, extra = {}) {
  const token = await cgUserToken();
  if (!token) return null; // Guest
  try {
    const res = await fetch(`${backendHttpOrigin()}/api/wallet`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" }, // Kept simple so the browser skips the preflight check
      body: JSON.stringify({ token, action, ...extra }),
    });
    const j = await res.json();
    return j && j.ok ? j : null;
  } catch {
    return null; // Network trouble, fall back to local instead of stopping play
  }
}

export const walletMode = () => mode;
export const walletUser = () => username;
export const getBalance = () => balance;

// Connects to the player's account if there is one, guests keep the local wallet
export async function initWallet() {
  balance = readLocal();
  if (!cgAccountsAvailable()) return { mode: (mode = "local"), balance };
  const local = balance;
  const res = await post("balance");
  if (!res) return { mode: (mode = "local"), balance };
  mode = "server";
  balance = res.balance;
  username = res.username || null;
  // First time this account has played, move the guest's chips over
  if (res.newWallet && local > STARTING_BALANCE) {
    const m = await post("migrate", { amount: local });
    if (m) balance = m.balance;
  }
  return { mode, balance, migrated: !!res.newWallet };
}

// The server decides if the daily bonus is due and how much
export async function claimDailyBonus(localFallback) {
  if (mode === "server") {
    const res = await post("daily");
    if (res) {
      balance = res.balance;
      return { granted: res.granted, balance, reason: res.reason };
    }
  }
  const granted = localFallback();
  balance = readLocal();
  return { granted, balance };
}

// Signed in, the server spins and pays and the wheel just shows where it landed
// Guests spin locally
export async function spinPrizeWheel(localSpin) {
  if (mode === "server") {
    const res = await post("wheel");
    if (res) {
      balance = res.balance;
      return { index: res.index, amount: res.granted, balance, limited: res.reason === "daily-ad-limit" };
    }
  }
  const { index, amount } = localSpin();
  balance = readLocal() + amount;
  writeLocal(balance);
  return { index, amount, balance };
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
  if (res) balance = res.balance;
  return balance;
}
