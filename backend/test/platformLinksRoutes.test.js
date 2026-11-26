const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');

process.env.ADMIN_PASSWORD = 'ZZZPLK-pw';
const pool = require('../database/db');
const curation = require('../services/curation');

// Fixture sentinel for this file: ZZZPLK (song titles, artist name, fake spotify ids). Songs are unpublished except
// inside the one public-read test, which publishes its song and removes it in a finally block.

let server, base, ARTIST, n = 0;
const H = { 'X-Admin-Password': 'ZZZPLK-pw', 'Content-Type': 'application/json' };

async function mkSong(title, { published = false } = {}) {
  const id = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source, spotify_id) VALUES ($1,'included',$2,'manual',$3) RETURNING id`,
    [title, published, `zzzplkr${Date.now().toString(36)}${n++}`])).rows[0].id;
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, ARTIST]);
  return id;
}
const link = (id, platform, status, url = `https://example.test/${platform}/${id}`) => pool.query(
  `INSERT INTO song_platform_links (song_id, platform, url, status, source) VALUES ($1,$2,$3,$4,'search')`, [id, platform, url, status]);
async function clean() {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZPLK%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZPLK%'`);
}

before(async () => {
  await clean();
  ARTIST = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ('ZZZPLK Route Band','manual') RETURNING id`)).rows[0].id;
  const app = express();
  app.use(express.json());
  app.use('/api/spotify', require('../routes/spotify'));
  app.use('/api/admin', require('../routes/admin'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.close(); await clean(); await pool.end(); });

const q = (o = {}) => curation.listCurationQueue(pool, { queue: 'check-links', q: 'ZZZPLK', ...o });

test('check-links lists songs with a proposed link only, and its count agrees with its list', async () => {
  const withProposed = await mkSong('ZZZPLK q proposed');
  const onlyConfirmed = await mkSong('ZZZPLK q confirmed');
  const onlyRejected = await mkSong('ZZZPLK q rejected');
  await link(withProposed, 'apple_music', 'proposed');
  await link(onlyConfirmed, 'deezer', 'confirmed');
  await link(onlyRejected, 'apple_music', 'rejected');
  const ids = (await q()).rows.map((r) => r.id);
  assert.ok(ids.includes(withProposed));
  assert.ok(!ids.includes(onlyConfirmed));
  assert.ok(!ids.includes(onlyRejected));
  const counts = await curation.queueCounts(pool);
  const all = await curation.listCurationQueue(pool, { queue: 'check-links' });
  assert.equal(counts['check-links'], all.rows.length);
});

test('the public song read carries confirmed links only, in order, and never proposed or rejected ones', async () => {
  const id = await mkSong('ZZZPLK public', { published: true });
  try {
    await link(id, 'deezer', 'confirmed');
    await link(id, 'apple_music', 'proposed');
    await link(id, 'tidal', 'rejected');
    const r = await fetch(`${base}/spotify/songs/${id}`);
    assert.equal(r.status, 200);
    const song = await r.json();
    assert.deepEqual(song.platform_links, [{ platform: 'deezer', url: `https://example.test/deezer/${id}` }]);
    await pool.query(`UPDATE song_platform_links SET status='confirmed' WHERE song_id=$1 AND platform='apple_music'`, [id]);
    assert.deepEqual((await (await fetch(`${base}/spotify/songs/${id}`)).json()).platform_links.map((x) => x.platform), ['apple_music', 'deezer']);
    assert.ok(!JSON.stringify(song).includes('tidal'));
    await pool.query(`UPDATE songs SET published=false WHERE id=$1`, [id]);
    assert.equal((await fetch(`${base}/spotify/songs/${id}`)).status, 404, 'an unpublished song serves nothing');
  } finally { await pool.query('DELETE FROM songs WHERE id=$1', [id]); }
});

test('a song with no links has an empty platform_links array', async () => {
  const id = await mkSong('ZZZPLK public empty', { published: true });
  try {
    assert.deepEqual((await (await fetch(`${base}/spotify/songs/${id}`)).json()).platform_links, []);
  } finally { await pool.query('DELETE FROM songs WHERE id=$1', [id]); }
});

test('the admin routes need the admin header', async () => {
  assert.equal((await fetch(`${base}/admin/platform-links/counts`)).status, 401);
  assert.equal((await fetch(`${base}/admin/platform-links/run`, { method: 'POST' })).status, 401);
});

test('review route: confirm, then a second review is 400, an unknown link is 404, a bad action or platform is 400', async () => {
  const id = await mkSong('ZZZPLK review');
  await link(id, 'apple_music', 'proposed');
  const put = (platform, body) => fetch(`${base}/admin/platform-links/song/${id}/${platform}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
  const ok = await put('apple_music', { action: 'confirm' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).link.status, 'confirmed');
  assert.equal((await put('apple_music', { action: 'reject' })).status, 400);
  assert.equal((await put('deezer', { action: 'confirm' })).status, 404);
  assert.equal((await put('apple_music', { action: 'maybe' })).status, 400);
  assert.equal((await put('spotify', { action: 'confirm' })).status, 400);
  const got = await (await fetch(`${base}/admin/platform-links/song/${id}`, { headers: H })).json();
  assert.deepEqual(got.links.map((x) => [x.platform, x.status]), [['apple_music', 'confirmed']]);
});

test('run route: unknown run is 404; counts answers', async () => {
  assert.equal((await fetch(`${base}/admin/platform-links/runs/nope`, { headers: H })).status, 404);
  const c = await (await fetch(`${base}/admin/platform-links/counts`, { headers: H })).json();
  assert.ok(Number.isInteger(c.proposed));
});
