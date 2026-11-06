import test from 'node:test';
import assert from 'node:assert/strict';
import { walkBack, walkBase, walkNext } from './walk.js';

// Thirty songs on a line, one unit apart: the nearest unvisited song is always an adjacent one.
const SONGS = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1, coords: { thematic: [i, 0] }, coords3: {},
}));

test('walkBase restarts when the selection is not the end of the path', () => {
  assert.deepEqual(walkBase([1, 2, 3], 3), [1, 2, 3]);
  assert.deepEqual(walkBase([1, 2, 3], 9), [9]);
  assert.deepEqual(walkBase([1, 2, 3], null), []);
  assert.deepEqual(walkBase([], 4), [4]);
});

test('walkNext starts from the selected song and appends the nearest unvisited', () => {
  const step = walkNext(SONGS, 'thematic', '2d', [], 10);
  assert.equal(step.id, 9, 'ties on distance break to the lower id');
  assert.deepEqual(step.path, [10, 9]);
  const again = walkNext(SONGS, 'thematic', '2d', step.path, 9);
  assert.equal(again.id, 8, 'from 9 the nearest unvisited is 8 (distance 1), not 11 (distance 2)');
  assert.deepEqual(again.path, [10, 9, 8]);
});

test('walkNext never revisits a song across a long walk', () => {
  let path = [];
  let selected = 15;
  const seen = new Set([selected]);
  for (let i = 0; i < 20; i++) {
    const step = walkNext(SONGS, 'thematic', '2d', path, selected);
    assert.ok(step, `step ${i} exists`);
    assert.ok(!seen.has(step.id), `step ${i} revisited ${step.id}`);
    seen.add(step.id);
    path = step.path;
    selected = step.id;
  }
  assert.equal(seen.size, 21);
});

test('walkNext is null when nothing is selected or nothing is left', () => {
  assert.equal(walkNext(SONGS, 'thematic', '2d', [], null), null);
  const two = SONGS.slice(0, 2);
  assert.equal(walkNext(two, 'thematic', '2d', [1, 2], 2), null);
  const noCoords = [{ id: 1, coords: {}, coords3: {} }, ...SONGS.slice(1)];
  assert.equal(walkNext(noCoords, 'thematic', '2d', [], 1), null);
});

test('walkBack retraces and is null at the start', () => {
  assert.deepEqual(walkBack([10, 9, 11], 11), { path: [10, 9], id: 9 });
  assert.deepEqual(walkBack([10, 9], 9), { path: [10], id: 10 });
  assert.equal(walkBack([10], 10), null);
  assert.equal(walkBack([10, 9], 77), null, 'a selection off the path restarts, so there is nothing to go back to');
  assert.equal(walkBack([], null), null);
});
