const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const curation = require('../services/curation');

// Unique fixture sentinel per test file: ZZZALB (see curation.test.js for the others).

async function mkAlbum({ name, release_date = null, data_source = 'manual' }) {
  // albums_source_check: a Spotify album needs a spotify_id, a manual one must not have one.
  const spotifyId = data_source === 'spotify' ? `ZZZALB${Date.now()}${Math.random().toString(36).slice(2, 8)}` : null;
  return (await pool.query(
    `INSERT INTO albums (name, release_date, data_source, spotify_id) VALUES ($1,$2,$3,$4) RETURNING id`,
    [name, release_date, data_source, spotifyId])).rows[0].id;
}
async function mkSong({ title, status = 'included', album_id = null, language = null }) {
  // songs_published_check: only included songs can be published.
  return (await pool.query(
    `INSERT INTO songs (title, status, published, album_id, language, data_source)
     VALUES ($1,$2,$3,$4,$5,'manual') RETURNING id`,
    [title, status, status === 'included', album_id, language])).rows[0].id;
}
const inQueue = async (queue, id) =>
  (await curation.listCurationQueue(pool, { queue })).rows.some((r) => r.id === id);

after(async () => {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZALB%'`);
  await pool.query(`DELETE FROM albums WHERE name LIKE 'ZZZALB%'`);
  await pool.end();
});

test('the three queues are known queue names', () => {
  for (const q of ['needs-album', 'needs-released', 'needs-language']) assert.ok(curation.QUEUE_NAMES.includes(q));
});

test('needs-album: no album row or a blank album name, included songs only', async () => {
  const none = await mkSong({ title: 'ZZZALB NoAlbum' });
  const blank = await mkSong({ title: 'ZZZALB BlankAlbum', album_id: await mkAlbum({ name: '  ' }) });
  const ok = await mkSong({ title: 'ZZZALB HasAlbum', album_id: await mkAlbum({ name: 'ZZZALB Real' }) });
  const pending = await mkSong({ title: 'ZZZALB PendingNoAlbum', status: 'pending' });
  assert.ok(await inQueue('needs-album', none));
  assert.ok(await inQueue('needs-album', blank));
  assert.ok(!(await inQueue('needs-album', ok)));
  assert.ok(!(await inQueue('needs-album', pending)));
});

test('needs-released: album without a release date (or no album) is in; a dated album is out', async () => {
  const undated = await mkSong({ title: 'ZZZALB Undated', album_id: await mkAlbum({ name: 'ZZZALB U' }) });
  const noAlbum = await mkSong({ title: 'ZZZALB NoAlbumDate' });
  const dated = await mkSong({ title: 'ZZZALB Dated', album_id: await mkAlbum({ name: 'ZZZALB D', release_date: '2020-05-01' }) });
  assert.ok(await inQueue('needs-released', undated));
  assert.ok(await inQueue('needs-released', noAlbum));
  assert.ok(!(await inQueue('needs-released', dated)));
});

test('needs-language: NULL or empty list is in; any language is out', async () => {
  const nul = await mkSong({ title: 'ZZZALB LangNull' });
  const empty = await mkSong({ title: 'ZZZALB LangEmpty', language: [] });
  const set = await mkSong({ title: 'ZZZALB LangSet', language: ['English'] });
  assert.ok(await inQueue('needs-language', nul));
  assert.ok(await inQueue('needs-language', empty));
  assert.ok(!(await inQueue('needs-language', set)));
});

test('queueCounts reports the three new queues', async () => {
  const c = await curation.queueCounts(pool);
  for (const q of ['needs-album', 'needs-released', 'needs-language']) assert.equal(typeof c[q], 'number');
});

test('saveAlbum creates a manual album when the song has none, then fills the gaps', async () => {
  const id = await mkSong({ title: 'ZZZALB Create' });
  const wb = await curation.saveAlbum(pool, id, { name: 'ZZZALB Made', release_date: '2019-03-08' });
  assert.equal(wb.album.name, 'ZZZALB Made');
  assert.equal(String(wb.album.release_date).slice(0, 10), '2019-03-08');
  assert.ok(!(await inQueue('needs-released', id)));
  const row = (await pool.query(
    `SELECT al.data_source FROM songs s JOIN albums al ON al.id=s.album_id WHERE s.id=$1`, [id])).rows[0];
  assert.equal(row.data_source, 'manual');
});

test('saveAlbum with no name falls back to the song title for a new album', async () => {
  const id = await mkSong({ title: 'ZZZALB Single' });
  const wb = await curation.saveAlbum(pool, id, { release_date: '2021-01-02' });
  assert.equal(wb.album.name, 'ZZZALB Single');
});

test('saveAlbum edits an existing manual album and "" clears the date', async () => {
  const id = await mkSong({ title: 'ZZZALB Edit', album_id: await mkAlbum({ name: 'ZZZALB Old', release_date: '2000-01-01' }) });
  let wb = await curation.saveAlbum(pool, id, { name: 'ZZZALB New' });
  assert.equal(wb.album.name, 'ZZZALB New');
  assert.equal(String(wb.album.release_date).slice(0, 10), '2000-01-01', 'omitted field untouched');
  wb = await curation.saveAlbum(pool, id, { release_date: '' });
  assert.equal(wb.album.release_date, null);
});

test('saveAlbum refuses a Spotify-owned album and leaves it untouched', async () => {
  const albumId = await mkAlbum({ name: 'ZZZALB Spot', release_date: '2010-10-10', data_source: 'spotify' });
  const id = await mkSong({ title: 'ZZZALB SpotSong', album_id: albumId });
  await assert.rejects(curation.saveAlbum(pool, id, { name: 'Hacked', release_date: '2011-11-11' }), (e) => e.code === 'BAD_INPUT');
  const a = (await pool.query('SELECT name FROM albums WHERE id=$1', [albumId])).rows[0];
  assert.equal(a.name, 'ZZZALB Spot');
});

test('saveAlbum rejects bad dates, a blank name, and unknown songs', async () => {
  const id = await mkSong({ title: 'ZZZALB Bad', album_id: await mkAlbum({ name: 'ZZZALB B' }) });
  for (const d of ['2020', '2020-13-01', '2020-02-31', 'yesterday']) {
    await assert.rejects(curation.saveAlbum(pool, id, { release_date: d }), (e) => e.code === 'BAD_INPUT', d);
  }
  await assert.rejects(curation.saveAlbum(pool, id, { name: '   ' }), (e) => e.code === 'BAD_INPUT');
  await assert.rejects(curation.saveAlbum(pool, 999999999, { name: 'x' }), (e) => e.code === 'NOT_FOUND');
});
