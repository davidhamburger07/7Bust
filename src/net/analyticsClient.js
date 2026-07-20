// Sends analytics in batches to the backend, solo games would never send them otherwise
// Sent as plain text so CrazyGames' page needs no CORS check, failures are ignored

import { backendHttpOrigin } from "./netClient.js";

const FLUSH_MS = 20000;
const MAX_BUFFER = 25;

let buffer = [];
let timer = null;

function send(records, useBeacon = false) {
  if (!records.length) return;
  const url = `${backendHttpOrigin()}/api/track`;
  const body = JSON.stringify({ events: records });
  try {
    // When the page hides, sendBeacon is the only thing sure to get out
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
      return;
    }
    fetch(url, { method: "POST", body, headers: { "Content-Type": "text/plain" }, keepalive: true }).catch(() => {});
  } catch {
    // Analytics failing never affects the game
  }
}

function flush(useBeacon = false) {
  const batch = buffer;
  buffer = [];
  send(batch, useBeacon);
}

export function analyticsSink(record) {
  buffer.push(record);
  if (buffer.length >= MAX_BUFFER) return flush();
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, FLUSH_MS);
  }
}

// Don't lose the end of a session when the tab closes or the player switches away
export function installAnalyticsFlush() {
  const bail = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    flush(true);
  };
  window.addEventListener("pagehide", bail);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") bail();
  });
}
