// Emote and speech bubbles over a player's seat
// Added to the page body so they survive the game redrawing

function anchor(seat) {
  const el = document.querySelector(`[data-seat="${seat}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top };
}

function clearOld(seat, cls) {
  document.querySelectorAll(`.${cls}[data-bseat="${seat}"]`).forEach((e) => e.remove());
}

export function showEmote(seat, emoji) {
  const a = anchor(seat);
  if (!a) return;
  clearOld(seat, "emote-pop");
  const el = document.createElement("div");
  el.className = "emote-pop";
  el.dataset.bseat = seat;
  el.textContent = emoji;
  el.style.left = `${a.x}px`;
  el.style.top = `${a.y}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

export function showSpeech(seat, text) {
  const a = anchor(seat);
  if (!a) return;
  clearOld(seat, "speech-pop");
  const el = document.createElement("div");
  el.className = "speech-pop";
  el.dataset.bseat = seat;
  el.textContent = text;
  el.style.left = `${a.x}px`;
  el.style.top = `${a.y}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
