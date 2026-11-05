const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const svc = require('../services/threadImport');
const claims = require('../services/threadClaims');

// Fixture sentinel for this file: ZZZTHR.
const NOW = new Date('2026-11-05T10:00:00Z');
const URL_ = 'https://www.reddit.com/r/vegan/comments/zzzthr/';
const coded = (code) => (e) => e.code === code;

async function mkArtist(name) {
  return (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [name])).rows[0].id;
}
async function mkSong(title, artistId, status = 'included', published = true) {
  const id = (await pool.query(`INSERT INTO songs (title, status, published, data_source) VALUES ($1,$2,$3,'manual') RETURNING id`, [title, status, published])).rows[0].id;
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, artistId]);
  return id;
}
async function clean() {
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title ILIKE '%ZZZTHR%')`);
  await pool.query(`DELETE FROM song_artists WHERE artist_id IN (SELECT id FROM artists WHERE name ILIKE '%ZZZTHR%')`);
  await pool.query(`DELETE FROM songs WHERE title ILIKE '%ZZZTHR%'`);
  await pool.query(`DELETE FROM leads WHERE name ILIKE '%ZZZTHR%'`);
  await pool.query(`DELETE FROM artists WHERE name ILIKE '%ZZZTHR%'`);
}
test('pre-clean leftovers from a crashed run', clean);
after(async () => { await clean(); await pool.end(); });

const counts = async () => (await pool.query(`SELECT (SELECT count(*) FROM songs) s, (SELECT count(*) FROM artists) a, (SELECT count(*) FROM leads) l`)).rows[0];
const one = (artist, extra = {}) => ({ thread: { url: URL_, title: 'T' }, mentions: [{ artist, ...extra }] });
const claim = (over = {}) => ({ person: 'Pat', status: 'vegan', quote: 'q', ...over });

async function fixtures() {
  await clean();
  const known = await mkArtist('ZZZTHR Known');
  await mkSong('ZZZTHR Held', known);
  await mkSong('ZZZTHR Waiting', known, 'pending', false);
  const empty = await mkArtist('ZZZTHR Empty');
  await pool.query(`INSERT INTO leads (name, name_key, status) VALUES ('ZZZTHR Lead', 'zzzthr lead', 'new'), ('ZZZTHR Gone', 'zzzthr gone', 'dismissed')`);
  return { known, empty };
}

test('validate rejects malformed input before anything else happens', () => {
  const bad = [null, 'x', {}, { thread: { url: 'ftp://x' }, mentions: [] }, { thread: { url: URL_ } },
    { thread: { url: URL_ }, mentions: {} }, { thread: { url: URL_ }, mentions: [{ artist: '  ' }] },
    { thread: { url: URL_ }, mentions: [{ artist: 5 }] }, { thread: { url: URL_ }, mentions: [{ artist: 'A', songs: 'x' }] },
    { thread: { url: URL_ }, mentions: [{ artist: 'A', claims: {} }] },
    { thread: { url: URL_ }, mentions: [{ artist: 'A', claims: [{ person: 'P', status: 'maybe' }] }] }];
  for (const b of bad) assert.throws(() => svc.validate(b), coded('BAD_INPUT'));
});
test('validate merges repeats of one band: first spelling wins, songs and claims are unioned, numbering is 1..N', () => {
  const v = svc.validate({ thread: { url: URL_ }, mentions: [
    { artist: 'The ZZZTHR Merge!', songs: ['Song A', ' '], claims: [claim()] },
    { artist: 'Other', songs: [] },
    { artist: 'zzzthr merge', songs: ['song a', 'Song B'], claims: [claim(), claim({ person: 'Sam' })] }] });
  assert.deepEqual(v.mentions.map((m) => [m.n, m.artist]), [[1, 'The ZZZTHR Merge!'], [2, 'Other']]);
  assert.deepEqual(v.mentions[0].songs, ['Song A', 'Song B']);
  assert.equal(v.mentions[0].claims.length, 2);
});

test('plan classifies artists, leads and unknown bands, matching names loosely', async () => {
  const { known, empty } = await fixtures();
  const p = await svc.plan(pool, { thread: { url: URL_ }, mentions: [
    { artist: 'zzzthr KNOWN', songs: ['ZZZTHR Held', 'zzzthr waiting', 'ZZZTHR Fresh Song'], claims: [claim()] },
    { artist: 'ZZZTHR Empty' },
    { artist: 'The ZZZTHR Lead', songs: ['x'] },
    { artist: 'ZZZTHR Gone', claims: [claim()] },
    { artist: 'ZZZTHR Brand New', songs: ['A', 'B'] }] }, { now: NOW });
  const [a, b, c, d, e] = p.items;
  assert.deepEqual([a.kind, a.artistId], ['existing_artist', known]);
  assert.deepEqual(a.songs.map((s) => [s.state, s.haveStatus]), [['have', 'included'], ['have', 'pending'], ['new', undefined]]);
  assert.deepEqual([b.kind, b.artistId, b.noSongsYet], ['existing_artist', empty, true]);
  assert.deepEqual([c.kind, c.leadStatus, c.songs[0].state], ['existing_lead', 'new', 'listed']);
  assert.deepEqual([d.kind, d.leadStatus, d.claims.map((x) => x.fresh)], ['existing_lead', 'dismissed', [false]]);
  assert.deepEqual([e.kind, e.songs.map((s) => s.state)], ['new_lead', ['listed', 'listed']]);
  assert.equal(p.totals.newSongs, 1);
  assert.equal(p.items[0].claims[0].line, claims.claimLine({ url: URL_, ...claim() }, NOW));
});

test('plan: a claim already stored is not fresh; a different person is', async () => {
  const { known } = await fixtures();
  await claims.appendClaimLines(pool, 'artists', known, [claims.claimLine({ url: URL_, ...claim() }, new Date('2026-01-01'))]);
  const p = await svc.plan(pool, one('ZZZTHR Known', { claims: [claim(), claim({ person: 'Someone Else' })] }), { now: NOW });
  assert.deepEqual(p.items[0].claims.map((x) => x.fresh), [false, true]);
});

test('plan: default skip only for an unknown band with no songs and only negative or unsure claims', async () => {
  await fixtures();
  const skip = async (m) => (await svc.plan(pool, { thread: { url: URL_ }, mentions: [m] })).items[0];
  const neg = await skip({ artist: 'ZZZTHR Neg', claims: [claim({ status: 'not_vegan' })] });
  assert.deepEqual([neg.defaultSkip, neg.skipReason], [true, 'nothing to follow up']);
  assert.equal((await skip({ artist: 'ZZZTHR Neg', claims: [claim({ status: 'unsure' })] })).defaultSkip, true);
  assert.equal((await skip({ artist: 'ZZZTHR Neg', claims: [claim({ status: 'vegan' })] })).defaultSkip, false);
  assert.equal((await skip({ artist: 'ZZZTHR Neg', songs: ['S'], claims: [claim({ status: 'not_vegan' })] })).defaultSkip, false);
  assert.equal((await skip({ artist: 'ZZZTHR Neg' })).defaultSkip, false);
  assert.equal((await skip({ artist: 'ZZZTHR Known', claims: [claim({ status: 'unsure' })] })).defaultSkip, false);
});

test('plan writes nothing', async () => {
  await fixtures();
  const before = await counts();
  await svc.plan(pool, one('ZZZTHR Writes', { songs: ['S'], claims: [claim()] }));
  await svc.plan(pool, one('ZZZTHR Known', { songs: ['New One'], claims: [claim()] }));
  assert.deepEqual(await counts(), before);
});
