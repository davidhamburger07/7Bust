// Bot emotes reacting to real game events, used by the solo game and the room server
// Bots only emote and not every time, a stream of instant bot chat felt fake

export const PLAYER_EMOTES = ["😂", "😡", "😱", "🔥", "😎", "💀", "👏", "🍀"];

// How often a bot reacts to something, people don't react to everything
const REACT_CHANCE = 0.3;

// Bots only emote for now, set this to true to bring back their chat lines
const BOTS_CAN_TEXT = false;

// People don't react the instant a card flips, so callers wait this long before the emote
// Each bot gets a different delay so a bust gets a trickle, not everyone at once
export const reactionDelayMs = () => 1200 + Math.random() * 2300; // Between 1.2 and 3.5 seconds

const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const chance = (p) => Math.random() < p;

// The emoji for a moment from the bot's side
// "self" happened to them, "other" to someone else, "actor" they caused it, "target" it hit them
function emojiFor(kind, role) {
  switch (kind) {
    case "bust": return role === "self" ? pick(["💀", "😱", "😡"]) : pick(["😂", "😎"]);
    case "clean7": return role === "self" ? pick(["🔥", "😎"]) : "👏";
    case "frozen": return role === "actor" ? pick(["😂", "😎"]) : pick(["😡", "😱"]);
    case "flip3": return pick(["😎", "🔥"]);
    case "see_future": return pick(["😎", "🔥"]);
    default: return null;
  }
}

// Kept behind the flag so the bots' lines aren't lost while they're muted
const LINES = {
  rook: { bustSelf: ["That shoe is rigged.", "Rather bust than bank small."], bustOther: ["HA! Greedy.", "Couldn't be me."], clean7Self: ["Read 'em and weep.", "Pay the man."], freezeActor: ["Sit down and STAY down.", "Ice cold."] },
  nova: { bustSelf: ["Variance.", "Recalculating."], bustOther: ["Predictable.", "Discipline matters."], clean7Self: ["As projected.", "The model holds."], freezeActor: ["Simply optimal.", "Nothing reckless."] },
  pip: { bustSelf: ["oops.", "my whole life flashed by."], bustOther: ["yikes...", "glad that wasn't me."], clean7Self: ["i did it!! mom look!!", "was that... me?"], freezeActor: ["s-sorry!!", "please don't be mad."] },
};
function maybeText(seat, kind, role, players) {
  if (!BOTS_CAN_TEXT) return undefined;
  const p = players[seat];
  const pack = p && p.aiType && LINES[p.aiType];
  const lineKey = kind === "bust" ? (role === "self" ? "bustSelf" : "bustOther") : kind === "clean7" ? "clean7Self" : kind === "frozen" && role === "actor" ? "freezeActor" : null;
  return pack && lineKey && chance(0.6) ? pick(pack[lineKey]) : undefined;
}

// Only bot seats react, and only some of the time
function reactor(seat, kind, role, players) {
  const p = players[seat];
  if (!p || !p.isAI || !chance(REACT_CHANCE)) return null;
  const emoji = emojiFor(kind, role);
  if (!emoji) return null;
  const r = { seat, emoji };
  const text = maybeText(seat, kind, role, players);
  if (text) r.text = text;
  return r;
}

// Turns the last game event into bot reactions, the random chance is already applied
// The caller waits the reaction delay before showing each one
export function aiReactions(le, players) {
  if (!le) return [];
  const out = [];
  const add = (r) => r && out.push(r);
  const otherAIs = players.filter((p) => p.isAI && p.seat !== le.seat);

  switch (le.kind) {
    case "frozen":
      if (le.from != null && le.from !== le.seat) add(reactor(le.from, "frozen", "actor", players));
      add(reactor(le.seat, "frozen", "target", players));
      break;
    case "bust":
      add(reactor(le.seat, "bust", "self", players));
      if (otherAIs.length) add(reactor(pick(otherAIs).seat, "bust", "other", players)); // One other bot reacts
      break;
    case "clean7":
      add(reactor(le.seat, "clean7", "self", players));
      if (otherAIs.length) add(reactor(pick(otherAIs).seat, "clean7", "other", players)); // A clap from another bot
      break;
    case "flip3":
      if (le.from != null && le.from !== le.seat) add(reactor(le.from, "flip3", "actor", players));
      break;
    case "see_future":
      add(reactor(le.seat, "see_future", "self", players));
      break;
  }
  return out;
}
