// Big announcements, a slam banner, a shouty voice and simple synth sound effects
// Browsers block audio until the player clicks, so start audio from the first click

let ac = null;

// Sound settings from the settings menu, every effect and voice line checks them
let audioPrefs = { sfx: true, voice: true };
export function setAudioPrefs(p) {
  audioPrefs = { ...audioPrefs, ...p };
}

// CrazyGames can mute the game from their own page and their docs say that comes first
// So it's checked before the player's settings everywhere and the settings can't override it
let platformMuted = false;
export function setPlatformMute(on) {
  platformMuted = !!on;
}
export const isPlatformMuted = () => platformMuted;

export function initAudio() {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
    // Wakes up the speech engine
    if (window.speechSynthesis) window.speechSynthesis.getVoices();
  } catch {
    // No audio here, the game still plays silently
  }
}

function tone(freq, startAt, dur, type = "square", gain = 0.18) {
  if (!ac) return;
  const t = ac.currentTime + startAt;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

function sweep(f1, f2, startAt, dur, type = "sawtooth", gain = 0.2) {
  if (!ac) return;
  const t = ac.currentTime + startAt;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f1, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, f2), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

// Filtered noise burst, used for card flips and shuffles
let noiseBuf = null;
function noise(startAt, dur, { type = "bandpass", freq = 2000, q = 1, gain = 0.2 } = {}) {
  if (!ac) return;
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ac.currentTime + startAt;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const filt = ac.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + dur + 0.03);
}

export function sfx(kind) {
  if (platformMuted || !ac || !audioPrefs.sfx) return;
  switch (kind) {
    case "card": // A card flipped onto the table by any player
      noise(0, 0.07, { type: "bandpass", freq: 2100 + Math.random() * 700, q: 0.9, gain: 0.16 });
      tone(170, 0.02, 0.06, "sine", 0.07);
      break;
    case "chips": // Banking chips
      [0, 0.05, 0.1].forEach((s, i) => {
        tone(2500 - i * 120, s, 0.04, "square", 0.1);
        noise(s, 0.03, { type: "highpass", freq: 4200, gain: 0.07 });
      });
      break;
    case "shuffle": // Round start or reshuffle
      for (let i = 0; i < 8; i++) noise(i * 0.03, 0.03, { type: "bandpass", freq: 1700 + Math.random() * 1300, q: 1.3, gain: 0.08 });
      break;
    case "sparkle": // Modifier card
      [1200, 1600, 2000, 2500].forEach((f, i) => tone(f, i * 0.05, 0.12, "triangle", 0.09));
      break;
    case "click":
      tone(880, 0, 0.03, "square", 0.08);
      break;
    case "buzzer": // Bust
      sweep(300, 70, 0, 0.4, "sawtooth", 0.25);
      break;
    case "freeze":
      [1500, 1200, 1000, 800].forEach((f, i) => tone(f, i * 0.06, 0.18, "sine", 0.16));
      sweep(900, 300, 0.1, 0.5, "sine", 0.12);
      break;
    case "fanfare": // "Clean 7"
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.22, "square", 0.16));
      break;
    case "jackpot": // Win
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.24, "square", 0.17));
      [1568, 2093].forEach((f, i) => tone(f, 0.5 + i * 0.08, 0.3, "triangle", 0.12));
      break;
    case "blip": // "Flip Three"
      [820, 820, 820].forEach((f, i) => tone(f, i * 0.09, 0.08, "square", 0.16));
      break;
    case "sad": // Lose
      tone(392, 0, 0.25, "triangle", 0.16);
      tone(294, 0.22, 0.4, "triangle", 0.16);
      break;
    case "ding": // Bank
      tone(1046, 0, 0.16, "triangle", 0.18);
      tone(1568, 0.05, 0.18, "triangle", 0.1);
      break;
    case "tick": // Card flip
      tone(520, 0, 0.05, "square", 0.08);
      break;
    default:
      break;
  }
}

// Recorded announcer voice lines
const VOICE_BASE = "audio/Voicelines/";
const VOICE = {
  bust: ["Busting/BUSTED.mp3", "Busting/DUPLICATE-DRAWN-YOU-ARE-OUT.mp3", "Busting/GREED-IS-YOUR-DOWN-FALL.mp3", "Busting/YOU-GET-A-WHOLE-BUNCH-OF-NOTHING.mp3"],
  frozen: ["Action Cards/Freeze/YOU-HAVE-BEEN-FROZEN.mp3"],
  flip3: ["Action Cards/Flip 3/FLIP-3.mp3", "Action Cards/Flip 3/NO-ESCAPE-DRAW-3.mp3"],
  second: ["Action Cards/Second Chance/SECOND-CHANCE.mp3"],
  clean7: ["Modifiers/SEVEN-WHOLE-UNIQUE-CARDS(1).mp3", "Modifiers/SEVEN-WHOLE-UNIQUE-CARDS(2).mp3"],
  double: ["Modifiers/DOUBLE-POINTS(1).mp3", "Modifiers/DOUBLE-POINTS(2).mp3"],
  unstoppable: ["Modifiers/UNSTOPABLE.mp3"],
  win: ["Victory/FLAWLESS-VICTORY(1).mp3", "Victory/FLAWLESS-VICTORY(2).mp3", "Victory/WE-HAVE-A-CHAMPION(1).mp3", "Victory/WE-HAVE-A-CHAMPION(2).mp3"],
  decision: ["Player Decisions/HIT-OR-STAY.mp3", "Player Decisions/MAKE-YOUR-MOVE.mp3", "Player Decisions/PUSH-YOUR-LUCK.mp3"],
  coward: ["High Tension/A-COWARD-RETREATS(1).mp3", "High Tension/A-COWARD-RETREATS(2).mp3"],
  oneAway: [
    "High Tension/ONE-CARD-AWAY-FROM-GLORY(1).mp3",
    "High Tension/ONE-CARD-AWAY-FROM-GLORY(2).mp3",
    "High Tension/SIX-CARDS-DOWN-DARE-YOU-PULL-THE-SEVENTH(1).mp3",
    "High Tension/SIX-CARDS-DOWN-DARE-YOU-PULL-THE-SEVENTH(2).mp3",
  ],
};

let currentVoice = null;

// Plays a random voice line from a category, only one at a time
export function playVoice(category, { volume = 0.95 } = {}) {
  if (platformMuted || !audioPrefs.voice) return;
  const list = VOICE[category];
  if (!list || !list.length) return;
  const file = list[(Math.random() * list.length) | 0];
  try {
    if (currentVoice) currentVoice.pause();
    const a = new Audio(encodeURI(VOICE_BASE + file));
    a.volume = volume;
    currentVoice = a;
    a.play().catch(() => {});
  } catch {
    // No audio here, the game still plays silently
  }
}

function layer() {
  return document.getElementById("announce");
}

function shakeStage() {
  const s = document.querySelector(".stage");
  if (!s) return;
  s.classList.remove("shake");
  void s.offsetWidth; // Restarts the animation
  s.classList.add("shake");
  setTimeout(() => s.classList.remove("shake"), 500);
}

function rainCoins(n = 18) {
  const el = layer();
  if (!el) return;
  for (let i = 0; i < n; i++) {
    const c = document.createElement("div");
    c.className = "coin";
    c.textContent = Math.random() < 0.5 ? "🪙" : "💰";
    c.style.left = Math.random() * 100 + "%";
    c.style.animationDuration = 1 + Math.random() * 1.3 + "s";
    c.style.animationDelay = Math.random() * 0.3 + "s";
    el.appendChild(c);
    setTimeout(() => c.remove(), 2800);
  }
}

function slam(kind, title, sub) {
  const el = layer();
  if (!el) return;
  const div = document.createElement("div");
  div.className = `slam slam--${kind}`;
  div.innerHTML = `${title}${sub ? `<span class="sub">${sub}</span>` : ""}`;
  el.appendChild(div);
  setTimeout(() => div.remove(), 1900);
}

const MOMENTS = {
  bust: { slam: "bust", title: "BUST!", sub: "you went over", voice: "bust", sfx: "buzzer", shake: true },
  frozen: { slam: "freeze", title: "FROZEN!", sub: "you're iced out", voice: "frozen", sfx: "freeze", shake: true },
  clean7: { slam: "clean7", title: "CLEAN 7!", sub: "+15 bonus", voice: "clean7", sfx: "fanfare", coins: true },
  flip3: { slam: "flip3", title: "FLIP THREE!", sub: "draw three", voice: "flip3", sfx: "blip", shake: true },
  win: { slam: "win", title: "YOU WIN!", sub: "you take the pot", voice: "win", sfx: "jackpot", coins: true, shake: true },
  lose: { slam: "lose", title: "TABLE'S CLOSED", sub: "better luck next time", sfx: "sad" },
};

export function announce(kind) {
  const m = MOMENTS[kind];
  if (!m) return;
  slam(m.slam, m.title, m.sub);
  sfx(m.sfx);
  if (m.voice) playVoice(m.voice);
  if (m.shake) shakeStage();
  if (m.coins) rainCoins();
}
