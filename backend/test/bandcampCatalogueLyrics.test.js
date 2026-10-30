const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const svc = require('../services/bandcampLyrics');

// Fixture sentinel for this file: ZZZCLR.
const ORIGIN = 'https://zzzclr.bandcamp.com';
async function mkArtist(name) {
  return (await pool.query(`INSERT INTO artists (name, bandcamp_url, data_source) VALUES ($1,$2,'manual') RETURNING id`, [name, ORIGIN])).rows[0].id;
}
async function mkSong(artistId, title, { status = 'pending', lyrics = null } = {}) {
  const id = (await pool.query(`INSERT INTO songs (title, status, published, data_source) VALUES ($1,$2,false,'manual') RETURNING id`, [title, status])).rows[0].id;
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, artistId]);
  if (lyrics !== null) await pool.query(`INSERT INTO song_lyrics (song_id, lyrics) VALUES ($1,$2)`, [id, lyrics]);
  return id;
}
async function clean() {
  await pool.query(`DELETE FROM song_lyrics WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZCLR%')`);
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZCLR%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZCLR%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZCLR%'`);
}
test('pre-clean leftovers from a crashed run', clean);
beforeEach(() => svc._resetForTests());
after(async () => { await clean(); await pool.end(); });

const url = (t) => `${ORIGIN}/track/${t.toLowerCase().replace(/\W+/g, '-')}`;
const key = (t) => t.toLowerCase();
const song = (title, { state = 'new', songId = null, status = 'pending', bandcamp = true } = {}) => ({
  key: key(title), title, state, match: songId ? { song_id: songId, status, published: false, matched_by: 'spotify_id' } : null, bandcampUrl: bandcamp ? url(title) : null,
});
function setup(songs, pages, name) {
  const calls = [];
  const adapter = { async fetchTrack(u) { calls.push(u); const p = pages[u]; if (p instanceof Error) throw p; return { title: null, artist: p ? p.artist : null, lyrics: p ? p.lyrics : null }; } };
  const catalogue = async () => ({ artist: { id: 0, name }, songs });
  return { adapter, catalogue, calls };
}
const run = async (db, id, s) => { const r = await svc.startCatalogueRun(db, id, { adapter: s.adapter, catalogue: s.catalogue, sleep: async () => {}, gapMs: 0 }); return finish(r.runId); };
async function finish(runId) {
  for (let i = 0; i < 400; i++) {
    const r = svc.getRun(runId);
    if (r.status !== 'running') return Object.assign(r, { runId });
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error('run never finished');
}
const coded = (code) => (e) => e.code === code;

test('catalogue run fetches new songs and held songs without lyrics; skips held songs with lyrics and rejected ones', async () => {
  const a = await mkArtist('ZZZCLR Band');
  const heldNo = await mkSong(a, 'ZZZCLR HeldNo');
  const heldHas = await mkSong(a, 'ZZZCLR HeldHas', { lyrics: 'real words' });
  const heldRej = await mkSong(a, 'ZZZCLR HeldRej', { status: 'rejected' });
  const s = setup([
    song('ZZZCLR Fresh'), song('ZZZCLR HeldNo', { state: 'in_catalogue', songId: heldNo }),
    song('ZZZCLR HeldHas', { state: 'in_catalogue', songId: heldHas }), song('ZZZCLR HeldRej', { state: 'in_catalogue', songId: heldRej, status: 'rejected' }),
  ], {
    [url('ZZZCLR Fresh')]: { artist: 'ZZZCLR Band', lyrics: 'fresh words' },
    [url('ZZZCLR HeldNo')]: { artist: 'ZZZCLR Band', lyrics: 'held words' },
  }, 'ZZZCLR Band');
  const r = await run(pool, a, s);
  assert.equal(r.status, 'done');
  assert.deepEqual(s.calls.sort(), [url('ZZZCLR Fresh'), url('ZZZCLR HeldNo')].sort());
  const by = Object.fromEntries(r.results.map((x) => [x.key, x]));
  assert.deepEqual([by[key('ZZZCLR Fresh')].state, by[key('ZZZCLR Fresh')].status, by[key('ZZZCLR Fresh')].lyrics], ['new', 'found', 'fresh words']);
  assert.deepEqual([by[key('ZZZCLR HeldNo')].state, by[key('ZZZCLR HeldNo')].songId, by[key('ZZZCLR HeldNo')].status], ['held', heldNo, 'found']);
  assert.equal(by[key('ZZZCLR HeldHas')], undefined);
  assert.equal(by[key('ZZZCLR HeldRej')], undefined);
});

test('a song not listed on Bandcamp gets not-on-bandcamp and makes no request', async () => {
  const a = await mkArtist('ZZZCLR Band2');
  const s = setup([song('ZZZCLR Spotify Only', { bandcamp: false })], {}, 'ZZZCLR Band2');
  const r = await run(pool, a, s);
  assert.equal(r.results[0].status, 'not-on-bandcamp');
  assert.equal(r.results[0].note, 'not listed on Bandcamp');
  assert.deepEqual(s.calls, []);
});

test('a different-artist credit is other-artist and carries no lyrics; a page with none is no-lyrics', async () => {
  const a = await mkArtist('ZZZCLR Band3');
  const s = setup([song('ZZZCLR Foreign'), song('ZZZCLR Mute')], {
    [url('ZZZCLR Foreign')]: { artist: 'Totally Other Group', lyrics: 'x' }, [url('ZZZCLR Mute')]: { artist: 'ZZZCLR Band3', lyrics: null },
  }, 'ZZZCLR Band3');
  const by = Object.fromEntries((await run(pool, a, s)).results.map((x) => [x.key, x]));
  assert.equal(by[key('ZZZCLR Foreign')].status, 'other-artist');
  assert.equal(by[key('ZZZCLR Foreign')].lyrics, undefined);
  assert.equal(by[key('ZZZCLR Mute')].status, 'no-lyrics');
});

test('resolveForApply prefers pasted text, labels the sources and omits keys with nothing', async () => {
  const a = await mkArtist('ZZZCLR Band4');
  const s = setup([song('ZZZCLR One'), song('ZZZCLR Two'), song('ZZZCLR Three')], {
    [url('ZZZCLR One')]: { artist: 'ZZZCLR Band4', lyrics: 'fetched one' }, [url('ZZZCLR Two')]: { artist: 'ZZZCLR Band4', lyrics: 'fetched two' },
  }, 'ZZZCLR Band4');
  const r = await run(pool, a, s);
  const m = svc.resolveForApply(r.runId, [key('ZZZCLR One'), key('ZZZCLR Two'), key('ZZZCLR Three')], { [key('ZZZCLR Two')]: '  pasted two  ' }, a);
  assert.deepEqual(m.get(key('ZZZCLR One')), { text: 'fetched one', source: 'Bandcamp', url: url('ZZZCLR One') });
  assert.deepEqual(m.get(key('ZZZCLR Two')), { text: 'pasted two', source: 'Added by curator', url: null });
  assert.equal(m.has(key('ZZZCLR Three')), false);
});

test('resolveForApply with an unknown run id still resolves pasted text', () => {
  const m = svc.resolveForApply('nope', ['k'], { k: 'pasted' });
  assert.deepEqual(m.get('k'), { text: 'pasted', source: 'Added by curator', url: null });
});

test('saveHeldLyrics saves fetched lyrics with source Bandcamp and the page url', async () => {
  const a = await mkArtist('ZZZCLR Band5');
  const id = await mkSong(a, 'ZZZCLR Held5');
  const s = setup([song('ZZZCLR Held5', { state: 'in_catalogue', songId: id })], { [url('ZZZCLR Held5')]: { artist: 'ZZZCLR Band5', lyrics: 'sing it' } }, 'ZZZCLR Band5');
  const r = await run(pool, a, s);
  assert.deepEqual(await svc.saveHeldLyrics(pool, a, id, { runId: r.runId, key: key('ZZZCLR Held5') }), { saved: true });
  const sl = (await pool.query(`SELECT lyrics, source_url FROM song_lyrics WHERE song_id=$1`, [id])).rows[0];
  assert.deepEqual([sl.lyrics, sl.source_url], ['sing it', url('ZZZCLR Held5')]);
  assert.equal((await pool.query(`SELECT lyrics_source FROM songs WHERE id=$1`, [id])).rows[0].lyrics_source, 'Bandcamp');
});

test('saveHeldLyrics saves pasted text with source "Added by curator"', async () => {
  const a = await mkArtist('ZZZCLR Band6');
  const id = await mkSong(a, 'ZZZCLR Held6');
  await svc.saveHeldLyrics(pool, a, id, { text: ' my paste ' });
  assert.equal((await pool.query(`SELECT lyrics FROM song_lyrics WHERE song_id=$1`, [id])).rows[0].lyrics, 'my paste');
  assert.equal((await pool.query(`SELECT lyrics_source FROM songs WHERE id=$1`, [id])).rows[0].lyrics_source, 'Added by curator');
});

test('saveHeldLyrics refuses with CONFLICT when real lyrics appeared after the fetch', async () => {
  const a = await mkArtist('ZZZCLR Band7');
  const id = await mkSong(a, 'ZZZCLR Held7');
  const s = setup([song('ZZZCLR Held7', { state: 'in_catalogue', songId: id })], { [url('ZZZCLR Held7')]: { artist: 'ZZZCLR Band7', lyrics: 'fetched' } }, 'ZZZCLR Band7');
  const r = await run(pool, a, s);
  await pool.query(`INSERT INTO song_lyrics (song_id, lyrics) VALUES ($1,'pasted by hand')`, [id]);
  await assert.rejects(svc.saveHeldLyrics(pool, a, id, { runId: r.runId, key: key('ZZZCLR Held7') }), coded('CONFLICT'));
  assert.equal((await pool.query(`SELECT lyrics FROM song_lyrics WHERE song_id=$1`, [id])).rows[0].lyrics, 'pasted by hand');
});

test('saveHeldLyrics refuses a song that belongs to another artist', async () => {
  const a = await mkArtist('ZZZCLR Band8');
  const other = await mkArtist('ZZZCLR Other8');
  const id = await mkSong(other, 'ZZZCLR Held8');
  await assert.rejects(svc.saveHeldLyrics(pool, a, id, { text: 'x' }), coded('NOT_FOUND'));
  assert.equal((await pool.query(`SELECT 1 FROM song_lyrics WHERE song_id=$1`, [id])).rows.length, 0);
});

test('two parallel saveHeldLyrics for one song save once', async () => {
  const a = await mkArtist('ZZZCLR Band9');
  const id = await mkSong(a, 'ZZZCLR Held9');
  const settled = await Promise.allSettled([svc.saveHeldLyrics(pool, a, id, { text: 'one' }), svc.saveHeldLyrics(pool, a, id, { text: 'two' })]);
  assert.equal(settled.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(settled.find((x) => x.status === 'rejected').reason.code, 'CONFLICT');
});

test('a failed Bandcamp read refuses the run instead of reporting every song as not on Bandcamp', async () => {
  const a = await mkArtist('ZZZCLR Band10');
  const s = setup([song('ZZZCLR Any', { bandcamp: false })], {}, 'ZZZCLR Band10');
  const catalogue = async () => ({ ...(await s.catalogue()), bandcamp: { status: 'error', code: 'UPSTREAM' } });
  await assert.rejects(svc.startCatalogueRun(pool, a, { adapter: s.adapter, catalogue, sleep: async () => {}, gapMs: 0 }), coded('UPSTREAM'));
  assert.deepEqual(s.calls, []);
});

test('resolveForApply ignores a run that belongs to another artist and reports availability', async () => {
  const a = await mkArtist('ZZZCLR Band11');
  const s = setup([song('ZZZCLR Shared')], { [url('ZZZCLR Shared')]: { artist: 'ZZZCLR Band11', lyrics: 'band eleven words' } }, 'ZZZCLR Band11');
  const r = await run(pool, a, s);
  assert.equal(svc.resolveForApply(r.runId, [key('ZZZCLR Shared')], {}, a + 1).size, 0);
  assert.equal(svc.resolveForApply(r.runId, [key('ZZZCLR Shared')], {}, a).size, 1);
  assert.equal(svc.runAvailable(r.runId, a), true);
  assert.equal(svc.runAvailable(r.runId, a + 1), false);
  assert.equal(svc.runAvailable('gone', a), false);
});
