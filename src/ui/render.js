// Draws the match from snapshots, never changes the game state

import { heatTriple } from "./heat.js";

const TARGET = 7;

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const STATUS = {
  active: { txt: "live", cls: "live" },
  banked: { txt: "banked", cls: "banked" },
  busted: { txt: "bust", cls: "bust" },
  frozen: { txt: "froze", cls: "froze" },
  flip7: { txt: "flip 7", cls: "seven" },
};

function numberCard(value, heat, { mini = false, isNew = false } = {}) {
  const cls = `card${mini ? " card--mini" : ""}${isNew ? " card--new" : ""}`;
  return `<div class="${cls}" style="--heat:${heat}"><span class="face">${value}</span></div>`;
}

function modChip(card, { mini = false } = {}) {
  const txt = card.op === "mult" ? "×2" : `+${card.amount}`;
  return `<div class="modchip${mini ? " modchip--mini" : ""}">${txt}</div>`;
}

function dupCard(value, { mini = false } = {}) {
  const cls = `card card--dup${mini ? " card--mini" : ""}`;
  return `<div class="${cls}"><span class="face">${value}</span></div>`;
}

function handCards(p, { mini = false, newSeat = -1 } = {}) {
  const heat = heatTriple(p.uniqueCount);
  const last = p.numbers.length - 1;
  const nums = p.numbers
    .map((v, i) => numberCard(v, heat, { mini, isNew: !mini && p.seat === newSeat && i === last }))
    .join("");
  const mods = p.modifiers.map((m) => modChip(m, { mini })).join("");
  // When busted, show the repeat card next to its twin so the bust is clear
  const dup = p.turnState === "busted" && p.bustCard != null ? dupCard(p.bustCard, { mini }) : "";
  if (!nums && !mods && !dup) return `<span class="hand-empty">, </span>`;
  return nums + mods + dup;
}

function badge(turnState) {
  const s = STATUS[turnState] || STATUS.active;
  return `<span class="badge badge--${s.cls}">${s.txt}</span>`;
}

function pile(count, size, variant) {
  const layers = Math.max(1, Math.round((count / size) * 9));
  const dir = variant === "discard" ? -1 : 1;
  const shadows = [];
  for (let i = 1; i <= layers; i++) {
    const off = (i * 1.6).toFixed(1);
    shadows.push(`${dir * off}px ${off}px 0 -1px var(--pile-edge)`);
  }
  shadows.push("var(--shadow-elevated)");
  return `<div class="pile-card pile-card--${variant}" style="box-shadow:${shadows.join(",")}">${count === 0 ? '<span class="pile-empty">empty</span>' : ""}</div>`;
}

function tableZone(s) {
  return `
  <div class="table-zone">
    <div class="pile-wrap">
      ${pile(s.shoe.remaining, s.shoe.size, "deck")}
      <div class="pile-label">Deck <b class="num">${s.shoe.remaining}</b></div>
    </div>
    <div class="pile-wrap">
      ${pile(s.shoe.discard, s.shoe.size, "discard")}
      <div class="pile-label">Discard <b class="num">${s.shoe.discard}</b></div>
    </div>
  </div>`;
}

function dealerChip(p) {
  return p.isDealer ? '<span class="dealer-chip" title="Starts this round">deals</span>' : "";
}

function handScoreText(p) {
  return p.turnState === "busted" ? "-" : p.handScore;
}

function opponent(p, newSeat) {
  return `
  <div class="opp ${p.isCurrent ? "current" : ""}">
    <div class="opp-top">
      <span class="opp-name">${p.name}${dealerChip(p)}</span>
      ${badge(p.turnState)}
    </div>
    <div class="opp-hand">${handCards(p, { mini: true, newSeat })}
      ${p.secondChance ? '<span class="sc-dot" title="Second Chance">2nd</span>' : ""}
    </div>
    <div class="opp-foot">
      <span class="opp-round num">${handScoreText(p)}</span>
      <span class="opp-total num">total ${p.totalScore}</span>
    </div>
  </div>`;
}

function youPanel(p, view) {
  const newSeat = view.lastEvent ? view.lastEvent.seat : -1;
  const pips = Array.from({ length: TARGET }, (_, i) =>
    `<span class="pip ${i < p.uniqueCount ? "on" : ""}"></span>`
  ).join("");
  return `
  <div class="you">
    <div class="you-top">
      <span class="you-name">You${dealerChip(p)} ${badge(p.turnState)}</span>
      <span class="you-score num">hand <b>${handScoreText(p)}</b> · total <b>${p.totalScore}</b></span>
    </div>
    <div class="you-hand">${handCards(p, { newSeat })}
      ${p.secondChance ? '<span class="sc-dot">2nd chance</span>' : ""}
    </div>
    <div class="progress">
      <span class="label">Unique</span>
      <span class="pips">${pips}</span>
      <span class="count num">${p.uniqueCount}/${TARGET}</span>
    </div>
  </div>`;
}

function dock(view) {
  const s = view.snapshot;

  if (s.pendingChoice) {
    const verb = s.pendingChoice.type === "freeze" ? "Freeze" : "Flip Three";
    const buttons = s.pendingChoice.eligible
      .map((e) => `<button class="btn btn--target" data-action="target" data-seat="${e.seat}">${e.seat === s.you ? "Yourself" : e.name}</button>`)
      .join("");
    return `
    <div class="prompt">You drew <b>${verb}</b>: assign it:</div>
    <div class="targets">${buttons}</div>`;
  }

  if (s.yourTurn) {
    const me = s.players[s.you];
    const risk = Math.round(s.yourBustRisk * 100);
    const heat = heatTriple(me.uniqueCount);
    const pulsing = me.uniqueCount >= 5 ? " pulsing" : "";
    // After drawing this turn you can't bank, "Stop" ends the turn and keeps your hand
    // At the start of a turn you can bank if you have a card
    const left = s.youHitThisTurn
      ? `<button class="btn btn--bank" data-action="stop">Stop<span class="sub">hold ${me.handScore}</span></button>`
      : `<button class="btn btn--bank${s.canBank ? " can-bank" : ""}" data-action="stay" ${s.canBank ? "" : "disabled"}>Bank<span class="sub">${s.canBank ? me.handScore : "draw first"}</span></button>`;
    return `
    <div class="dock" style="--heat:${heat}">
      ${left}
      <button class="btn btn--flip${pulsing}" data-action="hit">Hit →<span class="sub">bust risk ${risk}%</span></button>
    </div>`;
  }

  const a = s.actingSeat;
  const label = a === s.you ? "Your forced flips…" : `${s.players[a].name} is playing…`;
  return `<div class="dock-wait"><span class="spinner"></span>${label}</div>`;
}

export function renderLobby(view) {
  const s = view.snapshot;
  return `
  <div class="screen screen--lobby">
    <div class="topbar">
      <span class="chip">◐ session <span data-clock>${fmtTime(s.session.elapsedMs)}</span></span>
      <button class="icon-btn" data-action="limits" aria-label="Responsible gaming settings">⚙</button>
    </div>
    <div class="lobby">
      <div class="wordmark">7<span>BUST</span></div>
      <p class="tagline">Nine rounds, three players, taking turns clockwise. Flip cards for points, but a repeat number busts your round.</p>
      <ul class="rules">
        <li><b>Hit</b> for as many cards as you dare · <b>Bank</b> to score</li>
        <li>Bank only at a turn's <b>start</b>: after drawing, <b>Stop</b> and bank next turn</li>
        <li>Repeat a number → <b>bust</b> · <b>Flip 7</b> ends the round, +15</li>
        <li>One <b>94-card shoe</b>: it shrinks all match, so count cards</li>
      </ul>
      <button class="btn btn--play" data-action="start">Start match &nbsp;→</button>
      <div class="lobby-foot">
        <a class="link" href="#" data-action="rules">How to play</a>
        <span>·</span>
        <a class="link" href="#" data-action="limits">Limits</a>
        <span>·</span>
        <a class="link" href="#" data-action="verify">Verify fair</a>
      </div>
    </div>
  </div>`;
}

// Right side on desktop with standings and the table feed
// On phones the feed drops into the normal layout and standings hide
function sidebar(s) {
  const stand = [...s.standings]
    .map(
      (p) => `<div class="sb-live-row ${p.seat === s.you ? "you" : ""}"><span>${p.name}</span><span class="num">${p.totalScore}</span></div>`
    )
    .join("");
  const logLines = s.log.map((l) => `<div class="logline">${l}</div>`).join("");
  return `
  <div class="sidebar">
    <div class="sb-live">
      <div class="sb-live-title">Standings</div>
      ${stand}
    </div>
    <div class="log">${logLines}</div>
  </div>`;
}

export function renderMatch(view) {
  const s = view.snapshot;
  const me = s.players[s.you];
  const heat = heatTriple(me.uniqueCount);
  const opps = s.players.filter((p) => p.seat !== s.you).map((p) => opponent(p, s.lastEvent ? s.lastEvent.seat : -1)).join("");

  return `
  <div class="screen screen--match" style="--heat:${heat}">
    <div class="matchbar">
      <span class="round-pill">Round <b class="num">${s.round.number}</b>/<span class="num">${s.round.total}</span></span>
      <span class="dealer-note">${s.players[s.dealer].name} starts</span>
      <span class="bar-right">
        <span class="clock">◐ <span class="num" data-clock>${fmtTime(s.session.elapsedMs)}</span></span>
        <button class="icon-btn icon-btn--sm" data-action="rules" aria-label="How to play">?</button>
      </span>
    </div>

    <div class="opponents">${opps}</div>

    ${tableZone(s)}

    ${sidebar(s)}

    ${youPanel(me, view)}

    <div class="action-area">${dock(view)}</div>
  </div>`;
}

function scoreboard(s) {
  const maxDelta = Math.max(0, ...s.players.map((p) => p.roundDelta));
  const rows = [...s.players]
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((p) => {
      let did;
      if (p.roundDelta > 0) did = `+${p.roundDelta}`;
      else if (p.turnState === "busted") did = "bust";
      else did = "-";
      const star = p.roundDelta > 0 && p.roundDelta === maxDelta ? " ★" : "";
      return `
      <div class="sb-row ${p.seat === s.you ? "you" : ""}">
        <span class="sb-name">${p.name}${star}</span>
        <span class="sb-round num">${did}</span>
        <span class="sb-total num">${p.totalScore}</span>
      </div>`;
    })
    .join("");
  return `<div class="scoreboard">
    <div class="sb-row sb-head"><span>Player</span><span>This round</span><span>Total</span></div>
    ${rows}
  </div>`;
}

export function renderOverlay(view) {
  const s = view.snapshot;

  if (s.phase === "round_end") {
    return `
    <div class="overlay">
      <div class="result result--banked" style="--heat:52, 224, 196">
        <div class="kicker">Round ${s.round.number} of ${s.round.total} done</div>
        <h2>SCORES</h2>
        ${scoreboard(s)}
        <button class="btn btn--play" data-action="next">Next round &nbsp;→</button>
      </div>
    </div>`;
  }

  if (s.phase === "match_end") {
    const winner = s.players[s.winner];
    const youWon = s.winner === s.you;
    return `
    <div class="overlay">
      <div class="result result--seven" style="--heat:255, 209, 92">
        <div class="kicker">Match over, 9 rounds</div>
        <h2>${youWon ? "YOU WIN" : winner.name.toUpperCase() + " WINS"}</h2>
        ${scoreboard(s)}
        <button class="btn btn--play" data-action="again">Play again</button>
        <div><a class="ghost link" href="#" data-action="verify">Verify fair</a></div>
      </div>
    </div>`;
  }
  return "";
}

export function renderToast(view) {
  return view.toast ? `<div class="toast">${view.toast}</div>` : "";
}

export function renderRules() {
  return `
  <div class="screen screen--rules">
    <div class="topbar">
      <button class="icon-btn" data-action="rules-back" aria-label="Back">←</button>
      <span class="rules-title">How to play</span>
      <span class="topbar-spacer"></span>
    </div>
    <div class="rules-scroll">
      <section class="rule-card">
        <h3>Goal</h3>
        <p>Highest total after <b>9 rounds</b> wins. You play against Nova and Rook (AI), taking turns clockwise. The start player rotates each round.</p>
      </section>
      <section class="rule-card">
        <h3>Your turn</h3>
        <p>On your turn you can <b>Hit</b> as many times as you want, your hand builds up. When you're done drawing, <b>Stop</b> to end your turn and keep your hand for later. Play then passes clockwise.</p>
      </section>
      <section class="rule-card rule-card--accent">
        <h3>How banking works</h3>
        <p>You bank with <b>Bank (Stay)</b>: but only as your turn's <b>first action</b>, before you draw, and never on an empty hand. So once you draw this turn you can't bank until a <b>later turn</b>: Stop now, then Bank when play comes back to you (which leaves you exposed to a Flip Three in the meantime).</p>
      </section>
      <section class="rule-card">
        <h3>Bust &amp; Flip 7</h3>
        <p>Flip a number you already hold and you <b>bust</b>: score 0 for the round (both copies are shown). Reach <b>7 unique numbers</b> for a <b>Flip 7</b>: the <b>whole round ends</b>: everyone still in banks their hand, and you get a <b>+15</b> bonus.</p>
      </section>
      <section class="rule-card">
        <h3>End of a round</h3>
        <p>A round ends once <b>every player has banked or busted</b>. Hands are cleared and the next round begins, hands never carry over.</p>
      </section>
      <section class="rule-card">
        <h3>Scoring</h3>
        <p>Add up your number cards. A <b>×2</b> card doubles that sum, <b>+N</b> cards add on top, and Flip 7 adds <b>+15</b>.</p>
      </section>
      <section class="rule-card">
        <h3>Action cards</h3>
        <ul class="rule-list">
          <li><b>Freeze</b>: pick a player; they bank their hand right away and are done for the round.</li>
          <li><b>Flip Three</b>: pick a player; they must flip three cards (risky, it can bust them).</li>
          <li><b>Second Chance</b>: automatically eats one duplicate, saving you from a bust.</li>
        </ul>
      </section>
      <section class="rule-card">
        <h3>The shoe</h3>
        <p>One <b>94-card</b> deck for the whole match. Spent cards go to a discard pile, so the shoe shrinks and only reshuffles when it runs out, <b>counting cards</b> pays off.</p>
      </section>
    </div>
    <button class="btn btn--play" data-action="rules-back">Got it</button>
  </div>`;
}

export function renderApp(view) {
  if (view.showRules) return `<div class="phone">${renderRules()}</div>`;
  const inMatch = view.snapshot.phase !== "lobby";
  const screen = inMatch ? renderMatch(view) : renderLobby(view);
  const overlay = inMatch ? renderOverlay(view) : "";
  return `<div class="phone">${screen}${overlay}${renderToast(view)}</div>`;
}
