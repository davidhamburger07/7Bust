// Wallet kept on the server for signed in players
// The game can ask for an action but never says how much, the server decides every amount
import { createStore } from "../store.mjs";
import { resolveIdentity } from "../src/server/identity.mjs";
import { MIN_TABLE_BUYIN, spinWheel, today } from "../src/engine/rewards.js";
import { trackReward } from "../src/engine/analytics.js";
import { itemById, CHIPS, LOGON_IDS, STREAK_DAY7_CHIPS, STREAK_DAY7_BACKUP } from "../src/engine/cosmeticsData.js";

// Owned chip cosmetics are saved as a comma separated list of ids
const cosList = (w) => (w && w.cos ? String(w.cos).split(",").filter(Boolean) : []);
const dayIx = (s) => (s ? Math.floor(new Date(s + "T00:00:00Z").getTime() / 86400000) : -99999);

const STARTING_BALANCE = 1000;
const MAX_AD_GRANTS_PER_DAY = 20; // We can't check the ad really played, so cap the payout
const MAX_MIGRATE = 5000; // Most a guest can bring in on first sign in

let store = null;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  let body = {};
  try {
    const raw = typeof req.body === "string" ? req.body : req.body ? JSON.stringify(req.body) : await readBody(req);
    body = JSON.parse(raw || "{}");
  } catch {
    return res.status(400).json({ ok: false, error: "bad body" });
  }

  let user;
  try {
    user = await resolveIdentity({ platform: body.platform, token: body.token });
  } catch (e) {
    // No valid login means no server wallet, the game uses its guest wallet instead
    return res.status(401).json({ ok: false, error: "unauthenticated", detail: String(e.message || e) });
  }

  if (!store) store = createStore();
  const key = user.key;
  const day = today();

  try {
    const created = await store.walletInit(key, STARTING_BALANCE);
    let w = await store.walletGet(key);

    switch (body.action) {
      case "balance":
        return res.status(200).json({ ok: true, balance: w.balance, username: user.username, newWallet: created, cos: cosList(w) });

      case "purchase": {
        // Buys a cosmetic with chips. The price comes from the catalogue here, never the game
        const item = itemById(String(body.item || ""));
        if (!item || item.cur !== CHIPS) return res.status(400).json({ ok: false, error: "not a chips item" });
        const owned = cosList(w);
        if (owned.includes(item.id)) return res.status(200).json({ ok: true, balance: w.balance, owned, already: true });
        const balance = await store.walletDebit(key, item.price);
        if (balance === null) return res.status(200).json({ ok: false, reason: "poor", balance: w.balance, short: item.price - w.balance });
        const next = [...owned, item.id];
        await store.walletSetField(key, "cos", next.join(","));
        return res.status(200).json({ ok: true, balance, owned: next });
      }

      case "streak": {
        // Day 7 of the login streak gives an exclusive cosmetic and chips, or more chips if all are owned
        // At most once every 7 days, checked here so a faked streak can't farm it
        if (w.streakAt && dayIx(day) - dayIx(w.streakAt) < 6) {
          return res.status(200).json({ ok: false, reason: "too-soon", balance: w.balance });
        }
        await store.walletSetField(key, "streakAt", day);
        const owned = cosList(w);
        const unowned = LOGON_IDS.filter((id) => !owned.includes(id));
        if (unowned.length) {
          const pick = unowned[Math.floor(Math.random() * unowned.length)];
          await store.walletSetField(key, "cos", [...owned, pick].join(","));
          const balance = await store.walletAdd(key, STREAK_DAY7_CHIPS);
          return res.status(200).json({ ok: true, cosmetic: pick, chips: STREAK_DAY7_CHIPS, balance, owned: [...owned, pick] });
        }
        const balance = await store.walletAdd(key, STREAK_DAY7_BACKUP);
        return res.status(200).json({ ok: true, cosmetic: null, chips: STREAK_DAY7_BACKUP, backup: true, balance, owned });
      }

      case "bailout": {
        // "Bankrupt Bailout" tops a broke player up to the cheapest buy-in, never more
        // Only works while they're below it, so it can't be farmed
        if (w.balance >= MIN_TABLE_BUYIN) return res.status(200).json({ ok: true, balance: w.balance, granted: 0, reason: "solvent" });
        const granted = MIN_TABLE_BUYIN - w.balance;
        const balance = await store.walletAdd(key, granted);
        trackReward({ kind: "bailout", amount: granted, server: true });
        return res.status(200).json({ ok: true, balance, granted });
      }

      case "wheel": {
        const count = w.adDay === day ? w.adCount : 0;
        if (count >= MAX_AD_GRANTS_PER_DAY) {
          return res.status(200).json({ ok: true, balance: w.balance, granted: 0, reason: "daily-ad-limit" });
        }
        // The server spins, the game is only told what it won
        const { index, amount, cur, jackpot } = spinWheel();
        if (w.adDay !== day) await store.walletSetField(key, "adDay", day);
        await store.walletSetField(key, "adCount", count + 1);
        // Chips live on the server so they're added here
        // Money is only on the player's device, so the server just reports the win
        const balance = cur === CHIPS ? await store.walletAdd(key, amount) : w.balance;
        trackReward({ kind: "wheel", amount, cur, jackpot, server: true });
        return res.status(200).json({ ok: true, balance, granted: amount, index, cur, jackpot });
      }

      case "migrate": {
        // Only once, and only for a wallet we just made
        if (!created) return res.status(200).json({ ok: true, balance: w.balance, migrated: 0, reason: "wallet-exists" });
        const carry = Math.max(0, Math.min(MAX_MIGRATE, Math.round(Number(body.amount) || 0) - STARTING_BALANCE));
        if (!carry) return res.status(200).json({ ok: true, balance: w.balance, migrated: 0 });
        const balance = await store.walletAdd(key, carry);
        return res.status(200).json({ ok: true, balance, migrated: carry });
      }

      default:
        return res.status(400).json({ ok: false, error: "unknown action" });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
    req.on("error", () => resolve(""));
  });
}
