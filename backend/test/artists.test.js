const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const svc = require('../services/artists');

// Fixture sentinel for this file: ZZZART.
async function mk(name, f = {}) {
  return (await pool.query(
    `INSERT INTO artists (name, spotify_id, bandcamp_url, musicbrainz_id, bio, vegan_advocacy_notes,
                          no_advocacy_notes_needed, discography_reviewed, data_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,   // artists_source_check ties spotify_id to data_source='spotify'
    [name, f.spotify_id || null, f.bandcamp_url || null, f.musicbrainz_id || null, f.bio || null,
     f.notes || null, !!f.none, !!f.reviewed, f.spotify_id ? 'spotify' : 'manual'])).rows[0].id;
}
async function mkSong(artistId, title, { status = 'included', published = true } = {}) {
  const id = (await pool.query(`INSERT INTO songs (title, status, published, data_source) VALUES ($1,$2,$3,'manual') RETURNING id`,
    [title, status, published])).rows[0].id;
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, artistId]);
  return id;
}
async function clean() {
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZART%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZART%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZART%'`);
}
test('pre-clean leftovers from a crashed run', clean);
after(async () => { await clean(); await pool.end(); });

const ZQ = { q: 'ZZZART', limit: 200 };
const names = (r) => r.rows.map(x => x.name);

test('each queue lists exactly the artists its predicate describes, and counts agree with the lists', async () => {
  const MB = '11111111-2222-3333-4444-555555555555';
  await mk('ZZZART bare');                                                   // identity+check+bio+notes needed
  await mk('ZZZART ident', { bandcamp_url: 'https://x.bandcamp.com' });      // has identity
  await mk('ZZZART reviewed', { musicbrainz_id: MB, reviewed: true });
  await mk('ZZZART bio', { bio: 'A bio' });
  await mk('ZZZART notes', { notes: 'Some notes' });
  await mk('ZZZART none', { none: true });
  await mk('ZZZART done', { spotify_id: 'ZZZARTdddddddddddddddd', reviewed: true, bio: 'b', notes: 'n' });

  const L = async (queue) => names(await svc.list(pool, { queue, ...ZQ }));
  assert.deepEqual(await L('needs-identity'), ['ZZZART bio', 'ZZZART bare', 'ZZZART none', 'ZZZART notes'].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  assert.ok(!(await L('needs-identity')).includes('ZZZART ident'));
  assert.ok(!(await L('needs-check')).includes('ZZZART reviewed'));
  assert.ok((await L('needs-check')).includes('ZZZART bare'));
  assert.ok(!(await L('needs-bio')).includes('ZZZART bio'));
  assert.ok((await L('needs-bio')).includes('ZZZART bare'));
  assert.ok(!(await L('needs-notes')).includes('ZZZART notes'));
  assert.ok(!(await L('needs-notes')).includes('ZZZART none'), 'none-needed leaves the notes queue');
  assert.deepEqual(await L('done'), ['ZZZART done']);

  const c = await svc.counts(pool);
  for (const key of ['needs-identity', 'needs-check', 'needs-bio', 'needs-notes', 'done', 'all']) {
    assert.equal(c[key], (await svc.list(pool, { queue: key, limit: 1 })).total, `${key}: count must equal list total`);
  }
});

test('search is literal, combines with a queue and paging, and the total matches the list', async () => {
  await mk("ZZZART O'Brien");
  await mk('ZZZART 100% Real');
  await mk('ZZZART Under_score');
  const quote = await svc.list(pool, { q: "o'brien" });
  assert.deepEqual(names(quote), ["ZZZART O'Brien"]);
  assert.equal(quote.total, 1);
  assert.equal((await svc.list(pool, { q: 'ZZZART%' })).total, 0, '% is literal, not a wildcard');
  assert.equal((await svc.list(pool, { q: '100%' })).total, 1);
  assert.equal((await svc.list(pool, { q: 'ZZZART_' })).total, 0, '_ is literal, not a wildcard');
  const page2 = await svc.list(pool, { q: 'ZZZART', queue: 'needs-bio', limit: 2, offset: 2 });
  const all = await svc.list(pool, { q: 'ZZZART', queue: 'needs-bio', limit: 200 });
  assert.equal(page2.total, all.total);
  assert.deepEqual(names(page2), names(all).slice(2, 4));
});

test('rows carry song counts and flags; an artist with no songs lists fine; unknown queue is BAD_INPUT', async () => {
  const a = await mk('ZZZART counted', { bio: 'b' });
  await mkSong(a, 'ZZZART live', {}); await mkSong(a, 'ZZZART pend', { status: 'pending', published: false });
  const row = (await svc.list(pool, { q: 'ZZZART counted' })).rows[0];
  assert.deepEqual([row.songs, row.live_songs, row.has_bio, row.has_notes, row.reviewed, row.none_needed], [2, 1, true, false, false, false]);
  assert.deepEqual(row.identity, { spotify: false, bandcamp: false, musicbrainz: false });
  await assert.rejects(() => svc.list(pool, { queue: 'nope' }), { code: 'BAD_INPUT' });
});

test('get returns the full artist; missing id is NOT_FOUND', async () => {
  const id = await mk('ZZZART full', { bio: 'b', notes: 'n', bandcamp_url: 'https://f.bandcamp.com' });
  const a = await svc.get(pool, id);
  assert.equal(a.name, 'ZZZART full');
  for (const k of ['id', 'name', 'bio', 'vegan_advocacy_notes', 'no_advocacy_notes_needed', 'website_url', 'genres',
    'spotify_id', 'bandcamp_url', 'musicbrainz_id', 'discography_reviewed', 'discography_reviewed_date',
    'discography_review_notes', 'songs', 'live_songs']) assert.ok(k in a, `missing key ${k}`);
  assert.equal(a.bandcamp_url, 'https://f.bandcamp.com');
  await assert.rejects(() => svc.get(pool, 2147483000), { code: 'NOT_FOUND' });
});

test('update writes only whitelisted fields, validates, and stamps the review date', async () => {
  const id = await mk('ZZZART upd');
  let a = await svc.update(pool, id, { bio: 'New bio', vegan_advocacy_notes: 'N', no_advocacy_notes_needed: true,
    website_url: 'https://example.org', genres: ['punk', 'hardcore'], discography_review_notes: 'checked' });
  assert.deepEqual([a.bio, a.vegan_advocacy_notes, a.no_advocacy_notes_needed, a.website_url, a.genres, a.discography_review_notes],
    ['New bio', 'N', true, 'https://example.org', ['punk', 'hardcore'], 'checked']);
  a = await svc.update(pool, id, { discography_reviewed: true });
  assert.equal(a.discography_reviewed, true); assert.ok(a.discography_reviewed_date);
  a = await svc.update(pool, id, { discography_reviewed: false });
  assert.equal(a.discography_reviewed_date, null);
  a = await svc.update(pool, id, { website_url: '' });
  assert.equal(a.website_url, null, 'blank website clears it');
  // ignored fields: identity is written only by bandCheck.saveIdentity; unknown keys are dropped
  a = await svc.update(pool, id, { bandcamp_url: 'https://evil.example', spotify_id: 'x', bogus: 1, name: 'ZZZART upd2' });
  assert.equal(a.bandcamp_url, null); assert.equal(a.spotify_id, null); assert.equal(a.name, 'ZZZART upd2');
});

test('update rejects bad input without writing, and a missing artist is NOT_FOUND', async () => {
  const id = await mk('ZZZART guard');
  await assert.rejects(() => svc.update(pool, id, { name: '   ' }), { code: 'BAD_INPUT' });
  await assert.rejects(() => svc.update(pool, id, { website_url: 'javascript:alert(1)' }), { code: 'BAD_INPUT' });
  await assert.rejects(() => svc.update(pool, id, { website_url: 'https://example.org/' + 'a'.repeat(500) }), { code: 'BAD_INPUT' });
  assert.equal((await svc.get(pool, id)).website_url, null, 'over-long website was not written');
  await assert.rejects(() => svc.update(pool, id, { genres: 'punk' }), { code: 'BAD_INPUT' });
  await assert.rejects(() => svc.update(pool, id, { no_advocacy_notes_needed: 'yes' }), { code: 'BAD_INPUT' });
  assert.equal((await svc.get(pool, id)).name, 'ZZZART guard');
  await assert.rejects(() => svc.update(pool, 2147483000, { bio: 'x' }), { code: 'NOT_FOUND' });
});
