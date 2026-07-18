// Online room server. Rooms are kept in the store, not here, since players land on different servers
// Each change loads the room, rebuilds the game, saves it and sends every player what they can see

import { WebSocketServer } from "ws";
import { createServer as createGame } from "./src/server/mockServer.js";
import { PERSONALITIES } from "./src/engine/ai.js";
import { aiReactions, PLAYER_EMOTES } from "./src/engine/aiChatter.js";
import { createStore } from "./store.mjs";

const AI_DELAY = 850;
const MIN_SIZE = 3;
const MAX_SIZE = 8;
const DEFAULT_SIZE = 4;
const ENTRY_OPTIONS = [0, 50, 100, 250]; // 0 is a friendly game with no chips
const CHAT_MAX = 30;

// Each bot type has its own names, used in order
// The first Rook type bot is "Rook", the second is "Knight"
const AI_NAMES = {
  reckless: ["Rook", "Knight", "Blitz", "Gambit", "Torch", "Rocket", "Viper", "Dash"],
  cautious: ["Nova", "Sage", "Vega", "Orbit", "Quill", "Tally", "Prism", "Astra"],
  holder: ["Pip", "Perch", "Pebble", "Moss", "Tuck", "Nest", "Drift", "Sloth"],
};

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
  return roster.map((r) => ({ name: r.name, isAI: r.isAI, ai: r.isAI ? PERSONALITIES[r.aiKey] : null }));
}
async function gameFor(room) {
  // Rebuild with the table settings too, rounds and buy-in aren't in the saved state
  // Rebuilding with defaults would quietly change the match
  const g = createGame({ cashless: true, players: rosterToPlayers(room.roster), entryFee: room.entry || 0, rounds: room.rounds || 9 });
  await g.restore(room.game);
  return g;
}
// Save the game back onto the room, plus a few things the ticker checks quickly
function syncGame(room, g) {
  room.game = g.serialize();
  const s = g.snapshotFor(0);
  room.phase = s.phase;
  room.auto = s.autoStep;
}

// The waiting room, one entry per seat in order
// Bot seats show the name they'll get when the cards are dealt
function lobbyView(room) {
  const used = { reckless: 0, cautious: 0, holder: 0 };
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
  return { code: room.code, status: room.status, size: room.size, slots, filled, entry: room.entry || 0, rounds: room.rounds || 9 };
}

// Everything a server needs to update its sockets, built once by the server that made the change
async function payloadFor(room, { withLobby = false, game = null } = {}) {
  const payload = {
    status: room.status,
    hostId: room.hostId,
    players: room.players.map((x) => ({ id: x.id, slot: x.slot, seat: x.seat })),
    lobby: lobbyView(room),
    withLobby,
    chat: room.chat || [],
    snaps: null,
  };
  if (room.status === "playing" && room.game) {
    const g = game || (await gameFor(room));
    payload.snaps = {};
    for (const pl of room.players) payload.snaps[pl.seat] = g.snapshotFor(pl.seat);
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
  for (const ws of set) {
    const reg = local.get(ws);
    if (!reg) continue;
    const me = payload.players.find((p) => p.id === reg.playerId);
    if (!me) continue;
    if (payload.status === "lobby" || payload.withLobby) {
      send(ws, { type: "lobby", you: me.slot, self: me.id, isHost: me.id === payload.hostId, ...payload.lobby });
    }
    if (payload.status === "playing" && payload.snaps && payload.snaps[me.seat] != null) {
      send(ws, { type: "state", snapshot: payload.snaps[me.seat] });
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

// Bot pacing. Every server with players in the room ticks
// The lock and the shared last step time make the table move once per beat
function ensureTicker(code) {
  if (tickers.has(code)) return;
  const t = { busy: false, timer: null };
  t.timer = setInterval(async () => {
    if (t.busy) return;
    t.busy = true;
    try {
      const peek = await store.get(code);
      if (!peek) return stopTicker(code);
      if (peek.status !== "playing" || !peek.auto) return;
      if (Date.now() - (peek.lastStepAt || 0) < AI_DELAY - 80) return;
      const token = await store.lock(code, { retries: 0 });
      if (!token) return;
      try {
        const room = await store.get(code);
        if (!room || room.status !== "playing" || !room.auto) return;
        if (Date.now() - (room.lastStepAt || 0) < AI_DELAY - 80) return;
        const g = await gameFor(room);
        await g.step();
        syncGame(room, g);
        await emitAiChatter(room, g);
        room.lastStepAt = Date.now();
        await store.set(code, room);
        await store.publish(code, await payloadFor(room, { game: g }));
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
        entry: 0, // Buy-in per player, 0 is a friendly game. The host sets it
        rounds: 9, // Match length, the host sets it
        // Seat 0 is the host's, the rest start open for friends and the host can change them
        slots: Array.from({ length: MAX_SIZE }, () => ({ type: "open", ai: null })),
        players: [{ id: pid, slot: 0, seat: 0, name: cleanName(msg.name), connected: true }],
        chat: [],
        roster: null,
        game: null,
        auto: false,
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
        room.players.push({ id: pid, slot, seat: slot, name: cleanName(msg.name), connected: true });
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
            if (!AI_NAMES[msg.slot.ai]) return;
            room.slots[i] = { type: "ai", ai: msg.slot.ai };
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
        await saveAndPublish(room);
      });
      break;
    }
    case "start": {
      await withRoom(ws, async (room) => {
        if (ws.playerId !== room.hostId) return;
        // Start from the waiting room, or deal a new match once the last one is over
        if (!(room.status === "lobby" || room.phase === "match_end")) return;
        // Deal what the host set up, players in their seats and bots with their names
        // Off seats and open seats nobody took are skipped
        const roster = [];
        const used = { reckless: 0, cautious: 0, holder: 0 };
        for (let i = 0; i < room.size; i++) {
          const p = room.players.find((x) => x.slot === i);
          if (p) {
            p.seat = roster.length;
            roster.push({ name: p.name, isAI: false, aiKey: null });
          } else {
            const s = room.slots[i];
            if (s.type === "ai") {
              const pool = AI_NAMES[s.ai];
              roster.push({ name: pool[used[s.ai]++ % pool.length], isAI: true, aiKey: s.ai });
            }
          }
        }
        if (roster.length < 2) {
          return send(ws, { type: "error", error: "Fill at least one more seat (a player or an AI) to deal.", soft: true });
        }
        room.roster = roster;
        const g = createGame({ cashless: true, players: rosterToPlayers(roster), entryFee: room.entry || 0, rounds: room.rounds || 9 });
        await g.startMatch();
        syncGame(room, g);
        room.status = "playing";
        room.reactSig = "";
        room.lastStepAt = Date.now();
        await saveAndPublish(room, { withLobby: true, game: g });
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
      ws.lastEmoteAt = now;
      const code = ws.roomCode;
      if (!code) return;
      const room = await store.get(code);
      if (!room || room.status !== "playing") return;
      const p = room.players.find((x) => x.id === ws.playerId);
      if (!p) return;
      await store.publish(code, { kind: "emote", seat: p.seat, emoji: msg.emoji });
      break;
    }
    case "intent": {
      await withRoom(ws, async (room) => {
        if (room.status !== "playing" || !room.game) return;
        const p = room.players.find((x) => x.id === ws.playerId);
        if (!p) return;
        const g = await gameFor(room);
        try {
          if (msg.intent === "hit") await g.hit(p.seat);
          else if (msg.intent === "stay") await g.stay(p.seat);
          else if (msg.intent === "stop") await g.stop(p.seat);
          else if (msg.intent === "resolveChoice") await g.resolveChoice({ targetSeat: msg.targetSeat, actor: p.seat });
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
    case "leave": {
      // The player chose to leave, not a dropped connection, so free the seat for good
      const code = ws.roomCode;
      if (!code) return;
      const token = await store.lock(code);
      try {
        const room = await store.get(code);
        const reg = await detachLocal(ws);
        if (!room || !reg) return;
        const idx = room.players.findIndex((x) => x.id === reg.playerId);
        if (idx < 0) return;
        const p = room.players.splice(idx, 1)[0];
        if (room.players.length === 0) {
          await store.del(code);
          return;
        }
        if (room.hostId === p.id) room.hostId = room.players[0].id; // Pass host on to the next player
        if (room.status === "playing" && room.game) {
          const g = await gameFor(room);
          await g.convertToAI(p.seat); // A bot plays their hand from here
          room.roster[p.seat] = { name: p.name, isAI: true, aiKey: "cautious" }; // Saved in the roster so it lasts after a rebuild
          syncGame(room, g);
          await store.set(code, room);
          await store.publish(code, await payloadFor(room, { withLobby: true, game: g }));
        } else {
          // In the lobby their seat just opens up for the next player
          await saveAndPublish(room, { withLobby: true });
        }
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
    await saveAndPublish(room, { withLobby: room.status === "lobby" });
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
