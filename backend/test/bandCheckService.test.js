const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const svc = require('../services/bandCheck');

// Fixture sentinel for this file: ZZZBANDSVC.
const SP1 = 'ZZZBANDSVCaaaaaaaaaaaa', SP2 = 'ZZZBANDSVCbbbbbbbbbbbb'; // 22 chars each
const MB = '11111111-2222-3333-4444-555555555555';
async function mkArtist(name, { spotify_id = null } = {}) {
  return (await pool.query(`INSERT INTO artists (name, spotify_id, data_source) VALUES ($1,$2,$3) RETURNING id`,
    [name, spotify_id, spotify_id ? 'spotify' : 'manual'])).rows[0].id;
}
async function mkSong(artistId, title, { status = 'included', published = true, bandcamp_url = null, spotify_id = null } = {}) {
  const id = (await pool.query(`INSERT INTO songs (title, status, published, bandcamp_url, spotify_id, data_source) VALUES ($1,$2,$3,$4,$5,'manual') RETURNING id`,
    [title, status, published, bandcamp_url, spotify_id])).rows[0].id;
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, artistId]);
  return id;
}
after(async () => {
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZBANDSVC%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZBANDSVC%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZBANDSVC%'`);
  await pool.end();
});

test('listBands: searches by name, counts songs and live songs, reports identity flags, pages', async () => {
  const a = await mkArtist('ZZZBANDSVC Alpha');
  await mkArtist('ZZZBANDSVC Beta', { spotify_id: SP1 });
  await mkSong(a, 'ZZZBANDSVC s1'); await mkSong(a, 'ZZZBANDSVC s2', { status: 'pending', published: false });
  const { rows, total } = await svc.listBands(pool, { q: 'zzzbandsvc' });
  assert.equal(total, 2);
  assert.deepEqual(rows.map(r => r.name), ['ZZZBANDSVC Alpha', 'ZZZBANDSVC Beta']);
  assert.deepEqual([rows[0].songs, rows[0].live_songs], [2, 1]);
  assert.deepEqual(rows[0].identity, { spotify: false, bandcamp: false, musicbrainz: false });
  assert.equal(rows[1].identity.spotify, true);
  assert.equal((await svc.listBands(pool, { q: 'zzzbandsvc', limit: 1, offset: 1 })).rows[0].name, 'ZZZBANDSVC Beta');
  assert.equal((await svc.listBands(pool, { q: 'zzzbandsvc%' })).total, 0); // % is literal, not a wildcard
});

test('saveIdentity writes only the matching column, validates, clears bandcamp/musicbrainz, and sets data_source for spotify', async () => {
  const a = await mkArtist('ZZZBANDSVC Ident');
  let id = await svc.saveIdentity(pool, a, 'musicbrainz', MB);
  assert.equal(id.musicbrainz, MB);
  id = await svc.saveIdentity(pool, a, 'bandcamp', 'https://ZZZBANDSVC.bandcamp.com/album/x');
  assert.equal(id.bandcamp, 'https://zzzbandsvc.bandcamp.com');
  id = await svc.saveIdentity(pool, a, 'spotify', SP2);
  assert.equal(id.spotify, SP2);
  assert.equal((await pool.query(`SELECT data_source FROM artists WHERE id=$1`, [a])).rows[0].data_source, 'spotify');
  id = await svc.saveIdentity(pool, a, 'musicbrainz', null);
  assert.equal(id.musicbrainz, null);
  assert.equal(id.spotify, SP2); // untouched
  for (const [src, v] of [['musicbrainz', 'not-a-uuid'], ['spotify', 'short'], ['spotify', null], ['bandcamp', 'https://example.com'], ['bandcamp', 'https://zzz.bandcamp.com.evil.com'], ['nope', 'x']]) {
    await assert.rejects(svc.saveIdentity(pool, a, src, v), (e) => e.code === 'BAD_INPUT', `${src} ${v}`);
  }
  await assert.rejects(svc.saveIdentity(pool, 2147483646, 'musicbrainz', MB), (e) => e.code === 'NOT_FOUND');
});

test('saveIdentity refuses a Spotify id that belongs to a different artist row', async () => {
  const other = await mkArtist('ZZZBANDSVC Owner', { spotify_id: 'ZZZBANDSVCcccccccccccc' });
  const mine = await mkArtist('ZZZBANDSVC Claimer');
  await assert.rejects(svc.saveIdentity(pool, mine, 'spotify', 'ZZZBANDSVCcccccccccccc'), (e) => e.code === 'CONFLICT');
  assert.equal((await pool.query(`SELECT spotify_id FROM artists WHERE id=$1`, [mine])).rows[0].spotify_id, null);
  assert.ok(other);
});

test('identifyCandidates: spotify/musicbrainz delegate with the band name by default; bandcamp merges song links and the MusicBrainz link', async () => {
  const a = await mkArtist('ZZZBANDSVC Cands');
  await pool.query(`UPDATE artists SET musicbrainz_id=$2 WHERE id=$1`, [a, MB]);
  await mkSong(a, 'ZZZBANDSVC c1', { bandcamp_url: 'https://zzzbandsvcband.bandcamp.com/track/one' });
  await mkSong(a, 'ZZZBANDSVC c2', { bandcamp_url: 'https://zzzbandsvcband.bandcamp.com/album/two' });
  await mkSong(a, 'ZZZBANDSVC c3', { bandcamp_url: 'https://elsewhere.example.com/x' }); // not bandcamp: ignored
  const seen = [];
  const adapters = {
    spotify: { identify: async (q) => { seen.push(['sp', q]); return [{ value: SP1, label: 'X', detail: '', url: null }]; } },
    musicbrainz: { identify: async (q) => { seen.push(['mb', q]); return []; }, bandcampLink: async () => 'https://fromMB.bandcamp.com/' },
  };
  assert.equal((await svc.identifyCandidates(pool, a, 'spotify', { adapters }))[0].value, SP1);
  await svc.identifyCandidates(pool, a, 'musicbrainz', { query: 'Other Name', adapters });
  assert.deepEqual(seen, [['sp', 'ZZZBANDSVC Cands'], ['mb', 'Other Name']]);
  const bc = await svc.identifyCandidates(pool, a, 'bandcamp', { adapters });
  assert.deepEqual(bc.map(c => [c.value, c.detail]).sort(), [
    ['https://frommb.bandcamp.com', 'from MusicBrainz'],
    ['https://zzzbandsvcband.bandcamp.com', "from this band's song links"],
  ]);
});
