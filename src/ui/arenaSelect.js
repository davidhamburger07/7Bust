// The ladder room select, a deck of room cards the player swipes through
// Locked rooms stay visible and keep their colours, seeing the top rooms is the whole point

import { ARENAS, ARENA_ROUNDS, seatsAt, potAt, themeStyle } from "../engine/arenas.js";

// Single player currency is money, shown with a $ everywhere
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

// Short money for places where the full number won't fit, like the rail notches
const brief = (n) => {
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
  if (n >= 1000) return `$${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}k`;
  return `$${n}`;
};

// Log scale since the unlock amounts are far apart, a straight rail would bunch the bottom rooms
const TOP_GATE = ARENAS[ARENAS.length - 1].unlockAt;
const railPct = (v) => {
  const lo = Math.log10(100); // Street level, the bottom of the rail
  const hi = Math.log10(TOP_GATE);
  const x = Math.log10(Math.max(100, v));
  return Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
};

function climb(view) {
  const p = view.pve;
  const fill = railPct(p.peak);
  const notches = ARENAS.filter((a) => a.unlockAt > 0)
    .map((a) => {
      const open = p.peak >= a.unlockAt;
      return `<button class="lr-notch${open ? " is-open" : ""}" style="left:${railPct(a.unlockAt)}%" data-jump="${a.id}"
        aria-label="${a.name}, opens at ${money(a.unlockAt)} net worth"><span class="lr-notch-v num">${brief(a.unlockAt)}</span></button>`;
    })
    .join("");

  const goal = p.next
    ? `<span class="lr-goal">Next: <b>${p.next.arena.name}</b> · <b class="num">${brief(p.next.short)}</b> to go</span>`
    : `<span class="lr-goal lr-goal--done">Every room on the ladder is open.</span>`;

  return `
  <div class="lr-climb">
    <div class="lr-climb-head">
      <span class="lr-climb-label">Peak net worth <b class="num">${money(p.peak)}</b></span>
      ${goal}
    </div>
    <div class="lr-climb-track" role="img" aria-label="Your peak net worth is ${money(p.peak)}">
      <div class="lr-climb-fill" style="width:${fill}%"></div>
      <div class="lr-climb-you" style="left:${fill}%"></div>
      ${notches}
    </div>
  </div>`;
}

function card(arena, view, isStart) {
  const p = view.pve;
  // Peak net worth unlocks the room, chips in hand pay for the seat
  const open = p.peak >= arena.unlockAt;
  const affordable = p.chips >= arena.buyIn;
  const played = (p.career.byArena || {})[arena.id];
  const cut = arena.rake === 0 ? "no house cut" : `${Math.round(arena.rake * 100)}% house cut`;

  // The bottom of the card changes with whether the room is locked, too expensive or open
  let foot;
  if (!open) {
    const from = ARENAS[ARENAS.indexOf(arena) - 1];
    const floor = from ? from.unlockAt : 0;
    const pct = Math.max(0, Math.min(100, ((p.peak - floor) / Math.max(1, arena.unlockAt - floor)) * 100));
    foot = `
      <div class="lr-foot lr-foot--shut">
        <div class="lr-gate">
          <span class="lr-gate-k">Opens at <b class="num">${money(arena.unlockAt)}</b> net worth</span>
          <div class="lr-gate-bar"><i style="width:${pct}%"></i></div>
          <span class="lr-gate-need"><b class="num">${money(arena.unlockAt - p.peak)}</b> to go</span>
        </div>
        <span class="lr-hint">${arena.lockHint}</span>
      </div>`;
  } else if (!affordable) {
    foot = `
      <div class="lr-foot lr-foot--short">
        <span class="lr-short"><b class="num">${money(arena.buyIn - p.chips)}</b> short of the buy-in</span>
        <span class="lr-hint">Win it back downstairs.</span>
      </div>`;
  } else {
    foot = `
      <div class="lr-foot">
        <button class="btn btn--play lr-play" data-action="arena-sit" data-id="${arena.id}">PLAY<span class="sub">${money(arena.buyIn)} to sit</span></button>
      </div>`;
  }

  const state = open ? (affordable ? "is-open" : "is-open is-short") : "is-shut";
  return `
  <article class="lr-card ${state}" data-room="${arena.id}" data-id="${arena.id}"${isStart ? ' data-start="1"' : ""} style="${themeStyle(arena)}">
    <div class="lr-tex" aria-hidden="true"></div>
    <div class="lr-face">
      <header class="lr-head">
        <span class="lr-where">${arena.where}</span>
        <h3 class="lr-name">${arena.name}</h3>
        <span class="lr-tier num">${arena.tier}</span>
      </header>

      <p class="lr-blurb">${arena.blurb}</p>

      <div class="lr-cast">
        <span class="lr-cast-k">At this table</span>
        <span class="lr-cast-v">${arena.regulars.join(" · ")}</span>
      </div>

      <div class="lr-plate">
        <div class="lr-stat">
          <span class="lr-stat-k">Entry</span>
          <b class="lr-stat-v num">${money(arena.buyIn)}</b>
        </div>
        <div class="lr-stat lr-stat--prize">
          <span class="lr-stat-k">Prize pool</span>
          <b class="lr-stat-v num">${money(potAt(arena))}</b>
        </div>
      </div>
      <p class="lr-fine">${seatsAt(arena)} seats · ${ARENA_ROUNDS} rounds · ${cut}${played ? ` · ${played.hands} played, won ${played.wins}` : ""}</p>

      ${foot}
    </div>
  </article>`;
}

export function renderArenaSelect(view) {
  const p = view.pve;
  // Rooms go low to high left to right, the same way the rail fills
  // Opens on the best room the player can sit in, not the highest unlocked, broke means the first
  const sittable = ARENAS.filter((a) => p.peak >= a.unlockAt && p.chips >= a.buyIn);
  const start = (sittable[sittable.length - 1] || ARENAS[0]).id;
  const cards = ARENAS.map((a) => card(a, view, a.id === start)).join("");

  return `
  <div class="screen screen--ladder screen--rooms">
    <div class="al-top al-top--ladder">
      <button class="icon-btn" data-action="ladder-close" aria-label="Back to the lobby">←</button>
      <div class="al-title">
        <h2>THE LADDER</h2>
        <span class="al-sub">Underground street games · played for Money</span>
      </div>
      <span id="radio-slot" class="radio-slot"></span>
      <div class="al-purse">
        <span class="al-purse-chips">${pveChipStack(p.chips)}</span>
        <button class="btn btn--ghost al-board" data-action="leaderboard">STANDINGS</button>
      </div>
    </div>

    <div class="lr-deck">
      <button class="lr-arrow lr-arrow--prev" data-nav="-1" aria-label="Previous room">‹</button>
      <div class="lr-rail" id="lr-rail" role="group" aria-label="Rooms on the ladder">${cards}</div>
      <button class="lr-arrow lr-arrow--next" data-nav="1" aria-label="Next room">›</button>
    </div>

    ${climb(view)}

    ${p.broke ? brokeBar(p) : ""}
  </div>`;
}

// The re-stake offer, the only place money appears from nothing in this mode
// It says plainly it's practice chips from the house because the player can't make the buy-in
function brokeBar(p) {
  return `
  <div class="al-broke">
    <span class="al-broke-msg"><b>You are under the ${money(ARENAS[0].buyIn)} buy-in.</b> The house will re-stake you.</span>
    <button class="btn btn--restake" data-action="arena-restake">TAKE A RE-STAKE<span class="sub">+$500 street money</span></button>
  </div>`;
}

// Scroll handling for the deck, CSS snap already covers touch, trackpad and keyboard
// This adds what CSS can't: which card is centred, mouse drag and the arrows

let wired = null; // The rail already wired, so a redraw doesn't add its listeners twice

const cardsOf = (rail) => Array.from(rail.querySelectorAll(".lr-card"));

function centreOf(rail, el) {
  return el.offsetLeft + el.offsetWidth / 2 - rail.clientWidth / 2;
}

function nearest(rail) {
  const mid = rail.scrollLeft + rail.clientWidth / 2;
  let best = null;
  let bestGap = Infinity;
  for (const el of cardsOf(rail)) {
    const gap = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
    if (gap < bestGap) {
      bestGap = gap;
      best = el;
    }
  }
  return best;
}

function dealTo(rail, el, smooth = true) {
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  rail.scrollTo({ left: centreOf(rail, el), behavior: smooth && !reduce ? "smooth" : "auto" });
}

// The centred card lifts and its notch on the rail lights up, so both point at the same room
function markFocus(rail) {
  const el = nearest(rail);
  if (!el) return;
  for (const c of cardsOf(rail)) c.classList.toggle("is-focus", c === el);
  const id = el.dataset.id;
  const screen = rail.closest(".screen--rooms");
  if (!screen) return;
  for (const n of screen.querySelectorAll(".lr-notch")) n.classList.toggle("is-here", n.dataset.jump === id);
}

export function mountLadderDeck() {
  const rail = document.getElementById("lr-rail");
  if (!rail) {
    wired = null;
    return;
  }
  if (wired === rail) {
    markFocus(rail); // Same deck with new numbers, after a re-stake or a room unlocking
    return;
  }
  wired = rail;

  let raf = 0;
  rail.addEventListener(
    "scroll",
    () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        markFocus(rail);
      });
    },
    { passive: true }
  );

  const step = (dir) => {
    const list = cardsOf(rail);
    const here = list.indexOf(nearest(rail));
    dealTo(rail, list[Math.max(0, Math.min(list.length - 1, here + dir))]);
  };

  const screen = rail.closest(".screen--rooms") || rail;
  screen.addEventListener("click", (e) => {
    const arrow = e.target.closest("[data-nav]");
    if (arrow) return step(Number(arrow.dataset.nav));
    const jump = e.target.closest("[data-jump]");
    if (jump) dealTo(rail, rail.querySelector(`.lr-card[data-id="${jump.dataset.jump}"]`));
  });

  // Arrow keys move through the deck, and tabbing to a card's button centres it
  screen.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    step(e.key === "ArrowRight" ? 1 : -1);
  });
  rail.addEventListener("focusin", (e) => {
    const c = e.target.closest(".lr-card");
    if (c && !c.classList.contains("is-focus")) dealTo(rail, c);
  });

  // The wheel moves one room per scroll instead of by pixels
  // Snap points and free wheel scrolling fight each other and it looks like stutter
  let wheelLock = 0;
  rail.addEventListener(
    "wheel",
    (e) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      const now = Date.now();
      if (now < wheelLock) return;
      wheelLock = now + 320;
      step(d > 0 ? 1 : -1);
    },
    { passive: false }
  );

  // Mouse drag only, touch is left to the browser's own scroll
  // Taking over touch scrolling is what makes carousels feel wrong on a phone
  let drag = null;
  rail.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag = { x: e.clientX, left: rail.scrollLeft, moved: false };
  });
  rail.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return; // Lets a click wobble a little without starting a drag
    if (!drag.moved) {
      drag.moved = true;
      rail.style.scrollSnapType = "none"; // Snap points pull against a drag
      rail.classList.add("is-dragging");
      rail.setPointerCapture(e.pointerId);
    }
    rail.scrollLeft = drag.left - dx;
  });
  // Letting go of a drag over a play button means stop scrolling, not sit down
  // So the click right after a real drag is thrown away before the game gets it
  let swallowClick = false;
  const endDrag = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (!moved) return;
    swallowClick = true;
    rail.classList.remove("is-dragging");
    rail.style.scrollSnapType = "";
    dealTo(rail, nearest(rail));
  };
  rail.addEventListener("pointerup", endDrag);
  rail.addEventListener("pointercancel", endDrag);
  rail.addEventListener(
    "click",
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true
  );

  // Opens on the best room the player can actually sit in
  const start = rail.querySelector(".lr-card[data-start]") || rail.firstElementChild;
  dealTo(rail, start, false);
  markFocus(rail);
}

// Single player money is a green cash badge with a $, online is the neon casino chip
// The colour and the $ alone tell the player which money a number is in
export function pveChipStack(amount) {
  return `<span class="cash-badge" aria-hidden="true">$</span><span class="chip-amount chip-amount--cash num">${Math.round(amount).toLocaleString("en-US")}</span>`;
}
