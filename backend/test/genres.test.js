const { test } = require('node:test');
const assert = require('node:assert');
const g = require('../services/genres');

// Pure-function tests only — this file touches no DB (no sentinel needed).

test('buildGenreTree groups effective genres under parents with summed counts', () => {
  const rows = [
    { effective_genre: 'metalcore' },
    { effective_genre: 'metalcore' },
    { effective_genre: 'death metal' },
    { effective_genre: 'pop punk' },
    { effective_genre: null },
    { effective_genre: '' },
  ];
  const t = g.buildGenreTree(rows);
  assert.equal(t.uncovered_count, 2);
  const metal = t.parents.find(p => p.value === 'metal');
  assert.equal(metal.count, 3); // metalcore x2 + death metal
  const metalcore = metal.subgenres.find(s => s.value === 'metalcore');
  assert.equal(metalcore.count, 2);
  const punk = t.parents.find(p => p.value === 'punk');
  assert.equal(punk.count, 1);
  // parents sorted by count desc
  assert.equal(t.parents[0].value, 'metal');
});

test('buildGenreTree lowercases and buckets unmapped genres under "other"', () => {
  const t = g.buildGenreTree([{ effective_genre: 'ZZ Totally Unknown Genre' }]);
  const other = t.parents.find(p => p.value === 'other');
  assert.ok(other, 'unmapped genre lands in "other"');
  assert.equal(other.subgenres[0].value, 'zz totally unknown genre');
});

test('genreFilterClause builds an ANY clause with a lowercased list', () => {
  const r = g.genreFilterClause(['Metalcore', 'pop punk'], 4);
  assert.equal(r.clause, `${g.EFFECTIVE_GENRE_EXPR} = ANY($4::text[])`);
  assert.deepEqual(r.params, [['metalcore', 'pop punk']]);
});

test('genreFilterClause returns null for empty input', () => {
  assert.equal(g.genreFilterClause([], 1), null);
  assert.equal(g.genreFilterClause(undefined, 1), null);
});

test('EFFECTIVE_GENRE_EXPR includes TRIM for parity with buildGenreTree', () => {
  assert.ok(g.EFFECTIVE_GENRE_EXPR.includes('TRIM'), 'effective-genre expression trims to match buildGenreTree');
});

test('lengthFilterClause maps presets to duration ranges (OR)', () => {
  assert.equal(g.lengthFilterClause(['short']), '((s.duration_ms >= 1 AND s.duration_ms < 120000))');
  assert.equal(
    g.lengthFilterClause(['short', 'long']),
    '((s.duration_ms >= 1 AND s.duration_ms < 120000) OR (s.duration_ms >= 240000))');
  assert.equal(g.lengthFilterClause(['medium']), '((s.duration_ms >= 120000 AND s.duration_ms < 240000))');
  assert.equal(g.lengthFilterClause([]), null);
});
