const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const curation = require('../services/curation');

// Unique fixture sentinel per test file: ZZZGEN (see curation.test.js for the others).

async function mkArtist(name, genres = null) {
  return (await pool.query(`INSERT INTO artists (name, genres, data_source) VALUES ($1,$2,'manual') RETURNING id`, [name, genres])).rows[0].id;
}
async function mkSong({ title, status = 'included', genre = null, artists = [] }) {
  // songs_published_check: only included songs can be published.
  const id = (await pool.query(
    `INSERT INTO songs (title, status, published, genre, data_source) VALUES ($1,$2,$3,$4,'manual') RETURNING id`,
    [title, status, status === 'included', genre])).rows[0].id;
  for (const a of artists) await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, a]);
  return id;
}
const row = async (queue, id) =>
  (await curation.listCurationQueue(pool, { queue })).rows.find((r) => r.id === id);

after(async () => {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZGEN%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZGEN%'`);
  await pool.end();
});

test('the genre queues are known queue names and have counts', async () => {
  for (const q of ['needs-genre', 'genre-from-artist']) assert.ok(curation.QUEUE_NAMES.includes(q));
  const c = await curation.queueCounts(pool);
  assert.equal(typeof c['needs-genre'], 'number');
  assert.equal(typeof c['genre-from-artist'], 'number');
});

test('needs-genre: no genre on the song or its artist; either source takes it out', async () => {
  const bare = await mkArtist('ZZZGEN Bare');
  const emptyList = await mkArtist('ZZZGEN EmptyList', []);
  const punk = await mkArtist('ZZZGEN Punk', ['punk']);
  const none = await mkSong({ title: 'ZZZGEN None', artists: [bare] });
  const noArtist = await mkSong({ title: 'ZZZGEN NoArtist' });
  const blank = await mkSong({ title: 'ZZZGEN Blank', genre: '  ', artists: [emptyList] });
  const own = await mkSong({ title: 'ZZZGEN Own', genre: 'metal', artists: [bare] });
  const inherited = await mkSong({ title: 'ZZZGEN Inherited', artists: [punk] });
  const pending = await mkSong({ title: 'ZZZGEN Pending', status: 'pending', artists: [bare] });
  for (const id of [none, noArtist, blank]) assert.ok(await row('needs-genre', id));
  for (const id of [own, inherited, pending]) assert.ok(!(await row('needs-genre', id)));
});

test('genre-from-artist: only songs covered purely by the artist, tagged with that genre', async () => {
  const punk = await mkArtist('ZZZGEN Punk2', ['punk', 'hardcore']);
  const inherited = await mkSong({ title: 'ZZZGEN Inh2', artists: [punk] });
  const own = await mkSong({ title: 'ZZZGEN Own2', genre: 'metal', artists: [punk] });
  const r = await row('genre-from-artist', inherited);
  assert.ok(r);
  assert.equal(r.genre, 'punk');
  assert.equal(r.genre_source, 'artist');
  assert.ok(!(await row('genre-from-artist', own)));
});

test('queue rows report a song genre as source "song"', async () => {
  const id = await mkSong({ title: 'ZZZGEN RowSong', genre: 'metal' });
  const r = await row('all', id);
  assert.equal(r.genre, 'metal');
  assert.equal(r.genre_source, 'song');
});

test('getWorkbench serves the song genre and the artist genre with its artist', async () => {
  const a = await mkArtist('ZZZGEN Wb', ['skate punk']);
  const id = await mkSong({ title: 'ZZZGEN Wb', artists: [a] });
  const wb = await curation.getWorkbench(pool, id);
  assert.equal(wb.genre, null);
  assert.deepEqual(wb.artist_genre, { value: 'skate punk', artist: 'ZZZGEN Wb' });
});

test('saveDetails genre: a sub-genre sets its parent, a parent is its own parent, blank clears both', async () => {
  const id = await mkSong({ title: 'ZZZGEN Save' });
  let wb = await curation.saveDetails(pool, id, { genre: ' Death Metal ' });
  assert.equal(wb.genre, 'death metal');
  assert.equal(wb.parent_genre, 'metal');
  wb = await curation.saveDetails(pool, id, { genre: 'metal' });
  assert.equal(wb.parent_genre, 'metal');
  wb = await curation.saveDetails(pool, id, { genre: 'zzzgen made up' });
  assert.equal(wb.parent_genre, 'other');
  wb = await curation.saveDetails(pool, id, { title: 'ZZZGEN Save' });
  assert.equal(wb.genre, 'zzzgen made up', 'saving another field leaves the genre alone');
  wb = await curation.saveDetails(pool, id, { genre: '' });
  assert.equal(wb.genre, null);
  assert.equal(wb.parent_genre, null);
});

test('saveDetails rejects an over-long genre', async () => {
  const id = await mkSong({ title: 'ZZZGEN Long' });
  await assert.rejects(curation.saveDetails(pool, id, { genre: 'x'.repeat(101) }), { code: 'BAD_INPUT' });
});
