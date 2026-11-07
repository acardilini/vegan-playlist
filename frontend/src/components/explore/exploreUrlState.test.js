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
  deriveFlag,
  deriveView,
  deriveYear,
  deriveYearFrom,
  formatCamera,
  formatView,
  formatYear,
  formatYearFrom,
  yearRangeLabel,
  songPassesSpotlight,
  withParam,
  withParams,
  yearBounds,
  yearState,
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
  assert.equal(formatView({ k: 1, tx: 40.4, ty: -30 }), '1,40,-30', 'an unzoomed but panned map is not "fit"');
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

const BOUNDS = { min: 1990, max: 2005, missing: 3 };

test('yearBounds ignores songs without a valid year and counts them', () => {
  const songs = [
    { year: 1990 }, { year: 2005 }, { year: 1999 },
    { year: null }, { year: undefined }, { year: 2000.5 },
  ];
  assert.deepEqual(yearBounds(songs), { min: 1990, max: 2005, missing: 3 });
});

test('yearBounds is null when nobody has a year', () => {
  assert.equal(yearBounds([{ year: null }, {}]), null);
  assert.equal(yearBounds([]), null);
});

test('deriveYear accepts a year inside the range', () => {
  assert.equal(deriveYear(p('yr=2000'), BOUNDS), 2000);
  assert.equal(deriveYear(p('yr=1990'), BOUNDS), 1990);
  assert.equal(deriveYear(p('yr=2004'), BOUNDS), 2004);
});

test('deriveYear falls back to null (all years) for every invalid value', () => {
  for (const bad of ['', 'abc', '2020-2021', '2000.5', '1800', '1989', '3000', '2005', '-5', 'NaN']) {
    assert.equal(deriveYear(p('yr=' + bad), BOUNDS), null, bad);
  }
  assert.equal(deriveYear(p(''), BOUNDS), null);
  assert.equal(deriveYear(p('yr=2000'), null), null, 'no bounds, no cutoff');
});

test('formatYear writes nothing at the end of the range', () => {
  assert.equal(formatYear(null, BOUNDS), '');
  assert.equal(formatYear(2005, BOUNDS), '');
  assert.equal(formatYear(2010, BOUNDS), '');
  assert.equal(formatYear(2000, BOUNDS), '2000');
  assert.equal(formatYear(2000, null), '');
});

test('yearState: no cutoff shows everything; a cutoff splits in/out/unknown', () => {
  assert.equal(yearState({ year: null }, null), 'in');
  assert.equal(yearState({ year: 1999 }, null), 'in');
  assert.equal(yearState({ year: 2000 }, 2000), 'in', 'up to and including the cutoff');
  assert.equal(yearState({ year: 2001 }, 2000), 'out');
  assert.equal(yearState({ year: null }, 2000), 'unknown');
});

test('deriveFlag is on unless the param is exactly 0', () => {
  assert.equal(deriveFlag(p(''), 'labels'), true);
  assert.equal(deriveFlag(p('labels=0'), 'labels'), false);
  assert.equal(deriveFlag(p('labels=1'), 'labels'), true);
  assert.equal(deriveFlag(p('labels=off'), 'labels'), true);
  assert.equal(deriveFlag(p('labels=0'), 'lines'), true, 'a different key is unaffected');
});

test('withParams writes several keys in one go and deletes empty ones', () => {
  const next = withParams(p('space=audio&song=1&view=2,0,0'), [['song', '2'], ['view', ''], ['cam', 'top']]);
  assert.equal(next.get('space'), 'audio');
  assert.equal(next.get('song'), '2');
  assert.equal(next.has('view'), false);
  assert.equal(next.get('cam'), 'top');
  assert.equal(withParams(p('q=x'), []).get('q'), 'x');
});

// --- year range: an optional start year (`yf`) alongside the end cutoff (`yr`) ---------------

test('deriveYearFrom accepts a start year after the first year and no later than the end', () => {
  assert.equal(deriveYearFrom(p('yf=1995'), BOUNDS, null), 1995);
  assert.equal(deriveYearFrom(p('yf=2005'), BOUNDS, null), 2005, 'a single final year is a real range');
  assert.equal(deriveYearFrom(p('yf=1995'), BOUNDS, 1995), 1995, 'start may equal the end');
  assert.equal(deriveYearFrom(p('yf=1995'), BOUNDS, 2000), 1995);
});

test('deriveYearFrom is null (no start) for every invalid value', () => {
  for (const bad of ['', 'abc', '1990', '1989', '2006', '1995.5', '-1995', '1e3']) {
    assert.equal(deriveYearFrom(p('yf=' + bad), BOUNDS, null), null, bad);
  }
  assert.equal(deriveYearFrom(p('yf=2001'), BOUNDS, 2000), null, 'start after the end');
  assert.equal(deriveYearFrom(p(''), BOUNDS, null), null);
  assert.equal(deriveYearFrom(p('yf=1995'), null, null), null);
});

test('formatYearFrom writes nothing when there is no start or it is the first year', () => {
  assert.equal(formatYearFrom(null, BOUNDS), '');
  assert.equal(formatYearFrom(1990, BOUNDS), '');
  assert.equal(formatYearFrom(1980, BOUNDS), '');
  assert.equal(formatYearFrom(1995, BOUNDS), '1995');
  assert.equal(formatYearFrom(1995, null), '');
});

test('yearState with a start year splits before, within and after the range', () => {
  assert.equal(yearState({ year: 1994 }, 2000, 1995), 'out', 'before the start');
  assert.equal(yearState({ year: 1995 }, 2000, 1995), 'in', 'the start year is included');
  assert.equal(yearState({ year: 2000 }, 2000, 1995), 'in');
  assert.equal(yearState({ year: 2001 }, 2000, 1995), 'out');
  assert.equal(yearState({ year: 2003 }, null, 1995), 'in', 'start only: open-ended');
  assert.equal(yearState({ year: 1990 }, null, 1995), 'out');
  assert.equal(yearState({ year: null }, null, 1995), 'unknown', 'no year while a range is set');
  assert.equal(yearState({ year: 1990 }, null, null), 'in', 'no range at all shows everything');
});

test('yearRangeLabel reads naturally for every combination', () => {
  assert.equal(yearRangeLabel(null, null, BOUNDS), 'All years');
  assert.equal(yearRangeLabel(null, 2000, BOUNDS), 'Up to 2000');
  assert.equal(yearRangeLabel(1995, null, BOUNDS), '1995 to 2005');
  assert.equal(yearRangeLabel(1995, 2000, BOUNDS), '1995 to 2000');
  assert.equal(yearRangeLabel(1995, 1995, BOUNDS), '1995 only');
});
