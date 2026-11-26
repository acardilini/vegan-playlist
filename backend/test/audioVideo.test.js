const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const videos = require('../services/videos');
const curation = require('../services/curation');

// Unique fixture sentinel for this file: ZZZAVD.
// The audio analysis video: songs.audio_video_id points at the video the analysis should hear; NULL means "the primary".

async function mkSong(title) {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, data_source) VALUES ($1,'included',true,'manual') RETURNING id`, [title])).rows[0].id;
}
const row = async (id) => (await pool.query('SELECT audio_video_id, audio_video_set_at FROM songs WHERE id=$1', [id])).rows[0];

after(async () => {
  await pool.query(`DELETE FROM song_audio_analysis WHERE model_used = 'zzzavd-audio'`);
  await pool.query(`DELETE FROM youtube_videos WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZAVD%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZAVD%'`);
  await pool.end();
});

test('a song starts on the primary; choosing a non-primary video sets the pointer and stamps the time', async () => {
  const id = await mkSong('ZZZAVD Set');
  const live = await videos.addVideo(pool, id, { youtube_id: 'zzzavd00001', video_type: 'live' });       // primary (first)
  const album = await videos.addVideo(pool, id, { youtube_id: 'zzzavd00002', video_type: 'official' });
  assert.equal((await row(id)).audio_video_id, null, 'default: the primary');

  const out = await videos.setAudioVideo(pool, id, album.id);
  assert.equal(out.audio_video_id, album.id);
  const r = await row(id);
  assert.equal(r.audio_video_id, album.id);
  assert.ok(r.audio_video_set_at, 'the change is stamped');
  assert.equal(live.is_primary, true, 'the primary is untouched');
});

test('choosing the primary video, or null, clears the override (and still stamps the change)', async () => {
  const id = await mkSong('ZZZAVD Clear');
  const live = await videos.addVideo(pool, id, { youtube_id: 'zzzavd00003', video_type: 'live' });
  const album = await videos.addVideo(pool, id, { youtube_id: 'zzzavd00004' });
  await videos.setAudioVideo(pool, id, album.id);
  const first = (await row(id)).audio_video_set_at;

  await videos.setAudioVideo(pool, id, live.id);                 // the primary: same as the default
  let r = await row(id);
  assert.equal(r.audio_video_id, null);
  assert.ok(r.audio_video_set_at >= first);

  await videos.setAudioVideo(pool, id, album.id);
  await videos.setAudioVideo(pool, id, null);
  assert.equal((await row(id)).audio_video_id, null);
});

test("another song's video, or a missing one, is refused", async () => {
  const a = await mkSong('ZZZAVD A');
  const b = await mkSong('ZZZAVD B');
  await videos.addVideo(pool, a, { youtube_id: 'zzzavd00005' });
  const other = await videos.addVideo(pool, b, { youtube_id: 'zzzavd00006' });
  await assert.rejects(videos.setAudioVideo(pool, a, other.id), (e) => e.code === 'BAD_INPUT');
  await assert.rejects(videos.setAudioVideo(pool, a, 2147483000), (e) => e.code === 'BAD_INPUT');
  await assert.rejects(videos.setAudioVideo(pool, 2147483000, null), (e) => e.code === 'NOT_FOUND');
  assert.equal((await row(a)).audio_video_id, null, 'nothing was saved');
});

test('deleting the marked video returns the song to the primary', async () => {
  const id = await mkSong('ZZZAVD Delete');
  await videos.addVideo(pool, id, { youtube_id: 'zzzavd00007', video_type: 'live' });
  const album = await videos.addVideo(pool, id, { youtube_id: 'zzzavd00008' });
  await videos.setAudioVideo(pool, id, album.id);
  await videos.deleteVideo(pool, album.id);
  assert.equal((await row(id)).audio_video_id, null);
});

test('the workbench marks the video the analysis will use: the pointer, else the primary', async () => {
  const id = await mkSong('ZZZAVD Workbench');
  const live = await videos.addVideo(pool, id, { youtube_id: 'zzzavd00009', video_type: 'live' });
  const album = await videos.addVideo(pool, id, { youtube_id: 'zzzavd00010' });
  const used = async () => (await curation.getWorkbench(pool, id)).videos.filter((v) => v.is_audio_source).map((v) => v.id);

  assert.deepEqual(await used(), [live.id], 'no override: the primary');
  await videos.setAudioVideo(pool, id, album.id);
  assert.deepEqual(await used(), [album.id], 'override: that video only');
});

test('changing the audio video after a failed analysis clears the song from Broken video', async () => {
  const id = await mkSong('ZZZAVD Broken');
  await videos.addVideo(pool, id, { youtube_id: 'zzzavd00011', video_type: 'live' });
  const album = await videos.addVideo(pool, id, { youtube_id: 'zzzavd00012' });
  await pool.query('UPDATE youtube_videos SET created_at = $2 WHERE song_id = $1', [id, '2026-01-01 09:00:00']);
  await pool.query(
    `INSERT INTO song_audio_analysis (song_id, model_used, audio_status, analyzed_at) VALUES ($1,'zzzavd-audio','UNAVAILABLE','2026-06-01 10:00:00')`, [id]);
  const listed = async () => (await curation.listCurationQueue(pool, { queue: 'broken-video' })).rows.map((r) => r.id).includes(id);

  assert.equal(await listed(), true, 'broken before the change');
  await videos.setAudioVideo(pool, id, album.id);
  assert.equal(await listed(), false, 'a new audio video clears it');
});
