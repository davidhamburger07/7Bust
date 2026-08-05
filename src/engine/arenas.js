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
    id: "corner",
    tier: 2,
    name: "The Corner Store",
    where: "Out back, past the freezer",
    buyIn: 150,
    bots: 3,
    unlockAt: 1500,
    rake: 0.05,
    regulars: ["Deano", "Prisha", "Wenzel"],
    blurb: "Three regulars killing time between shifts. They chase a big round whenever they get bored, which is always.",
    lockHint: "Win a few hands out back first.",
    theme: {
      "--ar-felt": "#3a3326",
      "--ar-felt-hi": "#4c4433",
      "--ar-felt-lo": "#201c14",
      "--ar-rail": "#241b10",
      "--ar-rail-hi": "#45341c",
      "--ar-accent": "#ffb347",
      "--ar-accent-hi": "#ffd98a",
      "--ar-glow": "rgba(255, 179, 71, 0.3)",
      "--ar-ink": "#f5ecd6",
    },
  },
  {
    id: "pub",
    tier: 3,
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
    id: "snooker",
    tier: 4,
    name: "The Snooker Hall",
    where: "Under the flyover, tables 9 to 12",
    buyIn: 1500,
    bots: 3,
    unlockAt: 8000,
    rake: 0.1,
    regulars: ["Chalky", "Suki", "Ferro"],
    blurb: "Green baize and low lamps. They play it tight, but there is always one who cannot resist just one more card.",
    lockHint: "The hall wants to see a real roll before it racks you a table.",
    theme: {
      "--ar-felt": "#0e3b2e",
      "--ar-felt-hi": "#175a45",
      "--ar-felt-lo": "#06251c",
      "--ar-rail": "#1a1410",
      "--ar-rail-hi": "#3a2c1a",
      "--ar-accent": "#d9b34d",
      "--ar-accent-hi": "#f4dd94",
      "--ar-glow": "rgba(217, 179, 77, 0.3)",
      "--ar-ink": "#eafaf0",
    },
  },
  {
    id: "club",
    tier: 5,
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
    id: "speakeasy",
    tier: 6,
    name: "The Speakeasy",
    where: "Knock twice at the barber's",
    buyIn: 15000,
    bots: 5,
    unlockAt: 80000,
    rake: 0.1,
    regulars: ["Ruby", "Cassius", "Dot", "Lucky Jim", "Vero"],
    blurb: "Jazz, low light, and five players who count cards between sips. Careful money, patient money, you have to make them reach.",
    lockHint: "You need a name here before they slide the panel back.",
    theme: {
      "--ar-felt": "#3a1420",
      "--ar-felt-hi": "#5a1f30",
      "--ar-felt-lo": "#1e0a12",
      "--ar-rail": "#2a1c0c",
      "--ar-rail-hi": "#4d3316",
      "--ar-accent": "#e6c35c",
      "--ar-accent-hi": "#ffe9a8",
      "--ar-glow": "rgba(230, 195, 92, 0.32)",
      "--ar-ink": "#ffeede",
    },
  },
  {
    id: "casino",
    tier: 7,
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
    id: "penthouse",
    tier: 8,
    name: "The Penthouse",
    where: "Top floor, private lift",
    buyIn: 150000,
    bots: 6,
    unlockAt: 800000,
    rake: 0.08,
    regulars: ["Sterling", "Anouk", "Devlin", "Priya", "Marco", "Elke"],
    blurb: "Floor-to-ceiling glass and six players who do not blink at the buy-in. The city looks small from up here, and so do you.",
    lockHint: "The lift only stops on this floor for the seriously liquid.",
    theme: {
      "--ar-felt": "#10203a",
      "--ar-felt-hi": "#1b3358",
      "--ar-felt-lo": "#060d1c",
      "--ar-rail": "#10141f",
      "--ar-rail-hi": "#263349",
      "--ar-accent": "#7fbfff",
      "--ar-accent-hi": "#cfe6ff",
      "--ar-glow": "rgba(127, 191, 255, 0.3)",
      "--ar-ink": "#e8f2ff",
    },
  },
  {
    id: "yacht",
    tier: 9,
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
  {
    id: "island",
    tier: 10,
    name: "The Private Island",
    where: "No flights, only invitations",
    buyIn: 1500000,
    bots: 7,
    unlockAt: 8000000,
    rake: 0.08,
    regulars: ["Zephyr", "Octavia", "Rune", "Bianca", "Hassan", "Lior", "Sable"],
    blurb: "Turquoise water, no clocks, and seven people who could buy the island. They play the perfect line and tip in five figures.",
    lockHint: "There is no application. There is only being asked.",
    theme: {
      "--ar-felt": "#0b5c5c",
      "--ar-felt-hi": "#0f8080",
      "--ar-felt-lo": "#053333",
      "--ar-rail": "#123030",
      "--ar-rail-hi": "#245050",
      "--ar-accent": "#ff8f6b",
      "--ar-accent-hi": "#ffd0b0",
      "--ar-glow": "rgba(255, 143, 107, 0.32)",
      "--ar-ink": "#eafffb",
    },
  },
  {
    id: "sky",
    tier: 11,
    name: "The Sky Lounge",
    where: "Cruising at forty thousand feet",
    buyIn: 5000000,
    bots: 7,
    unlockAt: 30000000,
    rake: 0.1,
    regulars: ["Cirrus", "Nadia", "Volkan", "Perla", "Idris", "Tamsin", "Yuki"],
    blurb: "A private jet that never lands, and seven flyers who treat a bad beat like turbulence, noted, then ignored.",
    lockHint: "The manifest is short, and you are not on it.",
    theme: {
      "--ar-felt": "#2a1846",
      "--ar-felt-hi": "#402464",
      "--ar-felt-lo": "#150a24",
      "--ar-rail": "#1a1226",
      "--ar-rail-hi": "#35244a",
      "--ar-accent": "#c88bff",
      "--ar-accent-hi": "#e6c9ff",
      "--ar-glow": "rgba(200, 139, 255, 0.34)",
      "--ar-ink": "#f3e9ff",
    },
  },
  {
    id: "vault",
    tier: 12,
    name: "The Vault",
    where: "Below the bank that owns the other banks",
    buyIn: 20000000,
    bots: 7,
    unlockAt: 120000000,
    rake: 0.12,
    regulars: ["Midas", "Seraphine", "Cato", "Ondine", "Gideon", "Vesper", "Nyx"],
    blurb: "Steel walls, no windows, and seven of the biggest whales alive playing flawless. Beat this room and there is nowhere left to climb.",
    lockHint: "The door weighs thirty tonnes and it does not open for you yet.",
    theme: {
      "--ar-felt": "#14110a",
      "--ar-felt-hi": "#241d10",
      "--ar-felt-lo": "#080602",
      "--ar-rail": "#0a0803",
      "--ar-rail-hi": "#241a0a",
      "--ar-accent": "#ffd24a",
      "--ar-accent-hi": "#fff0b0",
      "--ar-glow": "rgba(255, 210, 74, 0.4)",
      "--ar-ink": "#fff6e0",
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
