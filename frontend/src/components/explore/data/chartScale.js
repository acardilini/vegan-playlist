// Tiny pure helpers shared by the SVG charts.

// Round a maximum up to 1, 2, 5 or 10 times a power of ten, so axis ticks land on friendly numbers.
export function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const f = v / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

// Every `step`-th index so labels sit at least `minGap` px apart.
export function labelStep(count, innerWidth, minGap = 56) {
  if (count <= 1) return 1;
  return Math.max(1, Math.ceil(minGap / (innerWidth / (count - 1))));
}

// Index of the nearest point for a pointer x inside the plot.
export function nearestIndex(px, left, innerWidth, count) {
  if (count <= 1) return 0;
  const i = Math.round(((px - left) / innerWidth) * (count - 1));
  return Math.min(count - 1, Math.max(0, i));
}

// A series colour: its fixed palette slot, or the neutral grey for the folded Other series.
export function seriesColour(s) {
  return s.colourIndex == null ? 'var(--explore-not-coded)' : `var(--explore-cat-${s.colourIndex + 1})`;
}
