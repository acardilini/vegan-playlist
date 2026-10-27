const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const fill = require('../services/spotifyFill');

// Unique fixture sentinel per test file: ZZZSFL. Spotify is never called: every test injects fetchTrack.

const TRACK_ID = 'ZZZSFLtrack0000000000a'; // 22 chars
const URL = `https://open.spotify.com/track/${TRACK_ID}?si=abc`;

function track(over = {}) {
  return {
    spotify_id: TRACK_ID, title: 'ZZZSFL Right Title', duration_ms: 200000, popularity: 12, explicit: false,
    track_number: 3, disc_number: 1, spotify_url: `https://open.spotify.com/track/${TRACK_ID}`,
    artists: [{ spotify_id: 'ZZZSFLartist00000000001', name: 'ZZZSFL Right Artist', spotify_url: 'https://open.spotify.com/artist/x' }],
    album: { spotify_id: 'ZZZSFLalbum000000000001', name: 'ZZZSFL Right Album', images: [{ url: 'http://example.com/c.jpg' }],
      release_date: '2018-06', total_tracks: 9, album_type: 'album', spotify_url: 'https://open.spotify.com/album/y' },
    ...over,
  };
}
const fetchTrack = (t = track()) => async () => t;

async function mkSong({ title = 'ZZZSFL Wrong Title', spotify_url = URL, spotify_id = null, artist = 'ZZZSFL Wrong Artist' } = {}) {
  // songs.spotify_id is unique and several tests apply the same track id: free it from earlier fixtures
  // (a fixture that is deliberately given the id is created AFTER the song it conflicts with).
  if (spotify_id === null) await pool.query(`UPDATE songs SET spotify_id=NULL WHERE spotify_id=$1 AND title LIKE 'ZZZSFL%'`, [TRACK_ID]);
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, spotify_url, spotify_id, data_source)
     VALUES ($1,'included',true,$2,$3,'manual') RETURNING id`, [title, spotify_url, spotify_id])).rows[0];
  const a = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [artist])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  return { id: s.id, artistId: a.id };
}
const artistNames = async (id) => (await pool.query(
  `SELECT a.name FROM song_artists sa JOIN artists a ON a.id=sa.artist_id WHERE sa.song_id=$1 ORDER BY sa.id`, [id])).rows.map((r) => r.name);

after(async () => {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZSFL%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZSFL%' OR spotify_id LIKE 'ZZZSFL%'`);
  await pool.query(`DELETE FROM albums WHERE name LIKE 'ZZZSFL%' OR spotify_id LIKE 'ZZZSFL%'`);
  await pool.end();
});

test('preview lists current vs Spotify and flags what differs', async () => {
  const { id } = await mkSong();
  const p = await fill.preview(pool, id, { fetchTrack: fetchTrack() });
  const by = Object.fromEntries(p.fields.map((f) => [f.key, f]));
  assert.deepEqual(Object.keys(by).sort(), ['album', 'artists', 'spotify_id', 'title']);
  assert.equal(by.title.current, 'ZZZSFL Wrong Title');
  assert.equal(by.title.spotify, 'ZZZSFL Right Title');
  assert.ok(by.title.differs && by.artists.differs && by.album.differs && by.spotify_id.differs);
  assert.equal(by.artists.spotify, 'ZZZSFL Right Artist');
  assert.match(by.album.spotify, /ZZZSFL Right Album/);
  assert.match(by.album.spotify, /2018-06-01/);
  assert.equal(p.conflict, null);
});

test('preview writes nothing', async () => {
  const { id } = await mkSong();
  await fill.preview(pool, id, { fetchTrack: fetchTrack() });
  assert.deepEqual(await artistNames(id), ['ZZZSFL Wrong Artist']);
  const s = (await pool.query('SELECT spotify_id, title, album_id FROM songs WHERE id=$1', [id])).rows[0];
  assert.equal(s.spotify_id, null);
  assert.equal(s.title, 'ZZZSFL Wrong Title');
  assert.equal(s.album_id, null);
});

test('apply artists swaps the song to the Spotify artist and leaves the old artist row alone', async () => {
  const { id, artistId } = await mkSong();
  await fill.apply(pool, id, { fields: ['artists'] }, { fetchTrack: fetchTrack() });
  assert.deepEqual(await artistNames(id), ['ZZZSFL Right Artist']);
  assert.equal((await pool.query('SELECT 1 FROM artists WHERE id=$1', [artistId])).rowCount, 1, 'old artist not deleted');
  const s = (await pool.query('SELECT title, spotify_id FROM songs WHERE id=$1', [id])).rows[0];
  assert.equal(s.title, 'ZZZSFL Wrong Title', 'unticked fields untouched');
  assert.equal(s.spotify_id, null);
});

test('apply reuses an existing artist with the same Spotify id instead of duplicating', async () => {
  // an earlier test's apply created this artist: start from a clean slate
  await pool.query(`DELETE FROM song_artists WHERE artist_id IN (SELECT id FROM artists WHERE spotify_id='ZZZSFLartist00000000001')`);
  await pool.query(`DELETE FROM artists WHERE spotify_id='ZZZSFLartist00000000001'`);
  const keep = (await pool.query(
    `INSERT INTO artists (name, spotify_id, data_source) VALUES ('ZZZSFL Right Artist','ZZZSFLartist00000000001','spotify') RETURNING id`)).rows[0].id;
  const { id } = await mkSong();
  await fill.apply(pool, id, { fields: ['artists'] }, { fetchTrack: fetchTrack() });
  const linked = (await pool.query('SELECT artist_id FROM song_artists WHERE song_id=$1', [id])).rows.map((r) => r.artist_id);
  assert.deepEqual(linked, [keep]);
});

test('apply spotify_id also fills the track metadata and canonical url', async () => {
  const { id } = await mkSong();
  await fill.apply(pool, id, { fields: ['spotify_id'] }, { fetchTrack: fetchTrack() });
  const s = (await pool.query('SELECT spotify_id, spotify_url, duration_ms, track_number FROM songs WHERE id=$1', [id])).rows[0];
  assert.equal(s.spotify_id, TRACK_ID);
  assert.equal(s.spotify_url, `https://open.spotify.com/track/${TRACK_ID}`);
  assert.equal(s.duration_ms, 200000);
  assert.equal(s.track_number, 3);
});

test('apply title and album', async () => {
  const { id } = await mkSong();
  await fill.apply(pool, id, { fields: ['title', 'album'] }, { fetchTrack: fetchTrack() });
  const s = (await pool.query(
    `SELECT s.title, al.name, to_char(al.release_date,'YYYY-MM-DD') d, al.data_source FROM songs s JOIN albums al ON al.id=s.album_id WHERE s.id=$1`, [id])).rows[0];
  assert.equal(s.title, 'ZZZSFL Right Title');
  assert.equal(s.name, 'ZZZSFL Right Album');
  assert.equal(s.d, '2018-06-01');
  assert.equal(s.data_source, 'spotify');
});

test('apply never touches curated fields', async () => {
  const { id } = await mkSong();
  await pool.query(`UPDATE songs SET status_notes='keep me', featured=true WHERE id=$1`, [id]);
  await fill.apply(pool, id, { fields: ['title', 'artists', 'album', 'spotify_id'] }, { fetchTrack: fetchTrack() });
  const s = (await pool.query('SELECT status, published, status_notes, featured FROM songs WHERE id=$1', [id])).rows[0];
  assert.deepEqual(s, { status: 'included', published: true, status_notes: 'keep me', featured: true });
});

test('a track id owned by another song is reported as a conflict and refuses spotify_id only', async () => {
  const { id } = await mkSong();
  const other = await mkSong({ title: 'ZZZSFL Owner', spotify_id: TRACK_ID, spotify_url: null });
  const p = await fill.preview(pool, id, { fetchTrack: fetchTrack() });
  assert.equal(p.conflict.song_id, other.id);
  await assert.rejects(fill.apply(pool, id, { fields: ['spotify_id'] }, { fetchTrack: fetchTrack() }), (e) => e.code === 'BAD_INPUT');
  await fill.apply(pool, id, { fields: ['artists'] }, { fetchTrack: fetchTrack() });
  assert.deepEqual(await artistNames(id), ['ZZZSFL Right Artist']);
});

test('a failed apply rolls back every field', async () => {
  const { id } = await mkSong();
  const bad = track({ artists: [{ spotify_id: 'ZZZSFLartist00000000002', name: null, spotify_url: null }] }); // name is NOT NULL
  await assert.rejects(fill.apply(pool, id, { fields: ['title', 'artists'] }, { fetchTrack: fetchTrack(bad) }));
  const s = (await pool.query('SELECT title FROM songs WHERE id=$1', [id])).rows[0];
  assert.equal(s.title, 'ZZZSFL Wrong Title');
  assert.deepEqual(await artistNames(id), ['ZZZSFL Wrong Artist']);
});

test('input errors: no Spotify link, a non-track link, unknown fields, nothing selected, unknown song', async () => {
  const none = await mkSong({ spotify_url: null });
  await assert.rejects(fill.preview(pool, none.id, { fetchTrack: fetchTrack() }), (e) => e.code === 'BAD_INPUT');
  const playlist = await mkSong({ spotify_url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' });
  await assert.rejects(fill.preview(pool, playlist.id, { fetchTrack: fetchTrack() }), (e) => e.code === 'BAD_INPUT');
  const { id } = await mkSong();
  await assert.rejects(fill.apply(pool, id, { fields: ['status'] }, { fetchTrack: fetchTrack() }), (e) => e.code === 'BAD_INPUT');
  await assert.rejects(fill.apply(pool, id, { fields: [] }, { fetchTrack: fetchTrack() }), (e) => e.code === 'BAD_INPUT');
  await assert.rejects(fill.preview(pool, 999999999, { fetchTrack: fetchTrack() }), (e) => e.code === 'NOT_FOUND');
});

test('a Spotify failure surfaces as UPSTREAM with a fixed message (no raw error text)', async () => {
  const { id } = await mkSong();
  const boom = async () => { throw new Error('SECRET-TOKEN-LEAK'); };
  await assert.rejects(fill.preview(pool, id, { fetchTrack: boom }),
    (e) => e.code === 'UPSTREAM' && !/SECRET/.test(e.message));
});
