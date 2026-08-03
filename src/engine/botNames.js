// Names for the bots that fill Quick Match tables, every bot still shows an AI tag
// No guest style names with numbers, those look like real guest players

const ADJ = ["Salty", "Mellow", "Quiet", "Neon", "Lucky", "Rusty", "Swift", "Cosmic", "Sly", "Brave", "Chill", "Wild", "Golden", "Shadow", "Turbo", "Frosty", "Jolly", "Nifty", "Rowdy", "Zen", "Breezy", "Snappy"];
const NOUN = ["Shark", "Otter", "Falcon", "River", "Pilot", "Comet", "Tiger", "Maple", "Raven", "Bishop", "Nomad", "Pixel", "Bandit", "Voyager", "Cobra", "Willow", "Sparrow", "Rocket", "Panda", "Wolf", "Koi", "Ace"];

const r = (n) => (Math.random() * n) | 0;
const pick = (a) => a[r(a.length)];

export function botHandle(taken) {
  taken = taken || new Set();
  for (let tries = 0; tries < 40; tries++) {
    const roll = Math.random();
    let name;
    if (roll < 0.45) name = pick(ADJ) + pick(NOUN) + (2 + r(97));
    else if (roll < 0.75) name = "Player" + (100 + r(9900));
    else name = pick(ADJ) + pick(NOUN);
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  const fallback = "Player" + (1000 + r(9000)); // Almost never happens, just stops it looping forever
  taken.add(fallback);
  return fallback;
}
