// Starts the game, paces the bot turns and saves so a refresh picks up where it left off

import { createServer } from "./server/mockServer.js";
import { renderApp } from "./ui/render.js";

const server = createServer();
const root = document.getElementById("app");
const bootAt = Date.now();

const AI_DELAY = 850; // Wait between bot moves, in ms
const SAVE_KEY = "7bust:save:v1";

const view = { snapshot: null, lastEvent: null, toast: null, entryFee: null };
let aiTimer = null;

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function render() {
  view.lastEvent = view.snapshot ? view.snapshot.lastEvent : null;
  root.innerHTML = renderApp(view);
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
    // Storage can fail in private mode, the game just won't offer to resume
  }
}

function pump() {
  const s = view.snapshot;
  if (!s || aiTimer || !s.autoStep) return;
  aiTimer = setTimeout(async () => {
    aiTimer = null;
    apply(await server.step());
  }, AI_DELAY);
}

function apply(res) {
  if (res && res.snapshot) view.snapshot = res.snapshot;
  render();
  save();
  pump();
}

async function start() {
  const res = await server.startMatch({ entryFee: view.entryFee });
  if (!res.ok) {
    view.snapshot = res.snapshot;
    render();
    toast(res.reason === "insufficient-balance" ? "Not enough credits for that buy-in." : "Can't start right now.");
    return;
  }
  apply(res);
}
const hit = async () => apply(await server.hit());
const stay = async () => apply(await server.stay());
const stop = async () => apply(await server.stop());
const next = async () => apply(await server.nextRound());
const target = async (seat) => apply(await server.resolveChoice({ targetSeat: seat }));
const resetBalance = async () => {
  apply(await server.resetBalance());
  toast("Demo balance reset to 1,000 credits.");
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

function showLimits() {
  const rg = view.snapshot.session;
  toast(`Session ${fmt(rg.elapsedMs)} · limit ${rg.sessionTimeLimitMin}m · reality checks on`);
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
  limits: showLimits,
  rules: showRules,
  "rules-back": hideRules,
  "reset-balance": resetBalance,
};

root.addEventListener("click", (e) => {
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
  let resumed = false;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const blob = JSON.parse(raw);
      if (blob && (blob.phase === "round" || blob.phase === "round_end")) {
        // Mid-tournament, so resume exactly where they left off
        const res = await server.restore(blob);
        if (res.ok) {
          view.snapshot = res.snapshot;
          resumed = true;
        }
      } else if (blob) {
        // Match over or in the lobby, carry the wallet balance into a fresh lobby
        await server.restore({ ...blob, phase: "lobby", tournament: null });
      }
    }
  } catch {
    // No save or a broken one just means a fresh game
  }

  if (!view.snapshot) view.snapshot = await server.getState();
  view.entryFee = view.snapshot.config?.defaultEntry ?? 100;
  render();
  save();
  setInterval(tickClock, 1000);
  pump();
  if (resumed) toast("Resumed your tournament.");
})();
