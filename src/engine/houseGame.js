// Single-player against the house. The player draws first so the house wins every player bust
// Raising the dealer's stand line makes it bust more, which hands the edge to the player

import { shuffle } from "./deck.js";

export const HOUSE_MAX_VALUE = 12;
export const HOUSE_DECK_SIZE = 78;
export const DEALER_STAND = 24;
export const WIN_MULTIPLIER = 2; // Even money, a win gives back your bet plus the same again

export const OUTCOMES = {
  PLAYER_BUST: "player_bust", // Player drew a number they already had, they lose and the dealer doesn't draw
  DEALER_BUST: "dealer_bust",
  PLAYER_WIN: "player_win",
  HOUSE_WIN: "house_win", // Nobody bust, ties go to the dealer
};

// Same card shape as the main deck so the screen can draw these like any number card
export function buildHouseDeck() {
  const cards = [];
  for (let v = 1; v <= HOUSE_MAX_VALUE; v++) {
    for (let i = 0; i < v; i++) cards.push({ kind: "number", value: v });
  }
  return cards;
}

// Fair deal order the player can check, same as the party game
export async function shuffleHouseDeck({ serverSeed, clientSeed, nonce }) {
  return shuffle(buildHouseDeck(), { serverSeed, clientSeed, nonce });
}

export function newHouseHand() {
  return {
    values: [],
    seen: new Set(),
    score: 0,
    busted: false,
    bustValue: null, // The repeat that bust it, shown next to the first one
  };
}

export function takeCard(hand, card) {
  const value = card.value;
  if (hand.seen.has(value)) {
    hand.busted = true;
    hand.bustValue = value;
    return { bust: true, value };
  }
  hand.seen.add(value);
  hand.values.push(value);
  hand.score += value;
  return { bust: false, value, score: hand.score };
}

// One round with a bet. The dealer plays out straight away when the player stays
// Dealer values keep the draw order so the screen can reveal them one by one
export function createHouseGame({ deck, wager = 1, dealerStand = DEALER_STAND } = {}) {
  if (!Array.isArray(deck) || !deck.length) throw new Error("createHouseGame: deck required");

  let cursor = 0;
  const player = newHouseHand();
  const dealer = newHouseHand();
  let phase = "player";
  let outcome = null;
  let payout = 0;

  // Count of each value still in the deck, so the bust odds shown are honest
  const counts = new Array(HOUSE_MAX_VALUE + 1).fill(0);
  for (const card of deck) counts[card.value] += 1;

  const remaining = () => deck.length - cursor;

  function drawCard() {
    const card = deck[cursor++];
    counts[card.value] -= 1;
    return card;
  }

  // Chance the next card busts this hand, worked out from the cards still in the deck
  function bustChanceFor(hand) {
    const left = remaining();
    if (!left || !hand.values.length) return 0;
    let losing = 0;
    for (const v of hand.values) losing += counts[v];
    return losing / left;
  }

  function settle(result) {
    outcome = result;
    phase = "settled";
    const won = result === OUTCOMES.DEALER_BUST || result === OUTCOMES.PLAYER_WIN;
    payout = won ? wager * WIN_MULTIPLIER : 0;
  }

  function runDealer() {
    while (dealer.score < dealerStand && remaining() > 0) {
      if (takeCard(dealer, drawCard()).bust) {
        settle(OUTCOMES.DEALER_BUST);
        return;
      }
    }
    settle(dealer.score >= player.score ? OUTCOMES.HOUSE_WIN : OUTCOMES.PLAYER_WIN);
  }

  function hit() {
    if (phase !== "player") throw new Error(`hit() in phase "${phase}"`);
    if (!remaining()) throw new Error("hit() with an empty deck");
    const res = takeCard(player, drawCard());
    if (res.bust) settle(OUTCOMES.PLAYER_BUST); // The dealer never draws, the house already won
    return res;
  }

  function stay() {
    if (phase !== "player") throw new Error(`stay() in phase "${phase}"`);
    if (!player.values.length) throw new Error("cannot freeze on an empty hand");
    phase = "dealer";
    runDealer();
  }

  // What the player can see on their turn, the dealer hasn't drawn yet so nothing leaks
  function playerView() {
    return {
      score: player.score,
      values: player.values.slice(),
      count: player.values.length,
      bustChance: bustChanceFor(player),
      deckRemaining: remaining(),
      wager,
      dealerStand,
    };
  }

  function state() {
    return {
      phase,
      outcome,
      wager,
      payout,
      net: payout - wager,
      dealerStand,
      player: {
        values: player.values.slice(),
        score: player.score,
        busted: player.busted,
        bustValue: player.bustValue,
      },
      dealer: {
        values: dealer.values.slice(),
        score: dealer.score,
        busted: dealer.busted,
        bustValue: dealer.bustValue,
        drew: dealer.values.length > 0 || dealer.busted,
      },
      deckRemaining: remaining(),
    };
  }

  return {
    hit,
    stay,
    state,
    playerView,
    bustChance: () => bustChanceFor(player),
    // Copies of each value still in the deck, the live deck strip shows this
    remainingByValue: () => counts.slice(),
    phase: () => phase,
    outcome: () => outcome,
    canHit: () => phase === "player" && remaining() > 0,
    canStay: () => phase === "player" && player.values.length > 0,
  };
}

// Bot strategies and a round runner with no UI, used by the simulator and the practice bots

export function standAt(threshold) {
  const fn = (view) => (view.count > 0 && view.score >= threshold ? "stay" : "hit");
  fn.label = `stand at ${threshold}`;
  fn.threshold = threshold;
  return fn;
}

export function standAtRisk(maxRisk) {
  const fn = (view) => (view.count > 0 && view.bustChance >= maxRisk ? "stay" : "hit");
  fn.label = `stand above ${(maxRisk * 100).toFixed(0)}% bust risk`;
  return fn;
}

// Plays a whole round with no UI, the deck must already be shuffled
export function playRound({ deck, wager = 1, dealerStand = DEALER_STAND, strategy = standAt(35) } = {}) {
  const game = createHouseGame({ deck, wager, dealerStand });
  while (game.phase() === "player") {
    const wantsStay = strategy(game.playerView()) === "stay";
    // A strategy can't stay with no cards, and can't draw from an empty deck
    if ((wantsStay && game.canStay()) || !game.canHit()) game.stay();
    else game.hit();
  }
  return game.state();
}
