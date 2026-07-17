// Runs the match and keeps the shoe hidden, the players only get snapshots
// Plays one bot or forced move per step so the screen can pace them

import { buildDeck, DECK_SIZE, shuffle } from "../engine/deck.js";
import { createShoe } from "../engine/shoe.js";
import { sha256Hex, randomSeedHex } from "../engine/rng.js";
import { PHASES, assertPhase } from "../engine/stateMachine.js";
import { newHand, applyNumber, applyModifier, scoreHand, uniqueCount, bustRisk, serializeHand, deserializeHand } from "../engine/round.js";
import { createPlayer, createSession, sessionElapsedMs, needsRealityCheck } from "../engine/player.js";
import { PERSONALITIES, aiBankAtStart, aiStop } from "../engine/ai.js";
import { ENTRY_TIERS, DEFAULT_ENTRY, HOUSE_RAKE, STARTING_BALANCE, buildPot, payoutPerWinner } from "../engine/tournament.js";

const HUMAN_SEAT = 0;
const TOTAL_ROUNDS = 9;

// Single player is you against bots with the wallet
// Multiplayer uses the room's seats and no chips
export function createServer(config = {}) {
  const cashless = !!config.cashless;
  const session = createSession();
  const roster = config.players || [
    { name: "You", isAI: false },
    { name: "Nova", isAI: true, ai: PERSONALITIES.cautious },
    { name: "Rook", isAI: true, ai: PERSONALITIES.reckless },
    { name: "Pip", isAI: true, ai: PERSONALITIES.holder },
  ];
  const players = roster.map((p, seat) => createPlayer({ seat, name: p.name, isAI: p.isAI, ai: p.ai || null }));
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
  let tournament = null;

  const name = (seat) => players[seat].name;
  const poss = (seat) => (players[seat].name === "You" ? "Your" : `${players[seat].name}'s`);
  const anyActive = () => players.some((p) => p.turnState === "active");
  const inPlayCount = () => players.reduce((s, p) => s + p.hand.cards.length, 0) + (pendingChoice ? 1 : 0);

  // The log type sets its colour in the UI, the whole match log is kept for scrolling back
  function pushLog(text, type = "info") {
    log.push({ text, type });
    if (log.length > 400) log = log.slice(-400);
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
        pushLog(`${poss(seat)} Second Chance ate the duplicate ${card.value}`, "second");
        lastEvent = { seat, kind: "saved", card };
        return { resolved: true };
      }
      if (r.bust) {
        shoe.discard([card]); // The card that matched
        pushLog(`${name(seat)} busted on ${card.value}${tag}`, "bust");
        lastEvent = { seat, kind: "bust", card };
        return { bust: true };
      }
      if (r.cleanSeven) {
        pushLog(`${name(seat)} hit a CLEAN 7! +15, round over${tag}`, "clean7");
        lastEvent = { seat, kind: "clean7", card };
        return { cleanSeven: true };
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
        pushLog(`${name(seat)} kept a Second Chance`, "second");
      } else {
        const t = players.find((q) => q.seat !== seat && q.turnState === "active" && !q.hand.secondChance);
        if (t) {
          t.hand.secondChance = true;
          t.hand.cards.push(card);
          pushLog(`${name(seat)} passed a Second Chance to ${t.name}`, "second");
        } else {
          shoe.discard([card]);
          pushLog(`${name(seat)} discarded a spare Second Chance`, "second");
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
      pushLog(`${name(fromSeat)} froze ${name(target)}, banks ${scoreHand(players[target].hand)}`, "freeze");
      lastEvent = { seat: target, kind: "frozen" };
      resolveSeat(target, "frozen"); // Frozen means their hand is banked now
      return;
    }
    pushLog(`${name(fromSeat)} played Flip Three on ${name(target)}`, "flip3");
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
    if (state === "banked" || state === "clean7" || state === "frozen") bankHand(seat);
    // Busted hands keep their cards on show until the next round starts
  }

  function endTurn(seat, state) {
    resolveSeat(seat, state);
    advanceTurn();
  }

  function advanceTurn() {
    const next = nextActiveSeatAfter(currentSeat);
    if (next === null) {
      finishRound();
    } else {
      currentSeat = next;
      players[next].hitThisTurn = false; // New turn, banking is allowed again
    }
  }

  // "Clean 7" ends the round, everyone still in banks and the player who got it gets the bonus
  function endRoundByCleanSeven(flipperSeat) {
    for (const p of players) {
      if (p.turnState === "active") resolveSeat(p.seat, p.seat === flipperSeat ? "clean7" : "banked");
    }
    finishRound();
  }

  function finishRound() {
    if (roundNumber >= TOTAL_ROUNDS) {
      // Ranks the players and pays out the pot, top scorers split it and the house keeps its rake
      // The player's wallet gets paid if they placed
      const maxTotal = Math.max(...players.map((p) => p.totalScore));
      const winnerSeats = players.filter((p) => p.totalScore === maxTotal).map((p) => p.seat);
      matchWinner = winnerSeats[0];
      if (!cashless && tournament) {
        // Top scorers split the pot and the house keeps its rake
        // The single player wallet gets paid if they placed
        const each = payoutPerWinner(tournament.prizePool, winnerSeats.length);
        const youWon = winnerSeats.includes(HUMAN_SEAT);
        tournament.winnerSeats = winnerSeats;
        tournament.payout = each;
        tournament.youPayout = youWon ? each : 0;
        tournament.youNet = tournament.youPayout - tournament.entryFee;
        tournament.settled = true;
        if (youWon) session.balance += each;
      }
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
      p.hitThisTurn = false;
      p.roundDelta = 0;
    }
    dealer = (roundNumber - 1) % n; // Dealer moves clockwise
    currentSeat = dealer;
    phase = PHASES.ROUND;
    pushLog(`Round ${roundNumber}: ${name(dealer)} starts`, "round");
  }

  async function aiAct(seat) {
    const p = players[seat];
    const risk = bustRiskFor(seat);
    if (!p.hitThisTurn && p.hand.cards.length > 0 && aiBankAtStart(p.hand, risk, p.ai)) {
      pushLog(`${name(seat)} banked ${scoreHand(p.hand)}`, "bank");
      endTurn(seat, "banked");
      return;
    }
    // Mid turn, the bot can stop and bank next turn instead of drawing again
    if (p.hitThisTurn && aiStop(p.hand, risk, p.ai)) {
      pushLog(`${name(seat)} stops on ${scoreHand(p.hand)} (banks next turn)`, "stop");
      advanceTurn();
      return;
    }
    p.hitThisTurn = true;
    const r = await drawInto(seat);
    if (r.bust) endTurn(seat, "busted");
    else if (r.cleanSeven) endRoundByCleanSeven(seat);
    else if (players[seat].turnState !== "active") advanceTurn(); // Like drawing "Freeze" and using it on themselves
    // Keeps the turn, the bot decides again next step
  }

  async function startMatch({ entryFee = DEFAULT_ENTRY } = {}) {
    assertPhase(phase, "START_MATCH");
    if (cashless) {
      // Multiplayer has no wallet or pot, just play to win
      tournament = null;
    } else {
      const fee = ENTRY_TIERS.includes(entryFee) ? entryFee : DEFAULT_ENTRY;
      if (session.balance < fee) {
        return { ok: false, reason: "insufficient-balance", snapshot: snapshot() };
      }
      session.balance -= fee;
      tournament = { ...buildPot(fee, n), settled: false, payout: 0, winnerSeats: [], youPayout: 0, youNet: -fee };
    }

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
      p.hitThisTurn = false;
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
        } else if (r.cleanSeven) {
          forcedQueue = [];
          endRoundByCleanSeven(seat);
          return { ok: true, snapshot: snapshot() };
        }
      }
      if (!anyActive()) finishRound();
      else if (players[currentSeat].turnState !== "active") advanceTurn();
      return { ok: true, snapshot: snapshot() };
    }

    if (!players[currentSeat].isAI) return { ok: false, snapshot: snapshot() }; // A player's turn, wait for their move
    if (players[currentSeat].turnState !== "active") {
      advanceTurn();
      return { ok: true, snapshot: snapshot() };
    }
    await aiAct(currentSeat);
    return { ok: true, snapshot: snapshot() };
  }

  async function hit(seat = HUMAN_SEAT) {
    assertPhase(phase, "HIT");
    const me = players[seat];
    if (pendingChoice || forcedQueue.length || currentSeat !== seat || me.isAI || me.turnState !== "active") {
      return { ok: false, snapshot: snapshot(seat) };
    }
    me.hitThisTurn = true;
    const r = await drawInto(seat);
    if (r.needsChoice) return { ok: true, snapshot: snapshot(seat) };
    if (r.bust) endTurn(seat, "busted");
    else if (r.cleanSeven) endRoundByCleanSeven(seat);
    else if (me.turnState !== "active") advanceTurn(); // In case they used "Freeze" on themselves
    // Keeps the turn, the player can draw again or stop
    return { ok: true, snapshot: snapshot(seat) };
  }

  async function stay(seat = HUMAN_SEAT) {
    assertPhase(phase, "STAY");
    // Can only bank as the first move of a turn, and never with an empty hand
    const me = players[seat];
    if (pendingChoice || forcedQueue.length || currentSeat !== seat || me.isAI || me.hitThisTurn || me.hand.cards.length === 0) {
      return { ok: false, snapshot: snapshot(seat) };
    }
    pushLog(`${name(seat)} banked ${scoreHand(me.hand)}`, "bank");
    endTurn(seat, "banked");
    return { ok: true, snapshot: snapshot(seat) };
  }

  async function stop(seat = HUMAN_SEAT) {
    assertPhase(phase, "STOP");
    // Ends the turn after drawing, the hand is kept to bank later
    const me = players[seat];
    if (pendingChoice || forcedQueue.length || currentSeat !== seat || me.isAI || !me.hitThisTurn) {
      return { ok: false, snapshot: snapshot(seat) };
    }
    pushLog(`${name(seat)} stops on ${scoreHand(me.hand)} (banks next turn)`, "stop");
    lastEvent = { seat, kind: "stop" };
    advanceTurn();
    return { ok: true, snapshot: snapshot(seat) };
  }

  async function resolveChoice({ targetSeat, actor } = {}) {
    assertPhase(phase, "RESOLVE_CHOICE");
    if (!pendingChoice || !pendingChoice.eligible.includes(targetSeat)) {
      return { ok: false, snapshot: snapshot() };
    }
    if (actor != null && actor !== pendingChoice.seat) return { ok: false, snapshot: snapshot(actor) }; // Only the player who drew it picks
    const { type, seat, card } = pendingChoice;
    pendingChoice = null;
    applyAction(type, seat, targetSeat, card);
    // Drawing the action card counts as the turn's draw, the player keeps the turn
    // unless they froze themselves
    if (players[seat].turnState !== "active") advanceTurn();
    return { ok: true, snapshot: snapshot(seat) };
  }

  async function getState(youSeat = HUMAN_SEAT) {
    return snapshot(youSeat);
  }

  // Saves the whole game so a player who reconnects can carry on
  // A real game server would keep this, here it goes in the browser
  function serialize() {
    return {
      v: 2,
      phase,
      roundNumber,
      currentSeat,
      dealer,
      forcedQueue: forcedQueue.slice(),
      pendingChoice,
      lastEvent,
      matchWinner,
      log: log.slice(),
      serverSeed,
      serverSeedHash,
      clientSeed,
      shoe: shoe ? shoe.getState() : null,
      wallet: { balance: session.balance, matchesPlayed: session.matchesPlayed },
      tournament,
      players: players.map((p) => ({
        seat: p.seat,
        totalScore: p.totalScore,
        turnState: p.turnState,
        hitThisTurn: p.hitThisTurn,
        lastGain: p.lastGain,
        roundDelta: p.roundDelta,
        hand: serializeHand(p.hand),
      })),
    };
  }

  async function restore(blob) {
    if (!blob || blob.v !== 2) return { ok: false, snapshot: snapshot() };
    phase = blob.phase;
    roundNumber = blob.roundNumber;
    currentSeat = blob.currentSeat;
    dealer = blob.dealer;
    forcedQueue = (blob.forcedQueue || []).slice();
    pendingChoice = blob.pendingChoice || null;
    lastEvent = blob.lastEvent || null;
    matchWinner = blob.matchWinner ?? null;
    log = (blob.log || []).slice();
    serverSeed = blob.serverSeed;
    serverSeedHash = blob.serverSeedHash;
    clientSeed = blob.clientSeed;
    session.balance = blob.wallet?.balance ?? session.balance;
    session.matchesPlayed = blob.wallet?.matchesPlayed ?? session.matchesPlayed;
    tournament = blob.tournament || null;
    for (const pd of blob.players || []) {
      const p = players[pd.seat];
      p.totalScore = pd.totalScore;
      p.turnState = pd.turnState;
      p.hitThisTurn = pd.hitThisTurn;
      p.lastGain = pd.lastGain;
      p.roundDelta = pd.roundDelta;
      p.hand = deserializeHand(pd.hand);
    }
    shoe = blob.shoe ? await createShoe({ serverSeed, clientSeed, restore: blob.shoe }) : null;
    return { ok: true, snapshot: snapshot() };
  }

  // Tops a broke wallet back up so the demo can't get stuck
  async function resetBalance() {
    if (phase === PHASES.ROUND) return { ok: false, snapshot: snapshot() };
    session.balance = STARTING_BALANCE;
    return { ok: true, snapshot: snapshot() };
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

  // Most of the table is the same for everyone, only the fields about you change per seat
  function snapshot(youSeat = HUMAN_SEAT) {
    const acting = forcedQueue.length ? forcedQueue[0] : currentSeat;
    const ranked = [...players].sort((a, b) => b.totalScore - a.totalScore);
    const me = players[youSeat] || players[HUMAN_SEAT];
    const seat = me.seat;
    const yourTurn =
      phase === PHASES.ROUND && !pendingChoice && forcedQueue.length === 0 && currentSeat === seat && me.turnState === "active";
    return {
      phase,
      you: seat,
      cashless,
      round: { number: roundNumber, total: TOTAL_ROUNDS },
      dealer,
      shoe: shoe ? shoe.counts(inPlayCount()) : { remaining: DECK_SIZE, discard: 0, inPlay: 0, size: DECK_SIZE },
      actingSeat: acting,
      yourTurn,
      youHitThisTurn: me.hitThisTurn,
      canBank: yourTurn && !me.hitThisTurn && me.hand.cards.length > 0,
      autoStep:
        phase === PHASES.ROUND &&
        !pendingChoice &&
        (forcedQueue.length > 0 || (players[currentSeat].isAI && players[currentSeat].turnState === "active")),
      yourBustRisk: shoe ? bustRiskFor(seat) : 0,
      pendingChoice:
        pendingChoice && pendingChoice.seat === seat
          ? { type: pendingChoice.type, eligible: pendingChoice.eligible.map((s) => ({ seat: s, name: name(s) })) }
          : null,
      pendingSeat: pendingChoice ? pendingChoice.seat : null,
      players: players.map((p) => publicPlayer(p, acting)),
      standings: ranked.map((p) => ({ seat: p.seat, name: p.name, totalScore: p.totalScore })),
      winner: matchWinner,
      lastEvent,
      log: log.slice(-150),
      session: {
        elapsedMs: sessionElapsedMs(session),
        needsRealityCheck: needsRealityCheck(session),
        sessionTimeLimitMin: session.responsibleGaming.sessionTimeLimitMin,
      },
      fair: { serverSeedHash, clientSeed },
      reveal: lastReveal,
      wallet: cashless ? null : { balance: session.balance },
      config: { entryTiers: ENTRY_TIERS, defaultEntry: DEFAULT_ENTRY, rakePct: HOUSE_RAKE, seats: n },
      tournament,
    };
  }

  // Used by the room server to send updates and run the bots
  const snapshotFor = (seat = HUMAN_SEAT) => snapshot(seat);

  return Object.freeze({ getState, snapshotFor, startMatch, nextRound, step, hit, stay, stop, resolveChoice, verify, resetBalance, serialize, restore, isCashless: () => cashless, playerCount: () => n });
}
