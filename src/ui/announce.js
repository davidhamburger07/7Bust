// Big announcements, a slam banner, a shouty voice and simple synth sound effects
// Browsers block audio until the player clicks, so start audio from the first click

let ac = null;

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

export function sfx(kind) {
  if (!ac) return;
  switch (kind) {
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

export function speak(text, { rate = 1.05, pitch = 1.25 } = {}) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = pitch;
    u.volume = 1;
    synth.speak(u);
  } catch {
    // No speech engine, the game plays without the voice
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
  bust: { slam: "bust", title: "BUST!", sub: "you went over", say: "Bust!", sfx: "buzzer", shake: true },
  frozen: { slam: "freeze", title: "FROZEN!", sub: "you're iced out", say: "You are frozen!", sfx: "freeze", shake: true },
  clean7: { slam: "clean7", title: "CLEAN 7!", sub: "+15 bonus", say: "Clean seven!", sfx: "fanfare", coins: true },
  flip3: { slam: "flip3", title: "FLIP THREE!", sub: "draw three", say: "Flip three!", sfx: "blip", shake: true },
  win: { slam: "win", title: "YOU WIN!", sub: "you take the pot", say: "Winner, winner!", sfx: "jackpot", coins: true, shake: true },
  lose: { slam: "lose", title: "TABLE'S CLOSED", sub: "better luck next time", say: "Better luck next time!", sfx: "sad" },
};

export function announce(kind) {
  const m = MOMENTS[kind];
  if (!m) return;
  slam(m.slam, m.title, m.sub);
  sfx(m.sfx);
  speak(m.say);
  if (m.shake) shakeStage();
  if (m.coins) rainCoins();
}
