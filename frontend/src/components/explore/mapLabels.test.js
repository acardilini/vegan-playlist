import test from 'node:test';
import assert from 'node:assert/strict';
import { placeLabels, truncateLabel } from './mapLabels.js';

const measure = (t) => t.length * 7;
const BOUNDS = { w: 800, h: 520 };

test('truncateLabel leaves short text and cuts long text with an ellipsis within max', () => {
  assert.equal(truncateLabel('Vivisection'), 'Vivisection');
  const long = 'Psychological Barriers & Activist Responses and more';
  const cut = truncateLabel(long, 20);
  assert.equal(cut.length, 20);
  assert.ok(cut.endsWith('…'));
  assert.ok(truncateLabel(long).length <= 34);
});

test('placeLabels keeps the larger region when two labels collide', () => {
  const placed = placeLabels([
    { text: 'Small', x: 400, y: 200, count: 20 },
    { text: 'Large', x: 410, y: 200, count: 40 },
  ], measure, BOUNDS);
  assert.deepEqual(placed.map(p => p.text), ['Large']);
});

test('placeLabels keeps both when they do not overlap', () => {
  const placed = placeLabels([
    { text: 'One', x: 100, y: 100, count: 20 },
    { text: 'Two', x: 500, y: 300, count: 40 },
  ], measure, BOUNDS);
  assert.equal(placed.length, 2);
  for (const p of placed) {
    assert.ok(p.box.x0 < p.x && p.x < p.box.x1 && p.box.y0 < p.y && p.y < p.box.y1);
  }
});

test('placeLabels drops labels centred off the plot and non-finite positions', () => {
  const placed = placeLabels([
    { text: 'Off', x: -5, y: 100, count: 50 },
    { text: 'Below', x: 100, y: 900, count: 50 },
    { text: 'Nan', x: NaN, y: 100, count: 50 },
    { text: 'Inf', x: 100, y: Infinity, count: 50 },
    { text: 'Fine', x: 100, y: 100, count: 10 },
  ], measure, BOUNDS);
  assert.deepEqual(placed.map(p => p.text), ['Fine']);
});

test('placeLabels is deterministic and ignores input order for priority', () => {
  const items = [
    { text: 'A', x: 300, y: 200, count: 10 },
    { text: 'B', x: 305, y: 200, count: 30 },
    { text: 'C', x: 600, y: 400, count: 20 },
  ];
  const forward = placeLabels(items, measure, BOUNDS).map(p => p.text);
  const reversed = placeLabels([...items].reverse(), measure, BOUNDS).map(p => p.text);
  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward, ['B', 'C']);
});
