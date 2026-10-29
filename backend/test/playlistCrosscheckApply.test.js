const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const staging = require('../services/staging');
const xc = require('../services/playlistCrosscheck');

// Fixture sentinel for this file: ZZZXCHKA.
const track = (id, title, artist = 'ZZZXCHKA Band') => ({
  spotify_id: id, title, duration_ms: 1, popularity: 1, explicit: false, track_number: 1, disc_number: 1, spotify_url: null, added_at: null,
  artists: [{ spotify_id: 'ZZZXCHKA_art_' + artist, name: artist, spotify_url: null }], album: null,
});
const INPUT = 'spotify:playlist:4RvN6XwfV6cQ0eZV7PF215';
const listOf = (...tracks) => async () => ({ name: 'ZZZXCHKA list', ignored: 0, tracks });
const row = async (spotifyId) => (await pool.query(`SELECT id, status, status_notes, updated_at FROM songs WHERE spotify_id=$1`, [spotifyId])).rows[0];
const lyricsOf = async (songId) => (await pool.query(`SELECT lyrics FROM song_lyrics WHERE song_id=$1`, [songId])).rows[0];

beforeEach(() => xc._resetForTests());
after(async () => {
  await pool.query(`DELETE FROM song_lyrics WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZXCHKA%')`);
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZXCHKA%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZXCHKA%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZXCHKA%'`);
  await pool.end();
});

test('apply imports a New track as pending with the crosscheck note and rejects another as rejected', async () => {
  const r = await xc.apply(pool, { input: INPUT, importIds: ['ZZZXCHKA_i1'], rejectIds: ['ZZZXCHKA_r1'],
    fetchPlaylist: listOf(track('ZZZXCHKA_i1', 'ZZZXCHKA Import'), track('ZZZXCHKA_r1', 'ZZZXCHKA Reject')) });
  assert.equal(r.imported, 1);
  assert.equal(r.rejected, 1);
  const i = await row('ZZZXCHKA_i1'), j = await row('ZZZXCHKA_r1');
  assert.equal(i.status, 'pending');
  assert.equal(i.status_notes, 'added via playlist cross-check (ZZZXCHKA list)');
  assert.equal(j.status, 'rejected');
  assert.equal(j.status_notes, 'rejected via playlist cross-check (ZZZXCHKA list)');
});

test('apply imports a chosen Possible duplicate as a second song and leaves the original untouched', async () => {
  await staging.insertCandidates(pool, [track('ZZZXCHKA_o1', 'ZZZXCHKA Twin')]);
  const before = await row('ZZZXCHKA_o1');
  const r = await xc.apply(pool, { input: INPUT, importIds: ['ZZZXCHKA_o2'], fetchPlaylist: listOf(track('ZZZXCHKA_o2', 'ZZZXCHKA Twin')) });
  assert.equal(r.imported, 1);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM songs WHERE title='ZZZXCHKA Twin'`)).rows[0].n, 2);
  assert.deepEqual(await row('ZZZXCHKA_o1'), before);
});

test('apply skips a track already in the catalogue, even a rejected one, and leaves it unchanged', async () => {
  await staging.insertCandidates(pool, [track('ZZZXCHKA_h1', 'ZZZXCHKA Held')]);
  await pool.query(`UPDATE songs SET status='rejected' WHERE spotify_id='ZZZXCHKA_h1'`);
  const before = await row('ZZZXCHKA_h1');
  const r = await xc.apply(pool, { input: INPUT, importIds: ['ZZZXCHKA_h1'], fetchPlaylist: listOf(track('ZZZXCHKA_h1', 'ZZZXCHKA Held')) });
  assert.equal(r.imported, 0);
  assert.deepEqual(r.skipped, [{ spotify_id: 'ZZZXCHKA_h1', reason: 'already_have' }]);
  assert.deepEqual(await row('ZZZXCHKA_h1'), before);
});

test('apply skips an id that is not on the playlist', async () => {
  const r = await xc.apply(pool, { input: INPUT, importIds: ['ZZZXCHKA_nope'], fetchPlaylist: listOf(track('ZZZXCHKA_p1', 'ZZZXCHKA Other')) });
  assert.deepEqual(r.skipped, [{ spotify_id: 'ZZZXCHKA_nope', reason: 'not_on_playlist' }]);
  assert.equal(await row('ZZZXCHKA_nope'), undefined);
});

test('apply saves pasted lyrics for imported and rejected songs, ignores blank lyrics and lyrics for an unchosen id', async () => {
  const r = await xc.apply(pool, { input: INPUT, importIds: ['ZZZXCHKA_l1', 'ZZZXCHKA_l3'], rejectIds: ['ZZZXCHKA_l2'],
    lyrics: { ZZZXCHKA_l1: 'words one', ZZZXCHKA_l2: 'words two', ZZZXCHKA_l3: '   \n ', ZZZXCHKA_l4: 'not chosen' },
    fetchPlaylist: listOf(track('ZZZXCHKA_l1', 'ZZZXCHKA L1'), track('ZZZXCHKA_l2', 'ZZZXCHKA L2'), track('ZZZXCHKA_l3', 'ZZZXCHKA L3'), track('ZZZXCHKA_l4', 'ZZZXCHKA L4')) });
  assert.equal(r.lyricsSaved, 2);
  assert.equal((await lyricsOf((await row('ZZZXCHKA_l1')).id)).lyrics, 'words one');
  assert.equal((await lyricsOf((await row('ZZZXCHKA_l2')).id)).lyrics, 'words two');
  assert.equal(await lyricsOf((await row('ZZZXCHKA_l3')).id), undefined);
  assert.equal(await row('ZZZXCHKA_l4'), undefined);
});

test('apply keeps the import when saving lyrics throws and lists the id in lyricsFailed', async () => {
  const r = await xc.apply(pool, { input: INPUT, importIds: ['ZZZXCHKA_f1'], lyrics: { ZZZXCHKA_f1: 'some words' },
    saveLyricsFn: async () => { throw new Error('boom'); }, fetchPlaylist: listOf(track('ZZZXCHKA_f1', 'ZZZXCHKA Fail')) });
  assert.equal(r.imported, 1);
  assert.deepEqual(r.lyricsFailed, ['ZZZXCHKA_f1']);
  assert.equal((await row('ZZZXCHKA_f1')).status, 'pending');
});

test('apply rejects bad input with BAD_INPUT', async () => {
  const f = listOf(track('ZZZXCHKA_b1', 'ZZZXCHKA Bad'));
  const bad = [
    { importIds: ['x'], rejectIds: ['x'] },
    {},
    { importIds: [] },
    { importIds: Array.from({ length: 101 }, (_, i) => 'ZZZXCHKA_many' + i) },
    { importIds: 'x' },
    { importIds: ['ZZZXCHKA_b1'], lyrics: { ZZZXCHKA_b1: 'a'.repeat(100001) } },
    { importIds: ['ZZZXCHKA_b1'], lyrics: 'text' },
  ];
  for (const b of bad) await assert.rejects(xc.apply(pool, { input: INPUT, fetchPlaylist: f, ...b }), (e) => e.code === 'BAD_INPUT');
});

test('apply refuses a second concurrent call with BUSY and recovers afterwards', async () => {
  let release;
  const gate = new Promise((res) => { release = res; });
  const slow = async () => { await gate; return { name: 'ZZZXCHKA list', ignored: 0, tracks: [track('ZZZXCHKA_c1', 'ZZZXCHKA Busy')] }; };
  const first = xc.apply(pool, { input: INPUT, importIds: ['ZZZXCHKA_c1'], fetchPlaylist: slow });
  await assert.rejects(xc.apply(pool, { input: INPUT, importIds: ['ZZZXCHKA_c1'], fetchPlaylist: slow }), (e) => e.code === 'BUSY');
  release();
  assert.equal((await first).imported, 1);
  const third = await xc.apply(pool, { input: INPUT, importIds: ['ZZZXCHKA_c1'], fetchPlaylist: slow });
  assert.equal(third.imported, 0);
});

test('a Spotify id listed twice on the playlist is applied once', async () => {
  const t = track('ZZZXCHKA_d1', 'ZZZXCHKA Dupe');
  const r = await xc.apply(pool, { input: INPUT, importIds: ['ZZZXCHKA_d1', 'ZZZXCHKA_d1'], fetchPlaylist: listOf(t, t) });
  assert.equal(r.imported, 1);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM songs WHERE spotify_id='ZZZXCHKA_d1'`)).rows[0].n, 1);
});
