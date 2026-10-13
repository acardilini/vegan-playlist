const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const svc = require('../services/bandCheck');

// Fixture sentinel for this file: ZZZBANDSVC.
const SP1 = 'ZZZBANDSVCaaaaaaaaaaaa', SP2 = 'ZZZBANDSVCbbbbbbbbbbbb', SP3 = 'ZZZBANDSVCdddddddddddd'; // 22 chars each
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
async function clean() {
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZBANDSVC%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZBANDSVC%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZBANDSVC%'`);
}
test('pre-clean leftovers from a crashed run', clean);
after(async () => { await clean(); await pool.end(); });

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
  id = await svc.saveIdentity(pool, a, 'musicbrainz', 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');
  assert.equal(id.musicbrainz, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal((await pool.query(`SELECT musicbrainz_id FROM artists WHERE id=$1`, [a])).rows[0].musicbrainz_id, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  id = await svc.saveIdentity(pool, a, 'bandcamp', 'https://ZZZBANDSVC.bandcamp.com/album/x');
  assert.equal(id.bandcamp, 'https://zzzbandsvc.bandcamp.com');
  id = await svc.saveIdentity(pool, a, 'spotify', SP2);
  assert.equal(id.spotify, SP2);
  id = await svc.saveIdentity(pool, a, 'spotify', SP3);
  assert.equal((await pool.query(`SELECT spotify_url FROM artists WHERE id=$1`, [a])).rows[0].spotify_url.endsWith(SP3), true);
  id = await svc.saveIdentity(pool, a, 'spotify', SP2);
  assert.ok((await pool.query(`SELECT spotify_url FROM artists WHERE id=$1`, [a])).rows[0].spotify_url.endsWith(SP2)); // replaced, not stale
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
  assert.equal((await pool.query(`SELECT spotify_id FROM artists WHERE id=$1`, [other])).rows[0].spotify_id, 'ZZZBANDSVCcccccccccccc');
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

// ---- Task 7: checkBand / addSelected ----
const SPBAND = 'ZZZBANDSVCmmmmmmmmmmmm';
function spTrack(id, title) { return { title, id, url: 'https://open.spotify.com/track/' + id, mapped: {
  spotify_id: id, title, duration_ms: 1, popularity: 1, explicit: false, track_number: 1, disc_number: 1, spotify_url: 'https://open.spotify.com/track/' + id, added_at: null,
  artists: [{ spotify_id: SPBAND, name: 'ZZZBANDSVC Merged', spotify_url: null }], album: null } }; }
function fakeAdapters({ spotify, bandcamp, musicbrainz, counter = {} } = {}) {
  const mk = (name, cat) => cat === undefined ? undefined : { fetchCatalogue: async () => { counter[name] = (counter[name] || 0) + 1; if (cat instanceof Error) throw cat; return cat; } };
  return { spotify: mk('spotify', spotify), bandcamp: mk('bandcamp', bandcamp), musicbrainz: mk('musicbrainz', musicbrainz) };
}
const SPOT = { source: 'spotify', releases: [{ id: 'r1', name: 'Alb', album_type: 'album', release_date: '2020', url: null, tracks: [spTrack('ZZZBANDSVCt1', 'ZZZBANDSVC Held'), spTrack('ZZZBANDSVCt2', 'ZZZBANDSVC Fresh')] }] };
const BAND = { source: 'bandcamp', releases: [{ id: '/album/a', name: 'Alb', album_type: 'album', release_date: '2020-01-01', url: null, tracks: [
  { title: 'ZZZBANDSVC Fresh', id: null, url: 'https://zzzbandsvcm.bandcamp.com/track/fresh' },
  { title: 'ZZZBANDSVC Bandcamp Only', id: null, url: 'https://zzzbandsvcm.bandcamp.com/track/bco' }] }] };

async function mergedBand() {
  await clean(); // artists.spotify_id is unique: start from a fresh slate every call
  const a = await mkArtist('ZZZBANDSVC Merged', { spotify_id: SPBAND });
  await pool.query(`UPDATE artists SET bandcamp_url='https://zzzbandsvcm.bandcamp.com' WHERE id=$1`, [a]);
  const held = await mkSong(a, 'ZZZBANDSVC Held');
  return { a, held };
}

test('checkBand merges sources, marks held songs, counts, and one failing source does not sink the rest', async () => {
  svc._resetForTests();
  const { a, held } = await mergedBand();
  const res = await svc.checkBand(pool, a, { adapters: fakeAdapters({ spotify: SPOT, bandcamp: BAND, musicbrainz: undefined }) });
  assert.equal(res.sources.spotify.status, 'ok');
  const songs = res.releases.flatMap(r => r.songs);
  const byTitle = Object.fromEntries(songs.map(s => [s.title, s]));
  assert.equal(byTitle['ZZZBANDSVC Held'].state, 'in_catalogue');
  assert.equal(byTitle['ZZZBANDSVC Held'].match.song_id, held);
  assert.deepEqual(Object.keys(byTitle['ZZZBANDSVC Fresh'].sources).sort(), ['bandcamp', 'spotify']);
  assert.equal(byTitle['ZZZBANDSVC Bandcamp Only'].state, 'new');
  assert.equal(byTitle['ZZZBANDSVC Fresh'].sources.spotify.mapped, undefined); // internal data is not sent to the client
  assert.deepEqual(res.counts, { new: 2, in_catalogue: 1, rejected: 0, single_source: 1 });

  svc._resetForTests();
  const partial = await svc.checkBand(pool, a, { adapters: fakeAdapters({ spotify: SPOT, bandcamp: Object.assign(new Error('x'), { code: 'UNREADABLE' }) }), fresh: true });
  assert.deepEqual([partial.sources.bandcamp.status, partial.sources.bandcamp.code, partial.sources.spotify.status], ['error', 'UNREADABLE', 'ok']);
  assert.equal(partial.releases.flatMap(r => r.songs).length, 2);
});

test('checkBand: rejected songs are reported, NO_IDENTITY and NOT_FOUND are coded, results are cached 5 minutes and fresh bypasses', async () => {
  svc._resetForTests();
  await clean();
  const a = await mkArtist('ZZZBANDSVC Rejector', { spotify_id: 'ZZZBANDSVCrrrrrrrrrrrr' });
  await mkSong(a, 'ZZZBANDSVC Held', { status: 'rejected', published: false });
  const counter = {};
  let t = 1_000_000;
  const adapters = fakeAdapters({ spotify: SPOT, counter });
  const r1 = await svc.checkBand(pool, a, { adapters, now: () => t });
  assert.equal(r1.counts.rejected, 1);
  await svc.checkBand(pool, a, { adapters, now: () => t + 60_000 });
  assert.equal(counter.spotify, 1); // cached
  await svc.checkBand(pool, a, { adapters, now: () => t + 6 * 60_000 });
  assert.equal(counter.spotify, 2); // expired
  await svc.checkBand(pool, a, { adapters, now: () => t + 6 * 60_000 + 1, fresh: true });
  assert.equal(counter.spotify, 3);
  const bare = await mkArtist('ZZZBANDSVC Bare');
  await assert.rejects(svc.checkBand(pool, bare, { adapters }), (e) => e.code === 'NO_IDENTITY' && e.artist.name === 'ZZZBANDSVC Bare' && e.artist.id === bare);
  await assert.rejects(svc.checkBand(pool, 2147483646, { adapters }), (e) => e.code === 'NOT_FOUND');
});

test('addSelected: Spotify songs via intake, bandcamp-only via manual path, bandcamp url filled on Spotify songs, idempotent, junk keys ignored, cap and BUSY', async () => {
  svc._resetForTests();
  const { a } = await mergedBand();
  const adapters = fakeAdapters({ spotify: SPOT, bandcamp: BAND });
  const res = await svc.addSelected(pool, a, ['zzzbandsvc fresh', 'zzzbandsvc bandcamp only', 'zzzbandsvc held', 'not a real key'], { adapters });
  assert.deepEqual(res, { added: 2, skippedExisting: 1, notFound: 1 });
  const rows = (await pool.query(
    `SELECT title, status, data_source, spotify_id, bandcamp_url, status_notes FROM songs WHERE title IN ('ZZZBANDSVC Fresh','ZZZBANDSVC Bandcamp Only') ORDER BY title`)).rows;
  const fresh = rows.find(r => r.title === 'ZZZBANDSVC Fresh'), only = rows.find(r => r.title === 'ZZZBANDSVC Bandcamp Only');
  assert.deepEqual([fresh.status, fresh.spotify_id, fresh.bandcamp_url], ['pending', 'ZZZBANDSVCt2', 'https://zzzbandsvcm.bandcamp.com/track/fresh']);
  assert.deepEqual([only.status, only.data_source, only.spotify_id, only.bandcamp_url], ['pending', 'manual', null, 'https://zzzbandsvcm.bandcamp.com/track/bco']);
  assert.match(fresh.status_notes, /^added via band check \(ZZZBANDSVC Merged\)/);
  assert.match(only.status_notes, /^added via band check \(ZZZBANDSVC Merged\)/);
  // the Spotify-created song is linked to the band's existing artist row, not a duplicate
  assert.equal((await pool.query(`SELECT count(*)::int n FROM artists WHERE name='ZZZBANDSVC Merged'`)).rows[0].n, 1);

  const again = await svc.addSelected(pool, a, ['zzzbandsvc fresh', 'zzzbandsvc bandcamp only'], { adapters });
  assert.deepEqual(again, { added: 0, skippedExisting: 2, notFound: 0 }); // double-click is harmless

  for (const bad of [undefined, [], 'x', [1], Array.from({ length: 101 }, (_, i) => 'k' + i)]) {
    await assert.rejects(svc.addSelected(pool, a, bad, { adapters }), (e) => e.code === 'BAD_INPUT');
  }
});

test('addSelected: an overlapping add is BUSY', async () => {
  svc._resetForTests();
  const { a } = await mergedBand();
  let release;
  const gate = new Promise(r => { release = r; });
  const slow = { spotify: { fetchCatalogue: async () => { await gate; return SPOT; } } };
  const first = svc.addSelected(pool, a, ['zzzbandsvc fresh'], { adapters: slow });
  try {
    await assert.rejects(svc.addSelected(pool, a, ['zzzbandsvc fresh'], { adapters: slow }), (e) => e.code === 'BUSY');
  } finally { release(); }
  const r = await first;
  assert.equal(typeof r.added, 'number');
});

test('addSelected: a failing source aborts before any write, with its code, and releases the lock', async () => {
  svc._resetForTests();
  const { a } = await mergedBand();
  const bad = fakeAdapters({ spotify: Object.assign(new Error('x'), { code: 'RATE_LIMITED' }), bandcamp: BAND });
  await assert.rejects(svc.addSelected(pool, a, ['zzzbandsvc fresh', 'zzzbandsvc bandcamp only'], { adapters: bad }), (e) => e.code === 'RATE_LIMITED');
  const n = (await pool.query(`SELECT count(*)::int n FROM songs WHERE title IN ('ZZZBANDSVC Fresh','ZZZBANDSVC Bandcamp Only')`)).rows[0].n;
  assert.equal(n, 0);
  const ok = await svc.addSelected(pool, a, ['zzzbandsvc fresh'], { adapters: fakeAdapters({ spotify: SPOT, bandcamp: BAND }) });
  assert.equal(ok.added, 1);
});
