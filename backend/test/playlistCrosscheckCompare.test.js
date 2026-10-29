const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const staging = require('../services/staging');
const xc = require('../services/playlistCrosscheck');

// Fixture sentinel for this file: ZZZXCHKC.
const track = (id, title, artist = 'ZZZXCHKC Band', album = null) => ({
  spotify_id: id, title, duration_ms: 1, popularity: 1, explicit: false, track_number: 1, disc_number: 1, spotify_url: null, added_at: null,
  artists: [{ spotify_id: 'ZZZXCHKC_art_' + artist, name: artist, spotify_url: null }],
  album: album && { spotify_id: 'ZZZXCHKC_alb_' + album, name: album, images: [], release_date: null, total_tracks: 1, album_type: 'album', spotify_url: null },
});
const song = (o) => ({ id: 1, title: 'x', spotify_id: null, status: 'included', published: true, artists: 'A', first_artist: 'A', ...o });

beforeEach(() => xc._resetForTests());
after(async () => {
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZXCHKC%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZXCHKC%'`);
  await pool.query(`DELETE FROM albums WHERE name LIKE 'ZZZXCHKC%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZXCHKC%'`);
  await pool.end();
});

test('parsePlaylistId accepts a url with ?si=, an intl url, a spotify: uri and a bare id', () => {
  assert.equal(xc.parsePlaylistId('https://open.spotify.com/playlist/4RvN6XwfV6cQ0eZV7PF215?si=SK8GMSiDQk6ToA17PYM8pg'), '4RvN6XwfV6cQ0eZV7PF215');
  assert.equal(xc.parsePlaylistId('https://open.spotify.com/intl-de/playlist/4RvN6XwfV6cQ0eZV7PF215'), '4RvN6XwfV6cQ0eZV7PF215');
  assert.equal(xc.parsePlaylistId('spotify:playlist:4RvN6XwfV6cQ0eZV7PF215'), '4RvN6XwfV6cQ0eZV7PF215');
  assert.equal(xc.parsePlaylistId(' 4RvN6XwfV6cQ0eZV7PF215 '), '4RvN6XwfV6cQ0eZV7PF215');
});

test('parsePlaylistId rejects a track link, an empty string and nonsense with BAD_INPUT', () => {
  for (const bad of ['https://open.spotify.com/track/4RvN6XwfV6cQ0eZV7PF215', '', 'hello', undefined]) {
    assert.throws(() => xc.parsePlaylistId(bad), (e) => e.code === 'BAD_INPUT' && e.message === 'Not a Spotify playlist link');
  }
});

test('classifyTracks: id match is have, same title + first artist with another id is duplicate, otherwise new', () => {
  const songs = [
    song({ id: 1, title: 'ZZZXCHKC Alpha', spotify_id: 'a1', first_artist: 'Band One', artists: 'Band One' }),
    song({ id: 2, title: 'ZZZXCHKC Beta', spotify_id: 'b1', first_artist: 'Band Two', artists: 'Band Two' }),
  ];
  const tracks = [
    track('a1', 'ZZZXCHKC Alpha', 'Band One'),
    track('b2', 'ZZZXCHKC Beta (Remastered)', 'Band Two'),
    track('c1', 'ZZZXCHKC Gamma', 'Band Three'),
  ];
  const out = xc.classifyTracks(songs, tracks);
  assert.deepEqual(out.map((o) => o.state), ['have', 'duplicate', 'new']);
  assert.equal(out[0].match.id, 1);
  assert.equal(out[1].match.id, 2);
  assert.equal(out[2].match, null);
});

test('classifyTracks: a rejected twin found by id is have with status rejected and live false', () => {
  const out = xc.classifyTracks([song({ id: 9, title: 'ZZZXCHKC Gone', spotify_id: 'r1', status: 'rejected', published: false })], [track('r1', 'ZZZXCHKC Gone')]);
  assert.equal(out[0].state, 'have');
  assert.equal(out[0].match.status, 'rejected');
  assert.equal(out[0].match.live, false);
});

test('classifyTracks: a title that normalises to nothing never matches as a duplicate', () => {
  const songs = [song({ id: 3, title: '!!!', spotify_id: 'e1', first_artist: 'A', artists: 'A' })];
  const out = xc.classifyTracks(songs, [track('e2', '日本語', 'A')]);
  assert.equal(out[0].state, 'new');
});

test('classifyTracks: prefers a live catalogue twin when several match', () => {
  const songs = [
    song({ id: 4, title: 'ZZZXCHKC Twin', spotify_id: 't1', status: 'rejected', published: false, first_artist: 'A', artists: 'A' }),
    song({ id: 5, title: 'ZZZXCHKC Twin', spotify_id: 't2', first_artist: 'A', artists: 'A' }),
  ];
  const out = xc.classifyTracks(songs, [track('t3', 'ZZZXCHKC Twin', 'A')]);
  assert.equal(out[0].match.id, 5);
});

test('classifyTracks: the same spotify id twice on the playlist yields one entry', () => {
  const out = xc.classifyTracks([], [track('d1', 'ZZZXCHKC Dup'), track('d1', 'ZZZXCHKC Dup')]);
  assert.equal(out.length, 1);
});

test('compare reports counts, ignored, album name and a track url, and caches for 60s unless fresh', async () => {
  await staging.insertCandidates(pool, [track('ZZZXCHKC_h1', 'ZZZXCHKC Held')]);
  let calls = 0;
  const fetchPlaylist = async () => {
    calls++;
    return { name: 'ZZZXCHKC list', ignored: 2, tracks: [track('ZZZXCHKC_h1', 'ZZZXCHKC Held'), track('ZZZXCHKC_n1', 'ZZZXCHKC Fresh', 'ZZZXCHKC Band', 'ZZZXCHKC Album')] };
  };
  const input = 'spotify:playlist:4RvN6XwfV6cQ0eZV7PF215';
  const r = await xc.compare(pool, { input, fetchPlaylist });
  assert.deepEqual(r.counts, { new: 1, duplicate: 0, have: 1 });
  assert.equal(r.ignored, 2);
  assert.equal(r.playlist.name, 'ZZZXCHKC list');
  assert.equal(r.playlist.id, '4RvN6XwfV6cQ0eZV7PF215');
  const fresh = r.tracks.find((t) => t.spotify_id === 'ZZZXCHKC_n1');
  assert.equal(fresh.album, 'ZZZXCHKC Album');
  assert.equal(fresh.url, 'https://open.spotify.com/track/ZZZXCHKC_n1');
  assert.equal(fresh.artists, 'ZZZXCHKC Band');
  await xc.compare(pool, { input, fetchPlaylist });
  assert.equal(calls, 1);
  await xc.compare(pool, { input, fetchPlaylist, fresh: true });
  assert.equal(calls, 2);
});

test('compare on an empty playlist returns zero counts and no tracks', async () => {
  const r = await xc.compare(pool, { input: 'spotify:playlist:4RvN6XwfV6cQ0eZV7PF215', fetchPlaylist: async () => ({ name: 'ZZZXCHKC empty', ignored: 0, tracks: [] }) });
  assert.deepEqual(r.counts, { new: 0, duplicate: 0, have: 0 });
  assert.deepEqual(r.tracks, []);
});
