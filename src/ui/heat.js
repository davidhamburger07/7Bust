// The table's colour warms up as the hand gets more different cards
// Cool when safe, then amber, ember near the edge, and gold for "Clean 7"

const STOPS = [
  { at: 1, rgb: [52, 224, 196] }, // Same as the cool colour in the CSS
  { at: 3, rgb: [245, 166, 35] }, // Same as the amber colour in the CSS
  { at: 5, rgb: [255, 90, 60] }, // Same as the ember colour in the CSS
  { at: 7, rgb: [255, 209, 92] }, // Same as the gold colour in the CSS
];

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// Returns "r, g, b" so callers can use it at any alpha
export function heatTriple(count) {
  const c = Math.max(STOPS[0].at, Math.min(STOPS[STOPS.length - 1].at, count || 0));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const lo = STOPS[i];
    const hi = STOPS[i + 1];
    if (c <= hi.at) {
      const t = (c - lo.at) / (hi.at - lo.at);
      const [r, g, b] = [0, 1, 2].map((k) => lerp(lo.rgb[k], hi.rgb[k], t));
      return `${r}, ${g}, ${b}`;
    }
  }
  return STOPS[STOPS.length - 1].rgb.join(", ");
}

// Short word for the heat, used as the screen reader label on the rail
export function heatLabel(count) {
  if (count <= 1) return "cool";
  if (count <= 2) return "warming";
  if (count <= 4) return "warm";
  if (count <= 5) return "hot";
  if (count <= 6) return "scorching";
  return "jackpot";
}
