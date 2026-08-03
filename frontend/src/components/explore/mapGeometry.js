// Pure geometry for the map: per-space extents, the fit projection, and the pan/zoom
// transform applied on top of it. No React, no canvas — the draw loop, the gesture hook and
// `node --test` all consume the same functions.

export const PAD = 18;

// 1x is fit-to-plot; 12x is the point past which 640 dots stop being a map and become a few
// dots on an empty field.
export const MIN_K = 1;
export const MAX_K = 12;
export const FIT_VIEW = { k: 1, tx: 0, ty: 0 };

// Each space is projected on its own scale (audio_2d x spans -2.9..12.3 where
// holistic_2d spans -4.7..5.1), so extents are recomputed per space — never assume a
// shared domain.
export function extentsFor(songs, spaceKey) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of songs) {
    const c = s.coords[spaceKey];
    if (!c) continue;
    if (c[0] < minX) minX = c[0];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[1] > maxY) maxY = c[1];
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  if (minX === maxX) { minX -= 0.5; maxX += 0.5; }
  if (minY === maxY) { minY -= 0.5; maxY += 0.5; }
  return { minX, maxX, minY, maxY };
}

// Screen position = base x k + translate. Keeping this one line separate is what lets the
// gesture maths and the draw loop agree by construction.
export function applyView({ x, y }, view) {
  return { x: x * view.k + view.tx, y: y * view.k + view.ty };
}

export function layout(songs, spaceKey, size, view) {
  const { minX, maxX, minY, maxY } = extentsFor(songs, spaceKey);
  const sx = (size.w - PAD * 2) / (maxX - minX);
  const sy = (size.h - PAD * 2) / (maxY - minY);
  const out = [];
  for (const song of songs) {
    const c = song.coords[spaceKey];
    if (!c) continue;
    const base = {
      x: PAD + (c[0] - minX) * sx,
      // Canvas y grows downward; flip so the plot reads like a chart.
      y: size.h - PAD - (c[1] - minY) * sy,
    };
    const { x, y } = applyView(base, view);
    out.push({ id: song.id, song, x, y });
  }
  return out;
}

// The plot must stay covered: at k the content is size x k, so the translate may run from
// (size - size x k) — the far edge flush — to 0. At k = 1 that collapses to exactly 0, which
// is why 1x is fit and not "zoomed out with slack".
export function clampView(view, size) {
  const k = Math.min(MAX_K, Math.max(MIN_K, view.k));
  const minTx = size.w - size.w * k;
  const minTy = size.h - size.h * k;
  return {
    k,
    tx: Math.min(0, Math.max(minTx, view.tx)),
    ty: Math.min(0, Math.max(minTy, view.ty)),
  };
}

// Zoom toward a screen point: that point must address the same content before and after,
// which fixes the translate once k is chosen. The caller clamps the result against the plot.
export function zoomAtPoint(view, nextK, px, py) {
  const k = Math.min(MAX_K, Math.max(MIN_K, nextK));
  const ratio = k / view.k;
  return { k, tx: px - (px - view.tx) * ratio, ty: py - (py - view.ty) * ratio };
}
