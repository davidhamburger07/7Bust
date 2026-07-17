// Tournament pot maths with pretend credits, not real money
// Real money would need this on the server and the rake shown to players

export const ENTRY_TIERS = [50, 100, 250];
export const DEFAULT_ENTRY = 100;
export const HOUSE_RAKE = 0.15; // The house cut, shown to the player
export const STARTING_BALANCE = 1000;

export function buildPot(entryFee, numPlayers, rake = HOUSE_RAKE) {
  const pot = entryFee * numPlayers;
  const houseRake = Math.round(pot * rake);
  const prizePool = pot - houseRake;
  return { entryFee, numPlayers, rakePct: rake, pot, houseRake, prizePool };
}

// Winner takes all, a tie splits the prize evenly, rounded down
export function payoutPerWinner(prizePool, winnerCount) {
  return Math.floor(prizePool / Math.max(1, winnerCount));
}
