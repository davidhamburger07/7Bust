// Online room server, runs the same game as single player without chips
// Players send moves, the server checks the seat, runs the game and sends each seat what it can see

import { WebSocketServer } from "ws";
import { createServer as createGame } from "./src/server/mockServer.js";
import { PERSONALITIES } from "./src/engine/ai.js";

const AI_DELAY = 850;
const MAX_SEATS = 6;
const AI_POOL = [
  { name: "Nova", ai: PERSONALITIES.cautious },
  { name: "Rook", ai: PERSONALITIES.reckless },
  { name: "Pip", ai: PERSONALITIES.holder },
  { name: "Ace", ai: PERSONALITIES.cautious },
  { name: "Duke", ai: PERSONALITIES.reckless },
];

const rooms = new Map();

const newCode = () => {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 4; i++) c += A[(Math.random() * A.length) | 0];
  return c;
};
const newId = () => Math.random().toString(36).slice(2, 10);
const cleanName = (n) => String(n || "Player").replace(/[<>]/g, "").trim().slice(0, 12) || "Player";

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function lobbyView(room) {
  return {
    code: room.code,
    status: room.status,
    seats: room.players.map((p) => ({ seat: p.seat, name: p.name, connected: p.connected, isHost: p.id === room.hostId })),
  };
}
function broadcastLobby(room) {
  const view = lobbyView(room);
  room.players.forEach((p) => send(p.ws, { type: "lobby", you: p.seat, self: p.id, isHost: p.id === room.hostId, ...view }));
}
function broadcastState(room) {
  if (!room.game) return;
  room.players.forEach((p) => send(p.ws, { type: "state", snapshot: room.game.snapshotFor(p.seat) }));
}

function stopAiLoop(room) {
  if (room.aiTimer) {
    if (process.env.DEBUG_AI) console.log(`[ai ${room.code}] loop stopped`);
    clearInterval(room.aiTimer);
    room.aiTimer = null;
  }
}
function startAiLoop(room) {
  stopAiLoop(room);
  room.aiTimer = setInterval(async () => {
    if (!room.game) return;
    try {
      if (room.game.snapshotFor(0).autoStep) {
        await room.game.step();
        broadcastState(room);
      }
    } catch (e) {
      console.error("ai loop", e);
    }
  }, AI_DELAY);
}

async function startGame(room) {
  const size = Math.min(MAX_SEATS, Math.max(4, room.players.length));
  const roster = room.players.map((p) => ({ name: p.name, isAI: false }));
  let ai = 0;
  while (roster.length < size) {
    const a = AI_POOL[ai++ % AI_POOL.length];
    roster.push({ name: a.name, isAI: true, ai: a.ai });
  }
  room.game = createGame({ cashless: true, players: roster });
  await room.game.startMatch();
  room.status = "playing";
  broadcastLobby(room);
  broadcastState(room);
  startAiLoop(room);
}

async function handle(ws, msg) {
  switch (msg.type) {
    case "create": {
      let code;
      do {
        code = newCode();
      } while (rooms.has(code));
      const pid = newId();
      const room = { code, hostId: pid, players: [], game: null, status: "lobby", aiTimer: null };
      room.players.push({ id: pid, seat: 0, name: cleanName(msg.name), ws, connected: true });
      rooms.set(code, room);
      ws.roomCode = code;
      ws.playerId = pid;
      broadcastLobby(room);
      break;
    }
    case "join": {
      const room = rooms.get(String(msg.code || "").toUpperCase());
      if (!room) return send(ws, { type: "error", error: "Room not found" });
      if (room.status !== "lobby") return send(ws, { type: "error", error: "That game already started" });
      if (room.players.length >= MAX_SEATS) return send(ws, { type: "error", error: "Room is full" });
      const pid = newId();
      const seat = room.players.length;
      room.players.push({ id: pid, seat, name: cleanName(msg.name), ws, connected: true });
      ws.roomCode = room.code;
      ws.playerId = pid;
      broadcastLobby(room);
      break;
    }
    case "rejoin": {
      const room = rooms.get(String(msg.code || "").toUpperCase());
      if (!room) return send(ws, { type: "error", error: "Room not found" });
      const p = room.players.find((x) => x.id === msg.id);
      if (!p) return send(ws, { type: "error", error: "Seat not found" });
      p.ws = ws;
      p.connected = true;
      ws.roomCode = room.code;
      ws.playerId = p.id;
      broadcastLobby(room);
      if (room.game) send(ws, { type: "state", snapshot: room.game.snapshotFor(p.seat) });
      // The bot loop stops when the last player disconnects, so start it again when they come back
      if (room.status === "playing" && !room.aiTimer) startAiLoop(room);
      break;
    }
    case "start": {
      const room = rooms.get(ws.roomCode);
      if (!room || ws.playerId !== room.hostId) return;
      // Start from the waiting room, or deal a new match once the last one is over
      const canStart = room.status === "lobby" || (room.game && room.game.snapshotFor(0).phase === "match_end");
      if (!canStart) return;
      await startGame(room);
      break;
    }
    case "leave": {
      // The player chose to leave, not a dropped connection, so free the seat for good
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const idx = room.players.findIndex((x) => x.id === ws.playerId);
      if (idx < 0) return;
      const p = room.players.splice(idx, 1)[0];
      ws.roomCode = null;
      ws.playerId = null;
      if (room.players.length === 0) {
        stopAiLoop(room);
        rooms.delete(room.code);
        return;
      }
      if (room.hostId === p.id) room.hostId = room.players[0].id; // Pass host on to the next player
      if (room.status === "lobby") {
        room.players.forEach((q, i) => (q.seat = i)); // Close up the seats before the deal
      } else if (room.game) {
        await room.game.convertToAI(p.seat); // A bot plays their hand from here
        broadcastState(room);
      }
      broadcastLobby(room);
      break;
    }
    case "intent": {
      const room = rooms.get(ws.roomCode);
      if (!room || !room.game) return;
      const p = room.players.find((x) => x.id === ws.playerId);
      if (!p) return;
      const g = room.game;
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
      broadcastState(room);
      break;
    }
    default:
      break;
  }
}

function onClose(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const p = room.players.find((x) => x.id === ws.playerId);
  if (p) {
    p.connected = false;
    p.ws = null;
  }
  if (room.players.every((x) => !x.connected)) {
    stopAiLoop(room);
    setTimeout(() => {
      const r = rooms.get(room.code);
      if (r && r.players.every((x) => !x.connected)) rooms.delete(room.code);
    }, 60000);
  } else {
    broadcastLobby(room);
  }
}

// Pass a path to only take upgrades there, like the local server does
// Null takes any path, Vercel only sends /api/ws traffic here anyway
export function attachRoomServer(httpServer, { path = "/api/ws" } = {}) {
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
      onClose(ws);
    });
    ws.on("error", (e) => {
      if (process.env.DEBUG_AI) console.log(`[ws error] ${e.message}`);
    });
  });
  console.log(`Room server (WebSocket) attached at ${path || "(any path)"}`);
}
