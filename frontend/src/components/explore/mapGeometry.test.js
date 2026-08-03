import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIT_VIEW, MAX_K, PAD,
  applyView, clampView, extentsFor, layout, zoomAtPoint,
} from './mapGeometry.js';

const SIZE = { w: 800, h: 520 };
const songs = (coords) => coords.map(([x, y], i) => ({ id: i + 1, coords: { audio: [x, y] } }));

test('extentsFor spans the real coordinates of one space', () => {
  const e = extentsFor(songs([[0, 0], [4, 10]]), 'audio');
  assert.deepEqual(e, { minX: 0, maxX: 4, minY: 0, maxY: 10 });
});

test('extentsFor pads a degenerate axis so the scale never divides by zero', () => {
  const e = extentsFor(songs([[3, 1], [3, 5]]), 'audio');
  assert.equal(e.minX, 2.5);
  assert.equal(e.maxX, 3.5);
});

test('extentsFor returns a unit box when no song has coordinates in this space', () => {
  assert.deepEqual(extentsFor(songs([[1, 1]]), 'holistic'),
    { minX: 0, maxX: 1, minY: 0, maxY: 1 });
});

test('layout fits the extremes to the padded box and flips y', () => {
  const pts = layout(songs([[0, 0], [4, 10]]), 'audio', SIZE, FIT_VIEW);
  assert.equal(pts.length, 2);
  // Min x sits at the left pad; max x at the right pad.
  assert.equal(Math.round(pts[0].x), PAD);
  assert.equal(Math.round(pts[1].x), SIZE.w - PAD);
  // Canvas y grows downward, so the SMALLEST coordinate is the LOWEST pixel.
  assert.equal(Math.round(pts[0].y), SIZE.h - PAD);
  assert.equal(Math.round(pts[1].y), PAD);
});

test('layout skips songs with no coordinates in the chosen space and carries the song', () => {
  const list = [
    { id: 1, coords: { audio: [0, 0] } },
    { id: 2, coords: {} },
  ];
  const pts = layout(list, 'audio', SIZE, FIT_VIEW);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].id, 1);
  assert.equal(pts[0].song, list[0]);
});

test('applyView scales about the origin then translates', () => {
  assert.deepEqual(applyView({ x: 10, y: 20 }, { k: 2, tx: 5, ty: -3 }), { x: 25, y: 37 });
});

test('zoomAtPoint keeps the content under the cursor under the cursor', () => {
  // The whole point of cursor-anchored zoom: the base position that mapped to screen (px, py)
  // must still map to (px, py) afterwards. `before` is the identity view, so that base
  // position is (px, py) itself. px and py are deliberately distinct — a formula that mixed
  // up the axes (e.g. computed ty from px instead of py) would slip through if they matched.
  const before = { k: 1, tx: 0, ty: 0 };
  const px = 100;
  const py = 260;
  const after = zoomAtPoint(before, 3, px, py);
  assert.equal(px * after.k + after.tx, px);
  assert.equal(py * after.k + after.ty, py);
});

test('zoomAtPoint keeps the anchor from a non-identity view too', () => {
  // `before` here is not the identity view, so ratio (nextK / view.k) is numerically
  // different from nextK itself — unlike the identity-view case above, where they collapse
  // to the same number and a formula using nextK where it should use ratio would still pass.
  // k=3, tx=-200, ty=-100 and nextK=6 are chosen so the base position divides out to whole
  // numbers, keeping the assertion exact rather than tolerance-based.
  const before = { k: 3, tx: -200, ty: -100 };
  const px = 100;
  const py = 260;
  const baseX = (px - before.tx) / before.k;   // 100
  const baseY = (py - before.ty) / before.k;   // 120
  const after = zoomAtPoint(before, 6, px, py);
  assert.equal(baseX * after.k + after.tx, px);
  assert.equal(baseY * after.k + after.ty, py);
});

test('zoomAtPoint clamps k to the 1x-12x range', () => {
  assert.equal(zoomAtPoint({ k: 1, tx: 0, ty: 0 }, 40, 0, 0).k, MAX_K);
  assert.equal(zoomAtPoint({ k: 4, tx: 0, ty: 0 }, 0.2, 0, 0).k, 1);
});

test('clampView pins the view to fit at 1x', () => {
  // At 1x the content exactly fills the plot, so any translate would show empty space.
  assert.deepEqual(clampView({ k: 1, tx: 300, ty: -80 }, SIZE), FIT_VIEW);
});

test('clampView keeps the plot covered when panned at zoom', () => {
  const size = { w: 800, h: 520 };
  // At 2x the content is 1600 wide, so tx may run from -800 (right edge flush) to 0.
  assert.equal(clampView({ k: 2, tx: 50, ty: 0 }, size).tx, 0);
  assert.equal(clampView({ k: 2, tx: -5000, ty: 0 }, size).tx, -800);
  assert.equal(clampView({ k: 2, tx: -400, ty: -100 }, size).tx, -400);
  // ty is never asserted above — both bounds collapse to 0 at 1x, so this is the only case
  // that can catch a minTy formula that (e.g.) reused size.w instead of size.h. Same
  // axis-confusion class already caught once in zoomAtPoint, swept here too.
  assert.equal(clampView({ k: 2, tx: 0, ty: -5000 }, size).ty, -520);
});
