const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const staging = require('../services/staging');
const curation = require('../services/curation');

// Fixture sentinel for this file: ZZZXCHKS.
const track = (id, title, artist = 'ZZZXCHKS Band') => ({
  spotify_id: id, title, duration_ms: 1, popularity: 1, explicit: false, track_number: 1, disc_number: 1, spotify_url: null, added_at: null,
  artists: [{ spotify_id: 'ZZZXCHKS_art_' + artist, name: artist, spotify_url: null }], album: null,
});

after(async () => {
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZXCHKS%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZXCHKS%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZXCHKS%'`);
  await pool.end();
});

test('insertCandidates skips a title|artist twin by default and adds it with allowTitleDuplicates', async () => {
  await staging.insertCandidates(pool, [track('ZZZXCHKS_a', 'ZZZXCHKS Twin')]);
  const plain = await staging.insertCandidates(pool, [track('ZZZXCHKS_b', 'ZZZXCHKS Twin')]);
  assert.deepEqual(plain, { added: 0, skippedExisting: 1 });
  const forced = await staging.insertCandidates(pool, [track('ZZZXCHKS_b', 'ZZZXCHKS Twin')], { allowTitleDuplicates: true });
  assert.equal(forced.added, 1);
});

test('allowTitleDuplicates still skips a Spotify id that is already known', async () => {
  const r = await staging.insertCandidates(pool, [track('ZZZXCHKS_a', 'ZZZXCHKS Twin')], { allowTitleDuplicates: true });
  assert.deepEqual(r, { added: 0, skippedExisting: 1 });
});

test('a song whose note starts "added via playlist cross-check" has origin crosscheck in the To be processed queue', async () => {
  await staging.insertCandidates(pool, [track('ZZZXCHKS_o', 'ZZZXCHKS Origin')], { note: 'added via playlist cross-check (ZZZXCHKS list)' });
  const { rows } = await curation.listCurationQueue(pool, { queue: 'to-process', q: 'ZZZXCHKS Origin' });
  assert.equal(rows.find(r => r.title === 'ZZZXCHKS Origin').origin, 'crosscheck');
});
