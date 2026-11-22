import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveDataState, formatDataState, browseHref, FLOW_IDS } from './dataUrlState.js';
import { PRESETS } from '../components/explore/data/flowModel.js';

const B = { min: 1967, max: 2025 };

test('an empty URL gives the defaults: all genres, the full year range, count and 5-year', () => {
  assert.deepEqual(deriveDataState(new URLSearchParams(), B), { pg: '', yf: 1967, yt: 2025, eraMode: 'count', eraBucket: '5y', flow: 'genre-tone-action' });
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
  assert.deepEqual(s, { pg: '', yf: 1967, yt: 2025, eraMode: 'count', eraBucket: '5y', flow: 'genre-tone-action' });
});

test('with no bounds yet (data still loading) the years are null', () => {
  const s = deriveDataState(new URLSearchParams('yf=1990'), null);
  assert.equal(s.yf, null); assert.equal(s.yt, null);
});

test('format omits every default and round-trips the rest', () => {
  assert.equal(formatDataState(deriveDataState(new URLSearchParams(), B), B).toString(), '');
  const state = { pg: 'punk', yf: 1985, yt: 1999, eraMode: 'share', eraBucket: '1y', flow: 'voice-tone-emotion' };
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

// --- Task 3: flow param and extra Browse codes ---
test('flow defaults to the first preset and an invalid value falls back', () => {
  assert.equal(deriveDataState(new URLSearchParams(), B).flow, 'genre-tone-action');
  assert.equal(deriveDataState(new URLSearchParams('flow=nope'), B).flow, 'genre-tone-action');
  assert.equal(deriveDataState(new URLSearchParams('flow=voice-tone-emotion'), B).flow, 'voice-tone-emotion');
});

test('flow round-trips and the default is omitted from the URL', () => {
  const s = deriveDataState(new URLSearchParams('flow=audience-frame-action'), B);
  assert.equal(formatDataState(s, B).get('flow'), 'audience-frame-action');
  assert.equal(formatDataState(deriveDataState(new URLSearchParams(), B), B).has('flow'), false);
  assert.equal(formatDataState({ ...s, flow: 'genre-tone-action' }, B, new URLSearchParams('flow=audience-frame-action')).has('flow'), false);
});

test('formatDataState keeps params it does not own', () => {
  const s = deriveDataState(new URLSearchParams('flow=voice-tone-emotion'), B);
  const p = formatDataState(s, B, new URLSearchParams('keep=1&flow=audience-frame-action'));
  assert.equal(p.get('keep'), '1');
  assert.equal(p.get('flow'), 'voice-tone-emotion');
});

test('FLOW_IDS equal the PRESETS ids', () => {
  assert.deepEqual(FLOW_IDS, PRESETS.map(p => p.id));
});

test('browseHref with extra codes adds them in Browse vocabulary and keeps the slice years', () => {
  const href = browseHref({ pg: '', yf: 1990, yt: 2025 }, B, { lyrical_tone: ['angry'], actions: ['protest'] });
  const q = new URLSearchParams(href.slice(2));
  assert.deepEqual(q.getAll('lyrical_tone'), ['angry']);
  assert.deepEqual(q.getAll('actions'), ['protest']);
  assert.equal(q.get('year_from'), '1990');
  assert.equal(q.has('year_to'), false);
});

test('browseHref extra parent_genres is de-duplicated against the slice genre', () => {
  const same = new URLSearchParams(browseHref({ pg: 'metal' }, B, { parent_genres: ['metal'] }).slice(2));
  assert.deepEqual(same.getAll('parent_genres'), ['metal']);
  const both = new URLSearchParams(browseHref({ pg: 'metal' }, B, { parent_genres: ['punk'] }).slice(2));
  assert.deepEqual(both.getAll('parent_genres'), ['metal', 'punk']);
  assert.equal(browseHref({ pg: '' }, B), '/');
});
