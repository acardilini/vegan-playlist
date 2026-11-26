const { test, after } = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const pool = require('../database/db');
const { preview } = require('../services/artistMerge');

// Fixture sentinel for this file: ZZZAMG (the merge test file uses ZZZAMG2 and its cleanup must not match this one).
let n = 0;
const uid = () => `ZZZAMG${String(++n).padStart(3, '0')}${Date.now().toString(36)}`.slice(0, 22).padEnd(22, 'x');
async function mk(name, o = {}) {
  const spotify = o.spotify || null;
  const cols = { bio: null, country: null, country_source: null, bandcamp_url: null, musicbrainz_id: null, ...o };
  delete cols.spotify;
  const r = await pool.query(
    `INSERT INTO artists (name, spotify_id, data_source, bio, country, country_source, bandcamp_url, musicbrainz_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [`ZZZAMG ${name}`, spotify, spotify ? 'spotify' : 'manual', cols.bio, cols.country, cols.country_source, cols.bandcamp_url, cols.musicbrainz_id]);
  return r.rows[0].id;
}
async function song(artistIds, { live = true } = {}) {
  const id = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source) VALUES ($1, $2, $3, 'manual') RETURNING id`,
    [`ZZZAMG song ${uid()}`, live ? 'included' : 'pending', live])).rows[0].id;
  for (const a of artistIds) await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1, $2)`, [id, a]);
  return id;
}
async function member(artistId, name) {
  return (await pool.query(`INSERT INTO artist_members (artist_id, name) VALUES ($1, $2) RETURNING id`, [artistId, name])).rows[0].id;
}
async function clean() {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZAMG song %'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZAMG %'`);
}
test('pre-clean leftovers from a crashed run', clean);
after(async () => { await clean(); await pool.end(); });
const coded = (code) => (e) => e.code === code;

test('the same id, a non-integer and a missing artist throw the right codes', async () => {
  const a = await mk('A1');
  await assert.rejects(preview(pool, a, a), coded('BAD_INPUT'));
  await assert.rejects(preview(pool, 'x', a), coded('BAD_INPUT'));
  await assert.rejects(preview(pool, a, 1.5), coded('BAD_INPUT'));
  await assert.rejects(preview(pool, a, 2147483646), coded('NOT_FOUND'));
  await assert.rejects(preview(pool, 2147483646, a), coded('NOT_FOUND'));
});

test('songs: moving and shared, with the side counts', async () => {
  const k = await mk('K2'), l = await mk('L2');
  await song([k, l]);           // shared
  await song([l], { live: false }); // moving, not live
  await song([k]);              // keeper only
  const p = await preview(pool, k, l);
  assert.deepEqual(p.songs, { moving: 1, shared: 1 });
  assert.deepEqual([p.keeper.id, p.keeper.songs, p.keeper.live_songs], [k, 2, 2]);
  assert.deepEqual([p.loser.id, p.loser.songs, p.loser.live_songs], [l, 2, 1]);
  assert.equal(p.keeper.name, 'ZZZAMG K2');
});

test('members match by name key, so case and diacritics are skipped as duplicates', async () => {
  const k = await mk('K3'), l = await mk('L3');
  await member(k, 'Tab'); await member(l, 'TÀB'); await member(l, 'Semi');
  const p = await preview(pool, k, l);
  assert.deepEqual(p.members, { moving: 1, skipped: 1 });
});

test('leads pointing at the loser are counted', async () => {
  const k = await mk('K4'), l = await mk('L4');
  await pool.query(`INSERT INTO leads (name, name_key, artist_id) VALUES ($1, $2, $3)`, ['ZZZAMG lead', 'zzzamg lead4', l]);
  try {
    assert.equal((await preview(pool, k, l)).leads, 1);
  } finally { await pool.query(`DELETE FROM leads WHERE name = 'ZZZAMG lead'`); }
});

test('a blank keeper field the loser has is a fill; both different is a conflict with both values', async () => {
  const k = await mk('K5', { country: 'Germany', country_source: 'Added by curator' });
  const l = await mk('L5', { bio: 'A bio', country: 'Deutschland' });
  const p = await preview(pool, k, l);
  assert.ok(p.fills.includes('bio'));
  assert.ok(!p.fills.includes('country'));
  assert.deepEqual(p.conflicts, [{ field: 'country', keeper: 'Germany', loser: 'Deutschland' }]);
});

test('identity: a blank keeper is carried, differing values are kept', async () => {
  const mbL = randomUUID(), mbK = randomUUID();
  const k = await mk('K6', { spotify: uid(), musicbrainz_id: mbK });
  const l = await mk('L6', { spotify: uid(), musicbrainz_id: null, bandcamp_url: 'https://zzzamg6.bandcamp.com' });
  const p = await preview(pool, k, l);
  assert.deepEqual(p.identity.carried, ['bandcamp']);
  assert.deepEqual(p.identity.kept, ['spotify']);
  const k2 = await mk('K7'), l2 = await mk('L7', { musicbrainz_id: mbL });
  assert.deepEqual((await preview(pool, k2, l2)).identity, { carried: ['musicbrainz'], kept: [] });
});

test('the hash is stable and changes when the loser gains a song', async () => {
  const k = await mk('K8'), l = await mk('L8');
  await song([l]);
  const h1 = (await preview(pool, k, l)).hash;
  assert.match(h1, /^[0-9a-f]{40}$/);
  assert.equal((await preview(pool, k, l)).hash, h1);
  await song([l]);
  assert.notEqual((await preview(pool, k, l)).hash, h1);
});
