// Starts the game, paces the bot turns, saves the game and plays the big announcements

import { createServer } from "./server/mockServer.js";
import { renderApp, chatLines } from "./ui/render.js";
import { morph } from "./ui/morph.js";
import { startCoach, place as placeCoach, coachRunning } from "./ui/coach.js";
import { announce, initAudio, sfx, playVoice, setAudioPrefs, setPlatformMute as setAnnounceMute } from "./ui/announce.js";
import { initRadio, startRadio, setRadioVolume, getRadioVolume, pauseForAd, resumeAfterAd, setPlatformMute as setRadioMute } from "./ui/radio.js";
import { DAILY_BONUS, JACKPOT, spinWheel, today } from "./engine/rewards.js";
import {
  setAnalyticsSink,
  trackReward,
  trackHouseRound,
  trackHouseSession,
  trackArenaHand,
  trackArenaSession,
  trackArenaUnlock,
  trackSessionStart,
  trackScreenView,
} from "./engine/analytics.js";
import { createHouseGame, shuffleHouseDeck, HOUSE_DECK_SIZE } from "./engine/houseGame.js";
import { ARENAS, arenaById, potAt, ARENA_ROUNDS } from "./engine/arenas.js";
import { createArenaMatch, openersAt, buildHouseDeck } from "./engine/arenaGame.js";
import { pveSummary, setChips, getChips, recordHand, restake, peakNetWorth, roomsOpenedBetween, PVE_RESTAKE } from "./engine/pveWallet.js";
import { PERSONALITIES } from "./engine/ai.js";
import { randomSeedHex } from "./engine/rng.js";
import { analyticsSink, installAnalyticsFlush } from "./net/analyticsClient.js";
import { initWallet, walletUser, getBalance, claimDailyBonus, spinPrizeWheel, adjustLocal, refreshBalance, seedLocalIfUnset, dailyClaimedToday, walletMode } from "./net/walletClient.js";
import { cgAccountsAvailable, cgAccountsKnown, cgSignIn, cgOnAuth, cgSettings, cgOnSettings } from "./net/crazygames.js";
import { discordAvailable, discordBoot, discordReady, discordInstanceId, roomCodeFor, discordSetActivity } from "./net/discord.js";
import { gdBoot } from "./net/gamedistribution.js";
import { gpBoot, gpLoaded } from "./net/gamepix.js";
import { ngBoot, ngOnAuth } from "./net/newgrounds.js";
import { rewardedAd, midgameAd, adsAvailable } from "./net/ads.js";
import { flyCard } from "./ui/fly.js";
import { showEmote, showSpeech, showShuffle } from "./ui/bubbles.js";
import { aiReactions, reactionDelayMs } from "./engine/aiChatter.js";
import { createNet } from "./net/netClient.js";
import { cgInit, cgLoadingStart, cgLoadingStop, cgSetPlaying, cgHappytime, cgUpdateRoom, cgLeftRoom, cgGetInviteRoom, cgInviteLink, cgOnJoinRoom, cgInstantMultiplayer } from "./net/crazygames.js";
import * as storage from "./net/storage.js";

// Solo is free practice, the engine holds no money and can't make chips
// Ladder rooms swap in their own engine, every action reads server live so that's all it takes
let server = createServer({ cashless: true });
const root = document.getElementById("app");
const bootAt = Date.now();

const AI_DELAY = 850;
const SAVE_KEY = "7bust:save:v3"; // The deck changed, older saves can't resume
const NET_KEY = "7bust:net"; // Saved details to rejoin an online room
const HISTORY_KEY = "7bust:history";
const DAILY_KEY = "7bust:daily"; // Last day the login bonus was claimed
const COACH_KEY = "7bust:coach:v1"; // Set once the first run tour has been seen

// Solo runs the engine in the page, online sends actions over a WebSocket and draws what comes back
const TOS_KEY = "7bust:tos:v1";
const CID_KEY = "7bust:cid"; // Same ID for this browser every visit, one seat per table
const NAME_KEY = "7bust:name";
const SETTINGS_KEY = "7bust:settings";

function clientId() {
  try {
    let c = storage.getItem(CID_KEY);
    if (!c) {
      c = Math.random().toString(36).slice(2, 12);
      storage.setItem(CID_KEY, c);
    }
    return c;
  } catch {
    return null;
  }
}
function loadSettings() {
  try {
    return { sfx: true, voice: true, ...JSON.parse(storage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { sfx: true, voice: true };
  }
}
function saveSettings(s) {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage isn't available, the game still works without it
  }
}
const savedName = () => {
  try {
    return storage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
};
const view = {
  snapshot: null,
  lastEvent: null,
  toast: null,
  wallet: { mode: "local", accounts: false, user: null },
  mode: "solo",
  online: null,
  chat: [],
  chatDraft: "",
  chatFocus: false,
  showHistory: false,
  soloBalance: 0,
  clockText: "00:00",
  pause: null,
  pauseUsed: false,
  showTos: false,
  chatDisabled: false, // CrazyGames can turn chat off on their side
  pendingDraw: false, // Online, a card asked for that the server hasn't named yet
  pendingAction: null, // Online, a bank or stop asked for that the server hasn't confirmed yet
  hintRules: false, // Pulse the "?" until a first timer opens How to Play
  showSettings: false,
  settings: { sfx: true, voice: true },
  browse: null,
  wheel: null,
  adPending: false,
  dailyAvailable: false,
  adsAvailable: false,
  house: null,
  showHouseRules: false,
  ladder: false, // The ladder room list is open
  arena: null,
  showArenaRules: false,
  pve: null,
  showLeaderboard: false,
  lbTab: "pve",
  pvpWeek: null, // This device's online buy-in games from the last 7 days
};
let net = null;
let aiTimer = null;
let audioReady = false;
let prevPhase = "lobby";
let lastSig = "";
let prevUnique = 0;
let prevYourTurn = false;
let lastFlavorAt = 0;
let prevRound = 0;
let prevReshuffles = 0;

const money = (n) => Math.round(n).toLocaleString("en-US");

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// Desktop draws at one fixed size scaled to fit the window, so it looks the same on every screen
// Phones keep their own layout
const CANVAS_W = 1500;
const CANVAS_H = 880;
function fitStage() {
  if (window.innerWidth < 900) {
    document.documentElement.style.removeProperty("--stage-scale");
    placeRadio();
    return;
  }
  // Small margin so the game's rounded corners never touch the window edge
  const s = Math.min((window.innerWidth * 0.99) / CANVAS_W, (window.innerHeight * 0.96) / CANVAS_H);
  document.documentElement.style.setProperty("--stage-scale", s.toFixed(4));
  placeRadio();
}
window.addEventListener("resize", fitStage);
window.addEventListener("orientationchange", fitStage);

// The radio lives outside #app so redraws don't break it
// It sits in the radio slot if the screen has one, otherwise floats bottom left
function placeRadio() {
  const r = document.getElementById("radio");
  if (!r) return;
  const slot = document.getElementById("radio-slot");
  if (slot) {
    r.classList.add("inline");
    r.style.left = r.style.top = r.style.right = r.style.bottom = "";
    if (r.parentElement !== slot) slot.appendChild(r);
    return;
  }
  r.classList.remove("inline");
  if (r.parentElement !== document.body) document.body.appendChild(r);
  dockRadio();
}

// No slot on this screen, so pin it inside the scaled game, not the window
function dockRadio() {
  requestAnimationFrame(() => {
    const r = document.getElementById("radio");
    if (!r || r.classList.contains("inline")) return;
    if (window.innerWidth < 900) {
      r.style.left = "";
      r.style.top = "";
      r.style.right = "";
      r.style.bottom = "";
      return;
    }
    const st = document.querySelector(".stage");
    if (!st) return;
    const b = st.getBoundingClientRect();
    r.style.left = `${Math.round(b.left + 16)}px`;
    r.style.top = `${Math.round(b.bottom - r.offsetHeight - 12)}px`;
    r.style.right = "auto";
    r.style.bottom = "auto";
  });
}

function render() {
  view.lastEvent = view.snapshot ? view.snapshot.lastEvent : null;
  view.dailyAvailable = dailyState().available;
  view.adsAvailable = adsAvailable(); // No ad button where no network can serve one
  // Keep the log's scroll, follow the bottom unless the player scrolled up
  const oldLog = document.getElementById("log");
  let atBottom = true;
  let prevTop = 0;
  if (oldLog) {
    prevTop = oldLog.scrollTop;
    atBottom = oldLog.scrollHeight - oldLog.scrollTop - oldLog.clientHeight < 28;
  }
  // Tells the CSS when the table is on screen, phones move the radio for it
  const matchVisible =
    !view.showRules &&
    !view.showHistory &&
    !view.showSettings &&
    !view.showTos &&
    !view.showLeaderboard &&
    !view.ladder &&
    (view.arena
      ? !view.showArenaRules // The ladder is a felt table too, so the radio docks the same
      : view.house
      ? !view.showHouseRules // The house table is a felt table too, so the radio docks the same
      : !!view.snapshot &&
        (view.mode === "online"
          ? !!(view.online && view.online.screen === "playing" && view.snapshot.online)
          : view.snapshot.phase !== "lobby"));
  document.body.classList.toggle("scr-match", matchVisible);
  // The radio moves between a corner and the match bar, so park it on body while patching
  // Then put it back
  const liveRadio = document.getElementById("radio");
  if (liveRadio && liveRadio.parentElement !== document.body) document.body.appendChild(liveRadio);
  // Patches the page instead of rebuilding it, snapshots arrive all the time
  // Rebuilding stole focus mid-word, lost hover and restarted every card animation
  const chatWasAtBottom = (() => {
    const cl = document.getElementById("chatlist");
    return !cl || cl.scrollHeight - cl.scrollTop - cl.clientHeight < 40;
  })();
  morph(root, renderApp(view));
  placeRadio();
  if (coachRunning()) placeCoach(); // What it points at moves as cards are dealt
  const newLog = document.getElementById("log");
  if (newLog) newLog.scrollTop = atBottom ? newLog.scrollHeight : prevTop;
  const chatList = document.getElementById("chatlist");
  if (chatList && chatWasAtBottom) chatList.scrollTop = chatList.scrollHeight;
  tickClock(); // Show the right time straight away, no 0:00 flicker
  syncPlatform(matchVisible);
  trackScreenIfChanged(); // After drawing, so a screen only counts once it's really up
}

// Keeps the CrazyGames play state and invite button matching the screen
// Cheap to call every render, it skips repeats and does nothing without the SDK
function syncPlatform(matchVisible) {
  const s = view.snapshot;
  const paused = !!(view.pause && view.pause.until > Date.now());
  // Playing means sat at the table in a live round, not a menu, overlay or pause
  cgSetPlaying(!!(matchVisible && s && s.phase === "round" && !paused));
  // Tells the platform our room so friends can join
  // Only joinable while seats are free and no cards are out, or friends hit a full room
  const o = view.online;
  const L = o && o.lobby;
  if (view.mode === "online" && L) {
    const joinable = L.status === "lobby" && L.slots.some((sl) => sl.type === "open");
    cgUpdateRoom(L.code, joinable);
  } else {
    cgLeftRoom();
  }
}

// Each platform's page sets one global, so checking which one is there tells us the build
function platformName() {
  if (typeof window === "undefined") return "web";
  if (window.CrazyGames && window.CrazyGames.SDK) return "crazygames";
  if (window.__DISCORD_CLIENT_ID__) return "discord";
  if (window.__GD_GAME_ID__) return "gamedistribution";
  if (window.GamePix) return "gamepix";
  if (window.__NG_APP_ID__) return "newgrounds";
  return "web";
}

// One name per screen the player can see, worked out from the same flags the renderer uses
// So it always matches what's really on screen
function screenName() {
  if (view.showTos) return "tos";
  if (view.showSettings) return "settings";
  if (view.showHistory) return "history";
  if (view.showRules) return "rules";
  if (view.house) return view.showHouseRules ? "house_rules" : "house";
  if (view.showLeaderboard) return "leaderboard_" + view.lbTab;
  if (view.arena) return view.showArenaRules ? "arena_rules" : "arena_" + view.arena.arena.id;
  if (view.ladder) return "ladder";
  if (view.mode === "online" && view.online) {
    const o = view.online;
    if (o.screen === "playing" && view.snapshot && view.snapshot.online) return "online_match";
    return "online_" + (o.screen || "menu");
  }
  return view.snapshot && view.snapshot.phase !== "lobby" ? "solo_match" : "lobby";
}

let lastScreen = "";
function trackScreenIfChanged() {
  const screen = screenName();
  if (screen === lastScreen) return;
  const from = lastScreen;
  lastScreen = screen;
  // The first screen is counted too, or every funnel is missing its start
  trackScreenView({ screen, from: from || "boot" });
}

function tickClock() {
  view.clockText = fmt(Date.now() - bootAt);
  document.querySelectorAll("[data-clock]").forEach((el) => (el.textContent = view.clockText));
  const left = view.pause && view.pause.until > Date.now() ? Math.ceil((view.pause.until - Date.now()) / 1000) : 0;
  document.querySelectorAll("[data-pauseleft]").forEach((el) => {
    el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  });
  if (view.pause && view.pause.until > 0 && view.pause.until <= Date.now() && !pauseCleared) {
    pauseCleared = true;
    view.pause = { ...view.pause, until: 0 };
    render();
  }
}
let pauseCleared = false;

function toast(msg) {
  view.toast = msg;
  render();
  setTimeout(() => {
    view.toast = null;
    const el = document.querySelector(".toast");
    if (el) el.remove();
  }, 2800);
}

// Out of reconnect tries, so say the connection is lost instead of leaving a frozen table
// Sits outside #app so a redraw can't remove it
function hideConnLost() {
  const m = document.getElementById("conn-lost");
  if (m) m.remove();
}
function showConnLost() {
  if (document.getElementById("conn-lost")) return;
  const m = document.createElement("div");
  m.id = "conn-lost";
  m.className = "conn-lost";
  m.innerHTML = `
    <div class="conn-card" role="alertdialog" aria-label="Connection lost">
      <h2 class="conn-title">Connection lost</h2>
      <p class="conn-msg">We lost the table. Check your connection, then reconnect.</p>
      <div class="conn-actions">
        <button class="btn btn--play conn-retry" type="button">RECONNECT</button>
        <button class="link conn-leave" type="button">Leave to menu</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.querySelector(".conn-retry").addEventListener("click", () => {
    reconnectTries = 0;
    hideConnLost();
    const c = loadNet();
    if (c && c.code && c.id && net) net.rejoin(c.code, c.id);
    else location.reload();
  });
  m.querySelector(".conn-leave").addEventListener("click", () => {
    clearNet(); // Forget the seat so a reload goes to the solo menu, not a dead room
    hideConnLost();
    location.reload();
  });
}

function save() {
  if (view.mode === "online") return; // The room server owns online state
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(server.serialize()));
  } catch {
    // Storage isn't available, the game still works without it
  }
}

// At an online table the room server takes the buy-ins and pays the winners
// The client only loads the new balance, it can never change it
let mpSettleSig = "";
async function settleMpWallet(s) {
  if (view.mode !== "online" || !s || !s.tournament || !s.fair || !s.fair.serverSeedHash) return;
  const sig = `${s.fair.serverSeedHash}:${s.phase === "match_end" && s.tournament.settled ? "end" : "deal"}`;
  if (sig === mpSettleSig) return; // Load once per money moment, not every snapshot
  mpSettleSig = sig;
  const before = view.soloBalance;
  await refreshBalance();
  syncWallet();
  if (view.soloBalance !== before) {
    const delta = view.soloBalance - before;
    toast(delta > 0 ? `You collect ${delta} chips!` : `Buy-in taken: ${delta} chips`);
    render();
  }
}

function loadHistory() {
  try {
    return JSON.parse(storage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

// Every match that ends, solo and online, goes in the local match history with the full table
function recordHistory(s) {
  const key = s.fair && s.fair.serverSeedHash;
  if (!key) return;
  const list = loadHistory();
  if (list.some((h) => h.key === key)) return;
  const ranked = [...s.players].sort((a, b) => b.totalScore - a.totalScore);
  list.unshift({
    key,
    at: Date.now(),
    mode: view.mode,
    room: view.mode === "online" && view.online && view.online.lobby ? view.online.lobby.code : null,
    rounds: s.round.total,
    entryFee: s.tournament ? s.tournament.entryFee : 0,
    youNet: s.tournament ? s.tournament.youNet : null,
    winner: s.players[s.winner] ? (s.winner === s.you ? "You" : s.players[s.winner].name) : "?",
    youWon: s.winner === s.you,
    players: ranked.map((p, i) => ({
      place: i + 1,
      name: p.seat === s.you ? "You" : p.name,
      isAI: p.isAI,
      score: p.totalScore,
      busts: p.stats ? p.stats.busts : 0,
      bestBank: p.stats ? p.stats.bestBank : 0,
      clean7s: p.stats ? p.stats.clean7s : 0,
      frozen: p.stats ? p.stats.frozen : 0,
      peeks: p.stats ? p.stats.peeks : 0,
    })),
  });
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    // Storage isn't available, the game still works without it
  }
}

function handleAnnouncements(s) {
  const you = s.players[s.you];
  const le = s.lastEvent;
  const sig = le ? `${le.kind}:${le.seat}:${le.card ? le.card.value : ""}` : "";
  if (sig && sig !== lastSig) {
    lastSig = sig;
    const mine = le.seat === s.you;
    if (le.from != null && le.from !== le.seat && (le.kind === "frozen" || le.kind === "flip3" || le.kind === "sc_pass")) {
      flyCard(le.from, le.seat, le.kind);
    }
    if (le.card) sfx("card"); // Any player's card plays the sound, not just yours
    if (le.kind === "bust") mine ? announce("bust") : sfx("buzzer");
    else if (le.kind === "frozen") mine ? announce("frozen") : sfx("freeze");
    else if (le.kind === "clean7") announce("clean7");
    else if (le.kind === "flip3" && mine) announce("flip3");
    else if (le.kind === "sc_pass") mine ? playVoice("second") : sfx("sparkle");
    else if (le.kind === "see_future") sfx("sparkle");
    else if (le.kind === "modifier") {
      sfx("sparkle");
      if (mine && le.card && le.card.op === "mult") playVoice("double");
    } else if (mine && (le.kind === "saved" || (le.kind === "action" && le.card && le.card.action === "second_chance"))) {
      playVoice("second");
    }
    // At solo tables the bots emote locally, online the room server sends these
    // Each emote waits a random human beat so they trickle in
    if (view.mode === "solo") {
      for (const r of aiReactions(le, s.players)) {
        const { seat, emoji, text } = r;
        if (emoji) setTimeout(() => showEmote(seat, emoji), reactionDelayMs());
        if (text) setTimeout(() => showSpeech(seat, text), reactionDelayMs());
      }
    }
  }
  if (s.phase === "round" && s.round.number !== prevRound) sfx("shuffle");
  if (s.shoe && s.shoe.reshuffles > prevReshuffles) {
    sfx("shuffle");
    showShuffle();
  }
  prevRound = s.round.number;
  if (s.shoe) prevReshuffles = s.shoe.reshuffles;
  // One card off a "Clean 7", play a tense line
  if (s.phase === "round" && you.uniqueCount === 6 && prevUnique < 6 && you.turnState === "active") playVoice("oneAway");
  prevUnique = you.uniqueCount;
  if (s.yourTurn && !prevYourTurn && Date.now() - lastFlavorAt > 9000 && Math.random() < 0.6) {
    playVoice("decision");
    lastFlavorAt = Date.now();
  }
  prevYourTurn = s.yourTurn;
  if (s.phase === "match_end" && prevPhase !== "match_end") {
    announce(s.winner === s.you ? "win" : "lose");
    if (s.winner === s.you) cgHappytime(); // Tells CrazyGames this is a happy moment
    if (view.ladderGame && !view.ladderGame.settled) settleLadder(s);
    recordHistory(s);
  }
  prevPhase = s.phase;
}

function apply(res) {
  if (res && res.snapshot) view.snapshot = res.snapshot;
  render();
  handleAnnouncements(view.snapshot);
  save();
  pump();
}

function pump() {
  const s = view.snapshot;
  if (view.mode === "online" || !s || aiTimer || !s.autoStep) return; // The server paces bots online
  aiTimer = setTimeout(async () => {
    aiTimer = null;
    apply(await server.step());
  }, AI_DELAY);
}

async function start() {
  // A break is between matches with nobody waiting on us
  await maybeMidgameAd();
  const res = await server.startMatch();
  if (!res.ok) {
    view.snapshot = res.snapshot;
    render();
    toast("Can't start right now.");
    return;
  }
  hasPlayed = true; // After a first match the next break can show an ad
  sfx("ding");
  apply(res);
}
// Online only the server knows the card, so it's dealt face down and flips when it arrives
// Bank and hold just show what was asked and stop taking presses until the server agrees
let pendingTimer = null;
function clearPending() {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  if (!view.pendingDraw && !view.pendingAction) return false;
  view.pendingDraw = false;
  view.pendingAction = null;
  return true;
}
// If the server never answers, give the buttons back instead of waiting forever
function armPending() {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    if (clearPending()) render();
  }, 4000);
}
async function hit() {
  if (view.mode === "online") {
    sfx("card"); // The sound plays on the press, not the reply
    view.pendingDraw = true;
    render();
    armPending();
    return net.intent({ intent: "hit" });
  }
  apply(await server.hit());
}
async function stay() {
  sfx("chips");
  if (Date.now() - lastFlavorAt > 9000 && Math.random() < 0.4) {
    playVoice("coward");
    lastFlavorAt = Date.now();
  }
  if (view.mode === "online") {
    view.pendingAction = "bank";
    render();
    armPending();
    return net.intent({ intent: "stay" });
  }
  apply(await server.stay());
}
async function stop() {
  sfx("click");
  if (view.mode === "online") {
    view.pendingAction = "stop";
    render();
    armPending();
    return net.intent({ intent: "stop" });
  }
  apply(await server.stop());
}
async function next() {
  if (view.mode === "online") return net.intent({ intent: "next" });
  apply(await server.nextRound());
}
async function target(seat) {
  if (view.mode === "online") return net.intent({ intent: "resolveChoice", targetSeat: seat });
  apply(await server.resolveChoice({ targetSeat: seat }));
}

const loadNet = () => {
  try {
    return JSON.parse(storage.getItem(NET_KEY) || "null");
  } catch {
    return null;
  }
};
const persistNet = (code, id, name) => {
  try {
    storage.setItem(NET_KEY, JSON.stringify({ code, id, name }));
  } catch {
    // Analytics failing never affects the game
  }
};
const clearNet = () => {
  try {
    storage.removeItem(NET_KEY);
  } catch {
    // Analytics failing never affects the game
  }
};

let reconnectTries = 0;
function ensureNet() {
  if (net) return;
  net = createNet({
    onLobby(msg) {
      view.mode = "online";
      view.online = view.online || { screen: "waiting", name: "", error: null, lobby: null };
      reconnectTries = 0;
      hideConnLost(); // Back in the lobby, so hide any connection lost panel
      view.online.self = msg.self;
      view.online.error = null;
      view.online.lobby = {
        code: msg.code,
        status: msg.status,
        size: msg.size,
        slots: msg.slots,
        filled: msg.filled,
        entry: msg.entry || 0,
        rounds: msg.rounds || 9,
        multiHand: !!msg.multiHand,
        dropRule: msg.dropRule || "ai",
        isPublic: !!msg.isPublic,
        you: msg.you,
        self: msg.self,
        isHost: msg.isHost,
      };
      if (msg.pause) view.pause = msg.pause;
      view.pauseUsed = !!msg.pauseUsed;
      persistNet(msg.code, msg.self, view.online.name);
      if (msg.status === "playing") {
        if (view.online.screen !== "playing" && view.snapshot && view.snapshot.online) view.online.screen = "playing";
        // Otherwise wait for the first state to switch us in
      } else if (msg.status === "buyin") {
        view.online.screen = "buyin";
        view.online.buyin = msg.buyin || null;
        view.online.maxHands = msg.maxHands || 1;
      } else if (view.quick) {
        view.online.screen = "connecting"; // Stay on the table list while Quick Match seats bots and deals
      } else {
        view.online.screen = "waiting";
        view.online.buyin = null;
        view.online.myHands = null;
      }
      if (view.quick) continueQuick(msg);
      render();
    },
    onState(snapshot, extra) {
      if (!view.online) return;
      view.quick = null;
      reconnectTries = 0;
      hideConnLost(); // Getting state again, hide any connection lost panel
      // Once the server answers, a face down card, bank or hold stops waiting
      // It clears when our turn is over or our hand changes
      if (view.pendingDraw || view.pendingAction) {
        const before = view.snapshot && view.snapshot.players[view.snapshot.you];
        const now = snapshot.players[snapshot.you];
        const dealt = !before || now.numbers.length !== before.numbers.length || now.modifiers.length !== before.modifiers.length;
        if (dealt || !snapshot.yourTurn || now.turnState !== "active") clearPending();
      }
      view.snapshot = snapshot;
      view.online.screen = "playing";
      hasPlayed = true; // Online matches count too for the ad break rule
      if (extra) {
        view.pause = extra.pause || null;
        view.pauseUsed = !!extra.pauseUsed;
        if (view.pause && view.pause.until > Date.now()) pauseCleared = false;
      }
      render();
      handleAnnouncements(snapshot);
      settleMpWallet(snapshot);
    },
    onBrowse(list) {
      view.browse = view.browse || { list: [], loading: false, filters: { seats: "any", entry: "any", rounds: "any", multi: "any", joinable: true } };
      view.browse.list = list;
      view.browse.loading = false;
      if (view.quick && view.quick.phase === "browsing") return decideQuick(list); // Quick Match is waiting on this list
      if (view.online && (view.online.screen === "browse" || view.online.screen === "menu")) render(); // The menu shows a live table count
    },
    onChat(list) {
      // Each new chat line pops as a bubble over that player's seat
      // The chat panel is a live DOM node, so it's updated directly without a redraw
      const seen = new Set(view.chat.map((c) => `${c.at}:${c.seat}:${c.text}`));
      for (const c of list || []) {
        if (c.seat >= 0 && !seen.has(`${c.at}:${c.seat}:${c.text}`) && view.online && view.online.screen === "playing") {
          showSpeech(c.seat, c.text);
        }
      }
      view.chat = list || [];
      const cl = document.getElementById("chatlist");
      if (cl) {
        cl.innerHTML = chatLines(view.chat);
        cl.scrollTop = cl.scrollHeight;
      }
    },
    onEmote(msg) {
      if (view.online && view.online.screen === "playing") showEmote(msg.seat, msg.emoji);
    },
    onError(msg) {
      if (!view.online) return;
      const err = msg.error || "Something went wrong.";
      // Quick Match lost the race for that table, so just open our own instead of showing an error
      if (view.quick && view.quick.phase === "joining" && !msg.soft) return quickCreate();
      if (msg.soft) {
        toast(err);
        return;
      }
      const kicked = err === "You were kicked by the host";
      const fatal = [
        "Room not found",
        "That game already started",
        "Room is full",
        "Seat not found",
        "This version of the game is out of date, please refresh.",
      ];
      if (kicked || fatal.includes(err)) {
        clearNet();
        view.online.lobby = null;
        if (kicked && net) {
          net.close();
          net = null;
        }
        if (["connecting", "playing", "waiting", "buyin"].includes(view.online.screen)) {
          view.online.screen = kicked || view.online.hadRoom ? "menu" : "join";
        }
      }
      view.online.error = err;
      render();
    },
    onClose() {
      // Vercel closes every WebSocket after a few minutes, so drops are normal
      // Get back into our seat, with a limit on retries
      const screen = view.mode === "online" && view.online ? view.online.screen : null;
      if (screen !== "playing" && screen !== "waiting") return;
      const c = loadNet();
      if (c && c.code && c.id && reconnectTries < 8) {
        reconnectTries += 1;
        if (screen === "playing") toast("Reconnecting…");
        setTimeout(() => net && net.rejoin(c.code, c.id), 1200);
      } else {
        // Out of retries or nothing to rejoin, show it instead of freezing
        showConnLost();
      }
    },
  });
}

const readName = () => {
  const el = document.getElementById("mp-name");
  const n = ((el ? el.value : view.online && view.online.name) || "").trim() || "Player";
  try {
    storage.setItem(NAME_KEY, n); // Used as the default name in settings and on the next visit
  } catch {
    // Analytics failing never affects the game
  }
  return n;
};

function openOnline() {
  const saved = loadNet();
  view.mode = "online";
  view.quick = null;
  view.online = { screen: "menu", name: (saved && saved.name) || savedName() || "", error: null, lobby: null };
  ensureNet();
  net.browse(); // Real count of open tables for the menu, no made up numbers
  render();
}
function onlineMenu() {
  if (!view.online) return openOnline();
  view.quick = null;
  view.online.screen = "menu";
  view.online.error = null;
  stopBrowsePoll();
  ensureNet();
  net.browse();
  render();
}
function mpCreate() {
  ensureNet();
  view.online.name = readName();
  view.online.hadRoom = true;
  view.online.screen = "connecting";
  view.online.error = null;
  render();
  net.create(view.online.name, clientId());
}
function joinScreen() {
  view.online.screen = "join";
  view.online.error = null;
  stopBrowsePoll();
  render();
}

let browseTimer = null;
function stopBrowsePoll() {
  if (browseTimer) {
    clearInterval(browseTimer);
    browseTimer = null;
  }
}
function openBrowse() {
  ensureNet();
  if (!view.online) openOnline();
  view.online.screen = "browse";
  view.online.error = null;
  view.browse = view.browse || { list: [], loading: true, filters: { seats: "any", entry: "any", rounds: "any", multi: "any", joinable: true } };
  view.browse.loading = true;
  net.browse();
  stopBrowsePoll();
  browseTimer = setInterval(() => {
    if (view.online && view.online.screen === "browse" && net) net.browse();
    else stopBrowsePoll();
  }, 4000);
  render();
}
function refreshBrowse() {
  if (!net) return;
  view.browse.loading = true;
  net.browse();
  render();
}
function setBrowseFilter(key, val) {
  sfx("click");
  view.browse.filters[key] = key === "joinable" ? val === "1" : val;
  render();
}
function joinListed(code) {
  ensureNet();
  view.online.name = readName();
  view.online.codeInput = code;
  view.online.hadRoom = false;
  view.online.screen = "connecting";
  view.online.error = null;
  stopBrowsePoll();
  render();
  net.join(code, view.online.name, clientId());
}
// Quick Match joins the busiest free public table, or opens its own with bots and deals at once
// Its table is public, so the next player's Quick Match can join it and real games get going
let quickTimer = null;
function quickMatch() {
  ensureNet();
  if (!view.online) openOnline();
  view.online.name = readName();
  view.online.screen = "connecting";
  view.online.error = null;
  view.online.connMsg = "Finding you a table…";
  view.quick = { phase: "browsing" };
  stopBrowsePoll();
  net.browse();
  render();
  clearTimeout(quickTimer); // If browse is slow, open our own table instead of waiting
  quickTimer = setTimeout(() => {
    if (view.quick && view.quick.phase === "browsing") quickCreate();
  }, 2500);
}
function decideQuick(list) {
  clearTimeout(quickTimer);
  if (!view.quick) return;
  // Busiest free table first, bots never sit at a table with real chips
  const open = (list || []).filter((r) => (r.openSeats || 0) > 0 && (r.entry || 0) === 0).sort((a, b) => (b.filled || 0) - (a.filled || 0));
  if (open.length) {
    view.quick.phase = "joining";
    net.join(open[0].code, view.online.name, clientId());
  } else {
    quickCreate();
  }
}
function quickCreate() {
  if (!view.quick) return;
  view.quick.phase = "creating";
  net.create(view.online.name, clientId());
}
// Once we host the new room, seat a few bots and deal
// Only runs once, the config messages coming back don't start it again
function continueQuick(msg) {
  if (!view.quick) return;
  if (msg.status === "playing" || msg.status === "buyin") {
    view.quick = null;
    return;
  }
  if (view.quick.phase === "creating" && msg.isHost) {
    view.quick.phase = "starting";
    net.config({ isPublic: true }); // Public so the next player's quick match can join it
    const ais = ["nova", "rook", "pip"];
    const size = msg.size || 4;
    for (let i = 1, seated = 0; i < size && seated < 3; i++, seated++) {
      net.config({ slot: { index: i, type: "ai", ai: ais[seated % ais.length] } });
    }
    net.start();
  }
}
function mpPublic(on) {
  sfx("click");
  net && net.config({ isPublic: !!on });
}
function mpJoin() {
  const codeEl = document.getElementById("mp-code");
  const code = ((codeEl ? codeEl.value : view.online.codeInput) || "").toUpperCase().trim();
  if (code.length < 4) {
    view.online.error = "Enter the 4-letter room code.";
    render();
    return;
  }
  ensureNet();
  view.online.name = readName();
  view.online.codeInput = code;
  view.online.hadRoom = false;
  view.online.screen = "connecting";
  view.online.error = null;
  render();
  net.join(code, view.online.name, clientId());
}
function mpStart() {
  sfx("ding");
  net && net.start();
}
// Seat count, each seat set to open, a bot or off, plus stakes and length
function mpSize(n) {
  sfx("click");
  net && net.config({ size: n });
}
function mpSlot(index, t) {
  sfx("click");
  if (!net) return;
  if (t.startsWith("ai-")) net.config({ slot: { index, type: "ai", ai: t.slice(3) } });
  else net.config({ slot: { index, type: t } });
}
function mpEntry(fee) {
  sfx("chips");
  net && net.config({ entry: fee });
}
function mpRounds(r) {
  sfx("click");
  net && net.config({ rounds: r });
}
function mpMulti(on) {
  sfx("click");
  net && net.config({ multiHand: !!on });
}
function mpDrop(rule) {
  sfx("click");
  net && net.config({ dropRule: rule });
}
function mpHands(n) {
  sfx("chips");
  if (view.online) view.online.myHands = n;
  net && net.hands(n);
  render();
}
function mpDealNow() {
  sfx("ding");
  net && net.dealnow();
}
function askPause() {
  sfx("click");
  net && net.pause();
}
function votePause(agree) {
  sfx("click");
  net && net.pvote(agree);
}
function resumeGame() {
  sfx("ding");
  net && net.resume();
}
function openSettings() {
  view.showSettings = true;
  view.settingsName = savedName();
  view.settingsVol = getRadioVolume();
  render();
}
function closeSettings() {
  view.showSettings = false;
  render();
}
function setPref(key, val) {
  sfx("click");
  view.settings = { ...view.settings, [key]: val };
  saveSettings(view.settings);
  setAudioPrefs(view.settings);
  render();
}
function mpKick(slot) {
  sfx("click");
  net && net.kick(slot);
}

async function acceptTos() {
  let firstRun = true;
  try {
    firstRun = !storage.getItem(TOS_KEY); // Only teach on the first accept, not when they read the terms again
    storage.setItem(TOS_KEY, String(Date.now()));
  } catch {
    // Storage isn't available, the game still works without it
  }
  view.showTos = false;
  sfx("ding");
  if (!firstRun) return render();
  // CrazyGames allows one click before play, so accepting deals the hand straight away
  // How to Play waits behind the "?", which pulses until they've opened it
  view.hintRules = true;
  await start();
  maybeCoach();
}

// The tour runs on the table during the first hand, CrazyGames allow one click before play
// Shown once ever and can be skipped from the first step
function maybeCoach() {
  try {
    if (storage.getItem(COACH_KEY)) return;
  } catch {
    return;
  }
  const seen = () => {
    try {
      storage.setItem(COACH_KEY, String(Date.now()));
    } catch {
      // Storage isn't available, the game still works without it
    }
    view.hintRules = false; // They took the tour, stop pulsing the "?"
    render();
  };
  setTimeout(() => startCoach(seen), 700); // Let the deal animation settle first
}

function sendChat() {
  const text = (view.chatDraft || "").trim();
  if (!text || !net) return;
  net.chat(text);
  view.chatDraft = "";
  const ci = document.getElementById("chat-in");
  if (ci) ci.value = "";
}
function sendEmote(e) {
  if (net) net.emote(e);
}

function openHistory() {
  view.showHistory = true;
  view.showSettings = false;
  view.history = loadHistory();
  render();
}
function closeHistory() {
  view.showHistory = false;
  render();
}
async function mpLeave() {
  stopBrowsePoll();
  if (net) {
    net.leave(); // Free the seat, mid-game a bot takes it over
    net.close();
  }
  net = null;
  clearNet();
  reconnectTries = 0;
  clearPending(); // Nothing is waiting once the socket is gone
  view.mode = "solo";
  view.online = null;
  // Back to the solo lobby, the online snapshot isn't ours any more
  if (!view.snapshot || view.snapshot.online) await refreshSolo();
  render();
  await maybeMidgameAd(); // Back at the menu counts as a break
}
async function mpCopy() {
  const code = view.online && view.online.lobby && view.online.lobby.code;
  if (!code) return;
  // The platform's invite link carries CrazyGames info ours can't
  // Off the platform it's null and our own link is used
  const link = (await cgInviteLink(code)) || `${location.origin}${location.pathname}?room=${code}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(() => toast("Invite link copied!"), () => toast(code));
  } else {
    toast(`Share this code: ${code}`);
  }
}
async function refreshSolo() {
  view.snapshot = await server.getState();
  prevPhase = view.snapshot.phase;
}
// Ads only show at a break, never in a match, while players wait on us, or before a first match
// window.__AD_INTERVAL_MS__ lets tests change how often they show
const AD_INTERVAL_MS = Number(window.__AD_INTERVAL_MS__) || 20 * 60 * 1000;
let lastAdAt = 0;
let hasPlayed = false;
let midgameShown = false; // Has the first ad of the session shown
async function maybeMidgameAd() {
  if (!hasPlayed) return;
  if (midgameShown && Date.now() - lastAdAt < AD_INTERVAL_MS) return; // After the first ad, space them out
  // Never interrupt live play, whatever the caller thinks
  const s = view.snapshot;
  const inMatch = view.mode === "online" ? !!(view.online && view.online.screen === "playing") : !!s && s.phase !== "lobby";
  if (inMatch) return;
  lastAdAt = Date.now(); // Count the try either way so an empty ad slot can't spam retries
  midgameShown = true;
  try {
    await midgameAd({ onStart: pauseForAd, onEnd: resumeAfterAd });
  } catch {
    // No ad or a skipped one, just carry on into the game
  }
}

// The CrazyGames mute beats the player's sound settings, so it's applied in the audio code
// The player's own settings stay as they were and come back when it unmutes
function applyPlatformSettings() {
  const { muteAudio, disableChat } = cgSettings();
  setAnnounceMute(muteAudio);
  setRadioMute(muteAudio);
  const was = view.chatDisabled;
  view.chatDisabled = disableChat;
  if (was !== disableChat) render();
}

// The only chip numbers the UI reads, from the browser for guests or the server if signed in
// The game engine never holds money
function syncWallet() {
  view.soloBalance = getBalance();
  view.wallet = { mode: walletMode(), accounts: cgAccountsKnown(), user: walletUser() };
}

// Signing in makes chips permanent and guest chips move over on the first sign in
// The server caps how many so it can't be farmed
async function signIn() {
  if (!(await cgAccountsAvailable())) return;
  const user = await cgSignIn();
  if (!user) return;
  const before = getBalance();
  await initWallet();
  syncWallet();
  render();
  toast(view.soloBalance > before ? `Signed in, your chips came with you.` : `Signed in. Your chips are saved.`);
}

// Signed in, only the server knows if today's bonus is used, so a second device can't claim it
// Guests keep their own claim date in the browser
function dailyState() {
  const server = dailyClaimedToday();
  if (server !== null) return { available: !server, last: server ? today() : "" };
  let last = "";
  try {
    last = storage.getItem(DAILY_KEY) || "";
  } catch {
    // Analytics failing never affects the game
  }
  return { available: last !== today(), last };
}
// Only for guests, signed in players get their chips from the server
function grantLocal(amount) {
  adjustLocal(amount);
  syncWallet();
  return amount;
}
async function claimDaily() {
  if (!view.dailyAvailable) return;
  const res = await claimDailyBonus(() => {
    try {
      storage.setItem(DAILY_KEY, today());
    } catch {
      // Analytics failing never affects the game
    }
    return grantLocal(DAILY_BONUS);
  });
  syncWallet();
  view.dailyAvailable = dailyState().available;
  if (!res.granted) {
    view.dailyAvailable = false;
    toast("Daily bonus already claimed today.");
    render();
    return;
  }
  trackReward({ kind: "daily", amount: res.granted });
  sfx("chips");
  playVoice("win");
  toast(`Daily bonus! +${res.granted} chips`);
  render();
}
// Watch a rewarded ad then spin the wheel. Only pays out if the ad plays to the end
async function watchAdForChips() {
  if (view.wheel) return;
  view.adPending = true;
  render();
  try {
    await rewardedAd({ onStart: pauseForAd, onEnd: resumeAfterAd });
  } catch (e) {
    view.adPending = false;
    render();
    toast("No ad available right now, try again soon.");
    return;
  }
  view.adPending = false;
  // Signed in, the server spins and pays, we just animate to its slice
  // Guests spin locally against their own balance
  const res = await spinPrizeWheel(() => spinWheel());
  if (res.limited) {
    toast("You've claimed the maximum ad rewards for today.");
    render();
    return;
  }
  const { index, amount } = res;
  view.wheel = { phase: "spin", index, amount };
  sfx("shuffle");
  render();
  setTimeout(async () => {
    if (!view.wheel) return;
    view.wheel.phase = "done";
    syncWallet();
    trackReward({ kind: "wheel", amount, jackpot: amount >= JACKPOT });
    if (amount >= JACKPOT) {
      sfx("jackpot");
      cgHappytime(); // Tells CrazyGames this is a happy moment
    } else {
      sfx("ding");
    }
    render();
  }, 4300);
}
function closeWheel() {
  view.wheel = null;
  render();
}

async function verifyFair() {
  const reveal = view.snapshot && view.snapshot.reveal;
  if (!reveal) {
    toast("Finish a match, then verify its shoe here.");
    return;
  }
  const { hashOk, deckOk } = await server.verify(reveal);
  toast(hashOk && deckOk ? "✓ Provably fair: seed + shoe verified." : "⚠ Verification mismatch.");
}

function askExit() {
  view.confirmExit = true;
  render();
}
function cancelExit() {
  view.confirmExit = false;
  render();
}
async function confirmExitYes() {
  view.confirmExit = false;
  if (view.mode === "online") {
    await mpLeave(); // Sends the leave message, a bot plays the seat on
    return;
  }
  if (view.ladderGame) {
    await exitLadderGame(); // Leaving mid-match loses the buy-in
    return;
  }
  if (aiTimer) {
    clearTimeout(aiTimer); // Stop any queued bot move before closing the match
    aiTimer = null;
  }
  apply(await server.abandonMatch());
  await maybeMidgameAd(); // Leaving a match counts as a break
}

const showRules = () => {
  view.showRules = true;
  view.hintRules = false;
  view.showSettings = false;
  render();
};
const hideRules = () => {
  view.showRules = false;
  render();
};

// The house table plays for its own practice stack, it never touches wallet chips
// The browser can't be trusted to pay real chips, that has to happen on the server
const HOUSE_KEY = "7bust:house:v1";
const HOUSE_START_STACK = 500;
const HOUSE_TOPUP = 500;
// Opening bet, players who want higher stakes can raise it
const HOUSE_DEFAULT_BET = 10;
const HOUSE_REVEAL_MS = 620; // Slow on the dealer's draws, that's the exciting part
const HOUSE_DEAL_MS = 240;

let houseSeeds = null;
let houseNonce = 0;
let houseRevealTimer = null;
let houseSession = null;

const loadHouseStack = () => {
  try {
    const raw = storage.getItem(HOUSE_KEY);
    if (raw === null) return HOUSE_START_STACK; // Never sat here, give them the starting stack
    const v = Number(raw); // Turning null into a number gives 0, so check for null first
    return Number.isFinite(v) && v >= 0 ? v : HOUSE_START_STACK;
  } catch {
    return HOUSE_START_STACK;
  }
};
const saveHouseStack = (v) => {
  try {
    storage.setItem(HOUSE_KEY, String(Math.max(0, Math.round(v))));
  } catch {
    // Storage isn't available, the game still works without it
  }
};

// An empty hand so the screen can draw a table before anything is dealt
const emptyHouseState = () => ({
  phase: "bet",
  outcome: null,
  wager: 0,
  payout: 0,
  net: 0,
  player: { values: [], score: 0, busted: false, bustValue: null },
  dealer: { values: [], score: 0, busted: false, bustValue: null, drew: false },
  deckRemaining: HOUSE_DECK_SIZE,
});

function clearHouseReveal() {
  if (houseRevealTimer) clearTimeout(houseRevealTimer);
  houseRevealTimer = null;
}

function openHouse() {
  const stack = loadHouseStack();
  view.house = {
    phase: "bet",
    stack,
    wager: Math.min(HOUSE_DEFAULT_BET, stack),
    game: null,
    state: emptyHouseState(),
    risk: 0,
    reveal: 0,
    dealt: false,
    dealing: false,
    result: null,
    streak: 0,
    roundsPlayed: 0,
  };
  // Same provably fair seeds as the party game, so a house hand can be checked the same way
  houseSeeds = { serverSeed: randomSeedHex(), clientSeed: randomSeedHex(8) };
  houseNonce = 0;
  houseSession = {
    startedAt: Date.now(),
    rounds: 0,
    wagered: 0,
    returned: 0,
    wins: 0,
    losses: 0,
    playerBusts: 0,
    dealerBusts: 0,
    topUps: 0,
    bestStreak: 0,
    startStack: stack,
  };
  sfx("shuffle");
  render();
}

function houseBet(v) {
  const h = view.house;
  if (!h || h.phase !== "bet") return;
  h.wager = v === "max" ? h.stack : Math.min(Number(v), h.stack);
  sfx("click");
  render();
}

async function houseDeal() {
  const h = view.house;
  if (!h || h.phase !== "bet" || h.wager <= 0 || h.wager > h.stack) return;
  clearHouseReveal();
  houseNonce += 1;
  const deck = await shuffleHouseDeck({ ...houseSeeds, nonce: houseNonce });
  h.stack -= h.wager; // The bet leaves the stack as soon as cards are dealt
  saveHouseStack(h.stack);
  h.game = createHouseGame({ deck, wager: h.wager });
  h.state = h.game.state();
  h.risk = h.game.bustChance();
  h.phase = "player";
  h.reveal = 0;
  h.dealt = false;
  h.result = null;
  h.riskAtFreeze = 0;
  // The opening card can't bust, so clicking for it is no choice. Deal it
  houseHit();
}

function houseHit() {
  const h = view.house;
  if (!h || h.phase !== "player" || h.dealing || !h.game || !h.game.canHit()) return;
  h.dealing = true;
  sfx("card");
  render();
  setTimeout(() => {
    if (!view.house || view.house !== h) return; // Player left mid-deal
    const res = h.game.hit();
    h.state = h.game.state();
    h.risk = h.game.bustChance();
    h.dealt = true;
    h.dealing = false;
    if (res.bust) {
      sfx("buzzer");
      settleHouseRound();
    } else {
      render();
    }
  }, HOUSE_DEAL_MS);
}

function houseFreeze() {
  const h = view.house;
  if (!h || h.phase !== "player" || h.dealing || !h.game || !h.game.canStay()) return;
  h.riskAtFreeze = h.risk; // What they walked away from, for analytics
  sfx("ding");
  h.game.stay(); // The dealer's hand is settled at once, the UI just paces it
  h.state = h.game.state();
  h.phase = "dealer";
  h.reveal = 0;
  render();
  stepHouseReveal();
}

// Turns the dealer's settled hand over one card at a time
// The only slow part, on purpose, the wait is the game
function stepHouseReveal() {
  const h = view.house;
  const d = h.state.dealer;
  const total = d.values.length + (d.busted ? 1 : 0);
  houseRevealTimer = setTimeout(() => {
    if (!view.house || view.house !== h) return;
    h.reveal += 1;
    sfx(h.reveal > d.values.length ? "buzzer" : "card");
    render();
    if (h.reveal < total) stepHouseReveal();
    else houseRevealTimer = setTimeout(() => view.house === h && settleHouseRound(), 420);
  }, HOUSE_REVEAL_MS);
}

// The only place chips move. A server version swaps these two lines for one call
function settleHouseRound() {
  const h = view.house;
  clearHouseReveal();
  const st = (h.state = h.game.state());
  h.phase = "settled";
  h.reveal = st.dealer.values.length + (st.dealer.busted ? 1 : 0); // Show every dealer card once settled
  h.stack += st.payout;
  saveHouseStack(h.stack);
  h.roundsPlayed += 1;

  const won = st.payout > 0;
  h.streak = won ? h.streak + 1 : 0;
  h.result = houseVerdict(st);
  if (won) sfx(h.streak >= 3 ? "fanfare" : "jackpot");
  else if (st.outcome !== "player_bust") sfx("sad");

  const s = houseSession;
  s.rounds += 1;
  s.wagered += st.wager;
  s.returned += st.payout;
  s.bestStreak = Math.max(s.bestStreak, h.streak);
  if (won) s.wins += 1;
  else s.losses += 1;
  if (st.outcome === "player_bust") s.playerBusts += 1;
  if (st.outcome === "dealer_bust") s.dealerBusts += 1;

  trackHouseRound({
    wager: st.wager,
    payout: st.payout,
    net: st.net,
    outcome: st.outcome,
    playerScore: st.player.score,
    playerCards: st.player.values.length,
    playerBusted: st.player.busted,
    dealerScore: st.dealer.score,
    dealerCards: st.dealer.values.length,
    dealerBusted: st.dealer.busted,
    // Odds they took or turned down, tells us if players read the strip
    riskAtDecision: Number((h.riskAtFreeze || 0).toFixed(4)),
    stackAfter: h.stack,
    streak: h.streak,
    round: h.roundsPlayed,
  });
  render();
}

function houseVerdict(st) {
  const p = st.player.score;
  const d = st.dealer.score;
  if (st.outcome === "player_bust") {
    return { tone: "lose", title: "BUST", sub: `Second ${st.player.bustValue}, the house never had to draw` };
  }
  if (st.outcome === "dealer_bust") {
    return { tone: "win", title: "HOUSE BUSTS", sub: `Its second ${st.dealer.bustValue} pays you ${st.payout}` };
  }
  if (st.outcome === "player_win") {
    return { tone: "win", title: "YOU WIN", sub: `${p} beats ${d}, pays ${st.payout}` };
  }
  return d === p
    ? { tone: "push", title: "HOUSE TAKES IT", sub: `${d} all square, ties go to the house` }
    : { tone: "lose", title: "HOUSE WINS", sub: `${d} beats your ${p}` };
}

function houseAgain() {
  const h = view.house;
  if (!h) return;
  clearHouseReveal();
  h.phase = "bet";
  h.game = null;
  h.state = emptyHouseState();
  h.risk = 0;
  h.reveal = 0;
  h.dealt = false;
  h.result = null;
  h.wager = Math.min(h.wager, h.stack);
  render();
}

function houseTopUp() {
  const h = view.house;
  if (!h) return;
  h.stack += HOUSE_TOPUP;
  saveHouseStack(h.stack);
  houseSession.topUps += 1;
  sfx("chips");
  toast(`+${HOUSE_TOPUP} practice chips`);
  houseAgain();
}

// Sends the visit as one analytics event. Rounds and refills per visit show if players stay
// Wagered against returned shows the real house edge
function flushHouseSession(reason) {
  const h = view.house;
  const s = houseSession;
  if (!h || !s || !s.rounds) return;
  trackHouseSession({
    reason,
    rounds: s.rounds,
    durationMs: Date.now() - s.startedAt,
    wagered: s.wagered,
    returned: s.returned,
    net: s.returned - s.wagered,
    wins: s.wins,
    losses: s.losses,
    playerBusts: s.playerBusts,
    dealerBusts: s.dealerBusts,
    topUps: s.topUps,
    bestStreak: s.bestStreak,
    startStack: s.startStack,
    endStack: h.stack,
    bustedOut: h.stack <= 0,
    rtp: s.wagered ? Number((s.returned / s.wagered).toFixed(4)) : null,
  });
  houseSession = null;
}

function houseExit() {
  clearHouseReveal();
  flushHouseSession("exit");
  view.house = null;
  sfx("click");
  render();
}

// Ladder chips live in their own wallet, they never mix with multiplayer chips
// The engine settles a hand at once, this code only paces showing it
const ARENA_DEAL_MS = 240; // Your own card landing
// Long enough to read the standings between rounds, short enough that a match doesn't drag
const ARENA_ROUND_END_MS = 1250;
const ARENA_SEAT_GAP = 300; // Pause between one seat's turn and the next

let arenaSeeds = null;
let arenaNonce = 0;
let arenaTimer = null;
let arenaSession = null;

// A fuller table deals each card faster, or a big hand takes so long players start skipping
const arenaRevealMs = (seats) => Math.round(Math.min(420, 1400 / seats));
// The first cards are dealt fast, waiting to see who you're up against is dead time
// Seats after you keep the slow pace, that wait is the game
const arenaOpenMs = (seats) => Math.round(Math.min(190, 700 / seats));

function clearArenaTimer() {
  if (arenaTimer) clearTimeout(arenaTimer);
  arenaTimer = null;
}

const emptyArenaState = (arena) => ({
  phase: "opening",
  outcome: null,
  round: 1,
  rounds: ARENA_ROUNDS,
  wager: arena.buyIn,
  pot: potAt(arena),
  rake: arena.rake,
  houseTake: 0,
  warmUp: arena.manner === "reckless",
  winners: [],
  payout: 0,
  net: 0,
  bestShowing: 0,
  bestTotal: 0,
  deckRemaining: HOUSE_DECK_SIZE,
  reshuffles: 0,
  seats: [],
  you: { seat: 0, name: "You", isYou: true, values: [], score: 0, rawScore: 0, busted: false, bustValue: null, total: 0, running: 0, rounds: [], payout: 0, played: true, reveal: 0 },
});

// Kept on the screen state, not loaded each render, the ladder, leaderboard and chip counter use it
function syncPve() {
  view.pve = pveSummary();
  return view.pve;
}

function openLadder() {
  syncPve();
  view.ladder = true;
  view.arena = null;
  sfx("click");
  render();
}

function closeLadder() {
  view.ladder = false;
  sfx("click");
  render();
}

function lbTab(tab) {
  view.lbTab = tab === "pvp" ? "pvp" : "pve";
  sfx("click");
  render();
}

// Ladder rooms play the full party game, only the buy-in, regulars and payout are single player
// The three house bots take turns across the seats
const LADDER_BRAINS = [PERSONALITIES.rook, PERSONALITIES.nova, PERSONALITIES.pip];
function ladderRoster(arena) {
  const roster = [{ name: "You", isAI: false }];
  for (let i = 0; i < arena.bots; i++) {
    roster.push({ name: (arena.regulars && arena.regulars[i]) || `Seat ${i + 2}`, isAI: true, ai: LADDER_BRAINS[i % LADDER_BRAINS.length] });
  }
  return roster;
}

function arenaSit() {
  const arena = arenaById(this && this.id);
  if (!arena) return;
  const p = syncPve();
  if (p.peak < arena.unlockAt || p.chips < arena.buyIn) return;
  startLadderMatch(arena);
}

// Opens a ladder table. The buy-in comes off the practice stack now, so leaving mid-match loses it
async function startLadderMatch(arena) {
  if (getChips() < arena.buyIn) return openLadder();
  if (aiTimer) {
    clearTimeout(aiTimer);
    aiTimer = null;
  }
  clearArenaTimer();
  clearPending();
  setChips(getChips() - arena.buyIn);
  syncPve(); // Refresh so the match bar shows the stack after the buy-in
  server = createServer({ cashless: true, entryFee: arena.buyIn, rake: arena.rake, rounds: ARENA_ROUNDS, players: ladderRoster(arena) });
  view.ladder = false;
  view.arena = null;
  view.house = null;
  view.mode = "solo";
  view.ladderGame = { arena, wager: arena.buyIn, settled: false };
  sfx("shuffle");
  const res = await server.startMatch();
  if (!res.ok) {
    setChips(getChips() + arena.buyIn);
    view.ladderGame = null;
    server = createServer({ cashless: true });
    return openLadder();
  }
  hasPlayed = true;
  sfx("ding");
  apply(res);
}

// A ladder match ended, pay the practice stack and move the career on
// Only the payout is added here, the buy-in already came off at the deal
function settleLadder(s) {
  view.ladderGame.settled = true;
  const t = s.tournament;
  const payout = t ? t.youPayout || 0 : 0;
  const before = peakNetWorth();
  recordHand({ arena: view.ladderGame.arena, payout, wager: view.ladderGame.wager, won: s.winner === s.you, busted: false, potShare: payout });
  const opened = roomsOpenedBetween(before, peakNetWorth());
  syncPve();
  if (opened.length) toast(`New room open: ${opened[opened.length - 1].name}!`);
}

function ladderAgain() {
  const arena = view.ladderGame && view.ladderGame.arena;
  if (arena) startLadderMatch(arena);
}

// Puts the practice engine back so "Take a Seat" still works
async function exitLadderGame() {
  if (aiTimer) {
    clearTimeout(aiTimer);
    aiTimer = null;
  }
  clearPending();
  view.ladderGame = null;
  view.confirmExit = false;
  server = createServer({ cashless: true });
  await refreshSolo();
  openLadder();
}

// A match needs more than one deck, so it gets several shuffled shoes used one at a time
// Gluing decks together would make the deck strip show the wrong card counts
const ARENA_SHOES = 6;

async function arenaShoes() {
  const shoes = [];
  for (let i = 0; i < ARENA_SHOES; i++) {
    arenaNonce += 1;
    shoes.push(await shuffleHouseDeck({ ...arenaSeeds, nonce: arenaNonce }));
  }
  return shoes;
}

async function arenaStartMatch() {
  const h = view.arena;
  if (!h) return;
  const a = h.arena;
  if (h.stack < a.buyIn) return; // The ladder handles a player who can't pay the buy-in
  clearArenaTimer();
  const shoes = await arenaShoes();
  if (!view.arena || view.arena !== h) return; // Left while the shuffle was still running
  let shoeIx = 0;

  // The buy-in comes off once at the start of the match, not every round
  h.stack = setChips(h.stack - a.buyIn);
  // You sit in the middle of the room's regulars, in their listed order
  const openers = openersAt(a);
  const names = [];
  for (let i = 0; i < a.bots + 1; i++) names.push(i === openers ? "You" : a.regulars[i < openers ? i : i - 1] || `Seat ${i + 1}`);

  h.match = createArenaMatch({
    deck: shoes[0],
    arena: a,
    names,
    rounds: ARENA_ROUNDS,
    // Next shoe when this one runs out, six cover a match easily
    // The last fallback should never happen, it just stops a freak match getting stuck
    refill: () => shoes[++shoeIx] || buildHouseDeck(),
  });
  h.state = h.match.state();
  h.risk = h.match.bustChance();
  h.shown = h.state.seats.map(() => 0);
  h.stage = "opening";
  h.dealt = false;
  h.result = null;
  h.matches += 1;
  render();
  stepReveal(0, "player");
}

// Turns seats over one card at a time, stopping at the player's seat
// Used for both halves of every round
function stepReveal(from, then) {
  const h = view.arena;
  if (!h) return;
  const n = h.state.seats.length;
  const ms = then === "player" ? arenaOpenMs(n) : arenaRevealMs(n);
  const gap = then === "player" ? Math.round(ARENA_SEAT_GAP / 2) : ARENA_SEAT_GAP;
  const seats = h.state.seats;

  const next = (i) => {
    if (!view.arena || view.arena !== h) return;
    while (i < seats.length && (seats[i].isYou || h.shown[i] >= seats[i].reveal)) {
      if (seats[i].isYou && then === "player") {
        // The opening card can't bust an empty hand, so it's dealt for you, then the room waits
        h.stage = "player";
        render();
        if (!h.state.you.values.length) arenaTimer = setTimeout(() => view.arena === h && arenaHit(), 260);
        return;
      }
      i += 1;
    }
    if (i >= seats.length) {
      if (then === "player") {
        h.stage = "player";
        render();
        return;
      }
      endArenaRound();
      return;
    }
    const s = seats[i];
    h.shown[i] += 1;
    sfx(h.shown[i] > s.values.length ? "buzzer" : "card");
    render();
    const done = h.shown[i] >= s.reveal;
    arenaTimer = setTimeout(() => next(done ? i + 1 : i), done ? gap : ms);
  };

  arenaTimer = setTimeout(() => next(from), ms);
}

function arenaHit() {
  const h = view.arena;
  if (!h || h.stage !== "player" || h.dealing || !h.match || !h.match.canHit()) return;
  h.dealing = true;
  sfx("card");
  render();
  setTimeout(() => {
    if (!view.arena || view.arena !== h) return;
    const res = h.match.hit();
    h.state = h.match.state();
    h.risk = h.match.bustChance();
    h.shown[h.state.you.seat] = h.state.you.reveal;
    h.dealt = true;
    h.dealing = false;
    if (res.bust) {
      sfx("buzzer");
      closeRoom(); // A bust scores zero, it doesn't end your match
    } else {
      render();
    }
  }, ARENA_DEAL_MS);
}

function arenaStay() {
  const h = view.arena;
  if (!h || h.stage !== "player" || h.dealing || !h.match || !h.match.canStay()) return;
  h.scoreAtStop = h.state.you.score;
  h.riskAtStop = h.risk;
  sfx("ding");
  h.match.stay();
  closeRoom();
}

function closeRoom() {
  const h = view.arena;
  h.state = h.match.state();
  h.stage = "closing";
  render();
  stepReveal(h.state.you.seat + 1, "settled");
}

function endArenaRound() {
  const h = view.arena;
  if (!h || !h.match) return;
  clearArenaTimer();
  const st = (h.state = h.match.state());
  h.shown = st.seats.map((s) => s.reveal);

  const s = arenaSession;
  if (s) {
    s.rounds += 1;
    if (st.you.busted) s.zeroRounds += 1;
  }

  if (st.phase === "settled") return settleArenaMatch();

  h.stage = "round_end";
  const gained = st.you.rounds[st.you.rounds.length - 1] || 0;
  if (gained > 0) sfx("chips");
  render();
  arenaTimer = setTimeout(() => {
    if (!view.arena || view.arena !== h || !h.match) return;
    h.match.nextRound();
    h.state = h.match.state();
    h.risk = h.match.bustChance();
    h.shown = h.state.seats.map(() => 0);
    h.stage = "opening";
    h.dealt = false;
    render();
    stepReveal(0, "player");
  }, ARENA_ROUND_END_MS);
}

function settleArenaMatch() {
  const h = view.arena;
  if (!h || !h.match) return;
  clearArenaTimer();
  const a = h.arena;
  const st = (h.state = h.match.state());
  h.stage = "settled";
  h.shown = st.seats.map((s) => s.reveal);

  const won = st.payout > 0;
  const peakBefore = peakNetWorth();
  const rec = recordHand({
    arena: a,
    payout: st.payout,
    wager: st.wager,
    won,
    busted: false,
    potShare: st.payout,
  });
  h.stack = rec.chips;
  h.streak = won ? h.streak + 1 : 0;
  h.result = arenaVerdict(st, a);

  if (won) sfx(h.streak >= 3 ? "fanfare" : "jackpot");
  else sfx("sad");

  const s = arenaSession;
  s.matches += 1;
  s.wagered += st.wager;
  s.returned += st.payout;
  s.bestStreak = Math.max(s.bestStreak, h.streak);
  if (won) s.wins += 1;

  const champ = st.seats.filter((x) => x.payout > 0).sort((x, y) => y.total - x.total)[0];
  trackArenaHand({
    arena: a.id,
    tier: a.tier,
    seats: st.seats.length,
    rounds: st.rounds,
    buyIn: st.wager,
    pot: st.pot,
    rake: a.rake,
    outcome: st.outcome,
    payout: st.payout,
    net: st.net,
    yourTotal: st.you.total,
    // Gap between you and the room over a match, it shows if the room is pitched right
    bestTotal: champ ? champ.total : 0,
    botBest: Math.max(...st.seats.filter((x) => !x.isYou).map((x) => x.total)),
    zeroRounds: st.you.rounds.filter((v) => v === 0).length,
    reshuffles: st.reshuffles,
    stackAfter: h.stack,
    streak: h.streak,
    match: h.matches,
  });

  // A room opening is the point of the mode, so tell the player right away
  const opened = roomsOpenedBetween(peakBefore, peakNetWorth());
  for (const room of opened) {
    trackArenaUnlock({ arena: room.id, tier: room.tier, peak: peakNetWorth(), fromArena: a.id, matchesHere: h.matches });
    announce(`${room.name.toUpperCase()} IS OPEN`, "win");
    toast(`New room unlocked, ${room.name}`);
  }
  syncPve();
  render();
}

function arenaVerdict(st, a) {
  const you = st.you;
  const champ = st.seats.filter((s) => s.payout > 0).sort((x, y) => y.total - x.total)[0];
  if (st.outcome === "split") {
    const with_ = st.seats.filter((s) => s.payout > 0 && !s.isYou).map((s) => s.name);
    return { tone: "push", title: "SPLIT POT", sub: `${you.total} ties ${with_.join(" and ")} after ${st.rounds} rounds, ${money(you.payout)} each.` };
  }
  if (st.outcome === "win") {
    const second = Math.max(...st.seats.filter((s) => !s.isYou).map((s) => s.total));
    return { tone: "win", title: "YOU TAKE THE POT", sub: `${you.total} to ${second} over ${st.rounds} rounds. ${money(you.payout)} to you.` };
  }
  return {
    tone: "lose",
    title: `${champ ? champ.name.toUpperCase() : "THE HOUSE"} TAKES IT`,
    sub: champ ? `${champ.total} beats your ${you.total} after ${st.rounds} rounds.` : `Nobody scored.`,
  };
}

function arenaAgain() {
  const h = view.arena;
  if (!h) return;
  if (h.stack < h.arena.buyIn) return openLadder();
  arenaStartMatch();
}

function arenaRestake() {
  restake();
  syncPve();
  sfx("chips");
  toast(`+${PVE_RESTAKE} practice chips, on the house`);
  render();
}

// Sends one room visit as one analytics event. Hands per visit shows if players come back
// Wagered against returned shows what the room really pays out
function flushArenaSession(reason) {
  const h = view.arena;
  const s = arenaSession;
  if (!h || !s || !s.matches) return;
  trackArenaSession({
    reason,
    arena: s.arena.id,
    tier: s.arena.tier,
    matches: s.matches,
    rounds: s.rounds,
    durationMs: Date.now() - s.startedAt,
    wagered: s.wagered,
    returned: s.returned,
    net: s.returned - s.wagered,
    wins: s.wins,
    zeroRounds: s.zeroRounds,
    bestStreak: s.bestStreak,
    startStack: s.startStack,
    endStack: h.stack,
    brokeOut: h.stack < s.arena.buyIn,
    rtp: s.wagered ? Number((s.returned / s.wagered).toFixed(4)) : null,
  });
  arenaSession = null;
}

function arenaExit() {
  clearArenaTimer();
  flushArenaSession("exit");
  view.arena = null;
  view.showArenaRules = false;
  openLadder(); // Leaving a table goes back to the ladder, not all the way out
}

function openLeaderboard() {
  syncPve();
  view.pvpWeek = weeklyPvp();
  view.showLeaderboard = true;
  sfx("click");
  render();
}

// The multiplayer board comes from this device's match history over seven days
// Only chip tables, friendly games move no chips
function weeklyPvp() {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const list = loadHistory().filter((h) => h.mode === "online" && h.at >= since && h.entryFee > 0 && h.youNet != null);
  const rows = list.map((h) => ({
    when: new Date(h.at).toLocaleDateString([], { weekday: "short" }),
    room: h.room,
    winner: h.winner,
    youWon: h.youWon,
    net: h.youNet,
    seats: h.players.length,
  }));
  return {
    rows,
    matches: list.length,
    net: list.reduce((n, h) => n + h.youNet, 0),
    won: list.filter((h) => h.youWon).length,
    lost: list.filter((h) => !h.youWon).length,
    best: list.reduce((n, h) => Math.max(n, h.youNet), 0),
  };
}

const ACTIONS = {
  start,
  hit,
  stay,
  stop,
  next,
  again: start,
  verify: verifyFair,
  rules: showRules,
  "rules-back": hideRules,
  daily: claimDaily,
  "sign-in": signIn,
  "watch-ad": watchAdForChips,
  "wheel-collect": closeWheel,
  exit: askExit,
  "exit-no": cancelExit,
  "exit-yes": confirmExitYes,
  history: openHistory,
  "history-back": closeHistory,
  "chat-send": sendChat,
  "tos-accept": acceptTos,
  tos: () => {
    view.showTos = true;
    view.showSettings = false;
    render();
  },
  settings: openSettings,
  "settings-back": closeSettings,
  pause: askPause,
  "pvote-yes": () => votePause(true),
  "pvote-no": () => votePause(false),
  resume: resumeGame,
  "mp-dealnow": mpDealNow,
  "mp-open": openOnline,
  "mp-menu": onlineMenu,
  "mp-quick": quickMatch,
  "mp-browse": openBrowse,
  "mp-browse-refresh": refreshBrowse,
  "mp-create": mpCreate,
  "mp-join-screen": joinScreen,
  "mp-join": mpJoin,
  "mp-start": mpStart,
  "mp-again": mpStart,
  "mp-leave": mpLeave,
  "mp-copy": mpCopy,
  "house-open": openHouse,
  "house-deal": houseDeal,
  "house-hit": houseHit,
  "house-freeze": houseFreeze,
  "house-again": houseAgain,
  "house-topup": houseTopUp,
  "house-exit": houseExit,
  "house-rules": () => {
    view.showHouseRules = true;
    render();
  },
  "house-rules-back": () => {
    view.showHouseRules = false;
    render();
  },
  "arena-open": openLadder,
  "arena-exit": arenaExit,
  "ladder-close": closeLadder, // Back from the ladder select goes all the way to the lobby
  "ladder-again": ladderAgain,
  "ladder-exit": exitLadderGame,
  "arena-hit": arenaHit,
  "arena-stay": arenaStay,
  "arena-again": arenaAgain,
  "arena-restake": arenaRestake,
  "arena-rules": () => {
    view.showArenaRules = true;
    render();
  },
  "arena-rules-back": () => {
    view.showArenaRules = false;
    render();
  },
  leaderboard: openLeaderboard,
  "lb-back": () => {
    view.showLeaderboard = false;
    sfx("click");
    render();
  },
};

root.addEventListener("click", (e) => {
  if (!audioReady) {
    // The click that unlocks audio is the last chance to apply a platform mute
    applyPlatformSettings();
    initAudio();
    startRadio();
    audioReady = true;
  }
  const el = e.target.closest("[data-action]");
  if (!el) return;
  e.preventDefault();
  if (el.disabled) return;
  if (el.dataset.action === "target") return target(Number(el.dataset.seat));
  if (el.dataset.action === "mp-size") return mpSize(Number(el.dataset.size));
  if (el.dataset.action === "mp-slot") return mpSlot(Number(el.dataset.index), el.dataset.t);
  if (el.dataset.action === "mp-entry") return mpEntry(Number(el.dataset.fee));
  if (el.dataset.action === "mp-rounds") return mpRounds(Number(el.dataset.r));
  if (el.dataset.action === "mp-multi") return mpMulti(el.dataset.on === "1");
  if (el.dataset.action === "mp-public") return mpPublic(el.dataset.on === "1");
  if (el.dataset.action === "mp-drop") return mpDrop(el.dataset.rule);
  if (el.dataset.action === "mp-join-listed") return joinListed(el.dataset.code);
  if (el.dataset.action === "browse-filter") return setBrowseFilter(el.dataset.k, el.dataset.v);
  if (el.dataset.action === "mp-hands") return mpHands(Number(el.dataset.n));
  if (el.dataset.action === "mp-kick") return mpKick(Number(el.dataset.index));
  if (el.dataset.action === "set-pref") return setPref(el.dataset.k, el.dataset.v === "1");
  if (el.dataset.action === "emote") return sendEmote(el.dataset.e);
  if (el.dataset.action === "house-bet") return houseBet(el.dataset.v);
  if (el.dataset.action === "arena-sit") return arenaSit.call({ id: el.dataset.id });
  if (el.dataset.action === "lb-tab") return lbTab(el.dataset.tab);
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn();
});

// Keep the typed room name, code and chat in state so a redraw doesn't wipe them
root.addEventListener("input", (e) => {
  if (e.target.id === "chat-in") {
    view.chatDraft = e.target.value;
    return;
  }
  if (e.target.id === "set-name") {
    view.settingsName = e.target.value;
    try {
      storage.setItem(NAME_KEY, e.target.value.trim().slice(0, 12));
    } catch {
      // Analytics failing never affects the game
    }
    return;
  }
  if (e.target.id === "set-vol") {
    view.settingsVol = Number(e.target.value);
    setRadioVolume(view.settingsVol);
    return;
  }
  if (!view.online) return;
  if (e.target.id === "mp-name") view.online.name = e.target.value;
  if (e.target.id === "mp-code") {
    e.target.value = e.target.value.toUpperCase();
    view.online.codeInput = e.target.value;
  }
});
root.addEventListener("focusin", (e) => {
  if (e.target.id === "chat-in") view.chatFocus = true;
});
root.addEventListener("focusout", (e) => {
  if (e.target.id === "chat-in") view.chatFocus = false;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && view.confirmExit) cancelExit();
});
root.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.target.id === "chat-in") {
    e.preventDefault();
    sendChat();
    return;
  }
  if (!view.online) return;
  if (e.target.id === "mp-code") {
    e.preventDefault();
    mpJoin();
  } else if (e.target.id === "mp-name") {
    e.preventDefault();
    view.online.screen === "join" ? mpJoin() : mpCreate();
  }
});

(async function init() {
  cgInit(); // Has to run before anything else touches the SDK
  gdBoot(); // Only serves ads, nothing waits on it
  // An ad blocker may never let it load, so waiting on it could hang the game
  gpBoot(); // Ads only too, nothing waits on it
  ngBoot(); // Starts a Newgrounds session, nothing waits on it
  // Discord goes first and is waited on, it sends every request through their proxy
  // Nothing can connect before that's done
  await discordBoot();
  cgLoadingStart();
  fitStage();
  // Solo runs the engine in the page, so its analytics needs a way to the backend
  setAnalyticsSink(analyticsSink);
  // Added before the analytics flush so a closed tab still sends the house visit
  const flushHouseOnHide = () => {
    if (view.house) flushHouseSession("hidden");
  };
  window.addEventListener("pagehide", flushHouseOnHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushHouseOnHide();
  });
  installAnalyticsFlush();
  // Any of the three saved keys means this browser has played before
  // Read before the game saves anything, or every visit looks like a return
  const returning = (() => {
    try {
      return !!(storage.getItem(SAVE_KEY) || storage.getItem(HOUSE_KEY) || storage.getItem(HISTORY_KEY));
    } catch {
      return false;
    }
  })();
  trackSessionStart({
    platform: platformName(),
    returning,
    walletMode: walletMode(),
    adsAvailable: adsAvailable(),
    houseStack: loadHouseStack(),
  });
  initRadio();
  try {
    view.showTos = !storage.getItem(TOS_KEY);
  } catch {
    view.showTos = true;
  }
  view.settings = loadSettings();
  setAudioPrefs(view.settings);
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (raw) {
      const blob = JSON.parse(raw);
      if (blob && (blob.phase === "round" || blob.phase === "round_end")) {
        const res = await server.restore(blob);
        if (res.ok) view.snapshot = res.snapshot;
      } else if (blob) {
        await server.restore({ ...blob, phase: "lobby", tournament: null });
      }
    }
  } catch {
    // No save or a broken one just means a fresh game
  }

  if (!view.snapshot) view.snapshot = await server.getState();
  // Chips used to be in the engine save, move that balance into the wallet once
  try {
    const old = JSON.parse(storage.getItem(SAVE_KEY) || "null");
    if (old && old.wallet && Number.isFinite(old.wallet.balance)) seedLocalIfUnset(old.wallet.balance);
  } catch {
    // No old save to carry over
  }
  syncWallet(); // Show the local balance now, the account check comes later
  // Don't play announcements for a loaded game
  prevPhase = view.snapshot.phase;
  prevYourTurn = view.snapshot.yourTurn;
  prevUnique = view.snapshot.players[view.snapshot.you].uniqueCount;
  prevRound = view.snapshot.round.number;
  prevReshuffles = view.snapshot.shoe.reshuffles || 0;
  const le = view.snapshot.lastEvent;
  lastSig = le ? `${le.kind}:${le.seat}:${le.card ? le.card.value : ""}` : "";
  render();
  save();
  setInterval(tickClock, 1000);
  pump();

  applyPlatformSettings();
  cgInit().then(applyPlatformSettings); // Settings can only be read once init is done
  cgOnSettings(applyPlatformSettings);
  // The SDK starts in its own time, so keep checking for a few seconds
  // Muting late is fine, never muting isn't
  let settleTries = 0;
  const settle = setInterval(() => {
    applyPlatformSettings();
    if (++settleTries >= 12) clearInterval(settle);
  }, 500);

  cgLoadingStop();
  gpLoaded(); // GamePix needs this before it serves ads, it also hides their loading screen

  // Links the wallet to a CrazyGames, Discord or Newgrounds account after the game shows
  // Newgrounds signs in a bit later, so it links again when that happens
  const reconnectWallet = async () => {
    await initWallet();
    syncWallet();
    render();
  };
  cgOnAuth(reconnectWallet);
  ngOnAuth(reconnectWallet);
  initWallet().then(() => {
    syncWallet();
    render();
  });

  // Invite accepted with the game already open, the platform calls this instead of reloading
  cgOnJoinRoom((roomId) => {
    const code = String(roomId).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (code.length !== 4) return;
    if (view.mode === "online" && view.online && view.online.lobby && view.online.lobby.code === code) return;
    openOnline();
    joinListed(code);
  });

  // In Discord everyone in the channel's Activity shares one table, so go straight there
  if (discordReady()) {
    const code = roomCodeFor(discordInstanceId());
    openOnline();
    ensureNet();
    view.online.name = readName();
    view.online.screen = "connecting";
    view.online.hadRoom = true;
    render();
    net.joinOrCreate(code, view.online.name, clientId());
    discordSetActivity("7Bust", "At the table");
    return;
  }

  const params = new URLSearchParams(location.search);
  const invited = ((await cgGetInviteRoom()) || params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  const roomParam = invited;
  const saved = loadNet();
  if (roomParam.length === 4) {
    // Invited players join the table straight away, CrazyGames wants them playing, not typing a code
    openOnline();
    joinListed(roomParam);
  } else if (cgInstantMultiplayer()) {
    // CrazyGames launched a party leader to play with friends, so host a table straight away
    // Landing on the table list would leave friends nothing to join
    openOnline();
    mpCreate();
  } else if (saved && saved.code && saved.id) {
    ensureNet();
    view.mode = "online";
    view.online = { screen: "connecting", name: saved.name || "", error: null, lobby: null, hadRoom: true };
    render();
    net.rejoin(saved.code, saved.id);
  }
})();
