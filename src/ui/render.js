// Draws the casino table from snapshots, never changes the game state

import { heatTriple } from "./heat.js";
import { PLAYER_EMOTES } from "../engine/aiChatter.js";

const TARGET = 7;
const escAttr = (s) => String(s).replace(/"/g, "&quot;");

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const STATUS = {
  active: { txt: "in", cls: "live" },
  banked: { txt: "banked", cls: "banked" },
  busted: { txt: "bust", cls: "bust" },
  frozen: { txt: "frozen", cls: "froze" },
  clean7: { txt: "clean 7", cls: "seven" },
};

function badge(turnState) {
  const s = STATUS[turnState] || STATUS.active;
  return `<span class="badge badge--${s.cls}">${s.txt}</span>`;
}

function numberCard(value, heat, { mini = false, isNew = false } = {}) {
  const cls = `card${mini ? " card--mini" : ""}${isNew ? " card--new" : ""}`;
  return `<div class="${cls}" style="--glow:${heat}"><span class="corner">${value}</span><span class="face">${value}</span></div>`;
}
function modChip(card, { mini = false } = {}) {
  const txt = card.op === "mult" ? "×2" : `+${card.amount}`;
  return `<div class="modcard${mini ? " modcard--mini" : ""}">${txt}</div>`;
}
function dupCard(value, { mini = false } = {}) {
  return `<div class="card card--dup${mini ? " card--mini" : ""}"><span class="corner">${value}</span><span class="face">${value}</span></div>`;
}
function handCards(p, { mini = false, newSeat = -1 } = {}) {
  const heat = heatTriple(p.uniqueCount);
  const last = p.numbers.length - 1;
  const nums = p.numbers
    .map((v, i) => numberCard(v, heat, { mini, isNew: !mini && p.seat === newSeat && i === last }))
    .join("");
  const mods = p.modifiers.map((m) => modChip(m, { mini })).join("");
  const dup = p.turnState === "busted" && p.bustCard != null ? dupCard(p.bustCard, { mini }) : "";
  if (!nums && !mods && !dup) return `<span class="hand-empty">no cards</span>`;
  return nums + mods + dup;
}
function handScoreText(p) {
  return p.turnState === "busted" ? "-" : p.handScore;
}
function dealerChip(p) {
  return p.isDealer ? '<span class="deal-chip" title="Deals this round">D</span>' : "";
}

function shoe(s) {
  const layers = Math.max(2, Math.round((s.shoe.remaining / s.shoe.size) * 8));
  const sh = [];
  for (let i = 1; i <= layers; i++) sh.push(`${(i * 1.5).toFixed(1)}px ${(i * 1.5).toFixed(1)}px 0 -1px #2a1a0c`);
  sh.push("var(--shadow-card)");
  return `
  <div class="shoe">
    <div class="shoe-pile" style="box-shadow:${sh.join(",")}"></div>
    <div class="shoe-labels">
      <span>Shoe <b class="num">${s.shoe.remaining}</b></span>
      <span class="muted">out <b class="num">${s.shoe.discard}</b></span>
    </div>
  </div>`;
}

function seat(p, newSeat) {
  const sc = p.secondChance ? " has-sc" : "";
  return `
  <div class="seat ${p.isCurrent ? "current" : ""} ${p.turnState}${sc}" data-seat="${p.seat}">
    <div class="seat-top"><span class="seat-name">${p.name}${dealerChip(p)}</span>${badge(p.turnState)}</div>
    <div class="seat-hand">${handCards(p, { mini: true, newSeat })}${p.secondChance ? '<span class="sc-dot">2nd</span>' : ""}</div>
    <div class="seat-foot"><span class="seat-hand-score num">${handScoreText(p)}</span><span class="seat-total">total ${p.totalScore}</span></div>
  </div>`;
}

function youSeat(p, view) {
  const newSeat = view.lastEvent ? view.lastEvent.seat : -1;
  const pips = Array.from({ length: TARGET }, (_, i) => `<span class="pip ${i < p.uniqueCount ? "on" : ""}"></span>`).join("");
  const sc = p.secondChance ? " has-sc" : "";
  return `
  <div class="you-seat ${p.isCurrent ? "current" : ""} ${p.turnState}${sc}" data-seat="${p.seat}">
    <div class="you-top">
      <span class="you-name">YOU${dealerChip(p)} ${badge(p.turnState)}</span>
      <span class="you-score num">hand <b>${handScoreText(p)}</b> · total <b>${p.totalScore}</b></span>
    </div>
    <div class="you-hand">${handCards(p, { newSeat })}${p.secondChance ? '<span class="sc-dot big">2nd chance</span>' : ""}</div>
    <div class="progress"><span class="pips">${pips}</span><span class="count num">${p.uniqueCount}/${TARGET}</span></div>
  </div>`;
}

function peekLabel(card) {
  if (card.kind === "number") return String(card.value);
  if (card.kind === "modifier") return card.op === "mult" ? "×2" : `+${card.amount}`;
  return { freeze: "FREEZE", flip3: "FLIP THREE", second_chance: "SECOND CHANCE", see_future: "SEE THE FUTURE" }[card.action] || "?";
}
function peekChip(s) {
  if (!s.yourPeek) return "";
  return `<div class="peek-chip">👁 NEXT UP: <b>${peekLabel(s.yourPeek)}</b></div>`;
}

function dock(view) {
  const s = view.snapshot;
  if (s.pendingChoice) {
    const verb = s.pendingChoice.type === "freeze" ? "FREEZE" : "FLIP THREE";
    const buttons = s.pendingChoice.eligible
      .map((e) => `<button class="btn btn--target" data-action="target" data-seat="${e.seat}">${e.seat === s.you ? "Yourself" : e.name}</button>`)
      .join("");
    return `<div class="prompt">You drew <b>${verb}</b>: hit a player:</div><div class="targets">${buttons}</div>`;
  }
  if (s.yourTurn) {
    const me = s.players[s.you];
    const risk = Math.round(s.yourBustRisk * 100);
    const left = s.youHitThisTurn
      ? `<button class="btn btn--stop" data-action="stop">STOP<span class="sub">hold ${me.handScore}</span></button>`
      : `<button class="btn btn--bank${s.canBank ? "" : " ghosted"}" data-action="stay" ${s.canBank ? "" : "disabled"}>BANK<span class="sub">${s.canBank ? me.handScore : "draw first"}</span></button>`;
    const pulse = me.uniqueCount >= 5 ? " pulse" : "";
    return `<div class="dock">${left}<button class="btn btn--hit${pulse}" data-action="hit">HIT<span class="sub">risk ${risk}%</span></button></div>`;
  }
  const a = s.actingSeat;
  const who = a === s.you ? "Your forced flips" : `${s.players[a].name} is playing`;
  return `<div class="dock-wait"><span class="spinner"></span>${who}…</div>`;
}

function leaderPanel(s) {
  const rows = s.standings
    .map((st, i) => {
      const p = s.players[st.seat];
      const medal = ["gold", "silver", "bronze"][i] || "";
      return `
      <div class="lb-row ${st.seat === s.you ? "you" : ""}">
        <span class="lb-rank ${medal} num">${i + 1}</span>
        <span class="lb-name">${st.seat === s.you ? "You" : st.name}${i === 0 && st.totalScore > 0 ? " 👑" : ""}</span>
        <span class="lb-state${p.turnState === "busted" ? " bust" : ""}">${p.turnState === "busted" ? "✕" : p.roundDelta > 0 ? `+${p.roundDelta}` : ""}</span>
        <span class="lb-score num">${st.totalScore}</span>
      </div>`;
    })
    .join("");
  return `
  <div class="leaderpanel">
    <div class="logpanel-title">Leaderboard</div>
    <div class="lb">${rows}</div>
  </div>`;
}

function logPanel(s) {
  const lines = s.log.map((l) => `<div class="logline log-${l.type}">${l.text}</div>`).join("");
  return `
  <div class="logpanel">
    <div class="logpanel-title">Table log</div>
    <div class="log" id="log">${lines || '<div class="logline muted">Deal to begin…</div>'}</div>
  </div>`;
}

function chatPanel(view) {
  const lines = (view.chat || [])
    .map((c) => `<div class="chatline${c.ai ? " ai" : ""}"><b>${c.name}</b> ${c.text}</div>`)
    .join("");
  const emotes = PLAYER_EMOTES.map((e) => `<button class="emote-btn" data-action="emote" data-e="${e}" aria-label="Send ${e}">${e}</button>`).join("");
  return `
  <div class="chatpanel">
    <div class="logpanel-title">All chat</div>
    <div class="chatlist" id="chatlist">${lines || '<div class="chatline muted-chat">Say hi to the table…</div>'}</div>
    <div class="emotestrip">${emotes}</div>
    <div class="chatrow">
      <input id="chat-in" class="chat-in" maxlength="140" placeholder="Message the table…" value="${escAttr(view.chatDraft || "")}" autocomplete="off" />
      <button class="chat-send" data-action="chat-send" aria-label="Send message">➤</button>
    </div>
  </div>`;
}

function arc() {
  return `
  <svg class="arc" viewBox="0 0 820 300" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
    <defs><path id="arcp" d="M 70 250 A 340 340 0 0 1 750 250" fill="none" /></defs>
    <text class="arc-t"><textPath href="#arcp" startOffset="50%" text-anchor="middle">★ CLEAN 7 PAYS BIG ★ BANK BEFORE YOU BUST ★</textPath></text>
  </svg>`;
}

function chipStack(amount) {
  return `<span class="chip-stack"><span class="chip chip--gold"></span><span class="chip chip--red"></span><span class="chip chip--blue"></span></span><span class="chip-amount num">${amount.toLocaleString()}</span>`;
}

export function renderLobby(view) {
  const s = view.snapshot;
  const cfg = s.config;
  const fee = view.entryFee ?? cfg.defaultEntry;
  const pot = fee * cfg.seats;
  const rake = Math.round(pot * cfg.rakePct);
  const prize = pot - rake;
  const balance = s.wallet.balance;
  const canEnter = balance >= fee;
  const tiers = cfg.entryTiers
    .map((t) => `<button class="tier ${t === fee ? "on" : ""}" data-action="entry" data-fee="${t}">${t}</button>`)
    .join("");
  return `
  <div class="screen screen--lobby">
    <div class="lobby">
      <div class="wordmark">7<span>BUST</span></div>
      <p class="tagline">Take a seat. Flip for the pot, bank before you bust.</p>

      <div class="buyin">
        <div class="buyin-head"><span class="label">Your chips</span><span class="balance">${chipStack(balance)}</span></div>
        <div class="buyin-row"><span class="label">Buy-in</span><div class="tiers">${tiers}</div></div>
        <div class="prize-preview">Pot <b class="num">${pot}</b> · winner takes <b class="num">${prize}</b> <span class="rake">${Math.round(cfg.rakePct * 100)}% rake</span></div>
      </div>

      <button class="btn btn--play" data-action="start" ${canEnter ? "" : "disabled"}>${canEnter ? `TAKE A SEAT · −${fee}` : "NOT ENOUGH CHIPS"}</button>
      <button class="btn btn--online" data-action="mp-open">PLAY ONLINE<span class="sub">rooms with friends</span></button>
      <div class="lobby-foot">
        <a class="link" href="#" data-action="rules">How to play</a><span>·</span>
        <a class="link" href="#" data-action="history">Match history</a><span>·</span>
        <a class="link" href="#" data-action="reset-balance">Reset chips</a><span>·</span>
        <a class="link" href="#" data-action="verify">Verify fair</a>
      </div>
    </div>
  </div>`;
}

export function renderMatch(view) {
  const s = view.snapshot;
  const online = view.mode === "online" && view.online && view.online.lobby ? view.online.lobby : null;
  const me = s.players[s.you];
  const newSeat = s.lastEvent ? s.lastEvent.seat : -1;
  const opps = s.players.filter((p) => p.seat !== s.you).map((p) => seat(p, newSeat)).join("");
  return `
  <div class="screen screen--match">
    <div class="matchbar">
      <span class="round-pill">Round <b class="num">${s.round.number}</b>/<span class="num">${s.round.total}</span></span>
      <span class="dealer-note">${s.players[s.dealer].name} deals</span>
      <span class="bar-right">
        ${s.wallet ? `<span class="balance-chip">${chipStack(s.wallet.balance)}</span>` : online ? `<span class="room-chip">ROOM <b>${online.code}</b></span>` : ""}
        <span class="clock">◔ <span class="num" data-clock>${fmtTime(s.session.elapsedMs)}</span></span>
        <button class="icon-btn" data-action="rules" aria-label="How to play">?</button>
        <button class="exit-btn" data-action="exit" aria-label="Exit to the main menu">EXIT</button>
      </span>
    </div>

    ${leaderPanel(s)}

    <div class="felt">
      <div class="felt-spot"></div>
      ${arc()}
      <div class="dealer-zone">${shoe(s)}</div>
      <div class="opponents">${opps}</div>
      ${youSeat(me, view)}
    </div>

    <div class="rightcol">${logPanel(s)}${view.mode === "online" ? chatPanel(view) : ""}</div>

    <div class="action-area">${peekChip(s)}${dock(view)}</div>
  </div>`;
}

function scoreboard(s) {
  const maxDelta = Math.max(0, ...s.players.map((p) => p.roundDelta));
  const rows = [...s.players]
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((p) => {
      let did = p.roundDelta > 0 ? `+${p.roundDelta}` : p.turnState === "busted" ? "bust" : "-";
      const star = p.roundDelta > 0 && p.roundDelta === maxDelta ? " ★" : "";
      return `<div class="sb-row ${p.seat === s.you ? "you" : ""}"><span class="sb-name">${p.name}${star}</span><span class="sb-round num">${did}</span><span class="sb-total num">${p.totalScore}</span></div>`;
    })
    .join("");
  return `<div class="scoreboard"><div class="sb-row sb-head"><span>Player</span><span>Round</span><span>Total</span></div>${rows}</div>`;
}

function cashLedger(s) {
  const t = s.tournament;
  if (!t) return "";
  const won = t.youPayout > 0;
  return `
  <div class="cash-ledger">
    <div class="cl-row"><span>Buy-in</span><span class="neg">−${t.entryFee}</span></div>
    <div class="cl-row"><span>Prize pool <small>(pot ${t.pot} − ${Math.round(t.rakePct * 100)}% rake)</small></span><span class="num">${t.prizePool}</span></div>
    <div class="cl-row"><span>Your payout</span><span class="${won ? "pos" : ""}">${won ? "+" + t.youPayout : "-"}</span></div>
    <div class="cl-row total"><span>Net</span><span class="${t.youNet >= 0 ? "pos" : "neg"}">${t.youNet >= 0 ? "+" : ""}${t.youNet}</span></div>
    ${s.wallet ? `<div class="cl-row"><span>Chips</span><span class="num">${s.wallet.balance.toLocaleString()}</span></div>` : ""}
  </div>`;
}

export function renderOverlay(view) {
  const s = view.snapshot;
  if (s.phase === "round_end") {
    return `<div class="overlay"><div class="result result--round"><div class="kicker">Round ${s.round.number} of ${s.round.total}</div><h2>SCORES</h2>${scoreboard(s)}<button class="btn btn--play" data-action="next">NEXT ROUND</button></div></div>`;
  }
  if (s.phase === "match_end") {
    const winner = s.players[s.winner];
    const youWon = s.winner === s.you;
    if (s.cashless) {
      const isHost = view.online && view.online.lobby && view.online.lobby.isHost;
      const again = isHost
        ? `<button class="btn btn--play" data-action="mp-again">PLAY AGAIN</button>`
        : `<div class="wait-host">Waiting for the host to deal again…</div>`;
      return `
      <div class="overlay"><div class="result result--win">
        <div class="kicker">Match over</div>
        <h2 class="${youWon ? "big-win" : ""}">${youWon ? "YOU WIN!" : winner.name.toUpperCase() + " WINS"}</h2>
        ${scoreboard(s)}
        ${cashLedger(s)}
        ${again}
        <div><a class="ghost link" href="#" data-action="mp-leave">Leave table</a></div>
      </div></div>`;
    }
    const fee = view.entryFee ?? s.config.defaultEntry;
    const canAgain = s.wallet.balance >= fee;
    return `
    <div class="overlay"><div class="result result--win">
      <div class="kicker">Tournament over</div>
      <h2 class="${youWon ? "big-win" : ""}">${youWon ? "YOU WIN!" : winner.name.toUpperCase() + " WINS"}</h2>
      ${scoreboard(s)}
      ${cashLedger(s)}
      <button class="btn btn--play" data-action="again" ${canAgain ? "" : "disabled"}>${canAgain ? `PLAY AGAIN · −${fee}` : "OUT OF CHIPS"}</button>
      <div>${canAgain ? "" : '<a class="ghost link" href="#" data-action="reset-balance">Reset chips</a> · '}<a class="ghost link" href="#" data-action="verify">Verify fair</a></div>
    </div></div>`;
  }
  return "";
}

export function renderExitConfirm(view) {
  const s = view.snapshot;
  const stakes =
    view.mode === "online"
      ? "The table keeps playing without you, the house takes over your cards."
      : s.tournament && !s.tournament.settled
        ? `Your ${s.tournament.entryFee}-chip buy-in is forfeit and this match is abandoned.`
        : "This match will be abandoned.";
  return `
  <div class="overlay"><div class="result result--exit">
    <div class="kicker">Hold up</div>
    <h2>LEAVE THE TABLE?</h2>
    <p class="exit-note">${stakes}</p>
    <div class="exit-row">
      <button class="btn btn--play" data-action="exit-no">KEEP PLAYING</button>
      <button class="btn btn--exit" data-action="exit-yes">YES, EXIT</button>
    </div>
  </div></div>`;
}

export function renderToast(view) {
  return view.toast ? `<div class="toast">${view.toast}</div>` : "";
}

export function renderHistory(view) {
  const items = (view.history || [])
    .map((h) => {
      const d = new Date(h.at);
      const date = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      const rows = h.players
        .map(
          (p) => `
        <div class="hist-row ${p.name === "You" ? "you" : ""}">
          <span class="hist-place num">${p.place}</span>
          <span class="hist-name">${p.name}${p.isAI ? '<span class="hist-ai">AI</span>' : ""}</span>
          <span class="hist-stat num">${p.score}</span>
          <span class="hist-stat num">${p.bestBank}</span>
          <span class="hist-stat num">${p.busts}</span>
          <span class="hist-stat num">${p.clean7s}</span>
          <span class="hist-stat num">${p.frozen}</span>
          <span class="hist-stat num">${p.peeks}</span>
        </div>`
        )
        .join("");
      const net =
        h.entryFee > 0 && h.youNet != null
          ? `<b class="${h.youNet >= 0 ? "pos" : "neg"}">${h.youNet >= 0 ? "+" : ""}${h.youNet} chips</b>`
          : `<span class="hist-free">friendly</span>`;
      return `
      <section class="hist-card ${h.youWon ? "won" : ""}">
        <div class="hist-head">
          <span class="hist-mode">${h.mode === "online" ? `ONLINE · ROOM ${h.room || "?"}` : "SOLO"}</span>
          <span class="hist-date">${date}</span>
        </div>
        <div class="hist-sub">${h.rounds} round${h.rounds === 1 ? "" : "s"} · buy-in ${h.entryFee || 0} · winner <b>${h.winner}</b> · ${net}</div>
        <div class="hist-row hist-headrow"><span>#</span><span>Player</span><span>Score</span><span>Best</span><span>Busts</span><span>7s</span><span>Froze</span><span>👁</span></div>
        ${rows}
      </section>`;
    })
    .join("");
  return `
  <div class="screen screen--rules">
    <div class="rules-top"><button class="icon-btn" data-action="history-back" aria-label="Back">←</button><span class="rules-title">Match history</span></div>
    <div class="rules-scroll hist-scroll">${items || '<p class="hist-empty">No matches on record yet, take a seat and deal one.</p>'}</div>
    <button class="btn btn--play" data-action="history-back">BACK</button>
  </div>`;
}

export function renderRules() {
  return `
  <div class="screen screen--rules">
    <div class="rules-top"><button class="icon-btn" data-action="rules-back" aria-label="Back">←</button><span class="rules-title">How to play</span></div>
    <div class="rules-scroll">
      <section class="rule-card"><h3>Goal</h3><p>Highest chips-score after <b>9 rounds</b> wins the pot. You play against Nova, Rook and Pip, taking turns clockwise.</p></section>
      <section class="rule-card"><h3>Your turn</h3><p><b>Hit</b> as many times as you want. When you're done, <b>Stop</b> to end the turn and keep your hand.</p></section>
      <section class="rule-card rule-card--accent"><h3>Banking</h3><p>Bank with <b>Bank</b> as your turn's <b>first action</b>, before you draw, and never on an empty hand. Once you draw you can't bank until a later turn.</p></section>
      <section class="rule-card"><h3>Bust &amp; Clean 7</h3><p>Repeat a number and you <b>bust</b> (0 that round, both copies shown). Get <b>7 unique numbers</b> for a <b>Clean 7</b>: the round ends, everyone still in banks, and you get <b>+15</b>.</p></section>
      <section class="rule-card"><h3>Action cards</h3><ul class="rule-list"><li><b>Freeze</b>: pick a player; they bank now and are out.</li><li><b>Flip Three</b>: pick a player; they flip three cards.</li><li><b>Second Chance</b>: eats one duplicate and saves you.</li><li><b>See the Future</b>: privately peek at the shoe's next card. The fortune expires as soon as anyone draws.</li></ul></section>
      <section class="rule-card"><h3>The shoe</h3><p>One <b>97-card</b> shoe for the whole match. It shrinks as cards are played and only reshuffles when it runs out, so counting cards pays off. Online hosts pick the match length (1-9 rounds) and the buy-in.</p></section>
    </div>
    <button class="btn btn--play" data-action="rules-back">GOT IT</button>
  </div>`;
}

function onlineError(o) {
  return o.error ? `<div class="mp-error">${o.error}</div>` : "";
}

function renderOnlineMenu(o) {
  return `
  <div class="screen screen--online">
    <div class="mp-card">
      <button class="icon-btn mp-close" data-action="mp-leave" aria-label="Back to solo">←</button>
      <div class="wordmark wordmark--sm">7<span>BUST</span></div>
      <p class="tagline">Spin up a private table and share the code. Empty seats fill with the house AI.</p>
      <label class="mp-label" for="mp-name">Your name</label>
      <input class="mp-input" id="mp-name" maxlength="12" placeholder="Player" value="${o.name || ""}" autocomplete="off" />
      ${onlineError(o)}
      <button class="btn btn--play" data-action="mp-create">CREATE A ROOM</button>
      <button class="btn btn--online" data-action="mp-join-screen">JOIN WITH A CODE</button>
    </div>
  </div>`;
}

function renderOnlineJoin(o) {
  return `
  <div class="screen screen--online">
    <div class="mp-card">
      <button class="icon-btn mp-close" data-action="mp-menu" aria-label="Back">←</button>
      <div class="wordmark wordmark--sm">JOIN</div>
      <p class="tagline">Enter the four-letter code your host shared with you.</p>
      <label class="mp-label" for="mp-name">Your name</label>
      <input class="mp-input" id="mp-name" maxlength="12" placeholder="Player" value="${o.name || ""}" autocomplete="off" />
      <label class="mp-label" for="mp-code">Room code</label>
      <input class="mp-input mp-input--code" id="mp-code" maxlength="4" placeholder="ABCD" value="${o.codeInput || ""}" autocomplete="off" spellcheck="false" />
      ${onlineError(o)}
      <button class="btn btn--play" data-action="mp-join">JOIN TABLE</button>
    </div>
  </div>`;
}

function renderOnlineConnecting(o) {
  return `
  <div class="screen screen--online">
    <div class="mp-card mp-card--center">
      <span class="spinner spinner--big"></span>
      <div class="mp-connecting">${o.error ? "" : "Connecting to the table…"}</div>
      ${onlineError(o)}
      ${o.error ? `<button class="btn btn--online" data-action="mp-leave">BACK</button>` : ""}
    </div>
  </div>`;
}

// The three AI types you can seat
// The pill shows the type's name, the seat shows the table name, a second Rook is "Knight"
const AI_PILLS = [
  { ai: "reckless", label: "Rook" },
  { ai: "cautious", label: "Nova" },
  { ai: "holder", label: "Pip" },
];

function slotRow(s, L) {
  const isYou = s.index === L.you;
  if (s.type === "human") {
    return `
    <div class="mp-seat ${isYou ? "me" : ""} ${s.connected ? "" : "gone"}">
      <span class="mp-seat-badge num">${s.index + 1}</span>
      <span class="mp-seat-name">${s.name}${s.isHost ? '<span class="mp-host">HOST</span>' : ""}${isYou ? '<span class="mp-you">YOU</span>' : ""}</span>
      <span class="mp-seat-dot ${s.connected ? "on" : ""}"></span>
    </div>`;
  }
  const label =
    s.type === "ai"
      ? `<span class="mp-seat-name">${s.name}<span class="mp-ai-tag">house AI</span></span>`
      : s.type === "open"
        ? `<span class="mp-seat-name muted-name">Waiting for a player…</span>`
        : `<span class="mp-seat-name muted-name">Seat off</span>`;
  const pills = L.isHost
    ? `<span class="slot-pills">
        <button class="spill ${s.type === "open" ? "on" : ""}" data-action="mp-slot" data-index="${s.index}" data-t="open" title="A friend can take this seat">OPEN</button>
        ${AI_PILLS.map((a) => `<button class="spill spill--ai ${s.type === "ai" && s.ai === a.ai ? "on" : ""}" data-action="mp-slot" data-index="${s.index}" data-t="ai-${a.ai}" title="Seat a ${a.label}-type AI">${a.label.toUpperCase()}</button>`).join("")}
        <button class="spill spill--off ${s.type === "empty" ? "on" : ""}" data-action="mp-slot" data-index="${s.index}" data-t="empty" title="Nobody plays this seat">OFF</button>
      </span>`
    : "";
  return `
  <div class="mp-seat cfg ${s.type === "empty" ? "off" : ""}">
    <span class="mp-seat-badge num">${s.index + 1}</span>
    ${label}
    ${pills}
  </div>`;
}

function renderOnlineWaiting(o, view) {
  const L = o.lobby;
  const entry = L.entry || 0;
  const rounds = L.rounds || 9;
  const balance = view.soloBalance || 0;
  const rows = L.slots.map((s) => slotRow(s, L)).join("");
  const sizes = L.isHost
    ? `<div class="mp-sizerow"><span class="mp-label">Table size</span><span class="slot-pills">${[3, 4, 5, 6, 7, 8]
        .map((n) => `<button class="spill ${n === L.size ? "on" : ""}" data-action="mp-size" data-size="${n}">${n}</button>`)
        .join("")}</span></div>
      <div class="mp-sizerow"><span class="mp-label">Buy-in</span><span class="slot-pills">${[0, 50, 100, 250]
        .map((f) => `<button class="spill ${f === entry ? "on" : ""}" data-action="mp-entry" data-fee="${f}">${f === 0 ? "FREE" : f}</button>`)
        .join("")}</span></div>
      <div class="mp-sizerow"><span class="mp-label">Rounds</span><span class="slot-pills">${[1, 2, 3, 4, 5, 6, 7, 8, 9]
        .map((r) => `<button class="spill ${r === rounds ? "on" : ""}" data-action="mp-rounds" data-r="${r}">${r}</button>`)
        .join("")}</span></div>`
    : "";
  const stakes =
    entry > 0
      ? `Buy-in <b class="num">${entry}</b> chips each · you have <b class="num">${balance.toLocaleString()}</b>${balance < entry ? ' <span class="mp-warn">not enough chips!</span>' : ""} · winner takes the pot · <b class="num">${rounds}</b> round${rounds === 1 ? "" : "s"}`
      : `Friendly game, no chips at stake · <b class="num">${rounds}</b> round${rounds === 1 ? "" : "s"}`;
  const canDeal = L.filled >= 2;
  const startBtn = L.isHost
    ? `<button class="btn btn--play" data-action="mp-start" ${canDeal ? "" : "disabled"}>START GAME<span class="sub">${L.filled} of ${L.size} seats playing${canDeal ? "" : ", seat a friend or an AI"}</span></button>`
    : `<div class="wait-host">Waiting for the host to start…</div>`;
  return `
  <div class="screen screen--online">
    <div class="mp-card mp-card--wide">
      <button class="icon-btn mp-close" data-action="mp-leave" aria-label="Leave room">←</button>
      <div class="mp-codehead">
        <span class="mp-label">Room code</span>
        <div class="mp-code num">${L.code}</div>
        <button class="link mp-copy" data-action="mp-copy">Copy invite link</button>
      </div>
      ${sizes}
      <div class="mp-stakes">${stakes}</div>
      <div class="mp-seats">
        <div class="mp-label">At the table</div>
        ${rows}
      </div>
      ${onlineError(o)}
      ${startBtn}
    </div>
  </div>`;
}

function renderOnlineDealing() {
  return `
  <div class="screen screen--online">
    <div class="mp-card mp-card--center">
      <span class="spinner spinner--big"></span>
      <div class="mp-connecting">Dealing you in…</div>
    </div>
  </div>`;
}

export function renderOnline(view) {
  const o = view.online;
  if (o.screen === "join") return renderOnlineJoin(o);
  if (o.screen === "connecting") return renderOnlineConnecting(o);
  if (o.screen === "waiting" && o.lobby) return renderOnlineWaiting(o, view);
  return renderOnlineMenu(o);
}

export function renderApp(view) {
  if (view.showHistory) return `<div class="stage">${renderHistory(view)}</div>`;
  if (view.showRules) return `<div class="stage">${renderRules()}</div>`;
  if (view.mode === "online" && view.online) {
    const o = view.online;
    // The live table only shows once a real snapshot arrives
    const playing = o.screen === "playing" && view.snapshot && view.snapshot.cashless;
    if (!playing) {
      const scr = o.screen === "playing" ? renderOnlineDealing() : renderOnline(view);
      return `<div class="stage">${scr}${renderToast(view)}</div>`;
    }
    const confirm = view.confirmExit ? renderExitConfirm(view) : "";
    return `<div class="stage">${renderMatch(view)}${renderOverlay(view)}${confirm}${renderToast(view)}</div>`;
  }
  const inMatch = view.snapshot.phase !== "lobby";
  const screen = inMatch ? renderMatch(view) : renderLobby(view);
  const overlay = inMatch ? renderOverlay(view) : "";
  const confirm = inMatch && view.confirmExit ? renderExitConfirm(view) : "";
  return `<div class="stage">${screen}${overlay}${confirm}${renderToast(view)}</div>`;
}
