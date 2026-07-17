// Runs the match and keeps the shoe hidden, the players only get snapshots
// Plays one bot or forced move per step so the screen can pace them

import { buildDeck, DECK_SIZE, shuffle } from "../engine/deck.js";
import { createShoe } from "../engine/shoe.js";
import { sha256Hex, randomSeedHex } from "../engine/rng.js";
import { PHASES, assertPhase } from "../engine/stateMachine.js";
import { newHand, applyNumber, applyModifier, scoreHand, uniqueCount, bustRisk } from "../engine/round.js";
import { createPlayer, createSession, sessionElapsedMs, needsRealityCheck } from "../engine/player.js";
import { PERSONALITIES, decideHit } from "../engine/ai.js";

const HUMAN_SEAT = 0;
const TOTAL_ROUNDS = 9;

export function createServer() {
  const session = createSession();
  const players = [
    createPlayer({ seat: 0, name: "You", isAI: false }),
    createPlayer({ seat: 1, name: "Nova", isAI: true, ai: PERSONALITIES.cautious }),
    createPlayer({ seat: 2, name: "Rook", isAI: true, ai: PERSONALITIES.reckless }),
  ];
  const n = players.length;

  let phase = PHASES.LOBBY;
  let roundNumber = 0;
  let currentSeat = 0;
  let dealer = 0;
  let forcedQueue = []; // Seats that still owe "Flip Three" draws, these go before normal turns
  let pendingChoice = null;
  let lastEvent = null;
  let matchWinner = null;
  let log = [];

  let serverSeed = null;
  let serverSeedHash = null;
  let clientSeed = "";
  let shoe = null;
  let lastReveal = null;

  const name = (seat) => players[seat].name;
  const poss = (seat) => (players[seat].name === "You" ? "Your" : `${players[seat].name}'s`);
  const anyActive = () => players.some((p) => p.turnState === "active");
  const inPlayCount = () => players.reduce((s, p) => s + p.hand.cards.length, 0) + (pendingChoice ? 1 : 0);

  function pushLog(msg) {
    log.push(msg);
    if (log.length > 9) log = log.slice(-9);
  }

  function nextActiveSeatAfter(seat) {
    for (let i = 1; i <= n; i++) {
      const cand = (seat + i) % n;
      if (players[cand].turnState === "active") return cand;
    }
    return null;
  }

  function bustRiskFor(seat) {
    const counts = shoe.remainingNumberCounts();
    return bustRisk(players[seat].hand, counts, shoe.counts().remaining);
  }

  async function drawInto(seat, { forced = false } = {}) {
    const card = await shoe.draw();
    return resolveCard(seat, card, { forced, auto: players[seat].isAI || forced });
  }

  function resolveCard(seat, card, { forced = false, auto = false }) {
    const hand = players[seat].hand;
    const tag = forced ? " (Flip Three)" : "";

    if (card.kind === "number") {
      const r = applyNumber(hand, card);
      if (r.saved) {
        const idx = hand.cards.findIndex((c) => c.kind === "action" && c.action === "second_chance");
        const scCard = idx >= 0 ? hand.cards.splice(idx, 1)[0] : { kind: "action", action: "second_chance" };
        hand.secondChance = false;
        shoe.discard([card, scCard]);
        pushLog(`${poss(seat)} Second Chance ate the duplicate ${card.value}`);
        lastEvent = { seat, kind: "saved", card };
        return { resolved: true };
      }
      if (r.bust) {
        shoe.discard([card]); // The card that matched
        pushLog(`${name(seat)} busted on ${card.value}${tag}`);
        lastEvent = { seat, kind: "bust", card };
        return { bust: true };
      }
      if (r.flip7) {
        pushLog(`${name(seat)} hit FLIP 7! +15${tag}`);
        lastEvent = { seat, kind: "flip7", card };
        return { flip7: true };
      }
      pushLog(`${name(seat)} flipped ${card.value}${tag}`);
      lastEvent = { seat, kind: "number", card };
      return { resolved: true };
    }

    if (card.kind === "modifier") {
      applyModifier(hand, card);
      pushLog(`${name(seat)} drew ${card.op === "mult" ? "×2" : "+" + card.amount}${tag}`);
      lastEvent = { seat, kind: "modifier", card };
      return { resolved: true };
    }

    if (card.action === "second_chance") {
      if (!hand.secondChance) {
        hand.secondChance = true;
        hand.cards.push(card);
        pushLog(`${name(seat)} kept a Second Chance`);
      } else {
        const t = players.find((q) => q.seat !== seat && q.turnState === "active" && !q.hand.secondChance);
        if (t) {
          t.hand.secondChance = true;
          t.hand.cards.push(card);
          pushLog(`${name(seat)} passed a Second Chance to ${t.name}`);
        } else {
          shoe.discard([card]);
          pushLog(`${name(seat)} discarded a spare Second Chance`);
        }
      }
      lastEvent = { seat, kind: "action", card };
      return { resolved: true };
    }

    // "Freeze" and "Flip Three" need a target
    if (auto) {
      const target = chooseActionTarget(card.action, seat);
      applyAction(card.action, seat, target, card);
      return { resolved: true };
    }
    pendingChoice = {
      type: card.action,
      seat,
      card,
      eligible: players.filter((q) => q.turnState === "active").map((q) => q.seat),
    };
    lastEvent = { seat, kind: "action", card };
    return { needsChoice: true };
  }

  function chooseActionTarget(action, seat) {
    const others = players.filter((p) => p.seat !== seat && p.turnState === "active");
    if (action === "freeze") {
      const ranked = others.sort((a, b) => scoreHand(b.hand) - scoreHand(a.hand));
      return ranked.length ? ranked[0].seat : seat;
    }
    const ranked = others.sort((a, b) => uniqueCount(b.hand) - uniqueCount(a.hand));
    return ranked.length ? ranked[0].seat : seat;
  }

  function applyAction(type, fromSeat, target, card) {
    shoe.discard([card]);
    if (type === "freeze") {
      pushLog(`${name(fromSeat)} froze ${name(target)} on ${scoreHand(players[target].hand)}`);
      lastEvent = { seat: target, kind: "frozen" };
      resolveSeat(target, "frozen"); // Frozen means their hand is banked now
      return;
    }
    pushLog(`${name(fromSeat)} played Flip Three on ${name(target)}`);
    forcedQueue.push(target, target, target);
    lastEvent = { seat: target, kind: "flip3" };
  }

  function bankHand(seat) {
    const p = players[seat];
    const gain = scoreHand(p.hand);
    p.totalScore += gain;
    p.lastGain = gain;
    p.roundDelta = gain;
    shoe.discard(p.hand.cards);
    p.hand = newHand();
    return gain;
  }

  // Ends a seat's turn without moving on to the next player
  function resolveSeat(seat, state) {
    players[seat].turnState = state;
    if (state === "banked" || state === "flip7" || state === "frozen") bankHand(seat);
    // Busted hands keep their cards on show until the next round starts
  }

  function endTurn(seat, state) {
    resolveSeat(seat, state);
    advanceTurn();
  }

  function advanceTurn() {
    const next = nextActiveSeatAfter(currentSeat);
    if (next === null) finishRound();
    else currentSeat = next;
  }

  function finishRound() {
    if (roundNumber >= TOTAL_ROUNDS) {
      matchWinner = [...players].sort((a, b) => b.totalScore - a.totalScore)[0].seat;
      lastReveal = { serverSeed, clientSeed, serverSeedHash };
      phase = PHASES.MATCH_END;
    } else {
      phase = PHASES.ROUND_END;
    }
  }

  function startNextRound() {
    pendingChoice = null;
    forcedQueue = [];
    lastEvent = null;
    for (const p of players) {
      shoe.discard(p.hand.cards); // Clears last round's cards, busted hands too
      p.hand = newHand();
      p.turnState = "active";
      p.roundDelta = 0;
    }
    dealer = (roundNumber - 1) % n; // Dealer moves clockwise
    currentSeat = dealer;
    phase = PHASES.ROUND;
    pushLog(`Round ${roundNumber}: ${name(dealer)} starts`);
  }

  async function aiAct(seat) {
    const p = players[seat];
    const wantHit = p.hand.cards.length === 0 || decideHit(p.hand, bustRiskFor(seat), p.ai);
    if (!wantHit) {
      pushLog(`${name(seat)} banked ${scoreHand(p.hand)}`);
      endTurn(seat, "banked");
      return;
    }
    const r = await drawInto(seat);
    if (r.bust) endTurn(seat, "busted");
    else if (r.flip7) endTurn(seat, "flip7");
    else advanceTurn(); // One card per turn, move on
  }

  async function startMatch() {
    assertPhase(phase, "START_MATCH");
    serverSeed = randomSeedHex(32);
    serverSeedHash = await sha256Hex(serverSeed);
    clientSeed = randomSeedHex(8);
    shoe = await createShoe({ serverSeed, clientSeed });
    for (const p of players) {
      p.totalScore = 0;
      p.lastGain = 0;
      p.roundDelta = 0;
      p.hand = newHand();
      p.turnState = "active";
    }
    matchWinner = null;
    lastReveal = null;
    log = [];
    roundNumber = 1;
    session.matchesPlayed += 1;
    startNextRound();
    return { ok: true, snapshot: snapshot() };
  }

  async function nextRound() {
    assertPhase(phase, "NEXT_ROUND");
    roundNumber += 1;
    startNextRound();
    return { ok: true, snapshot: snapshot() };
  }

  async function step() {
    assertPhase(phase, "STEP");
    if (pendingChoice) return { ok: false, snapshot: snapshot() };

    if (forcedQueue.length) {
      const seat = forcedQueue.shift();
      if (players[seat].turnState === "active") {
        const r = await drawInto(seat, { forced: true });
        if (r.bust) {
          forcedQueue = forcedQueue.filter((s) => s !== seat);
          resolveSeat(seat, "busted");
        } else if (r.flip7) {
          forcedQueue = forcedQueue.filter((s) => s !== seat);
          resolveSeat(seat, "flip7");
        }
      }
      if (!anyActive()) finishRound();
      else if (players[currentSeat].turnState !== "active") advanceTurn();
      return { ok: true, snapshot: snapshot() };
    }

    if (currentSeat === HUMAN_SEAT) return { ok: false, snapshot: snapshot() };
    if (players[currentSeat].turnState !== "active") {
      advanceTurn();
      return { ok: true, snapshot: snapshot() };
    }
    await aiAct(currentSeat);
    return { ok: true, snapshot: snapshot() };
  }

  async function hit() {
    assertPhase(phase, "HIT");
    if (pendingChoice || forcedQueue.length || currentSeat !== HUMAN_SEAT || players[HUMAN_SEAT].turnState !== "active") {
      return { ok: false, snapshot: snapshot() };
    }
    const r = await drawInto(HUMAN_SEAT);
    if (r.needsChoice) return { ok: true, snapshot: snapshot() };
    if (r.bust) endTurn(HUMAN_SEAT, "busted");
    else if (r.flip7) endTurn(HUMAN_SEAT, "flip7");
    else advanceTurn(); // One card per turn, move on
    return { ok: true, snapshot: snapshot() };
  }

  async function stay() {
    assertPhase(phase, "STAY");
    if (pendingChoice || forcedQueue.length || currentSeat !== HUMAN_SEAT || players[HUMAN_SEAT].hand.cards.length === 0) {
      return { ok: false, snapshot: snapshot() };
    }
    pushLog(`You banked ${scoreHand(players[HUMAN_SEAT].hand)}`);
    endTurn(HUMAN_SEAT, "banked");
    return { ok: true, snapshot: snapshot() };
  }

  async function resolveChoice({ targetSeat }) {
    assertPhase(phase, "RESOLVE_CHOICE");
    if (!pendingChoice || !pendingChoice.eligible.includes(targetSeat)) {
      return { ok: false, snapshot: snapshot() };
    }
    const { type, seat, card } = pendingChoice;
    pendingChoice = null;
    applyAction(type, seat, targetSeat, card);
    // Drawing the action card was the player's one card this turn, move on
    if (players[seat].turnState === "active") advanceTurn();
    else if (!anyActive()) finishRound();
    else if (players[currentSeat].turnState !== "active") advanceTurn();
    return { ok: true, snapshot: snapshot() };
  }

  async function getState() {
    return snapshot();
  }

  async function verify({ serverSeed: ss, clientSeed: cs, serverSeedHash: hash }) {
    const hashOk = (await sha256Hex(ss)) === hash;
    const recomputed = await shuffle(buildDeck(), { serverSeed: ss, clientSeed: cs, nonce: 1 });
    return { hashOk, deckOk: recomputed.length === DECK_SIZE };
  }

  function publicPlayer(p, acting) {
    return {
      seat: p.seat,
      name: p.name,
      isAI: p.isAI,
      isDealer: p.seat === dealer,
      turnState: p.turnState,
      numbers: p.hand.numbers.slice(),
      bustCard: p.hand.bustCard,
      modifiers: p.hand.modifiers.map((m) => ({ ...m })),
      secondChance: p.hand.secondChance,
      cardCount: p.hand.cards.length,
      uniqueCount: uniqueCount(p.hand),
      handScore: scoreHand(p.hand),
      roundDelta: p.roundDelta,
      totalScore: p.totalScore,
      isCurrent: p.seat === acting && phase === PHASES.ROUND,
    };
  }

  function snapshot() {
    const acting = forcedQueue.length ? forcedQueue[0] : currentSeat;
    const ranked = [...players].sort((a, b) => b.totalScore - a.totalScore);
    const human = players[HUMAN_SEAT];
    const yourTurn =
      phase === PHASES.ROUND && !pendingChoice && forcedQueue.length === 0 && currentSeat === HUMAN_SEAT && human.turnState === "active";
    return {
      phase,
      you: HUMAN_SEAT,
      round: { number: roundNumber, total: TOTAL_ROUNDS },
      dealer,
      shoe: shoe ? shoe.counts(inPlayCount()) : { remaining: DECK_SIZE, discard: 0, inPlay: 0, size: DECK_SIZE },
      actingSeat: acting,
      yourTurn,
      canBank: yourTurn && human.hand.cards.length > 0,
      autoStep:
        phase === PHASES.ROUND &&
        !pendingChoice &&
        (forcedQueue.length > 0 || (currentSeat !== HUMAN_SEAT && players[currentSeat].turnState === "active")),
      yourBustRisk: shoe ? bustRiskFor(HUMAN_SEAT) : 0,
      pendingChoice: pendingChoice
        ? { type: pendingChoice.type, eligible: pendingChoice.eligible.map((s) => ({ seat: s, name: name(s) })) }
        : null,
      players: players.map((p) => publicPlayer(p, acting)),
      standings: ranked.map((p) => ({ seat: p.seat, name: p.name, totalScore: p.totalScore })),
      winner: matchWinner,
      lastEvent,
      log: log.slice(-7),
      session: {
        elapsedMs: sessionElapsedMs(session),
        needsRealityCheck: needsRealityCheck(session),
        sessionTimeLimitMin: session.responsibleGaming.sessionTimeLimitMin,
      },
      fair: { serverSeedHash, clientSeed },
      reveal: lastReveal,
    };
  }

  return Object.freeze({ getState, startMatch, nextRound, step, hit, stay, resolveChoice, verify });
}
