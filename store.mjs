// Room store for online play, kept in Redis since each socket can land on a different server
// Without a Redis URL it uses an in-memory store that works the same

import Redis from "ioredis";

const TTL_S = 6 * 60 * 60; // Abandoned rooms are deleted after this
const LOCK_MS = 2500; // A held lock expires after this, so a crashed server can't jam a room
// Must be longer than the lock time, so a waiter is still trying when a dead server's lock ends
// Uses a deadline, not a retry count, so slow Redis trips don't matter
const LOCK_WAIT_MS = LOCK_MS + 600;

// Sites sharing one Redis each set their own room namespace so rooms never mix
// Empty keeps the old keys, give two sites the same one only for cross play
const ROOM_NS = (process.env.ROOM_NS || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
const NS_PREFIX = ROOM_NS ? `${ROOM_NS}:` : "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => Math.random().toString(36).slice(2);

function memoryStore() {
  const wallets = new Map();
  const stats = new Map(); // Counts per field for each day
  const events = []; // Raw records, newest first
  const clientErrors = []; // Browser crash reports, newest first
  const rooms = new Map(); // Room code to the room and when it was saved
  const locks = new Map();
  const subs = new Map();
  const listings = new Map();

  // Clears old rooms so a long running dev server doesn't pile them up
  setInterval(() => {
    const cut = Date.now() - TTL_S * 1000;
    for (const [code, e] of rooms) if (e.at < cut) rooms.delete(code);
  }, 600000).unref?.();

  return {
    kind: "memory",
    ns: ROOM_NS || null,
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
    async lock(code, { waitMs = LOCK_WAIT_MS } = {}) {
      const deadline = Date.now() + waitMs; // No wait means one try, then give up
      for (;;) {
        if (!locks.has(code)) {
          const t = token();
          locks.set(code, t);
          setTimeout(() => {
            if (locks.get(code) === t) locks.delete(code); // Clears a lock that was never released
          }, LOCK_MS).unref?.();
          return t;
        }
        if (Date.now() >= deadline) return null;
        await sleep(100);
      }
    },
    async unlock(code, t) {
      if (locks.get(code) === t) locks.delete(code);
    },
    async listAdd(code, summary) {
      listings.set(code, JSON.parse(JSON.stringify(summary)));
    },
    async listRemove(code) {
      listings.delete(code);
    },
    async listAll() {
      return [...listings.values()].map((s) => JSON.parse(JSON.stringify(s)));
    },
    // One trip instead of two, any delay here feels like input lag
    async setAndPublish(code, obj, payload) {
      await this.set(code, obj);
      await this.publish(code, payload);
    },
    // Locks and loads the room in one trip, if the lock was taken the loaded room is thrown away
    async lockAndGet(code, opts) {
      const t = await this.lock(code, opts);
      if (!t) return { token: null, room: null };
      return { token: t, room: await this.get(code) };
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
    // Same shape as the Redis store so local testing works the same
    async walletGet(key) {
      const w = wallets.get(key);
      return w ? { ...w } : { balance: 0, daily: "", adDay: "", adCount: 0, created: "", cos: "", streakAt: "" };
    },
    async walletInit(key, balance) {
      if (wallets.has(key)) return false;
      wallets.set(key, { balance: Math.round(balance), daily: "", adDay: "", adCount: 0, created: new Date().toISOString(), cos: "", streakAt: "" });
      return true;
    },
    async walletAdd(key, delta) {
      const w = wallets.get(key) || { balance: 0, daily: "", adDay: "", adCount: 0, created: new Date().toISOString() };
      w.balance = Math.max(0, w.balance + Math.round(delta));
      wallets.set(key, w);
      return w.balance;
    },
    async walletDebit(key, amount) {
      const w = wallets.get(key);
      const amt = Math.round(amount);
      if (!w || w.balance < amt) return null;
      w.balance -= amt;
      return w.balance;
    },
    async walletSetField(key, field, value) {
      const w = wallets.get(key) || { balance: 0, daily: "", adDay: "", adCount: 0, created: new Date().toISOString() };
      w[field] = field === "adCount" ? Number(value) : String(value);
      wallets.set(key, w);
    },
    // Same shape as the Redis store so local testing works the same
    async bumpStats(day, fields, records = []) {
      for (const bucket of [day, "all"]) {
        if (!stats.has(bucket)) stats.set(bucket, {});
        const h = stats.get(bucket);
        for (const [f, v] of Object.entries(fields)) if (v) h[f] = (h[f] || 0) + Math.round(v);
      }
      events.unshift(...records);
      events.length = Math.min(events.length, 500);
    },
    async readStats(day) {
      return { day: stats.get(day) || {}, all: stats.get("all") || {}, recent: events.slice(0, 50) };
    },
    async saveClientError(rec) {
      clientErrors.unshift(rec);
      clientErrors.length = Math.min(clientErrors.length, 300);
    },
    async readClientErrors(n = 100) {
      return clientErrors.slice(0, n);
    },
  };
}

function redisStore(url) {
  // The prefix keeps this site's keys apart when sites share one Redis
  // The subscriber strips it using the channel prefix length, so any prefix works
  const KEY = (c) => `${NS_PREFIX}7bust:room:${c}`;
  const LOCK = (c) => `${NS_PREFIX}7bust:lock:${c}`;
  const CH = (c) => `${NS_PREFIX}7bust:ch:${c}`;
  const LIST = `${NS_PREFIX}7bust:public`; // Room code to its summary
  const STATS = (day) => `${NS_PREFIX}7bust:stats:${day}`;
  const EVENTS = `${NS_PREFIX}7bust:events`; // Latest raw records, capped
  const CLIENTERR = `${NS_PREFIX}7bust:clienterrors`; // Latest browser crash reports, capped
  const WALLET = (k) => `${NS_PREFIX}7bust:wallet:${k}`; // Balance and the daily and ad claim info
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
    ns: ROOM_NS || null,
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
    async lock(code, { waitMs = LOCK_WAIT_MS } = {}) {
      const t = token();
      const deadline = Date.now() + waitMs; // No wait means one try, then give up
      for (;;) {
        const ok = await redis.set(LOCK(code), t, "PX", LOCK_MS, "NX");
        if (ok) return t;
        if (Date.now() >= deadline) return null;
        await sleep(100);
      }
    },
    async unlock(code, t) {
      // Only release our own lock
      await redis.eval(`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`, 1, LOCK(code), t);
    },
    async listAdd(code, summary) {
      await redis.hset(LIST, code, JSON.stringify(summary));
    },
    async listRemove(code) {
      await redis.hdel(LIST, code);
    },
    async listAll() {
      const all = await redis.hgetall(LIST);
      const out = [];
      for (const raw of Object.values(all || {})) {
        try {
          out.push(JSON.parse(raw));
        } catch {
          // Skip a broken entry
        }
      }
      return out;
    },
    async publish(code, payload) {
      await redis.publish(CH(code), JSON.stringify(payload));
    },
    // Saves and sends in one trip, almost all the server time on an action was Redis trips
    // Every trip removed here is felt by the player
    async setAndPublish(code, obj, payload) {
      await redis
        .pipeline()
        .set(KEY(code), JSON.stringify(obj), "EX", TTL_S)
        .publish(CH(code), JSON.stringify(payload))
        .exec();
    },
    // Locks and loads in one trip, the load runs either way since it costs nothing extra
    async lockAndGet(code, { waitMs = LOCK_WAIT_MS } = {}) {
      const t = token();
      const deadline = Date.now() + waitMs;
      for (;;) {
        const res = await redis.pipeline().set(LOCK(code), t, "PX", LOCK_MS, "NX").get(KEY(code)).exec();
        const gotLock = res && res[0] && res[0][1];
        if (gotLock) {
          const raw = res[1] && res[1][1];
          return { token: t, room: raw ? JSON.parse(raw) : null };
        }
        if (Date.now() >= deadline) return { token: null, room: null };
        await sleep(100);
      }
    },
    // Counters instead of raw events, one batched trip per call
    // keeps us well inside Upstash's limits however busy the game gets
    async bumpStats(day, fields, records = []) {
      const p = redis.pipeline();
      for (const [f, v] of Object.entries(fields)) {
        if (!v) continue;
        p.hincrby(STATS(day), f, Math.round(v));
        p.hincrby(STATS("all"), f, Math.round(v));
      }
      p.expire(STATS(day), 60 * 60 * 24 * 120); // Daily buckets are kept for about four months
      if (records.length) {
        p.lpush(EVENTS, ...records.map((r) => JSON.stringify(r)));
        p.ltrim(EVENTS, 0, 499); // Only the latest ones, for checking by eye
      }
      await p.exec();
    },
    async readStats(day) {
      const [today, all, recent] = await Promise.all([
        redis.hgetall(STATS(day)),
        redis.hgetall(STATS("all")),
        redis.lrange(EVENTS, 0, 49),
      ]);
      return { day: today || {}, all: all || {}, recent: (recent || []).map((r) => JSON.parse(r)) };
    },
    // Keeps the latest browser errors so a live crash can be looked at
    // without needing a player to screenshot it
    async saveClientError(rec) {
      await redis.pipeline().lpush(CLIENTERR, JSON.stringify(rec)).ltrim(CLIENTERR, 0, 299).expire(CLIENTERR, 60 * 60 * 24 * 30).exec();
    },
    async readClientErrors(n = 100) {
      const rows = await redis.lrange(CLIENTERR, 0, Math.max(0, n - 1));
      return (rows || [])
        .map((r) => {
          try {
            return JSON.parse(r);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    },
    // Wallets are kept on the server, keyed by a hash of the CrazyGames user ID
    // Increments are atomic so two requests at once can't spend or pay twice
    async walletGet(key) {
      const h = (await redis.hgetall(WALLET(key))) || {};
      return { balance: Number(h.balance || 0), daily: h.daily || "", adDay: h.adDay || "", adCount: Number(h.adCount || 0), created: h.created || "", cos: h.cos || "", streakAt: h.streakAt || "" };
    },
    async walletInit(key, balance) {
      // Only writes if the wallet is new, so a returning player is never reset
      const created = await redis.hsetnx(WALLET(key), "created", new Date().toISOString());
      if (created) await redis.hset(WALLET(key), "balance", Math.round(balance));
      return created === 1;
    },
    async walletAdd(key, delta) {
      const bal = await redis.hincrby(WALLET(key), "balance", Math.round(delta));
      if (bal < 0) return await redis.hincrby(WALLET(key), "balance", -bal); // Never goes below zero
      return bal;
    },
    // Only takes chips that are there, a debit that lands second sees a negative balance
    // puts its amount back and fails
    async walletDebit(key, amount) {
      const amt = Math.round(amount);
      const bal = await redis.hincrby(WALLET(key), "balance", -amt);
      if (bal < 0) {
        await redis.hincrby(WALLET(key), "balance", amt);
        return null;
      }
      return bal;
    },
    async walletSetField(key, field, value) {
      await redis.hset(WALLET(key), field, String(value));
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

// One store per process, everything that uses it must share the same data
// A second memory store would hide data and a second Redis link wastes a connection
let instance = null;
export function createStore() {
  if (instance) return instance;
  const url = process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_URL;
  const nsLabel = ROOM_NS ? ` (namespace "${ROOM_NS}")` : "";
  if (url) {
    console.log(`Room store: redis (shared across instances)${nsLabel}`);
    instance = redisStore(url);
  } else {
    console.log(`Room store: in-memory (single process)${nsLabel}`);
    instance = memoryStore();
  }
  return instance;
}
