const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const svc = require('../services/bandCheck');
const curation = require('../services/curation');

// Fixture sentinel for this file: ZZZCLA.
const SPBAND = 'ZZZCLAmmmmmmmmmmmmmmmm'; // 22 chars
async function clean() {
  await pool.query(`DELETE FROM song_lyrics WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZCLA%')`);
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZCLA%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZCLA%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZCLA%'`);
}
test('pre-clean leftovers from a crashed run', clean);
after(async () => { await clean(); await pool.end(); });

function spTrack(id, title) { return { title, id, url: 'https://open.spotify.com/track/' + id, mapped: {
  spotify_id: id, title, duration_ms: 1, popularity: 1, explicit: false, track_number: 1, disc_number: 1, spotify_url: 'https://open.spotify.com/track/' + id, added_at: null,
  artists: [{ spotify_id: SPBAND, name: 'ZZZCLA Band', spotify_url: null }], album: null } }; }
const SPOT = { source: 'spotify', releases: [{ id: 'r1', name: 'Alb', album_type: 'album', release_date: '2020', url: null, tracks: [spTrack('ZZZCLAt1', 'ZZZCLA Held'), spTrack('ZZZCLAt2', 'ZZZCLA Fresh')] }] };
const BAND = { source: 'bandcamp', releases: [{ id: '/album/a', name: 'Alb', album_type: 'album', release_date: '2020-01-01', url: null, tracks: [
  { title: 'ZZZCLA Fresh', id: null, url: 'https://zzzcla.bandcamp.com/track/fresh' },
  { title: 'ZZZCLA Bandcamp Only', id: null, url: 'https://zzzcla.bandcamp.com/track/bco' }] }] };
const adapters = () => ({ spotify: { fetchCatalogue: async () => SPOT }, bandcamp: { fetchCatalogue: async () => BAND } });
async function band() {
  svc._resetForTests();
  await clean();
  const a = (await pool.query(`INSERT INTO artists (name, spotify_id, data_source, bandcamp_url) VALUES ('ZZZCLA Band',$1,'spotify','https://zzzcla.bandcamp.com') RETURNING id`, [SPBAND])).rows[0].id;
  const held = (await pool.query(`INSERT INTO songs (title, status, published, data_source) VALUES ('ZZZCLA Held','pending',false,'manual') RETURNING id`)).rows[0].id;
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [held, a]);
  return { a, held };
}
const L = (text, source = 'Bandcamp', url = null) => ({ text, source, url });
const lyricsOf = async (title) => (await pool.query(
  `SELECT s.id, s.status, s.lyrics_source, sl.lyrics, sl.source_url FROM songs s LEFT JOIN song_lyrics sl ON sl.song_id = s.id WHERE s.title = $1`, [title])).rows[0];

test('apply saves lyrics for a processed Spotify-mapped song and a processed manual (Bandcamp-only) song', async () => {
  const { a } = await band();
  const lyrics = new Map([['zzzcla fresh', L('fresh words', 'Bandcamp', 'https://zzzcla.bandcamp.com/track/fresh')], ['zzzcla bandcamp only', L('only words', 'Added by curator')]]);
  const res = await svc.addSelected(pool, a, ['zzzcla fresh', 'zzzcla bandcamp only'], { adapters: adapters(), lyrics });
  assert.deepEqual([res.added, res.lyricsSaved, res.lyricsFailed], [2, 2, []]);
  const fresh = await lyricsOf('ZZZCLA Fresh'), only = await lyricsOf('ZZZCLA Bandcamp Only');
  assert.deepEqual([fresh.lyrics, fresh.lyrics_source, fresh.source_url], ['fresh words', 'Bandcamp', 'https://zzzcla.bandcamp.com/track/fresh']);
  assert.deepEqual([only.lyrics, only.lyrics_source], ['only words', 'Added by curator']);
});

test('apply saves lyrics for a rejected song and the song is still rejected', async () => {
  const { a } = await band();
  const res = await svc.addSelected(pool, a, ['zzzcla fresh'], { adapters: adapters(), rejectKeys: ['zzzcla bandcamp only'], lyrics: new Map([['zzzcla bandcamp only', L('rejected words')]]) });
  assert.deepEqual([res.added, res.rejected, res.lyricsSaved], [1, 1, 1]);
  const only = await lyricsOf('ZZZCLA Bandcamp Only');
  assert.deepEqual([only.status, only.lyrics], ['rejected', 'rejected words']);
  assert.equal((await pool.query(`SELECT published FROM songs WHERE id=$1`, [only.id])).rows[0].published, false);
});

test('apply does NOT put lyrics on a song that already existed in the catalogue', async () => {
  const { a, held } = await band();
  const res = await svc.addSelected(pool, a, ['zzzcla held', 'zzzcla fresh'], { adapters: adapters(), lyrics: new Map([['zzzcla held', L('should not land')]]) });
  assert.equal(res.skippedExisting, 1);
  assert.equal(res.lyricsSaved, 0);
  assert.equal((await pool.query(`SELECT 1 FROM song_lyrics WHERE song_id=$1`, [held])).rows.length, 0);
});

test("a failure saving one song's lyrics does not fail apply", async () => {
  const { a } = await band();
  const orig = curation.saveLyrics;
  curation.saveLyrics = async (db, id, o) => { if (o.lyrics === 'boom') throw new Error('secret'); return orig(db, id, o); };
  try {
    const res = await svc.addSelected(pool, a, ['zzzcla fresh', 'zzzcla bandcamp only'], { adapters: adapters(), lyrics: new Map([['zzzcla fresh', L('boom')], ['zzzcla bandcamp only', L('fine words')]]) });
    assert.deepEqual([res.added, res.lyricsSaved, res.lyricsFailed], [2, 1, ['ZZZCLA Fresh']]);
  } finally { curation.saveLyrics = orig; }
  assert.equal((await lyricsOf('ZZZCLA Bandcamp Only')).lyrics, 'fine words');
  assert.equal((await lyricsOf('ZZZCLA Fresh')).lyrics, null);
});

test('apply without lyrics keeps its result shape', async () => {
  const { a } = await band();
  const res = await svc.addSelected(pool, a, ['zzzcla fresh'], { adapters: adapters() });
  assert.deepEqual(res, { added: 1, rejected: 0, skippedExisting: 0, notFound: 0 });
});
