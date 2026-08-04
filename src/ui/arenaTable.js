// The arena table, you and up to seven house players for one pot
// Seats that already played sit left, you sit in the middle, seats still to play sit right

import { heatTriple } from "./heat.js";
import { HOUSE_MAX_VALUE } from "../engine/houseGame.js";
import { themeStyle } from "../engine/arenas.js";

const money = (n) => Math.round(n).toLocaleString("en-US");

function card(value, heat, { isNew = false, dup = false, mini = false } = {}) {
  const cls = `card${mini ? " card--mini" : ""}${dup ? " card--dup" : ""}${isNew ? " card--new" : ""}`;
  return `<div class="${cls}" style="--glow:${heat}"><span class="corner">${value}</span><span class="face">${value}</span></div>`;
}

function seatCard(s, h) {
  const shown = Math.min(h.shown[s.seat] || 0, s.reveal);
  const acted = shown > 0 || (s.played && h.stage !== "opening");
  const heat = heatTriple(Math.min(shown, s.values.length));
  const cards = s.values.slice(0, shown).map((v, i) => card(v, heat, { isNew: i === shown - 1, mini: true })).join("");
  const bustShowing = s.busted && shown > s.values.length;
  const bust = bustShowing ? card(s.bustValue, heat, { dup: true, isNew: true, mini: true }) : "";
  const score = s.values.slice(0, shown).reduce((n, v) => n + v, 0);

  // The result only shows once the whole seat is turned over, so the reveal keeps its surprise
  const done = shown >= s.reveal && s.played;
  let verdict = `<span class="as-score num">${score || ""}</span>`;
  if (done && s.busted) verdict = `<span class="as-verdict as-verdict--bust">BUST</span>`;
  else if (done) verdict = `<span class="as-score num">${s.score}</span>`;

  const won = h.stage === "settled" && s.payout > 0;
  const body = cards || bust ? cards + bust : `<span class="as-wait">${s.opener ? "…" : "yet to play"}</span>`;
  // Over nine rounds the total is what counts, so every seat shows it on its own line
  const lead = s.running > 0 && s.running >= h.state.bestTotal && !s.isYou;

  return `
  <div class="as-seat${s.opener ? " as-seat--opener" : " as-seat--closer"}${acted ? " has-acted" : ""}${done && s.busted ? " is-bust" : ""}${won ? " is-winner" : ""}${lead ? " is-lead" : ""}">
    <header class="as-seat-head">
      <span class="as-name">${s.name}</span>
      <span class="as-ai" title="A house player, not a person">AI</span>
    </header>
    <div class="as-hand">${body}</div>
    <footer class="as-seat-foot">${verdict}${won ? `<span class="as-take num">+${money(s.payout)}</span>` : ""}</footer>
    <div class="as-total"><span>TOTAL</span><b class="num">${s.running}</b></div>
  </div>`;
}

function seatRow(h) {
  const openers = h.state.seats.filter((s) => !s.isYou && s.opener);
  const closers = h.state.seats.filter((s) => !s.isYou && !s.opener);
  // Each group has its label on top so they read as two groups, not one row of seats
  const group = (list, label, cls) =>
    list.length
      ? `<div class="as-group ${cls}">
           <span class="as-group-label">${label}</span>
           <div class="as-group-seats">${list.map((s) => seatCard(s, h)).join("")}</div>
         </div>`
      : "";
  return `
  <div class="as-room">
    ${group(openers, `${openers.length} seat${openers.length === 1 ? "" : "s"} · already down`, "as-group--before")}
    <div class="as-split" aria-hidden="true"></div>
    ${group(closers, `${closers.length} seat${closers.length === 1 ? "" : "s"} · yet to play`, "as-group--after")}
  </div>`;
}

// The pot sits in the middle of the table, without it the middle looks empty
function potMedallion(h) {
  const st = h.state;
  const settled = h.stage === "settled";
  const champ = settled ? st.seats.filter((s) => s.payout > 0).sort((a, b) => b.total - a.total)[0] : null;
  const cut = h.arena.rake > 0 ? `${Math.round(h.arena.rake * 100)}% to the house` : "no house cut";
  return `
  <div class="as-potbox${settled ? " is-settled" : ""}${champ && champ.isYou ? " is-yours" : ""}">
    <span class="as-potlabel">${settled ? (champ ? (champ.isYou ? "YOU TAKE" : `${champ.name.toUpperCase()} TAKES`) : "HOUSE SWEEPS") : "THE POT"}</span>
    <span class="as-potnum num">${money(settled && champ ? champ.payout : st.pot)}</span>
    <span class="as-potcut">${settled ? `${st.seats.length} × ${money(st.wager)}` : cut}</span>
  </div>`;
}

function matchMeter(h) {
  const st = h.state;
  const you = st.you;
  const mine = you.running;
  const lead = st.bestTotal;
  const left = st.rounds - st.round;
  // The scale goes a bit past the higher total so the bar is never quite full
  const top = Math.max(mine, lead, 40) * 1.2 + 10;
  const at = (v) => Math.max(0, Math.min(100, (v / top) * 100));
  const ahead = mine > lead;
  const behindBy = Math.max(0, lead - mine);

  const readout = ahead
    ? `<span class="am-read am-read--lead">You lead by <b class="num">${mine - lead}</b>${left ? ` with <b class="num">${left}</b> round${left === 1 ? "" : "s"} to play` : ", last round"}</span>`
    : behindBy === 0
      ? `<span class="am-read">Level with the table${left ? ` · <b class="num">${left}</b> to play` : ""}</span>`
      : `<span class="am-read am-read--chase"><b class="num">${behindBy}</b> behind${left ? ` · <b class="num">${left}</b> round${left === 1 ? "" : "s"} to find it` : " going into the last round"}</span>`;

  return `
  <div class="am-meter is-called${ahead ? " is-ahead" : ""}">
    <div class="am-track">
      <div class="am-fill" style="width:${at(mine)}%"></div>
      ${lead > 0 ? `<div class="am-mark am-mark--lead" style="left:${at(lead)}%"><span>BEST ${lead}</span></div>` : ""}
    </div>
    ${readout}
  </div>`;
}

function yourRow(h) {
  const you = h.state.you;
  const heat = heatTriple(you.values.length);
  const last = you.values.length - 1;
  const cards = you.values.map((v, i) => card(v, heat, { isNew: i === last && h.dealt })).join("");
  const bust = you.busted ? card(you.bustValue, heat, { dup: true, isNew: true }) : "";
  const won = h.stage === "settled" && you.payout > 0;
  return `
  <section class="as-you${you.busted ? " is-bust" : ""}${won ? " is-winner" : ""}">
    <div class="as-you-hand">${cards + bust || `<span class="hand-empty">dealing…</span>`}</div>
    <header class="as-you-head">
      <span class="as-you-who">YOU</span>
      <span class="as-you-score num">${you.busted ? "0" : you.score}</span>
      <span class="as-you-total">TOTAL <b class="num">${you.running}</b></span>
      ${won ? `<span class="as-take num">+${money(you.payout)}</span>` : ""}
    </header>
    ${matchMeter(h)}
  </section>`;
}

// Shows what's left in the shoe after this round and the rounds before
// A card's number is how many of it there are, so the big cards bust you most
function liveDeck(h) {
  const counts = h.match ? h.match.remainingByValue() : Array.from({ length: HOUSE_MAX_VALUE + 1 }, (_, i) => i);
  const held = new Set(h.state.you.values);
  const cols = [];
  for (let v = 1; v <= HOUSE_MAX_VALUE; v++) {
    const left = counts[v] || 0;
    const live = held.has(v) && left > 0;
    cols.push(`
      <div class="hs-col${live ? " live" : ""}${held.has(v) ? " held" : ""}" title="${left} of the ${v}s left">
        <div class="hs-pips">${Array.from({ length: left }, () => "<i></i>").join("")}</div>
        <div class="hs-val num">${v}</div>
      </div>`);
  }
  const killers = h.state.you.values.reduce((n, v) => n + (counts[v] || 0), 0);
  const left = h.state.deckRemaining;
  const risk = Math.round((h.risk || 0) * 100);
  return `
  <div class="hs-strip">
    <div class="hs-head">
      <span class="hs-title">LIVE DECK</span>
      <span class="hs-read">${
        h.state.you.values.length
          ? `<b class="num hs-risk${risk >= 33 ? " hot" : ""}">${risk}%</b> bust · <b class="num">${killers}</b> of <b class="num">${left}</b> cards kill you`
          : `<span class="muted">${left} cards left in the shoe</span>`
      }</span>
    </div>
    <div class="hs-cols">${cols.join("")}</div>
  </div>`;
}

function playDock(h) {
  const you = h.state.you;
  const risk = Math.round((h.risk || 0) * 100);
  const busy = h.dealing;
  const canStop = you.values.length > 0 && !busy;
  return `
  <div class="as-dock${busy ? " is-dealing" : ""}">
    <button class="btn btn--bank${canStop ? "" : " ghosted"}" ${canStop ? 'data-action="arena-stay"' : "disabled"}>
      STAY<span class="sub">${you.values.length ? `keep ${you.score}` : "draw first"}</span>
    </button>
    <button class="btn btn--hit${risk >= 33 && !busy ? " pulse" : ""}" ${busy ? "disabled" : 'data-action="arena-hit"'}>
      HIT<span class="sub">${busy ? "dealing…" : `risk ${risk}%`}</span>
    </button>
  </div>`;
}

function waitDock(h) {
  const msg = h.stage === "closing" ? "The rest of the room plays…" : h.state.round > 1 ? `Round ${h.state.round} opens…` : "The table opens…";
  return `<div class="dock-wait"><span class="spinner"></span>${msg}</div>`;
}

function roundDock(h) {
  const st = h.state;
  const you = st.you;
  const gained = you.rounds[you.rounds.length - 1] || 0;
  const ahead = you.total >= st.bestTotal;
  return `
  <div class="as-dock as-dock--round">
    <div class="as-roundline">
      <span class="as-roundno">ROUND ${st.round}</span>
      <span class="as-roundgot ${gained > 0 ? "pos" : "neg"}">${gained > 0 ? `+${gained}` : "BUST · 0"}</span>
      <span class="as-roundstand">${ahead ? "you lead on" : "you are on"} <b class="num">${you.total}</b></span>
    </div>
    <span class="as-roundnext">Round ${st.round + 1} of ${st.rounds} dealing…</span>
  </div>`;
}

function settleDock(h) {
  const r = h.result;
  const canAgain = h.stack >= h.arena.buyIn;
  return `
  <div class="as-dock as-dock--settle">
    <div class="as-verdict as-verdict--${r.tone}">
      <span class="as-vtitle">${r.title}</span>
      <span class="as-vsub">${r.sub}</span>
    </div>
    ${
      canAgain
        ? `<button class="btn btn--play" data-action="arena-again">PLAY AGAIN<span class="sub">${money(h.arena.buyIn)} buy-in · ${h.state.rounds} rounds</span></button>`
        : `<button class="btn btn--play" data-action="arena-exit">BACK TO THE LADDER<span class="sub">short of the buy-in</span></button>`
    }
  </div>`;
}

function dock(h) {
  if (h.stage === "player") return playDock(h);
  if (h.stage === "round_end") return roundDock(h);
  // A finished match always has a result, anything else is still being dealt
  // Checking the result and not just the stage means a render mid shuffle still draws
  if (h.stage === "settled" && h.result) return settleDock(h);
  return waitDock(h);
}

export function renderArenaRules(view) {
  const a = view.arena.arena;
  const rounds = view.arena.state.rounds;
  const row = (k, t, d) => `
    <li class="hsr-row"><span class="hsr-k">${k}</span><span class="hsr-t"><b>${t}</b><span>${d}</span></span></li>`;
  return `
  <div class="screen screen--rules">
    <div class="rules-wrap">
      <h2 class="rules-title">${a.name.toUpperCase()}</h2>
      <p class="rules-sub">${a.bots} house players, ${rounds} rounds, one pot.</p>
      <ul class="hsr-list">
        ${row("1", "HIT or STAY", `HIT to flip another card. STAY to stop and keep your hand's value for the round, no more cards, no risk. Just like Flip 7, staying banks the round's points into your total; it doesn't cash you out of the match.`)}
        ${row("2", `${rounds} rounds, scores add up`, `Same match as the main game. Every round you play a hand, and its value is added to your total. Highest total after round ${rounds} takes the pot.`)}
        ${row("3", "A repeat busts the ROUND", "Draw a number you already hold and that round scores zero. You are not out of the match, there is always the next round.")}
        ${row("4", "The deck is stacked by value", "One 1 and twelve 12s. The cards worth the most are the ones most likely to come back and bust you. The shoe runs down across the whole match, so what has already gone matters.")}
        ${row("5", "You sit in the middle", `${Math.floor(a.bots / 2)} seat${Math.floor(a.bots / 2) === 1 ? "" : "s"} act before you each round, so you can see what you are chasing. The rest play after you, so you have to commit first.`)}
        ${row("6", "One buy-in, one pot", `${money(a.buyIn)} from every seat makes ${money(a.buyIn * (a.bots + 1))}, paid once, at the start. ${a.rake === 0 ? "There is no house here, so the winner takes all of it." : `The house takes ${Math.round(a.rake * 100)}%.`} Ties split it.`)}
      </ul>
      <p class="hsr-foot">These are practice chips. They are kept apart from your multiplayer chips on purpose and cannot be moved between the two.</p>
      <button class="btn btn--play" data-action="arena-rules-back">BACK TO THE TABLE</button>
    </div>
  </div>`;
}

export function renderArenaTable(view) {
  const h = view.arena;
  const a = h.arena;
  const streak = h.streak > 1 ? `<span class="hs-streak">🔥 ${h.streak} in a row</span>` : "";
  return `
  <div class="screen screen--arena" style="${themeStyle(a)}">
    <div class="matchbar">
      <span class="round-pill">${a.name}</span>
      <span class="as-round">ROUND <b class="num">${h.state.round}</b>/<b class="num">${h.state.rounds}</b></span>
      <span id="radio-slot" class="radio-slot"></span>
      ${streak}
      <span class="bar-right">
        <span class="as-pot">POT <b class="num">${money(h.state.pot)}</b></span>
        <span class="hs-stack">STACK <b class="num">${money(h.stack)}</b></span>
        <button class="icon-btn" data-action="arena-rules" aria-label="How this room works" title="How this room works">?</button>
        <button class="exit-btn" data-action="arena-exit" aria-label="Leave the table">EXIT</button>
      </span>
    </div>

    <div class="as-felt">
      <div class="felt-spot"></div>
      ${h.state.warmUp && h.state.round === 1 ? `<div class="as-warmup">Round one, the ${a.name.replace(/^The /, "")} regulars are still feeling the table out</div>` : ""}
      ${seatRow(h)}
      ${potMedallion(h)}
      ${yourRow(h)}
    </div>

    ${liveDeck(h)}

    <div class="action-area">${dock(h)}</div>
  </div>`;
}
