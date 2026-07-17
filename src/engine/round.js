// Hand rules and scoring. cards holds the real cards so they go to the discard pile at the end

export const TARGET_UNIQUE = 7; // Different numbers needed for a "Flip 7"
export const FLIP7_BONUS = 15;

export function newHand() {
  return {
    numbers: [],
    numberSet: new Set(),
    modifiers: [],
    secondChance: false,
    cards: [], // Every card in the hand, so they can be discarded at the end
    bustCard: null, // The repeat that bust this hand, shown next to the first one
  };
}

export function uniqueCount(hand) {
  return hand.numbers.length;
}

export function isEmpty(hand) {
  return hand.cards.length === 0;
}

// The caller handles discards and whose turn it is
export function applyNumber(hand, card) {
  const value = card.value;
  if (hand.numberSet.has(value)) {
    if (hand.secondChance) return { saved: true, value }; // The caller uses up the "Second Chance"
    hand.bustCard = value;
    return { bust: true, value };
  }
  hand.numberSet.add(value);
  hand.numbers.push(value);
  hand.cards.push(card);
  if (hand.numbers.length >= TARGET_UNIQUE) return { flip7: true, value };
  return { ok: true, value };
}

export function applyModifier(hand, card) {
  hand.modifiers.push(card);
  hand.cards.push(card);
}

// Numbers added up, doubled by the x2 card, plus the + cards and the "Flip 7" bonus
export function scoreHand(hand) {
  let base = hand.numbers.reduce((s, v) => s + v, 0);
  if (hand.modifiers.some((m) => m.op === "mult")) base *= 2;
  base += hand.modifiers.filter((m) => m.op === "add").reduce((s, m) => s + m.amount, 0);
  if (hand.numbers.length >= TARGET_UNIQUE) base += FLIP7_BONUS;
  return base;
}

// Bust risk from what everyone can see, any unseen copy of a number you hold would bust you
export function bustRisk(hand, remainingCounts, remainingTotal) {
  if (!hand.numbers.length || remainingTotal <= 0) return 0;
  const losing = hand.numbers.reduce((sum, v) => sum + (remainingCounts[v] || 0), 0);
  return losing / remainingTotal;
}
