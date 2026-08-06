// Cosmetics bought with money in single-player or chips in multiplayer
// Money items are saved in the browser, a signed in player's chips items are saved on the server

import * as storage from "../net/storage.js";
import { getChips as getMoney, setChips as setMoney } from "./pveWallet.js";
import { walletMode, getBalance as getChipBalance, adjustLocal, purchaseWithChips, walletCosmetics } from "../net/walletClient.js";
import { MONEY, CHIPS, CARD_FACES, CARD_BACKS, AVATARS, FELTS, EMOTE_PACKS, BASE_EMOTES, DEFAULTS, itemById, LOGON_IDS } from "./cosmeticsData.js";

const OWNED_KEY = "7bust:cosmetics:owned:v1"; // All money items and a guest's chips items
const SEL_KEY = "7bust:cosmetics:sel:v1";

function readLocalOwned() {
  try {
    const raw = storage.getItem(OWNED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
function writeLocalOwned(set) {
  try {
    storage.setItem(OWNED_KEY, JSON.stringify([...set]));
  } catch {
    // Saving failed, the purchase still works until the page closes
  }
}
function addLocalOwned(id) {
  const s = readLocalOwned();
  s.add(id);
  writeLocalOwned(s);
}

export function owns(id) {
  const item = itemById(id);
  if (item && item.price === 0) return true;
  return readLocalOwned().has(id) || walletCosmetics().includes(id); // In the browser, or on the server for chips items bought signed in
}

function readSel() {
  try {
    const raw = storage.getItem(SEL_KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}
function writeSel(sel) {
  try {
    storage.setItem(SEL_KEY, JSON.stringify(sel));
  } catch {
    // Analytics failing never affects the game
  }
}
const pick = (kind, fallback) => {
  const id = readSel()[kind];
  return id && owns(id) ? id : fallback;
};
export const selectedFace = () => pick("face", DEFAULTS.face);
export const selectedBack = () => pick("back", DEFAULTS.back);
export const selectedAvatar = () => pick("avatar", DEFAULTS.avatar);
export const selectedFelt = () => pick("felt", DEFAULTS.felt);

export function ownedEmotes() {
  const out = [...BASE_EMOTES];
  for (const p of EMOTE_PACKS) if (owns(p.id)) out.push(...p.emojis);
  return out;
}

// Emote packs work as soon as you own them so they don't get equipped
export function equip(id) {
  const item = itemById(id);
  if (!item || item.kind === "emote" || !owns(id)) return false;
  const sel = readSel();
  sel[item.kind] = id;
  writeSel(sel);
  return true;
}

// Money items come out of single-player money, chips go through the server when signed in
// Guests spend chips saved in the browser. A new item is equipped straight away
export async function buy(id) {
  const item = itemById(id);
  if (!item) return { ok: false, reason: "unknown" };
  if (owns(id)) return { ok: false, reason: "owned" };

  if (item.cur === MONEY) {
    const bal = getMoney();
    if (bal < item.price) return { ok: false, reason: "poor", cur: MONEY, short: item.price - bal };
    setMoney(bal - item.price);
    addLocalOwned(id);
    equip(id);
    return { ok: true, cur: MONEY, balance: getMoney() };
  }

  if (walletMode() === "server") {
    const res = await purchaseWithChips(id); // The server knows the price, takes the chips and saves the item
    if (!res || !res.ok) return { ok: false, reason: (res && res.reason) || "network", cur: CHIPS, short: res && res.short };
    equip(id);
    return { ok: true, cur: CHIPS, balance: res.balance };
  }
  const bal = getChipBalance();
  if (bal < item.price) return { ok: false, reason: "poor", cur: CHIPS, short: item.price - bal };
  adjustLocal(-item.price);
  addLocalOwned(id);
  equip(id);
  return { ok: true, cur: CHIPS, balance: getChipBalance() };
}

function decorate(sel) {
  return (i) => ({ ...i, owned: owns(i.id), equipped: i.kind === "emote" ? owns(i.id) : sel[i.kind] === i.id });
}
// Money items first then chips, cheapest first in each, so the free default comes first
// Login only items are left out, they can't be bought
const byOrder = (a, b) => (a.cur === b.cur ? a.price - b.price : a.cur === MONEY ? -1 : 1);
const ordered = (list, d) => list.filter((i) => !i.exclusive).slice().sort(byOrder).map(d);

// Gives a cosmetic straight to the player and equips it, used for the guest day 7 reward
// Signed in players get theirs saved on the server instead
export function grantLocal(id) {
  addLocalOwned(id);
  equip(id);
}
// Login items the player doesn't own yet, the day 7 reward picks from these
export function unownedLogon() {
  return LOGON_IDS.filter((id) => !owns(id));
}
export const ownsAllLogon = () => unownedLogon().length === 0;

export function shopSummary() {
  const sel = readSel();
  const d = decorate(sel);
  return {
    money: getMoney(),
    chips: getChipBalance(),
    signedIn: walletMode() === "server",
    faces: ordered(CARD_FACES, d),
    backs: ordered(CARD_BACKS, d),
    avatars: ordered(AVATARS, d),
    felts: ordered(FELTS, d),
    emotes: ordered(EMOTE_PACKS, d),
  };
}
