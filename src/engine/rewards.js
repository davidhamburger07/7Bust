// Free chips for the casual build, a prize wheel you watch an ad for and the "Bankrupt Bailout"

export const JACKPOT = 2500;

// Buy-ins a room's host can pick, the free one is a friendly table with nothing at stake
// "Bankrupt Bailout" tops a broke player up to the cheapest one, the server uses the same number
export const MP_BUYIN_TIERS = [0, 50, 100, 250];
export const MIN_TABLE_BUYIN = MP_BUYIN_TIERS.find((f) => f > 0);

// Weights add up to 100 so each one is a percent chance, the jackpot is rare
export const WHEEL = [
  { amount: 200, weight: 24 },
  { amount: 300, weight: 16 },
  { amount: 500, weight: 10 },
  { amount: 250, weight: 20 },
  { amount: 2500, weight: 1 }, // Jackpot, opposite the other big slice so the wheel looks balanced
  { amount: 200, weight: 24 },
  { amount: 750, weight: 4 },
  { amount: 1000, weight: 1 },
];

export const WHEEL_MIN = Math.min(...WHEEL.map((s) => s.amount));

// Pass your own rng to get the same spins in tests
export function spinWheel(rng = Math.random) {
  const total = WHEEL.reduce((a, s) => a + s.weight, 0);
  let r = rng() * total;
  for (let i = 0; i < WHEEL.length; i++) {
    r -= WHEEL[i].weight;
    if (r < 0) return { index: i, amount: WHEEL[i].amount };
  }
  return { index: WHEEL.length - 1, amount: WHEEL[WHEEL.length - 1].amount };
}

// The player's local day, not UTC
export function today(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
