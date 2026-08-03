// Game stats. Every event is logged as one JSON line
// The browser sends them to the server in batches, the server saves them straight to Redis

// Events worth saving. Bot moves and house rounds are left out, there are too many of them
// They still go to the console and get summed up into match end and house session
const NETWORK_EVENTS = new Set(["round_end", "match_end", "multiplayer_game", "reward", "house_session"]);

let sink = null;
export function setAnalyticsSink(fn) {
  sink = typeof fn === "function" ? fn : null;
}

function emit(event, data = {}) {
  const record = { event, at: new Date().toISOString(), ...data };
  try {
    console.log(`[7bust-analytics] ${JSON.stringify(record)}`);
  } catch {
    // Logging can fail on odd data, stats must never break the game
  }
  if (sink && NETWORK_EVENTS.has(event)) {
    try {
      sink(record);
    } catch {
      // A broken sink must never break the game
    }
  }
  return record;
}

// Every bot choice with the bust chance at that moment, console only
export const trackAIAction = (data) => emit("ai_action", data);

export const trackRoundEnd = (data) => emit("round_end", data);

export const trackMatchEnd = (data) => emit("match_end", data);

// Free chips from daily bonuses and the ad wheel
export const trackReward = (data) => emit("reward", data);

// House table, one entry per round with the bust risk the player saw when they chose
// Console only, the totals go into the house session record
export const trackHouseRound = (data) => emit("house_round", data);

// A visit to the house table, sent when the player leaves
// How many rounds they stayed, what their chips did, top ups, and whether they left or went broke
export const trackHouseSession = (data) => emit("house_session", data);

// Online games, with a games per day counter
// The counter is in memory, the real count lives in the store
const mpGamesByDay = new Map();
export function trackMultiplayerGame(data = {}) {
  const day = new Date().toISOString().slice(0, 10);
  if (data.phase === "deal") mpGamesByDay.set(day, (mpGamesByDay.get(day) || 0) + 1);
  return emit("multiplayer_game", { ...data, day, gamesToday: mpGamesByDay.get(day) || 0 });
}

// Turns an event into counter adds
// Kept here so the browser and the server always count the same way
export function countersFor(rec) {
  const c = {};
  const add = (k, v = 1) => {
    if (k && v) c[k] = (c[k] || 0) + v;
  };
  if (rec.event === "match_end") {
    add("matches");
    add(rec.cashless ? "matches_online" : "matches_solo");
    add("rounds_played", rec.rounds || 0);
    add("match_ms_total", rec.durationMs || 0);
    add("tables_" + (rec.tableSize || 0));
    if (rec.winner) add("wins_" + (rec.winner.personality || "human"));
    for (const a of rec.aiProfitability || []) {
      add("ai_games_" + a.personality);
      add("ai_net_" + a.personality, a.net || 0);
      if (a.won) add("ai_wins_" + a.personality);
    }
  } else if (rec.event === "round_end") {
    add("rounds");
  } else if (rec.event === "multiplayer_game") {
    if (rec.phase === "deal") {
      add("mp_deals");
      add("mp_pot_total", rec.pot || 0);
      add("mp_humans_total", rec.humans || 0);
      add("mp_seats_" + (rec.tableSize || 0));
    } else {
      add("mp_finishes");
      // The house cut from settled pots, the pot totals and paid matches
      // So the house margin can be read against all chips wagered
      add("mp_rake_total", rec.rake || 0);
      add("mp_pot_settled_total", rec.pot || 0);
      if (rec.entryFee) add("mp_paid_matches");
    }
  } else if (rec.event === "house_session") {
    add("house_sessions");
    add("house_rounds", rec.rounds || 0);
    add("house_session_ms_total", rec.durationMs || 0);
    // Wagered against returned is the real house edge, the only true check on the simulator's 4.58%
    add("house_wagered_total", rec.wagered || 0);
    add("house_returned_total", rec.returned || 0);
    add("house_wins", rec.wins || 0);
    add("house_losses", rec.losses || 0);
    add("house_player_busts", rec.playerBusts || 0);
    add("house_dealer_busts", rec.dealerBusts || 0);
    // Top ups are free chips being used, bust outs are visits that ended because the chips ran out
    add("house_topups", rec.topUps || 0);
    if (rec.bustedOut) add("house_bustouts");
    if ((rec.rounds || 0) >= 10) add("house_sessions_10plus"); // Stayed past trying it out
  } else if (rec.event === "reward") {
    if (rec.kind === "daily") {
      add("daily_claims");
      add("daily_chips", rec.amount || 0);
    } else if (rec.kind === "wheel") {
      add("ads_watched");
      add("wheel_spins");
      add("wheel_chips", rec.amount || 0);
      if (rec.jackpot) add("wheel_jackpots");
    }
  }
  return c;
}
