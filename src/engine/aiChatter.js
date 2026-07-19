// Bot emotes and chat lines, reacting to real game events in character
// Used by both the solo game and the room server

export const PLAYER_EMOTES = ["😂", "😡", "😱", "🔥", "😎", "💀", "👏", "🍀"];

const LINES = {
  rook: {
    freezeActor: ["Sit down and STAY down.", "Ice cold, baby.", "Nothing personal."],
    frozenTarget: ["You'll regret that.", "Cheap shot!", "Oh it's WAR now."],
    bustSelf: ["That shoe is rigged.", "Whatever. Fold-ers never win either.", "Rather bust than bank small."],
    bustOther: ["HA! Greedy.", "Told you. TOLD you.", "Couldn't be me."],
    clean7Self: ["SEVEN. Read 'em and weep.", "Built different.", "Pay the man."],
    flip3Actor: ["Have three, on the house.", "Flip 'em, sunshine."],
    seeFuture: ["I know something you don't.", "The future looks... profitable."],
    scGet: ["Safety net? Didn't need it.", "Mine now."],
  },
  nova: {
    freezeActor: ["The odds favored it.", "Simply optimal play.", "Nothing reckless about that."],
    frozenTarget: ["Noted.", "Statistically unfortunate.", "An acceptable outcome."],
    bustSelf: ["Variance.", "The math was sound. The card was not.", "Recalculating."],
    bustOther: ["The risk curve caught up.", "Predictable outcome.", "Discipline matters."],
    clean7Self: ["Precisely as calculated.", "Seven. As projected.", "The model holds."],
    flip3Actor: ["A forced sample of three.", "Let's test your luck properly."],
    seeFuture: ["Information is edge.", "Interesting. Very interesting."],
    scGet: ["A sensible hedge.", "Insurance acquired."],
  },
  pip: {
    freezeActor: ["s-sorry!!", "please don't be mad.", "it was the card's idea."],
    frozenTarget: ["oh no.", "that's ok... i guess.", "cold. so cold."],
    bustSelf: ["oops.", "i KNEW i should've stopped.", "my whole life flashed by."],
    bustOther: ["yikes...", "glad that wasn't me.", "this is why i hold."],
    clean7Self: ["wait. WAIT. SEVEN?!", "i did it!! mom look!!", "was that... me?"],
    flip3Actor: ["um. three for you.", "sorry in advance."],
    seeFuture: ["i peeked... not telling.", "ooh."],
    scGet: ["my little safety blanket.", "phew."],
  },
};

const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const chance = (p) => Math.random() < p;

function say(seat, kind, emoji, textChance, players) {
  const p = players[seat];
  if (!p || !p.isAI || !p.aiType) return null;
  const pack = LINES[p.aiType] || LINES.nova;
  const r = { seat };
  if (emoji) r.emoji = emoji;
  if (pack[kind] && chance(textChance)) r.text = pick(pack[kind]);
  if (!r.emoji && !r.text) return null;
  return r;
}

// Turns the last game event into bot reactions, the random chance is already applied
export function aiReactions(le, players) {
  if (!le) return [];
  const out = [];
  const add = (r) => r && out.push(r);
  const othersAI = players.filter((p) => p.isAI && p.seat !== le.seat);

  if (le.kind === "frozen") {
    if (le.from != null && le.from !== le.seat && chance(0.8)) add(say(le.from, "freezeActor", "😂", 0.7, players));
    if (chance(0.65)) add(say(le.seat, "frozenTarget", chance(0.5) ? "😡" : "😱", 0.6, players));
  } else if (le.kind === "bust") {
    if (chance(0.7)) add(say(le.seat, "bustSelf", "💀", 0.6, players));
    if (othersAI.length && chance(0.35)) add(say(pick(othersAI).seat, "bustOther", "😂", 0.5, players));
  } else if (le.kind === "clean7") {
    add(say(le.seat, "clean7Self", "🔥", 0.9, players));
    if (othersAI.length && chance(0.5)) add(say(pick(othersAI).seat, null, "👏", 0, players));
  } else if (le.kind === "flip3") {
    if (le.from != null && le.from !== le.seat && chance(0.55)) add(say(le.from, "flip3Actor", "😎", 0.6, players));
  } else if (le.kind === "see_future") {
    if (chance(0.6)) add(say(le.seat, "seeFuture", "🔮", 0.6, players));
  } else if (le.kind === "sc_pass" || (le.kind === "action" && le.card && le.card.action === "second_chance")) {
    if (chance(0.4)) add(say(le.seat, "scGet", null, 1, players));
  }
  return out;
}
