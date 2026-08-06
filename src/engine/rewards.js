// Free chips for the casual build, a prize wheel you watch an ad for and the "Bankrupt Bailout"

import { MONEY, CHIPS } from "./cosmeticsData.js";

// Buy-ins a room's host can pick, the free one is a friendly table with nothing at stake
// "Bankrupt Bailout" tops a broke player up to the cheapest one, the server uses the same number
export const MP_BUYIN_TIERS = [0, 50, 100, 250];
export const MIN_TABLE_BUYIN = MP_BUYIN_TIERS.find((f) => f > 0);

// Each slice pays money or chips, cur says which wallet it lands in
// The order matches the wheel colours in app.css, keep them in step
export const WHEEL = [
  { amount: 200, cur: CHIPS, weight: 20 },
  { amount: 500, cur: MONEY, weight: 18 },
  { amount: 250, cur: CHIPS, weight: 14 },
  { amount: 1000, cur: MONEY, weight: 14 },
  { amount: 2500, cur: CHIPS, weight: 4, jackpot: true },
  { amount: 2500, cur: MONEY, weight: 10 },
  { amount: 500, cur: CHIPS, weight: 12 },
  { amount: 5000, cur: MONEY, weight: 8, jackpot: true },
];

export const WHEEL_MIN = Math.min(...WHEEL.map((s) => s.amount));

// Pass your own rng to get the same spins in tests
export function spinWheel(rng = Math.random) {
  const total = WHEEL.reduce((a, s) => a + s.weight, 0);
  let r = rng() * total;
  for (let i = 0; i < WHEEL.length; i++) {
    r -= WHEEL[i].weight;
    if (r < 0) return { index: i, amount: WHEEL[i].amount, cur: WHEEL[i].cur, jackpot: !!WHEEL[i].jackpot };
  }
  const last = WHEEL.length - 1;
  return { index: last, amount: WHEEL[last].amount, cur: WHEEL[last].cur, jackpot: !!WHEEL[last].jackpot };
}

// The player's local day, not UTC
export function today(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
