// The full deck. There's one 0 and every other number appears as many times as its value

import { makeStream } from "./rng.js";

export const MAX_VALUE = 12;
export const DECK_SIZE = 97;

export const ACTIONS = ["freeze", "flip3", "second_chance", "see_future"];
export const ADD_MODIFIERS = [2, 4, 6, 8, 10];

export function buildDeck() {
  const cards = [];

  cards.push({ kind: "number", value: 0 });
  for (let v = 1; v <= MAX_VALUE; v++) {
    for (let i = 0; i < v; i++) cards.push({ kind: "number", value: v });
  }
  for (const action of ACTIONS) {
    for (let i = 0; i < 3; i++) cards.push({ kind: "action", action });
  }
  for (const amount of ADD_MODIFIERS) cards.push({ kind: "modifier", op: "add", amount });
  cards.push({ kind: "modifier", op: "mult", factor: 2 });

  return cards;
}

export function cardLabel(card) {
  if (card.kind === "number") return String(card.value);
  if (card.kind === "modifier") return card.op === "mult" ? "×2" : `+${card.amount}`;
  return { freeze: "FRZ", flip3: "+3", second_chance: "2ND", see_future: "👁" }[card.action];
}

// Fair shuffle anyone can check, the same seeds always give the same order
export async function shuffle(cards, { serverSeed, clientSeed, nonce }) {
  const out = cards.slice();
  const stream = await makeStream(serverSeed, clientSeed, nonce);
  for (let i = out.length - 1; i > 0; i--) {
    const j = await stream.randBelow(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
