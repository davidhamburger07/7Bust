// First game tutorial, shown on the table during the first hand
// CrazyGames only allows one click before gameplay, so it can't be its own screen

const STEPS = [
  {
    sel: '[data-action="hit"]',
    title: "Flip a card",
    body: "Tap HIT to turn a card. Every card you flip adds its number to this round's score.",
  },
  {
    sel: ".you-score",
    title: "Watch your score climb",
    body: "This is what you've built this round. The bigger it gets, the more there is to lose.",
  },
  {
    sel: ".you-seat .progress",
    title: "Never repeat a number",
    body: "Flip a number you already hold and you BUST, the whole round scores ZERO. That's the risk you're pushing.",
  },
  {
    sel: ".dock",
    title: "Bank before it's gone",
    body: "Stop while you're ahead: BANK locks this round's points into your total, safe from a bust.",
  },
  {
    sel: ".you-seat .pips",
    title: "Chase the CLEAN 7",
    body: "Collect seven DIFFERENT numbers for a CLEAN 7, a big bonus that ends the round instantly in your favour.",
  },
  {
    sel: ".round-pill",
    title: "Nine rounds, one winner",
    body: "You'll play nine rounds and your scores add up. The highest total at the end takes the pot. Good luck!",
  },
];

let el = null;
let step = 0;
let onDone = null;

const target = () => document.querySelector(STEPS[step].sel);

function build() {
  el = document.createElement("div");
  el.id = "coach";
  el.className = "coach";
  document.body.appendChild(el);
  el.addEventListener("click", (e) => {
    const a = e.target.closest("[data-coach]");
    if (!a) return;
    e.preventDefault();
    if (a.dataset.coach === "skip") return finish();
    next();
  });
}

function paint() {
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  el.innerHTML = `
    <div class="coach-card">
      <div class="coach-step">${step + 1} of ${STEPS.length}</div>
      <h4 class="coach-title">${s.title}</h4>
      <p class="coach-body">${s.body}</p>
      <div class="coach-actions">
        <button class="coach-skip" data-coach="skip" type="button">${last ? "" : "Skip"}</button>
        <button class="coach-next" data-coach="next" type="button">${last ? "Got it" : "Next"}</button>
      </div>
    </div>`;
  place();
}

// Puts the card next to its target on whichever side has room
// Called after every render because the target moves as the hand fills up
export function place() {
  if (!el) return;
  const t = target();
  if (!t) {
    el.style.visibility = "hidden";
    return;
  }
  const r = t.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) {
    el.style.visibility = "hidden";
    return;
  }
  el.style.visibility = "visible";
  const card = el.querySelector(".coach-card");
  const cw = card.offsetWidth || 280;
  const ch = card.offsetHeight || 120;
  const gap = 14;
  let top = r.top - ch - gap;
  if (top < 8) top = Math.min(r.bottom + gap, window.innerHeight - ch - 8);
  let left = r.left + r.width / 2 - cw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - cw - 8));
  card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  const ring = el.querySelector(".coach-ring") || Object.assign(document.createElement("div"), { className: "coach-ring" });
  if (!ring.parentElement) el.appendChild(ring);
  ring.style.transform = `translate(${Math.round(r.left - 6)}px, ${Math.round(r.top - 6)}px)`;
  ring.style.width = `${Math.round(r.width + 12)}px`;
  ring.style.height = `${Math.round(r.height + 12)}px`;
}

function next() {
  step++;
  if (step >= STEPS.length) return finish();
  paint();
}

function finish() {
  if (el) el.remove();
  el = null;
  const cb = onDone;
  onDone = null;
  if (cb) cb();
}

export const coachRunning = () => !!el;

// done runs when it's finished or skipped, so the caller can save that it was seen
export function startCoach(done) {
  if (el) return;
  step = 0;
  onDone = done;
  build();
  paint();
}
