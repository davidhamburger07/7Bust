// Starts the game, paces the bot turns, saves the game and plays the big announcements

import { createServer } from "./server/mockServer.js";
import { renderApp } from "./ui/render.js";
import { announce, initAudio, sfx, playVoice } from "./ui/announce.js";
import { initRadio, startRadio } from "./ui/radio.js";
import { flyCard } from "./ui/fly.js";
import { showEmote, showSpeech } from "./ui/bubbles.js";
import { aiReactions } from "./engine/aiChatter.js";
import { createNet } from "./net/netClient.js";

const server = createServer();
const root = document.getElementById("app");
const bootAt = Date.now();

const AI_DELAY = 850;
const SAVE_KEY = "7bust:save:v3"; // The deck changed, older saves can't resume
const NET_KEY = "7bust:net"; // Saved details to rejoin an online room
const LEDGER_KEY = "7bust:mpledger"; // Each online match's buy-in and payout only count once
const HISTORY_KEY = "7bust:history";

// Solo runs the engine in the page, online sends actions over a WebSocket and draws what comes back
const view = { snapshot: null, lastEvent: null, toast: null, entryFee: null, mode: "solo", online: null, chat: [], chatDraft: "", chatFocus: false, showHistory: false, soloBalance: 0 };
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

function render() {
  view.lastEvent = view.snapshot ? view.snapshot.lastEvent : null;
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
    !!view.snapshot &&
    (view.mode === "online"
      ? !!(view.online && view.online.screen === "playing" && view.snapshot.cashless)
      : view.snapshot.phase !== "lobby");
  document.body.classList.toggle("scr-match", matchVisible);
  root.innerHTML = renderApp(view);
  const newLog = document.getElementById("log");
  if (newLog) newLog.scrollTop = atBottom ? newLog.scrollHeight : prevTop;
  const chatList = document.getElementById("chatlist");
  if (chatList) chatList.scrollTop = chatList.scrollHeight;
  // A full redraw takes focus from the chat box, so give it back
  if (view.chatFocus) {
    const ci = document.getElementById("chat-in");
    if (ci) {
      ci.focus();
      const end = ci.value.length;
      ci.setSelectionRange(end, end);
    }
  }
}

function tickClock() {
  const t = fmt(Date.now() - bootAt);
  document.querySelectorAll("[data-clock]").forEach((el) => (el.textContent = t));
}

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
    localStorage.setItem(SAVE_KEY, JSON.stringify(server.serialize()));
  } catch {
    // Storage isn't available, the game still works without it
  }
}

// Online buy-ins come off the solo chip balance at the deal and the payout lands at the end
// Each match only counts once
async function settleMpWallet(s) {
  if (view.mode !== "online" || !s || !s.tournament || !s.fair || !s.fair.serverSeedHash) return;
  const key = s.fair.serverSeedHash;
  let led;
  try {
    led = JSON.parse(localStorage.getItem(LEDGER_KEY) || "null");
  } catch {
    led = null;
  }
  if (!led || led.key !== key) led = { key, debited: false, credited: false };
  let changed = false;
  if (!led.debited && s.phase !== "lobby") {
    led.debited = true;
    changed = true;
    await server.adjustBalance(-s.tournament.entryFee);
    toast(`Buy-in taken: −${s.tournament.entryFee} chips`);
  }
  if (!led.credited && s.phase === "match_end" && s.tournament.settled) {
    led.credited = true;
    changed = true;
    if (s.tournament.youPayout > 0) {
      await server.adjustBalance(s.tournament.youPayout);
      toast(`You collect ${s.tournament.youPayout} chips!`);
    }
  }
  if (changed) {
    try {
      localStorage.setItem(LEDGER_KEY, JSON.stringify(led));
      localStorage.setItem(SAVE_KEY, JSON.stringify(server.serialize()));
    } catch {
      // Storage isn't available, the game still works without it
    }
    view.soloBalance = (await server.getState()).wallet.balance;
  }
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
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
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 30)));
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
  if (s.shoe && s.shoe.reshuffles > prevReshuffles) sfx("shuffle");
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
    recordHistory(s);
  }
  prevPhase = s.phase;
}

function apply(res) {
  if (res && res.snapshot) view.snapshot = res.snapshot;
  if (view.snapshot && view.snapshot.wallet) view.soloBalance = view.snapshot.wallet.balance;
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
  const res = await server.startMatch({ entryFee: view.entryFee });
  if (!res.ok) {
    view.snapshot = res.snapshot;
    render();
    toast(res.reason === "insufficient-balance" ? "Not enough chips for that buy-in." : "Can't start right now.");
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
    return JSON.parse(localStorage.getItem(NET_KEY) || "null");
  } catch {
    return null;
  }
};
const persistNet = (code, id, name) => {
  try {
    localStorage.setItem(NET_KEY, JSON.stringify({ code, id, name }));
  } catch {
    // Analytics failing never affects the game
  }
};
const clearNet = () => {
  try {
    localStorage.removeItem(NET_KEY);
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
      view.online.lobby = { code: msg.code, status: msg.status, size: msg.size, slots: msg.slots, filled: msg.filled, entry: msg.entry || 0, rounds: msg.rounds || 9, you: msg.you, self: msg.self, isHost: msg.isHost };
      persistNet(msg.code, msg.self, view.online.name);
      if (msg.status === "playing") {
        if (view.online.screen !== "playing" && view.snapshot && view.snapshot.cashless) view.online.screen = "playing";
        // Otherwise wait for the first state to switch us in
      } else {
        view.online.screen = "waiting";
      }
      render();
    },
    onState(snapshot) {
      if (!view.online) return;
      reconnectTries = 0;
      view.snapshot = snapshot;
      view.online.screen = "playing";
      render();
      handleAnnouncements(snapshot);
      settleMpWallet(snapshot);
    },
    onChat(list) {
      const seen = new Set(view.chat.map((c) => `${c.at}:${c.seat}:${c.text}`));
      for (const c of list || []) {
        if (c.ai && !seen.has(`${c.at}:${c.seat}:${c.text}`) && view.online && view.online.screen === "playing") {
          showSpeech(c.seat, c.text);
        }
      }
      const changed = JSON.stringify(list) !== JSON.stringify(view.chat);
      view.chat = list || [];
      if (changed) render();
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
      const fatal = ["Room not found", "That game already started", "Room is full", "Seat not found"];
      if (fatal.includes(err)) {
        clearNet();
        view.online.lobby = null;
        if (view.online.screen === "connecting" || view.online.screen === "playing") view.online.screen = view.online.hadRoom ? "menu" : "join";
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
  const n = ((el ? el.value : view.online && view.online.name) || "").trim();
  return n || "Player";
};

function openOnline() {
  const saved = loadNet();
  view.mode = "online";
  view.online = { screen: "menu", name: (saved && saved.name) || "", error: null, lobby: null };
  render();
}
function onlineMenu() {
  if (!view.online) return openOnline();
  view.online.screen = "menu";
  view.online.error = null;
  render();
}
function mpCreate() {
  ensureNet();
  view.online.name = readName();
  view.online.hadRoom = true;
  view.online.screen = "connecting";
  view.online.error = null;
  render();
  net.create(view.online.name);
}
function joinScreen() {
  view.online.screen = "join";
  view.online.error = null;
  render();
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
  net.join(code, view.online.name);
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
  view.history = loadHistory();
  render();
}
function closeHistory() {
  view.showHistory = false;
  render();
}
async function mpLeave() {
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
  if (!view.snapshot || view.snapshot.cashless) await refreshSolo();
  render();
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
const resetBalance = async () => {
  apply(await server.resetBalance());
  toast("Chips reset to 1,000.");
};
function setEntry(fee) {
  view.entryFee = fee;
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
  "reset-balance": resetBalance,
  exit: askExit,
  "exit-no": cancelExit,
  "exit-yes": confirmExitYes,
  history: openHistory,
  "history-back": closeHistory,
  "chat-send": sendChat,
  "mp-open": openOnline,
  "mp-menu": onlineMenu,
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
    initAudio();
    startRadio();
    audioReady = true;
  }
  const el = e.target.closest("[data-action]");
  if (!el) return;
  e.preventDefault();
  if (el.disabled) return;
  if (el.dataset.action === "target") return target(Number(el.dataset.seat));
  if (el.dataset.action === "entry") return setEntry(Number(el.dataset.fee));
  if (el.dataset.action === "mp-size") return mpSize(Number(el.dataset.size));
  if (el.dataset.action === "mp-slot") return mpSlot(Number(el.dataset.index), el.dataset.t);
  if (el.dataset.action === "mp-entry") return mpEntry(Number(el.dataset.fee));
  if (el.dataset.action === "mp-rounds") return mpRounds(Number(el.dataset.r));
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
  initRadio();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
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
  view.entryFee = view.snapshot.config?.defaultEntry ?? 100;
  view.soloBalance = view.snapshot.wallet ? view.snapshot.wallet.balance : 0;
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

  const params = new URLSearchParams(location.search);
  const roomParam = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
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
