import { newHand } from "./round.js";

export function createPlayer({ seat, name, isAI = false, ai = null }) {
  return {
    seat,
    name,
    isAI,
    ai,
    totalScore: 0,
    hand: newHand(), // Reset every round, hands don't carry over
    turnState: "active", // active, banked, busted, flip7 or frozen, reset each round
    lastGain: 0,
    roundDelta: 0,
  };
}

export function resetHand(player) {
  player.hand = newHand();
}

// Session time limits and reality checks, kept for app store and gambling rules
// The match scores points now instead of money, but these stay anyway
export function createSession(overrides = {}) {
  const now = Date.now();
  return {
    sessionId: `s_${now}`,
    startedAt: now,
    matchesPlayed: 0,
    responsibleGaming: {
      sessionTimeLimitMin: overrides.sessionTimeLimitMin ?? 60,
      realityCheckIntervalMin: overrides.realityCheckIntervalMin ?? 15,
      lastRealityCheckAt: now,
      coolingOffUntil: null,
      selfExcludedUntil: null,
    },
  };
}

export function sessionElapsedMs(session, at = Date.now()) {
  return at - session.startedAt;
}

export function needsRealityCheck(session, at = Date.now()) {
  const rg = session.responsibleGaming;
  return at - rg.lastRealityCheckAt >= rg.realityCheckIntervalMin * 60 * 1000;
}
