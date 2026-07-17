// Starts the game, paces the bot turns, saves the game and plays the big announcements

import { createServer } from "./server/mockServer.js";
import { renderApp } from "./ui/render.js";
import { announce, initAudio, sfx } from "./ui/announce.js";

const server = createServer();
const root = document.getElementById("app");
const bootAt = Date.now();

const AI_DELAY = 850;
const SAVE_KEY = "7bust:save:v2";

const view = { snapshot: null, lastEvent: null, toast: null, entryFee: null };
let aiTimer = null;
let audioReady = false;
let prevPhase = "lobby";
let lastSig = "";

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
  root.innerHTML = renderApp(view);
  const newLog = document.getElementById("log");
  if (newLog) newLog.scrollTop = atBottom ? newLog.scrollHeight : prevTop;
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
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(server.serialize()));
  } catch {
    // Storage isn't available, the game still works without it
  }
}

function handleAnnouncements(s) {
  const le = s.lastEvent;
  const sig = le ? `${le.kind}:${le.seat}:${le.card ? le.card.value : ""}` : "";
  if (sig && sig !== lastSig) {
    lastSig = sig;
    const mine = le.seat === s.you;
    if (le.kind === "bust") mine ? announce("bust") : sfx("buzzer");
    else if (le.kind === "frozen") mine ? announce("frozen") : sfx("freeze");
    else if (le.kind === "clean7") announce("clean7");
    else if (le.kind === "flip3" && mine) announce("flip3");
  }
  if (s.phase === "match_end" && prevPhase !== "match_end") {
    announce(s.winner === s.you ? "win" : "lose");
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
  if (!s || aiTimer || !s.autoStep) return;
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
async function hit() {
  sfx("tick");
  apply(await server.hit());
}
async function stay() {
  sfx("ding");
  apply(await server.stay());
}
const stop = async () => apply(await server.stop());
const next = async () => apply(await server.nextRound());
const target = async (seat) => apply(await server.resolveChoice({ targetSeat: seat }));
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

const showRules = () => {
  view.showRules = true;
  render();
};
const hideRules = () => {
  view.showRules = false;
  render();
};

const ACTIONS = { start, hit, stay, stop, next, again: start, verify: verifyFair, rules: showRules, "rules-back": hideRules, "reset-balance": resetBalance };

root.addEventListener("click", (e) => {
  if (!audioReady) {
    initAudio();
    audioReady = true;
  }
  const el = e.target.closest("[data-action]");
  if (!el) return;
  e.preventDefault();
  if (el.disabled) return;
  if (el.dataset.action === "target") return target(Number(el.dataset.seat));
  if (el.dataset.action === "entry") return setEntry(Number(el.dataset.fee));
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn();
});

(async function init() {
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
  // Don't play announcements for a loaded game
  prevPhase = view.snapshot.phase;
  const le = view.snapshot.lastEvent;
  lastSig = le ? `${le.kind}:${le.seat}:${le.card ? le.card.value : ""}` : "";
  render();
  save();
  setInterval(tickClock, 1000);
  pump();
})();
