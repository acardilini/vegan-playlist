const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const pool = require('../database/db');
const router = require('../routes/submissions');

// Unique fixture sentinel for this file: ZZZSUB. The route is mounted on an
// ephemeral-port express app so no running server is needed.
let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/submissions', router);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/submissions`;
});
after(async () => {
  await new Promise(r => server.close(r));
  await pool.query(`DELETE FROM song_submissions WHERE song_title LIKE 'ZZZSUB%'`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZSUB%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZSUB%'`);
  await pool.end();
});

async function mkSong(title, status, published, artist) {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source) VALUES ($1,$2,$3,'manual') RETURNING id`,
    [title, status, published])).rows[0];
  const a = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [artist])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  return s.id;
}
const post = (body) => fetch(`${base}/submit`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('a live catalogue match is reported as already_exists', async () => {
  const songId = await mkSong('ZZZSUB Live Song', 'included', true, 'ZZZSUB LiveArtist');
  const res = await post({ song_title: 'ZZZSUB Live Song', artist_name: 'ZZZSUB LiveArtist' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.submission.already_exists, true);
  const row = (await pool.query('SELECT existing_song_id FROM song_submissions WHERE id=$1', [body.submission.id])).rows[0];
  assert.equal(row.existing_song_id, songId);
});

test('a match that is NOT live is stored as a match but not reported to the submitter', async () => {
  const songId = await mkSong('ZZZSUB Pending Song', 'pending', false, 'ZZZSUB PendArtist');
  const res = await post({ song_title: 'ZZZSUB Pending Song', artist_name: 'ZZZSUB PendArtist' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.submission.already_exists, false);
  const row = (await pool.query('SELECT existing_song_id FROM song_submissions WHERE id=$1', [body.submission.id])).rows[0];
  assert.equal(row.existing_song_id, songId);
});

test('a live match wins over a not-live match for the same title and artist', async () => {
  await mkSong('ZZZSUB Twin', 'rejected', false, 'ZZZSUB TwinArtist');
  const liveId = await mkSong('ZZZSUB Twin', 'included', true, 'ZZZSUB TwinArtist');
  const res = await post({ song_title: 'ZZZSUB Twin', artist_name: 'ZZZSUB TwinArtist' });
  const body = await res.json();
  assert.equal(body.submission.already_exists, true);
  const row = (await pool.query('SELECT existing_song_id FROM song_submissions WHERE id=$1', [body.submission.id])).rows[0];
  assert.equal(row.existing_song_id, liveId);
});

test('a malformed email returns 400 with a readable message, and stores nothing', async () => {
  const res = await post({ song_title: 'ZZZSUB BadEmail', artist_name: 'ZZZSUB X', submitter_email: 'not-an-email' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /email/i);
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM song_submissions WHERE song_title='ZZZSUB BadEmail'`)).rows[0].n;
  assert.equal(n, 0);
});

test('an out-of-range release year returns 400 with a readable message', async () => {
  const res = await post({ song_title: 'ZZZSUB BadYear', artist_name: 'ZZZSUB X', release_year: 1850 });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /year/i);
});

test('missing title or artist still returns 400', async () => {
  const res = await post({ song_title: '', artist_name: 'ZZZSUB X' });
  assert.equal(res.status, 400);
});

test('the unauthenticated /admin routes are gone', async () => {
  assert.equal((await fetch(`${base}/admin`)).status, 404);
  assert.equal((await fetch(`${base}/admin/1`, { method: 'DELETE' })).status, 404);
});
