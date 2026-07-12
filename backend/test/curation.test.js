const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const curation = require('../services/curation');

// Unique fixture sentinel per test file — parallel suites must not clobber each other's
// rows via a shared LIKE-prefix cleanup. (staging.test.js uses ZZZTEST; videos uses ZZZVID.)

async function mkSong({ title, status = 'pending', published = false, spotify_url = null,
  bandcamp_url = null, album_id = null, artist = 'ZZZCUR Artist' }) {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, spotify_url, bandcamp_url, album_id, data_source)
     VALUES ($1,$2,$3,$4,$5,$6,'manual') RETURNING id`,
    [title, status, published, spotify_url, bandcamp_url, album_id])).rows[0];
  const a = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [artist])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  return s.id;
}

after(async () => {
  await pool.query(`DELETE FROM song_processing WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZCUR%')`);
  await pool.query(`DELETE FROM song_lyrics WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZCUR%')`);
  await pool.query(`DELETE FROM youtube_videos WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZCUR%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZCUR%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZCUR%'`);
  await pool.query(`DELETE FROM albums WHERE name LIKE 'ZZZCUR%'`);
  await pool.end();
});

test('getProcessing returns defaults when no row', async () => {
  const id = await mkSong({ title: 'ZZZCUR Proc Default' });
  const p = await curation.getProcessing(pool, id);
  assert.equal(p.snooze_until, null);
  assert.equal(p.park_reason, null);
  assert.deepEqual(p.lyrics_tried, []);
});

test('setProcessing upserts and validates park_reason', async () => {
  const id = await mkSong({ title: 'ZZZCUR Proc Set' });
  const r = await curation.setProcessing(pool, id, { park_reason: 'awaiting_community', lyrics_tried: ['google','genius'] });
  assert.equal(r.park_reason, 'awaiting_community');
  assert.deepEqual(r.lyrics_tried, ['google','genius']);
  await assert.rejects(curation.setProcessing(pool, id, { park_reason: 'bogus' }), e => e.code === 'BAD_INPUT');
});

test('setProcessing throws NOT_FOUND for missing song', async () => {
  await assert.rejects(curation.setProcessing(pool, -12345, { processing_note: 'x' }), e => e.code === 'NOT_FOUND');
});

test('listCurationQueue to-process excludes awaiting-community and future snoozed', async () => {
  const active = await mkSong({ title: 'ZZZCUR Q Active', status: 'pending' });
  const waiting = await mkSong({ title: 'ZZZCUR Q Waiting', status: 'pending' });
  const snoozed = await mkSong({ title: 'ZZZCUR Q Snoozed', status: 'pending' });
  await curation.setProcessing(pool, waiting, { park_reason: 'awaiting_community' });
  await curation.setProcessing(pool, snoozed, { snooze_until: '2999-01-01' });

  const ids = (await curation.listCurationQueue(pool, { queue: 'to-process' })).rows.map(r => r.id);
  assert.ok(ids.includes(active));
  assert.ok(!ids.includes(waiting), 'awaiting-community excluded from to-process');
  assert.ok(!ids.includes(snoozed), 'future-snoozed excluded from to-process');

  const wIds = (await curation.listCurationQueue(pool, { queue: 'awaiting-community' })).rows.map(r => r.id);
  assert.ok(wIds.includes(waiting));
  const rIds = (await curation.listCurationQueue(pool, { queue: 'remind-later' })).rows.map(r => r.id);
  assert.ok(rIds.includes(snoozed));
});

test('listCurationQueue needs-lyrics = included songs with no lyrics row', async () => {
  const missing = await mkSong({ title: 'ZZZCUR Q NoLyrics', status: 'included', published: true });
  const has = await mkSong({ title: 'ZZZCUR Q HasLyrics', status: 'included', published: true });
  await pool.query(`INSERT INTO song_lyrics (song_id, lyrics) VALUES ($1, 'la la')`, [has]);
  const ids = (await curation.listCurationQueue(pool, { queue: 'needs-lyrics' })).rows.map(r => r.id);
  assert.ok(ids.includes(missing));
  assert.ok(!ids.includes(has));
});

test('listCurationQueue unknown queue throws BAD_QUEUE', async () => {
  await assert.rejects(curation.listCurationQueue(pool, { queue: 'nope' }), e => e.code === 'BAD_QUEUE');
});

test('queueCounts returns a number for every queue key', async () => {
  const c = await curation.queueCounts(pool);
  for (const k of ['to-process','awaiting-community','remind-later','needs-lyrics','needs-cover','needs-video','needs-analysis','to-finalise','inbox']) {
    assert.equal(typeof c[k], 'number', `count for ${k}`);
  }
});

test('getWorkbench assembles song, lyrics, processing, completeness', async () => {
  const id = await mkSong({ title: 'ZZZCUR WB', status: 'included', published: true, spotify_url: 'http://x' });
  await pool.query(`INSERT INTO song_lyrics (song_id, lyrics, source_url, translation) VALUES ($1,$2,$3,$4)`,
    [id, 'full lyric text', 'http://genius/x', 'translated text']);
  await pool.query(`UPDATE songs SET language='Spanish', lyrics_highlights='a great line' WHERE id=$1`, [id]);

  const wb = await curation.getWorkbench(pool, id);
  assert.equal(wb.id, id);
  assert.equal(wb.language, 'Spanish');
  assert.equal(wb.lyrics, 'full lyric text');            // full lyrics returned (admin-only path)
  assert.equal(wb.translation, 'translated text');
  assert.equal(wb.lyrics_source_url, 'http://genius/x');
  assert.equal(wb.lyrics_highlights, 'a great line');
  assert.equal(wb.completeness.lyrics, true);
  assert.equal(wb.completeness.play_link, true);
  assert.equal(wb.completeness.video, false);
  assert.ok(Array.isArray(wb.artists) && wb.artists.length >= 1);
});

test('getWorkbench throws NOT_FOUND for missing song', async () => {
  await assert.rejects(curation.getWorkbench(pool, -777), e => e.code === 'NOT_FOUND');
});

test('saveDetails updates title + language', async () => {
  const id = await mkSong({ title: 'ZZZCUR Save Details' });
  const wb = await curation.saveDetails(pool, id, { title: 'ZZZCUR Save Details 2', language: 'French' });
  assert.equal(wb.title, 'ZZZCUR Save Details 2');
  assert.equal(wb.language, 'French');
});

test('saveLyrics upserts local lyrics + translation and sets lyrics_status', async () => {
  const id = await mkSong({ title: 'ZZZCUR Save Lyrics' });
  const wb = await curation.saveLyrics(pool, id, { lyrics: 'line one', source_url: 'http://src', translation: 'trans', lyrics_status: 'found' });
  assert.equal(wb.lyrics, 'line one');
  assert.equal(wb.translation, 'trans');
  assert.equal(wb.lyrics_status, 'found');
  await assert.rejects(curation.saveLyrics(pool, id, { lyrics_status: 'bogus' }), e => e.code === 'BAD_INPUT');
});

test('saveLyrics with empty lyrics deletes the local row', async () => {
  const id = await mkSong({ title: 'ZZZCUR Del Lyrics' });
  await curation.saveLyrics(pool, id, { lyrics: 'temp' });
  const wb = await curation.saveLyrics(pool, id, { lyrics: '' });
  assert.equal(wb.lyrics, null);
});

test('saveHighlights updates public highlights', async () => {
  const id = await mkSong({ title: 'ZZZCUR Highlights' });
  const wb = await curation.saveHighlights(pool, id, { lyrics_highlights: 'a memorable line' });
  assert.equal(wb.lyrics_highlights, 'a memorable line');
});

test('saveLinks validates http(s)', async () => {
  const id = await mkSong({ title: 'ZZZCUR Links' });
  const wb = await curation.saveLinks(pool, id, { bandcamp_url: 'https://band.camp/x' });
  assert.equal(wb.bandcamp_url, 'https://band.camp/x');
  await assert.rejects(curation.saveLinks(pool, id, { spotify_url: 'ftp://nope' }), e => e.code === 'BAD_INPUT');
});

test('setCover upserts album images for a non-Spotify song', async () => {
  const id = await mkSong({ title: 'ZZZCUR Cover' });
  const wb = await curation.setCover(pool, id, { cover_url: 'https://img/cover.jpg' });
  assert.equal(wb.completeness.cover, true);
  // images is a jsonb column, parsed by pg into a JS array — stringify to inspect it.
  assert.ok(JSON.stringify(wb.album.images).includes('https://img/cover.jpg'));
});
