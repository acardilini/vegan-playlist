import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultKeeper, previewLines } from './mergeText.js';

test('defaultKeeper: more songs wins, then more live songs, then the lower id', () => {
  assert.equal(defaultKeeper({ id: 5, songs: 3, live_songs: 0 }, { id: 2, songs: 1, live_songs: 1 }), 'a');
  assert.equal(defaultKeeper({ id: 5, songs: 1, live_songs: 9 }, { id: 2, songs: 4, live_songs: 0 }), 'b');
  assert.equal(defaultKeeper({ id: 5, songs: 2, live_songs: 1 }, { id: 2, songs: 2, live_songs: 2 }), 'b');
  assert.equal(defaultKeeper({ id: 5, songs: 2, live_songs: 2 }, { id: 2, songs: 2, live_songs: 2 }), 'b');
  assert.equal(defaultKeeper({ id: 2, songs: 2, live_songs: 2 }, { id: 5, songs: 2, live_songs: 2 }), 'a');
});

const base = (o = {}) => ({
  keeper: { id: 1, name: 'The Instigators' }, loser: { id: 2, name: 'Instigators' },
  songs: { moving: 0, shared: 0 }, members: { moving: 0, skipped: 0 }, leads: 0,
  fills: [], conflicts: [], identity: { carried: [], kept: [] }, hash: 'h', ...o,
});
const LAST = 'Instigators is removed. This cannot be undone from the screen; a snapshot of it is saved';

test('previewLines: moving, shared and skipped', () => {
  const lines = previewLines(base({ songs: { moving: 2, shared: 1 }, members: { moving: 1, skipped: 1 } }));
  assert.deepEqual(lines, [
    '2 songs move to The Instigators',
    '1 song is on both and stays once',
    '1 member moves, 1 skipped as already listed',
    LAST,
  ]);
  assert.deepEqual(previewLines(base({ songs: { moving: 1, shared: 3 }, leads: 2 })).slice(0, 3), [
    '1 song moves to The Instigators',
    '3 songs are on both and stay once',
    '2 leads move to The Instigators',
  ]);
});

test('previewLines: nothing to move still says so', () => {
  assert.deepEqual(previewLines(base()), ['No songs move', LAST]);
});

test('previewLines: fills and conflicts name the fields', () => {
  const lines = previewLines(base({
    songs: { moving: 1, shared: 0 },
    fills: ['bio', 'first_release_year'],
    conflicts: [{ field: 'country', keeper: 'Germany', loser: 'Deutschland' }, { field: 'genres', keeper: ['a'], loser: ['b'] }],
  }));
  assert.ok(lines.includes('Filled from Instigators: Bio, First release (year)'));
  assert.ok(lines.includes('Kept as on The Instigators (Instigators differs): Country, Genres'));
});

test('previewLines: carried and kept identity links', () => {
  const lines = previewLines(base({ songs: { moving: 1, shared: 0 }, identity: { carried: ['musicbrainz', 'bandcamp'], kept: ['spotify'] } }));
  assert.ok(lines.includes('MusicBrainz / Bandcamp link carried over'));
  assert.ok(lines.includes('Spotify link kept as on The Instigators'));
});

test('previewLines: an unknown field falls back to its key', () => {
  const lines = previewLines(base({ fills: ['constructor'] }));
  assert.ok(lines.includes('Filled from Instigators: constructor'));
});
