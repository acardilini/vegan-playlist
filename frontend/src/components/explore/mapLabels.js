// Pure label placement for the Explore map: which cluster labels fit on the plot right now.
// No React, no canvas (the caller supplies a text-width function), so `node --test` exercises it.
//
// Labels come in two levels. Level 1 (the coarse regions) is always eligible and always wins a
// collision; level 2 (finer regions) is only offered once zoomed in (`labelsAtZoom`). Within a
// level the larger region wins, so zooming in - which spreads the centres apart - keeps
// revealing more labels.

// Zoom (2D view scale, or 3D camera zoom) at which the finer level becomes eligible.
export const FINE_ZOOM = 1.6;

export function labelsAtZoom(labels, zoom) {
  return zoom >= FINE_ZOOM ? labels : labels.filter(l => (l.level || 1) === 1);
}

export function truncateLabel(text, max = 34) {
  const s = String(text);
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function placeLabels(items, measure, bounds, opts = {}) {
  const { height = 16, gap = 6 } = opts;
  const ordered = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => Number.isFinite(item.x) && Number.isFinite(item.y)
      && item.x >= 0 && item.x <= bounds.w && item.y >= 0 && item.y <= bounds.h)
    .sort((a, b) => (a.item.level || 1) - (b.item.level || 1)
      || b.item.count - a.item.count || a.index - b.index);
  const placed = [];
  for (const { item } of ordered) {
    const half = measure(item.text) / 2 + gap;
    const box = {
      x0: item.x - half, x1: item.x + half,
      y0: item.y - height / 2, y1: item.y + height / 2,
    };
    const clash = placed.some(p => box.x0 < p.box.x1 && box.x1 > p.box.x0
      && box.y0 < p.box.y1 && box.y1 > p.box.y0);
    if (!clash) placed.push({ ...item, box });
  }
  return placed;
}
