// How the bots play, each turn they draw a card or bank
// A bit of randomness makes them feel real, it's never used for the shuffle

import { scoreHand } from "./round.js";

export const PERSONALITIES = {
  cautious: { stayScore: 16, riskTolerance: 0.32, jitter: 3 },
  reckless: { stayScore: 24, riskTolerance: 0.52, jitter: 5 },
};

// True means draw another card, false means bank
// An empty hand can't be banked, so the bot has to draw first
export function decideHit(hand, risk, p) {
  if (hand.cards.length === 0) return true;
  if (hand.numbers.length >= 6) return risk < 0.7; // One card from a "Flip 7", usually worth it
  const target = p.stayScore + (Math.random() * 2 - 1) * p.jitter;
  if (scoreHand(hand) >= target) return false;
  return risk <= p.riskTolerance;
}
