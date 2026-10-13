const { test, after, before } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const push = require('../services/spotifyPush');

// Unique fixture sentinel for this file: ZZZPUSH. No network: fetchTracks/fetchImpl/sleep are injected.
let live, live2, unpub, rejected, nospot, onPlaylistRejected;

async function mk(title, { sid, status = 'included', published = true }) {
  const s = (await pool.query(
    `INSERT INTO songs (title, spotify_id, status, published, data_source) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [title, sid, status, published, sid ? 'spotify' : 'manual'])).rows[0];
  const a = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [`ZZZPUSH Artist ${title}`])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  return s.id;
}
before(async () => {
  live = await mk('ZZZPUSH live', { sid: 'ZZZPUSH_live' });
  live2 = await mk('ZZZPUSH live2', { sid: 'ZZZPUSH_live2' });
  unpub = await mk('ZZZPUSH unpub', { sid: 'ZZZPUSH_unpub', published: false });
  rejected = await mk('ZZZPUSH rejected', { sid: 'ZZZPUSH_rej', status: 'rejected', published: false });
  nospot = await mk('ZZZPUSH nospot', { sid: null });
  onPlaylistRejected = await mk('ZZZPUSH onpl', { sid: 'ZZZPUSH_onpl', status: 'rejected', published: false });
});
after(async () => {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZPUSH%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZPUSH%'`);
  await pool.end();
});

const track = (id, title = id) => ({ spotify_id: id, title, artists: [{ name: 'Someone' }] });
const fetchTracksOf = (...tracks) => async () => tracks;
// Records POSTs; script = array of status codes (default 201).
function fakeFetch(script = [], retryAfter = '0') {
  const calls = [];
  const fn = async (url, init) => {
    const status = script.length ? script.shift() : 201;
    calls.push({ url: String(url), init, uris: JSON.parse(init.body).uris, status });
    return { ok: status >= 200 && status < 300, status, headers: { get: () => retryAfter }, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}
const noSleep = async () => {};
const ours = (list) => list.filter((x) => String(x.title || '').startsWith('ZZZPUSH'));

test('parseSongIds: undefined passes through; dedupes; rejects bad shapes', () => {
  assert.equal(push.parseSongIds(undefined), undefined);
  assert.deepEqual(push.parseSongIds([3, 3, 4]), [3, 4]);
  for (const bad of [[], 'x', null, {}, [1, '2'], [0], [-1], [1.5], [NaN], [Number.MAX_SAFE_INTEGER + 2], [null]]) {
    assert.throws(() => push.parseSongIds(bad), { code: 'BAD_INPUT' }, JSON.stringify(bad));
  }
});

test('chunk splits 250 into 100/100/50', () => {
  const sizes = push.chunk([...Array(250).keys()], 100).map((c) => c.length);
  assert.deepEqual(sizes, [100, 100, 50]);
});

test('compare buckets: pullable / pushable / noSpotifyId / onPlaylistNotLive', async () => {
  const r = await push.compare(pool, {
    fetchTracks: fetchTracksOf(track('ZZZPUSH_live2'), track('ZZZPUSH_onpl'), track('ZZZPUSH_brandnew', 'ZZZPUSH brandnew')),
  });
  assert.equal(r.playlistTrackCount, 3);
  assert.deepEqual(ours(r.pullable).map((x) => x.title), ['ZZZPUSH brandnew']);
  assert.deepEqual(ours(r.pushable).map((x) => x.id), [live], 'live2 is already on the playlist; unpublished/rejected are not pushable');
  assert.deepEqual(ours(r.noSpotifyId).map((x) => x.id), [nospot]);
  assert.deepEqual(ours(r.onPlaylistNotLive).map((x) => x.id), [onPlaylistRejected]);
});

test('pushSongs adds only what is missing, via POST /items with spotify:track URIs and a Bearer token', async () => {
  const f = fakeFetch();
  const r = await push.pushSongs(pool, {
    songIds: [live, live2], accessToken: 'TOK', fetchTracks: fetchTracksOf(track('ZZZPUSH_live2')), fetchImpl: f, sleep: noSleep,
  });
  assert.deepEqual(r.added.map((x) => x.id), [live]);
  assert.equal(r.alreadyThere, 1);
  assert.deepEqual(r.notEligible, []);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /\/v1\/playlists\/5hVygGomw9zax38quC6mhi\/items$/);
  assert.deepEqual(f.calls[0].uris, ['spotify:track:ZZZPUSH_live']);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer TOK');
});

test('IDEMPOTENT: pushing again after the playlist has the track adds nothing and makes no POST', async () => {
  const f = fakeFetch();
  const r = await push.pushSongs(pool, {
    songIds: [live], accessToken: 'TOK', fetchTracks: fetchTracksOf(track('ZZZPUSH_live')), fetchImpl: f, sleep: noSleep,
  });
  assert.deepEqual(r.added, []);
  assert.equal(r.alreadyThere, 1);
  assert.equal(f.calls.length, 0);
});

test('requested ids that are not eligible come back with a reason and are never pushed', async () => {
  const f = fakeFetch();
  const r = await push.pushSongs(pool, {
    songIds: [unpub, rejected, nospot, 999999999], accessToken: 'TOK', fetchTracks: fetchTracksOf(), fetchImpl: f, sleep: noSleep,
  });
  assert.deepEqual(r.notEligible, [
    { id: unpub, reason: 'not_live' }, { id: rejected, reason: 'not_live' },
    { id: nospot, reason: 'no_spotify_id' }, { id: 999999999, reason: 'not_found' },
  ]);
  assert.equal(f.calls.length, 0);
});

test('more than 100 URIs are chunked, and a failure part-way reports what was already added', async () => {
  // Drive chunking through the injectable adder with synthetic songs to avoid inserting 250 rows.
  const uris = [...Array(250).keys()].map((i) => `spotify:track:X${i}`);
  const f = fakeFetch([201, 201, 201]);
  await push._addUris(uris, { accessToken: 'T', playlistId: 'P', fetchImpl: f, sleep: noSleep });
  assert.deepEqual(f.calls.map((c) => c.uris.length), [100, 100, 50]);

  const g = fakeFetch([201, 500]);
  await assert.rejects(
    () => push._addUris(uris, { accessToken: 'T', playlistId: 'P', fetchImpl: g, sleep: noSleep }),
    (e) => { assert.equal(e.code, 'UPSTREAM'); assert.equal(e.addedCount, 100); return true; });
});

test('Spotify statuses map to typed errors: 401 REAUTH, 403 FORBIDDEN (readable), 429 retried then succeeds', async () => {
  const one = ['spotify:track:A'];
  await assert.rejects(() => push._addUris(one, { accessToken: 'T', playlistId: 'P', fetchImpl: fakeFetch([401]), sleep: noSleep }), { code: 'REAUTH' });
  await assert.rejects(() => push._addUris(one, { accessToken: 'T', playlistId: 'P', fetchImpl: fakeFetch([403]), sleep: noSleep }),
    (e) => { assert.equal(e.code, 'FORBIDDEN'); assert.match(e.message, /can.t edit this playlist/i); return true; });
  const f = fakeFetch([429, 201]);
  await push._addUris(one, { accessToken: 'T', playlistId: 'P', fetchImpl: f, sleep: noSleep });
  assert.equal(f.calls.length, 2);
});

test('pushSongs attaches progress (.added) to a mid-way failure', async () => {
  const f = fakeFetch([403]);
  await assert.rejects(
    () => push.pushSongs(pool, { songIds: [live], accessToken: 'T', fetchTracks: fetchTracksOf(), fetchImpl: f, sleep: noSleep }),
    (e) => { assert.equal(e.code, 'FORBIDDEN'); assert.deepEqual(e.added, []); return true; });
});

test('push never writes to the songs table', async () => {
  const before = (await pool.query(`SELECT count(*)::int n, max(updated_at) m FROM songs`)).rows[0];
  await push.pushSongs(pool, { songIds: [live], accessToken: 'T', fetchTracks: fetchTracksOf(), fetchImpl: fakeFetch(), sleep: noSleep });
  const after = (await pool.query(`SELECT count(*)::int n, max(updated_at) m FROM songs`)).rows[0];
  assert.deepEqual(after, before);
});

test('429 with a huge Retry-After fails fast (UPSTREAM), never sleeps, reports addedCount', async () => {
  const uris = [...Array(150).keys()].map((i) => `spotify:track:R${i}`);
  let slept = 0;
  const f = fakeFetch([201, 429], '3600');
  await assert.rejects(
    () => push._addUris(uris, { accessToken: 'T', playlistId: 'P', fetchImpl: f, sleep: async () => { slept++; } }),
    (e) => { assert.equal(e.code, 'UPSTREAM'); assert.match(e.message, /rate-limiting/); assert.equal(e.addedCount, 100); return true; });
  assert.equal(slept, 0);
});

test('concurrent pushSongs: second call is BUSY, guard releases after success and after failure', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const first = push.pushSongs(pool, {
    songIds: [live], accessToken: 'T', fetchTracks: async () => { await gate; return []; }, fetchImpl: fakeFetch(), sleep: noSleep,
  });
  await assert.rejects(
    () => push.pushSongs(pool, { songIds: [live], accessToken: 'T', fetchTracks: fetchTracksOf(), fetchImpl: fakeFetch(), sleep: noSleep }),
    { code: 'BUSY' });
  release();
  await first;
  // released after success
  await push.pushSongs(pool, { songIds: [live], accessToken: 'T', fetchTracks: fetchTracksOf(track('ZZZPUSH_live')), fetchImpl: fakeFetch(), sleep: noSleep });
  // released after a failing push (upstream error) and after early BAD_INPUT
  await assert.rejects(() => push.pushSongs(pool, { songIds: [live], accessToken: 'T', fetchTracks: fetchTracksOf(), fetchImpl: fakeFetch([403]), sleep: noSleep }), { code: 'FORBIDDEN' });
  await assert.rejects(() => push.pushSongs(pool, { songIds: [], accessToken: 'T', fetchTracks: fetchTracksOf() }), { code: 'BAD_INPUT' });
  await push.pushSongs(pool, { songIds: [live], accessToken: 'T', fetchTracks: fetchTracksOf(track('ZZZPUSH_live')), fetchImpl: fakeFetch(), sleep: noSleep });
});
