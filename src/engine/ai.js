// How the bots play. Each turn they bank or push at the start, then stop or draw again
// A bit of randomness makes them feel real, it's never used for the shuffle

import { scoreHand } from "./round.js";

export const PERSONALITIES = {
  cautious: { stayScore: 16, riskTolerance: 0.32, jitter: 3 },
  reckless: { stayScore: 24, riskTolerance: 0.52, jitter: 5 },
};

// Start of a turn with cards in hand, bank them or push for more
export function aiBankAtStart(hand, risk, p) {
  const s = scoreHand(hand);
  const target = p.stayScore + (Math.random() * 2 - 1) * p.jitter;
  return s >= target || risk > p.riskTolerance;
}

// While pushing, stop and keep the hand for next turn, or draw again
export function aiStop(hand, risk, p) {
  if (hand.cards.length === 0) return false; // Has to take at least one card
  return risk > p.riskTolerance || scoreHand(hand) >= p.stayScore;
}
