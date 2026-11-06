import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestSongs } from './neighbours.js';

const song = (id, c2, c3) => ({
  id,
  coords: c2 ? { thematic: c2 } : {},
  coords3: c3 ? { thematic: c3 } : {},
});

const LINE = [song(1, [0, 0]), song(2, [1, 0]), song(3, [3, 0]), song(4, [6, 0]), song(5, [10, 0])];

test('nearestSongs returns the k nearest, nearest first', () => {
  const out = nearestSongs(LINE, 1, 'thematic', '2d', 3);
  assert.deepEqual(out.map(n => n.id), [2, 3, 4]);
  assert.deepEqual(out.map(n => n.dist), [1, 3, 6]);
});

test('nearestSongs excludes the target and the exclude set', () => {
  const out = nearestSongs(LINE, 1, 'thematic', '2d', 10, new Set([2, 4]));
  assert.deepEqual(out.map(n => n.id), [3, 5]);
});

test('nearestSongs skips songs with no coordinates and returns [] for a target without any', () => {
  const songs = [song(1, [0, 0]), song(2, null), song(3, [2, 0])];
  assert.deepEqual(nearestSongs(songs, 1, 'thematic', '2d', 5).map(n => n.id), [3]);
  assert.deepEqual(nearestSongs(songs, 2, 'thematic', '2d', 5), []);
  assert.deepEqual(nearestSongs(songs, 99, 'thematic', '2d', 5), []);
});

test('nearestSongs uses coords3 in 3d and coords in 2d', () => {
  // near in 2D, far in 3D (and the reverse for song 3)
  const songs = [
    song(1, [0, 0], [0, 0, 0]),
    song(2, [1, 0], [9, 9, 9]),
    song(3, [8, 0], [0.5, 0, 0]),
  ];
  assert.equal(nearestSongs(songs, 1, 'thematic', '2d', 1)[0].id, 2);
  assert.equal(nearestSongs(songs, 1, 'thematic', '3d', 1)[0].id, 3);
});

test('nearestSongs breaks ties on lower id', () => {
  const songs = [song(1, [0, 0]), song(7, [1, 0]), song(3, [-1, 0]), song(5, [0, 1])];
  assert.deepEqual(nearestSongs(songs, 1, 'thematic', '2d', 3).map(n => n.id), [3, 5, 7]);
});

test('nearestSongs with k larger than the catalogue returns everything else', () => {
  assert.equal(nearestSongs(LINE, 1, 'thematic', '2d', 100).length, 4);
  assert.deepEqual(nearestSongs(LINE, 1, 'thematic', '2d', 0), []);
});
