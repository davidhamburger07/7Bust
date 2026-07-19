// Online room server. Rooms are kept in the store, not here, since players land on different servers
// Each change loads the room, rebuilds the game, saves it and sends every player what they can see

import { WebSocketServer } from "ws";
import { createServer as createGame } from "./src/server/mockServer.js";
import { PERSONALITIES } from "./src/engine/ai.js";
import { aiReactions, PLAYER_EMOTES } from "./src/engine/aiChatter.js";
import { trackMultiplayerGame } from "./src/engine/analytics.js";
import { createStore } from "./store.mjs";

const AI_DELAY = 850;
const MIN_SIZE = 3;
const MAX_SIZE = 8;
const DEFAULT_SIZE = 4;
const ENTRY_OPTIONS = [0, 50, 100, 250]; // 0 is a friendly game with no chips
const CHAT_MAX = 30;
const DROP_AFTER_MS = 60000; // After a minute offline the drop rule kicks in
const PAUSE_MS = 120000;
const PAUSE_VOTE_MS = 25000;

// Each bot type has its own names, used in order
// The first Rook type bot is "Rook", the second is "Knight"
const AI_NAMES = {
  rook: ["Rook", "Knight", "Blitz", "Gambit", "Torch", "Rocket", "Viper", "Dash"],
  nova: ["Nova", "Sage", "Vega", "Orbit", "Quill", "Tally", "Prism", "Astra"],
  pip: ["Pip", "Perch", "Pebble", "Moss", "Tuck", "Nest", "Drift", "Sloth"],
};
// Rooms saved before the bots were renamed may still use the old keys
const AI_KEY_ALIASES = { reckless: "rook", cautious: "nova", holder: "pip" };
const aiKeyNorm = (k) => (AI_NAMES[k] ? k : AI_KEY_ALIASES[k] || null);

let store = null;

// Sockets on this server only
const local = new Map(); // Socket to its room code and player
const roomSockets = new Map();
const tickers = new Map();

const newId = () => Math.random().toString(36).slice(2, 10);
const cleanName = (n) => String(n || "Player").replace(/[<>]/g, "").trim().slice(0, 12) || "Player";

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

async function newCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let c = "";
    for (let i = 0; i < 4; i++) c += A[(Math.random() * A.length) | 0];
    if (!(await store.get(c))) return c;
  }
}

async function attachLocal(ws, code, playerId) {
  ws.roomCode = code;
  ws.playerId = playerId;
  local.set(ws, { code, playerId });
  let set = roomSockets.get(code);
  if (!set) {
    set = new Set();
    roomSockets.set(code, set);
    await store.subscribe(code, (payload) => deliver(code, payload));
    ensureTicker(code);
  }
  set.add(ws);
}

async function detachLocal(ws) {
  const reg = local.get(ws);
  if (!reg) return null;
  local.delete(ws);
  ws.roomCode = null;
  ws.playerId = null;
  const set = roomSockets.get(reg.code);
  if (set) {
    set.delete(ws);
    if (set.size === 0) {
      roomSockets.delete(reg.code);
      await store.unsubscribe(reg.code);
      stopTicker(reg.code);
    }
  }
  return reg;
}

function rosterToPlayers(roster) {
  return roster.map((r) => ({ name: r.name, isAI: r.isAI, ai: r.isAI ? PERSONALITIES[aiKeyNorm(r.aiKey)] || PERSONALITIES.nova : null }));
}
function gameConfig(room) {
  return { cashless: true, entryFee: room.entry || 0, rounds: room.rounds || 9 };
}
async function gameFor(room) {
  // Rebuild with the table settings too, rounds and buy-in aren't in the saved state
  // Rebuilding with defaults would quietly change the match
  const g = createGame({ ...gameConfig(room), players: rosterToPlayers(room.roster) });
  await g.restore(room.game);
  return g;
}
// Save the game back onto the room, plus a few things the ticker checks quickly
// Every phase change goes through here, so the match end stats fire once per match
function syncGame(room, g) {
  room.game = g.serialize();
  const s = g.snapshotFor(0);
  room.phase = s.phase;
  room.auto = s.autoStep;
  if (s.phase === "match_end" && !room.mpTracked) {
    room.mpTracked = true;
    trackMultiplayerGame({
      phase: "finish",
      room: room.code,
      pot: s.tournament ? s.tournament.pot : 0,
      prizePool: s.tournament ? s.tournament.prizePool : 0,
      entryFee: room.entry || 0,
      tableSize: s.players.length,
      humans: room.players.length,
      rounds: s.round.total,
      winner: s.players[s.winner] ? s.players[s.winner].name : null,
    });
  }
}

const seatsOf = (p) => p.seats || [p.seat];
const connectedPlayers = (room) => room.players.filter((x) => x.connected);
const handsOf = (p) => (p.hands == null ? 1 : p.hands);

// The waiting room, one entry per seat in order
// Bot seats show the name they'll get when the cards are dealt
function lobbyView(room) {
  const used = { rook: 0, nova: 0, pip: 0 };
  const slots = [];
  for (let i = 0; i < room.size; i++) {
    const p = room.players.find((x) => x.slot === i);
    if (p) {
      slots.push({ index: i, type: "human", name: p.name, connected: p.connected, isHost: p.id === room.hostId });
    } else {
      const s = room.slots[i];
      if (s.type === "ai") slots.push({ index: i, type: "ai", ai: s.ai, name: AI_NAMES[s.ai][used[s.ai]++ % AI_NAMES[s.ai].length] });
      else slots.push({ index: i, type: s.type });
    }
  }
  const filled = slots.filter((s) => s.type === "human" || s.type === "ai").length;
  return {
    code: room.code,
    status: room.status,
    size: room.size,
    slots,
    filled,
    entry: room.entry || 0,
    rounds: room.rounds || 9,
    multiHand: !!room.multiHand,
    dropRule: room.dropRule || "ai",
  };
}

function aiSlotCount(room) {
  let n = 0;
  for (let i = 0; i < room.size; i++) {
    if (room.slots[i].type === "ai" && !room.players.some((x) => x.slot === i)) n++;
  }
  return n;
}

// Buy-in phase, how many more hands this player can take
function maxHandsFor(room, player) {
  const others = room.players.filter((x) => x.id !== player.id).reduce((a, x) => a + handsOf(x), 0);
  return Math.max(1, Math.min(4, room.size - others - aiSlotCount(room)));
}

function buyinView(room) {
  if (room.status !== "buyin") return null;
  return {
    fee: room.entry || 0,
    picks: room.players.map((p) => ({ name: p.name, hands: p.hands, connected: p.connected })),
    maxByPlayer: Object.fromEntries(room.players.map((p) => [p.id, maxHandsFor(room, p)])),
  };
}

function pauseView(room) {
  const v = room.pauseVote;
  return {
    until: room.pausedUntil || 0,
    vote: v ? { name: v.name, yes: v.yes.length, no: v.no.length, needed: Math.floor(connectedPlayers(room).length / 2) + 1, expiresAt: v.expiresAt } : null,
  };
}

// Everything a server needs to update its sockets, built once by the server that made the change
async function payloadFor(room, { withLobby = false, game = null } = {}) {
  const payload = {
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((x) => ({ id: x.id, slot: x.slot, seats: seatsOf(x), pauseUsed: !!x.pauseUsed })),
    lobby: lobbyView(room),
    buyin: buyinView(room),
    pause: pauseView(room),
    withLobby,
    chat: room.chat || [],
    snaps: null,
  };
  if (room.status === "playing" && room.game) {
    const g = game || (await gameFor(room));
    const acting = g.snapshotFor(0).actingSeat;
    payload.snaps = {};
    for (const pl of room.players) {
      const mySeats = seatsOf(pl);
      const seat = mySeats.includes(acting) ? acting : mySeats[0];
      const snap = g.snapshotFor(seat);
      // How many hands this player has, so the game can settle their whole wallet
      snap.yourHands = mySeats.length;
      snap.yourSeats = mySeats;
      if (snap.tournament) {
        snap.yourTotalFee = snap.tournament.entryFee * mySeats.length;
        snap.yourTotalPayout = snap.tournament.settled
          ? mySeats.reduce((a, s) => a + (snap.tournament.winnerSeats.includes(s) ? snap.tournament.payout : 0), 0)
          : 0;
      }
      payload.snaps[pl.id] = snap;
    }
  }
  return payload;
}

function deliver(code, payload) {
  const set = roomSockets.get(code);
  if (!set) return;
  // Emote bubbles just get passed on, they aren't part of the room
  if (payload.kind === "emote") {
    for (const ws of set) send(ws, { type: "emote", seat: payload.seat, emoji: payload.emoji });
    return;
  }
  // Only the kicked player's sockets get this
  if (payload.kind === "kicked") {
    for (const ws of set) {
      const reg = local.get(ws);
      if (reg && reg.playerId === payload.playerId) send(ws, { type: "error", error: "You were kicked by the host" });
    }
    return;
  }
  for (const ws of set) {
    const reg = local.get(ws);
    if (!reg) continue;
    const me = payload.players.find((p) => p.id === reg.playerId);
    if (!me) continue;
    if (payload.status === "lobby" || payload.status === "buyin" || payload.withLobby) {
      send(ws, {
        type: "lobby",
        you: me.slot,
        self: me.id,
        isHost: me.id === payload.hostId,
        pauseUsed: me.pauseUsed,
        maxHands: payload.buyin ? payload.buyin.maxByPlayer[me.id] : null,
        buyin: payload.buyin,
        pause: payload.pause,
        ...payload.lobby,
      });
    }
    if (payload.status === "playing" && payload.snaps && payload.snaps[me.id]) {
      send(ws, { type: "state", snapshot: payload.snaps[me.id], pause: payload.pause, pauseUsed: me.pauseUsed });
    }
    send(ws, { type: "chat", list: payload.chat || [] });
  }
}

async function saveAndPublish(room, opts = {}) {
  await store.set(room.code, room);
  await store.publish(room.code, await payloadFor(room, opts));
}

function pushChat(room, entry) {
  room.chat = room.chat || [];
  room.chat.push(entry);
  if (room.chat.length > CHAT_MAX) room.chat = room.chat.slice(-CHAT_MAX);
}

// Bots react in character after the game moves, emotes go out now and lines go to chat
// Only once per game event
async function emitAiChatter(room, g) {
  const s = g.snapshotFor(0);
  const le = s.lastEvent;
  const sig = le ? `${le.kind}:${le.seat}:${le.from ?? ""}:${le.card ? le.card.value ?? le.card.action ?? "" : ""}` : "";
  if (!sig || sig === room.reactSig) return;
  room.reactSig = sig;
  for (const r of aiReactions(le, s.players)) {
    if (r.emoji) await store.publish(room.code, { kind: "emote", seat: r.seat, emoji: r.emoji });
    if (r.text) pushChat(room, { name: s.players[r.seat].name, seat: r.seat, at: Date.now(), text: r.text, ai: true });
  }
}

// Each player's hands go in seat order, extra hands are named like "Alice 2", then the bots
// Off seats and open seats nobody took don't play
async function deal(room, hostWs) {
  const roster = [];
  const used = { rook: 0, nova: 0, pip: 0 };
  for (const p of [...room.players].sort((a, b) => a.slot - b.slot)) {
    const hands = room.multiHand ? handsOf(p) : 1;
    p.seats = [];
    for (let h = 0; h < hands; h++) {
      p.seats.push(roster.length);
      roster.push({ name: h === 0 ? p.name : `${p.name} ${h + 1}`, isAI: false, aiKey: null });
    }
    p.seat = p.seats[0];
  }
  for (let i = 0; i < room.size && roster.length < MAX_SIZE; i++) {
    const s = room.slots[i];
    if (s.type === "ai" && !room.players.some((x) => x.slot === i)) {
      const pool = AI_NAMES[s.ai];
      roster.push({ name: pool[used[s.ai]++ % pool.length], isAI: true, aiKey: s.ai });
    }
  }
  if (roster.length < 2) {
    if (hostWs) send(hostWs, { type: "error", error: "Fill at least one more seat (a player or an AI) to deal.", soft: true });
    room.status = "lobby";
    return false;
  }
  room.roster = roster;
  const g = createGame({ ...gameConfig(room), players: rosterToPlayers(roster) });
  await g.startMatch();
  room.mpTracked = false; // New match, so the finish event can fire again
  trackMultiplayerGame({
    phase: "deal",
    room: room.code,
    pot: (room.entry || 0) * roster.length,
    entryFee: room.entry || 0,
    tableSize: roster.length,
    humans: roster.filter((r) => !r.isAI).length,
    ais: roster.filter((r) => r.isAI).length,
    rounds: room.rounds || 9,
    multiHand: !!room.multiHand,
  });
  syncGame(room, g);
  room.status = "playing";
  room.reactSig = "";
  room.pausedUntil = 0;
  room.pauseVote = null;
  room.lastStepAt = Date.now();
  await saveAndPublish(room, { withLobby: true, game: g });
  return true;
}

// Removes a player who left, or was offline for a minute
async function removePlayer(room, playerId, { viaRule = false } = {}) {
  const idx = room.players.findIndex((x) => x.id === playerId);
  if (idx < 0) return false;
  const p = room.players.splice(idx, 1)[0];
  if (room.players.length === 0) {
    await store.del(room.code);
    return true;
  }
  if (room.hostId === p.id) room.hostId = room.players[0].id; // Pass host on to the next player
  if (room.status === "playing" && room.game) {
    const g = await gameFor(room);
    const useAI = !viaRule || (room.dropRule || "ai") === "ai";
    for (const seat of seatsOf(p)) {
      if (useAI) {
        await g.convertToAI(seat); // A bot plays their hand from here
        room.roster[seat] = { name: room.roster[seat].name, isAI: true, aiKey: "nova" };
      } else {
        await g.retireSeat(seat); // The seat banks and sits out the rest of the match
      }
    }
    syncGame(room, g);
    await store.set(room.code, room);
    await store.publish(room.code, await payloadFor(room, { withLobby: true, game: g }));
  } else if (room.status === "buyin") {
    // Once everyone still here has picked, deal
    if (room.players.every((x) => x.hands != null || !x.connected)) {
      room.players.forEach((x) => (x.hands = handsOf(x)));
      await deal(room, null);
    } else {
      await saveAndPublish(room, { withLobby: true });
    }
  } else {
    // In the lobby their seat just opens up for the next player
    await saveAndPublish(room, { withLobby: true });
  }
  return true;
}

// Bot pacing. Every server with players in the room ticks
// The lock moves the table once per beat. Also drops offline players and ends pause votes
function ensureTicker(code) {
  if (tickers.has(code)) return;
  const t = { busy: false, timer: null };
  t.timer = setInterval(async () => {
    if (t.busy) return;
    t.busy = true;
    try {
      const peek = await store.get(code);
      if (!peek) return stopTicker(code);
      const now = Date.now();
      const paused = (peek.pausedUntil || 0) > now;
      const voteExpired = peek.pauseVote && peek.pauseVote.expiresAt < now;
      const dropDue = peek.players.some((p) => !p.connected && p.disconnectedAt && now - p.disconnectedAt > DROP_AFTER_MS);
      const stepDue = peek.status === "playing" && peek.auto && !paused && now - (peek.lastStepAt || 0) >= AI_DELAY - 80;
      if (!voteExpired && !dropDue && !stepDue) return;
      const token = await store.lock(code, { retries: 0 });
      if (!token) return;
      try {
        const room = await store.get(code);
        if (!room) return;
        let dirty = false;
        if (room.pauseVote && room.pauseVote.expiresAt < Date.now()) {
          pushChat(room, { name: "Table", seat: -1, at: Date.now(), text: `Pause vote by ${room.pauseVote.name} failed.`, ai: true });
          room.pauseVote = null;
          dirty = true;
        }
        for (const p of [...room.players]) {
          if (!p.connected && p.disconnectedAt && Date.now() - p.disconnectedAt > DROP_AFTER_MS) {
            room.banned = room.banned || [];
            if (p.cid && !room.banned.includes(p.cid)) room.banned.push(p.cid); // Dropped players can't come back
            pushChat(room, { name: "Table", seat: -1, at: Date.now(), text: `${p.name} was dropped after a minute offline.`, ai: true });
            const gone = await removePlayer(room, p.id, { viaRule: true });
            if (gone && !(await store.get(code))) return; // The room was deleted
            dirty = false; // Removing the player already saved and sent it
          }
        }
        const stillPaused = (room.pausedUntil || 0) > Date.now();
        if (room.status === "playing" && room.auto && !stillPaused && Date.now() - (room.lastStepAt || 0) >= AI_DELAY - 80) {
          const g = await gameFor(room);
          await g.step();
          syncGame(room, g);
          await emitAiChatter(room, g);
          room.lastStepAt = Date.now();
          await store.set(code, room);
          await store.publish(code, await payloadFor(room, { game: g }));
        } else if (dirty) {
          await saveAndPublish(room);
        }
      } finally {
        await store.unlock(code, token);
      }
    } catch (e) {
      console.error("ai tick", e);
    } finally {
      t.busy = false;
    }
  }, AI_DELAY);
  tickers.set(code, t);
}
function stopTicker(code) {
  const t = tickers.get(code);
  if (t) {
    clearInterval(t.timer);
    tickers.delete(code);
  }
}

async function withRoom(ws, fn, { lock = true } = {}) {
  const code = ws.roomCode;
  if (!code) return;
  const token = lock ? await store.lock(code) : null;
  if (lock && !token) return; // Someone else has the lock, the next update will refresh this player
  try {
    const room = await store.get(code);
    if (!room) return;
    await fn(room);
  } finally {
    if (token) await store.unlock(code, token);
  }
}

async function handle(ws, msg) {
  switch (msg.type) {
    case "ping": {
      send(ws, { type: "pong" }); // Keepalive, answering keeps traffic going both ways
      break;
    }
    case "create": {
      const code = await newCode();
      const pid = newId();
      const room = {
        code,
        hostId: pid,
        status: "lobby",
        phase: "lobby",
        size: DEFAULT_SIZE,
        entry: 0, // Buy-in per hand, 0 is a friendly game. The host sets it
        rounds: 9, // Match length, the host sets it
        multiHand: false, // Host setting, players can buy more than one hand
        dropRule: "ai", // After a minute offline, "ai" lets a bot play on and "kick" retires the seat
        // Seat 0 is the host's, the rest start open for friends and the host can change them
        slots: Array.from({ length: MAX_SIZE }, () => ({ type: "open", ai: null })),
        players: [{ id: pid, cid: msg.cid || null, slot: 0, seat: 0, seats: [0], hands: null, name: cleanName(msg.name), connected: true, pauseUsed: false, disconnectedAt: null }],
        banned: [], // Players kicked or dropped from this room can't come back
        chat: [],
        roster: null,
        game: null,
        auto: false,
        pausedUntil: 0,
        pauseVote: null,
        lastStepAt: 0,
      };
      await store.set(code, room);
      await attachLocal(ws, code, pid);
      await store.publish(code, await payloadFor(room));
      break;
    }
    case "join": {
      const code = String(msg.code || "").toUpperCase();
      const token = await store.lock(code);
      try {
        const room = await store.get(code);
        if (!room) return send(ws, { type: "error", error: "Room not found" });
        if (room.status !== "lobby") return send(ws, { type: "error", error: "That game already started" });
        // One browser, one seat. Can't join the same table twice or come back after a kick
        if (msg.cid && (room.banned || []).includes(msg.cid)) return send(ws, { type: "error", error: "You can't rejoin this room." });
        if (msg.cid && room.players.some((x) => x.cid === msg.cid)) return send(ws, { type: "error", error: "You're already at this table in another tab." });
        // Take the lowest open seat nobody is sitting in
        let slot = -1;
        for (let i = 0; i < room.size; i++) {
          if (room.slots[i].type === "open" && !room.players.some((x) => x.slot === i)) {
            slot = i;
            break;
          }
        }
        if (slot < 0) return send(ws, { type: "error", error: "Room is full" });
        const pid = newId();
        room.players.push({ id: pid, cid: msg.cid || null, slot, seat: slot, seats: [slot], hands: null, name: cleanName(msg.name), connected: true, pauseUsed: false, disconnectedAt: null });
        await store.set(code, room);
        await attachLocal(ws, code, pid);
        await store.publish(code, await payloadFor(room));
      } finally {
        if (token) await store.unlock(code, token);
      }
      break;
    }
    case "rejoin": {
      const code = String(msg.code || "").toUpperCase();
      const token = await store.lock(code);
      try {
        const room = await store.get(code);
        if (!room) return send(ws, { type: "error", error: "Room not found" });
        const p = room.players.find((x) => x.id === msg.id);
        if (!p) return send(ws, { type: "error", error: "Seat not found" });
        p.connected = true;
        p.disconnectedAt = null;
        await store.set(code, room);
        await attachLocal(ws, code, p.id);
        await store.publish(code, await payloadFor(room, { withLobby: true }));
      } finally {
        if (token) await store.unlock(code, token);
      }
      break;
    }
    case "config": {
      // Table setup, only the host and only in the waiting room
      await withRoom(ws, async (room) => {
        if (ws.playerId !== room.hostId || room.status !== "lobby") return;
        if (msg.size != null) {
          const n = Math.round(Number(msg.size));
          if (!(n >= MIN_SIZE && n <= MAX_SIZE)) return;
          const highest = Math.max(...room.players.map((x) => x.slot));
          if (n <= highest) return send(ws, { type: "error", error: "Someone is sitting in one of those chairs.", soft: true });
          room.size = n;
        }
        if (msg.slot) {
          const i = Math.round(Number(msg.slot.index));
          const t = msg.slot.type;
          if (!(i >= 1 && i < room.size)) return;
          if (room.players.some((x) => x.slot === i)) return send(ws, { type: "error", error: "That chair is taken.", soft: true });
          if (t === "ai") {
            const k = aiKeyNorm(msg.slot.ai);
            if (!k) return;
            room.slots[i] = { type: "ai", ai: k };
          } else if (t === "open" || t === "empty") {
            room.slots[i] = { type: t, ai: null };
          } else return;
        }
        if (msg.entry != null) {
          const fee = Math.round(Number(msg.entry));
          if (!ENTRY_OPTIONS.includes(fee)) return;
          room.entry = fee;
        }
        if (msg.rounds != null) {
          const r = Math.round(Number(msg.rounds));
          if (!(r >= 1 && r <= 9)) return;
          room.rounds = r;
        }
        if (msg.multiHand != null) room.multiHand = !!msg.multiHand;
        if (msg.dropRule === "ai" || msg.dropRule === "kick") room.dropRule = msg.dropRule;
        await saveAndPublish(room);
      });
      break;
    }
    case "start": {
      await withRoom(ws, async (room) => {
        if (ws.playerId !== room.hostId) return;
        // Start from the waiting room, or deal a new match once the last one is over
        if (!(room.status === "lobby" || room.phase === "match_end")) return;
        if (room.multiHand) {
          // Let every player pick how many hands first
          room.status = "buyin";
          room.players.forEach((p) => (p.hands = null));
          await saveAndPublish(room, { withLobby: true });
        } else {
          await deal(room, ws);
        }
      });
      break;
    }
    case "hands": {
      // Buy-in phase, this player takes some hands and pays a buy-in for each
      await withRoom(ws, async (room) => {
        if (room.status !== "buyin") return;
        const p = room.players.find((x) => x.id === ws.playerId);
        if (!p) return;
        const n = Math.round(Number(msg.count));
        if (!(n >= 1)) return;
        p.hands = Math.min(n, maxHandsFor(room, p));
        if (room.players.every((x) => x.hands != null || !x.connected)) {
          room.players.forEach((x) => (x.hands = handsOf(x)));
          await deal(room, null);
        } else {
          await saveAndPublish(room, { withLobby: true });
        }
      });
      break;
    }
    case "dealnow": {
      // Host shortcut in the buy-in phase, anyone who hasn't picked plays one hand
      await withRoom(ws, async (room) => {
        if (room.status !== "buyin" || ws.playerId !== room.hostId) return;
        room.players.forEach((x) => (x.hands = handsOf(x)));
        await deal(room, ws);
      });
      break;
    }
    case "intent": {
      await withRoom(ws, async (room) => {
        if (room.status !== "playing" || !room.game) return;
        if ((room.pausedUntil || 0) > Date.now()) return;
        const p = room.players.find((x) => x.id === ws.playerId);
        if (!p) return;
        const g = await gameFor(room);
        // With several hands, play whichever of yours has the turn
        const mySeats = seatsOf(p);
        const acting = g.snapshotFor(0).actingSeat;
        const seat = mySeats.includes(acting) ? acting : mySeats[0];
        try {
          if (msg.intent === "hit") await g.hit(seat);
          else if (msg.intent === "stay") await g.stay(seat);
          else if (msg.intent === "stop") await g.stop(seat);
          else if (msg.intent === "resolveChoice") await g.resolveChoice({ targetSeat: msg.targetSeat, actor: seat });
          else if (msg.intent === "next") {
            if (g.snapshotFor(0).phase === "round_end") await g.nextRound();
          }
        } catch (e) {
          // Not allowed, ignore it and send the state again
        }
        syncGame(room, g);
        await emitAiChatter(room, g);
        await saveAndPublish(room, { game: g });
      });
      break;
    }
    case "pause": {
      // Each player gets one two minute pause, if most of the table votes yes
      await withRoom(ws, async (room) => {
        if (room.status !== "playing" || room.pauseVote || (room.pausedUntil || 0) > Date.now()) return;
        const p = room.players.find((x) => x.id === ws.playerId);
        if (!p || p.pauseUsed) return send(ws, { type: "error", error: "You've already used your pause.", soft: true });
        const humans = connectedPlayers(room).length;
        if (humans <= 1) {
          p.pauseUsed = true;
          room.pausedUntil = Date.now() + PAUSE_MS;
          pushChat(room, { name: "Table", seat: -1, at: Date.now(), text: `${p.name} paused the game (2 min).`, ai: true });
        } else {
          room.pauseVote = { id: p.id, name: p.name, yes: [p.id], no: [], expiresAt: Date.now() + PAUSE_VOTE_MS };
          pushChat(room, { name: "Table", seat: -1, at: Date.now(), text: `${p.name} asks for a 2-minute pause, vote now.`, ai: true });
        }
        await saveAndPublish(room);
      });
      break;
    }
    case "pvote": {
      await withRoom(ws, async (room) => {
        const v = room.pauseVote;
        if (!v || v.expiresAt < Date.now()) return;
        const p = room.players.find((x) => x.id === ws.playerId);
        if (!p || v.yes.includes(p.id) || v.no.includes(p.id)) return;
        (msg.agree ? v.yes : v.no).push(p.id);
        const needed = Math.floor(connectedPlayers(room).length / 2) + 1;
        if (v.yes.length >= needed) {
          const initiator = room.players.find((x) => x.id === v.id);
          if (initiator) initiator.pauseUsed = true;
          room.pausedUntil = Date.now() + PAUSE_MS;
          room.pauseVote = null;
          pushChat(room, { name: "Table", seat: -1, at: Date.now(), text: `Pause granted, back in 2 minutes.`, ai: true });
        } else if (v.no.length >= needed) {
          room.pauseVote = null;
          pushChat(room, { name: "Table", seat: -1, at: Date.now(), text: `Pause vote failed.`, ai: true });
        }
        await saveAndPublish(room);
      });
      break;
    }
    case "resume": {
      await withRoom(ws, async (room) => {
        if (!((room.pausedUntil || 0) > Date.now())) return;
        if (ws.playerId !== room.hostId && !room.players.some((x) => x.id === ws.playerId && x.pauseUsed)) return;
        room.pausedUntil = 0;
        pushChat(room, { name: "Table", seat: -1, at: Date.now(), text: "Game resumed.", ai: true });
        await saveAndPublish(room);
      });
      break;
    }
    case "chat": {
      // Chat for the lobby and the game, saved in the room so a rejoin still sees it
      const now = Date.now();
      if (ws.lastChatAt && now - ws.lastChatAt < 800) return;
      const text = String(msg.text || "").replace(/[<>]/g, "").trim().slice(0, 140);
      if (!text) return;
      ws.lastChatAt = now;
      await withRoom(ws, async (room) => {
        const p = room.players.find((x) => x.id === ws.playerId);
        if (!p) return;
        pushChat(room, { name: p.name, seat: p.seat, slot: p.slot, at: now, text });
        await saveAndPublish(room);
      });
      break;
    }
    case "emote": {
      // A short bubble over the sender's seat, passed on and never saved
      const now = Date.now();
      if (ws.lastEmoteAt && now - ws.lastEmoteAt < 1200) return;
      if (!PLAYER_EMOTES.includes(msg.emoji)) return;
      const code = ws.roomCode;
      if (!code) return;
      ws.lastEmoteAt = now;
      const room = await store.get(code);
      if (!room || room.status !== "playing") return;
      const p = room.players.find((x) => x.id === ws.playerId);
      if (!p) return;
      const acting = room.game ? seatsOf(p)[0] : p.seat;
      await store.publish(code, { kind: "emote", seat: acting, emoji: msg.emoji });
      break;
    }
    case "kick": {
      // Host kicks a player from the waiting room or buy-in screen, they can't come back
      await withRoom(ws, async (room) => {
        if (ws.playerId !== room.hostId || room.status === "playing") return;
        const slot = Math.round(Number(msg.slot));
        const p = room.players.find((x) => x.slot === slot);
        if (!p || p.id === room.hostId) return;
        room.banned = room.banned || [];
        if (p.cid && !room.banned.includes(p.cid)) room.banned.push(p.cid);
        pushChat(room, { name: "Table", seat: -1, at: Date.now(), text: `${p.name} was kicked by the host.`, ai: true });
        await store.publish(room.code, { kind: "kicked", playerId: p.id });
        await removePlayer(room, p.id, { viaRule: false });
      });
      break;
    }
    case "leave": {
      // The player chose to leave, not a dropped connection, so free the seat for good
      const code = ws.roomCode;
      if (!code) return;
      const token = await store.lock(code);
      try {
        const room = await store.get(code);
        const reg = await detachLocal(ws);
        if (!room || !reg) return;
        await removePlayer(room, reg.playerId, { viaRule: false });
      } finally {
        if (token) await store.unlock(code, token);
      }
      break;
    }
    default:
      break;
  }
}

async function onSocketClose(ws) {
  const reg = await detachLocal(ws);
  if (!reg) return;
  const token = await store.lock(reg.code);
  try {
    const room = await store.get(reg.code);
    if (!room) return;
    const p = room.players.find((x) => x.id === reg.playerId);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = Date.now(); // The drop rule kicks in a minute from now
    await saveAndPublish(room, { withLobby: room.status !== "playing" });
  } finally {
    if (token) await store.unlock(reg.code, token);
  }
}

// Pass a path to only take upgrades there, like the local server does
// Null takes any path, Vercel only sends /api/ws traffic here anyway
export function attachRoomServer(httpServer, { path = "/api/ws" } = {}) {
  if (!store) store = createStore();
  const wss = path ? new WebSocketServer({ server: httpServer, path }) : new WebSocketServer({ server: httpServer });
  wss.on("connection", (ws) => {
    ws.roomCode = null;
    ws.playerId = null;
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      handle(ws, msg).catch((e) => console.error("handle", e));
    });
    ws.on("close", (code, reason) => {
      if (process.env.DEBUG_AI) console.log(`[ws close] code=${code} reason=${reason || "(none)"} room=${ws.roomCode}`);
      onSocketClose(ws).catch((e) => console.error("close", e));
    });
    ws.on("error", (e) => {
      if (process.env.DEBUG_AI) console.log(`[ws error] ${e.message}`);
    });
  });
  console.log(`Room server (WebSocket) attached at ${path || "(any path)"}`);
  return { store: () => store.kind };
}
