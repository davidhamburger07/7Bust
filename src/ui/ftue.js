// Tutorial for the first solo hand, it dims the table and lights up the next button to press
// Lives on the page body so it survives redraws, clicks only reach the lit button

import * as storage from "../net/storage.js";

const DONE_KEY = "7bust:ftue:done:v1";
const DRAW_TARGET = 3; // Cards to draw before teaching stop, keeps the first hand fairly safe
const CALLOUT_MS = 1800; // How long a card tip holds the spotlight
const PAD = 10; // Space around the lit target in pixels

let active = false;
let finishing = false;
let rerender = () => {};
let root = null;
let calloutUntil = 0;
let calloutRect = null;
let calloutTip = "";
let calloutTimer = null;
let lastEventSig = ""; // So each special card is only explained once

export function hasCompletedTutorial() {
  try {
    return storage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}
function markDone() {
  try {
    storage.setItem(DONE_KEY, "1");
  } catch {
    // Saving failed, the game still works but may show the tutorial again
  }
}
export const ftueActive = () => active;

// Rerender lets a timed card tip redraw the mask when it runs out
export function ftueStart(opts = {}) {
  if (active || hasCompletedTutorial()) return;
  active = true;
  finishing = false;
  lastEventSig = "";
  calloutUntil = 0;
  calloutRect = null;
  rerender = typeof opts.rerender === "function" ? opts.rerender : () => {};
  build();
}

function build() {
  root = document.createElement("div");
  root.id = "ftue";
  root.innerHTML = `
    <div class="ftue-mask ftue-mask--t"></div>
    <div class="ftue-mask ftue-mask--b"></div>
    <div class="ftue-mask ftue-mask--l"></div>
    <div class="ftue-mask ftue-mask--r"></div>
    <div class="ftue-ring" aria-hidden="true"></div>
    <div class="ftue-tip"><span class="ftue-tip-text"></span><button class="ftue-skip" data-ftue="skip" type="button">Skip</button></div>`;
  document.body.appendChild(root);
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-ftue='skip']")) {
      e.preventDefault();
      return ftueSkip();
    }
    if (e.target.closest(".ftue-mask")) nudge(); // Clicked the dim area, bounce the ring as a hint
  });
}

const q = (sel) => (root ? root.querySelector(sel) : null);

// The bounding rect already includes the stage scale, so fixed positions line up
function setBox(node, x, y, w, h) {
  node.style.left = `${Math.round(x)}px`;
  node.style.top = `${Math.round(y)}px`;
  node.style.width = `${Math.max(0, Math.round(w))}px`;
  node.style.height = `${Math.max(0, Math.round(h))}px`;
}

function showMask(on) {
  if (!root) return;
  root.classList.toggle("masked", on);
  // Measuring the tip leaves an inline display on it that beats the CSS, so clear it here
  // or the tip stays up after the mask lifts
  if (!on) {
    const tip = q(".ftue-tip");
    if (tip) tip.style.display = "none";
  }
}

// Dims around the rect, rings it and puts the tip above it, or below if there's no room
// Special uses the rarer colour for card tips
function spotlight(rect, tip, special) {
  if (!root) return;
  root.classList.toggle("ftue--special", !!special);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(0, rect.left - PAD);
  const top = Math.max(0, rect.top - PAD);
  const right = Math.min(vw, rect.right + PAD);
  const bottom = Math.min(vh, rect.bottom + PAD);
  const w = right - left;
  const h = bottom - top;
  setBox(q(".ftue-mask--t"), 0, 0, vw, top);
  setBox(q(".ftue-mask--b"), 0, bottom, vw, vh - bottom);
  setBox(q(".ftue-mask--l"), 0, top, left, h);
  setBox(q(".ftue-mask--r"), right, top, vw - right, h);
  setBox(q(".ftue-ring"), left, top, w, h);
  showMask(true);
  const tipEl = q(".ftue-tip");
  q(".ftue-tip-text").textContent = tip;
  tipEl.style.display = "flex";
  placeTip(tipEl, { left, top, right, bottom, w, h }, vw, vh);
}

// The tip must never cover the game, so it goes on the side that overlaps the cards least
// while staying on screen
const PROTECT = [".you-seat", ".opponents", ".dealer-zone", ".felt-spot"];
function overlapArea(x, y, w, h, rects) {
  let total = 0;
  for (const r of rects) {
    const ix = Math.max(0, Math.min(x + w, r.right) - Math.max(x, r.left));
    const iy = Math.max(0, Math.min(y + h, r.bottom) - Math.max(y, r.top));
    total += ix * iy;
  }
  return total;
}
function placeTip(tipEl, hole, vw, vh) {
  const tw = tipEl.offsetWidth || 240;
  const th = tipEl.offsetHeight || 62;
  const gap = 15;
  const protect = PROTECT.map((s) => document.querySelector(s))
    .filter(Boolean)
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width && r.height);
  const cx = hole.left + hole.w / 2 - tw / 2;
  const cy = hole.top + hole.h / 2 - th / 2;
  const cands = [
    { side: "top", x: cx, y: hole.top - th - gap },
    { side: "bottom", x: cx, y: hole.bottom + gap },
    { side: "right", x: hole.right + gap, y: cy },
    { side: "left", x: hole.left - tw - gap, y: cy },
  ];
  let best = null;
  for (const c of cands) {
    const offscreen = c.x < 8 || c.x + tw > vw - 8 || c.y < 8 || c.y + th > vh - 8;
    const x = Math.max(8, Math.min(c.x, vw - tw - 8));
    const y = Math.max(8, Math.min(c.y, vh - th - 8));
    const score = overlapArea(x, y, tw, th, protect) + (offscreen ? 1e6 : 0);
    if (!best || score < best.score) best = { side: c.side, x, y, score };
    if (best.score === 0) break; // First side that's fully clear wins, in this order
  }
  tipEl.style.left = `${Math.round(best.x)}px`;
  tipEl.style.top = `${Math.round(best.y)}px`;
  tipEl.dataset.side = best.side;
}

function nudge() {
  const ring = q(".ftue-ring");
  if (!ring) return;
  ring.classList.remove("nudge");
  void ring.offsetWidth; // Forces a reflow so the animation restarts
  ring.classList.add("nudge");
}

// Runs after every render and picks what to spotlight
// It stays out of the way on AI turns and ends the tutorial at the finish
export function ftueSync(view) {
  if (!active || !root) return;
  const s = view.snapshot;
  if (!s) return showMask(false);
  const me = s.players[s.you];
  if (!me) return showMask(false);

  if (me.turnState === "busted") return finish("Busted! A repeat number scores zero, that's the risk. Play on!", true);
  if (me.turnState === "banked" || me.turnState === "clean7") return finish("Banked! Those points are safe now. You've got this.", false);
  if (s.phase === "match_end") return finish("", false);

  // A card tip keeps the spotlight on the card for a moment
  if (Date.now() < calloutUntil && calloutRect) return spotlight(calloutRect, calloutTip, true);

  const special = detectSpecial(view, me);
  if (special) {
    startCallout(special.rect, special.tip);
    return spotlight(special.rect, special.tip, true);
  }

  // Action card needs a target, point at the choices so the screen doesn't just go dark
  if (s.pendingChoice) return step(".targets", "Tap a player to target with your card!");
  // No dimming during the AI turns
  if (!s.yourTurn) return showMask(false);

  // Draw a few, then stop, then bank on the next turn
  const cards = me.cardCount;
  if (!s.youHitThisTurn && cards === 0) return step(".btn--hit", "Click to draw a card and build your stack!");
  if (s.youHitThisTurn && cards < DRAW_TARGET) return step(".btn--hit", "Nice, draw again to grow your stack!");
  if (s.youHitThisTurn && cards >= DRAW_TARGET) return step(".btn--stop", "Stop now, or risk a duplicate and BUST!");
  if (!s.youHitThisTurn && cards > 0 && s.canBank) return step(".btn--bank", "Bank it now, lock in your points!");
  showMask(false);
}

function step(sel, tip) {
  const t = document.querySelector(sel);
  if (!t) return showMask(false);
  const r = t.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return showMask(false);
  spotlight(r, tip, false);
}

// Finds a new card in the player's hand worth explaining, once per event
// The rect is copied because the card's element gets redrawn away
function detectSpecial(view, me) {
  const le = view.snapshot.lastEvent;
  if (!le || le.seat !== view.snapshot.you) return null;
  const c = le.card;
  const sig = `${le.kind}:${le.seat}:${(c && (c.value ?? c.action ?? c.op)) ?? ""}:${me.cardCount}`;
  if (sig === lastEventSig) return null;
  let tip = null;
  let sel = null;
  if (c && c.kind === "number" && c.value === 1) {
    tip = "The lucky 1, the rarest card in the deck!";
    sel = ".you-seat .card--new";
  } else if (c && c.kind === "modifier" && c.op === "mult") {
    tip = "A ×2, it doubles your whole stack!";
    sel = ".you-seat .modcard:last-of-type";
  } else if (c && c.kind === "modifier") {
    tip = `A +${c.amount} bonus, straight onto your stack!`;
    sel = ".you-seat .modcard:last-of-type";
  } else if (le.kind === "see_future") {
    tip = "See the Future, you peeked the next card!";
    sel = ".peek-chip";
  } else if (le.kind === "saved" || (c && c.action === "second_chance")) {
    tip = "Second Chance, your next bust is forgiven!";
    sel = ".you-seat .sc-dot";
  }
  if (!tip) return null;
  lastEventSig = sig;
  const t = document.querySelector(sel) || document.querySelector(".you-seat");
  if (!t) return null;
  const r = t.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, tip };
}

function startCallout(rect, tip) {
  calloutRect = rect;
  calloutTip = tip;
  calloutUntil = Date.now() + CALLOUT_MS;
  if (calloutTimer) clearTimeout(calloutTimer);
  // Redraw once the tip is over so the button spotlight comes back without a game event
  calloutTimer = setTimeout(() => {
    calloutTimer = null;
    calloutUntil = 0;
    calloutRect = null;
    rerender();
  }, CALLOUT_MS + 30);
}

// Message shows one last note before the overlay clears
function finish(message, isBust) {
  if (finishing) return;
  finishing = true;
  markDone();
  if (message && root) {
    showMask(false);
    const f = document.createElement("div");
    f.className = `ftue-final${isBust ? " bust" : " win"}`;
    f.innerHTML = `<div class="ftue-final-card"><div class="ftue-final-icon">${isBust ? "💥" : "🎉"}</div><p>${message}</p></div>`;
    root.appendChild(f);
    setTimeout(teardown, 2400);
  } else {
    teardown();
  }
}

function teardown() {
  active = false;
  finishing = false;
  if (calloutTimer) clearTimeout(calloutTimer);
  calloutTimer = null;
  calloutUntil = 0;
  calloutRect = null;
  if (root) root.remove();
  root = null;
}

// Skipping still counts as done, the tutorial never shows twice
export function ftueSkip() {
  markDone();
  teardown();
  rerender();
}

// Clears the seen flag so the tutorial can run again, used by "Replay tutorial" in settings
// The caller then deals a new solo hand
export function resetTutorial() {
  try {
    storage.removeItem(DONE_KEY);
  } catch {
    // Storage isn't available, the game still works without it
  }
  teardown();
}

// Marks the tutorial seen without running it, for "I've played before" or "no thanks"
export function markTutorialSeen() {
  markDone();
}
