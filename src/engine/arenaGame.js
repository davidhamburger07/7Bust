// Single player rooms, you and up to seven bots, nine rounds, one pot
// Everyone draws from one shoe that runs down across the match, the best total takes the pot

import { HOUSE_MAX_VALUE, buildHouseDeck, newHouseHand, takeCard } from "./houseGame.js";

export { buildHouseDeck, HOUSE_MAX_VALUE };

export const MATCH_ROUNDS = 9; // Same as the party game

export const OUTCOMES = {
  WIN: "win", // You have the best total alone
  SPLIT: "split", // You tie for the best total
  LOSE: "lose", // Someone finished above you
};

// A bot's stand line, picked once per match from the room's range
// So a full table is different players, and each stays the same all match so you can read them
export function rollStands(arena, rng = Math.random) {
  const [lo, hi] = arena.botStand;
  return Array.from({ length: arena.bots }, () => lo + Math.floor(rng() * (hi - lo + 1)));
}

// How many bots act before you, half the room rounded down
// So there's always someone behind you to fear, and from the "Pub" up someone ahead to read
export const openersAt = (arena) => Math.floor(arena.bots / 2);

// One nine round match at one table
// Phases go player, round, round end, then settled once the pot is paid
export function createArenaMatch({ deck, arena, botStands, wager = arena.buyIn, names = [], rounds = MATCH_ROUNDS, refill } = {}) {
  if (!Array.isArray(deck) || !deck.length) throw new Error("createArenaMatch: deck required");
  if (!arena) throw new Error("createArenaMatch: arena required");
  const stands = botStands && botStands.length === arena.bots ? botStands.slice() : rollStands(arena);

  let shoe = deck.slice();
  let cursor = 0;
  let reshuffles = 0;
  let round = 1;
  let phase = "opening";
  let outcome = null;
  // Once a round is banked its score is in the total but the hand stays on the table to show
  // Without this flag the running score would count that hand twice
  let banked = false;

  // Seat order is turn order. You sit in the middle, the openers act before you every round
  const openers = Math.min(openersAt(arena), arena.bots);
  const seats = [];
  for (let i = 0; i < arena.bots + 1; i++) {
    const isYou = i === openers;
    seats.push({
      seat: i,
      name: names[i] || (isYou ? "You" : `Seat ${i + 1}`),
      isYou,
      opener: !isYou && i < openers,
      stand: isYou ? null : stands[i < openers ? i : i - 1],
      hand: newHouseHand(),
      total: 0,
      rounds: [], // Score banked each round, for the match history
      payout: 0,
      played: false,
    });
  }
  const you = seats[openers];

  const pot = wager * seats.length;
  let houseTake = 0;

  // Count of every value left in the shoe, so the bust odds shown are the real ones
  let counts = new Array(HOUSE_MAX_VALUE + 1).fill(0);
  const recount = () => {
    counts = new Array(HOUSE_MAX_VALUE + 1).fill(0);
    for (let i = cursor; i < shoe.length; i++) counts[shoe[i].value] += 1;
  };
  recount();

  const remaining = () => shoe.length - cursor;

  // The shoe runs down across the match and gets replaced when it's empty, like the party game
  function drawCard() {
    if (cursor >= shoe.length) {
      shoe = (refill ? refill() : buildHouseDeck()).slice();
      cursor = 0;
      reshuffles += 1;
      recount();
    }
    const card = shoe[cursor++];
    counts[card.value] -= 1;
    return card;
  }

  // Chance the next card busts this hand, from the cards really left
  function bustChanceFor(hand) {
    const left = remaining();
    if (!left || !hand.values.length) return 0;
    let losing = 0;
    for (const v of hand.values) losing += counts[v];
    return losing / left;
  }

  // Bots play one round, drawing to their stand line or until a duplicate busts them
  // Round one in reckless rooms is a warm up, a whole table busting at once looks broken
  function warmingUp() {
    return round === 1 && arena.manner === "reckless";
  }

  // What this bot goes for this round, it works out what it needs over the rounds left
  // Timid bots chase too little, sharks chase just right, reckless ones chase too hard and bust
  const CHASE = { timid: 0.55, shark: 1, reckless: 1.4 };

  function botTarget(s) {
    let rival = 0;
    for (const o of seats) if (o !== s) rival = Math.max(rival, runningOf(o));
    const left = rounds - round;
    const need = rival - s.total;
    const share = left > 0 ? need / (left + 1) : need;
    return Math.max(s.stand, Math.min(58, Math.round(share * (CHASE[arena.manner] ?? 1))));
  }

  function playBot(s) {
    const target = botTarget(s);
    // Neither loop can check for cards left, drawing reshuffles an empty shoe by itself
    // That check made bots skip their turn as the shoe ran out. A hand always busts or hits its target
    if (warmingUp()) {
      // Round one in the easy rooms, only draw while nothing left in the shoe can bust the hand
      // Usually one card, sometimes more when every copy of what it holds is gone
      while (s.hand.score < target && bustChanceFor(s.hand) === 0 && remaining() + 78 > 0) {
        if (takeCard(s.hand, drawCard()).bust) break; // Can't happen at zero risk, kept just in case
      }
    } else {
      while (s.hand.score < target) {
        if (takeCard(s.hand, drawCard()).bust) break;
      }
    }
    s.played = true;
  }

  // The best round score showing among seats that already played this round
  function bestShowing() {
    let best = 0;
    for (const s of seats) if (s.played && !s.isYou && !s.hand.busted) best = Math.max(best, s.hand.score);
    return best;
  }

  // What a seat is on right now, its banked total plus this round's hand if not banked yet
  // Every score on screen comes from this
  const runningOf = (s) => s.total + (banked || s.hand.busted ? 0 : s.hand.score);

  // The best match total at any other seat, the one you're really racing
  function bestTotal() {
    let best = 0;
    for (const s of seats) if (!s.isYou) best = Math.max(best, runningOf(s));
    return best;
  }

  function openRound() {
    banked = false;
    for (const s of seats) {
      s.hand = newHouseHand();
      s.played = false;
    }
    phase = "opening";
    for (const s of seats) if (s.opener) playBot(s);
    phase = "player";
  }

  function bankRound() {
    banked = true;
    for (const s of seats) {
      const scored = s.hand.busted ? 0 : s.hand.score;
      s.total += scored;
      s.rounds.push(scored);
    }
  }

  function settleMatch() {
    phase = "settled";
    const best = Math.max(...seats.map((s) => s.total));
    const winners = seats.filter((s) => s.total === best);
    // Chips are whole, so the split rounds down and the odd chip stays with the house
    const share = Math.floor((pot * (1 - arena.rake)) / winners.length);
    for (const w of winners) w.payout = share;
    houseTake = pot - share * winners.length;
    outcome = !winners.includes(you) ? OUTCOMES.LOSE : winners.length > 1 ? OUTCOMES.SPLIT : OUTCOMES.WIN;
  }

  // After your turn, the seats behind you play, the round is banked, then the next round or the payout
  function closeRound() {
    you.played = true;
    phase = "round";
    for (const s of seats) if (!s.isYou && !s.played) playBot(s);
    bankRound();
    phase = round >= rounds ? "settled" : "round_end";
    if (phase === "settled") settleMatch();
  }

  function hit() {
    if (phase !== "player") throw new Error(`hit() in phase "${phase}"`);
    const res = takeCard(you.hand, drawCard());
    // A bust scores zero for the round, the match goes on
    if (res.bust) closeRound();
    return res;
  }

  // Hold what you have. Fine on an empty hand too, that's just zero for the round
  function stay() {
    if (phase !== "player") throw new Error(`stay() in phase "${phase}"`);
    closeRound();
  }

  function nextRound() {
    if (phase !== "round_end") throw new Error(`nextRound() in phase "${phase}"`);
    round += 1;
    openRound();
  }

  const seatView = (s) => ({
    seat: s.seat,
    name: s.name,
    isYou: s.isYou,
    opener: !!s.opener,
    stand: s.stand,
    values: s.hand.values.slice(),
    score: s.hand.busted ? 0 : s.hand.score,
    rawScore: s.hand.score,
    busted: s.hand.busted,
    bustValue: s.hand.bustValue,
    total: s.total,
    // Banked total plus this round's hand while it's still live
    running: runningOf(s),
    rounds: s.rounds.slice(),
    payout: s.payout,
    played: s.isYou ? true : s.played,
    reveal: s.hand.values.length + (s.hand.busted ? 1 : 0),
  });

  // What you can see while you play. The seats behind you haven't drawn, so nothing leaks
  function playerView() {
    return {
      round,
      rounds,
      score: you.hand.score,
      values: you.hand.values.slice(),
      count: you.hand.values.length,
      total: you.total,
      running: runningOf(you),
      bustChance: bustChanceFor(you.hand),
      deckRemaining: remaining(),
      seats: seats.length,
      wager,
      pot,
      bestShowing: bestShowing(),
      bestTotal: bestTotal(),
      behindBy: Math.max(0, bestTotal() - runningOf(you)),
      leading: runningOf(you) > bestTotal(),
      roundsLeft: rounds - round,
      behind: seats.filter((s) => !s.isYou && !s.played).length,
    };
  }

  function state() {
    return {
      phase,
      outcome,
      round,
      rounds,
      arenaId: arena.id,
      wager,
      pot,
      rake: arena.rake,
      houseTake,
      warmUp: warmingUp(),
      winners: seats.filter((s) => s.payout > 0).map((s) => s.seat),
      payout: you.payout,
      net: you.payout - wager,
      seats: seats.map(seatView),
      you: seatView(you),
      bestShowing: bestShowing(),
      bestTotal: bestTotal(),
      deckRemaining: remaining(),
      reshuffles,
    };
  }

  openRound(); // The openers play before the player sees the table

  return {
    hit,
    stay,
    nextRound,
    state,
    playerView,
    bustChance: () => bustChanceFor(you.hand),
    remainingByValue: () => counts.slice(),
    phase: () => phase,
    round: () => round,
    outcome: () => outcome,
    pot: () => pot,
    canHit: () => phase === "player",
    canStay: () => phase === "player" && you.hand.values.length > 0,
  };
}

// Strategies and a match runner with no UI, used to test the room odds

// Draw until the hand reaches this, the same way the bots play, so the test is on the room's terms
export function standAt(threshold) {
  const fn = (view) => (view.count > 0 && view.score >= threshold ? "stay" : "hit");
  fn.label = `stand at ${threshold}`;
  fn.threshold = threshold;
  return fn;
}

export function standAtRisk(maxRisk) {
  const fn = (view) => (view.count > 0 && view.bustChance >= maxRisk ? "stay" : "hit");
  fn.label = `stand above ${(maxRisk * 100).toFixed(0)}% risk`;
  return fn;
}

// Plays for the match, not the round. Banks a normal hand when it's close
// When behind, spreads what it needs over the rounds left and plays for that
export function playTheMatch(base = 26) {
  const fn = (view) => {
    if (view.count === 0) return "hit";
    const need = view.bestTotal - view.total; // The least this round has to make up
    const share = view.roundsLeft > 0 ? need / (view.roundsLeft + 1) : need;
    const target = Math.max(base, Math.min(60, share));
    return view.score >= target ? "stay" : "hit";
  };
  fn.label = `play the match (${base})`;
  fn.threshold = base;
  return fn;
}

// Plays a whole match with no UI, the deck must already be shuffled
export function playMatch({ deck, arena, botStands, wager = arena.buyIn, strategy = standAt(26), rounds = MATCH_ROUNDS, refill } = {}) {
  const m = createArenaMatch({ deck, arena, botStands, wager, rounds, refill });
  while (m.phase() !== "settled") {
    if (m.phase() === "round_end") {
      m.nextRound();
      continue;
    }
    const wantsStay = strategy(m.playerView()) === "stay";
    if (wantsStay && m.canStay()) m.stay();
    else m.hit();
  }
  return m.state();
}
