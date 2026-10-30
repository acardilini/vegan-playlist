const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const svc = require('../services/bandcampLyrics');

// Fixture sentinel for this file: ZZZBCL.
const ORIGIN = 'https://zzzbcl.bandcamp.com';
async function mkArtist(name, bandcamp_url = ORIGIN) {
  return (await pool.query(`INSERT INTO artists (name, bandcamp_url, data_source) VALUES ($1,$2,'manual') RETURNING id`, [name, bandcamp_url])).rows[0].id;
}
async function mkSong(artistId, title, { status = 'included', lyrics = null, junk = null, bandcamp_url = null } = {}) {
  const id = (await pool.query(`INSERT INTO songs (title, status, published, bandcamp_url, data_source) VALUES ($1,$2,$4,$3,'manual') RETURNING id`, [title, status, bandcamp_url, status === 'included'])).rows[0].id;
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, artistId]);
  if (lyrics !== null) await pool.query(`INSERT INTO song_lyrics (song_id, lyrics, junk_kind) VALUES ($1,$2,$3)`, [id, lyrics, junk]);
  return id;
}
async function clean() {
  await pool.query(`DELETE FROM song_lyrics WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZBCL%')`);
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZBCL%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZBCL%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZBCL%'`);
}
test('pre-clean leftovers from a crashed run', clean);
beforeEach(() => svc._resetForTests());
after(async () => { await clean(); await pool.end(); });

const tr = (title) => ({ title, url: `${ORIGIN}/track/${title.replace(/\W+/g, '-').toLowerCase()}` });
// pages: url -> { artist, lyrics } | Error
function fake({ titles = [], pages = {}, truncated = false, catalogueError = null, gate = null } = {}) {
  const calls = { catalogue: 0, track: [] };
  return {
    calls,
    async fetchCatalogue() {
      calls.catalogue++;
      if (gate) await gate;
      if (catalogueError) throw catalogueError;
      return { source: 'bandcamp', releases: [{ tracks: titles.map(tr) }], truncated };
    },
    async fetchTrack(url) {
      calls.track.push(url);
      const p = pages[url];
      if (p instanceof Error) throw p;
      return { title: null, artist: p ? p.artist : null, lyrics: p ? p.lyrics : null };
    },
  };
}
const opts = (adapter) => ({ adapter, sleep: async () => {}, gapMs: 0 });
async function finish(runId) {
  for (let i = 0; i < 400; i++) {
    const r = svc.getRun(runId);
    if (r.status !== 'running') return r;
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error('run never finished');
}
const coded = (code) => (e) => e.code === code;

test('artist run fetches only eligible songs and offers found lyrics', async () => {
  const a = await mkArtist('ZZZBCL Band');
  const eligible = await mkSong(a, 'ZZZBCL Alpha');
  await mkSong(a, 'ZZZBCL Has', { lyrics: 'real words' });
  await mkSong(a, 'ZZZBCL Rej', { status: 'rejected' });
  const ad = fake({ titles: ['ZZZBCL Alpha', 'ZZZBCL Has', 'ZZZBCL Rej'], pages: { [tr('ZZZBCL Alpha').url]: { artist: 'ZZZBCL Band', lyrics: 'la la' } } });
  const { runId } = await svc.startArtistRun(pool, a, opts(ad));
  const r = await finish(runId);
  assert.equal(r.status, 'done');
  assert.deepEqual(ad.calls.track, [tr('ZZZBCL Alpha').url]);
  assert.deepEqual(r.results.map((x) => [x.songId, x.status, x.lyrics]), [[eligible, 'found', 'la la']]);
  assert.equal(r.results[0].url, tr('ZZZBCL Alpha').url);
});

test('run reports no-lyrics, not-found, ambiguous and other-artist with the spec notes', async () => {
  const a = await mkArtist('ZZZBCL Band2');
  const s = {};
  for (const n of ['Mute', 'Gone', 'Twice', 'Foreign']) s[n] = await mkSong(a, 'ZZZBCL ' + n);
  const ad = fake({
    titles: ['ZZZBCL Mute', 'ZZZBCL Twice', 'ZZZBCL Twice (Live)', 'ZZZBCL Foreign'],
    pages: { [tr('ZZZBCL Mute').url]: { artist: 'ZZZBCL Band2', lyrics: null }, [tr('ZZZBCL Foreign').url]: { artist: 'Totally Other Group', lyrics: 'x' } },
  });
  const r = await finish((await svc.startArtistRun(pool, a, opts(ad))).runId);
  const by = Object.fromEntries(r.results.map((x) => [x.songId, x]));
  assert.equal(by[s.Mute].status, 'no-lyrics');
  assert.equal(by[s.Gone].status, 'not-found');
  assert.equal(by[s.Gone].note, 'not found on Bandcamp');
  assert.equal(by[s.Twice].status, 'ambiguous');
  assert.equal(by[s.Twice].note, 'more than one match');
  assert.equal(by[s.Foreign].status, 'other-artist');
  assert.equal(by[s.Foreign].note, 'Bandcamp credits a different artist');
  assert.equal(by[s.Foreign].lyrics, undefined);
});

test('a truncated catalogue words unmatched songs as cut short', async () => {
  const a = await mkArtist('ZZZBCL Band3');
  const id = await mkSong(a, 'ZZZBCL Missing');
  const r = await finish((await svc.startArtistRun(pool, a, opts(fake({ truncated: true })))).runId);
  assert.equal(r.truncated, true);
  assert.equal(r.results.find((x) => x.songId === id).note, 'not found (catalogue was cut short)');
});

test('a junk-flagged song is eligible', async () => {
  const a = await mkArtist('ZZZBCL Band4');
  const id = await mkSong(a, 'ZZZBCL Junky', { lyrics: 'Error 404', junk: 'error' });
  const ad = fake({ titles: ['ZZZBCL Junky'], pages: { [tr('ZZZBCL Junky').url]: { artist: 'ZZZBCL Band4', lyrics: 'real' } } });
  const r = await finish((await svc.startArtistRun(pool, a, opts(ad))).runId);
  assert.equal(r.results[0].songId, id);
  assert.equal(r.results[0].status, 'found');
});

test('an artist without a usable Bandcamp link throws NO_IDENTITY and makes no request', async () => {
  const none = await mkArtist('ZZZBCL NoLink', null);
  const other = await mkArtist('ZZZBCL OtherHost', 'https://example.com/music');
  for (const id of [none, other]) {
    const ad = fake();
    await assert.rejects(svc.startArtistRun(pool, id, opts(ad)), coded('NO_IDENTITY'));
    assert.equal(ad.calls.catalogue, 0);
  }
});

test('a second start while one is running throws BUSY; a new one works after it finishes', async () => {
  const a = await mkArtist('ZZZBCL Band5');
  await mkSong(a, 'ZZZBCL One');
  let open;
  const gate = new Promise((res) => { open = res; });
  const { runId } = await svc.startArtistRun(pool, a, opts(fake({ gate })));
  await assert.rejects(svc.startArtistRun(pool, a, opts(fake())), coded('BUSY'));
  open();
  await finish(runId);
  await finish((await svc.startArtistRun(pool, a, opts(fake()))).runId);
});

test('getRun on an unknown id throws NOT_FOUND', () => {
  assert.throws(() => svc.getRun('nope'), coded('NOT_FOUND'));
});

test('saveFetched writes lyrics, source url and source "Bandcamp" and marks lyrics found', async () => {
  const a = await mkArtist('ZZZBCL Band6');
  const id = await mkSong(a, 'ZZZBCL Save');
  const ad = fake({ titles: ['ZZZBCL Save'], pages: { [tr('ZZZBCL Save').url]: { artist: 'ZZZBCL Band6', lyrics: 'sing it' } } });
  const { runId } = await svc.startArtistRun(pool, a, opts(ad));
  await finish(runId);
  assert.deepEqual(await svc.saveFetched(pool, runId, id), { saved: true });
  const sl = (await pool.query(`SELECT lyrics, source_url FROM song_lyrics WHERE song_id=$1`, [id])).rows[0];
  assert.equal(sl.lyrics, 'sing it');
  assert.equal(sl.source_url, tr('ZZZBCL Save').url);
  const s = (await pool.query(`SELECT lyrics_source, lyrics_status FROM songs WHERE id=$1`, [id])).rows[0];
  assert.equal(s.lyrics_source, 'Bandcamp');
  assert.equal(s.lyrics_status, 'found');
});

test('saveFetched refuses with CONFLICT when real lyrics appeared after the fetch', async () => {
  const a = await mkArtist('ZZZBCL Band7');
  const id = await mkSong(a, 'ZZZBCL Race');
  const ad = fake({ titles: ['ZZZBCL Race'], pages: { [tr('ZZZBCL Race').url]: { artist: 'ZZZBCL Band7', lyrics: 'fetched' } } });
  const { runId } = await svc.startArtistRun(pool, a, opts(ad));
  await finish(runId);
  await pool.query(`INSERT INTO song_lyrics (song_id, lyrics) VALUES ($1,'pasted by hand')`, [id]);
  await assert.rejects(svc.saveFetched(pool, runId, id), coded('CONFLICT'));
  assert.equal((await pool.query(`SELECT lyrics FROM song_lyrics WHERE song_id=$1`, [id])).rows[0].lyrics, 'pasted by hand');
});

test('saveFetched refuses a result that is not found', async () => {
  const a = await mkArtist('ZZZBCL Band8');
  const id = await mkSong(a, 'ZZZBCL Nothing');
  const { runId } = await svc.startArtistRun(pool, a, opts(fake()));
  await finish(runId);
  await assert.rejects(svc.saveFetched(pool, runId, id), coded('CONFLICT'));
});

test('song run reads the song own track URL directly (no catalogue read)', async () => {
  const a = await mkArtist('ZZZBCL Band9', null);
  const url = `${ORIGIN}/track/direct`;
  const id = await mkSong(a, 'ZZZBCL Direct', { bandcamp_url: url });
  const ad = fake({ pages: { [url]: { artist: 'ZZZBCL Band9', lyrics: 'direct words' } } });
  const r = await finish((await svc.startSongRun(pool, id, opts(ad))).runId);
  assert.equal(ad.calls.catalogue, 0);
  assert.deepEqual(ad.calls.track, [url]);
  assert.equal(r.results[0].status, 'found');
});

test('song run falls back to the artist link and only considers that song', async () => {
  const a = await mkArtist('ZZZBCL Band10');
  const id = await mkSong(a, 'ZZZBCL Mine');
  await mkSong(a, 'ZZZBCL Sibling');
  const ad = fake({ titles: ['ZZZBCL Mine', 'ZZZBCL Sibling'], pages: { [tr('ZZZBCL Mine').url]: { artist: 'ZZZBCL Band10', lyrics: 'mine' } } });
  const r = await finish((await svc.startSongRun(pool, id, opts(ad))).runId);
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].songId, id);
  assert.deepEqual(ad.calls.track, [tr('ZZZBCL Mine').url]);
});

test('song run on a song that already has lyrics is a CONFLICT; with no link anywhere NO_IDENTITY', async () => {
  const a = await mkArtist('ZZZBCL Band11', null);
  const has = await mkSong(a, 'ZZZBCL Done', { lyrics: 'have' });
  const bare = await mkSong(a, 'ZZZBCL Bare');
  await assert.rejects(svc.startSongRun(pool, has, opts(fake())), coded('CONFLICT'));
  await assert.rejects(svc.startSongRun(pool, bare, opts(fake())), coded('NO_IDENTITY'));
});

test('a source error fails the run with the coded error and no results', async () => {
  const a = await mkArtist('ZZZBCL Band12');
  await mkSong(a, 'ZZZBCL Any');
  const e = new Error('secret https://x');
  e.code = 'UPSTREAM';
  const r = await finish((await svc.startArtistRun(pool, a, opts(fake({ catalogueError: e })))).runId);
  assert.equal(r.status, 'failed');
  assert.equal(r.error.code, 'UPSTREAM');
  assert.equal(r.results, undefined);
  assert.ok(!/secret/.test(r.error.message));
});

test('final review: two artist runs started together cannot both run (BUSY)', async () => {
  const a = await mkArtist('ZZZBCL Band13');
  await mkSong(a, 'ZZZBCL Racer');
  let open;
  const gate = new Promise((res) => { open = res; });
  const ad = fake({ gate, titles: ['ZZZBCL Racer'] });
  const slow = { query: async (...args) => { await new Promise((res) => setTimeout(res, 20)); return pool.query(...args); } }; // widen the window between the guard and the claim
  const settled = await Promise.allSettled([svc.startArtistRun(slow, a, opts(ad)), svc.startArtistRun(slow, a, opts(ad))]);
  assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1);
  assert.equal(settled.find((s) => s.status === 'rejected').reason.code, 'BUSY');
  open();
  await finish(settled.find((s) => s.status === 'fulfilled').value.runId);
});

test('final review: two parallel Saves of one row save once; the other is refused', async () => {
  const a = await mkArtist('ZZZBCL Band14');
  const id = await mkSong(a, 'ZZZBCL Twin');
  const ad = fake({ titles: ['ZZZBCL Twin'], pages: { [tr('ZZZBCL Twin').url]: { artist: 'ZZZBCL Band14', lyrics: 'once' } } });
  const { runId } = await svc.startArtistRun(pool, a, opts(ad));
  await finish(runId);
  const settled = await Promise.allSettled([svc.saveFetched(pool, runId, id), svc.saveFetched(pool, runId, id)]);
  assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1);
  assert.equal(settled.find((s) => s.status === 'rejected').reason.code, 'CONFLICT');
});

test('final review: an artist with nothing to fetch finishes without reading Bandcamp', async () => {
  const a = await mkArtist('ZZZBCL Band15');
  await mkSong(a, 'ZZZBCL Complete', { lyrics: 'have it' });
  const ad = fake();
  const r = await finish((await svc.startArtistRun(pool, a, opts(ad))).runId);
  assert.equal(r.status, 'done');
  assert.deepEqual(r.results, []);
  assert.equal(ad.calls.catalogue, 0);
});
