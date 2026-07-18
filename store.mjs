// Room store for online play, kept in Redis since each socket can land on a different server
// Without a Redis URL it uses an in-memory store that works the same

import Redis from "ioredis";

const TTL_S = 6 * 60 * 60; // Abandoned rooms are deleted after this
const LOCK_MS = 2500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => Math.random().toString(36).slice(2);

function memoryStore() {
  const rooms = new Map(); // Room code to the room and when it was saved
  const locks = new Map();
  const subs = new Map();

  // Clears old rooms so a long running dev server doesn't pile them up
  setInterval(() => {
    const cut = Date.now() - TTL_S * 1000;
    for (const [code, e] of rooms) if (e.at < cut) rooms.delete(code);
  }, 600000).unref?.();

  return {
    kind: "memory",
    async get(code) {
      const e = rooms.get(code);
      return e ? JSON.parse(JSON.stringify(e.obj)) : null;
    },
    async set(code, obj) {
      rooms.set(code, { obj: JSON.parse(JSON.stringify(obj)), at: Date.now() });
    },
    async del(code) {
      rooms.delete(code);
    },
    async lock(code, { retries = 12 } = {}) {
      for (let i = 0; ; i++) {
        if (!locks.has(code)) {
          const t = token();
          locks.set(code, t);
          setTimeout(() => {
            if (locks.get(code) === t) locks.delete(code); // Clears a lock that was never released
          }, LOCK_MS).unref?.();
          return t;
        }
        if (i >= retries) return null;
        await sleep(100);
      }
    },
    async unlock(code, t) {
      if (locks.get(code) === t) locks.delete(code);
    },
    async publish(code, payload) {
      const fns = subs.get(code);
      if (!fns) return;
      const copy = JSON.parse(JSON.stringify(payload));
      queueMicrotask(() => fns.forEach((fn) => fn(copy)));
    },
    async subscribe(code, fn) {
      if (!subs.has(code)) subs.set(code, new Set());
      subs.get(code).add(fn);
    },
    async unsubscribe(code) {
      subs.delete(code);
    },
  };
}

function redisStore(url) {
  const KEY = (c) => `7bust:room:${c}`;
  const LOCK = (c) => `7bust:lock:${c}`;
  const CH = (c) => `7bust:ch:${c}`;
  const redis = new Redis(url, { maxRetriesPerRequest: 3, enableAutoPipelining: true });
  let subConn = null; // Own connection, a Redis client that's subscribed can't run other commands
  const subs = new Map();

  function subscriber() {
    if (subConn) return subConn;
    subConn = redis.duplicate();
    subConn.on("message", (channel, msg) => {
      const fn = subs.get(channel.slice(CH("").length));
      if (!fn) return;
      try {
        fn(JSON.parse(msg));
      } catch (e) {
        console.error("subscriber", e);
      }
    });
    return subConn;
  }

  return {
    kind: "redis",
    async get(code) {
      const raw = await redis.get(KEY(code));
      return raw ? JSON.parse(raw) : null;
    },
    async set(code, obj) {
      await redis.set(KEY(code), JSON.stringify(obj), "EX", TTL_S);
    },
    async del(code) {
      await redis.del(KEY(code));
    },
    async lock(code, { retries = 12 } = {}) {
      const t = token();
      for (let i = 0; ; i++) {
        const ok = await redis.set(LOCK(code), t, "PX", LOCK_MS, "NX");
        if (ok) return t;
        if (i >= retries) return null;
        await sleep(100);
      }
    },
    async unlock(code, t) {
      // Only release our own lock
      await redis.eval(`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`, 1, LOCK(code), t);
    },
    async publish(code, payload) {
      await redis.publish(CH(code), JSON.stringify(payload));
    },
    async subscribe(code, fn) {
      subs.set(code, fn);
      await subscriber().subscribe(CH(code));
    },
    async unsubscribe(code) {
      subs.delete(code);
      if (subConn) await subConn.unsubscribe(CH(code)).catch(() => {});
    },
  };
}

export function createStore() {
  const url = process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_URL;
  if (url) {
    console.log("Room store: redis (shared across instances)");
    return redisStore(url);
  }
  console.log("Room store: in-memory (single process)");
  return memoryStore();
}
