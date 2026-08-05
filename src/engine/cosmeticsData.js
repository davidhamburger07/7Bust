// The cosmetics list, shared with the server so a purchase can't lie about the price
// Money is saved in the browser, chips come from multiplayer and live on the server

export const MONEY = "money";
export const CHIPS = "chips";

export const CARD_FACES = [
  { id: "classic", name: "Classic", price: 0, cur: MONEY, blurb: "The house deck. Cream and clean.", swatch: "linear-gradient(160deg,#fff8ea,#f0dcb6)" },
  { id: "ruby", name: "Ruby", price: 500, cur: MONEY, blurb: "Deep red faces with a soft inner glow.", swatch: "linear-gradient(160deg,#7a1020,#3a0810)" },
  { id: "sapphire", name: "Sapphire", price: 500, cur: MONEY, blurb: "Cool blue, like a high-limit table.", swatch: "linear-gradient(160deg,#123a7a,#08183a)" },
  { id: "emerald", name: "Emerald", price: 500, cur: MONEY, blurb: "Felt-green cards for the true regular.", swatch: "linear-gradient(160deg,#0f6a3d,#053a20)" },
  { id: "midnight", name: "Midnight", price: 3500, cur: MONEY, blurb: "Matte black with electric-cyan digits.", swatch: "linear-gradient(160deg,#12161f,#05070c)" },
  { id: "neon", name: "Neon", price: 20000, cur: MONEY, blurb: "Blacklight pink and cyan. Loud on purpose.", swatch: "linear-gradient(160deg,#1a0a24,#05010a)" },
  { id: "goldfoil", name: "Gold Foil", price: 120000, cur: MONEY, blurb: "Brushed-gold faces. Bank-statement energy.", swatch: "linear-gradient(160deg,#ffe9a8,#b8862a)" },
  { id: "holo", name: "Holographic", price: 1500000, cur: MONEY, blurb: "Oil-slick shimmer that shifts as it moves.", swatch: "linear-gradient(135deg,#7af7ff,#c78bff 45%,#ff9ad2 75%,#ffe08a)" },
  { id: "obsidian", name: "Obsidian", price: 12000000, cur: MONEY, blurb: "Carved volcanic glass with a gold rim. Whale-tier.", swatch: "linear-gradient(160deg,#1a1712,#000)" },
];

export const CARD_BACKS = [
  { id: "classic", name: "Classic Back", price: 0, cur: MONEY, blurb: "Standard diagonal weave.", swatch: "repeating-linear-gradient(45deg,#5a3418,#5a3418 4px,#3a2110 4px,#3a2110 8px)" },
  { id: "crosshatch", name: "Crosshatch", price: 400, cur: MONEY, blurb: "Tight woven crosshatch.", swatch: "repeating-linear-gradient(45deg,#123a2a,#123a2a 3px,#0a2418 3px,#0a2418 6px)" },
  { id: "damask", name: "Red Damask", price: 6000, cur: MONEY, blurb: "Old-money crimson pattern.", swatch: "radial-gradient(circle at 50% 40%,#8d2330,#4a0f18)" },
  { id: "circuit", name: "Circuitry", price: 60000, cur: MONEY, blurb: "Glowing traces on black silicon.", swatch: "linear-gradient(160deg,#0a1f18,#04100a)" },
  { id: "artdeco", name: "Art Deco", price: 800000, cur: MONEY, blurb: "Gatsby gold fans on midnight blue.", swatch: "linear-gradient(160deg,#12233f,#0a1428)" },
  { id: "royal", name: "Royal Casino", price: 800, cur: CHIPS, blurb: "The official casino back. Chips only.", swatch: "radial-gradient(circle at 50% 40%,#2a58c8,#0e2160)" },
];

export const AVATARS = [
  { id: "chip", name: "Red Chip", emoji: "🔴", price: 0, cur: MONEY, bg: "linear-gradient(160deg,#e05b5b,#8a2020)" },
  { id: "clover", name: "Lucky Clover", emoji: "🍀", price: 300, cur: MONEY, bg: "linear-gradient(160deg,#3fbf6a,#166a34)" },
  { id: "flame", name: "On Fire", emoji: "🔥", price: 900, cur: MONEY, bg: "linear-gradient(160deg,#ff9a3d,#a3401a)" },
  { id: "star", name: "Gold Star", emoji: "⭐", price: 2500, cur: MONEY, bg: "linear-gradient(160deg,#ffd24a,#a9781a)" },
  { id: "dice", name: "Hot Dice", emoji: "🎲", price: 8000, cur: MONEY, bg: "linear-gradient(160deg,#f0f0f0,#9a9a9a)" },
  { id: "diamond", name: "Diamond Hands", emoji: "💎", price: 35000, cur: MONEY, bg: "linear-gradient(160deg,#6fd2ff,#1f6a99)" },
  { id: "rocket", name: "Moonshot", emoji: "🚀", price: 150000, cur: MONEY, bg: "linear-gradient(160deg,#8a7dff,#3a2f8a)" },
  { id: "shark", name: "Card Shark", emoji: "🦈", price: 1200000, cur: MONEY, bg: "linear-gradient(160deg,#8fb3c9,#3a5a70)" },
  { id: "goat", name: "The G.O.A.T.", emoji: "🐐", price: 15000000, cur: MONEY, bg: "linear-gradient(160deg,#e8e8e8,#8a8a7a)" },
  { id: "slot", name: "Jackpot", emoji: "🎰", price: 400, cur: CHIPS, bg: "linear-gradient(160deg,#ff5b7a,#8a1030)" },
  { id: "champagne", name: "Bottle Service", emoji: "🍾", price: 1200, cur: CHIPS, bg: "linear-gradient(160deg,#ffe08a,#9a6a10)" },
  { id: "crown", name: "High Roller", emoji: "👑", price: 3000, cur: CHIPS, bg: "linear-gradient(160deg,#ffe08a,#9a6a10)" },
  { id: "trophy", name: "Champion", emoji: "🏆", price: 8000, cur: CHIPS, bg: "linear-gradient(160deg,#ffd24a,#8a5a10)" },
];

// Multiplayer only, a felt swaps the same table colours the ladder rooms use
export const FELTS = [
  { id: "default", name: "House Green", price: 0, cur: CHIPS, swatch: "linear-gradient(160deg,#18a457,#0f7a41)", vars: null },
  { id: "royalblue", name: "Royal Blue", price: 500, cur: CHIPS, swatch: "linear-gradient(160deg,#1b56b8,#0e2f6e)", vars: { "--felt": "#12408a", "--felt-hi": "#1b56b8", "--felt-lo": "#08213f", "--rail": "#0e1830", "--rail-hi": "#25406e" } },
  { id: "crimson", name: "Crimson", price: 1200, cur: CHIPS, swatch: "linear-gradient(160deg,#a01f2e,#5a0f18)", vars: { "--felt": "#7a1622", "--felt-hi": "#a01f2e", "--felt-lo": "#3a0810", "--rail": "#2a0c0f", "--rail-hi": "#5a1c22" } },
  { id: "obsidian", name: "Obsidian", price: 2500, cur: CHIPS, swatch: "linear-gradient(160deg,#2a2a30,#0c0c10)", vars: { "--felt": "#1c1c22", "--felt-hi": "#2a2a32", "--felt-lo": "#0a0a0e", "--rail": "#0a0a0c", "--rail-hi": "#242430" } },
  { id: "violet", name: "Velvet Violet", price: 6000, cur: CHIPS, swatch: "linear-gradient(160deg,#5a2a9a,#2a105a)", vars: { "--felt": "#3f2470", "--felt-hi": "#5a2a9a", "--felt-lo": "#1a0a3a", "--rail": "#170a2a", "--rail-hi": "#341a54" } },
  { id: "gold", name: "High-Limit Gold", price: 20000, cur: CHIPS, swatch: "linear-gradient(160deg,#8a6a1a,#3a2a08)", vars: { "--felt": "#6a5216", "--felt-hi": "#8a6a1a", "--felt-lo": "#3a2a08", "--rail": "#241a08", "--rail-hi": "#4a3616" } },
];

// The base emotes are always yours, each pack you own adds more to your emote strip
export const BASE_EMOTES = ["😂", "😡", "😱", "🔥", "😎", "💀", "👏", "🍀"];
export const EMOTE_PACKS = [
  { id: "feels", name: "All the Feels", price: 2000, cur: MONEY, emojis: ["😭", "🤔", "🥳", "🙄", "😴"] },
  { id: "tabletalk", name: "Table Talk", price: 12000, cur: MONEY, emojis: ["🤝", "👋", "🫡", "🎲", "🤞"] },
  { id: "villain", name: "Table Villain", price: 90000, cur: MONEY, emojis: ["😈", "🤡", "👿", "🃏", "🕶️"] },
  { id: "vip", name: "VIP Lounge", price: 1500, cur: CHIPS, emojis: ["🤑", "💰", "🍾", "🥂", "💸"] },
];

// The server accepts any emote someone could own, or a paid one wouldn't go through
export const ALL_EMOTES = [...new Set([...BASE_EMOTES, ...EMOTE_PACKS.flatMap((p) => p.emojis)])];

CARD_FACES.forEach((i) => (i.kind = "face"));
CARD_BACKS.forEach((i) => (i.kind = "back"));
AVATARS.forEach((i) => (i.kind = "avatar"));
FELTS.forEach((i) => (i.kind = "felt"));
EMOTE_PACKS.forEach((i) => (i.kind = "emote"));

// The server reads prices from here, never from the player
const ALL_ITEMS = [...CARD_FACES, ...CARD_BACKS, ...AVATARS, ...FELTS, ...EMOTE_PACKS];
export const itemById = (id) => ALL_ITEMS.find((i) => i.id === id) || null;

export const avatarById = (id) => AVATARS.find((a) => a.id === id) || AVATARS[0];
export const feltById = (id) => FELTS.find((f) => f.id === id) || FELTS[0];

// So the server never trusts a price or currency sent from the browser
export const chipItemIds = () => ALL_ITEMS.filter((i) => i.cur === CHIPS).map((i) => i.id);

export const DEFAULTS = { face: "classic", back: "classic", avatar: "chip", felt: "default" };
