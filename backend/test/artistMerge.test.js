const { test, after } = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const pool = require('../database/db');
const svc = require('../services/artistMerge');

// Fixture sentinel for this file: ZZZAMG2 (artistMergePreview.test.js uses 'ZZZAMG ' and its cleanup must not match this one).
let n = 0;
const sid = () => `ZZZAMG2${String(++n).padStart(3, '0')}${Date.now().toString(36)}`.slice(0, 22).padEnd(22, 'x');
async function mk(name, cols = {}) {
  const { spotify, ...rest } = cols;
  const keys = ['name', 'spotify_id', 'data_source', ...Object.keys(rest)];
  const vals = [`ZZZAMG2 ${name}`, spotify || null, spotify ? 'spotify' : 'manual', ...Object.values(rest)];
  return (await pool.query(`INSERT INTO artists (${keys.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals)).rows[0].id;
}
async function song(artistIds, { live = true } = {}) {
  const id = (await pool.query(`INSERT INTO songs (title, status, published, data_source) VALUES ($1, $2, $3, 'manual') RETURNING id`,
    [`ZZZAMG2 song ${sid()}`, live ? 'included' : 'pending', live])).rows[0].id;
  for (const a of artistIds) await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1, $2)`, [id, a]);
  return id;
}
const artistsOf = async (songId) => (await pool.query(`SELECT artist_id FROM song_artists WHERE song_id = $1 ORDER BY id`, [songId])).rows.map((r) => r.artist_id);
const row = async (id) => (await pool.query(`SELECT * FROM artists WHERE id = $1`, [id])).rows[0];
const doMerge = async (k, l) => svc.merge(pool, k, l, (await svc.preview(pool, k, l)).hash);
async function clean() {
  await pool.query(`DELETE FROM artist_merges WHERE loser_snapshot->'artist'->>'name' LIKE 'ZZZAMG2 %'`);
  await pool.query(`DELETE FROM leads WHERE name LIKE 'ZZZAMG2 %'`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZAMG2 song %'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZAMG2 %'`);
}
test('pre-clean leftovers from a crashed run', clean);
after(async () => { await clean(); await pool.end(); });
const coded = (code) => (e) => e.code === code;

test('songs: the keeper takes the loser\'s songs in the same artist position and a shared song keeps it once', async () => {
  const k = await mk('K1'), l = await mk('L1'), x = await mk('X1');
  const s1 = await song([l, x]);
  const s2 = await song([k]);
  const s3 = await song([k, l]);
  const r = await doMerge(k, l);
  assert.deepEqual([r.merged, r.keeper.id, r.moved.songs], [true, k, 1]);
  assert.deepEqual(await artistsOf(s1), [k, x]);
  assert.deepEqual(await artistsOf(s2), [k]);
  assert.deepEqual(await artistsOf(s3), [k]);
  assert.equal((await pool.query(`SELECT count(*)::int c FROM song_artists WHERE artist_id = $1`, [l])).rows[0].c, 0);
  assert.equal((await pool.query(`SELECT count(*)::int c FROM song_artists WHERE artist_id = $1`, [k])).rows[0].c, 3);
});

test('members: a loser-only member moves with its vegan mark and source; a duplicate name is dropped', async () => {
  const k = await mk('K2'), l = await mk('L2');
  await pool.query(`INSERT INTO artist_members (artist_id, name, vegan, source) VALUES ($1, 'tab', false, 'Added by curator')`, [k]);
  await pool.query(`INSERT INTO artist_members (artist_id, name, vegan, source) VALUES ($1, 'TÀB', true, 'Wikidata'), ($1, 'Semi', true, 'MusicBrainz')`, [l]);
  const r = await doMerge(k, l);
  assert.equal(r.moved.members, 1);
  const m = (await pool.query(`SELECT name, vegan, source FROM artist_members WHERE artist_id = $1 ORDER BY name`, [k])).rows;
  assert.deepEqual(m, [{ name: 'Semi', vegan: true, source: 'MusicBrainz' }, { name: 'tab', vegan: false, source: 'Added by curator' }]);
});

test('fields: a blank keeper field is filled with its source; a differing one keeps the keeper\'s; notes are appended', async () => {
  const k = await mk('K3', { discography_review_notes: 'keeper notes', country: 'Germany', country_source: 'Added by curator' });
  const l = await mk('L3', { bio: 'Loser bio', country: 'Deutschland', country_source: 'MusicBrainz', formed_year: 1990, formed_source: 'MusicBrainz', discography_review_notes: 'old notes' });
  await doMerge(k, l);
  const a = await row(k);
  assert.equal(a.bio, 'Loser bio');
  assert.deepEqual([a.country, a.country_source], ['Germany', 'Added by curator']);
  assert.deepEqual([a.formed_year, a.formed_source], [1990, 'MusicBrainz']);
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(a.discography_review_notes, `keeper notes\n\nMerged from ZZZAMG2 L3 (${day}): old notes`);
});

test('notes: a keeper with no notes just gets the merged line; a loser with none adds nothing', async () => {
  const k = await mk('K3b'), l = await mk('L3b', { discography_review_notes: 'only notes' });
  const k2 = await mk('K3c', { discography_review_notes: 'mine' }), l2 = await mk('L3c');
  await doMerge(k, l); await doMerge(k2, l2);
  const day = new Date().toISOString().slice(0, 10);
  assert.equal((await row(k)).discography_review_notes, `Merged from ZZZAMG2 L3b (${day}): only notes`);
  assert.equal((await row(k2)).discography_review_notes, 'mine');
});

test('leads that pointed at the loser now point at the keeper', async () => {
  const k = await mk('K4'), l = await mk('L4');
  const id = (await pool.query(`INSERT INTO leads (name, name_key, artist_id) VALUES ('ZZZAMG2 lead', 'zzzamg2 lead', $1) RETURNING id`, [l])).rows[0].id;
  const r = await doMerge(k, l);
  assert.equal(r.moved.leads, 1);
  assert.equal((await pool.query(`SELECT artist_id FROM leads WHERE id = $1`, [id])).rows[0].artist_id, k);
});

test('identity: a blank keeper receives the loser\'s ids; differing ones leave the keeper\'s', async () => {
  const mb = randomUUID(), kmb = randomUUID(), lmb = randomUUID();
  const k = await mk('K5'), l = await mk('L5', { spotify: sid(), musicbrainz_id: mb, bandcamp_url: 'https://zzzamg2five.bandcamp.com' });
  const lSpotify = (await row(l)).spotify_id;
  await doMerge(k, l);
  const a = await row(k);
  assert.deepEqual([a.musicbrainz_id, a.bandcamp_url, a.spotify_id, a.data_source], [mb, 'https://zzzamg2five.bandcamp.com', lSpotify, 'spotify']);
  const ks = sid();
  const k2 = await mk('K5b', { spotify: ks, musicbrainz_id: kmb, bandcamp_url: 'https://zzzamg2keep.bandcamp.com' });
  const l2 = await mk('L5b', { spotify: sid(), musicbrainz_id: lmb, bandcamp_url: 'https://zzzamg2lose.bandcamp.com' });
  await doMerge(k2, l2);
  const b = await row(k2);
  assert.deepEqual([b.spotify_id, b.musicbrainz_id, b.bandcamp_url], [ks, kmb, 'https://zzzamg2keep.bandcamp.com']);
});

test('the snapshot row carries the loser\'s artist row, song links, members and lead ids', async () => {
  const k = await mk('K6'), l = await mk('L6', { bio: 'snap bio' });
  const s = await song([l]);
  const link = (await pool.query(`SELECT id FROM song_artists WHERE song_id = $1`, [s])).rows[0].id;
  await pool.query(`INSERT INTO artist_members (artist_id, name) VALUES ($1, 'Snap Member')`, [l]);
  const lead = (await pool.query(`INSERT INTO leads (name, name_key, artist_id) VALUES ('ZZZAMG2 lead6', 'zzzamg2 lead6', $1) RETURNING id`, [l])).rows[0].id;
  await doMerge(k, l);
  const snap = (await pool.query(`SELECT * FROM artist_merges WHERE loser_id = $1`, [l])).rows;
  assert.equal(snap.length, 1);
  assert.equal(snap[0].keeper_id, k);
  const j = snap[0].loser_snapshot;
  assert.deepEqual([j.artist.id, j.artist.name, j.artist.bio], [l, 'ZZZAMG2 L6', 'snap bio']);
  assert.deepEqual(j.song_artists, [{ id: link, song_id: s }]);
  assert.deepEqual(j.members.map((m) => m.name), ['Snap Member']);
  assert.deepEqual(j.lead_ids, [lead]);
});

test('the loser is gone and the same pair cannot be merged twice', async () => {
  const k = await mk('K7'), l = await mk('L7');
  const hash = (await svc.preview(pool, k, l)).hash;
  await svc.merge(pool, k, l, hash);
  assert.equal(await row(l), undefined);
  await assert.rejects(svc.merge(pool, k, l, hash), coded('NOT_FOUND'));
});

test('a stale hash is a CONFLICT and writes nothing', async () => {
  const k = await mk('K8'), l = await mk('L8');
  const s = await song([l]);
  const hash = (await svc.preview(pool, k, l)).hash;
  await song([l]); // the loser changed after the preview
  await assert.rejects(svc.merge(pool, k, l, hash), coded('CONFLICT'));
  assert.ok(await row(l));
  assert.deepEqual(await artistsOf(s), [l]);
  assert.equal((await pool.query(`SELECT count(*)::int c FROM artist_merges WHERE loser_id = $1`, [l])).rows[0].c, 0);
});

test('a failure part-way (the identity step) rolls everything back, snapshot included', async () => {
  const k = await mk('K9'), l = await mk('L9', { bio: 'rollback bio', musicbrainz_id: randomUUID() });
  const s = await song([l]);
  const real = svc._deps.saveIdentity;
  svc._deps.saveIdentity = async () => { throw Object.assign(new Error('boom'), { code: 'UPSTREAM' }); };
  try {
    await assert.rejects(doMerge(k, l), coded('UPSTREAM'));
  } finally { svc._deps.saveIdentity = real; }
  assert.ok(await row(l));
  assert.equal((await row(k)).bio, null);
  assert.deepEqual(await artistsOf(s), [l]);
  assert.equal((await pool.query(`SELECT count(*)::int c FROM artist_merges WHERE loser_id = $1`, [l])).rows[0].c, 0);
});

test('itself, a missing artist and a missing hash are rejected', async () => {
  const k = await mk('K10'), l = await mk('L10');
  await assert.rejects(svc.merge(pool, k, k, 'x'), coded('BAD_INPUT'));
  await assert.rejects(svc.merge(pool, k, 2147483646, 'x'), coded('NOT_FOUND'));
  await assert.rejects(svc.merge(pool, k, l, undefined), coded('BAD_INPUT'));
  await assert.rejects(svc.merge(pool, k, l, ''), coded('BAD_INPUT'));
  assert.ok(await row(l));
});
