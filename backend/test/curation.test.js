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

test('quickCapture creates a pending manual song in the to-process queue', async () => {
  const { id } = await curation.quickCapture(pool, { title: 'ZZZCUR QuickCap', artist: 'ZZZCUR Capper' });
  assert.ok(Number.isInteger(id));
  const wb = await curation.getWorkbench(pool, id);
  assert.equal(wb.status, 'pending');
  assert.equal(wb.published, false);
  assert.ok(wb.artists.some(a => a.name === 'ZZZCUR Capper'));
  const ids = (await curation.listCurationQueue(pool, { queue: 'to-process' })).rows.map(r => r.id);
  assert.ok(ids.includes(id), 'quick-captured song appears in to-process');
});

test('quickCapture rejects blank title or artist', async () => {
  await assert.rejects(curation.quickCapture(pool, { title: '', artist: 'x' }), e => e.code === 'BAD_INPUT');
  await assert.rejects(curation.quickCapture(pool, { title: 'x', artist: '  ' }), e => e.code === 'BAD_INPUT');
});

test('getWorkbench includes the full analysis object when coded', async () => {
  const { CODE_MODEL, SCALAR_MODEL } = require('../services/analysis');
  const id = await mkSong({ title: 'ZZZCUR Analysed', status: 'included', published: true });
  // Code tier: themes/topics/advocacy/tactics/moral_frames + explanation.
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, $3, $2::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [id, JSON.stringify([{ code: 'compassion', evidence: 'be kind' }]), CODE_MODEL]);
  // Scalar tier: perspective/tone/.../emotions — a distinct (song_id, model_used) row.
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, perspective, emotions, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, $2, 'human_observer', ARRAY['hope'], '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [id, SCALAR_MODEL]);
  const wb = await curation.getWorkbench(pool, id);
  assert.equal(wb.analysed, true);
  assert.equal(wb.analysis.perspective, 'human_observer');
  assert.equal(wb.analysis.themes[0].label, 'Compassion');
});

test('hasAnalysis is true from a scalar-only row (either tier counts)', async () => {
  const analysis = require('../services/analysis');
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ('ZZZCUR ScalarOnly', 'included', true, 'manual') RETURNING id`)).rows[0];
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, perspective,
       themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, $2, 'MORAL_ACCUSER_JUDGE', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [s.id, analysis.SCALAR_MODEL]);
  const wb = await curation.getWorkbench(pool, s.id);
  assert.ok(wb.analysis, 'workbench shows the scalar-only analysis');
});

test('saveLyrics with only lyrics preserves existing source_url and translation', async () => {
  const id = await mkSong({ title: 'ZZZCUR PreserveURL' });
  await curation.saveLyrics(pool, id, { lyrics: 'first', source_url: 'http://src.example/x', translation: 'trad' });
  await curation.saveLyrics(pool, id, { lyrics: 'edited lyrics only' });
  const row = (await pool.query('SELECT lyrics, source_url, translation FROM song_lyrics WHERE song_id=$1', [id])).rows[0];
  assert.equal(row.lyrics, 'edited lyrics only');
  assert.equal(row.source_url, 'http://src.example/x');
  assert.equal(row.translation, 'trad');
});

test('saveLyrics can still explicitly clear source_url', async () => {
  const id = await mkSong({ title: 'ZZZCUR ClearURL' });
  await curation.saveLyrics(pool, id, { lyrics: 'x', source_url: 'http://src.example/y' });
  await curation.saveLyrics(pool, id, { lyrics: 'x', source_url: '' });
  const row = (await pool.query('SELECT source_url FROM song_lyrics WHERE song_id=$1', [id])).rows[0];
  assert.ok(row.source_url === null || row.source_url === '');
});

test('clearing lyrics keeps the row and its source_url/translation; song reads as needing lyrics', async () => {
  const id = await mkSong({ title: 'ZZZCUR ClearLyrics', status: 'included', published: true });
  await curation.saveLyrics(pool, id, { lyrics: 'words', source_url: 'http://s/z', translation: 'tr' });
  await curation.saveLyrics(pool, id, { lyrics: '' });
  const row = (await pool.query('SELECT lyrics, source_url, translation FROM song_lyrics WHERE song_id=$1', [id])).rows[0];
  assert.ok(row, 'row still exists');
  assert.equal(row.source_url, 'http://s/z');
  assert.equal(row.translation, 'tr');
  const wb = await curation.getWorkbench(pool, id);
  assert.equal(wb.completeness.lyrics, false);
  const needsIds = (await curation.listCurationQueue(pool, { queue: 'needs-lyrics' })).rows.map(r => r.id);
  assert.ok(needsIds.includes(id), 'a lyrics-cleared included song appears in needs-lyrics');
});

after(async () => {
  await pool.query(`DELETE FROM song_lyric_analysis WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZCUR%')`);
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

test('setProcessing updates only provided fields (toggling avenues keeps park reason + note)', async () => {
  const id = await mkSong({ title: 'ZZZCUR ProcPreserve' });
  await curation.setProcessing(pool, id, { park_reason: 'listened_unclear', processing_note: 'keep me' });
  await curation.setProcessing(pool, id, { lyrics_tried: ['google'] });
  const p = await curation.getProcessing(pool, id);
  assert.equal(p.park_reason, 'listened_unclear');
  assert.equal(p.processing_note, 'keep me');
  assert.deepEqual(p.lyrics_tried, ['google']);
});

test('setProcessing can explicitly clear the park reason', async () => {
  const id = await mkSong({ title: 'ZZZCUR ProcClear' });
  await curation.setProcessing(pool, id, { park_reason: 'listened_unclear' });
  await curation.setProcessing(pool, id, { park_reason: '' });
  const p = await curation.getProcessing(pool, id);
  assert.equal(p.park_reason, null);
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
  for (const k of ['to-process','awaiting-community','remind-later','needs-lyrics','needs-cover','needs-video','needs-analysis','to-finalise','inbox','live']) {
    assert.equal(typeof c[k], 'number', `count for ${k}`);
  }
});

test('queueCounts includes an all-catalogue total', async () => {
  const c = await curation.queueCounts(pool);
  assert.equal(typeof c.all, 'number');
  assert.ok(c.all >= c.live, 'all songs >= live songs');
});

test('catalogueStats returns integer totals by status', async () => {
  const s0 = await curation.catalogueStats(pool);
  assert.equal(typeof s0.total, 'number');
  await mkSong({ title: 'ZZZCUR Stat Live', status: 'included', published: true });
  await mkSong({ title: 'ZZZCUR Stat Fin',  status: 'included', published: false });
  await mkSong({ title: 'ZZZCUR Stat Pend', status: 'pending' });
  await mkSong({ title: 'ZZZCUR Stat Rej',  status: 'rejected' });
  const s1 = await curation.catalogueStats(pool);
  assert.equal(s1.total, s0.total + 4);
  assert.equal(s1.live, s0.live + 1);
  assert.equal(s1.toFinalise, s0.toFinalise + 1);
  assert.equal(s1.pending, s0.pending + 1);
  assert.equal(s1.rejected, s0.rejected + 1);
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

test('recentlyEdited returns most-recently-updated songs first', async () => {
  const older = await mkSong({ title: 'ZZZCUR Recent Older' });
  const newer = await mkSong({ title: 'ZZZCUR Recent Newer' });
  await pool.query(`UPDATE songs SET updated_at = now() + interval '2 seconds' WHERE id=$1`, [newer]);
  const rows = await curation.recentlyEdited(pool, 50);
  const ids = rows.map(r => r.id);
  assert.ok(ids.includes(newer), 'newer song present');
  assert.ok(ids.includes(older), 'older song present');
  assert.ok(ids.indexOf(newer) < ids.indexOf(older), 'newer appears before older');
  const row = rows.find(r => r.id === newer);
  assert.equal(typeof row.title, 'string');
  assert.ok('artists' in row && 'status' in row && 'published' in row && 'updated_at' in row);
});

test('recentlyEdited clamps limit into [1,50]', async () => {
  assert.equal((await curation.recentlyEdited(pool, 0)).length <= 1, true);
  assert.ok((await curation.recentlyEdited(pool, 9999)).length <= 50);
});

test('setFeatured toggles the featured flag and 404s on a missing song', async () => {
  const id = await mkSong({ title: 'ZZZCUR Featurable', status: 'included', published: true });
  const on = await curation.setFeatured(pool, id, true);
  assert.equal(on.featured, true);
  assert.equal(on.id, id);
  const off = await curation.setFeatured(pool, id, false);
  assert.equal(off.featured, false);
  const wb = await curation.getWorkbench(pool, id);
  assert.equal(wb.featured, false);
  await assert.rejects(curation.setFeatured(pool, 999999999, true), e => e.code === 'NOT_FOUND');
});

test('featured queue lists featured songs and queueCounts.featured tracks them', async () => {
  const f = await mkSong({ title: 'ZZZCUR Feat On', status: 'included', published: true });
  const n = await mkSong({ title: 'ZZZCUR Feat Off', status: 'included', published: true });
  await curation.setFeatured(pool, f, true);
  const before = (await curation.queueCounts(pool)).featured;
  const list = await curation.listCurationQueue(pool, { queue: 'featured' });
  const ids = list.rows.map(r => r.id);
  assert.ok(ids.includes(f), 'featured song present');
  assert.ok(!ids.includes(n), 'non-featured excluded');
  assert.equal(list.rows.find(r => r.id === f).featured, true, 'row carries featured');
  await curation.setFeatured(pool, n, true);
  assert.equal((await curation.queueCounts(pool)).featured, before + 1, 'count increments');
});
