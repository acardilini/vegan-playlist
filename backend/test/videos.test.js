const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const videos = require('../services/videos');

async function mkSong(title) {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, data_source) VALUES ($1,'pending','manual') RETURNING id`, [title])).rows[0];
  return s.id;
}
async function primaries(songId) {
  return (await pool.query(`SELECT id, is_primary FROM youtube_videos WHERE song_id=$1 ORDER BY id`, [songId])).rows;
}

after(async () => {
  await pool.query(`DELETE FROM youtube_videos WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZTEST%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZTEST%'`);
  await pool.end();
});

test('addVideo rejects a malformed youtube_id', async () => {
  const id = await mkSong('ZZZTEST Vid Bad');
  await assert.rejects(videos.addVideo(pool, id, { youtube_id: 'short' }), e => e.code === 'BAD_INPUT');
});

test('first video is primary; second only-primary-if-asked; setting primary clears siblings', async () => {
  const id = await mkSong('ZZZTEST Vid Primary');
  const v1 = await videos.addVideo(pool, id, { youtube_id: 'aaaaaaaaaaa', video_type: 'official' });
  assert.equal(v1.is_primary, true, 'first video auto-primary');
  const v2 = await videos.addVideo(pool, id, { youtube_id: 'bbbbbbbbbbb', video_type: 'live' });
  assert.equal(v2.is_primary, false, 'second not primary by default');

  await videos.setPrimaryVideo(pool, v2.id);
  const rows = await primaries(id);
  assert.equal(rows.filter(r => r.is_primary).length, 1, 'exactly one primary');
  assert.equal(rows.find(r => r.id === v2.id).is_primary, true);
});

test('deleting the primary promotes another remaining video', async () => {
  const id = await mkSong('ZZZTEST Vid Delete');
  const v1 = await videos.addVideo(pool, id, { youtube_id: 'ccccccccccc' });   // primary
  const v2 = await videos.addVideo(pool, id, { youtube_id: 'ddddddddddd' });
  await videos.deleteVideo(pool, v1.id);
  const rows = await primaries(id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, v2.id);
  assert.equal(rows[0].is_primary, true, 'remaining video promoted to primary');
});
