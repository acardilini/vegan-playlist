const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const curation = require('../services/curation');
const genres = require('../services/genres');
const gm = require('../utils/genreMapping');

// Unique fixture sentinel per test file: ZZZGCH (see curation.test.js for the others).
// Fixture songs are never published, so no public read can see them; deleting a song cascades its audio row.

async function mkArtist(name, genres_ = null) {
  return (await pool.query(`INSERT INTO artists (name, genres, data_source) VALUES ($1,$2,'manual') RETURNING id`, [name, genres_])).rows[0].id;
}
async function mkSong({ title, genre = null, source = null, artists = [] }) {
  const id = (await pool.query(
    `INSERT INTO songs (title, status, published, genre, genre_source, data_source) VALUES ($1,'included',false,$2,$3,'manual') RETURNING id`,
    [title, genre, source])).rows[0].id;
  for (const a of artists) await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, a]);
  return id;
}
async function mkAudio(songId, { model = 'gemini-4-hydrogen', status = 'OK', sub = 'indie rock', parent = 'rock', secondary = 'post-punk',
  conf = 'HIGH', why = 'jangly guitars', summary = 'A bright indie song.' } = {}) {
  await pool.query(
    `INSERT INTO song_audio_analysis (song_id, model_used, audio_status, inferred_subgenre, inferred_parent_genre,
       inferred_secondary_genre, genre_confidence, genre_rationale, sonic_summary, analyzed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`, [songId, model, status, sub, parent, secondary, conf, why, summary]);
}
const row = async (queue, id, opts = {}) =>
  (await curation.listCurationQueue(pool, { queue, ...opts })).rows.find((r) => r.id === id);
const dbGenre = async (id) => (await pool.query('SELECT genre, parent_genre, genre_source FROM songs WHERE id=$1', [id])).rows[0];

after(async () => {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZGCH%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZGCH%'`);
  await pool.end();
});

test('audioSourceFor maps a model name to the genre_source it is stamped with', () => {
  assert.equal(curation.audioSourceFor('gemini-4-hydrogen'), 'audio_gemini');
  assert.equal(curation.audioSourceFor('Gemini-3.8-Flash'), 'audio_gemini');
  assert.equal(curation.audioSourceFor('local-mir-v1'), 'audio_local_mir');
  assert.equal(curation.audioSourceFor('something-else'), null);
  assert.equal(curation.audioSourceFor(null), null);
});

test('parentSql agrees with getParentGenre for every listed genre, a parent and an unknown string', async () => {
  const all = [...gm.getAllSubgenres(), ...gm.getParentGenres(), 'zz totally unknown genre'];
  const rows = (await pool.query(
    `SELECT g, ${genres.parentSql('g')} AS p FROM unnest($1::text[]) AS g`, [all])).rows;
  for (const r of rows) assert.equal(r.p, gm.getParentGenre(r.g), r.g);
  assert.equal(rows.length, all.length);
});

test('getWorkbench lists the audio-inferred genre options (OK rows with a subgenre only)', async () => {
  const id = await mkSong({ title: 'ZZZGCH Opts' });
  await mkAudio(id);
  await mkAudio(id, { model: 'broken-model', status: 'ERROR' });
  await mkAudio(id, { model: 'no-genre-model', sub: null, parent: null });
  const wb = await curation.getWorkbench(pool, id);
  assert.equal(wb.audio_genres.length, 1);
  assert.deepEqual(wb.audio_genres[0], {
    model_used: 'gemini-4-hydrogen', source: 'audio_gemini', subgenre: 'indie rock', parent: 'rock',
    secondary: 'post-punk', confidence: 'HIGH', rationale: 'jangly guitars', summary: 'A bright indie song.',
  });
  const none = await mkSong({ title: 'ZZZGCH NoAudio' });
  assert.deepEqual((await curation.getWorkbench(pool, none)).audio_genres, []);
  assert.equal(wb.genre_source, null);
});

test('chooseGenre artist: copies the artist genre, stamps spotify_artist', async () => {
  const a = await mkArtist('ZZZGCH A1', ['Skate Punk']);
  const id = await mkSong({ title: 'ZZZGCH ChooseArtist', artists: [a] });
  const wb = await curation.chooseGenre(pool, id, { source: 'artist' });
  assert.deepEqual(await dbGenre(id), { genre: 'skate punk', parent_genre: 'punk', genre_source: 'spotify_artist' });
  assert.equal(wb.genre, 'skate punk');
  const bare = await mkSong({ title: 'ZZZGCH ChooseArtistNone' });
  await assert.rejects(curation.chooseGenre(pool, bare, { source: 'artist' }), { code: 'BAD_INPUT' });
});

test('chooseGenre audio: reads the genre from the audio row (never the client), overwrites, stamps the model source', async () => {
  const id = await mkSong({ title: 'ZZZGCH ChooseAudio', genre: 'punk', source: 'manual' });
  await mkAudio(id, { sub: 'Melodic Death Metal', parent: 'rock' }); // a wrong parent in the row must not be trusted
  await curation.chooseGenre(pool, id, { source: 'audio', model: 'gemini-4-hydrogen', genre: 'country' });
  assert.deepEqual(await dbGenre(id), { genre: 'melodic death metal', parent_genre: 'metal', genre_source: 'audio_gemini' });
});

test('chooseGenre audio: refuses a missing row, an unusable row and an unrecognised model', async () => {
  const id = await mkSong({ title: 'ZZZGCH AudioBad' });
  await assert.rejects(curation.chooseGenre(pool, id, { source: 'audio', model: 'gemini-4-hydrogen' }), { code: 'BAD_INPUT' });
  await mkAudio(id, { model: 'mystery-model' });
  await assert.rejects(curation.chooseGenre(pool, id, { source: 'audio', model: 'mystery-model' }), { code: 'BAD_INPUT' });
  await mkAudio(id, { model: 'gemini-failed', status: 'ERROR' });
  await assert.rejects(curation.chooseGenre(pool, id, { source: 'audio', model: 'gemini-failed' }), { code: 'BAD_INPUT' });
  await assert.rejects(curation.chooseGenre(pool, id, { source: 'nonsense' }), { code: 'BAD_INPUT' });
  assert.equal((await dbGenre(id)).genre, null, 'nothing was written');
  await assert.rejects(curation.chooseGenre(pool, 999999999, { source: 'artist' }), { code: 'NOT_FOUND' });
});

test('chooseGenre keep: stamps a song genre manual; an inherited artist genre is written with spotify_artist', async () => {
  const own = await mkSong({ title: 'ZZZGCH KeepOwn', genre: 'hardcore punk' });
  await curation.chooseGenre(pool, own, { source: 'keep' });
  assert.deepEqual(await dbGenre(own), { genre: 'hardcore punk', parent_genre: null, genre_source: 'manual' });
  const a = await mkArtist('ZZZGCH A2', ['folk']);
  const inh = await mkSong({ title: 'ZZZGCH KeepInh', artists: [a] });
  await curation.chooseGenre(pool, inh, { source: 'keep' });
  assert.deepEqual(await dbGenre(inh), { genre: 'folk', parent_genre: 'folk', genre_source: 'spotify_artist' });
  const bare = await mkSong({ title: 'ZZZGCH KeepNone' });
  await assert.rejects(curation.chooseGenre(pool, bare, { source: 'keep' }), { code: 'BAD_INPUT' });
});

test('genre-from-audio queue: no genre anywhere + an audio subgenre; rows carry the audio genre', async () => {
  const a = await mkArtist('ZZZGCH A3', ['metal']);
  const bare = await mkArtist('ZZZGCH A4');
  const fill = await mkSong({ title: 'ZZZGCH Fill', artists: [bare] });
  const hasOwn = await mkSong({ title: 'ZZZGCH FillOwn', genre: 'punk', artists: [bare] });
  const hasArtist = await mkSong({ title: 'ZZZGCH FillArtist', artists: [a] });
  const noAudio = await mkSong({ title: 'ZZZGCH FillNoAudio', artists: [bare] });
  for (const id of [fill, hasOwn, hasArtist]) await mkAudio(id);
  const r = await row('genre-from-audio', fill);
  assert.ok(r);
  assert.equal(r.audio_subgenre, 'indie rock');
  assert.equal(r.audio_confidence, 'HIGH');
  for (const id of [hasOwn, hasArtist, noAudio]) assert.ok(!(await row('genre-from-audio', id)));
  await curation.chooseGenre(pool, fill, { source: 'audio', model: 'gemini-4-hydrogen' });
  assert.ok(!(await row('genre-from-audio', fill)), 'leaves the queue once chosen');
});

test('genre-conflicts queue: a different parent, not other, not already decided', async () => {
  const hc = await mkArtist('ZZZGCH A5', ['hardcore']);
  const conflictOwn = await mkSong({ title: 'ZZZGCH ConfOwn', genre: 'hardcore punk' });          // punk vs rock
  const conflictInh = await mkSong({ title: 'ZZZGCH ConfInh', artists: [hc] });                    // hardcore vs rock
  const sameParent = await mkSong({ title: 'ZZZGCH ConfSame', genre: 'garage rock' });             // rock vs rock
  const decided = await mkSong({ title: 'ZZZGCH ConfDecided', genre: 'hardcore punk', source: 'manual' });
  const otherParent = await mkSong({ title: 'ZZZGCH ConfOther', genre: 'christian' });             // existing parent is other
  const noAudio = await mkSong({ title: 'ZZZGCH ConfNoAudio', genre: 'hardcore punk' });
  for (const id of [conflictOwn, conflictInh, sameParent, decided, otherParent]) await mkAudio(id);
  for (const id of [conflictOwn, conflictInh]) assert.ok(await row('genre-conflicts', id), `${id} is a conflict`);
  for (const id of [sameParent, decided, otherParent, noAudio]) assert.ok(!(await row('genre-conflicts', id)), `${id} is not`);
});

test('genre-conflicts leaves the queue on Keep and on Use audio genre; the pair filter and pair counts work', async () => {
  const keepMe = await mkSong({ title: 'ZZZGCH PairKeep', genre: 'hardcore punk' });
  const useMe = await mkSong({ title: 'ZZZGCH PairUse', genre: 'hardcore punk' });
  const other = await mkSong({ title: 'ZZZGCH PairOther', genre: 'blues' });
  await mkAudio(keepMe); await mkAudio(useMe); await mkAudio(other);
  const pairs = await curation.genreConflictPairs(pool);
  const punkRock = pairs.find((p) => p.from === 'punk' && p.to === 'rock');
  assert.ok(punkRock && punkRock.count >= 2);
  assert.ok(pairs.find((p) => p.from === 'blues' && p.to === 'rock'));
  const inPair = (await curation.listCurationQueue(pool, { queue: 'genre-conflicts', pair: 'punk>rock' })).rows.map((r) => r.id);
  assert.ok(inPair.includes(keepMe) && inPair.includes(useMe) && !inPair.includes(other));
  await assert.rejects(curation.listCurationQueue(pool, { queue: 'genre-conflicts', pair: 'bad' }), { code: 'BAD_QUEUE' });
  await curation.chooseGenre(pool, keepMe, { source: 'keep' });
  await curation.chooseGenre(pool, useMe, { source: 'audio', model: 'gemini-4-hydrogen' });
  assert.ok(!(await row('genre-conflicts', keepMe)));
  assert.ok(!(await row('genre-conflicts', useMe)));
  assert.ok(await row('genre-conflicts', other));
});

test('both queues are known names and have counts', async () => {
  for (const q of ['genre-from-audio', 'genre-conflicts']) assert.ok(curation.QUEUE_NAMES.includes(q));
  const c = await curation.queueCounts(pool);
  assert.equal(typeof c['genre-from-audio'], 'number');
  assert.equal(typeof c['genre-conflicts'], 'number');
});
