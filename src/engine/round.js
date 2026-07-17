// Hand rules and scoring. cards holds the real cards so they go to the discard pile at the end

export const TARGET_UNIQUE = 7; // Different numbers needed for a "Clean 7"
export const CLEAN7_BONUS = 15;

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
  if (hand.numbers.length >= TARGET_UNIQUE) return { cleanSeven: true, value };
  return { ok: true, value };
}

export function applyModifier(hand, card) {
  hand.modifiers.push(card);
  hand.cards.push(card);
}

// Numbers added up, doubled by the x2 card, plus the + cards and the "Clean 7" bonus
export function scoreHand(hand) {
  let base = hand.numbers.reduce((s, v) => s + v, 0);
  if (hand.modifiers.some((m) => m.op === "mult")) base *= 2;
  base += hand.modifiers.filter((m) => m.op === "add").reduce((s, m) => s + m.amount, 0);
  if (hand.numbers.length >= TARGET_UNIQUE) base += CLEAN7_BONUS;
  return base;
}

// Saving a hand so a match can resume
export function serializeHand(hand) {
  return {
    numbers: hand.numbers.slice(),
    modifiers: hand.modifiers.map((m) => ({ ...m })),
    secondChance: hand.secondChance,
    cards: hand.cards.map((c) => ({ ...c })),
    bustCard: hand.bustCard,
  };
}

export function deserializeHand(data) {
  const h = newHand();
  h.numbers = data.numbers.slice();
  h.numberSet = new Set(data.numbers);
  h.modifiers = data.modifiers.map((m) => ({ ...m }));
  h.secondChance = data.secondChance;
  h.cards = data.cards.map((c) => ({ ...c }));
  h.bustCard = data.bustCard;
  return h;
}

// Bust risk from what everyone can see, any unseen copy of a number you hold would bust you
export function bustRisk(hand, remainingCounts, remainingTotal) {
  if (!hand.numbers.length || remainingTotal <= 0) return 0;
  const losing = hand.numbers.reduce((sum, v) => sum + (remainingCounts[v] || 0), 0);
  return losing / remainingTotal;
}
