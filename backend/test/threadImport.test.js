const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const svc = require('../services/threadImport');
const claims = require('../services/threadClaims');

// Fixture sentinel for this file: ZZZTHR.
const NOW = new Date(2026, 10, 5, 12, 0, 0);
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

// ---- apply ----
const curation = require('../services/curation');
const field = async (table, name, col) => (await pool.query(`SELECT ${col} FROM ${table} WHERE name = $1`, [name])).rows[0][col];
const bigThread = () => ({ thread: { url: URL_, title: 'T' }, mentions: [
  { artist: 'ZZZTHR Known', songs: ['ZZZTHR Held', 'ZZZTHR Brand New Song'], claims: [claim({ person: 'Kim' })] },
  { artist: 'ZZZTHR Fresh Band', genre: 'hardcore', songs: ['One', 'Two'], claims: [claim({ person: 'Lee', dispute: 'later denied' })] },
  { artist: 'ZZZTHR Lead', claims: [claim({ person: 'Lead Person' })] },
  { artist: 'ZZZTHR Gone', claims: [claim({ person: 'Gone Person' })] }] });

test('apply writes songs, leads and claims where the plan says, and nothing else', async () => {
  const { known } = await fixtures();
  const before = (await pool.query(`SELECT bio, vegan_advocacy_notes FROM artists WHERE id = $1`, [known])).rows[0];
  const r = await svc.apply(pool, bigThread(), { now: NOW });
  assert.deepEqual(r.results.map((x) => [x.n, x.songsAdded, x.songsHeld, x.claimsAdded, x.error]), [[1, 1, 1, 1, undefined], [2, 0, 0, 1, undefined], [3, 0, 0, 1, undefined], [4, 0, 0, 0, undefined]]);
  const song = (await pool.query(`SELECT status, data_source, status_notes FROM songs WHERE title = 'ZZZTHR Brand New Song'`)).rows[0];
  assert.deepEqual([song.status, song.data_source], ['pending', 'manual']);
  assert.ok(song.status_notes.startsWith('added via reddit thread ('));
  const lead = (await pool.query(`SELECT * FROM leads WHERE name = 'ZZZTHR Fresh Band'`)).rows[0];
  assert.deepEqual([lead.origin, lead.url, lead.song, lead.note, lead.status], ['reddit', URL_, 'One; Two', 'hardcore', 'new']);
  assert.ok(lead.thread_claims.includes('Lee: vegan') && lead.thread_claims.includes('disputed: later denied'));
  assert.ok((await field('artists', 'ZZZTHR Known', 'thread_claims')).includes('Kim: vegan'));
  assert.ok((await field('leads', 'ZZZTHR Lead', 'thread_claims')).includes('Lead Person'));
  assert.equal(await field('leads', 'ZZZTHR Gone', 'thread_claims'), null);
  const after = (await pool.query(`SELECT bio, vegan_advocacy_notes FROM artists WHERE id = $1`, [known])).rows[0];
  assert.deepEqual(after, before);
  const q = await curation.listCurationQueue(pool, { queue: 'to-process', q: 'ZZZTHR Brand New' });
  assert.deepEqual(q.rows.map((x) => x.origin), ['redditthread']);
});

test('apply is idempotent: the same thread again adds nothing', async () => {
  await fixtures();
  await svc.apply(pool, bigThread(), { now: NOW });
  const before = await counts();
  const claimsBefore = (await pool.query(`SELECT string_agg(coalesce(thread_claims,''), '|' ORDER BY name) c FROM (SELECT name, thread_claims FROM artists WHERE name ILIKE '%ZZZTHR%' UNION ALL SELECT name, thread_claims FROM leads WHERE name ILIKE '%ZZZTHR%') t`)).rows[0].c;
  const again = await svc.apply(pool, bigThread(), { now: new Date('2026-12-01T00:00:00Z') });
  assert.deepEqual(await counts(), before);
  assert.deepEqual(again.results.map((x) => [x.songsAdded, x.claimsAdded]), [[0, 0], [0, 0], [0, 0], [0, 0]]);
  assert.equal((await pool.query(`SELECT string_agg(coalesce(thread_claims,''), '|' ORDER BY name) c FROM (SELECT name, thread_claims FROM artists WHERE name ILIKE '%ZZZTHR%' UNION ALL SELECT name, thread_claims FROM leads WHERE name ILIKE '%ZZZTHR%') t`)).rows[0].c, claimsBefore);
});

test('apply honours skip and include; a default-skipped item needs include', async () => {
  await fixtures();
  const t = { thread: { url: URL_ }, mentions: [{ artist: 'ZZZTHR Quiet', claims: [claim({ status: 'not_vegan' })] }, { artist: 'ZZZTHR Loud', songs: ['S'] }] };
  const r1 = await svc.apply(pool, t, { skip: [2] });
  assert.deepEqual(r1.results.map((x) => x.skipped), ['nothing to follow up', 'skipped by you']);
  assert.equal((await pool.query(`SELECT count(*) c FROM leads WHERE name ILIKE 'ZZZTHR Quiet' OR name ILIKE 'ZZZTHR Loud'`)).rows[0].c, '0');
  const r2 = await svc.apply(pool, t, { include: [1] });
  assert.deepEqual(r2.results.map((x) => x.skipped), [undefined, undefined]);
  assert.equal((await pool.query(`SELECT count(*) c FROM leads WHERE name ILIKE 'ZZZTHR Quiet' OR name ILIKE 'ZZZTHR Loud'`)).rows[0].c, '2');
});

test('apply cuts over-long input instead of failing', async () => {
  await fixtures();
  const songs = Array.from({ length: 12 }, (_, i) => `ZZZTHR long song title number ${i} `.padEnd(40, 'x'));
  const quote = 'q'.repeat(500) + '\nsecond line';
  const r = await svc.apply(pool, { thread: { url: URL_ }, mentions: [{ artist: 'ZZZTHR Long', songs, claims: [claim({ quote })] }] });
  assert.equal(r.results[0].error, undefined);
  const lead = (await pool.query(`SELECT song, thread_claims FROM leads WHERE name = 'ZZZTHR Long'`)).rows[0];
  assert.ok(lead.song.length <= 255 && lead.song.length > 200);
  assert.equal(lead.thread_claims.split('\n').length, 1);
  assert.equal(lead.thread_claims.match(/- "(.*)"$/)[1].length, 200);
});

test('apply is best effort: one item failing does not stop the others, and says so without detail', async () => {
  await fixtures();
  const failing = { query: (...a) => pool.query(...a), connect: async () => { throw new Error('secret detail'); } };
  const t = { thread: { url: URL_ }, mentions: [{ artist: 'ZZZTHR Known', songs: ['ZZZTHR Cannot Insert'] }, { artist: 'ZZZTHR Survivor', songs: ['S'] }] };
  const r = await svc.apply(failing, t);
  assert.equal(r.results[0].error, 'could not write this item');
  assert.ok(!JSON.stringify(r).includes('secret'));
  assert.equal(r.results[1].lead, 'added');
  assert.equal((await pool.query(`SELECT count(*) c FROM leads WHERE name = 'ZZZTHR Survivor'`)).rows[0].c, '1');
});

test('apply: an unknown band that appears as a lead after planning is treated as the duplicate it is', async () => {
  await fixtures();
  const t = { thread: { url: URL_ }, mentions: [{ artist: 'ZZZTHR Raced', claims: [claim()] }] };
  await svc.apply(pool, t, { now: NOW });
  const again = await svc.apply(pool, t, { now: NOW });
  assert.equal(again.results[0].claimsAdded, 0);
  assert.equal((await pool.query(`SELECT count(*) c FROM leads WHERE name = 'ZZZTHR Raced'`)).rows[0].c, '1');
});

// ---- overview text ----
test('formatOverview shows totals, one block per item, labels, songs, claims and skipped reasons', () => {
  const text = svc.formatOverview({
    thread: { url: URL_, title: 'Vegans in music' },
    totals: { existing_artist: 2, existing_lead: 1, new_lead: 2, newSongs: 1, freshClaims: 2 },
    items: [
      { n: 1, artist: 'Gojira', kind: 'existing_artist', songs: [{ title: 'Held', state: 'have', haveStatus: 'included' }, { title: 'Fresh', state: 'new' }], claims: [{ line: 'L1', fresh: true }, { line: 'L2', fresh: false }] },
      { n: 2, artist: 'Empty', kind: 'existing_artist', noSongsYet: true, songs: [], claims: [] },
      { n: 3, artist: 'Known Lead', kind: 'existing_lead', leadStatus: 'dismissed', songs: [{ title: 'x', state: 'listed' }], claims: [] },
      { n: 4, artist: 'Cold', kind: 'new_lead', songs: [], claims: [{ line: 'L3', fresh: true }], defaultSkip: true, skipReason: 'nothing to follow up' },
      { n: 5, artist: 'New Band', kind: 'new_lead', songs: [{ title: 'A', state: 'listed' }], claims: [] }] });
  const lines = text.split('\n');
  assert.equal(lines[0], `Thread: Vegans in music (${URL_})`);
  assert.equal(lines[1], '5 bands: 2 already artists, 1 already leads, 2 new leads · 1 new songs · 2 new claim lines');
  for (const expected of ['#1 Gojira - already an artist', '    song: Held - have it (included)', '    song: Fresh - NEW song', '    claim: new: L1', '    claim: already noted',
    '#2 Empty - already an artist (no songs yet)', '#3 Known Lead - already a lead (dismissed)', '    song: x - named',
    '#4 Cold - NEW lead', '    [skipped by default: nothing to follow up]', '#5 New Band - NEW lead']) {
    assert.ok(lines.includes(expected), `missing line: ${expected}`);
  }
});
