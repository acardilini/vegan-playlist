const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const curation = require('../services/curation');

// Unique fixture sentinel for this file: ZZZBRV.
// The Broken video queue: included songs whose audio analysis could not reach the video (UNAVAILABLE, and no OK row from any
// model), that still have a video, and none added after the failed analysis. Adding a replacement link clears the song.

async function mkSong(title, { status = 'included', published = true } = {}) {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, data_source) VALUES ($1,$2,$3,'manual') RETURNING id`,
    [title, status, published])).rows[0].id;
}

async function addAudio(songId, { status = 'UNAVAILABLE', model = 'zzzbrv-audio', at = '2026-11-01 10:00:00' } = {}) {
  await pool.query(
    `INSERT INTO song_audio_analysis (song_id, model_used, audio_status, analyzed_at) VALUES ($1,$2,$3,$4)`,
    [songId, model, status, at]);
}

let n = 0;
async function addVideo(songId, createdAt, primary = true) {
  const yid = `zzzbrv${String(++n).padStart(5, '0')}`;   // 11 chars, matches the table's id check
  await pool.query(
    `INSERT INTO youtube_videos (song_id, youtube_id, video_type, is_primary, created_at) VALUES ($1,$2,'official',$4,$3)`,
    [songId, yid, createdAt, primary]);
  return yid;
}

const queueIds = async (queue) =>
  (await curation.listCurationQueue(pool, { queue })).rows.map((r) => r.id);

test('a live song whose audio was UNAVAILABLE and whose video predates the failure is in Broken video', async () => {
  const id = await mkSong('ZZZBRV Broken');
  await addVideo(id, '2026-10-01 09:00:00');
  await addAudio(id);

  assert.ok(curation.QUEUE_NAMES.includes('broken-video'));
  assert.ok((await queueIds('broken-video')).includes(id));
  const counts = await curation.queueCounts(pool);
  assert.equal(typeof counts['broken-video'], 'number', 'the rail has a count');
  assert.ok(counts['broken-video'] >= 1);
});

test('adding a replacement video after the failed analysis clears the song; deleting every video sends it to Needs video instead', async () => {
  const id = await mkSong('ZZZBRV Replaced');
  await addVideo(id, '2026-10-01 09:00:00');
  await addAudio(id);
  assert.ok((await queueIds('broken-video')).includes(id), 'listed before the fix');

  await addVideo(id, '2026-11-10 09:00:00', false);   // one primary per song: the replacement is an extra link
  assert.ok(!(await queueIds('broken-video')).includes(id), 'a newer link clears it');

  const bare = await mkSong('ZZZBRV Bare');
  await addVideo(bare, '2026-10-01 09:00:00');
  await addAudio(bare);
  await pool.query('DELETE FROM youtube_videos WHERE song_id=$1', [bare]);
  assert.ok(!(await queueIds('broken-video')).includes(bare), 'no video left: not here');
  assert.ok((await queueIds('needs-video')).includes(bare), '...it is a Needs video song now');
});

test('a song that has an OK analysis from any model is not broken', async () => {
  const id = await mkSong('ZZZBRV OkElsewhere');
  await addVideo(id, '2026-10-01 09:00:00');
  await addAudio(id, { status: 'UNAVAILABLE', model: 'zzzbrv-a' });
  await addAudio(id, { status: 'OK', model: 'zzzbrv-b' });
  assert.ok(!(await queueIds('broken-video')).includes(id));
});

test('other failure kinds, no audio row and non-included songs are never listed', async () => {
  const tooLong = await mkSong('ZZZBRV TooLong');
  await addVideo(tooLong, '2026-10-01 09:00:00');
  await addAudio(tooLong, { status: 'TOO_LONG' });
  const err = await mkSong('ZZZBRV Error');
  await addVideo(err, '2026-10-01 09:00:00');
  await addAudio(err, { status: 'ERROR' });
  const none = await mkSong('ZZZBRV NoAudio');
  await addVideo(none, '2026-10-01 09:00:00');
  const pending = await mkSong('ZZZBRV Pending', { status: 'pending', published: false });
  await addVideo(pending, '2026-10-01 09:00:00');
  await addAudio(pending);

  const ids = await queueIds('broken-video');
  for (const id of [tooLong, err, none, pending]) assert.ok(!ids.includes(id), `song ${id} is not queued`);
});

test('an included song awaiting publish is listed (the queue is not limited to live songs)', async () => {
  const id = await mkSong('ZZZBRV Unpublished', { published: false });
  await addVideo(id, '2026-10-01 09:00:00');
  await addAudio(id);
  assert.ok((await queueIds('broken-video')).includes(id));
});

after(async () => {
  await pool.query(`DELETE FROM song_audio_analysis WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZBRV%')`);
  await pool.query(`DELETE FROM youtube_videos WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZBRV%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZBRV%'`);
  await pool.end();
});
