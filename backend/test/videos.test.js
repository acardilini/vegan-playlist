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
  await pool.query(`DELETE FROM youtube_videos WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZVID%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZVID%'`);
  await pool.end();
});

test('addVideo rejects a malformed youtube_id', async () => {
  const id = await mkSong('ZZZVID Vid Bad');
  await assert.rejects(videos.addVideo(pool, id, { youtube_id: 'short' }), e => e.code === 'BAD_INPUT');
});

test('first video is primary; second only-primary-if-asked; setting primary clears siblings', async () => {
  const id = await mkSong('ZZZVID Vid Primary');
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
  const id = await mkSong('ZZZVID Vid Delete');
  const v1 = await videos.addVideo(pool, id, { youtube_id: 'ccccccccccc' });   // primary
  const v2 = await videos.addVideo(pool, id, { youtube_id: 'ddddddddddd' });
  await videos.deleteVideo(pool, v1.id);
  const rows = await primaries(id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, v2.id);
  assert.equal(rows[0].is_primary, true, 'remaining video promoted to primary');
});

// --- bulk add (sub-project D) ---

test('addVideos: first video on an empty song is primary, the rest are not, all are added in order', async () => {
  const id = await mkSong('ZZZVID Bulk Empty');
  const r = await videos.addVideos(pool, id, [
    { youtube_id: 'aaaaaaaaaaa', video_title: 'One', video_type: 'official' },
    { youtube_id: 'bbbbbbbbbbb', video_title: 'Two', video_type: 'lyric' },
  ]);
  assert.deepEqual(r.added.map(v => v.youtube_id), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.deepEqual(r.skipped, []);
  const rows = await primaries(id);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(x => x.is_primary).length, 1, 'exactly one primary');
  assert.equal(r.added[0].is_primary, true);
});

test('addVideos leaves an existing primary alone', async () => {
  const id = await mkSong('ZZZVID Bulk HasPrimary');
  const first = await videos.addVideo(pool, id, { youtube_id: 'ccccccccccc', video_type: 'official' });
  await videos.addVideos(pool, id, [{ youtube_id: 'ddddddddddd', video_type: 'live' }]);
  const rows = await primaries(id);
  assert.equal(rows.find(x => x.id === first.id).is_primary, true);
  assert.equal(rows.filter(x => x.is_primary).length, 1);
});

test('addVideos skips a video the song already has, and a duplicate within the batch', async () => {
  const id = await mkSong('ZZZVID Bulk Dupes');
  await videos.addVideo(pool, id, { youtube_id: 'eeeeeeeeeee', video_type: 'official' });
  const r = await videos.addVideos(pool, id, [
    { youtube_id: 'eeeeeeeeeee', video_type: 'official' },   // already on the song
    { youtube_id: 'fffffffffff', video_type: 'live' },
    { youtube_id: 'fffffffffff', video_type: 'lyric' },       // repeated in the batch
  ]);
  assert.deepEqual(r.added.map(v => v.youtube_id), ['fffffffffff']);
  assert.deepEqual(r.skipped, ['eeeeeeeeeee', 'fffffffffff']);
  assert.equal((await primaries(id)).length, 2);
});

test('addVideos aborts the WHOLE batch when one item is invalid: nothing is inserted', async () => {
  const id = await mkSong('ZZZVID Bulk Atomic');
  await assert.rejects(() => videos.addVideos(pool, id, [
    { youtube_id: 'ggggggggggg', video_type: 'official' },
    { youtube_id: 'short', video_type: 'official' },
  ]), (e) => e.code === 'BAD_INPUT');
  assert.equal((await primaries(id)).length, 0);
});

test('addVideos rejects an invalid type, an empty batch, >10 items and a non-array; unknown song is NOT_FOUND', async () => {
  const id = await mkSong('ZZZVID Bulk Bad');
  await assert.rejects(() => videos.addVideos(pool, id, [{ youtube_id: 'hhhhhhhhhhh', video_type: 'nonsense' }]), (e) => e.code === 'BAD_INPUT');
  await assert.rejects(() => videos.addVideos(pool, id, []), (e) => e.code === 'BAD_INPUT');
  await assert.rejects(() => videos.addVideos(pool, id, undefined), (e) => e.code === 'BAD_INPUT');
  const eleven = Array.from({ length: 11 }, (_, i) => ({ youtube_id: String(i).padStart(11, 'x'), video_type: 'other' }));
  await assert.rejects(() => videos.addVideos(pool, id, eleven), (e) => e.code === 'BAD_INPUT');
  await assert.rejects(() => videos.addVideos(pool, 999999999, [{ youtube_id: 'iiiiiiiiiii', video_type: 'other' }]), (e) => e.code === 'NOT_FOUND');
  assert.equal((await primaries(id)).length, 0);
});
