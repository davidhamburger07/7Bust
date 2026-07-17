// Online multiplayer. Uses the same moves as the solo game, so the screen draws both the same way
// Anything sent before it connects waits in a queue

export function createNet(handlers = {}) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws`;
  let ws = null;
  let queue = [];
  let closed = false;

  function open() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    closed = false;
    ws = new WebSocket(url);
    ws.onopen = () => {
      handlers.onOpen && handlers.onOpen();
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
      else if (msg.type === "state") handlers.onState && handlers.onState(msg.snapshot);
      else if (msg.type === "error") handlers.onError && handlers.onError(msg);
    };
    ws.onclose = () => {
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
    create: (name) => send({ type: "create", name }),
    join: (code, name) => send({ type: "join", code, name }),
    rejoin: (code, id) => send({ type: "rejoin", code, id }),
    start: () => send({ type: "start" }),
    intent: (obj) => send({ type: "intent", ...obj }),
    close: () => {
      closed = true;
      queue = [];
      if (ws) ws.close();
    },
  };
}
