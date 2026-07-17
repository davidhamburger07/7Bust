// Background music radio, it lives outside the app so music keeps playing through redraws
// The track streams so it doesn't all load at once

const MUSIC = "audio/5-hour-casino-music.mp4";
const KEY = "7bust:radio";

let audio = null;
let muted = false;
let volume = 0.35;
let started = false;
let available = true;

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (typeof p.volume === "number") volume = p.volume;
    if (typeof p.muted === "boolean") muted = p.muted;
  } catch {
    // No saved settings, use the defaults
  }
}
function savePrefs() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ volume, muted }));
  } catch {
    // Analytics failing never affects the game
  }
}

function tryPlay() {
  if (audio && available && audio.paused) audio.play().catch(() => {});
}

export function initRadio() {
  loadPrefs();
  audio = new Audio(MUSIC);
  audio.loop = true;
  audio.preload = "none";
  audio.volume = muted ? 0 : volume;
  audio.addEventListener("error", () => {
    // Music file missing, it's too big to commit, so hide the radio
    available = false;
    const el = document.getElementById("radio");
    if (el) el.style.display = "none";
  });

  const el = document.createElement("div");
  el.id = "radio";
  el.className = "radio" + (muted ? " muted" : "");
  el.innerHTML = `
    <button class="radio-btn" type="button" aria-label="Mute or unmute the music">${muted ? "🔇" : "🔊"}</button>
    <input class="radio-vol" type="range" min="0" max="100" value="${Math.round(volume * 100)}" aria-label="Music volume" />
    <span class="radio-label">7BUST&nbsp;FM</span>`;
  document.body.appendChild(el);

  const btn = el.querySelector(".radio-btn");
  const vol = el.querySelector(".radio-vol");

  btn.addEventListener("click", () => {
    muted = !muted;
    audio.volume = muted ? 0 : volume;
    btn.textContent = muted ? "🔇" : "🔊";
    el.classList.toggle("muted", muted);
    if (!muted) tryPlay();
    savePrefs();
  });

  vol.addEventListener("input", () => {
    volume = vol.value / 100;
    if (volume > 0 && muted) {
      muted = false;
      btn.textContent = "🔊";
      el.classList.remove("muted");
    }
    audio.volume = muted ? 0 : volume;
    if (!muted) tryPlay();
    savePrefs();
  });
}

// Call this on the first tap or key press, audio can't play before one
export function startRadio() {
  if (started) return;
  started = true;
  if (!muted) tryPlay();
}
