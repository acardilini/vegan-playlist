const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../database/db');
const claims = require('../services/threadClaims');
const artistsSvc = require('../services/artists');
const leadsSvc = require('../services/leads');

// Fixture sentinel for this file: ZZZTCL.
const NOW = new Date(2026, 10, 5, 12, 0, 0); // local noon, so the local calendar day is 2026-11-05 in any timezone
async function mkArtist(name) {
  return (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [name])).rows[0].id;
}
async function clean() {
  await pool.query(`DELETE FROM leads WHERE name ILIKE '%ZZZTCL%'`);
  await pool.query(`DELETE FROM artists WHERE name ILIKE '%ZZZTCL%'`);
}
test('pre-clean leftovers from a crashed run', clean);
after(async () => { await clean(); await pool.end(); });
const coded = (code) => (e) => e.code === code;
const stored = async (id, table = 'artists') => (await pool.query(`SELECT thread_claims FROM ${table} WHERE id = $1`, [id])).rows[0].thread_claims;

test('claimLine formats person, status and quote', () => {
  assert.equal(claims.claimLine({ url: 'https://r/x', person: 'Joe Duplantier', status: 'vegan', quote: 'short quote' }, NOW),
    'Reddit 2026-11-05 · https://r/x · Joe Duplantier: vegan - "short quote"');
});
test('claimLine: dispute, whole band and no quote', () => {
  assert.equal(claims.claimLine({ url: 'u', person: '', status: 'formerly_vegan', quote: '', dispute: 'later retracted' }, NOW),
    'Reddit 2026-11-05 · u · whole band: formerly vegan · disputed: later retracted');
});
test('claimLine: a long quote with newlines becomes one line cut to 200 characters', () => {
  const line = claims.claimLine({ url: 'u', person: 'P', status: 'unsure', quote: ('a\nb ' + 'x'.repeat(300)) }, NOW);
  assert.ok(!/\n/.test(line));
  const quote = line.match(/- "(.*)"$/)[1];
  assert.equal(quote.length, 200);
  assert.ok(quote.startsWith('a b x'));
});
test('bodyOf drops the dated prefix only', () => {
  const l = claims.claimLine({ url: 'u', person: 'P', status: 'vegan' }, NOW);
  assert.ok(!/^Reddit \d{4}/.test(claims.bodyOf(l)));
  assert.equal(claims.bodyOf('  plain '), 'plain');
});

test('appendClaimLines appends once, keeps existing text, ignores re-dated repeats', async () => {
  const id = await mkArtist('ZZZTCL Append');
  const a = claims.claimLine({ url: 'u', person: 'A', status: 'vegan' }, NOW);
  const b = claims.claimLine({ url: 'u', person: 'B', status: 'not_vegan' }, NOW);
  assert.equal(await claims.appendClaimLines(pool, 'artists', id, [a, b, a]), 2);
  assert.equal(await stored(id), `${a}\n${b}`);
  assert.equal(await claims.appendClaimLines(pool, 'artists', id, [a, b]), 0);
  const later = claims.claimLine({ url: 'u', person: 'A', status: 'vegan' }, new Date('2026-12-01T00:00:00Z'));
  assert.equal(await claims.appendClaimLines(pool, 'artists', id, [later]), 0);
  await pool.query(`UPDATE artists SET thread_claims = 'hand-written note' WHERE id = $1`, [id]);
  assert.equal(await claims.appendClaimLines(pool, 'artists', id, [a]), 1);
  assert.equal(await stored(id), `hand-written note\n${a}`);
});
test('appendClaimLines refuses other tables and an unknown id adds nothing', async () => {
  await assert.rejects(claims.appendClaimLines(pool, 'songs', 1, ['x']));
  assert.equal(await claims.appendClaimLines(pool, 'artists', 999999999, ['x']), 0);
});

test('artists.update saves thread_claims, blank clears it, non-text is rejected', async () => {
  const id = await mkArtist('ZZZTCL Update');
  assert.equal((await artistsSvc.update(pool, id, { thread_claims: 'x' })).thread_claims, 'x');
  assert.equal((await artistsSvc.update(pool, id, { thread_claims: '  ' })).thread_claims, null);
  await assert.rejects(artistsSvc.update(pool, id, { thread_claims: 5 }), coded('BAD_INPUT'));
});

test('promote copies a lead\'s claims onto the artist, after existing text, once', async () => {
  const lead = (await leadsSvc.addLead(pool, { name: 'ZZZTCL Promote' })).lead;
  const l1 = claims.claimLine({ url: 'u', person: 'A', status: 'vegan' }, NOW);
  await claims.appendClaimLines(pool, 'leads', lead.id, [l1]);
  const artistId = await mkArtist('ZZZTCL Promote');
  await pool.query(`UPDATE artists SET thread_claims = 'earlier' WHERE id = $1`, [artistId]);
  const r = await leadsSvc.promoteLead(pool, lead.id, { now: NOW });
  assert.equal(r.artistId, artistId);
  assert.equal(await stored(artistId), `earlier\n${l1}`);
  await leadsSvc.promoteLead(pool, lead.id, { now: NOW });
  assert.equal(await stored(artistId), `earlier\n${l1}`);
  assert.equal(r.lead.thread_claims, l1);
});

test('thread_claims is admin-only: no public route or queue predicate mentions it', () => {
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'routes')).filter((n) => n !== 'admin.js')) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8');
    assert.ok(!/thread_claims/.test(src), `${f} must not touch thread_claims`);
  }
  const art = fs.readFileSync(path.join(__dirname, '..', 'services', 'artists.js'), 'utf8');
  const predicate = art.slice(art.indexOf('const PREDICATE'), art.indexOf('const QUEUES'));
  assert.ok(predicate.length > 20 && !/thread_claims/.test(predicate));
});
