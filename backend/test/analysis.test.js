const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const analysis = require('../services/analysis');

// Unique fixture sentinel per test file: ZZZANL.

test('DEFAULT_MODEL is gemma4:latest', () => {
  assert.equal(analysis.DEFAULT_MODEL, 'gemma4:latest');
});

test('taxonomy exposes the five evidence dimensions with labels', () => {
  assert.ok(Array.isArray(analysis.taxonomy.themes));
  // topics column is displayed as "targets"; taxonomy stores it under "targets"
  assert.equal(analysis.label('themes', 'killing'), 'Killing');
  assert.equal(analysis.label('topics', 'slaughterhouses'), 'Slaughterhouses');
  assert.equal(analysis.label('advocacy', 'boycott'), 'Boycott');
  // unknown code falls back to de-snake-cased Title Case
  assert.equal(analysis.label('themes', 'some_new_code'), 'Some New Code');
});
