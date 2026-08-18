// Background music radio, it lives outside the app so music keeps playing through redraws
// Volume is saved but mute isn't, a saved mute made the game seem broken

import * as storage from "../net/storage.js";

// Shuffled tracks by Kevin MacLeod under CC BY 4.0, the credit must show in "How to Play"
// and in each store listing. Only add a track whose licence you've checked
const PLAYLIST = [
  "audio/radio/deadly-roulette.mp3",
  "audio/radio/deuces.mp3",
  "audio/radio/hard-boiled.mp3",
  "audio/radio/backbay-lounge.mp3",
  "audio/radio/bossa-antigua.mp3",
  "audio/radio/lobby-time.mp3",
  "audio/radio/jazz-brunch.mp3",
  "audio/radio/night-in-venice.mp3",
  "audio/radio/samba-isobel.mp3",
  "audio/radio/zazie.mp3",
  "audio/radio/on-hold-for-you.mp3",
  "audio/radio/poppers-and-prosecco.mp3",
];
const KEY = "7bust:radio";
const DEFAULT_VOL = 0.2; // Starts quiet so the music doesn't blast anyone on arrival

let audio = null;
let muted = false;
let volume = DEFAULT_VOL;
let started = false;
let available = true;
let tracks = [];
let idx = 0;
let errStreak = 0; // Load fails in a row, if the whole playlist fails give up

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

// Turns "deadly-roulette.mp3" into "Deadly Roulette" for the playlist
const title = (src) =>
  String(src)
    .split("/")
    .pop()
    .replace(/\.mp3$/i, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

function loadTrack(i, { play = false } = {}) {
  if (!audio || !tracks.length) return;
  idx = ((i % tracks.length) + tracks.length) % tracks.length;
  audio.src = tracks[idx];
  refreshRadio();
  if (play) tryPlay();
}

// A click counts as a user gesture so playback is allowed, the platform mute still wins
// Resets the fail count, picking a track isn't a failure
function skipTo(i) {
  started = true;
  errStreak = 0;
  loadTrack(i, { play: true });
}
const nextTrack = () => skipTo(idx + 1);
const prevTrack = () => skipTo(idx - 1);

function refreshRadio() {
  const now = title(tracks[idx] || "");
  const el = document.getElementById("radio");
  if (el) {
    const btn = el.querySelector(".radio-btn");
    const label = el.querySelector(".radio-label");
    if (btn) btn.textContent = muted ? "🔇" : "🔊";
    el.classList.toggle("muted", muted);
    if (label) label.textContent = muted ? "MUTED" : now;
  }
  // Keep every volume slider up to date but leave alone the one the player is dragging
  const pct = Math.round(volume * 100);
  document.querySelectorAll(".radio-vol, .radio-panel-vol").forEach((s) => {
    if (s !== document.activeElement) s.value = pct;
  });
  // The menu sits on the page body, not in the radio, so find it by ID
  const panel = document.getElementById("radio-panel");
  if (panel) {
    const nowTitle = panel.querySelector(".radio-now-title");
    if (nowTitle) nowTitle.textContent = now;
    const pmute = panel.querySelector(".radio-panel-mute");
    if (pmute) pmute.textContent = muted ? "🔇" : "🔊";
    panel.classList.toggle("muted", muted);
    panel.querySelectorAll(".radio-item").forEach((b) => b.classList.toggle("active", Number(b.dataset.i) === idx));
  }
}
// CrazyGames' own mute beats the player's mute and volume
// Every way to start the music checks it, so no in-game control can undo it
let platformMuted = false;

function loadPrefs() {
  try {
    const p = JSON.parse(storage.getItem(KEY) || "{}");
    if (typeof p.volume === "number") volume = p.volume;
  } catch {
    // No saved settings, use the defaults
  }
  // A saved silent volume looks like broken music, so use the default
  if (!(volume > 0)) volume = DEFAULT_VOL;
}
function savePrefs() {
  try {
    storage.setItem(KEY, JSON.stringify({ volume }));
  } catch {
    // Analytics failing never affects the game
  }
}

function tryPlay() {
  if (platformMuted) return;
  if (audio && available && audio.paused) audio.play().catch(() => {});
}

// The volume the music should play at, with both mutes counted
const applyVolume = () => {
  if (audio) audio.volume = platformMuted || muted ? 0 : volume;
};

// Every slider and the settings menu set the volume here, so they never drift apart
// Dragging it up also unmutes, the player clearly wants to hear it
function setVolume(pct) {
  volume = Math.max(0, Math.min(100, pct)) / 100;
  if (volume > 0 && muted) muted = false;
  applyVolume();
  refreshRadio();
  if (!muted) tryPlay();
  savePrefs();
}

// Used by both mute buttons so they always match
function toggleMute() {
  muted = !muted;
  if (!muted && !(volume > 0)) volume = 0.2; // Unmuting never lands on silence
  applyVolume();
  refreshRadio();
  if (!muted) tryPlay();
  savePrefs();
}

export function initRadio() {
  loadPrefs();
  tracks = shuffle(PLAYLIST);
  audio = new Audio();
  audio.loop = false; // Plays the next track when one ends
  audio.preload = "none";
  audio.volume = volume;
  audio.src = tracks[0];
  audio.addEventListener("ended", () => {
    errStreak = 0;
    loadTrack(idx + 1, { play: true });
  });
  audio.addEventListener("error", () => {
    // A track failed, skip to the next. Only hide the radio if every track fails in a row
    if (++errStreak >= tracks.length) {
      available = false;
      const el = document.getElementById("radio");
      if (el) el.style.display = "none";
      return;
    }
    loadTrack(idx + 1, { play: started && !platformMuted });
  });
  audio.addEventListener("playing", () => (errStreak = 0)); // A track that plays resets the fail count

  const el = document.createElement("div");
  el.id = "radio";
  el.className = "radio";
  el.innerHTML = `
    <button class="radio-btn" type="button" aria-label="Mute or unmute the music">🔊</button>
    <input class="radio-vol" type="range" min="0" max="100" value="${Math.round(volume * 100)}" aria-label="Music volume" />
    <span class="radio-label">7BUST&nbsp;FM</span>
    <button class="radio-open" type="button" aria-label="Open the playlist" aria-expanded="false" aria-controls="radio-panel">▾</button>`;
  document.body.appendChild(el);

  // The playlist menu sits on the page body, not inside the radio
  // The radio gets moved on every redraw, so a menu inside it would vanish mid click
  const rows = tracks
    .map((src, i) => `<li><button class="radio-item" type="button" data-i="${i}">${title(src)}</button></li>`)
    .join("");
  const panel = document.createElement("div");
  panel.id = "radio-panel";
  panel.className = "radio-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "7BUST FM playlist");
  panel.hidden = true;
  panel.innerHTML = `
    <div class="radio-panel-top"><span class="radio-fm">7BUST&nbsp;FM</span><button class="radio-close" type="button" aria-label="Close the playlist">×</button></div>
    <div class="radio-now">
      <button class="radio-prev" type="button" aria-label="Previous track">⏮</button>
      <span class="radio-now-title"></span>
      <button class="radio-next" type="button" aria-label="Next track">⏭</button>
    </div>
    <div class="radio-vol-row">
      <button class="radio-panel-mute" type="button" aria-label="Mute or unmute the music">🔊</button>
      <input class="radio-panel-vol" type="range" min="0" max="100" value="${Math.round(volume * 100)}" aria-label="Music volume" />
    </div>
    <ol class="radio-list">${rows}</ol>`;
  document.body.appendChild(panel);

  const btn = el.querySelector(".radio-btn");
  const vol = el.querySelector(".radio-vol");
  const open = el.querySelector(".radio-open");

  const positionPanel = () => {
    const w = document.getElementById("radio");
    if (!w) return;
    const r = w.getBoundingClientRect();
    const ph = panel.offsetHeight || 300;
    const pw = panel.offsetWidth || 240;
    const down = r.top < ph + 16; // Not enough room above, open downwards
    panel.classList.toggle("drop-down", down);
    panel.style.left = `${Math.round(Math.min(Math.max(6, r.left), window.innerWidth - pw - 6))}px`;
    panel.style.top = down ? `${Math.round(r.bottom + 10)}px` : `${Math.round(r.top - ph - 10)}px`;
  };
  let raf = 0;
  const track = () => {
    if (panel.hidden) {
      raf = 0;
      return;
    }
    // One bad frame, like the radio being moved during a redraw, mustn't throw on every frame
    // that would flood the console
    try {
      positionPanel();
    } catch {
      // Skip this frame but keep the loop going
    }
    raf = requestAnimationFrame(track);
  };
  const setPanel = (show) => {
    panel.hidden = !show;
    el.classList.toggle("open", show);
    open.setAttribute("aria-expanded", show ? "true" : "false");
    if (show) {
      positionPanel();
      if (!raf) raf = requestAnimationFrame(track);
      const active = panel.querySelector(".radio-item.active");
      if (active) active.scrollIntoView({ block: "nearest" });
    }
  };

  btn.addEventListener("click", toggleMute);
  vol.addEventListener("input", () => setVolume(Number(vol.value)));

  // The menu has its own volume and mute, on phones it's the only place to change them
  const pvol = panel.querySelector(".radio-panel-vol");
  pvol.addEventListener("input", () => setVolume(Number(pvol.value)));
  panel.querySelector(".radio-panel-mute").addEventListener("click", toggleMute);

  open.addEventListener("click", () => setPanel(panel.hidden));
  panel.querySelector(".radio-close").addEventListener("click", () => setPanel(false));
  panel.querySelector(".radio-prev").addEventListener("click", prevTrack);
  panel.querySelector(".radio-next").addEventListener("click", nextTrack);
  panel.querySelector(".radio-list").addEventListener("click", (e) => {
    const item = e.target.closest(".radio-item");
    if (item) skipTo(Number(item.dataset.i));
  });
  document.addEventListener("pointerdown", (e) => {
    if (!panel.hidden && !el.contains(e.target) && !panel.contains(e.target)) setPanel(false);
  });
  window.addEventListener("resize", () => {
    if (!panel.hidden) positionPanel();
  });

  refreshRadio();

  // Autoplay needs a user gesture, so catch the first one anywhere on the page, the radio too
  document.addEventListener("pointerdown", () => startRadio(), { capture: true });
  document.addEventListener("keydown", () => startRadio(), { capture: true });
}

// Safe to call more than once, only the first call after a gesture starts the music
export function startRadio() {
  if (started) return;
  started = true;
  if (!platformMuted && !muted) tryPlay();
}

// The player's own mute and volume stay as they were for when the platform unmutes
export function setPlatformMute(on) {
  platformMuted = !!on;
  if (!audio) return;
  if (platformMuted) audio.pause();
  else if (started && !muted) tryPlay();
  applyVolume();
}

// CrazyGames needs game sound off during ads, so pause the music and resume it after
// The player's own mute and volume aren't touched
let pausedForAd = false;
export function pauseForAd() {
  if (platformMuted) return; // Already silent, and coming back from the ad mustn't unmute it
  if (audio && !audio.paused) {
    pausedForAd = true;
    audio.pause();
  }
}
export function resumeAfterAd() {
  if (platformMuted) return;
  if (pausedForAd) {
    pausedForAd = false;
    tryPlay();
  }
}

// For the settings menu, it moves the radio's own controls so everything goes the same way
export function setRadioVolume(pct) {
  const vol = document.querySelector("#radio .radio-vol");
  if (vol) {
    vol.value = Math.max(0, Math.min(100, Math.round(pct)));
    vol.dispatchEvent(new Event("input"));
  }
}
export function getRadioVolume() {
  const vol = document.querySelector("#radio .radio-vol");
  return vol ? Number(vol.value) : Math.round(volume * 100);
}
