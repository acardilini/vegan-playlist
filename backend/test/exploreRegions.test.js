const { test } = require('node:test');
const assert = require('node:assert');
const { kmeans, buildRegionLabels } = require('../services/exploreRegions');

// Pure module: no database, so no fixture sentinel is needed.

// A deterministic cloud of n points around a centre (a small grid, so no random source).
function blob(cx, cy, n) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([cx + (i % 5) * 0.1, cy + Math.floor(i / 5) * 0.1]);
  return pts;
}

const labelOf = (term) => `L:${term.split(':')[1]}`;
const genreLabelOf = (g) => `G:${g}`;

test('kmeans separates two obvious blobs and is deterministic', () => {
  const points = [...blob(0, 0, 20), ...blob(50, 50, 20)];
  const a = kmeans(points, 2);
  const first = a.assignments[0];
  const second = a.assignments[20];
  assert.notEqual(first, second);
  assert.ok(a.assignments.slice(0, 20).every(x => x === first));
  assert.ok(a.assignments.slice(20).every(x => x === second));
  assert.deepStrictEqual(kmeans(points, 2), a);
});

test('kmeans copes with degenerate input', () => {
  assert.deepStrictEqual(kmeans([], 3), { assignments: [], centres: [] });
  assert.equal(kmeans([[0, 0], [1, 1], [2, 2]], 10).centres.length, 3);
  const same = Array.from({ length: 30 }, () => [4, 4]);
  const r = kmeans(same, 4);
  for (const c of r.centres) assert.ok(c.every(Number.isFinite), 'no NaN centre');
  for (const x of r.assignments) assert.ok(Number.isInteger(x) && x >= 0 && x < r.centres.length);
});

function twoBlobItems(overrides) {
  const items = [];
  for (let i = 0; i < 30; i++) {
    items.push({ point: blob(0, 0, 30)[i], terms: ['themes:a'], genre: null });
    items.push({ point: blob(50, 50, 30)[i], terms: ['themes:a'], genre: null });
  }
  return overrides ? overrides(items) : items;
}

test('a region is named by its over-represented term, not the global most common', () => {
  const items = twoBlobItems((all) => {
    all.forEach((it, i) => {
      const inFirst = i % 2 === 0;
      const n = Math.floor(i / 2);
      if (n < 27) it.terms.push(inFirst ? 'themes:x' : 'themes:y');
    });
    return all;
  });
  const labels = buildRegionLabels(items, { k: 2, labelOf, genreLabelOf });
  assert.equal(labels.length, 2);
  const texts = labels.map(l => l.label).sort();
  assert.deepStrictEqual(texts, ['L:x', 'L:y']);
  assert.ok(!texts.includes('L:a'), 'a term every song carries never labels');
});

test('a label may add the over-represented parent genre', () => {
  const withBoth = twoBlobItems((all) => {
    all.forEach((it, i) => {
      const inFirst = i % 2 === 0;
      const n = Math.floor(i / 2);
      if (n < 27) it.terms.push(inFirst ? 'themes:x' : 'themes:y');
      it.genre = inFirst ? 'hardcore' : 'metal';
    });
    return all;
  });
  const labels = buildRegionLabels(withBoth, { k: 2, labelOf, genreLabelOf });
  assert.deepStrictEqual(labels.map(l => l.label).sort(),
    ['L:x · G:hardcore', 'L:y · G:metal']);

  const genreOnly = twoBlobItems((all) => {
    all.forEach((it, i) => { it.genre = i % 2 === 0 ? 'hardcore' : 'metal'; });
    return all;
  });
  const g = buildRegionLabels(genreOnly, { k: 2, labelOf, genreLabelOf });
  assert.deepStrictEqual(g.map(l => l.label).sort(), ['G:hardcore', 'G:metal']);
});

test('regions below minRegion and regions with nothing distinctive get no label', () => {
  const items = [];
  // a distinctive 30-song blob, a distinctive 10-song blob, and a larger background group
  blob(0, 0, 30).forEach(p => items.push({ point: p, terms: ['themes:x'], genre: null }));
  blob(50, 50, 10).forEach(p => items.push({ point: p, terms: ['themes:y'], genre: null }));
  blob(100, 0, 60).forEach(p => items.push({ point: p, terms: ['themes:z'], genre: null }));
  const labels = buildRegionLabels(items, { k: 3, labelOf, genreLabelOf }).map(l => l.label);
  assert.ok(labels.includes('L:x'));
  assert.ok(!labels.includes('L:y'), 'a 10-song region is below minRegion');

  // two blobs that mirror the global mix: nothing is over-represented anywhere
  const mirror = [];
  const mix = (i) => (i % 2 === 0 ? ['themes:p'] : ['themes:q']);
  blob(0, 0, 30).forEach((p, i) => mirror.push({ point: p, terms: mix(i), genre: null }));
  blob(50, 50, 30).forEach((p, i) => mirror.push({ point: p, terms: mix(i), genre: null }));
  assert.deepStrictEqual(buildRegionLabels(mirror, { k: 2, labelOf, genreLabelOf }), []);
});

test('two regions that would read the same keep only the larger', () => {
  const items = [];
  blob(0, 0, 40).forEach(p => items.push({ point: p, terms: ['themes:x'], genre: null }));
  blob(50, 50, 25).forEach(p => items.push({ point: p, terms: ['themes:x'], genre: null }));
  // a third group without the term makes `x` distinctive in both of the first two
  blob(100, 0, 60).forEach(p => items.push({ point: p, terms: ['themes:z'], genre: null }));
  const labels = buildRegionLabels(items, { k: 3, labelOf, genreLabelOf });
  const xs = labels.filter(l => l.label === 'L:x');
  assert.equal(xs.length, 1);
  assert.equal(xs[0].count, 40);
  assert.ok(xs[0].centre[0] < 10, 'centre sits in the larger blob');
});

test('labels are identical across runs, with rounded finite centres', () => {
  const items = twoBlobItems((all) => {
    all.forEach((it, i) => { if (Math.floor(i / 2) < 27) it.terms.push(i % 2 === 0 ? 'themes:x' : 'themes:y'); });
    return all;
  });
  const a = buildRegionLabels(items, { k: 2, labelOf, genreLabelOf });
  const b = buildRegionLabels(items, { k: 2, labelOf, genreLabelOf });
  assert.deepStrictEqual(a, b);
  for (const l of a) {
    assert.ok(l.centre.every(Number.isFinite));
    assert.ok(l.label.length > 0);
    assert.ok(Number.isInteger(l.count));
  }
});

test('default region count is small enough to read (8)', () => {
  const { REGION_K } = require('../services/exploreRegions');
  assert.equal(REGION_K, 8);
});

test('buildTieredLabels adds a finer level and drops fine labels that repeat a coarse one', () => {
  const { buildTieredLabels } = require('../services/exploreRegions');
  // Four tight groups; groups 1+2 sit close together and 3+4 close together, so the coarse
  // cut (k=2) merges each pair while the fine cut (k=4) separates all four.
  const items = [];
  const add = (cx, cy, term) => blob(cx, cy, 20)
    .forEach(p => items.push({ point: p, terms: [term], genre: null }));
  add(0, 0, 'themes:a'); add(6, 0, 'themes:b'); add(100, 0, 'themes:c'); add(106, 0, 'themes:d');
  const labels = buildTieredLabels(items, {
    coarseK: 2, fineK: 4, fineMinRegion: 10, labelOf, genreLabelOf,
  });
  const text = (level) => labels.filter(l => l.level === level).map(l => l.label).sort();
  assert.deepStrictEqual(text(1), ['L:a', 'L:c']);
  assert.deepStrictEqual(text(2), ['L:b', 'L:d'], 'the fine copies of L:a and L:c are dropped');
  for (const l of labels) assert.ok(l.centre.every(Number.isFinite) && Number.isInteger(l.count));
});

test('buildTieredLabels is deterministic and its defaults are 8 coarse / more fine', () => {
  const { buildTieredLabels, REGION_K, FINE_K, FINE_MIN_REGION } = require('../services/exploreRegions');
  assert.equal(REGION_K, 8);
  assert.ok(FINE_K > REGION_K);
  assert.ok(FINE_MIN_REGION < 15);
  const items = [];
  blob(0, 0, 40).forEach(p => items.push({ point: p, terms: ['themes:a'], genre: null }));
  blob(80, 0, 40).forEach(p => items.push({ point: p, terms: ['themes:b'], genre: null }));
  const a = buildTieredLabels(items, { labelOf, genreLabelOf });
  assert.deepStrictEqual(a, buildTieredLabels(items, { labelOf, genreLabelOf }));
});
