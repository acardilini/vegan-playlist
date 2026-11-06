import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CAMERA, PRESETS, MIN_ZOOM, MAX_ZOOM,
  clampCamera, activePreset, projectCloud, interpolateCamera, sortBackToFront,
  dotRadius, dotAlpha, gizmoAxes, pickPoint,
} from './camera3d.js';

const SIZE = { w: 800, h: 520 };
const cam = (name) => ({ ...DEFAULT_CAMERA, ...PRESETS[name] });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// The server normalises every cloud into [-1/1.15, 1/1.15]^3 on its longest axis, so that is
// the bound the camera must frame with margin; the full unit cube must at least stay in view.
const BOUND = 1 / 1.15;

// The cloud reaches BOUND on its longest axis only, so the guaranteed extremes are the six axis
// ends, not the cube corners (which no real cloud occupies - see the measured fit in the ledger).
function axisEnds(h) {
  return [[h, 0, 0], [-h, 0, 0], [0, h, 0], [0, -h, 0], [0, 0, h], [0, 0, -h]];
}

test('every preset keeps the axis ends of the normalised cloud on the plot, with a margin', () => {
  for (const name of Object.keys(PRESETS)) {
    for (const p of projectCloud(axisEnds(BOUND), cam(name), SIZE)) {
      assert.ok(p.x >= SIZE.w * 0.05 && p.x <= SIZE.w * 0.95, `${name}: x ${p.x} inside 5% margin`);
      assert.ok(p.y >= SIZE.h * 0.05 && p.y <= SIZE.h * 0.95, `${name}: y ${p.y} inside 5% margin`);
    }
  }
});

test('the cloud fills most of the plot, not a speck in the middle', () => {
  // The live clouds spanned ~45% of the plot height at zoom 1 with the old lens (the axis ends
  // alone 50%); the curator asked for more. The axis ends must now span over 60%.
  const pts = projectCloud(axisEnds(BOUND), cam('front'), SIZE);
  const spanY = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y));
  assert.ok(spanY > SIZE.h * 0.6, `front view spans ${spanY}px of ${SIZE.h}`);
});

test('front view maps +x right and +y up, and nearer points get a larger depth factor', () => {
  const [o, px, py, near1, far1] = projectCloud(
    [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]], cam('front'), SIZE);
  assert.ok(px.x > o.x && near(px.y, o.y));
  assert.ok(py.y < o.y && near(py.x, o.x), 'screen y grows downward, so +y is smaller');
  assert.ok(near1.k > o.k && o.k > far1.k, 'k falls with distance');
  assert.ok(near1.depth < far1.depth);
});

test('top view: +y points toward the camera', () => {
  const [up, down] = projectCloud([[0, 1, 0], [0, -1, 0]], cam('top'), SIZE);
  assert.ok(up.k > 1 && down.k < 1);
});

test('projectCloud: null in, null out', () => {
  const out = projectCloud([null, [0, 0, 0]], DEFAULT_CAMERA, SIZE);
  assert.equal(out[0], null);
  assert.ok(out[1]);
});

test('zoom scales the picture without moving the centre; pan shifts it', () => {
  const [a] = projectCloud([[0.5, 0.5, 0]], DEFAULT_CAMERA, SIZE);
  const [b] = projectCloud([[0.5, 0.5, 0]], { ...DEFAULT_CAMERA, zoom: 2 }, SIZE);
  assert.ok(Math.abs(b.x - SIZE.w / 2) > Math.abs(a.x - SIZE.w / 2));
  const [c] = projectCloud([[0, 0, 0]], { ...DEFAULT_CAMERA, panX: 30, panY: -10 }, SIZE);
  assert.ok(near(c.x, SIZE.w / 2 + 30) && near(c.y, SIZE.h / 2 - 10));
});

test('interpolateCamera takes the shortest arc for yaw and returns the endpoints', () => {
  const a = { ...DEFAULT_CAMERA, yaw: 170 };
  const b = { ...DEFAULT_CAMERA, yaw: -170 };
  assert.ok(near(Math.abs(interpolateCamera(a, b, 0.5).yaw), 180));
  assert.deepEqual(interpolateCamera(a, b, 0), a);
  assert.ok(near(interpolateCamera(a, b, 1).yaw, -170));
  const mid = interpolateCamera({ ...DEFAULT_CAMERA, zoom: 1 }, { ...DEFAULT_CAMERA, zoom: 3 }, 0.5);
  assert.ok(near(mid.zoom, 2));
});

test('clampCamera limits pitch, zoom and wraps yaw', () => {
  const c = clampCamera({ yaw: 190, pitch: 120, zoom: 99, panX: 5, panY: 6 });
  assert.equal(c.pitch, 90);
  assert.equal(c.zoom, MAX_ZOOM);
  assert.ok(near(c.yaw, -170));
  assert.equal(clampCamera({ ...DEFAULT_CAMERA, zoom: 0.01 }).zoom, MIN_ZOOM);
  assert.equal(clampCamera({ ...DEFAULT_CAMERA, pitch: -120 }).pitch, -90);
});

test('clampCamera keeps the cloud centre on the plot when given the plot size', () => {
  const c = clampCamera({ ...DEFAULT_CAMERA, panX: 100000, panY: -100000 }, SIZE);
  assert.equal(c.panX, SIZE.w / 2);
  assert.equal(c.panY, -SIZE.h / 2);
  // a pan already inside the plot is untouched, and without a size nothing is clamped
  assert.equal(clampCamera({ ...DEFAULT_CAMERA, panX: 30, panY: -20 }, SIZE).panX, 30);
  assert.equal(clampCamera({ ...DEFAULT_CAMERA, panX: 100000 }).panX, 100000);
});

test('activePreset recognises a preset and nothing once panned or zoomed', () => {
  for (const name of Object.keys(PRESETS)) assert.equal(activePreset(cam(name)), name);
  assert.equal(activePreset({ ...cam('iso'), panX: 12 }), null);
  assert.equal(activePreset({ ...cam('top'), zoom: 2 }), null);
  assert.equal(activePreset({ ...cam('front'), yaw: 20 }), null);
});

test('sortBackToFront puts the farthest first and drops nulls', () => {
  const out = sortBackToFront([{ depth: 1 }, null, { depth: 5 }, { depth: 3 }]);
  assert.deepEqual(out.map(p => p.depth), [5, 3, 1]);
});

test('dotRadius and dotAlpha grow with nearness within their bounds', () => {
  assert.ok(dotRadius(4, 1.4) > dotRadius(4, 1) && dotRadius(4, 1) > dotRadius(4, 0.7));
  assert.equal(dotRadius(4, 99), 4 * 1.6);
  assert.equal(dotRadius(4, 0.01), 4 * 0.55);
  assert.equal(dotAlpha(0.1), 0.35);
  assert.equal(dotAlpha(9), 0.95);
  assert.ok(dotAlpha(1.1) > dotAlpha(0.9));
});

test('gizmoAxes at the front preset: x points right, y points up on screen', () => {
  const ax = Object.fromEntries(gizmoAxes(cam('front')).map(a => [a.axis, a]));
  assert.ok(near(ax.x.x, 1) && near(ax.x.y, 0));
  assert.ok(near(ax.y.x, 0) && near(ax.y.y, -1));
  assert.equal(Object.keys(ax).length, 3);
});

test('pickPoint prefers the dot nearest the camera, not just the nearest on screen', () => {
  const front = { id: 'front', x: 100, y: 100, depth: 2 };
  const back = { id: 'back', x: 100.4, y: 100, depth: 5 };
  assert.equal(pickPoint([back, front], 100.4, 100, 12).id, 'front');
  assert.equal(pickPoint([back, front], 300, 300, 12), null);
});

test('pickPoint selects the dot under the cursor, not a nearer-to-camera dot merely close by', () => {
  const under = { id: 'under', x: 100, y: 100, depth: 4.5, r: 4 };
  const close = { id: 'close', x: 111, y: 100, depth: 3.5, r: 4 };   // 11px away, does not cover the pointer
  assert.equal(pickPoint([close, under], 100, 100, 12).id, 'under');
});

test('pickPoint prefers a lit dot over a dimmed one that is also under the cursor', () => {
  const dimmedNear = { id: 'dimmed', x: 100, y: 100, depth: 2, r: 4, lit: false };
  const litFar = { id: 'lit', x: 101, y: 100, depth: 5, r: 4, lit: true };
  assert.equal(pickPoint([dimmedNear, litFar], 100, 100, 12).id, 'lit');
});

test('pickPoint falls back to the nearest dot within the grab radius when none is under the cursor', () => {
  const a = { id: 'a', x: 100, y: 100, depth: 3, r: 2 };
  const b = { id: 'b', x: 108, y: 100, depth: 3, r: 2 };
  assert.equal(pickPoint([a, b], 106, 100, 12).id, 'b');   // 6px from a, 2px from b; neither covers... b nearest
  assert.equal(pickPoint([a], 150, 100, 12), null);
});

test('pickPoint without depth falls back to the nearest on screen', () => {
  const a = { id: 'a', x: 10, y: 10 };
  const b = { id: 'b', x: 14, y: 10 };
  assert.equal(pickPoint([a, b], 13, 10, 12).id, 'b');
});
