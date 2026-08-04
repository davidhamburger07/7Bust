// The ladder room select, built as a climb with the cheapest room at the bottom
// The rail fills to peak net worth because that's what unlocks rooms

import { ARENAS, ARENA_ROUNDS, seatsAt, potAt, themeStyle } from "../engine/arenas.js";

const money = (n) => Math.round(n).toLocaleString("en-US");

// Log scale since the unlock amounts are far apart, the first floor sits at the bottom
const TOP_GATE = ARENAS[ARENAS.length - 1].unlockAt;
const railPct = (v) => {
  const lo = Math.log10(100); // Street level, the bottom of the rail
  const hi = Math.log10(TOP_GATE);
  const x = Math.log10(Math.max(100, v));
  return Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
};

function rail(view) {
  const p = view.pve;
  const fill = railPct(p.peak);
  const notches = ARENAS.filter((a) => a.unlockAt > 0)
    .map((a) => {
      const at = railPct(a.unlockAt);
      const open = p.peak >= a.unlockAt;
      return `<div class="al-notch${open ? " open" : ""}" style="bottom:${at}%" title="${a.name} opens at ${money(a.unlockAt)}">
        <span class="al-notch-v num">${a.unlockAt >= 1e6 ? `${a.unlockAt / 1e6}M` : `${a.unlockAt / 1000}k`}</span>
      </div>`;
    })
    .join("");
  return `
  <div class="al-rail" role="img" aria-label="Your peak net worth is ${money(p.peak)} chips">
    <div class="al-rail-track">
      <div class="al-rail-fill" style="height:${fill}%"></div>
      <div class="al-rail-head" style="bottom:${fill}%"><span class="num">${money(p.peak)}</span></div>
      ${notches}
    </div>
    <span class="al-rail-label">PEAK<br />NET WORTH</span>
  </div>`;
}

function floor(arena, view) {
  const p = view.pve;
  const open = p.peak >= arena.unlockAt;
  const affordable = p.chips >= arena.buyIn;
  const played = (p.career.byArena || {})[arena.id];
  const cut = arena.rake === 0 ? "no cut" : `${Math.round(arena.rake * 100)}% cut`;

  // A locked room shrinks to a nameplate since the player can't use it yet
  // That also keeps the room they can play on screen
  if (!open) {
    return `
    <section class="al-floor al-floor--shut" style="${themeStyle(arena)}">
      <div class="al-swatch"><span class="al-tier num">${arena.tier}</span></div>
      <div class="al-body">
        <header class="al-head">
          <h3 class="al-name">${arena.name}</h3>
          <span class="al-where">${arena.where}</span>
        </header>
        <span class="al-shutline">${money(arena.buyIn)} buy-in · ${seatsAt(arena)} seats · ${ARENA_ROUNDS} rounds · pot ${money(potAt(arena))}</span>
      </div>
      <div class="al-action">
        <div class="al-lock">
          <span class="al-lock-need">${money(arena.unlockAt - p.peak)} <em>to go</em></span>
          <span class="al-lock-hint">${arena.lockHint}</span>
        </div>
      </div>
    </section>`;
  }

  // What the right side of the row shows depends on where the player stands
  let action;
  if (!affordable) {
    action = `
      <div class="al-lock al-lock--broke">
        <span class="al-lock-need">${money(arena.buyIn - p.chips)} <em>short</em></span>
        <span class="al-lock-hint">Win it back downstairs.</span>
      </div>`;
  } else {
    action = `<button class="btn btn--play al-sit" data-action="arena-sit" data-id="${arena.id}">SIT DOWN<span class="sub">${money(arena.buyIn)} · ${ARENA_ROUNDS} rounds</span></button>`;
  }

  const record = played
    ? `<span class="al-record">${played.hands} hand${played.hands === 1 ? "" : "s"} · won ${played.wins}</span>`
    : `<span class="al-record al-record--new">never played</span>`;

  return `
  <section class="al-floor al-floor--open${affordable ? "" : " is-broke"}" style="${themeStyle(arena)}">
    <div class="al-swatch"><span class="al-tier num">${arena.tier}</span></div>
    <div class="al-body">
      <header class="al-head">
        <h3 class="al-name">${arena.name}</h3>
        <span class="al-where">${arena.where}</span>
      </header>
      <p class="al-blurb">${arena.blurb}</p>
      <ul class="al-facts">
        <li><b class="num">${money(arena.buyIn)}</b><span>buy-in</span></li>
        <li><b class="num">${seatsAt(arena)}</b><span>seats</span></li>
        <li><b class="num">${money(potAt(arena))}</b><span>pot</span></li>
        <li><b class="num">${ARENA_ROUNDS}</b><span>rounds</span></li>
        <li><b>${cut}</b><span>house</span></li>
      </ul>
      ${record}
    </div>
    <div class="al-action">${action}</div>
  </section>`;
}

export function renderArenaSelect(view) {
  const p = view.pve;
  const next = p.next;
  // Top down so "The Monaco Yacht" is at the top and "The Back Alley" at the bottom, like the rail
  const floors = [...ARENAS].reverse().map((a) => floor(a, view)).join("");

  const goal = next
    ? `<span class="al-goal">Next: <b>${next.arena.name}</b> at <b class="num">${money(next.need)}</b>: <b class="num">${money(next.short)}</b> to go</span>`
    : `<span class="al-goal al-goal--done">Every room on the ladder is open.</span>`;

  return `
  <div class="screen screen--ladder">
    <div class="al-top al-top--ladder">
      <button class="icon-btn" data-action="arena-exit" aria-label="Back to the lobby">←</button>
      <div class="al-title">
        <h2>THE LADDER</h2>
        <span class="al-sub">Single-player · practice chips</span>
      </div>
      <span id="radio-slot" class="radio-slot"></span>
      <div class="al-purse">
        <span class="al-purse-chips">${pveChipStack(p.chips)}</span>
        <button class="btn btn--ghost al-board" data-action="leaderboard">STANDINGS</button>
      </div>
    </div>

    ${goal}

    <div class="al-stack">
      ${rail(view)}
      <div class="al-floors">${floors}</div>
    </div>

    ${p.broke ? brokeBar(p) : ""}
  </div>`;
}

// The re-stake offer, the only place money appears from nothing in this mode
// It says plainly it's practice chips from the house because the player can't make the buy-in
function brokeBar(p) {
  return `
  <div class="al-broke">
    <span class="al-broke-msg"><b>You are under the ${money(ARENAS[0].buyIn)} buy-in.</b> The house will re-stake you.</span>
    <button class="btn btn--daily" data-action="arena-restake">TAKE A RE-STAKE<span class="sub">+500 practice chips</span></button>
  </div>`;
}

// Single player chips are matte clay, the online stack is the neon one
// The look alone tells the player which money a number is in
export function pveChipStack(amount) {
  return `<span class="chip-stack chip-stack--clay">
      <span class="chip chip--clay-black"></span><span class="chip chip--clay-blue"></span><span class="chip chip--clay-red"></span>
    </span><span class="chip-amount chip-amount--clay num">${money(amount)}</span>`;
}
