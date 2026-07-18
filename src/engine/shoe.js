// Cards stay in players' hands until banked or bust, the shoe only reshuffles when it runs out
// So the shoe thins out as the match goes on and counting cards pays off

import { buildDeck, DECK_SIZE, shuffle } from "./deck.js";

export async function createShoe({ serverSeed, clientSeed, restore = null }) {
  let nonce = 0;
  let order = [];
  let cursor = 0;
  let discardPile = [];

  async function reshuffleFrom(cards) {
    nonce += 1;
    order = await shuffle(cards, { serverSeed, clientSeed, nonce });
    cursor = 0;
  }

  if (restore) {
    nonce = restore.nonce;
    order = restore.order.map((c) => ({ ...c }));
    cursor = restore.cursor;
    discardPile = restore.discard.map((c) => ({ ...c }));
  } else {
    await reshuffleFrom(buildDeck());
  }

  async function draw() {
    if (cursor >= order.length) {
      await reshuffleFrom(discardPile); // Shoe is empty, so shuffle the discards back in
      discardPile = [];
    }
    return order[cursor++];
  }

  function discard(cards) {
    if (cards && cards.length) discardPile.push(...cards);
  }

  // Shows the next card without drawing it, for "See the Future"
  // Null when the shoe is empty, the next shuffle hasn't happened yet
  function peek() {
    return cursor < order.length ? { ...order[cursor] } : null;
  }

  // Unseen cards left in the shoe by number, for honest bust odds
  function remainingNumberCounts() {
    const counts = {};
    for (let i = cursor; i < order.length; i++) {
      const c = order[i];
      if (c.kind === "number") counts[c.value] = (counts[c.value] || 0) + 1;
    }
    return counts;
  }

  function counts(inPlay = 0) {
    return {
      remaining: order.length - cursor,
      discard: discardPile.length,
      inPlay,
      size: DECK_SIZE,
      reshuffles: nonce - 1,
    };
  }

  // Everything needed to save and resume the shoe
  function getState() {
    return { nonce, order, cursor, discard: discardPile };
  }

  return { draw, discard, peek, remainingNumberCounts, counts, getState, getNonce: () => nonce };
}
