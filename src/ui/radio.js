// Background music radio, it lives outside the app so music keeps playing through redraws
// Volume is saved but mute isn't, a saved mute made the game seem broken

const MUSIC = "audio/Casino-1.mp3";
const KEY = "7bust:radio";
const DEFAULT_VOL = 0.35;

let audio = null;
let muted = false;
let volume = DEFAULT_VOL;
let started = false;
let available = true;

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (typeof p.volume === "number") volume = p.volume;
  } catch {
    // No saved settings, use the defaults
  }
  // A saved silent volume looks like broken music, so use the default
  if (!(volume > 0)) volume = DEFAULT_VOL;
}
function savePrefs() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ volume }));
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
  audio.volume = volume;
  audio.addEventListener("error", () => {
    // Music file missing, it's too big to commit, so hide the radio
    available = false;
    const el = document.getElementById("radio");
    if (el) el.style.display = "none";
  });

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
    audio.volume = muted ? 0 : volume;
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
    audio.volume = muted ? 0 : volume;
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
  if (!muted) tryPlay();
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
