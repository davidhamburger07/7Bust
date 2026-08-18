// Tutorial for the first solo hand, it dims the table and lights up the next button to press
// Lives on the page body so it survives redraws, clicks only reach the lit button

import * as storage from "../net/storage.js";
import { playVoice } from "./announce.js";

const DONE_KEY = "7bust:ftue:done:v1";
const PAD = 10; // Space around the lit target in pixels

// The tutorial deck deals this exact hand, each step explains one card as it lands
// The player closes each card tip to move on, then the tutorial points at stop and bank
const SCRIPT = [
  {
    hit: { tip: "Let's build a hand. Hit to draw your first card!", voice: "tutDraw1" },
    is: (le, you) => le.seat === you && le.kind === "number",
    sel: () => ".you-seat .card--new",
    callout: { tip: "A card's number is its points, and how many of it are in the deck. Big numbers score more, but bust you sooner!", voice: "tutCardValues" },
  },
  {
    hit: { tip: "Nice! Hit again to grow your hand.", voice: "tutDraw2" },
    is: (le, you) => le.seat === you && le.kind === "number",
    sel: () => ".you-seat .card--new",
    callout: { tip: "Two different numbers, no repeats, that's 8 points so far. Every new number just adds to your hand.", voice: "tutBuild" },
  },
  {
    hit: { tip: "Keep going, hit again." },
    is: (le, you) => le.seat === you && le.kind === "action" && le.card && le.card.action === "second_chance",
    sel: () => ".you-seat .sc-dot",
    callout: { tip: "A Second Chance! It tucks into your hand and quietly eats your next duplicate, one free save from busting.", voice: "tutSecond" },
  },
  {
    hit: { tip: "Press your luck, hit once more." },
    is: (le, you) => le.seat === you && le.kind === "saved",
    sel: () => ".you-seat",
    callout: { tip: "You drew a matching 3, normally a bust! But your Second Chance ate it. That's exactly when it saves you.", voice: "tutSaved" },
  },
  {
    hit: { tip: "This one's an action card, hit to draw it." },
    target: { tip: "Freeze! Tap the highlighted rival to make them bank now and drop out of the round, best used on whoever's ahead.", voice: "tutFreeze" },
    is: (le) => le.kind === "frozen",
    sel: (le) => `.seat[data-seat="${le.seat}"]`,
    callout: { tip: "Frozen! They're forced to bank early and sit out the rest of the round.", voice: "tutFrozen" },
  },
  {
    hit: { tip: "Last one, draw your final action card." },
    target: { tip: "Flip Three! Tap the highlighted rival to force them to flip three cards in a row, a great way to push a threat toward a bust.", voice: "tutFlip3" },
    is: (le) => le.kind === "flip3",
    sel: (le) => `.seat[data-seat="${le.seat}"]`,
    callout: { tip: "They have to flip three cards back to back, three chances to hit a duplicate and bust.", voice: "tutFlip3done" },
  },
];
const STOP_TIP = "That's a strong hand. Hit STOP to end your turn and keep it safe for banking.";
const BANK_TIP = "Now BANK to lock those points into your score, you've got this!";
const BUST_MSG = "Busted! A repeat wipes the round, that's the risk. Give it another go!";
const BANK_MSG = "Banked! Those points are safe now. That's the game, enjoy 7Bust!";

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
let lastEventSig = ""; // So each step's tip fires once, on a new event
let beat = 0; // Which step of the script we're on, moves on when the player closes a tip

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

// Rerender lets a closed card tip redraw the mask and bring the next step back
export function ftueStart(opts = {}) {
  if (active || hasCompletedTutorial()) return;
  active = true;
  finishing = false;
  lastEventSig = "";
  lastVoiceKey = "";
  currentStepKey = "";
  skippedKey = "";
  beat = 0;
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
  // A card tip is closed by the player, a guided step can be skipped
  const skip = q(".ftue-skip");
  if (skip) {
    skip.textContent = special ? "✕" : "Skip";
    skip.classList.toggle("ftue-skip--close", !!special);
    skip.setAttribute("aria-label", special ? "Close this hint" : "Skip this step");
  }
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

// Runs after every render and walks the player through the scripted hand
// Draw, explain the card, aim "Freeze" or "Flip Three", then stop and bank
export function ftueSync(view) {
  if (!active || !root) return;
  const s = view.snapshot;
  if (!s) return showMask(false);
  const me = s.players[s.you];
  if (!me) return showMask(false);

  // Freezing yourself also banks the hand, so it counts as banked
  if (me.turnState === "busted") return finish(BUST_MSG, true, "tutBusted");
  if (me.turnState === "banked" || me.turnState === "clean7" || me.turnState === "frozen") return finish(BANK_MSG, false, "tutBanked");
  if (s.phase === "match_end") return finish("", false);

  // A card tip keeps the spotlight until the player closes it, closing moves the tutorial on
  if (Date.now() < calloutUntil && calloutRect) {
    currentSpot = { sel: calloutSel, rect: calloutRect, tip: calloutTip, special: true };
    return reposition(true);
  }

  // After the scripted draws, point at stop, then at bank on the next turn
  if (beat >= SCRIPT.length) {
    if (!s.yourTurn) return showMask(false); // Forced flips or AI turns, dim and wait
    if (s.youHitThisTurn && me.cardCount > 0) return step(".btn--stop", STOP_TIP, "tutStop");
    if (s.canBank) return step(".btn--bank", BANK_TIP, "tutBank");
    return showMask(false);
  }

  const b = SCRIPT[beat];

  // Fires this step's card tip once, only on a new event
  const le = s.lastEvent;
  if (le && b.is(le, s.you)) {
    const sig = `${le.kind}:${le.seat}:${le.card ? (le.card.value ?? le.card.action ?? "") : ""}`;
    if (sig !== lastEventSig) {
      lastEventSig = sig;
      const sel = b.sel(le);
      const rect = rectFromSel(sel);
      if (rect) {
        if (b.callout.voice) playVoice(b.callout.voice);
        const hit = document.querySelector(sel) ? sel : null; // Only follow the element if it's really there
        startCallout(hit, rect, b.callout.tip);
        currentSpot = { sel: hit, rect, tip: b.callout.tip, special: true };
        return reposition(true);
      }
    }
  }

  // For "Freeze" or "Flip Three" light up one rival, so the mask blocks every other choice
  // including targeting yourself
  if (s.pendingChoice && b.target) {
    const rival = rivalTargetSel(s);
    return step(rival || ".targets", b.target.tip, b.target.voice);
  }

  // Otherwise point at the draw button, on other turns just wait
  if (!s.yourTurn) return showMask(false);
  return step(".btn--hit", b.hit.tip, b.hit.voice);
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

// Copied because the element gets redrawn away, falls back to the player's seat
// so a tip always has something to point at
function rectFromSel(sel) {
  const t = (sel && document.querySelector(sel)) || document.querySelector(".you-seat");
  if (!t) return null;
  const r = t.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

// First rival that can be picked, never the player, so "Freeze" and "Flip Three" hit someone else
function rivalTargetSel(s) {
  const pc = s.pendingChoice;
  if (!pc || !pc.eligible) return null;
  const rival = pc.eligible.find((e) => e.seat !== s.you);
  return rival ? `.btn--target[data-seat="${rival.seat}"]` : null;
}

function startCallout(sel, rect, tip) {
  calloutSel = sel;
  calloutRect = rect;
  calloutTip = tip;
  // Stays until the player closes it, a timer used to pull tips away mid read
  // The player's turn never moves on by itself, so there's no rush
  calloutUntil = Infinity;
  if (calloutTimer) clearTimeout(calloutTimer);
  calloutTimer = null;
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
  beat = 0;
  if (root) root.remove();
  root = null;
}

// Closing a card tip moves the tutorial on, the tips are how the player sets the pace
// On a plain step there's no tip, so skip just hides that one hint
export function ftueSkip() {
  if (Date.now() < calloutUntil) {
    if (calloutTimer) clearTimeout(calloutTimer);
    calloutTimer = null;
    calloutUntil = 0;
    calloutRect = null;
    calloutSel = null;
    beat += 1;
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
