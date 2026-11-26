const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const spotifyPush = require('../services/spotifyPush');

// Unique fixture sentinel for this file: ZZZOPL. No network: fetchTracks is injected.
// isOnPlaylist: is this one song's Spotify track on the live playlist (the cached read the Dashboard card shares)?

const PLAYLIST = 'ZZZOPL_playlist';
const mkSong = async (title, spotifyId) => (await pool.query(
  `INSERT INTO songs (title, status, published, data_source, spotify_id) VALUES ($1,'included',true,'manual',$2) RETURNING id`,
  [title, spotifyId])).rows[0].id;
const track = (id) => ({ spotify_id: id, title: id, artists: [{ name: 'x' }] });

beforeEach(() => spotifyPush.clearCache());
after(async () => {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZOPL%'`);
  await pool.end();
});

test('a song whose Spotify track is on the playlist is on it; one that is not, is not', async () => {
  const on = await mkSong('ZZZOPL on', 'ZZZOPL_on');
  const off = await mkSong('ZZZOPL off', 'ZZZOPL_off');
  const fetchTracks = async () => [track('ZZZOPL_on'), track('ZZZOPL_other')];
  assert.deepEqual(await spotifyPush.isOnPlaylist(pool, on, { playlistId: PLAYLIST, fetchTracks }), { onPlaylist: true });
  assert.deepEqual(await spotifyPush.isOnPlaylist(pool, off, { playlistId: PLAYLIST, fetchTracks }), { onPlaylist: false });
});

test('a song with no Spotify id, or no such song, is not on it and never triggers a read', async () => {
  const none = await mkSong('ZZZOPL none', null);
  let reads = 0;
  const fetchTracks = async () => { reads++; return []; };
  assert.deepEqual(await spotifyPush.isOnPlaylist(pool, none, { playlistId: PLAYLIST, fetchTracks }), { onPlaylist: false });
  assert.deepEqual(await spotifyPush.isOnPlaylist(pool, 2147483000, { playlistId: PLAYLIST, fetchTracks }), { onPlaylist: false });
  assert.equal(reads, 0);
});

test('the playlist read is cached: a second check within the window does not read again', async () => {
  const a = await mkSong('ZZZOPL a', 'ZZZOPL_a');
  let reads = 0;
  const fetchTracks = async () => { reads++; return [track('ZZZOPL_a')]; };
  await spotifyPush.isOnPlaylist(pool, a, { playlistId: PLAYLIST, fetchTracks });
  await spotifyPush.isOnPlaylist(pool, a, { playlistId: PLAYLIST, fetchTracks });
  assert.equal(reads, 1);
});

test('a failing playlist read rejects (the caller decides what to show) without leaking its message', async () => {
  const a = await mkSong('ZZZOPL fail', 'ZZZOPL_fail');
  const fetchTracks = async () => { throw new Error('secret https://api.spotify.com/v1/playlists/x?token=abc'); };
  await assert.rejects(spotifyPush.isOnPlaylist(pool, a, { playlistId: PLAYLIST, fetchTracks }), (e) => {
    assert.ok(e.code, 'a coded error');
    assert.ok(!/secret|token|api\.spotify/.test(e.message), 'the fetch error text is not passed on');
    return true;
  });
});
