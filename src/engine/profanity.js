// Chat and name filter, runs on the room server so a hacked game can't skip it
// Matches whole words so innocent words like Scunthorpe or classic don't get censored

const MASKED = [
  "fuck", "shit", "bitch", "bastard", "asshole", "arsehole", "dickhead", "wanker",
  "cunt", "prick", "twat", "bollocks", "piss", "slut", "whore", "douche",
];

// Dropped instead of masked, kids play at these tables and masking still shows what was meant
const BLOCKED = [
  "nigger", "nigga", "faggot", "fag", "retard", "tranny", "kike", "spic", "chink",
  "paki", "coon", "rape", "rapist", "pedo", "paedo", "pedophile",
];

// Number and symbol swaps people use to dodge the filter
const FOLD = { "@": "a", "4": "a", "8": "b", "(": "c", "3": "e", "6": "g", "1": "i", "!": "i", "|": "i", "0": "o", "5": "s", $: "s", "7": "t", "+": "t", "9": "g" };

// Lowercases and strips accents, punctuation and number swaps
function base(word) {
  return word
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9@!|()$+]/g, "")
    .split("")
    .map((c) => FOLD[c] || c)
    .join("");
}

// Squashes repeat letters two ways, so stretched swears match but real double letters stay
function forms(word) {
  const b = base(word);
  return [b, b.replace(/(.)\1{2,}/g, "$1$1"), b.replace(/(.)\1+/g, "$1")];
}

// Loose matching is for names, they're short and have no sentence to protect
function hits(token, term, loose = false) {
  if (token === term) return true;
  if (token.includes(term) && (loose ? term.length >= 4 : term.length >= 5)) return true;
  return new RegExp(`^${term}(s|es|ed|ing|er|ers|z|y|ies)?$`).test(token);
}

const matches = (word, list, loose = false) =>
  forms(word).some((f) => f.length > 1 && list.some((term) => hits(f, term, loose)));

// Joins runs of single letters typed with spaces, only ones right next to each other
function spacedRuns(tokens) {
  const runs = [];
  let cur = [];
  for (const t of tokens) {
    if (base(t).length === 1) cur.push(base(t));
    else {
      if (cur.length >= 3) runs.push(cur.join(""));
      cur = [];
    }
  }
  if (cur.length >= 3) runs.push(cur.join(""));
  return runs;
}

const tokensOf = (text) => String(text).split(/\s+/).filter(Boolean);

// A swear spelt out letter by letter drops the whole message, that's only done to dodge the filter
export function isBlocked(text) {
  const tokens = tokensOf(text);
  if (tokens.some((t) => matches(t, BLOCKED))) return true;
  return spacedRuns(tokens).some((r) => matches(r, BLOCKED) || matches(r, MASKED));
}

export function maskProfanity(text) {
  return tokensOf(text)
    .map((raw) => (matches(raw, MASKED) ? "*".repeat(Math.min(raw.length, 8)) : raw))
    .join(" ");
}

// The room server calls this, returns the text to send or null to drop it
export function moderate(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (isBlocked(t)) return null;
  return maskProfanity(t);
}

// Bad names get replaced outright, a masked name would sit on screen all match
export function cleanDisplayName(name, fallback = "Player") {
  const n = String(name || "").trim();
  if (!n) return fallback;
  if (isBlocked(n)) return fallback;
  return matches(n, MASKED, true) ? fallback : n;
}
