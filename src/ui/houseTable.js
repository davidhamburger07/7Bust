// The house table, one player against the dealer for one bet
// The deck strip shows how many of each number are left, ones you hold light up as bust cards

import { heatTriple } from "./heat.js";
import { HOUSE_MAX_VALUE, DEALER_STAND } from "../engine/houseGame.js";

export const CHIP_TIERS = [10, 25, 50, 100];

const chipClass = (v) => (v >= 100 ? "black" : v >= 50 ? "blue" : v >= 25 ? "green" : "red");

function card(value, heat, { isNew = false, dup = false } = {}) {
  const cls = `card${dup ? " card--dup" : ""}${isNew ? " card--new" : ""}`;
  return `<div class="${cls}" style="--glow:${heat}"><span class="corner">${value}</span><span class="face">${value}</span></div>`;
}

const faceDown = () => `<div class="card card--pending"><span class="card-back"></span></div>`;

function liveDeck(h) {
  const g = h.game;
  // No shoe before the deal, so show the full deck, each number has that many copies
  const counts = g ? g.remainingByValue() : Array.from({ length: HOUSE_MAX_VALUE + 1 }, (_, i) => i);
  const held = new Set(h.state.player.values);
  const cols = [];
  for (let v = 1; v <= HOUSE_MAX_VALUE; v++) {
    const left = counts[v] || 0;
    const live = held.has(v) && left > 0;
    const pips = Array.from({ length: left }, () => `<i></i>`).join("");
    cols.push(`
      <div class="hs-col${live ? " live" : ""}${held.has(v) ? " held" : ""}" title="${left} of the ${v}s left">
        <div class="hs-pips">${pips}</div>
        <div class="hs-val num">${v}</div>
      </div>`);
  }
  const killers = h.state.player.values.reduce((n, v) => n + (counts[v] || 0), 0);
  const left = h.state.deckRemaining;
  const risk = Math.round((h.risk || 0) * 100);
  return `
  <div class="hs-strip">
    <div class="hs-head">
      <span class="hs-title">LIVE DECK</span>
      <span class="hs-read">${
        h.state.player.values.length
          ? `<b class="num hs-risk${risk >= 33 ? " hot" : ""}">${risk}%</b> bust · <b class="num">${killers}</b> of <b class="num">${left}</b> cards kill you`
          : `<span class="muted">${left} cards · nothing can bust you yet</span>`
      }</span>
    </div>
    <div class="hs-cols">${cols.join("")}</div>
  </div>`;
}

function dealerRow(h) {
  const d = h.state.dealer;
  const shown = d.values.slice(0, h.reveal);
  const heat = heatTriple(shown.length);
  const bustShowing = d.busted && h.reveal > d.values.length;
  const cards = shown.map((v, i) => card(v, heat, { isNew: i === h.reveal - 1 })).join("");
  const bust = bustShowing ? card(d.bustValue, heat, { dup: true, isNew: true }) : "";
  const score = shown.reduce((s, v) => s + v, 0);
  const verdict = bustShowing ? `<span class="hs-bust">BUST</span>` : `<b class="num">${score}</b>`;
  // The house holds no cards until you freeze, there's no hole card
  // So show an empty slot, not a face down card, until it's the dealer's turn
  const body =
    cards || bust
      ? cards + bust
      : h.phase === "dealer"
        ? faceDown()
        : `<div class="hs-slot"><span>draws when you freeze</span></div>`;
  return `
  <section class="hs-side hs-side--house${d.busted && bustShowing ? " is-bust" : ""}">
    <header class="hs-label">
      <span class="hs-who">THE HOUSE</span>
      <span class="hs-rule">draws to ${DEALER_STAND}</span>
      <span class="hs-score">${cards || bust ? verdict : ""}</span>
    </header>
    <div class="hs-hand">${body}</div>
  </section>`;
}

function playerRow(h) {
  const p = h.state.player;
  const heat = heatTriple(p.values.length);
  const last = p.values.length - 1;
  const cards = p.values.map((v, i) => card(v, heat, { isNew: i === last && h.dealt })).join("");
  const bust = p.busted ? card(p.bustValue, heat, { dup: true, isNew: true }) : "";
  const verdict = p.busted ? `<span class="hs-bust">BUST</span>` : `<b class="num">${p.score}</b>`;
  return `
  <section class="hs-side hs-side--you${p.busted ? " is-bust" : ""}">
    <div class="hs-hand">${cards + bust || `<span class="hand-empty">place your bet</span>`}</div>
    <header class="hs-label">
      <span class="hs-who">YOU</span>
      <span class="hs-rule">freeze any time</span>
      <span class="hs-score">${cards || bust ? verdict : ""}</span>
    </header>
  </section>`;
}

function betDock(h) {
  const chips = CHIP_TIERS.map((v) => {
    const off = v > h.stack;
    return `<button class="hs-chip hs-chip--${chipClass(v)}${h.wager === v ? " on" : ""}${off ? " off" : ""}"
      ${off ? "disabled" : `data-action="house-bet" data-v="${v}"`}>${v}</button>`;
  }).join("");
  const canDeal = h.stack >= h.wager && h.wager > 0;
  return `
  <div class="hs-dock hs-dock--bet">
    <div class="hs-chips">
      <span class="hs-betlabel">BET</span>${chips}
      <button class="hs-chip hs-chip--max${h.wager === h.stack && h.stack > 0 ? " on" : ""}" ${h.stack > 0 ? 'data-action="house-bet" data-v="max"' : "disabled"}>ALL</button>
    </div>
    <button class="btn btn--play hs-deal" ${canDeal ? 'data-action="house-deal"' : "disabled"}>
      DEAL<span class="sub">${canDeal ? `${h.wager} chips` : "not enough chips"}</span>
    </button>
  </div>`;
}

function playDock(h) {
  const p = h.state.player;
  const risk = Math.round((h.risk || 0) * 100);
  const dealing = h.dealing;
  const canFreeze = p.values.length > 0 && !dealing;
  return `
  <div class="hs-dock${dealing ? " is-dealing" : ""}">
    <button class="btn btn--bank${canFreeze ? "" : " ghosted"}" ${canFreeze ? 'data-action="house-freeze"' : "disabled"}>
      FREEZE<span class="sub">${p.values.length ? `keep ${p.score}` : "draw first"}</span>
    </button>
    <button class="btn btn--hit${risk >= 33 && !dealing ? " pulse" : ""}" ${dealing ? "disabled" : 'data-action="house-hit"'}>
      HIT<span class="sub">${dealing ? "dealing…" : `risk ${risk}%`}</span>
    </button>
  </div>`;
}

function waitDock() {
  return `<div class="dock-wait"><span class="spinner"></span>The house draws…</div>`;
}

function settleDock(h) {
  const r = h.result;
  return `
  <div class="hs-dock hs-dock--settle">
    <div class="hs-verdict hs-verdict--${r.tone}">
      <span class="hs-vtitle">${r.title}</span>
      <span class="hs-vsub">${r.sub}</span>
    </div>
    <button class="btn btn--play hs-deal" data-action="house-again">
      NEXT HAND<span class="sub">bet ${Math.min(h.wager, h.stack)}</span>
    </button>
  </div>`;
}

function brokeDock(h) {
  return `
  <div class="hs-dock hs-dock--broke">
    <div class="hs-verdict hs-verdict--lose">
      <span class="hs-vtitle">STACK'S GONE</span>
      <span class="hs-vsub">${h.roundsPlayed} hands played this visit</span>
    </div>
    <button class="btn btn--play hs-deal" data-action="house-topup">
      TOP UP<span class="sub">practice chips, on the house</span>
    </button>
  </div>`;
}

function dock(h) {
  if (h.phase === "bet") return h.stack <= 0 ? brokeDock(h) : betDock(h);
  if (h.phase === "player") return playDock(h);
  if (h.phase === "dealer") return waitDock();
  return h.stack <= 0 ? brokeDock(h) : settleDock(h);
}

// The party game's rules screen is for a different game, so this mode has its own
export function renderHouseRules() {
  const row = (k, t, d) => `
    <li class="hsr-row">
      <span class="hsr-k">${k}</span>
      <span class="hsr-t"><b>${t}</b><span>${d}</span></span>
    </li>`;
  return `
  <div class="screen screen--rules">
    <div class="rules-wrap">
      <h2 class="rules-title">HOUSE TABLE</h2>
      <p class="rules-sub">One hand, one wager, straight against the dealer.</p>
      <ul class="hsr-list">
        ${row("1", "The deck is stacked by value", "There is one 1 and twelve 12s. The cards worth the most are the ones most likely to come back and bust you.")}
        ${row("2", "A repeat busts you", "Draw a number you already hold and the hand is dead, you lose the bet on the spot and the dealer never picks up a card.")}
        ${row("3", `The dealer draws to ${DEALER_STAND}`, `Freeze and the house takes over. It must keep drawing until it reaches ${DEALER_STAND}, so it can bust too, that is where your wins come from.`)}
        ${row("4", "Ties go to the house", "You need to BEAT the dealer's score, not match it.")}
      </ul>
      <p class="hsr-foot">A win pays double your bet. The LIVE DECK strip under the table always shows the real odds, how many cards are left and how many of them kill you.</p>
      <button class="btn btn--play" data-action="house-rules-back">BACK TO THE TABLE</button>
    </div>
  </div>`;
}

export function renderHouseTable(view) {
  const h = view.house;
  const streak = h.streak > 1 ? `<span class="hs-streak">🔥 ${h.streak} in a row</span>` : "";
  return `
  <div class="screen screen--house">
    <div class="matchbar">
      <span class="round-pill">HOUSE TABLE</span>
      <span id="radio-slot" class="radio-slot"></span>
      ${streak}
      <span class="bar-right">
        <span class="hs-stack">STACK <b class="num">${h.stack}</b></span>
        <span class="clock">◔ <span class="num" data-clock>${view.clockText || "00:00"}</span></span>
        <button class="icon-btn" data-action="house-rules" aria-label="How the house table works" title="How the house table works">?</button>
        <button class="exit-btn" data-action="house-exit" aria-label="Leave the house table">EXIT</button>
      </span>
    </div>

    <div class="hs-felt">
      <div class="felt-spot"></div>
      ${dealerRow(h)}
      <div class="hs-divider"><span class="hs-vs">VS</span></div>
      ${playerRow(h)}
      <div class="hs-pot">${h.phase === "bet" ? "" : `<span class="hs-potchip">POT <b class="num">${h.wager * 2}</b></span>`}</div>
    </div>

    ${liveDeck(h)}

    <div class="action-area">${dock(h)}</div>
  </div>`;
}
