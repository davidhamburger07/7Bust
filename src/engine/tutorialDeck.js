// Stacked tutorial deck so the player is sure to see "Second Chance", "Freeze" and "Flip Three"
// "Flip Three" comes last because its flips draw from the shoe too

import { buildDeck } from "./deck.js";

// The player's first turn in order, each card matches a step in the tutorial script
// The last three are different numbers so the "Flip Three" target can't bust early
const TUTORIAL_TOP = [
  { kind: "number", value: 3 },
  { kind: "number", value: 5 },
  { kind: "action", action: "second_chance" },
  { kind: "number", value: 3 },
  { kind: "action", action: "freeze" },
  { kind: "action", action: "flip3" },
  { kind: "number", value: 6 },
  { kind: "number", value: 8 },
  { kind: "number", value: 9 },
];

// Takes the stacked cards out of the full deck so there are no extra copies and bust odds stay right
function pullOne(pool, spec) {
  const i = pool.findIndex((c) =>
    c.kind === spec.kind &&
    (spec.kind === "number" ? c.value === spec.value : spec.kind === "action" ? c.action === spec.action : true),
  );
  if (i >= 0) pool.splice(i, 1);
}

export function buildTutorialDeck() {
  const rest = buildDeck();
  for (const card of TUTORIAL_TOP) pullOne(rest, card);
  return [...TUTORIAL_TOP.map((c) => ({ ...c })), ...rest];
}
