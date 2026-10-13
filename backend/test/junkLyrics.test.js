const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const junk = require('../services/junkLyrics');
const curation = require('../services/curation');

// Fixture sentinel for this file: ZZZJUNK. NEVER call scan() without songIds (it would flag real dev rows).

async function mk(title, lyrics, { status = 'included', published = true } = {}) {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source) VALUES ($1,$2,$3,'manual') RETURNING id`,
    [title, status, published])).rows[0];
  const a = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [`ZZZJUNK Artist ${title}`])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  if (lyrics !== null) await pool.query(`INSERT INTO song_lyrics (song_id, lyrics) VALUES ($1,$2)`, [s.id, lyrics]);
  return s.id;
}
const row = async (id) => (await pool.query('SELECT junk_kind, junk_dismissed FROM song_lyrics WHERE song_id=$1', [id])).rows[0];

after(async () => {
  await pool.query(`DELETE FROM song_lyric_analysis WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZJUNK%')`);
  await pool.query(`DELETE FROM song_lyrics WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZJUNK%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZJUNK%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZJUNK%'`);
  await pool.end();
});

test('scan flags error stubs and descriptions, leaves real lyrics alone, and is idempotent', async () => {
  const err = await mk('ZZZJUNK err', 'Error: Lyrics container not found on this Bandcamp page.');
  const yt = await mk('ZZZJUNK yt', 'Provided to YouTube by DistroKid\n\nSong · Artist\n\n℗ 2020');
  const ok = await mk('ZZZJUNK ok', 'Plug me in\nDon\'t count me in');
  const ids = [err, yt, ok];
  const r1 = await junk.scan(pool, { songIds: ids });
  assert.deepEqual({ scanned: r1.scanned, flagged: r1.flagged, cleared: r1.cleared }, { scanned: 3, flagged: 2, cleared: 0 });
  assert.equal((await row(err)).junk_kind, 'error');
  assert.equal((await row(yt)).junk_kind, 'youtube_description');
  assert.equal((await row(ok)).junk_kind, null);
  const r2 = await junk.scan(pool, { songIds: ids });
  assert.deepEqual({ flagged: r2.flagged, cleared: r2.cleared }, { flagged: 0, cleared: 0 }, 'second scan changes nothing');
});

test('scan clears a stale flag on emptied or now-fine lyrics, but skips dismissed rows', async () => {
  const emptied = await mk('ZZZJUNK emptied', 'Error: Could not find lyrics container on the page.');
  const dism = await mk('ZZZJUNK dismissed', 'Error: Could not find lyrics container on the page.');
  await junk.scan(pool, { songIds: [emptied, dism] });
  await junk.dismiss(pool, dism);
  await pool.query(`UPDATE song_lyrics SET lyrics='   ' WHERE song_id=$1`, [emptied]);
  const r = await junk.scan(pool, { songIds: [emptied, dism] });
  assert.equal(r.cleared, 1);
  assert.equal((await row(emptied)).junk_kind, null, 'blank text is not junk');
  const d = await row(dism);
  assert.equal(d.junk_kind, null);
  assert.equal(d.junk_dismissed, true);
  await pool.query(`UPDATE song_lyrics SET junk_kind=NULL WHERE song_id=$1`, [dism]);
  await junk.scan(pool, { songIds: [dism] });
  assert.equal((await row(dism)).junk_kind, null, 'a dismissed row is never re-flagged by scan');
});

test('dismiss on a song with no lyrics row throws NOT_FOUND', async () => {
  const none = await mk('ZZZJUNK nolyrics', null);
  await assert.rejects(junk.dismiss(pool, none), (e) => e.code === 'NOT_FOUND');
});

test('listJunk returns flagged songs with a truncated one-line snippet and has_analysis', async () => {
  const long = 'Provided to YouTube by X ' + 'word '.repeat(80);
  const id = await mk('ZZZJUNK listed', long, { status: 'pending', published: false });
  await junk.scan(pool, { songIds: [id] });
  const mine = (await junk.listJunk(pool)).find((r) => r.id === id);
  assert.ok(mine, 'listed');
  assert.equal(mine.junk_kind, 'youtube_description');
  assert.equal(mine.has_analysis, false);
  assert.ok(mine.snippet.length <= 120 && !mine.snippet.includes('\n'));
  assert.ok(mine.artists.startsWith('ZZZJUNK Artist'));
});

test('saveLyrics re-checks: junk flags, real text clears and resets a dismissal, junk over a dismissed row re-flags', async () => {
  const id = await mk('ZZZJUNK save', null);
  await curation.saveLyrics(pool, id, { lyrics: 'Error: Lyrics container not found on this Bandcamp page.' });
  assert.equal((await row(id)).junk_kind, 'error');
  await junk.dismiss(pool, id);
  assert.deepEqual(await row(id), { junk_kind: null, junk_dismissed: true });
  await curation.saveLyrics(pool, id, { lyrics: 'Error: Scraper for this domain is not implemented.' });
  assert.deepEqual(await row(id), { junk_kind: 'error', junk_dismissed: false }, 'new text re-flags despite earlier dismissal');
  await curation.saveLyrics(pool, id, { lyrics: 'Real words here\nand more real words' });
  assert.deepEqual(await row(id), { junk_kind: null, junk_dismissed: false });
  await curation.saveLyrics(pool, id, { lyrics: '' });
  assert.equal((await row(id)).junk_kind, null, 'cleared lyrics are not junk');
});

test('saving only a source_url / translation does not touch the flag', async () => {
  const id = await mk('ZZZJUNK keep', 'Error: Could not find lyrics container on the page.');
  await junk.scan(pool, { songIds: [id] });
  await curation.saveLyrics(pool, id, { source_url: 'https://example.org/x' });
  assert.equal((await row(id)).junk_kind, 'error');
});

const analysis = require('../services/analysis');

async function addAnalysis(id) {
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, perspective, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, 'zzzjunk-model', 'MORAL_JUDGEMENT', '[{"code":"captivity","evidence":"x"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`, [id]);
}

test('a flagged song loses its analysis in every shared read, and gets it back on dismiss', async () => {
  const id = await mk('ZZZJUNK hidden', 'Error: Lyrics container not found on this Bandcamp page.');
  await addAnalysis(id);
  const visible = async () => ({
    song: !!(await analysis.getSongAnalysis(pool, id)),
    exists: (await pool.query(`SELECT 1 FROM songs s WHERE s.id=$1 AND ${analysis.hasAnalysisExists('s')}`, [id])).rows.length === 1,
    latest: (await pool.query(`SELECT 1 FROM songs s JOIN ${analysis.LATEST_ANALYSIS} la ON la.song_id = s.id WHERE s.id=$1`, [id])).rows.length === 1,
  });
  assert.deepEqual(await visible(), { song: true, exists: true, latest: true }, 'visible before flagging');
  await junk.scan(pool, { songIds: [id] });
  assert.deepEqual(await visible(), { song: false, exists: false, latest: false }, 'hidden while flagged');
  await junk.dismiss(pool, id);
  assert.deepEqual(await visible(), { song: true, exists: true, latest: true }, 'back after Not junk');
});

test('browse facet counts exclude a flagged song and include it again after dismiss', async () => {
  const id = await mk('ZZZJUNK facet', 'Error: Lyrics container not found on this Bandcamp page.');
  await addAnalysis(id);
  // The same join every browse facet / filter count uses (browseFilters.joinSql, services/analysis.js consumers).
  const count = async () => (await pool.query(
    `SELECT COUNT(*)::int AS n FROM songs s JOIN ${analysis.LATEST_ANALYSIS} sa ON sa.song_id = s.id
     WHERE s.status='included' AND s.published=true AND s.title LIKE 'ZZZJUNK facet%'`)).rows[0].n;
  await junk.scan(pool, { songIds: [id] });
  assert.equal(await count(), 0);
  await junk.dismiss(pool, id);
  assert.equal(await count(), 1);
});

test('flagged songs read as having no lyrics: in needs-lyrics and junk-lyrics, never in needs-analysis', async () => {
  const id = await mk('ZZZJUNK queues', 'Provided to YouTube by DistroKid\n\nSong · Artist\n\n℗ 2020');
  await addAnalysis(id);
  await junk.scan(pool, { songIds: [id] });
  const inQ = async (q) => (await curation.listCurationQueue(pool, { queue: q })).rows.some((r) => r.id === id);
  assert.equal(await inQ('needs-lyrics'), true);
  assert.equal(await inQ('junk-lyrics'), true);
  assert.equal(await inQ('needs-analysis'), false);
  assert.ok((await curation.queueCounts(pool))['junk-lyrics'] >= 1);
  const wb = await curation.getWorkbench(pool, id);   // must not throw although analysed=true and analysis is hidden
  assert.equal(wb.junk_kind, 'youtube_description');
  assert.equal(wb.completeness.lyrics, false);
  assert.equal(wb.analysed, true);
  await junk.dismiss(pool, id);
  assert.equal(await inQ('junk-lyrics'), false);
  assert.equal(await inQ('needs-lyrics'), false);
  assert.equal((await curation.getWorkbench(pool, id)).junk_kind, null);
});
