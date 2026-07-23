// Wallet kept on the server for signed in players
// The game can ask for an action but never says how much, the server decides every amount
import { createStore } from "../store.mjs";
import { resolveIdentity } from "../src/server/identity.mjs";
import { DAILY_BONUS, JACKPOT, spinWheel, today } from "../src/engine/rewards.js";
import { trackReward } from "../src/engine/analytics.js";

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
        return res.status(200).json({ ok: true, balance: w.balance, username: user.username, newWallet: created, dailyClaimed: w.daily === day });

      case "daily": {
        if (w.daily === day) return res.status(200).json({ ok: true, balance: w.balance, granted: 0, reason: "already-claimed" });
        await store.walletSetField(key, "daily", day);
        const balance = await store.walletAdd(key, DAILY_BONUS);
        trackReward({ kind: "daily", amount: DAILY_BONUS, server: true });
        return res.status(200).json({ ok: true, balance, granted: DAILY_BONUS });
      }

      case "wheel": {
        const count = w.adDay === day ? w.adCount : 0;
        if (count >= MAX_AD_GRANTS_PER_DAY) {
          return res.status(200).json({ ok: true, balance: w.balance, granted: 0, reason: "daily-ad-limit" });
        }
        // The server spins, the game is only told what it won
        const { index, amount } = spinWheel();
        if (w.adDay !== day) await store.walletSetField(key, "adDay", day);
        await store.walletSetField(key, "adCount", count + 1);
        const balance = await store.walletAdd(key, amount);
        trackReward({ kind: "wheel", amount, jackpot: amount >= JACKPOT, server: true });
        return res.status(200).json({ ok: true, balance, granted: amount, index, jackpot: amount >= JACKPOT });
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
