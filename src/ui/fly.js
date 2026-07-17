// Thrown action cards fly from seat to seat, "Freeze", "Flip Three" or a spare "Second Chance"
// Added to the page body so they survive the game redrawing

const CARDS = {
  frozen: { txt: "FREEZE", icon: "❄", cls: "freeze" },
  flip3: { txt: "FLIP 3", icon: "🔃", cls: "flip3" },
  sc_pass: { txt: "2ND CHANCE", icon: "♻", cls: "second" },
};

export function flyCard(fromSeat, toSeat, kind) {
  const spec = CARDS[kind];
  const src = document.querySelector(`[data-seat="${fromSeat}"]`);
  const dst = document.querySelector(`[data-seat="${toSeat}"]`);
  if (!spec || !src || !dst) return;
  const a = src.getBoundingClientRect();
  const b = dst.getBoundingClientRect();

  const el = document.createElement("div");
  el.className = `flycard flycard--${spec.cls}`;
  el.innerHTML = `<span class="flycard-icon">${spec.icon}</span><span class="flycard-txt">${spec.txt}</span>`;
  el.style.left = `${a.left + a.width / 2}px`;
  el.style.top = `${a.top + a.height / 2}px`;
  el.style.setProperty("--dx", `${b.left + b.width / 2 - (a.left + a.width / 2)}px`);
  el.style.setProperty("--dy", `${b.top + b.height / 2 - (a.top + a.height / 2)}px`);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
