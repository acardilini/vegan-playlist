import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDataState, formatDataState, browseHref } from './dataUrlState.js';

const B = { min: 1967, max: 2025 };

test('an empty URL gives the defaults: all genres, the full year range, count and 5-year', () => {
  assert.deepEqual(deriveDataState(new URLSearchParams(), B), { pg: '', yf: 1967, yt: 2025, eraMode: 'count', eraBucket: '5y' });
});

test('years are read, clamped inside the data bounds and put in order', () => {
  const s = deriveDataState(new URLSearchParams('yf=1990&yt=2000'), B);
  assert.equal(s.yf, 1990); assert.equal(s.yt, 2000);
  const wide = deriveDataState(new URLSearchParams('yf=1900&yt=2100'), B);
  assert.equal(wide.yf, 1967); assert.equal(wide.yt, 2025);
  const swapped = deriveDataState(new URLSearchParams('yf=2010&yt=1980'), B);
  assert.equal(swapped.yf, 1980); assert.equal(swapped.yt, 2010);
});

test('junk values fall back to defaults instead of producing an empty chart', () => {
  const s = deriveDataState(new URLSearchParams('yf=abc&yt=&era_m=wide&era_b=7y'), B);
  assert.deepEqual(s, { pg: '', yf: 1967, yt: 2025, eraMode: 'count', eraBucket: '5y' });
});

test('with no bounds yet (data still loading) the years are null', () => {
  const s = deriveDataState(new URLSearchParams('yf=1990'), null);
  assert.equal(s.yf, null); assert.equal(s.yt, null);
});

test('format omits every default and round-trips the rest', () => {
  assert.equal(formatDataState(deriveDataState(new URLSearchParams(), B), B).toString(), '');
  const state = { pg: 'punk', yf: 1985, yt: 1999, eraMode: 'share', eraBucket: '1y' };
  const params = formatDataState(state, B);
  assert.equal(params.get('pg'), 'punk');
  assert.equal(params.get('era_m'), 'share');
  assert.equal(params.get('era_b'), '1y');
  assert.deepEqual(deriveDataState(params, B), state);
});

test('format keeps params it does not own', () => {
  const params = formatDataState({ pg: '', yf: 1967, yt: 2025, eraMode: 'count', eraBucket: '5y' }, B, new URLSearchParams('keep=1&pg=old'));
  assert.equal(params.get('keep'), '1');
  assert.equal(params.has('pg'), false);
});

test('browseHref uses the browse vocabulary, narrows only what is narrowed and states no count', () => {
  assert.equal(browseHref({ pg: '', yf: 1967, yt: 2025 }, B), '/');
  const href = browseHref({ pg: 'punk', yf: 1990, yt: 2025 }, B);
  const p = new URLSearchParams(href.split('?')[1]);
  assert.equal(href.startsWith('/?'), true);
  assert.deepEqual(p.getAll('parent_genres'), ['punk']);
  assert.equal(p.get('year_from'), '1990');
  assert.equal(p.has('year_to'), false);
  assert.ok(!/\d+ songs|audio|inferred/i.test(href));
});
