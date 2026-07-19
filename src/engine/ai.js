// How the bots play. Each turn they bank or push at the start, then stop or draw again
// Risk is the real bust chance from the deck. The random bits are only for feel, not the shuffle

import { scoreHand } from "./round.js";

export const PERSONALITIES = {
  rook: { key: "rook", minBankCards: 3, buildTo: 4, riskTolerance: 0.5, panicRisk: 0.75 },
  nova: { key: "nova", lowRisk: 0.18, maxCards: 3 },
  pip: { key: "pip", holdAfterHit: true, bankAt: 2 },
};

// A hand with an unused "Second Chance" should push, not bank, that's what the card is for
// Only bank once the hand is really big
function sittingOnSecondChance(hand) {
  return hand.secondChance && scoreHand(hand) < 30;
}

// Start of a turn with cards in hand, bank them or push for more
export function aiBankAtStart(hand, risk, p) {
  const cards = hand.cards.length;
  if (cards === 0) return false;
  if (sittingOnSecondChance(hand)) return false;

  if (p.key === "rook") {
    if (cards < p.minBankCards) return false; // Never banks under 3 cards, whatever the risk
    if (cards >= p.buildTo) return true; // The 4 card pile he was building, bank it
    // At exactly 3 cards, bank when the deck turns really bad, otherwise often push on
    return risk > p.riskTolerance || Math.random() < 0.35;
  }
  if (p.key === "nova") {
    if (cards >= p.maxCards) return true; // She never goes past 3 cards
    return risk >= p.lowRisk; // The risk isn't low anymore, take the sure points
  }
  // Pip
  if (cards > p.bankAt) return true; // More cards than that is a fortune to Pip
  if (cards === p.bankAt) return Math.random() < 0.7; // Usually banks here
  return false;
}

// While pushing, stop and keep the hand for next turn, or draw again
export function aiStop(hand, risk, p) {
  if (hand.cards.length === 0) return false; // Has to take at least one card
  if (sittingOnSecondChance(hand)) return false; // Keep pushing so it actually gets used
  if (p.holdAfterHit) return true; // Pip takes one card each turn, then holds

  const cards = hand.cards.length;
  if (p.key === "rook") {
    if (cards >= p.buildTo) return true; // Built his pile, stop and bank next turn
    if (cards < p.minBankCards) return risk > p.panicRisk; // Under 3 cards only a huge risk stops him
    return risk > p.riskTolerance; // At 3 cards he happily hits through anything under 50%
  }
  // Nova
  if (cards >= p.maxCards) return true;
  return risk >= p.lowRisk; // Only draws while the bust chance stays low
}
