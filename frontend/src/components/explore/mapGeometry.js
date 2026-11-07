// Pure geometry for the map: per-space extents, the fit projection, and the pan/zoom
// transform applied on top of it. No React, no canvas — the draw loop, the gesture hook and
// `node --test` all consume the same functions.

export const PAD = 18;

// 1x is fit-to-plot; 12x is the point past which 640 dots stop being a map and become a few
// dots on an empty field.
export const MIN_K = 1;
export const MAX_K = 12;
export const FIT_VIEW = { k: 1, tx: 0, ty: 0 };
// How far past the plot edge the map may be pushed, as a fraction of the plot, so dots under an
// overlay (the year strip, the toolbar) can always be moved clear of it.
export const PAN_SLACK = 0.3;

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

// Decelerating: the arrival is the informative part of a move, so it gets the time. Shared by
// the dot tween (ExploreMap) and the camera moves (useOrbitCamera).
export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Screen position = base x k + translate. Keeping this one line separate is what lets the
// gesture maths and the draw loop agree by construction.
export function applyView({ x, y }, view) {
  return { x: x * view.k + view.tx, y: y * view.k + view.ty };
}

// The fit scale for a space; computed once per layout, and once per projectPoint call.
function scalesFor({ minX, maxX, minY, maxY }, size) {
  return { sx: (size.w - PAD * 2) / (maxX - minX), sy: (size.h - PAD * 2) / (maxY - minY) };
}

// The one place a raw map coordinate becomes a screen position, so a dot and a cluster label
// (which sits on a raw coordinate) can never disagree about where a spot on the map is.
function placeAt(c, ext, sc, size, view) {
  const base = {
    x: PAD + (c[0] - ext.minX) * sc.sx,
    // Canvas y grows downward; flip so the plot reads like a chart.
    y: size.h - PAD - (c[1] - ext.minY) * sc.sy,
  };
  return applyView(base, view);
}

export function projectPoint(coord, extents, size, view) {
  return placeAt(coord, extents, scalesFor(extents, size), size, view);
}

export function layout(songs, spaceKey, size, view) {
  const ext = extentsFor(songs, spaceKey);
  const sc = scalesFor(ext, size);
  const out = [];
  for (const song of songs) {
    const c = song.coords[spaceKey];
    if (!c) continue;
    const { x, y } = placeAt(c, ext, sc, size, view);
    out.push({ id: song.id, song, x, y });
  }
  return out;
}

// True when a screen point is outside the plot or within `margin` (a fraction of each side) of
// its edge: the test the guided walk uses to decide whether the camera must follow.
export function outsideCore(point, size, margin = 0.2) {
  return point.x < size.w * margin || point.x > size.w * (1 - margin)
    || point.y < size.h * margin || point.y > size.h * (1 - margin);
}

// Translate the view so the screen point lands at the plot centre (clamped to keep the plot covered).
export function viewCentredOn(view, point, size) {
  return clampView({
    k: view.k,
    tx: view.tx + (size.w / 2 - point.x),
    ty: view.ty + (size.h / 2 - point.y),
  }, size, 0);   // no slack: the walk centres within the plot, it never pushes the map off it
}

// At k the content is size x k, so with no slack the translate runs from (size - size x k) — the
// far edge flush — to 0, which at k = 1 collapses to exactly 0. `slack` (a fraction of the plot,
// PAN_SLACK by default) widens both ends so the map can be pushed that far past the edge; 1x is
// then "fit" only when the translate is 0, which is what Reset restores.
export function clampView(view, size, slack = PAN_SLACK) {
  const k = Math.min(MAX_K, Math.max(MIN_K, view.k));
  const sx = size.w * slack;
  const sy = size.h * slack;
  const minTx = size.w - size.w * k - sx;
  const minTy = size.h - size.h * k - sy;
  return {
    k,
    tx: Math.min(sx, Math.max(minTx, view.tx)),
    ty: Math.min(sy, Math.max(minTy, view.ty)),
  };
}

// Zoom toward a screen point: that point must address the same content before and after,
// which fixes the translate once k is chosen. The caller clamps the result against the plot.
export function zoomAtPoint(view, nextK, px, py) {
  const k = Math.min(MAX_K, Math.max(MIN_K, nextK));
  const ratio = k / view.k;
  return { k, tx: px - (px - view.tx) * ratio, ty: py - (py - view.ty) * ratio };
}
