const { test } = require('node:test');
const assert = require('node:assert');
const { findDuplicateGroups, isDuplicatePair } = require('../services/duplicates');

test('same title, different artist is NOT a duplicate', () => {
  assert.equal(isDuplicatePair(
    { title: 'Hurt', artists: 'Nine Inch Nails' },
    { title: 'Hurt', artists: 'Johnny Cash' }), false);
});

test('same title, same artist (with a suffix) IS a duplicate', () => {
  assert.equal(isDuplicatePair(
    { title: 'Hurt', artists: 'Johnny Cash' },
    { title: 'Hurt (Remastered)', artists: 'Johnny Cash' }), true);
});

test('findDuplicateGroups groups only title+artist matches', () => {
  const songs = [
    { id: 1, title: 'Hurt', artists: 'Nine Inch Nails', created_at: '2020-01-01', popularity: 50 },
    { id: 2, title: 'Hurt', artists: 'Johnny Cash', created_at: '2021-01-01', popularity: 60 },
    { id: 3, title: 'Hurt (Live)', artists: 'Johnny Cash', created_at: '2019-01-01', popularity: 40 },
  ];
  const groups = findDuplicateGroups(songs);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].songs.map(s => s.id).sort(), [2, 3]);
  assert.equal(groups[0].songs[0].id, 3); // oldest first
});
