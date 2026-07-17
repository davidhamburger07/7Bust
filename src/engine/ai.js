// How the bots play. Each turn they bank or push at the start, then stop or draw again
// A bit of randomness makes them feel real, it's never used for the shuffle

import { scoreHand } from "./round.js";

export const PERSONALITIES = {
  cautious: { stayScore: 16, riskTolerance: 0.32, jitter: 3 },
  reckless: { stayScore: 24, riskTolerance: 0.52, jitter: 5 },
  // Takes one card each turn, then holds. Slow and steady
  holder: { stayScore: 13, riskTolerance: 0.3, jitter: 2, holdAfterHit: true },
};

// A hand with an unused "Second Chance" should push, not bank, that's what the card is for
// Only bank once the hand is really big
function sittingOnSecondChance(hand, p) {
  return hand.secondChance && scoreHand(hand) < p.stayScore * 2;
}

// Start of a turn with cards in hand, bank them or push for more
export function aiBankAtStart(hand, risk, p) {
  if (sittingOnSecondChance(hand, p)) return false; // Don't waste the "Second Chance"
  const s = scoreHand(hand);
  const target = p.stayScore + (Math.random() * 2 - 1) * p.jitter;
  return s >= target || risk > p.riskTolerance;
}

// While pushing, stop and keep the hand for next turn, or draw again
export function aiStop(hand, risk, p) {
  if (hand.cards.length === 0) return false; // Has to take at least one card
  if (sittingOnSecondChance(hand, p)) return false; // Keep pushing so it actually gets used
  if (p.holdAfterHit) return true; // Takes one card, then holds
  return risk > p.riskTolerance || scoreHand(hand) >= p.stayScore;
}
