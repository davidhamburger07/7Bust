// The arena table, you and up to seven house players over nine rounds for one pot
// Uses the main table's look, each room only changes the colours

import { heatTriple } from "./heat.js";
import { HOUSE_MAX_VALUE, HOUSE_DECK_SIZE } from "../engine/houseGame.js";

const money = (n) => Math.round(n).toLocaleString("en-US");

// Puts each room's colours onto the main table's colour variables so the shared CSS uses them
// The old arena variables stay for the match meter
function skinVars(a) {
  const t = a.theme || {};
  const mapped = [
    t["--ar-felt"] && `--felt:${t["--ar-felt"]}`,
    t["--ar-felt-hi"] && `--felt-hi:${t["--ar-felt-hi"]}`,
    t["--ar-felt-lo"] && `--felt-lo:${t["--ar-felt-lo"]}`,
    t["--ar-rail"] && `--rail:${t["--ar-rail"]}`,
    t["--ar-rail-hi"] && `--rail-hi:${t["--ar-rail-hi"]}`,
  ].filter(Boolean);
  return Object.entries(t)
    .map(([k, v]) => `${k}:${v}`)
    .concat(mapped)
    .join(";");
}

const STATUS = {
  active: { txt: "in", cls: "live" },
  banked: { txt: "stayed", cls: "banked" },
  busted: { txt: "bust", cls: "bust" },
};
const badge = (state) => {
  const s = STATUS[state] || STATUS.active;
  return `<span class="badge badge--${s.cls}">${s.txt}</span>`;
};
const aiTag = '<span class="ai-chip" title="A house player, not a person">AI</span>';

// Same markup as the main table's card so it gets the same look
function card(value, heat, { isNew = false, dup = false, mini = false } = {}) {
  const cls = `card${mini ? " card--mini" : ""}${dup ? " card--dup" : ""}${isNew ? " card--new" : ""}`;
  return `<div class="${cls}" style="--glow:${heat}"><span class="corner">${value}</span><span class="face">${value}</span></div>`;
}

function oppSeat(s, h) {
  const shown = Math.min(h.shown[s.seat] || 0, s.reveal);
  const heat = heatTriple(Math.min(shown, s.values.length));
  const cards = s.values.slice(0, shown).map((v, i) => card(v, heat, { isNew: i === shown - 1, mini: true })).join("");
  const bustShowing = s.busted && shown > s.values.length;
  const bust = bustShowing ? card(s.bustValue, heat, { dup: true, isNew: true, mini: true }) : "";
  const done = shown >= s.reveal && s.played;
  const handScore = s.values.slice(0, shown).reduce((n, v) => n + v, 0);
  const state = done ? (s.busted ? "busted" : "banked") : "active";
  const scoreText = done ? (s.busted ? "-" : s.score) : handScore || "";
  const won = h.stage === "settled" && s.payout > 0;
  const lead = !s.isYou && s.running > 0 && s.running >= h.state.bestTotal && h.stage !== "settled";
  const body = cards || bust ? cards + bust : `<span class="hand-empty">${s.opener ? "…" : "yet to play"}</span>`;
  return `
  <div class="seat ${state}${won ? " is-winner" : ""}${lead ? " is-lead" : ""}" data-seat="${s.seat}">
    <div class="seat-top"><span class="seat-name">${s.name}${aiTag}</span>${done ? badge(state) : ""}</div>
    <div class="seat-hand">${body}</div>
    <div class="seat-foot"><span class="seat-hand-score num">${scoreText}</span><span class="seat-total">total ${s.running}</span></div>
  </div>`;
}

function youSeat(h) {
  const you = h.state.you;
  const heat = heatTriple(you.values.length);
  const last = you.values.length - 1;
  const cards = you.values.map((v, i) => card(v, heat, { isNew: i === last && h.dealt })).join("");
  const bust = you.busted ? card(you.bustValue, heat, { dup: true, isNew: true }) : "";
  // The arena always marks you as played, so this goes by the stage instead
  const state = you.busted ? "busted" : h.stage === "player" ? "active" : "banked";
  const won = h.stage === "settled" && you.payout > 0;
  return `
  <div class="you-seat ${state}${won ? " is-winner" : ""}" data-seat="${you.seat}">
    <div class="you-top">
      <span class="you-name">YOU ${badge(state)}</span>
      <span class="you-score num">hand <b>${you.busted ? "-" : you.score}</b> · total <b>${you.running}</b></span>
    </div>
    <div class="you-hand">${cards + bust || `<span class="hand-empty">dealing…</span>`}</div>
    ${matchMeter(h)}
  </div>`;
}

function matchMeter(h) {
  const st = h.state;
  const mine = st.you.running;
  const lead = st.bestTotal;
  const left = st.rounds - st.round;
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

function leaderPanel(h) {
  const ranked = h.state.seats.slice().sort((a, b) => b.running - a.running || b.total - a.total);
  const rows = ranked
    .map((s, i) => {
      const medal = ["gold", "silver", "bronze"][i] || "";
      const delta = s.rounds.length ? s.rounds[s.rounds.length - 1] : 0;
      const busted = s.busted && (h.shown[s.seat] || 0) >= s.reveal;
      return `
      <div class="lb-row ${s.isYou ? "you" : ""}">
        <span class="lb-rank ${medal} num">${i + 1}</span>
        <span class="lb-name">${s.isYou ? "You" : s.name}${s.isYou ? "" : aiTag}${i === 0 && s.running > 0 ? " 👑" : ""}</span>
        <span class="lb-state${busted ? " bust" : ""}">${busted ? "✕" : delta > 0 ? `+${delta}` : ""}</span>
        <span class="lb-score num">${s.running}</span>
      </div>`;
    })
    .join("");
  return `<div class="leaderpanel"><div class="logpanel-title">Leaderboard</div><div class="lb">${rows}</div></div>`;
}

function logPanel(h) {
  const seats = h.state.seats;
  const completed = h.state.you.rounds.length;
  const lines = [];
  for (let r = 0; r < completed; r++) {
    lines.push(`<div class="logline log-round">· Round ${r + 1}, </div>`);
    for (const s of seats) {
      const sc = s.rounds[r];
      const nm = s.isYou ? "You" : s.name;
      lines.push(sc === 0 ? `<div class="logline log-bust">${nm} busted</div>` : `<div class="logline log-bank">${nm} stayed on ${sc}</div>`);
    }
  }
  const body = lines.join("") || '<div class="logline muted">Play the round to begin…</div>';
  return `<div class="logpanel"><div class="logpanel-title">Table log</div><div class="log" id="log">${body}</div></div>`;
}

function liveDeck(h) {
  const counts = h.match ? h.match.remainingByValue() : Array.from({ length: HOUSE_MAX_VALUE + 1 }, () => 0);
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
  <div class="logpanel hs-panel">
    <div class="hs-head">
      <span class="logpanel-title">Live deck</span>
      <span class="hs-read">${
        h.state.you.values.length
          ? `<b class="num hs-risk${risk >= 33 ? " hot" : ""}">${risk}%</b> bust · <b class="num">${killers}</b>/<b class="num">${left}</b> kill you`
          : `<span class="muted">${left} in the shoe</span>`
      }</span>
    </div>
    <div class="hs-cols">${cols.join("")}</div>
  </div>`;
}

function deckPile(h) {
  const remaining = h.state.deckRemaining;
  const layers = Math.max(2, Math.round((remaining / HOUSE_DECK_SIZE) * 8));
  const sh = [];
  for (let i = 1; i <= layers; i++) sh.push(`${(i * 1.5).toFixed(1)}px ${(i * 1.5).toFixed(1)}px 0 -1px #2a1a0c`);
  sh.push("var(--shadow-card)");
  const discard = Math.max(0, HOUSE_DECK_SIZE - remaining);
  return `
  <div class="shoe">
    <div class="shoe-pile" style="box-shadow:${sh.join(",")}"></div>
    <div class="shoe-labels"><span>Deck <b class="num">${remaining}</b></span><span class="muted">out <b class="num">${discard}</b></span></div>
  </div>`;
}

function arc() {
  return `
  <svg class="arc" viewBox="0 0 820 300" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
    <defs><path id="arcp" d="M 70 250 A 340 340 0 0 1 750 250" fill="none" /></defs>
    <text class="arc-t"><textPath href="#arcp" startOffset="50%" text-anchor="middle">★ NINE ROUNDS · HIGHEST TOTAL TAKES THE POT ★</textPath></text>
  </svg>`;
}

function playDock(h) {
  const you = h.state.you;
  const risk = Math.round((h.risk || 0) * 100);
  const busy = h.dealing;
  const canStay = you.values.length > 0 && !busy;
  const pulse = risk >= 33 && !busy ? " pulse" : "";
  return `
  <div class="dock${busy ? " dock--pending" : ""}">
    <button class="btn btn--bank${canStay ? "" : " ghosted"}" ${canStay ? 'data-action="arena-stay"' : "disabled"}>
      STAY<span class="sub">${you.values.length ? `keep ${you.score}` : "draw first"}</span>
    </button>
    <button class="btn btn--hit${pulse}" ${busy ? "disabled" : 'data-action="arena-hit"'}>
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
  if (h.stage === "settled" && h.result) return settleDock(h);
  return waitDock(h);
}

export function renderArenaTable(view) {
  const h = view.arena;
  const a = h.arena;
  const crowded = a.bots >= 4 ? " crowded" : "";
  const streak = h.streak > 1 ? ` · 🔥 ${h.streak} in a row` : "";
  const opps = h.state.seats.filter((s) => !s.isYou).map((s) => oppSeat(s, h)).join("");
  return `
  <div class="screen screen--match${crowded}" style="${skinVars(a)}">
    <div class="matchbar">
      <span class="round-pill">Round <b class="num">${h.state.round}</b>/<span class="num">${h.state.rounds}</span></span>
      <span id="radio-slot" class="radio-slot"></span>
      <span class="dealer-note">${a.name}${h.state.warmUp && h.state.round === 1 ? " · feeling out the table" : streak}</span>
      <span class="bar-right">
        <span class="balance-chip">${chipStack(h.stack)}</span>
        <button class="icon-btn" data-action="arena-rules" aria-label="How this room works" title="How this room works">?</button>
        <button class="exit-btn" data-action="arena-exit" aria-label="Leave the table">EXIT</button>
      </span>
    </div>

    ${leaderPanel(h)}

    <div class="felt">
      <div class="felt-spot"></div>
      ${arc()}
      <div class="opponents">${opps}</div>
      <div class="dealer-zone">${deckPile(h)}<div class="pot-chip">POT <b class="num">${money(h.state.pot)}</b>${h.arena.rake > 0 ? ` · <span class="muted">${Math.round(h.arena.rake * 100)}% rake</span>` : ""}</div></div>
      ${youSeat(h)}
    </div>

    <div class="rightcol">${logPanel(h)}${liveDeck(h)}</div>

    <div class="action-area">${dock(h)}</div>
  </div>`;
}

function chipStack(amount) {
  return `<span class="chip-stack"><span class="chip chip--gold"></span><span class="chip chip--red"></span><span class="chip chip--blue"></span></span><span class="chip-amount num">${Math.round(amount).toLocaleString()}</span>`;
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
