// Starts the game and paces the bot turns so the player can watch each one

import { createServer } from "./server/mockServer.js";
import { renderApp } from "./ui/render.js";

const server = createServer();
const root = document.getElementById("app");
const bootAt = Date.now();

const AI_DELAY = 850; // Wait between bot moves, in ms

const view = { snapshot: null, lastEvent: null, toast: null };
let aiTimer = null;

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

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
  pump();
}

const start = async () => apply(await server.startMatch());
const hit = async () => apply(await server.hit());
const stay = async () => apply(await server.stay());
const stop = async () => apply(await server.stop());
const next = async () => apply(await server.nextRound());
const target = async (seat) => apply(await server.resolveChoice({ targetSeat: seat }));

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

const ACTIONS = { start, hit, stay, stop, next, again: start, verify: verifyFair, limits: showLimits, rules: showRules, "rules-back": hideRules };

root.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  e.preventDefault();
  if (el.disabled) return;
  if (el.dataset.action === "target") {
    target(Number(el.dataset.seat));
    return;
  }
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn();
});

(async function init() {
  view.snapshot = await server.getState();
  render();
  setInterval(tickClock, 1000);
})();
