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

function loadTrack(i, { play = false } = {}) {
  if (!audio || !tracks.length) return;
  idx = ((i % tracks.length) + tracks.length) % tracks.length;
  audio.src = tracks[idx];
  if (play) tryPlay();
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
    <span class="radio-label">7BUST&nbsp;FM</span>`;
  document.body.appendChild(el);

  const btn = el.querySelector(".radio-btn");
  const vol = el.querySelector(".radio-vol");
  const label = el.querySelector(".radio-label");

  const paint = () => {
    btn.textContent = muted ? "🔇" : "🔊";
    label.textContent = muted ? "MUTED" : "7BUST FM";
    el.classList.toggle("muted", muted);
  };

  btn.addEventListener("click", () => {
    muted = !muted;
    if (!muted && !(volume > 0)) {
      volume = 0.2; // Unmuting never lands on silence
      vol.value = 20;
    }
    applyVolume();
    paint();
    if (!muted) tryPlay();
    savePrefs();
  });

  vol.addEventListener("input", () => {
    volume = vol.value / 100;
    if (volume > 0 && muted) {
      muted = false;
      paint();
    }
    applyVolume();
    if (!muted) tryPlay();
    savePrefs();
  });

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
