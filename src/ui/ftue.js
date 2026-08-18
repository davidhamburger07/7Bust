// Tutorial for the first solo hand, it dims the table and lights up the next button to press
// Lives on the page body so it survives redraws, clicks only reach the lit button

import * as storage from "../net/storage.js";
import { playVoice } from "./announce.js";

const DONE_KEY = "7bust:ftue:done:v1";
const DRAW_TARGET = 3; // Cards to draw before teaching stop, keeps the first hand fairly safe
// Shown and spoken once on the first number card, the text matches the voice line
const CARD_VALUES_TIP = "A card's number is its points, and how many of it are in the deck. Big numbers score more, but bust you sooner!";
const CALLOUT_MS = 1800; // How long a card tip holds the spotlight
const PAD = 10; // Space around the lit target in pixels

let active = false;
let finishing = false;
let lastVoiceKey = ""; // So a step's voice line plays once, not on every redraw
let currentStepKey = ""; // So skip knows which step to skip
let skippedKey = ""; // Skipped step, its hint stays hidden until the step changes
let currentSpot = null;
let placedKey = ""; // So the loop only restyles when the spot actually moves
let rafId = 0; // Keeps the highlight on its target as it moves
let rerender = () => {};
let root = null;
let calloutUntil = 0;
let calloutRect = null;
let calloutSel = null; // The card with the tip, so the tip follows it
let calloutTip = "";
let calloutTimer = null;
let lastEventSig = ""; // So each special card is only explained once
let cardValuesShown = false; // The card number tip only shows on the first draw

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
  lastVoiceKey = "";
  currentStepKey = "";
  skippedKey = "";
  cardValuesShown = false;
  currentSpot = null;
  placedKey = "";
  calloutUntil = 0;
  calloutRect = null;
  calloutSel = null;
  rerender = typeof opts.rerender === "function" ? opts.rerender : () => {};
  build();
  if (!rafId) rafId = requestAnimationFrame(tick);
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
    currentSpot = null; // Nothing to follow while the mask is down on AI turns and at the end
    placedKey = "";
  }
}

// Looks the target up every frame so it follows a moving button or card
// Falls back to the saved rect if the element is gone for a moment
function targetRectFor(spot) {
  if (spot.sel) {
    const t = document.querySelector(spot.sel);
    if (t) {
      const r = t.getBoundingClientRect();
      if (r.width || r.height) return r;
    }
  }
  return spot.rect || null;
}

// Moves the highlight if its target moved, force redraws even if it didn't
// Runs every frame so it follows cards dealing in, resizing and scrolling
function reposition(force) {
  if (!root || !currentSpot) return;
  const r = targetRectFor(currentSpot);
  if (!r) return;
  const key = `${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.width)}:${Math.round(r.height)}`;
  if (!force && key === placedKey) return;
  placedKey = key;
  spotlight(r, currentSpot.tip, currentSpot.special);
}

function tick() {
  if (!active) {
    rafId = 0;
    return;
  }
  reposition(false);
  rafId = requestAnimationFrame(tick);
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

  if (me.turnState === "busted") return finish("Busted! A repeat wipes the round, that's the risk. Give it another go!", true, "tutBusted");
  if (me.turnState === "banked" || me.turnState === "clean7") return finish("Banked! Those points are safe now. You've got this.", false, "tutBanked");
  if (s.phase === "match_end") return finish("", false);

  // A card tip keeps the spotlight on the card for a moment
  if (Date.now() < calloutUntil && calloutRect) {
    currentSpot = { sel: calloutSel, rect: calloutRect, tip: calloutTip, special: true };
    return reposition(true);
  }

  const special = detectSpecial(view, me);
  if (special) {
    startCallout(special.sel, special.rect, special.tip);
    currentSpot = { sel: special.sel, rect: special.rect, tip: special.tip, special: true };
    return reposition(true);
  }

  // First plain number card, explain that its number is its points and how many are in the deck
  const cardVals = detectCardValues(view, me);
  if (cardVals) {
    playVoice("tutCardValues");
    startCallout(cardVals.sel, cardVals.rect, cardVals.tip);
    currentSpot = { sel: cardVals.sel, rect: cardVals.rect, tip: cardVals.tip, special: true };
    return reposition(true);
  }

  // Action card needs a target, point at the choices so the screen doesn't just go dark
  // The tip matches its voice line word for word
  if (s.pendingChoice) return step(".targets", "An action card! Hit a player to target them with it.", "tutTarget");
  // No dimming during the AI turns
  if (!s.yourTurn) return showMask(false);

  // Draw a few, then stop, then bank on the next turn
  const cards = me.cardCount;
  if (!s.youHitThisTurn && cards === 0) return step(".btn--hit", "Let's build a hand. Hit to draw your first card!", "tutDraw1");
  if (s.youHitThisTurn && cards < DRAW_TARGET) return step(".btn--hit", "Nice! Hit again to grow your stack.", "tutDraw2");
  if (s.youHitThisTurn && cards >= DRAW_TARGET) return step(".btn--stop", "Careful now, draw a duplicate and you bust. Hit STOP to keep what you've got.", "tutStop");
  if (!s.youHitThisTurn && cards > 0 && s.canBank) return step(".btn--bank", "Now bank it! That locks your points into your total.", "tutBank");
  showMask(false);
}

// Lights up the target and plays its voice line once when the step starts
// Only if the announcer is on, the tracking loop then keeps the light on the target
function step(sel, tip, voiceKey) {
  // Player skipped this step so no highlight, the next one still guides them
  if (voiceKey && voiceKey === skippedKey) return showMask(false);
  const t = document.querySelector(sel);
  if (!t) return showMask(false);
  const r = t.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return showMask(false);
  if (voiceKey && voiceKey !== lastVoiceKey) {
    lastVoiceKey = voiceKey;
    playVoice(voiceKey);
  }
  currentStepKey = voiceKey || "";
  currentSpot = { sel, tip, special: false };
  reposition(true);
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
  const found = document.querySelector(sel);
  const t = found || document.querySelector(".you-seat");
  if (!t) return null;
  const r = t.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  // Only keep the selector if it matched, so the tip can follow that exact card
  return { sel: found ? sel : null, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, tip };
}

// First plain number card the player draws, explains what the number means
// The lucky 1 is left out, it has its own tip
function detectCardValues(view, me) {
  if (cardValuesShown) return null;
  const le = view.snapshot.lastEvent;
  if (!le || le.seat !== view.snapshot.you || !le.card) return null;
  if (le.kind !== "number" || le.card.value === 1) return null;
  const found = document.querySelector(".you-seat .card--new");
  const t = found || document.querySelector(".you-seat");
  if (!t) return null;
  const r = t.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  cardValuesShown = true;
  return { sel: found ? ".you-seat .card--new" : null, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, tip: CARD_VALUES_TIP };
}

function startCallout(sel, rect, tip) {
  calloutSel = sel;
  calloutRect = rect;
  calloutTip = tip;
  calloutUntil = Date.now() + CALLOUT_MS;
  if (calloutTimer) clearTimeout(calloutTimer);
  // Redraw once the tip is over so the button spotlight comes back without a game event
  calloutTimer = setTimeout(() => {
    calloutTimer = null;
    calloutUntil = 0;
    calloutRect = null;
    calloutSel = null;
    rerender();
  }, CALLOUT_MS + 30);
}

// Message shows one last note before the overlay clears, voiceKey reads it out
function finish(message, isBust, voiceKey) {
  if (finishing) return;
  finishing = true;
  markDone();
  if (voiceKey) playVoice(voiceKey);
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
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  currentSpot = null;
  placedKey = "";
  currentStepKey = "";
  skippedKey = "";
  if (calloutTimer) clearTimeout(calloutTimer);
  calloutTimer = null;
  calloutUntil = 0;
  calloutRect = null;
  calloutSel = null;
  cardValuesShown = false;
  if (root) root.remove();
  root = null;
}

// Skips this step only, not the whole tutorial
// A card tip just closes, a guided step stays hidden and the next step still guides
export function ftueSkip() {
  if (Date.now() < calloutUntil) {
    if (calloutTimer) clearTimeout(calloutTimer);
    calloutTimer = null;
    calloutUntil = 0;
    calloutRect = null;
    calloutSel = null;
  } else if (currentStepKey) {
    skippedKey = currentStepKey; // This step's hint won't come back
  }
  showMask(false);
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
