// Online multiplayer. Uses the same moves as the solo game, so the screen draws both the same way
// Anything sent before it connects waits in a queue

// Local and Vercel hosts use their own backend on the same address
// CrazyGames and other domains use the backend set on the page, or the fallback
const CG_BACKEND_FALLBACK = "wss://7-bust-cg.vercel.app/api/ws";

// The same backend over HTTP, used to send tracking events
export function backendHttpOrigin() {
  return backendUrl().replace(/^ws/, "http").replace(/\/api\/ws$/, "");
}

function backendUrl() {
  const host = location.hostname;
  const wss = location.protocol === "https:" ? "wss" : "ws";
  if (host === "localhost" || host === "127.0.0.1" || host === "") return `${wss}://${location.host}/api/ws`;
  if (/\.vercel\.app$/i.test(host) || host === "vercel.app") return `wss://${location.host}/api/ws`;
  const override = typeof window !== "undefined" && window.__WS_BACKEND__;
  return override || CG_BACKEND_FALLBACK; // CrazyGames and custom domains
}

import { PROTOCOL_VERSION } from "../engine/protocol.js";
import { cgUserToken } from "./crazygames.js";

export function createNet(handlers = {}) {
  const url = backendUrl();
  let ws = null;
  let queue = [];
  let closed = false;
  let pingTimer = null;

  function stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function open() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    closed = false;
    ws = new WebSocket(url);
    ws.onopen = () => {
      handlers.onOpen && handlers.onOpen();
      // A waiting room can be quiet for minutes, pinging stops proxies closing the connection
      stopPing();
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 25000);
      const pending = queue;
      queue = [];
      pending.forEach((m) => ws.send(JSON.stringify(m)));
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "lobby") handlers.onLobby && handlers.onLobby(msg);
      else if (msg.type === "browse") handlers.onBrowse && handlers.onBrowse(msg.list || []);
      else if (msg.type === "state") handlers.onState && handlers.onState(msg.snapshot, msg);
      else if (msg.type === "chat") handlers.onChat && handlers.onChat(msg.list);
      else if (msg.type === "emote") handlers.onEmote && handlers.onEmote(msg);
      else if (msg.type === "error") handlers.onError && handlers.onError(msg);
    };
    ws.onclose = () => {
      stopPing();
      if (!closed) handlers.onClose && handlers.onClose();
    };
    ws.onerror = () => handlers.onError && handlers.onError({ error: "Connection problem" });
  }

  function send(m) {
    open();
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    else queue.push(m);
  }

  return {
    // v is the protocol version, so an old build on another site can't break a shared room
    // token lets buy-ins come off the right account. Guests can only sit at free tables
    create: async (name, cid) => send({ type: "create", name, cid, v: PROTOCOL_VERSION, token: await cgUserToken() }),
    join: async (code, name, cid) => send({ type: "join", code, name, cid, v: PROTOCOL_VERSION, token: await cgUserToken() }),
    // In Discord everyone arrives at once and nobody is set to make the room
    // so whoever lands first opens it
    joinOrCreate: async (code, name, cid) =>
      send({ type: "joinOrCreate", code, name, cid, v: PROTOCOL_VERSION, token: await cgUserToken() }),
    rejoin: (code, id) => send({ type: "rejoin", code, id, v: PROTOCOL_VERSION }),
    kick: (slot) => send({ type: "kick", slot }),
    start: () => send({ type: "start" }),
    browse: () => send({ type: "browse" }),
    config: (obj) => send({ type: "config", ...obj }),
    intent: (obj) => send({ type: "intent", ...obj }),
    hands: (count) => send({ type: "hands", count }),
    dealnow: () => send({ type: "dealnow" }),
    pause: () => send({ type: "pause" }),
    pvote: (agree) => send({ type: "pvote", agree }),
    resume: () => send({ type: "resume" }),
    chat: (text) => send({ type: "chat", text }),
    emote: (emoji) => send({ type: "emote", emoji }),
    leave: () => send({ type: "leave" }),
    close: () => {
      closed = true;
      queue = [];
      stopPing();
      if (ws) ws.close();
    },
  };
}
