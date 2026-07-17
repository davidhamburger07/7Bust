// Cards stay in players' hands until banked or bust, the shoe only reshuffles when it runs out
// So the shoe thins out as the match goes on and counting cards pays off

import { buildDeck, DECK_SIZE, shuffle } from "./deck.js";

export async function createShoe({ serverSeed, clientSeed }) {
  let nonce = 0;
  let order = [];
  let cursor = 0;
  let discardPile = [];

  async function reshuffleFrom(cards) {
    nonce += 1;
    order = await shuffle(cards, { serverSeed, clientSeed, nonce });
    cursor = 0;
  }

  await reshuffleFrom(buildDeck());

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

  return { draw, discard, remainingNumberCounts, counts, getNonce: () => nonce };
}
