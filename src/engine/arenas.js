// The single-player ladder, each room has a bigger buy-in and more bots than the last
// A room opens once you could lose several hands in it, and stays open even if you go broke

export const ARENAS = [
  {
    id: "alley",
    tier: 1,
    name: "The Back Alley",
    where: "Behind the laundromat",
    buyIn: 50,
    bots: 2,
    unlockAt: 0,
    rake: 0,
    botStand: [32, 40],
    regulars: ["Tino", "Bex"],
    manner: "reckless",
    // Blurbs say what the room feels like to sit in, not what the settings do
    blurb: "Two chancers who cannot leave a hand alone. They will bust most rounds doing it, you only have to be steadier than they are.",
    lockHint: "Open to anyone with a stake.",
    theme: {
      "--ar-felt": "#232a24",
      "--ar-felt-hi": "#313a30",
      "--ar-felt-lo": "#12160f",
      "--ar-rail": "#191410",
      "--ar-rail-hi": "#33291d",
      "--ar-accent": "#ff9b21",
      "--ar-accent-hi": "#ffca7a",
      "--ar-glow": "rgba(255, 155, 33, 0.34)",
      "--ar-ink": "#f6e4c8",
    },
  },
  {
    id: "pub",
    tier: 2,
    name: "The Local Pub",
    where: "The back room at the Anchor",
    buyIn: 500,
    bots: 3,
    unlockAt: 2500,
    rake: 0.08,
    botStand: [28, 34],
    regulars: ["Mags", "Old Peter", "Dolores"],
    manner: "reckless",
    blurb: "Three regulars, four pints in. Still swinging too hard for a big round, just slightly better at stopping.",
    lockHint: "The room upstairs wants to see a real stake first.",
    theme: {
      "--ar-felt": "#6b2029",
      "--ar-felt-hi": "#8d2f38",
      "--ar-felt-lo": "#3a1015",
      "--ar-rail": "#4a2d13",
      "--ar-rail-hi": "#7d4d1f",
      "--ar-accent": "#e8b45c",
      "--ar-accent-hi": "#ffe0a3",
      "--ar-glow": "rgba(232, 180, 92, 0.3)",
      "--ar-ink": "#fff1d8",
    },
  },
  {
    id: "club",
    tier: 3,
    name: "The Underground Club",
    where: "Down the stairs, no sign",
    buyIn: 5000,
    bots: 4,
    unlockAt: 25000,
    rake: 0.13,
    botStand: [18, 22],
    regulars: ["Vega", "Kestrel", "Sabine", "Nix"],
    manner: "timid",
    blurb: "Four careful players who bank two cards and sit down. They almost never bust, they just never score much either.",
    lockHint: "They only deal to people who have already won somewhere.",
    theme: {
      "--ar-felt": "#141018",
      "--ar-felt-hi": "#231a2c",
      "--ar-felt-lo": "#08060b",
      "--ar-rail": "#0d0a11",
      "--ar-rail-hi": "#2a1f38",
      "--ar-accent": "#ff2d95",
      "--ar-accent-hi": "#22e7ff",
      "--ar-glow": "rgba(255, 45, 149, 0.38)",
      "--ar-ink": "#f2e9ff",
    },
  },
  {
    id: "casino",
    tier: 4,
    name: "The VIP Casino",
    where: "Third floor, by invitation",
    buyIn: 50000,
    bots: 5,
    unlockAt: 250000,
    rake: 0.06,
    botStand: [28, 32],
    regulars: ["Mr. Ferraro", "Odette", "Lachlan", "Ines", "The Baron"],
    manner: "shark",
    blurb: "Five professionals playing the line the math actually recommends over nine rounds. Nobody here gives anything away.",
    lockHint: "The floor manager checks your net worth at the door.",
    theme: {
      "--ar-felt": "#0f7a41",
      "--ar-felt-hi": "#18a457",
      "--ar-felt-lo": "#063a1e",
      "--ar-rail": "#241309",
      "--ar-rail-hi": "#4a2b16",
      "--ar-accent": "#ffd24a",
      "--ar-accent-hi": "#ffedb0",
      "--ar-glow": "rgba(255, 210, 74, 0.36)",
      "--ar-ink": "#fff6e0",
    },
  },
  {
    id: "yacht",
    tier: 5,
    name: "The Monaco Yacht",
    where: "Anchored off the Riviera",
    buyIn: 500000,
    bots: 7,
    unlockAt: 2500000,
    rake: 0.1,
    botStand: [21, 24],
    regulars: ["Contessa", "Solomon", "Marguerite", "Aziz", "Renard", "Ilse", "Kaito"],
    manner: "shark",
    blurb: "Seven sharks around a glass table at sunset, all playing the solved line. The rake is not what makes this room hard.",
    lockHint: "You do not get on the boat by asking.",
    theme: {
      "--ar-felt": "#0a3d4c",
      "--ar-felt-hi": "#12657a",
      "--ar-felt-lo": "#041d26",
      "--ar-rail": "#12222b",
      "--ar-rail-hi": "#2b4a58",
      "--ar-accent": "#ff7a4d",
      "--ar-accent-hi": "#ffe2a8",
      "--ar-glow": "rgba(255, 122, 77, 0.34)",
      "--ar-ink": "#eaf7ff",
    },
  },
];

// Same length as a party match, scores add up and the highest total takes the pot
export const ARENA_ROUNDS = 9;

export const FIRST_ARENA = ARENAS[0];

export const arenaById = (id) => ARENAS.find((a) => a.id === id) || null;

export const seatsAt = (arena) => arena.bots + 1;

// The pot before the house takes its cut
export const potAt = (arena) => arena.buyIn * seatsAt(arena);

// The first room is always open so a broke player always has somewhere to sit
export function unlockedFor(peakNetWorth) {
  return ARENAS.filter((a) => peakNetWorth >= a.unlockAt);
}

export const isUnlocked = (arena, peakNetWorth) => peakNetWorth >= arena.unlockAt;

export function nextLocked(peakNetWorth) {
  return ARENAS.find((a) => peakNetWorth < a.unlockAt) || null;
}

// Highest room the player has opened, the single-player board sorts by this first
export function highestUnlocked(peakNetWorth) {
  const open = unlockedFor(peakNetWorth);
  return open[open.length - 1] || FIRST_ARENA;
}

export const themeStyle = (arena) =>
  Object.entries(arena.theme)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

// Paints the match table in this room's colours when the ladder plays, only the felt and rail change
export function matchSkin(arena) {
  const t = (arena && arena.theme) || {};
  const map = {
    "--felt": t["--ar-felt"],
    "--felt-hi": t["--ar-felt-hi"],
    "--felt-lo": t["--ar-felt-lo"],
    "--rail": t["--ar-rail"],
    "--rail-hi": t["--ar-rail-hi"],
  };
  return Object.entries(map)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}
