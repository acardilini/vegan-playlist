const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const curation = require('../services/curation');

async function mkSong({ title, status = 'pending', published = false, spotify_url = null,
  bandcamp_url = null, album_id = null, artist = 'ZZZTEST Artist' }) {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, spotify_url, bandcamp_url, album_id, data_source)
     VALUES ($1,$2,$3,$4,$5,$6,'manual') RETURNING id`,
    [title, status, published, spotify_url, bandcamp_url, album_id])).rows[0];
  const a = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [artist])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  return s.id;
}

after(async () => {
  await pool.query(`DELETE FROM song_processing WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZTEST%')`);
  await pool.query(`DELETE FROM song_lyrics WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZTEST%')`);
  await pool.query(`DELETE FROM youtube_videos WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZTEST%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZTEST%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZTEST%'`);
  await pool.query(`DELETE FROM albums WHERE name LIKE 'ZZZTEST%'`);
  await pool.end();
});

test('getProcessing returns defaults when no row', async () => {
  const id = await mkSong({ title: 'ZZZTEST Proc Default' });
  const p = await curation.getProcessing(pool, id);
  assert.equal(p.snooze_until, null);
  assert.equal(p.park_reason, null);
  assert.deepEqual(p.lyrics_tried, []);
});

test('setProcessing upserts and validates park_reason', async () => {
  const id = await mkSong({ title: 'ZZZTEST Proc Set' });
  const r = await curation.setProcessing(pool, id, { park_reason: 'awaiting_community', lyrics_tried: ['google','genius'] });
  assert.equal(r.park_reason, 'awaiting_community');
  assert.deepEqual(r.lyrics_tried, ['google','genius']);
  await assert.rejects(curation.setProcessing(pool, id, { park_reason: 'bogus' }), e => e.code === 'BAD_INPUT');
});

test('setProcessing throws NOT_FOUND for missing song', async () => {
  await assert.rejects(curation.setProcessing(pool, -12345, { processing_note: 'x' }), e => e.code === 'NOT_FOUND');
});
