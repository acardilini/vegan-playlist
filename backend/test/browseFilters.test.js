const { test } = require('node:test');
const assert = require('node:assert');
const b = require('../services/browseFilters');
const genres = require('../services/genres');

// Pure-function tests — no DB, no sentinel.

test('buildWhere with no filters is empty', () => {
  const r = b.buildWhere({});
  assert.deepEqual(r.where, []);
  assert.deepEqual(r.params, []);
  assert.equal(r.nextIndex, 1);
  assert.deepEqual(r.joins, { albums: false, artists: false, effectiveGenre: false, analysis: false, scalarAnalysis: false });
});

test('buildWhere text search sets albums+artists joins and one param', () => {
  const r = b.buildWhere({ q: 'vegan' });
  assert.equal(r.params.length, 1);
  assert.equal(r.params[0], '%vegan%');
  assert.ok(r.joins.albums && r.joins.artists);
  assert.ok(r.where[0].includes('a.name') && r.where[0].includes('al.name'));
});

test('buildWhere genre sets effectiveGenre join and uses the shared clause', () => {
  const r = b.buildWhere({ genres: ['metalcore'] });
  assert.ok(r.joins.effectiveGenre);
  assert.ok(r.where.some(c => c.includes(genres.EFFECTIVE_GENRE_EXPR)));
});

test('buildWhere exclude omits that group but keeps others', () => {
  const r = b.buildWhere({ genres: ['metalcore'], lengths: ['short'] }, { exclude: 'genre' });
  assert.ok(!r.joins.effectiveGenre, 'genre group excluded');
  assert.ok(r.where.some(c => c.includes('duration_ms')), 'length kept');
});

test('buildWhere analysis facets set analysis join and AND clauses', () => {
  const r = b.buildWhere({ themes: ['killing'], targets: ['cows'] });
  assert.ok(r.joins.analysis);
  assert.equal(r.where.filter(c => c.includes('@>')).length, 2);
});

test('buildWhere numbers params from startIndex', () => {
  const r = b.buildWhere({ q: 'x', languages: ['English'] }, { startIndex: 2 });
  // q -> $2, language -> $3
  assert.ok(r.where[0].includes('$2'));
  assert.ok(r.where.some(c => c.includes('$3')));
  assert.equal(r.nextIndex, 4);
});

test('joinSql emits only the needed joins', () => {
  assert.equal(b.joinSql({ albums: false, artists: false, effectiveGenre: false, analysis: false }), '');
  assert.ok(b.joinSql({ albums: true }).includes('LEFT JOIN albums'));
  assert.ok(b.joinSql({ effectiveGenre: true }).includes('LATERAL'));
  assert.ok(b.joinSql({ analysis: true }).includes('song_lyric_analysis sa'));
});
