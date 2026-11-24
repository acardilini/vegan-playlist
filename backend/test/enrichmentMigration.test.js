const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const { saveIdentity } = require('../services/bandCheck');

// Fixture sentinel for this file: ZZZENM.
const U = '3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f';
async function mkArtist(name) {
  return (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [name])).rows[0].id;
}
async function clean() {
  await pool.query(`DELETE FROM artists WHERE name ILIKE '%ZZZENM%'`);
}
test('pre-clean leftovers from a crashed run', clean);
after(async () => { await clean(); await pool.end(); });
const mbOf = async (id) => (await pool.query(`SELECT musicbrainz_id FROM artists WHERE id=$1`, [id])).rows[0].musicbrainz_id;

test('the review table rejects a decision without a matched id (and the reverse)', async () => {
  const id = await mkArtist('ZZZENM Check');
  await assert.rejects(pool.query(`INSERT INTO artist_enrichment_review (artist_id, match_decision) VALUES ($1,'approved')`, [id]), e => e.code === '23514');
  await assert.rejects(pool.query(`INSERT INTO artist_enrichment_review (artist_id, matched_mbid) VALUES ($1,$2)`, [id, U]), e => e.code === '23514');
  await assert.rejects(pool.query(`INSERT INTO artist_enrichment_review (artist_id, match_decision, matched_mbid) VALUES ($1,'maybe',$2)`, [id, U]), e => e.code === '23514');
  await pool.query(`INSERT INTO artist_enrichment_review (artist_id, match_decision, matched_mbid) VALUES ($1,'approved',$2)`, [id, U]);
  await pool.query(`INSERT INTO artist_enrichment_review (artist_id) VALUES ($1) ON CONFLICT (artist_id) DO UPDATE SET match_decision=NULL, matched_mbid=NULL`, [id]);
});

test('deleting an artist cascades its review row', async () => {
  const id = await mkArtist('ZZZENM Cascade');
  await pool.query(`INSERT INTO artist_enrichment_review (artist_id, match_decision, matched_mbid) VALUES ($1,'rejected',$2)`, [id, U]);
  await pool.query(`DELETE FROM artists WHERE id=$1`, [id]);
  assert.equal((await pool.query(`SELECT count(*) c FROM artist_enrichment_review WHERE artist_id=$1`, [id])).rows[0].c, '0');
});

test('a MusicBrainz id held by one artist is a CONFLICT for another, in any case; saving again on the holder is fine', async () => {
  const a = await mkArtist('ZZZENM A'), b = await mkArtist('ZZZENM B');
  await saveIdentity(pool, a, 'musicbrainz', U);
  await assert.rejects(saveIdentity(pool, b, 'musicbrainz', U), e => e.code === 'CONFLICT');
  await assert.rejects(saveIdentity(pool, b, 'musicbrainz', U.toUpperCase()), e => e.code === 'CONFLICT');
  assert.equal(await mbOf(a), U);
  assert.equal(await mbOf(b), null);
  await saveIdentity(pool, a, 'musicbrainz', U); // idempotent
  await saveIdentity(pool, a, 'musicbrainz', U.toUpperCase());
  assert.equal(await mbOf(a), U);
});

test('the unique index itself backs the check (a raw duplicate write is a 23505)', async () => {
  const a = await mkArtist('ZZZENM C'), b = await mkArtist('ZZZENM D');
  const V = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
  await pool.query(`UPDATE artists SET musicbrainz_id=$2 WHERE id=$1`, [a, V]);
  await assert.rejects(pool.query(`UPDATE artists SET musicbrainz_id=$2 WHERE id=$1`, [b, V]), e => e.code === '23505');
});
