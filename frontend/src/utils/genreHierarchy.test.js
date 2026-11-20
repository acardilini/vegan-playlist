import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parentGenreOf } from './genreHierarchy.js';

// The same file the backend and the analysis project read.
const H = JSON.parse(readFileSync(new URL('../../../backend/data/genre_hierarchy.json', import.meta.url), 'utf8'));

test('parentGenreOf: a parent is its own parent, a subgenre maps up, unknown is other', () => {
  assert.equal(parentGenreOf(H, 'rock'), 'rock');
  assert.equal(parentGenreOf(H, ' Metal '), 'metal');
  assert.equal(parentGenreOf(H, 'folk punk'), 'folk');
  assert.equal(parentGenreOf(H, 'country'), 'country');
  assert.equal(parentGenreOf(H, 'horror punk'), 'punk');
  assert.equal(parentGenreOf(H, 'zz totally unknown genre'), 'other');
  assert.equal(parentGenreOf(H, 'constructor'), 'other');
  assert.equal(parentGenreOf(H, ''), null);
});
