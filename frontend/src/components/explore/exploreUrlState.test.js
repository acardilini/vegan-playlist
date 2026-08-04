import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COLOUR,
  deriveColour,
  deriveQuery,
  deriveSelectedId,
  deriveSpace,
  deriveSpotlit,
  deriveView,
  formatView,
  withParam,
} from './exploreUrlState.js';

// Shapes match what GET /api/analysis/explore/points serves: spaces and colourBy are
// arrays of objects keyed by `key`. Only `key` matters to these functions.
const SPACES = [{ key: 'thematic' }, { key: 'audio' }, { key: 'holistic' }];
const COLOURS = [{ key: 'genre' }, { key: 'sonic_energy' }, { key: 'emotional_mood' }];
const p = (qs) => new URLSearchParams(qs);

test('deriveSpace honours a space the catalogue still serves', () => {
  assert.equal(deriveSpace(p('space=audio'), SPACES), 'audio');
});

test('deriveSpace falls back to the first space for a retired one', () => {
  // `semantic` is in HIDDEN_SPACES since 062b38f. A link shared while it existed must
  // draw the default map, never an empty plot with no chip lit.
  assert.equal(deriveSpace(p('space=semantic'), SPACES), 'thematic');
});

test('deriveSpace falls back when the param is absent or the catalogue is empty', () => {
  assert.equal(deriveSpace(p(''), SPACES), 'thematic');
  assert.equal(deriveSpace(p('space=audio'), []), null);
});

test('deriveColour falls back to sonic_energy, not merely to the first entry', () => {
  // The distinction matters: colourBy[0] is `genre`, so a naive fallback would silently
  // change the default map's colouring whenever a stale link arrives.
  assert.equal(deriveColour(p('colour=nonsense'), COLOURS), DEFAULT_COLOUR);
  assert.equal(deriveColour(p(''), COLOURS), DEFAULT_COLOUR);
  assert.equal(deriveColour(p('colour=genre'), COLOURS), 'genre');
});

test('deriveColour uses the first entry only when sonic_energy is not served', () => {
  assert.equal(deriveColour(p('colour=nope'), [{ key: 'genre' }]), 'genre');
  assert.equal(deriveColour(p(''), []), null);
});

test('deriveSpotlit parses codes and tolerates empty segments', () => {
  assert.deepEqual([...deriveSpotlit(p('codes=metal,,punk'))], ['metal', 'punk']);
  assert.equal(deriveSpotlit(p('')).size, 0);
  assert.equal(deriveSpotlit(p('codes=')).size, 0);
});

test('deriveQuery returns the raw query or an empty string', () => {
  assert.equal(deriveQuery(p('q=milk')), 'milk');
  assert.equal(deriveQuery(p('')), '');
});

test('deriveSelectedId returns null for a non-numeric id', () => {
  // Guards NaN reaching `songs.find(s => s.id === NaN)`, which silently matches nothing.
  assert.equal(deriveSelectedId(p('song=4691')), 4691);
  assert.equal(deriveSelectedId(p('song=abc')), null);
  assert.equal(deriveSelectedId(p('')), null);
});

test('withParam sets one key and leaves its neighbours alone', () => {
  const next = withParam(p('space=audio&q=milk'), 'song', '4691');
  assert.equal(next.get('space'), 'audio');
  assert.equal(next.get('q'), 'milk');
  assert.equal(next.get('song'), '4691');
});

test('withParam deletes the key for a null or empty value', () => {
  assert.equal(withParam(p('song=4691&q=milk'), 'song', null).has('song'), false);
  assert.equal(withParam(p('q=milk'), 'q', '').has('q'), false);
});

test('changing colour drops a spotlight expressed in the old dimension codes', () => {
  const next = withParam(p('colour=genre&codes=metal,punk'), 'colour', 'sonic_energy');
  assert.equal(next.get('colour'), 'sonic_energy');
  assert.equal(next.has('codes'), false);
});

test('deriveView reads a well-formed viewport', () => {
  assert.deepEqual(deriveView(p('view=2.5,-120,-64')), { k: 2.5, tx: -120, ty: -64 });
});

test('deriveView falls back to fit for anything malformed', () => {
  // A stale or hand-edited link must draw the default map, never a blank one.
  for (const qs of ['', 'view=', 'view=abc', 'view=2,3', 'view=2,3,4,5', 'view=NaN,0,0']) {
    assert.deepEqual(deriveView(p(qs)), { k: 1, tx: 0, ty: 0 }, qs);
  }
});

test('deriveView falls back to fit for an out-of-range zoom', () => {
  assert.deepEqual(deriveView(p('view=0.2,0,0')), { k: 1, tx: 0, ty: 0 });
  assert.deepEqual(deriveView(p('view=99,0,0')), { k: 1, tx: 0, ty: 0 });
});

test('formatView rounds, and writes nothing at fit', () => {
  assert.equal(formatView({ k: 1, tx: 0, ty: 0 }), '');
  assert.equal(formatView({ k: 2.4567, tx: -120.7, ty: -64.2 }), '2.46,-121,-64');
});

test('a formatted view round-trips back through deriveView', () => {
  const v = { k: 3.25, tx: -240, ty: -96 };
  assert.deepEqual(deriveView(p(`view=${formatView(v)}`)), v);
});
