// Two boards because the two currencies must never look alike
// Single player is practice chips in this browser against AI, multiplayer is real server chips

import { ARENAS } from "../engine/arenas.js";
import { pveChipStack } from "./arenaSelect.js";

const money = (n) => Math.round(n).toLocaleString("en-US");

// A house player's stats come from their name, so the board is the same every visit
function hashName(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// The regulars' winnings grow with their room, they climbed the same ladder you're on
function houseField() {
  const rows = [];
  for (const arena of ARENAS) {
    arena.regulars.forEach((name, i) => {
      const r = hashName(name + arena.id);
      // Starts from the room's unlock amount, so a player who just got there
      // has some regulars ahead and some behind
      const base = Math.max(arena.unlockAt, arena.buyIn * 40);
      rows.push({
        name,
        isAI: true,
        arena,
        winnings: Math.round(base * (0.6 + r * 2.4)),
        hands: 200 + Math.floor(r * 4000),
      });
    });
  }
  return rows;
}

// Ranked by the highest room opened, then by winnings
function pveBoard(view) {
  const p = view.pve;
  const you = {
    name: "You",
    isYou: true,
    arena: p.highest,
    winnings: p.winnings,
    hands: p.hands,
  };
  const rows = [...houseField(), you].sort((a, b) => b.arena.tier - a.arena.tier || b.winnings - a.winnings);
  const yourIx = rows.findIndex((r) => r.isYou);
  const yourRank = yourIx + 1;

  // Shows the top of the board then a few rows around you
  // so a new player sees themselves without scrolling
  const TOP = 5;
  const AROUND = 3;
  const keep = new Set();
  for (let i = 0; i < Math.min(TOP, rows.length); i++) keep.add(i);
  for (let i = Math.max(0, yourIx - AROUND); i <= Math.min(rows.length - 1, yourIx + AROUND); i++) keep.add(i);

  const line = (r, i) => `
      <div class="lb-row${r.isYou ? " is-you" : ""}">
        <span class="lb-rank num">${i + 1}</span>
        <span class="lb-name">${r.name}${r.isAI ? '<span class="lb-ai" title="A house player, not a person">HOUSE AI</span>' : ""}</span>
        <span class="lb-arena" style="--lb-accent:${r.arena.theme["--ar-accent"]}">
          <i class="lb-dot"></i>${r.arena.name}
        </span>
        <span class="lb-figure num">${money(r.winnings)}</span>
        <span class="lb-hands num">${money(r.hands)}</span>
      </div>`;

  let list = "";
  let skipped = 0;
  rows.forEach((r, i) => {
    if (!keep.has(i)) {
      skipped += 1;
      return;
    }
    if (skipped) {
      list += `<div class="lb-gap"><span>${skipped} more house player${skipped === 1 ? "" : "s"}</span></div>`;
      skipped = 0;
    }
    list += line(r, i);
  });

  return `
  <div class="lb-panel lb-panel--pve">
    <div class="lb-mine">
      <div class="lb-mine-cell">
        <span class="lb-k">Your rank</span>
        <b class="lb-v num">#${yourRank}</b>
      </div>
      <div class="lb-mine-cell">
        <span class="lb-k">Highest room</span>
        <b class="lb-v">${p.highest.name}</b>
      </div>
      <div class="lb-mine-cell">
        <span class="lb-k">Career winnings</span>
        <b class="lb-v num">${money(p.winnings)}</b>
      </div>
      <div class="lb-mine-cell">
        <span class="lb-k">Peak net worth</span>
        <b class="lb-v num">${money(p.peak)}</b>
      </div>
    </div>
    <p class="lb-note">Ranked by the highest room you have opened, then by career winnings. Every other name here is a house player the game deals you, they are AI, and their records are the house's own.</p>
    <div class="lb-head lb-row">
      <span class="lb-rank">#</span><span class="lb-name">Player</span><span class="lb-arena">Highest room</span>
      <span class="lb-figure">Career won</span><span class="lb-hands">Hands</span>
    </div>
    <div class="lb-list">${list}</div>
  </div>`;
}

function pvpBoard(view) {
  const w = view.pvpWeek || { net: 0, won: 0, lost: 0, matches: 0, best: 0, rows: [] };
  const rows = w.rows.length
    ? w.rows
        .map(
          (m) => `
      <div class="lb-row lb-row--match${m.youWon ? " is-win" : ""}">
        <span class="lb-when">${m.when}</span>
        <span class="lb-name">Room ${m.room || "-"}</span>
        <span class="lb-arena">${m.winner === "You" ? "You took it" : `${m.winner} took it`}</span>
        <span class="lb-figure num ${m.net >= 0 ? "pos" : "neg"}">${m.net >= 0 ? "+" : ""}${money(m.net)}</span>
        <span class="lb-hands num">${m.seats}</span>
      </div>`
        )
        .join("")
    : `<p class="lb-empty">No chip games online in the last seven days. Buy-in tables are where this board fills up.</p>`;

  return `
  <div class="lb-panel lb-panel--pvp">
    <div class="lb-mine lb-mine--pvp">
      <div class="lb-mine-cell">
        <span class="lb-k">This week's net</span>
        <b class="lb-v num ${w.net >= 0 ? "pos" : "neg"}">${w.net >= 0 ? "+" : ""}${money(w.net)}</b>
      </div>
      <div class="lb-mine-cell">
        <span class="lb-k">Chip games</span>
        <b class="lb-v num">${w.matches}</b>
      </div>
      <div class="lb-mine-cell">
        <span class="lb-k">Won / lost</span>
        <b class="lb-v num">${w.won} / ${w.lost}</b>
      </div>
      <div class="lb-mine-cell">
        <span class="lb-k">Best pot</span>
        <b class="lb-v num">${money(w.best)}</b>
      </div>
    </div>
    <p class="lb-note">Your last seven days at online buy-in tables, from your own match history. A world ranking needs the server to keep the table, this board shows what this device can actually prove.</p>
    <div class="lb-head lb-row">
      <span class="lb-when">When</span><span class="lb-name">Table</span><span class="lb-arena">Result</span>
      <span class="lb-figure">Chips</span><span class="lb-hands">Seats</span>
    </div>
    <div class="lb-list">${rows}</div>
  </div>`;
}

export function renderLeaderboard(view) {
  const tab = view.lbTab === "pvp" ? "pvp" : "pve";
  const t = (id, label, sub) => `
    <button class="lb-tab${tab === id ? " on" : ""}" data-action="lb-tab" data-tab="${id}" aria-pressed="${tab === id}">
      <span class="lb-tab-l">${label}</span><span class="lb-tab-s">${sub}</span>
    </button>`;

  return `
  <div class="screen screen--lb lb-${tab}">
    <div class="al-top al-top--ladder">
      <button class="icon-btn" data-action="lb-back" aria-label="Back">←</button>
      <div class="al-title"><h2>STANDINGS</h2><span class="al-sub">Two economies, two boards</span></div>
      <span id="radio-slot" class="radio-slot"></span>
      <div class="al-purse">${tab === "pve" ? pveChipStack(view.pve.chips) : neonChipStack(view.soloBalance || 0)}</div>
    </div>

    <div class="lb-tabs" role="tablist">
      ${t("pve", "SINGLE-PLAYER", "practice chips · the ladder")}
      ${t("pvp", "MULTIPLAYER", "real chips · this week")}
    </div>

    ${tab === "pve" ? pveBoard(view) : pvpBoard(view)}
  </div>`;
}

// Multiplayer chips get gold and neon so they never look like the practice chips
export function neonChipStack(amount) {
  return `<span class="chip-stack chip-stack--neon">
      <span class="chip chip--gold"></span><span class="chip chip--red"></span><span class="chip chip--blue"></span>
    </span><span class="chip-amount chip-amount--neon num">${money(amount)}</span>`;
}
