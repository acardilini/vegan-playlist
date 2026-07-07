const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const staging = require('../services/staging');

// --- disposable fixture helpers (sentinel prefix ZZZTEST) ---
async function mkAlbum(images = '[{"url":"http://example.com/a.jpg","height":640,"width":640}]') {
  return (await pool.query(
    `INSERT INTO albums (name, images, data_source) VALUES ('ZZZTEST Album', $1, 'manual') RETURNING id`, [images]
  )).rows[0].id;
}
async function mkSong({ title, status = 'pending', published = false, spotify_url = null,
  bandcamp_url = null, soundcloud_url = null, album_id = null, artist = 'ZZZTEST Artist' }) {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, spotify_url, bandcamp_url, soundcloud_url, album_id, data_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'manual') RETURNING id`,
    [title, status, published, spotify_url, bandcamp_url, soundcloud_url, album_id])).rows[0];
  const a = (await pool.query(
    `INSERT INTO artists (name, data_source) VALUES ($1, 'manual') RETURNING id`, [artist])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  return s.id;
}

after(async () => {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZTEST%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZTEST%'`);
  await pool.query(`DELETE FROM albums WHERE name = 'ZZZTEST Album'`);
  await pool.end();
});

test('listQueue pending returns pending rows with presence flags', async () => {
  const albumId = await mkAlbum();
  const id = await mkSong({ title: 'ZZZTEST Pending Complete', status: 'pending', spotify_url: 'http://x', album_id: albumId });
  const { queue, rows } = await staging.listQueue(pool, { queue: 'pending' });
  assert.equal(queue, 'pending');
  const row = rows.find(r => r.id === id);
  assert.ok(row, 'inserted pending song present');
  assert.equal(row.has_art, true);
  assert.equal(row.has_play_link, true);
  assert.ok(row.play_link_kinds.includes('spotify'));
});

test('listQueue to-finalise annotates missing[]', async () => {
  const noArtNoLink = await mkSong({ title: 'ZZZTEST Finalise Bare', status: 'included', published: false });
  const { rows } = await staging.listQueue(pool, { queue: 'to-finalise' });
  const row = rows.find(r => r.id === noArtNoLink);
  assert.ok(row);
  assert.deepEqual(row.missing.sort(), ['artwork', 'play link']);
});

test('listQueue unknown queue throws BAD_QUEUE', async () => {
  await assert.rejects(() => staging.listQueue(pool, { queue: 'nope' }), (e) => e.code === 'BAD_QUEUE');
});

test('listQueue live without q throws Q_REQUIRED', async () => {
  await assert.rejects(() => staging.listQueue(pool, { queue: 'live' }), (e) => e.code === 'Q_REQUIRED');
});

test('listQueue live with q finds published match, excludes pending', async () => {
  const liveId = await mkSong({ title: 'ZZZTEST LiveSong Zeta', status: 'included', published: true });
  const pendId = await mkSong({ title: 'ZZZTEST LiveSong Zeta Pending', status: 'pending' });
  const { rows } = await staging.listQueue(pool, { queue: 'live', q: 'ZZZTEST LiveSong Zeta' });
  const ids = rows.map(r => r.id);
  assert.ok(ids.includes(liveId), 'published match present');
  assert.ok(!ids.includes(pendId), 'pending excluded from live');
});

test('includeSong moves pending -> included, stays unpublished', async () => {
  const id = await mkSong({ title: 'ZZZTEST Include A', status: 'pending' });
  const r = await staging.includeSong(pool, id, {});
  assert.equal(r.status, 'included');
  assert.equal(r.published, false);
});

test('includeSong {publish:true} includes and publishes', async () => {
  const id = await mkSong({ title: 'ZZZTEST Include B', status: 'pending' });
  const r = await staging.includeSong(pool, id, { publish: true });
  assert.equal(r.status, 'included');
  assert.equal(r.published, true);
});

test('rejectSong on a published row also unpublishes', async () => {
  const id = await mkSong({ title: 'ZZZTEST Reject A', status: 'included', published: true });
  const r = await staging.rejectSong(pool, id);
  assert.equal(r.status, 'rejected');
  assert.equal(r.published, false);
});

test('includeSong on missing id throws NOT_FOUND', async () => {
  await assert.rejects(() => staging.includeSong(pool, 999999999, {}), (e) => e.code === 'NOT_FOUND');
});

test('setPlayLink sets bandcamp_url', async () => {
  const id = await mkSong({ title: 'ZZZTEST Link A', status: 'pending' });
  const r = await staging.setPlayLink(pool, id, { bandcamp_url: 'https://x.bandcamp.com/track/y' });
  assert.equal(r.bandcamp_url, 'https://x.bandcamp.com/track/y');
});

test('setPlayLink with no url throws BAD_INPUT', async () => {
  const id = await mkSong({ title: 'ZZZTEST Link B', status: 'pending' });
  await assert.rejects(() => staging.setPlayLink(pool, id, {}), (e) => e.code === 'BAD_INPUT');
});

test('setPlayLink with non-http url throws BAD_INPUT', async () => {
  const id = await mkSong({ title: 'ZZZTEST Link C', status: 'pending' });
  await assert.rejects(() => staging.setPlayLink(pool, id, { soundcloud_url: 'not-a-url' }), (e) => e.code === 'BAD_INPUT');
});

test('insertCandidates adds new, skips existing spotify_id and title+artist dupes', async () => {
  // existing catalogue row with a known spotify_id + artist
  const dupSpotifyId = 'ZZZTESTSPOTIFYID000001';
  await pool.query(
    `INSERT INTO songs (title, status, spotify_id, data_source) VALUES ('ZZZTEST Existing By Id', 'included', $1, 'manual')`,
    [dupSpotifyId]);
  const existTitleId = await mkSong({ title: 'ZZZTEST Existing By Title', status: 'included', artist: 'ZZZTEST DupArtist' });

  const mkTrack = (sid, title, artist) => ({
    spotify_id: sid, title, duration_ms: 1000, popularity: 0, explicit: false,
    track_number: 1, disc_number: 1, spotify_url: 'http://x', added_at: null,
    artists: [{ spotify_id: sid + 'A', name: artist, spotify_url: 'http://a' }], album: null,
  });

  const tracks = [
    mkTrack(dupSpotifyId, 'ZZZTEST Existing By Id', 'ZZZTEST WhoeverArtist'),      // skip: spotify_id
    mkTrack('ZZZTESTSPOTIFYID000002', 'ZZZTEST Existing By Title', 'ZZZTEST DupArtist'), // skip: title+artist
    mkTrack('ZZZTESTSPOTIFYID000003', 'ZZZTEST Brand New Candidate', 'ZZZTEST NewArtist'), // add
  ];
  const res = await staging.insertCandidates(pool, tracks);
  assert.equal(res.added, 1);
  assert.equal(res.skippedExisting, 2);

  const check = await pool.query(`SELECT status FROM songs WHERE spotify_id = 'ZZZTESTSPOTIFYID000003'`);
  assert.equal(check.rows[0].status, 'pending');
});
