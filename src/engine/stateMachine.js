// The server checks every action against the phase, so a player can't draw during the round summary

export const PHASES = Object.freeze({
  LOBBY: "lobby",
  ROUND: "round",
  ROUND_END: "round_end", // Round scored, waiting to deal the next one
  MATCH_END: "match_end",
});

// Which phases each action is allowed in
const ALLOWED = Object.freeze({
  START_MATCH: [PHASES.LOBBY, PHASES.MATCH_END],
  HIT: [PHASES.ROUND],
  STAY: [PHASES.ROUND],
  STOP: [PHASES.ROUND], // Ends your turn after drawing, keeping your hand to bank later
  STEP: [PHASES.ROUND], // Plays one bot or forced move, the game sets the pace
  RESOLVE_CHOICE: [PHASES.ROUND],
  NEXT_ROUND: [PHASES.ROUND_END],
});

export function canDo(phase, intent) {
  const from = ALLOWED[intent];
  return Array.isArray(from) && from.includes(phase);
}

export function assertPhase(phase, intent) {
  if (!canDo(phase, intent)) {
    throw new Error(`Illegal intent: ${intent} not allowed in phase "${phase}"`);
  }
}
