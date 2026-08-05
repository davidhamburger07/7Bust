// Card skins and avatars bought with practice chips, only looks so they're saved in the browser
// Spending chips here never locks a room, rooms go by the most you've ever had

import * as storage from "../net/storage.js";
import { getChips, setChips } from "./pveWallet.js";

const OWNED_KEY = "7bust:cosmetics:owned:v1";
const CARD_KEY = "7bust:cosmetics:card:v1";
const AVATAR_KEY = "7bust:cosmetics:avatar:v1";

// Each skin's look lives in app.css, swatch is the little preview in the shop
export const CARD_SKINS = [
  { id: "classic", name: "Classic", price: 0, blurb: "The house deck. Cream and clean.", swatch: "linear-gradient(160deg,#fff8ea,#f0dcb6)" },
  { id: "ruby", name: "Ruby", price: 1000, blurb: "Deep red faces with a soft inner glow.", swatch: "linear-gradient(160deg,#7a1020,#3a0810)" },
  { id: "sapphire", name: "Sapphire", price: 1000, blurb: "Cool blue, like a high-limit table.", swatch: "linear-gradient(160deg,#123a7a,#08183a)" },
  { id: "emerald", name: "Emerald", price: 1000, blurb: "Felt-green cards for the true regular.", swatch: "linear-gradient(160deg,#0f6a3d,#053a20)" },
  { id: "midnight", name: "Midnight", price: 2500, blurb: "Matte black with electric-cyan digits.", swatch: "linear-gradient(160deg,#12161f,#05070c)" },
  { id: "neon", name: "Neon", price: 4000, blurb: "Blacklight pink and cyan. Loud on purpose.", swatch: "linear-gradient(160deg,#1a0a24,#05010a)" },
  { id: "goldfoil", name: "Gold Foil", price: 8000, blurb: "Brushed-gold faces. Bank statement energy.", swatch: "linear-gradient(160deg,#ffe9a8,#b8862a)" },
];

// An emoji on a coloured disc, shown on your seat and your leaderboard row
export const AVATARS = [
  { id: "chip", name: "Red Chip", emoji: "🔴", price: 0, bg: "linear-gradient(160deg,#e05b5b,#8a2020)" },
  { id: "clover", name: "Lucky Clover", emoji: "🍀", price: 500, bg: "linear-gradient(160deg,#3fbf6a,#166a34)" },
  { id: "flame", name: "On Fire", emoji: "🔥", price: 1200, bg: "linear-gradient(160deg,#ff9a3d,#a3401a)" },
  { id: "star", name: "Gold Star", emoji: "⭐", price: 1500, bg: "linear-gradient(160deg,#ffd24a,#a9781a)" },
  { id: "diamond", name: "Diamond Hands", emoji: "💎", price: 2000, bg: "linear-gradient(160deg,#6fd2ff,#1f6a99)" },
  { id: "rocket", name: "Moonshot", emoji: "🚀", price: 2500, bg: "linear-gradient(160deg,#8a7dff,#3a2f8a)" },
  { id: "shark", name: "Card Shark", emoji: "🦈", price: 3000, bg: "linear-gradient(160deg,#8fb3c9,#3a5a70)" },
  { id: "crown", name: "High Roller", emoji: "👑", price: 5000, bg: "linear-gradient(160deg,#ffe08a,#9a6a10)" },
  { id: "seven", name: "Lucky Seven", emoji: "7️⃣", price: 7777, bg: "linear-gradient(160deg,#46e58c,#127a44)" },
];

const DEFAULT_CARD = "classic";
const DEFAULT_AVATAR = "chip";

export const cardSkinById = (id) => CARD_SKINS.find((s) => s.id === id) || CARD_SKINS[0];
export const avatarById = (id) => AVATARS.find((a) => a.id === id) || AVATARS[0];

// The free defaults are always owned without saving anything
function readOwned() {
  try {
    const raw = storage.getItem(OWNED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set([DEFAULT_CARD, DEFAULT_AVATAR, ...(Array.isArray(arr) ? arr : [])]);
  } catch {
    return new Set([DEFAULT_CARD, DEFAULT_AVATAR]);
  }
}
function writeOwned(set) {
  try {
    storage.setItem(OWNED_KEY, JSON.stringify([...set]));
  } catch {
    // Saving failed, the purchase still works until the page closes
  }
}
export const owns = (id) => readOwned().has(id);

export function selectedCard() {
  try {
    const id = storage.getItem(CARD_KEY);
    return id && owns(id) ? id : DEFAULT_CARD;
  } catch {
    return DEFAULT_CARD;
  }
}
export function selectedAvatar() {
  try {
    const id = storage.getItem(AVATAR_KEY);
    return id && owns(id) ? id : DEFAULT_AVATAR;
  } catch {
    return DEFAULT_AVATAR;
  }
}

export function equip(kind, id) {
  if (!owns(id)) return false;
  try {
    storage.setItem(kind === "card" ? CARD_KEY : AVATAR_KEY, id);
  } catch {
    // Analytics failing never affects the game
  }
  return true;
}

// A new item is equipped straight away
export function buy(kind, id) {
  const item = kind === "card" ? cardSkinById(id) : avatarById(id);
  if (!item) return { ok: false, reason: "unknown" };
  if (owns(id)) return { ok: false, reason: "owned" };
  const chips = getChips();
  if (chips < item.price) return { ok: false, reason: "poor", short: item.price - chips };
  setChips(chips - item.price);
  const set = readOwned();
  set.add(id);
  writeOwned(set);
  equip(kind, id); // A new item equips itself
  return { ok: true, chips: getChips() };
}

export function shopSummary() {
  const ownedSet = readOwned();
  const card = selectedCard();
  const avatar = selectedAvatar();
  return {
    chips: getChips(),
    cardSkins: CARD_SKINS.map((s) => ({ ...s, owned: ownedSet.has(s.id), equipped: s.id === card })),
    avatars: AVATARS.map((a) => ({ ...a, owned: ownedSet.has(a.id), equipped: a.id === avatar })),
  };
}
