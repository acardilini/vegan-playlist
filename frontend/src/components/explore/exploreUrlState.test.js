import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COLOUR,
  deriveCamera,
  deriveColour,
  deriveDim,
  deriveQuery,
  deriveSelectedId,
  deriveSpace,
  deriveSpotlit,
  deriveView,
  formatCamera,
  formatView,
  songPassesSpotlight,
  withParam,
} from './exploreUrlState.js';
import { DEFAULT_CAMERA, PRESETS } from './camera3d.js';

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

test('deriveDim honours 3d only where the space has 3D data', () => {
  assert.equal(deriveDim(p('dim=3d'), true), '3d');
  assert.equal(deriveDim(p('dim=3d'), false), '2d');
  assert.equal(deriveDim(p(''), true), '2d');
  assert.equal(deriveDim(p('dim=4d'), true), '2d');
});

test('deriveCamera reads a preset name or five numbers, and nothing else', () => {
  assert.deepEqual(deriveCamera(p('')), DEFAULT_CAMERA);
  assert.deepEqual(deriveCamera(p('cam=top')), { ...DEFAULT_CAMERA, ...PRESETS.top });
  assert.deepEqual(deriveCamera(p('cam=10,45,2,30,-20')),
    { yaw: 10, pitch: 45, zoom: 2, panX: 30, panY: -20 });
});

test('deriveCamera falls back to the default for any invalid value, never a partial repair', () => {
  // an absurd pan (a hand-edited link) would open to an empty plot
  for (const bad of ['banana', '1,2,3', 'NaN,0,1,0,0', '0,120,1,0,0', '0,0,99,0,0', '0,0,0.1,0,0', '',
    '35,20,1,100000,0', '35,20,1,0,-100000']) {
    assert.deepEqual(deriveCamera(p('cam=' + bad)), DEFAULT_CAMERA, bad);
  }
});

test('formatCamera: default is empty, a preset is its name, a free camera round-trips', () => {
  assert.equal(formatCamera(DEFAULT_CAMERA), '');
  assert.equal(formatCamera({ ...DEFAULT_CAMERA, ...PRESETS.top }), 'top');
  const free = { yaw: 12.3, pitch: -40.5, zoom: 2.25, panX: 31, panY: -8 };
  assert.deepEqual(deriveCamera(p('cam=' + formatCamera(free))), free);
});

test('songPassesSpotlight: empty passes all, plain codes match, themes match any sub-dimension', () => {
  assert.equal(songPassesSpotlight({ codes: { genre: 'metal' } }, 'genre', new Set()), true);
  assert.equal(songPassesSpotlight({ codes: { genre: 'metal' } }, 'genre', new Set(['metal'])), true);
  assert.equal(songPassesSpotlight({ codes: { genre: 'metal' } }, 'genre', new Set(['punk'])), false);
  // coloured as one sub-dimension, but it touches two: picking EITHER lights it
  const both = { codes: { themes: 'cruelty_suffering' }, subs: { themes: ['cruelty_suffering', 'psychology_barriers'] } };
  assert.equal(songPassesSpotlight(both, 'themes', new Set(['psychology_barriers'])), true);
  assert.equal(songPassesSpotlight(both, 'themes', new Set(['cruelty_suffering'])), true);
  assert.equal(songPassesSpotlight(both, 'themes', new Set(['commercial_ecological'])), false);
  // a song with no subs entry still answers on its bucket
  assert.equal(songPassesSpotlight({ codes: { themes: 'NOT_CODED' } }, 'themes', new Set(['NOT_CODED'])), true);
});
