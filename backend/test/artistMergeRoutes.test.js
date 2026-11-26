const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

// Test-only admin password, set before the router is required (never the real one).
const PW = 'ZZZAMR-test-pw';
process.env.ADMIN_PASSWORD = PW;
const pool = require('../database/db');
const adminRouter = require('../routes/admin');
const spotifyRouter = require('../routes/spotify');

// Fixture sentinel for this file: ZZZAMR (artist names and song titles).
let server, base, publicBase;
const H = { 'X-Admin-Password': PW, 'Content-Type': 'application/json' };
const call = (method, p, body, headers = H) => fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

async function mk(name) {
  return (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [`ZZZAMR ${name}`])).rows[0].id;
}
async function song(artistIds) {
  const id = (await pool.query(`INSERT INTO songs (title, status, published, data_source) VALUES ($1,'included',true,'manual') RETURNING id`,
    [`ZZZAMR song ${Math.random().toString(36).slice(2)}`])).rows[0].id;
  for (const a of artistIds) await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, a]);
  return id;
}
async function clean() {
  await pool.query(`DELETE FROM artist_merges WHERE loser_snapshot->'artist'->>'name' LIKE 'ZZZAMR %'`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZAMR song %'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZAMR %'`);
}

before(async () => {
  await clean();
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  app.use('/api/spotify', spotifyRouter);
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  const root = `http://127.0.0.1:${server.address().port}/api`;
  base = `${root}/admin`;
  publicBase = `${root}/spotify`;
});
after(async () => { await clean(); await new Promise((r) => server.close(r)); await pool.end(); });

test('both merge routes require the admin header', async () => {
  const k = await mk('Auth K'), l = await mk('Auth L');
  const none = { 'Content-Type': 'application/json' };
  assert.equal((await call('GET', `/artists/${l}/merge-preview?keeper=${k}`, undefined, none)).status, 401);
  assert.equal((await call('POST', `/artists/${l}/merge`, { keeper: k, hash: 'x' }, none)).status, 401);
  assert.equal((await call('POST', `/artists/${l}/merge`, { keeper: k, hash: 'x' }, { 'X-Admin-Password': 'nope', 'Content-Type': 'application/json' })).status, 401);
});

test('preview returns the shape for a real pair', async () => {
  const k = await mk('Prev K'), l = await mk('Prev L');
  await song([l]);
  const r = await call('GET', `/artists/${l}/merge-preview?keeper=${k}`);
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.deepEqual([p.keeper.id, p.loser.id, p.songs.moving, p.songs.shared], [k, l, 1, 0]);
  assert.match(p.hash, /^[0-9a-f]{40}$/);
  for (const key of ['members', 'leads', 'fills', 'conflicts', 'identity']) assert.ok(key in p, key);
});

test('a missing or bad keeper, the same artist and an unknown artist are 400 / 404', async () => {
  const k = await mk('Bad K'), l = await mk('Bad L');
  assert.equal((await call('GET', `/artists/${l}/merge-preview`)).status, 400);
  assert.equal((await call('GET', `/artists/${l}/merge-preview?keeper=abc`)).status, 400);
  assert.equal((await call('GET', `/artists/${l}/merge-preview?keeper=-3`)).status, 400);
  assert.equal((await call('GET', `/artists/${l}/merge-preview?keeper=${l}`)).status, 400);
  assert.equal((await call('GET', `/artists/${l}/merge-preview?keeper=999999999`)).status, 404);
  assert.equal((await call('GET', `/artists/999999999/merge-preview?keeper=${k}`)).status, 404);
  assert.equal((await call('POST', `/artists/${l}/merge`, { hash: 'x' })).status, 400);
  assert.equal((await call('POST', `/artists/${l}/merge`, { keeper: String(k), hash: 'x' })).status, 400);
  assert.equal((await call('POST', `/artists/${l}/merge`, { keeper: k })).status, 400);
  assert.equal((await call('POST', `/artists/${l}/merge`, { keeper: k, hash: 5 })).status, 400);
});

test('merge with the preview hash works; the loser then 404s in admin and on the public page', async () => {
  const k = await mk('Go K'), l = await mk('Go L');
  const s = await song([l]);
  const { hash } = await (await call('GET', `/artists/${l}/merge-preview?keeper=${k}`)).json();
  const r = await call('POST', `/artists/${l}/merge`, { keeper: k, hash });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual([body.merged, body.keeper.id, body.moved.songs], [true, k, 1]);
  assert.equal((await call('GET', `/artists/${l}`)).status, 404);
  assert.equal((await fetch(`${publicBase}/artists/${l}`)).status, 404);
  assert.equal((await fetch(`${publicBase}/artists/${k}`)).status, 200);
  assert.equal((await pool.query(`SELECT artist_id FROM song_artists WHERE song_id = $1`, [s])).rows[0].artist_id, k);
  assert.equal((await call('POST', `/artists/${l}/merge`, { keeper: k, hash })).status, 404);
});

test('a stale hash is 409', async () => {
  const k = await mk('Stale K'), l = await mk('Stale L');
  const { hash } = await (await call('GET', `/artists/${l}/merge-preview?keeper=${k}`)).json();
  await song([l]);
  assert.equal((await call('POST', `/artists/${l}/merge`, { keeper: k, hash })).status, 409);
  assert.equal((await call('GET', `/artists/${l}`)).status, 200);
});

// ---- privacy: the snapshot table is written by one service, reached only through admin.js ----

function sourceFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const ROOT = path.join(__dirname, '..');

test('only services/artistMerge.js names artist_merges; only admin.js requires the service', () => {
  const service = path.join(ROOT, 'services', 'artistMerge.js');
  const admin = path.join(ROOT, 'routes', 'admin.js');
  for (const dir of ['routes', 'services', 'utils']) {
    for (const f of sourceFiles(path.join(ROOT, dir))) {
      const src = fs.readFileSync(f, 'utf8');
      const rel = path.relative(ROOT, f);
      if (f !== service) assert.ok(!/artist_merges/.test(src), `${rel} must not name artist_merges`);
      if (f !== service && f !== admin) assert.ok(!/artistMerge/.test(src), `${rel} must not require the merge service`);
    }
  }
  assert.match(fs.readFileSync(admin, 'utf8'), /require\('\.\.\/services\/artistMerge'\)/);
});
