// Starts the game, paces the bot turns, saves the game and plays the big announcements

import { createServer } from "./server/mockServer.js";
import { renderApp, chatLines } from "./ui/render.js";
import { morph } from "./ui/morph.js";
import { startCoach, place as placeCoach, coachRunning } from "./ui/coach.js";
import { announce, initAudio, sfx, playVoice, setAudioPrefs, setPlatformMute as setAnnounceMute } from "./ui/announce.js";
import { initRadio, startRadio, setRadioVolume, getRadioVolume, pauseForAd, resumeAfterAd, setPlatformMute as setRadioMute } from "./ui/radio.js";
import { DAILY_BONUS, JACKPOT, spinWheel, today } from "./engine/rewards.js";
import { setAnalyticsSink, trackReward } from "./engine/analytics.js";
import { analyticsSink, installAnalyticsFlush } from "./net/analyticsClient.js";
import { initWallet, walletUser, getBalance, claimDailyBonus, spinPrizeWheel, adjustLocal, refreshBalance, seedLocalIfUnset, dailyClaimedToday, walletMode } from "./net/walletClient.js";
import { cgAccountsAvailable, cgAccountsKnown, cgSignIn, cgOnAuth, cgSettings, cgOnSettings } from "./net/crazygames.js";
import { flyCard } from "./ui/fly.js";
import { showEmote, showSpeech, showShuffle } from "./ui/bubbles.js";
import { aiReactions } from "./engine/aiChatter.js";
import { createNet } from "./net/netClient.js";
import { cgInit, cgLoadingStart, cgLoadingStop, cgSetPlaying, cgHappytime, cgUpdateRoom, cgLeftRoom, cgGetInviteRoom, cgRewardedAd, cgMidgameAd } from "./net/crazygames.js";
import * as storage from "./net/storage.js";

// Solo is free practice, the engine holds no money
// Chips only move where the server can check them, so the browser can't make chips
const server = createServer({ cashless: true });
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
  hintRules: false, // Pulse the "?" until a first timer opens How to Play
  showSettings: false,
  settings: { sfx: true, voice: true },
  browse: null,
  wheel: null,
  adPending: false,
  dailyAvailable: false,
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
    !!view.snapshot &&
    (view.mode === "online"
      ? !!(view.online && view.online.screen === "playing" && view.snapshot.online)
      : view.snapshot.phase !== "lobby");
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
    // At solo tables the bots emote and talk locally, online the room server sends these
    if (view.mode === "solo") {
      for (const r of aiReactions(le, s.players)) {
        if (r.emoji) showEmote(r.seat, r.emoji);
        if (r.text) showSpeech(r.seat, r.text);
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
  sfx("ding");
  apply(res);
}
// Actions go to the local engine in solo or to the room server online
// Sounds and announcements play off the new snapshot either way
async function hit() {
  if (view.mode === "online") return net.intent({ intent: "hit" });
  apply(await server.hit());
}
async function stay() {
  sfx("chips");
  if (Date.now() - lastFlavorAt > 9000 && Math.random() < 0.4) {
    playVoice("coward");
    lastFlavorAt = Date.now();
  }
  if (view.mode === "online") return net.intent({ intent: "stay" });
  apply(await server.stay());
}
async function stop() {
  sfx("click");
  if (view.mode === "online") return net.intent({ intent: "stop" });
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
      } else {
        view.online.screen = "waiting";
        view.online.buyin = null;
        view.online.myHands = null;
      }
      render();
    },
    onState(snapshot, extra) {
      if (!view.online) return;
      reconnectTries = 0;
      view.snapshot = snapshot;
      view.online.screen = "playing";
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
      if (!view.browse) return;
      view.browse.list = list;
      view.browse.loading = false;
      if (view.online && view.online.screen === "browse") render();
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
      if ((screen === "playing" || screen === "waiting") && reconnectTries < 8) {
        const c = loadNet();
        if (c && c.code && c.id) {
          reconnectTries += 1;
          if (screen === "playing") toast("Reconnecting…");
          setTimeout(() => net && net.rejoin(c.code, c.id), 1200);
        }
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
  view.online = { screen: "menu", name: (saved && saved.name) || savedName() || "", error: null, lobby: null };
  render();
}
function onlineMenu() {
  if (!view.online) return openOnline();
  view.online.screen = "menu";
  view.online.error = null;
  stopBrowsePoll();
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
  view.mode = "solo";
  view.online = null;
  // Back to the solo lobby, the online snapshot isn't ours any more
  if (!view.snapshot || view.snapshot.online) await refreshSolo();
  render();
  await maybeMidgameAd(); // Back at the menu counts as a break
}
function mpCopy() {
  const code = view.online && view.online.lobby && view.online.lobby.code;
  if (!code) return;
  const link = `${location.origin}${location.pathname}?room=${code}`;
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
// Ads only show at a break, never during a match or while other players wait on us
// window.__AD_INTERVAL_MS__ lets tests change how often they show
const AD_INTERVAL_MS = Number(window.__AD_INTERVAL_MS__) || 20 * 60 * 1000;
let lastAdAt = Date.now();
async function maybeMidgameAd() {
  if (Date.now() - lastAdAt < AD_INTERVAL_MS) return;
  // Never interrupt live play, whatever the caller thinks
  const s = view.snapshot;
  const inMatch = view.mode === "online" ? !!(view.online && view.online.screen === "playing") : !!s && s.phase !== "lobby";
  if (inMatch) return;
  lastAdAt = Date.now(); // Count the try either way so an empty ad slot can't spam retries
  try {
    await cgMidgameAd({ onStart: pauseForAd, onEnd: resumeAfterAd });
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
    await cgRewardedAd({ onStart: pauseForAd, onEnd: resumeAfterAd });
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
  if (aiTimer) {
    clearTimeout(aiTimer); // Stop any queued bot move before closing the match
    aiTimer = null;
  }
  apply(await server.abandonMatch());
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
  "mp-browse": openBrowse,
  "mp-browse-refresh": refreshBrowse,
  "mp-create": mpCreate,
  "mp-join-screen": joinScreen,
  "mp-join": mpJoin,
  "mp-start": mpStart,
  "mp-again": mpStart,
  "mp-leave": mpLeave,
  "mp-copy": mpCopy,
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
  cgLoadingStart();
  fitStage();
  // Solo runs the engine in the page, so its analytics needs a way to the backend
  setAnalyticsSink(analyticsSink);
  installAnalyticsFlush();
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

  // Links the wallet to a CrazyGames account after the game shows, so a slow reply never holds it up
  // Guests can play on the local balance the whole time
  cgOnAuth(async () => {
    await initWallet();
    syncWallet();
    render();
  });
  initWallet().then(() => {
    syncWallet();
    render();
  });

  const params = new URLSearchParams(location.search);
  const invited = ((await cgGetInviteRoom()) || params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  const roomParam = invited;
  const saved = loadNet();
  if (roomParam.length === 4) {
    openOnline();
    view.online.codeInput = roomParam;
    view.online.screen = "join";
    render();
  } else if (saved && saved.code && saved.id) {
    ensureNet();
    view.mode = "online";
    view.online = { screen: "connecting", name: saved.name || "", error: null, lobby: null, hadRoom: true };
    render();
    net.rejoin(saved.code, saved.id);
  }
})();
