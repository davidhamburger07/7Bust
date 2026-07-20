// Draws the casino table from snapshots, never changes the game state

import { heatTriple } from "./heat.js";
import { PLAYER_EMOTES } from "../engine/aiChatter.js";
import { WHEEL, DAILY_BONUS } from "../engine/rewards.js";

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

function deckPile(s) {
  const layers = Math.max(2, Math.round((s.shoe.remaining / s.shoe.size) * 8));
  const sh = [];
  for (let i = 1; i <= layers; i++) sh.push(`${(i * 1.5).toFixed(1)}px ${(i * 1.5).toFixed(1)}px 0 -1px #2a1a0c`);
  sh.push("var(--shadow-card)");
  return `
  <div class="shoe">
    <div class="shoe-pile" style="box-shadow:${sh.join(",")}"></div>
    <div class="shoe-labels">
      <span>Deck <b class="num">${s.shoe.remaining}</b></span>
      <span class="muted">out <b class="num">${s.shoe.discard}</b></span>
    </div>
  </div>`;
}

const aiTag = (p) => (p.isAI ? '<span class="ai-chip">AI</span>' : "");

// Turns go clockwise, skipping anyone who banked, busted or is frozen
function upNext(s) {
  if (s.phase !== "round") return -1;
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const cand = (s.actingSeat + i) % n;
    if (s.players[cand].turnState === "active") return cand;
  }
  return -1;
}

function seat(p, newSeat, nextSeat) {
  const sc = p.secondChance ? " has-sc" : "";
  const isNext = p.seat === nextSeat && !p.isCurrent;
  return `
  <div class="seat ${p.isCurrent ? "current" : ""}${isNext ? " next" : ""} ${p.turnState}${sc}" data-seat="${p.seat}">
    <div class="seat-top"><span class="seat-name">${p.name}${aiTag(p)}${dealerChip(p)}</span>${isNext ? '<span class="badge badge--next">NEXT</span>' : badge(p.turnState)}</div>
    <div class="seat-hand">${handCards(p, { mini: true, newSeat })}${p.secondChance ? '<span class="sc-dot">2nd</span>' : ""}</div>
    <div class="seat-foot"><span class="seat-hand-score num">${handScoreText(p)}</span><span class="seat-total">total ${p.totalScore}</span></div>
  </div>`;
}

function youSeat(p, view, nextSeat) {
  const newSeat = view.lastEvent ? view.lastEvent.seat : -1;
  const pips = Array.from({ length: TARGET }, (_, i) => `<span class="pip ${i < p.uniqueCount ? "on" : ""}"></span>`).join("");
  const sc = p.secondChance ? " has-sc" : "";
  const isNext = p.seat === nextSeat && !p.isCurrent;
  return `
  <div class="you-seat ${p.isCurrent ? "current" : ""}${isNext ? " next" : ""} ${p.turnState}${sc}" data-seat="${p.seat}">
    <div class="you-top">
      <span class="you-name">YOU${view.snapshot && view.snapshot.yourHands > 1 ? `<span class="hand-ix">HAND ${(view.snapshot.yourSeats || []).indexOf(p.seat) + 1}/${view.snapshot.yourHands}</span>` : ""}${dealerChip(p)} ${isNext ? '<span class="badge badge--next">YOU\'RE NEXT</span>' : badge(p.turnState)}</span>
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

function pauseBanner(view) {
  const p = view.pause;
  if (!p) return "";
  if (p.until > Date.now()) {
    const canResume = (view.online && view.online.lobby && view.online.lobby.isHost) || view.pauseUsed;
    return `<div class="pausebar">⏸ PAUSED, back in <b class="num" data-pauseleft>2:00</b>${canResume ? ' <button class="spill on" data-action="resume">RESUME NOW</button>' : ""}</div>`;
  }
  if (p.vote) {
    return `<div class="pausebar vote">🗳 <b>${p.vote.name}</b> asks for a 2-min pause (${p.vote.yes}/${p.vote.needed} yes)
      <button class="spill on" data-action="pvote-yes">YES</button>
      <button class="spill spill--off" data-action="pvote-no">NO</button></div>`;
  }
  return "";
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
  const nextSeat = upNext(s);
  const nextNote =
    nextSeat === s.you && a !== s.you
      ? ' <b class="next-note">· you\'re up next!</b>'
      : nextSeat >= 0 && nextSeat !== a
        ? ` <span class="next-note muted-note">· then ${nextSeat === s.you ? "you" : s.players[nextSeat].name}</span>`
        : "";
  return `<div class="dock-wait"><span class="spinner"></span>${who}…${nextNote}</div>`;
}

function leaderPanel(s) {
  const rows = s.standings
    .map((st, i) => {
      const p = s.players[st.seat];
      const medal = ["gold", "silver", "bronze"][i] || "";
      return `
      <div class="lb-row ${st.seat === s.you ? "you" : ""}">
        <span class="lb-rank ${medal} num">${i + 1}</span>
        <span class="lb-name">${st.seat === s.you ? "You" : st.name}${aiTag(p)}${i === 0 && st.totalScore > 0 ? " 👑" : ""}</span>
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

export function chatLines(list) {
  const lines = (list || [])
    .map((c) => `<div class="chatline${c.ai ? " ai" : ""}"><b>${c.name}</b> ${c.text}</div>`)
    .join("");
  return lines || '<div class="chatline muted-chat">Say hi to the table…</div>';
}

function chatPanel(view) {
  const emotes = PLAYER_EMOTES.map((e) => `<button class="emote-btn" data-action="emote" data-e="${e}" aria-label="Send ${e}">${e}</button>`).join("");
  return `
  <div class="chatpanel" id="chatpanel">
    <div class="logpanel-title">All chat</div>
    <div class="chatlist" id="chatlist">${chatLines(view.chat)}</div>
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

function freeChips(view) {
  const daily = view.dailyAvailable
    ? `<button class="btn btn--daily" data-action="daily">DAILY BONUS<span class="sub">+${DAILY_BONUS} free chips</span></button>`
    : `<div class="daily-done">✓ Daily bonus claimed, come back tomorrow</div>`;
  const ad = view.adPending
    ? `<button class="btn btn--ad" disabled>LOADING AD…<span class="sub">hang tight</span></button>`
    : `<button class="btn btn--ad" data-action="watch-ad">FREE CHIPS<span class="sub">📺 watch an ad &amp; spin the wheel</span></button>`;
  return `<div class="freechips">${daily}${ad}</div>`;
}

// Prize wheel with weighted slices, spins to the winner then shows the prize
export function renderWheel(view) {
  const w = view.wheel;
  if (!w) return "";
  const n = WHEEL.length;
  const slice = 360 / n;
  // Lands the winning slice under the pointer after a few full spins
  const target = 360 * 5 - (w.index * slice + slice / 2);
  const labels = WHEEL.map((seg, i) => {
    const jackpot = seg.amount === Math.max(...WHEEL.map((x) => x.amount));
    return `<div class="wheel-label${jackpot ? " jackpot" : ""}" style="transform:rotate(${i * slice + slice / 2}deg)"><span>${seg.amount}</span></div>`;
  }).join("");
  const spinning = w.phase === "spin";
  // Spinning uses a keyframe since the wheel is rebuilt each render
  // Once done it's drawn at the landed angle so it doesn't jump
  const wheelEl = spinning
    ? `<div class="wheel spinning" style="--spin:${target}deg"><div class="wheel-face">${labels}</div></div>`
    : `<div class="wheel" style="transform:rotate(${target}deg)"><div class="wheel-face">${labels}</div></div>`;
  return `
  <div class="overlay wheel-overlay">
    <div class="wheel-box">
      <div class="wheel-title">${w.phase === "done" ? (w.amount >= 2500 ? "JACKPOT!" : "YOU WON!") : "SPIN THE WHEEL"}</div>
      <div class="wheel-wrap">
        <div class="wheel-pointer"></div>
        ${wheelEl}
        <div class="wheel-hub"></div>
      </div>
      ${w.phase === "done" ? `<div class="wheel-result">+<b class="num">${w.amount}</b> chips</div><button class="btn btn--play" data-action="wheel-collect">COLLECT</button>` : `<div class="wheel-spinmsg">Good luck…</div>`}
    </div>
  </div>`;
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
    <button class="icon-btn lobby-gear" data-action="settings" aria-label="Settings" title="Settings">⚙</button>
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
      ${freeChips(view)}
      <div class="lobby-foot">
        <a class="link" href="#" data-action="rules">How to play</a><span>·</span>
        <a class="link" href="#" data-action="history">Match history</a><span>·</span>
        <a class="link" href="#" data-action="verify">Verify fair</a><span>·</span>
        <a class="link" href="#" data-action="settings">Settings</a>
      </div>
    </div>
  </div>`;
}

export function renderMatch(view) {
  const s = view.snapshot;
  const online = view.mode === "online" && view.online && view.online.lobby ? view.online.lobby : null;
  const me = s.players[s.you];
  const newSeat = s.lastEvent ? s.lastEvent.seat : -1;
  const nextSeat = upNext(s);
  const opps = s.players.filter((p) => p.seat !== s.you).map((p) => seat(p, newSeat, nextSeat)).join("");
  return `
  <div class="screen screen--match${s.players.length >= 5 ? " crowded" : ""}">
    <div class="matchbar">
      <span class="round-pill">Round <b class="num">${s.round.number}</b>/<span class="num">${s.round.total}</span></span>
      <span class="dealer-note">${s.players[s.dealer].name} deals</span>
      <span class="bar-right">
        <span class="balance-chip">${chipStack(s.wallet ? s.wallet.balance : view.soloBalance || 0)}</span>
        ${online ? `<span class="room-chip">ROOM <b>${online.code}</b></span>` : ""}
        <span class="clock">◔ <span class="num" data-clock>${view.clockText || "00:00"}</span></span>
        ${view.mode === "online" && !view.pauseUsed ? `<button class="icon-btn" data-action="pause" aria-label="Ask for a pause" title="Ask for a 2-minute pause">⏸</button>` : ""}
        <button class="icon-btn" data-action="rules" aria-label="How to play">?</button>
        <button class="exit-btn" data-action="exit" aria-label="Exit to the main menu">EXIT</button>
      </span>
    </div>

    ${leaderPanel(s)}

    <div class="felt">
      <div class="felt-spot"></div>
      ${arc()}
      ${pauseBanner(view)}
      <div class="opponents">${opps}</div>
      <div class="dealer-zone">${deckPile(s)}${s.tournament ? `<div class="pot-chip">POT <b class="num">${s.tournament.pot}</b> · pays <b class="num">${s.tournament.prizePool}</b></div>` : ""}</div>
      ${youSeat(me, view, nextSeat)}
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
      ${canAgain ? "" : `<button class="btn btn--ad" data-action="watch-ad">FREE CHIPS<span class="sub">📺 watch an ad &amp; spin</span></button>`}
      <div>${view.dailyAvailable ? '<a class="ghost link" href="#" data-action="daily">Claim daily bonus</a> · ' : ""}<a class="ghost link" href="#" data-action="verify">Verify fair</a></div>
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

// Small example cards for the rules screen
const rc = (v, dup = false) => `<div class="card card--mini rules-card${dup ? " card--dup" : ""}"><span class="face">${v}</span></div>`;
const rmod = (t) => `<div class="modcard modcard--mini">${t}</div>`;
const ract = (t, cls) => `<div class="rules-act ract--${cls}">${t}</div>`;

export function renderRules() {
  return `
  <div class="screen screen--rules">
    <div class="rules-top"><button class="icon-btn" data-action="rules-back" aria-label="Back">←</button><span class="rules-title">How to play</span></div>
    <div class="rules-scroll">
      <section class="rule-card"><h3>Goal</h3>
        <div class="rules-demo">${rc(3)}${rc(7)}${rc(12)}${rmod("+4")}<span class="rules-eq num">= 26</span></div>
        <p>Draw number cards to build a hand, its score is the sum plus any modifiers. Highest total after all rounds wins the pot. Turns go clockwise.</p></section>
      <section class="rule-card"><h3>Your turn</h3><p><b>HIT</b> as many times as you want. When you're done, <b>STOP</b> to end the turn and keep your hand for later.</p></section>
      <section class="rule-card rule-card--accent"><h3>Banking</h3><p>Bank with <b>BANK</b> as your turn's <b>first action</b>, before you draw, and never on an empty hand. Once you draw you can't bank until a later turn, the hand stays exposed on the felt.</p></section>
      <section class="rule-card"><h3>Bust</h3>
        <div class="rules-demo">${rc(4)}${rc(9)}${rc(8)}${rc(8, true)}<span class="rules-eq bust-eq">BUST!</span></div>
        <p>Repeat a number and you <b>bust</b>: the whole hand scores 0 this round.</p></section>
      <section class="rule-card"><h3>Clean 7</h3>
        <div class="rules-demo">${rc(1)}${rc(3)}${rc(5)}${rc(7)}${rc(9)}${rc(11)}${rc(12)}<span class="rules-eq gold-eq">+15</span></div>
        <p><b>7 unique numbers</b> ends the whole round: everyone still in banks, and you pocket a <b>+15</b> bonus.</p></section>
      <section class="rule-card"><h3>Action cards</h3>
        <div class="rules-demo">${ract("FRZ", "freeze")}${ract("+3", "flip3")}${ract("2ND", "second")}${ract("👁", "future")}</div>
        <ul class="rule-list"><li><b>Freeze</b>: pick a player; they bank now and are out of the round.</li><li><b>Flip Three</b>: pick a player; they must flip three cards.</li><li><b>Second Chance</b>: eats one duplicate and saves you from a bust.</li><li><b>See the Future</b>: privately peek at the deck's next card. The fortune expires as soon as anyone draws.</li></ul></section>
      <section class="rule-card"><h3>Modifiers</h3>
        <div class="rules-demo">${rmod("+2")}${rmod("+4")}${rmod("+6")}${rmod("+8")}${rmod("+10")}${rmod("×2")}</div>
        <p>Bonus cards that boost a banked hand: <b>+X</b> adds points, <b>×2</b> doubles your number sum. They can't bust you.</p></section>
      <section class="rule-card"><h3>The deck</h3><p>One <b>97-card</b> deck for the whole match. It shrinks as cards are played and only reshuffles when it runs out, counting cards pays off. Online hosts pick the match length (1-9 rounds), the buy-in, multi-hand play and the disconnect rule.</p></section>
    </div>
    <button class="btn btn--play" data-action="rules-back">GOT IT</button>
  </div>`;
}

const prefPills = (k, on) => `
  <span class="slot-pills">
    <button class="spill ${on ? "on" : ""}" data-action="set-pref" data-k="${k}" data-v="1">ON</button>
    <button class="spill spill--off ${on ? "" : "on"}" data-action="set-pref" data-k="${k}" data-v="0">OFF</button>
  </span>`;

export function renderSettings(view) {
  const s = view.settings || { sfx: true, voice: true };
  return `
  <div class="screen screen--rules">
    <div class="rules-top"><button class="icon-btn" data-action="settings-back" aria-label="Back">←</button><span class="rules-title">Settings</span></div>
    <div class="rules-scroll hist-scroll">
      <section class="rule-card"><h3>Player</h3>
        <div class="set-row"><span class="mp-label">Display name <small class="mp-hint">used when you create or join a room</small></span>
          <input class="mp-input set-input" id="set-name" maxlength="12" placeholder="Player" value="${escAttr(view.settingsName || "")}" autocomplete="off" /></div>
      </section>
      <section class="rule-card"><h3>Sound</h3>
        <div class="set-row"><span class="mp-label">Sound effects</span>${prefPills("sfx", s.sfx)}</div>
        <div class="set-row"><span class="mp-label">Announcer voice</span>${prefPills("voice", s.voice)}</div>
        <div class="set-row"><span class="mp-label">Music volume <small class="mp-hint">7BUST FM</small></span>
          <input class="set-vol" id="set-vol" type="range" min="0" max="100" value="${Number(view.settingsVol ?? 35)}" aria-label="Music volume" /></div>
      </section>
      <section class="rule-card"><h3>Chips</h3>
        <div class="set-row"><span class="mp-label">Your balance</span><span class="balance">${chipStack(view.soloBalance || 0)}</span></div>
        <div class="set-row"><span class="mp-label">Low on chips? Claim your daily bonus or watch an ad on the menu for more.</span></div>
      </section>
      <section class="rule-card"><h3>More</h3>
        <div class="set-links">
          <a class="link" href="#" data-action="rules">How to play</a>
          <a class="link" href="#" data-action="history">Match history</a>
          <a class="link" href="#" data-action="tos">Terms of Service</a>
          <a class="link" href="#" data-action="verify">Verify fairness</a>
        </div>
      </section>
    </div>
    <button class="btn btn--play" data-action="settings-back">DONE</button>
  </div>`;
}

export function renderTos() {
  return `
  <div class="screen screen--rules tos">
    <div class="rules-top"><span class="rules-title">Terms of Service</span></div>
    <div class="rules-scroll hist-scroll tos-scroll">
      <section class="rule-card"><h3>1. What 7Bust is</h3><p>7Bust is a free entertainment product. All chips, buy-ins, pots and payouts are <b>simulated play money</b> with no cash value. Nothing here is gambling, and nothing you win or lose can be exchanged for anything, anywhere, ever.</p></section>
      <section class="rule-card"><h3>2. Your connection is your job</h3><p><b>You are responsible for your own internet connection and device.</b> If you disconnect, lag, close the tab, run out of battery or lose signal, the game continues under the table rules: after one minute offline your seat is taken over by the house AI or retired, as configured by the host, and any simulated buy-in stays in the pot. That is not a bug, a theft or grounds for complaint. It is the rule you are agreeing to right now.</p></section>
      <section class="rule-card"><h3>3. Fair play</h3><p>The shuffle is provably fair (a committed seed you can verify after each match). Do not exploit bugs, automate play, harass players in chat, or impersonate others. We may remove any room or player to keep tables pleasant.</p></section>
      <section class="rule-card"><h3>4. Chat and conduct</h3><p>You are responsible for what you type. Chat is visible to everyone at the table and is not moderated in real time. Be a decent human. The block on rude words is your own upbringing.</p></section>
      <section class="rule-card"><h3>5. No warranty</h3><p>7Bust is provided <b>"as is"</b> with no warranty of any kind. We do not promise the service will be available, uninterrupted, bug-free, or that your chips, match history or rooms will persist. Servers restart, rooms expire, and saves may be reset by updates.</p></section>
      <section class="rule-card"><h3>6. Limitation of liability</h3><p>To the fullest extent allowed by law, the makers of 7Bust are not liable for any damages arising from your use of the game, including lost simulated chips, lost matches, disconnections, hurt feelings from an AI trash-talking you, or anything else. Your only remedy is to stop playing.</p></section>
      <section class="rule-card"><h3>7. Changes</h3><p>These terms can change with any update. Continuing to play after a change means you accept the new terms.</p></section>
      <section class="rule-card rule-card--accent"><h3>8. Acceptance</h3><p>By pressing ACCEPT you confirm you have read these terms, you agree to them, and you are old enough to make that call wherever you live.</p></section>
    </div>
    <button class="btn btn--play" data-action="tos-accept">ACCEPT &amp; PLAY</button>
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
      <button class="btn btn--online" data-action="mp-browse">FIND A MATCH<span class="sub">browse public tables</span></button>
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
  { ai: "rook", label: "Rook" },
  { ai: "nova", label: "Nova" },
  { ai: "pip", label: "Pip" },
];

function slotRow(s, L) {
  const isYou = s.index === L.you;
  if (s.type === "human") {
    const kick = L.isHost && !s.isHost ? `<button class="kick-btn" data-action="mp-kick" data-index="${s.index}" title="Kick ${s.name} from the room" aria-label="Kick ${s.name}">✕</button>` : "";
    return `
    <div class="mp-seat ${isYou ? "me" : ""} ${s.connected ? "" : "gone"}">
      <span class="mp-seat-badge num">${s.index + 1}</span>
      <span class="mp-seat-name">${s.name}${s.isHost ? '<span class="mp-host">HOST</span>' : ""}${isYou ? '<span class="mp-you">YOU</span>' : ""}</span>
      <span class="mp-seat-dot ${s.connected ? "on" : ""}"></span>
      ${kick}
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
        .join("")}</span></div>
      <div class="mp-sizerow"><span class="mp-label">Visibility <small class="mp-hint">public tables show in Find a Match</small></span><span class="slot-pills">
        <button class="spill ${!L.isPublic ? "on" : ""}" data-action="mp-public" data-on="0">PRIVATE</button>
        <button class="spill ${L.isPublic ? "on" : ""}" data-action="mp-public" data-on="1">PUBLIC</button></span></div>
      <div class="mp-sizerow"><span class="mp-label">Multi-hand <small class="mp-hint">players may buy several hands</small></span><span class="slot-pills">
        <button class="spill ${!L.multiHand ? "on" : ""}" data-action="mp-multi" data-on="0">OFF</button>
        <button class="spill ${L.multiHand ? "on" : ""}" data-action="mp-multi" data-on="1">ON</button></span></div>
      <div class="mp-sizerow"><span class="mp-label">If someone disconnects 1 min <small class="mp-hint">their buy-in stays in the pot</small></span><span class="slot-pills">
        <button class="spill ${(L.dropRule || "ai") === "ai" ? "on" : ""}" data-action="mp-drop" data-rule="ai" title="The house AI plays their hand on">AI PLAYS ON</button>
        <button class="spill spill--off ${L.dropRule === "kick" ? "on" : ""}" data-action="mp-drop" data-rule="kick" title="Their seat banks and sits out; they can't rejoin">SEAT IS OUT</button></span></div>`
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

const BROWSE_FILTERS = [
  { key: "seats", label: "Seats", opts: [["any", "ANY"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["7", "7"], ["8", "8"]] },
  { key: "entry", label: "Buy-in", opts: [["any", "ANY"], ["0", "FREE"], ["50", "50"], ["100", "100"], ["250", "250"]] },
  { key: "rounds", label: "Rounds", opts: [["any", "ANY"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["7", "7"], ["8", "8"], ["9", "9"]] },
  { key: "multi", label: "Multi-hand", opts: [["any", "ANY"], ["off", "OFF"], ["on", "ON"]] },
];

export function filterRooms(list, f) {
  return (list || []).filter((r) => {
    if (f.seats !== "any" && r.size !== Number(f.seats)) return false;
    if (f.entry !== "any" && (r.entry || 0) !== Number(f.entry)) return false;
    if (f.rounds !== "any" && r.rounds !== Number(f.rounds)) return false;
    if (f.multi !== "any" && !!r.multiHand !== (f.multi === "on")) return false;
    if (f.joinable && r.openSeats <= 0) return false;
    return true;
  });
}

function renderOnlineBrowse(o, view) {
  const b = view.browse || { list: [], filters: { seats: "any", entry: "any", rounds: "any", multi: "any", joinable: true } };
  const f = b.filters;
  const filterRows = BROWSE_FILTERS.map(
    (row) => `<div class="mp-sizerow"><span class="mp-label">${row.label}</span><span class="slot-pills">${row.opts
      .map(([v, lab]) => `<button class="spill ${String(f[row.key]) === v ? "on" : ""}" data-action="browse-filter" data-k="${row.key}" data-v="${v}">${lab}</button>`)
      .join("")}</span></div>`
  ).join("");
  const joinableRow = `<div class="mp-sizerow"><span class="mp-label">Show full tables</span><span class="slot-pills">
      <button class="spill ${f.joinable ? "on" : ""}" data-action="browse-filter" data-k="joinable" data-v="1">HIDE</button>
      <button class="spill ${f.joinable ? "" : "on"}" data-action="browse-filter" data-k="joinable" data-v="0">SHOW</button></span></div>`;
  const rooms = filterRooms(b.list, f);
  const rows = rooms
    .map((r) => {
      const full = r.openSeats <= 0;
      return `
      <div class="browse-row${full ? " full" : ""}">
        <span class="browse-host">${r.host}<span class="browse-code num">${r.code}</span></span>
        <span class="browse-tags">
          <span class="btag">${r.filled}/${r.size} seats</span>
          <span class="btag">${r.rounds} rd${r.rounds === 1 ? "" : "s"}</span>
          <span class="btag ${r.entry > 0 ? "paid" : ""}">${r.entry > 0 ? `${r.entry} buy-in` : "FREE"}</span>
          ${r.multiHand ? '<span class="btag multi">MULTI-HAND</span>' : ""}
        </span>
        ${full ? '<span class="browse-full">FULL</span>' : `<button class="spill on browse-join" data-action="mp-join-listed" data-code="${r.code}">JOIN</button>`}
      </div>`;
    })
    .join("");
  const empty = b.loading && !b.list.length ? `<div class="browse-empty"><span class="spinner"></span> Looking for tables…</div>` : `<div class="browse-empty">No public matches match your filters.<br /><small>Host one and flip it to PUBLIC so others can join.</small></div>`;
  return `
  <div class="screen screen--online">
    <div class="mp-card mp-card--wide">
      <button class="icon-btn mp-close" data-action="mp-menu" aria-label="Back">←</button>
      <div class="wordmark wordmark--sm">FIND A MATCH</div>
      <label class="mp-label" for="mp-name">Your name</label>
      <input class="mp-input" id="mp-name" maxlength="12" placeholder="Player" value="${escAttr(o.name || "")}" autocomplete="off" />
      <div class="browse-filters">${filterRows}${joinableRow}</div>
      <div class="browse-head">
        <span class="mp-label">${rooms.length} table${rooms.length === 1 ? "" : "s"} open</span>
        <button class="link" data-action="mp-browse-refresh">${b.loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      <div class="browse-list">${rows || empty}</div>
      ${onlineError(o)}
    </div>
  </div>`;
}

// After the host starts a multi hand game, everyone picks how many hands to play
function renderOnlineBuyin(o, view) {
  const b = o.buyin || { fee: 0, picks: [] };
  const max = Math.max(1, o.maxHands || 1);
  const mine = o.myHands;
  const fee = b.fee || 0;
  const pills = Array.from({ length: max }, (_, i) => i + 1)
    .map((n) => `<button class="spill ${mine === n ? "on" : ""}" data-action="mp-hands" data-n="${n}">${n}</button>`)
    .join("");
  const picks = (b.picks || [])
    .map(
      (p) => `<div class="mp-seat"><span class="mp-seat-name">${p.name}</span>
        <span class="${p.hands != null ? "pick-done" : "muted-name"}">${p.hands != null ? `${p.hands} hand${p.hands === 1 ? "" : "s"}` : "choosing…"}</span></div>`
    )
    .join("");
  const isHost = o.lobby && o.lobby.isHost;
  return `
  <div class="screen screen--online">
    <div class="mp-card">
      <div class="wordmark wordmark--sm">BUY IN</div>
      <p class="tagline">How many hands will you play? Each hand is its own seat${fee > 0 ? ` and its own <b>${fee}-chip</b> buy-in` : ""}.</p>
      <div class="mp-sizerow"><span class="mp-label">Your hands</span><span class="slot-pills">${pills}</span></div>
      ${fee > 0 && mine ? `<div class="mp-stakes">Total buy-in: <b class="num">${fee * mine}</b> chips · you have <b class="num">${(view.soloBalance || 0).toLocaleString()}</b></div>` : ""}
      <div class="mp-seats">
        <div class="mp-label">The table</div>
        ${picks}
      </div>
      ${isHost ? `<button class="btn btn--online" data-action="mp-dealnow">DEAL NOW<span class="sub">anyone undecided plays 1 hand</span></button>` : `<div class="wait-host">Dealing as soon as everyone picks…</div>`}
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
  if (o.screen === "browse") return renderOnlineBrowse(o, view);
  if (o.screen === "connecting") return renderOnlineConnecting(o);
  if (o.screen === "buyin") return renderOnlineBuyin(o, view);
  if (o.screen === "waiting" && o.lobby) return renderOnlineWaiting(o, view);
  return renderOnlineMenu(o);
}

export function renderApp(view) {
  if (view.showTos) return `<div class="stage">${renderTos()}</div>`;
  if (view.showSettings) return `<div class="stage">${renderSettings(view)}${renderWheel(view)}</div>`;
  if (view.showHistory) return `<div class="stage">${renderHistory(view)}</div>`;
  if (view.showRules) return `<div class="stage">${renderRules()}</div>`;
  const wheel = renderWheel(view); // The prize wheel shows over any screen
  if (view.mode === "online" && view.online) {
    const o = view.online;
    // The live table only shows once a real snapshot arrives
    const playing = o.screen === "playing" && view.snapshot && view.snapshot.cashless;
    if (!playing) {
      const scr = o.screen === "playing" ? renderOnlineDealing() : renderOnline(view);
      return `<div class="stage">${scr}${wheel}${renderToast(view)}</div>`;
    }
    const confirm = view.confirmExit ? renderExitConfirm(view) : "";
    return `<div class="stage">${renderMatch(view)}${renderOverlay(view)}${confirm}${wheel}${renderToast(view)}</div>`;
  }
  const inMatch = view.snapshot.phase !== "lobby";
  const screen = inMatch ? renderMatch(view) : renderLobby(view);
  const overlay = inMatch ? renderOverlay(view) : "";
  const confirm = inMatch && view.confirmExit ? renderExitConfirm(view) : "";
  return `<div class="stage">${screen}${overlay}${confirm}${wheel}${renderToast(view)}</div>`;
}
