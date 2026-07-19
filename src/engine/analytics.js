// Game stats. Every event is logged to the console as one JSON line
// No stats service is set up yet, swap the sink when there is one

function emit(event, data = {}) {
  const record = { event, at: new Date().toISOString(), ...data };
  try {
    console.log(`[7bust-analytics] ${JSON.stringify(record)}`);
  } catch {
    // Logging can fail on odd data, stats must never break the game
  }
  return record;
}

// Every bot choice, with their scores, hand size and the bust chance at that moment
export const trackAIAction = (data) => emit("ai_action", data);

export const trackRoundEnd = (data) => emit("round_end", data);

export const trackMatchEnd = (data) => emit("match_end", data);

// Online games, with a games per day counter
// The counter is in memory and resets on redeploy, the logs are what lasts
const mpGamesByDay = new Map();
export function trackMultiplayerGame(data = {}) {
  const day = new Date().toISOString().slice(0, 10);
  if (data.phase === "deal") mpGamesByDay.set(day, (mpGamesByDay.get(day) || 0) + 1);
  return emit("multiplayer_game", { ...data, day, gamesToday: mpGamesByDay.get(day) || 0 });
}
