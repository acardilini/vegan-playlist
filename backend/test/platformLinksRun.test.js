const { test, before, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const pl = require('../services/platformLinks');

// Fixture sentinel for this file: ZZZPLK (song titles, the artist name and the fake spotify ids). Fixture songs are
// included but never published; deleting a song cascades its link rows.

const GAPS = { spotify: 0, deezer: 0, apple: 0 };
let n = 0;
async function mkSong(title, { isrc = null } = {}) {
  const sp = `zzzplk${Date.now().toString(36)}${n++}`;
  const id = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source, spotify_id, isrc) VALUES ($1,'included',false,'manual',$2,$3) RETURNING id`, [title, sp, isrc])).rows[0].id;
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, ARTIST]);
  return id;
}
const rows = async (id) => (await pool.query(`SELECT platform, url, status, source, match_title, match_artist FROM song_platform_links WHERE song_id=$1 ORDER BY platform`, [id])).rows;
const isrcOf = async (id) => (await pool.query('SELECT isrc FROM songs WHERE id=$1', [id])).rows[0].isrc;
const finish = async (ids, adapters) => {
  const { runId } = await pl.startRun(pool, { songIds: ids, adapters, gaps: GAPS });
  await pl.waitForRun(runId);
  return pl.getRun(runId);
};
const fake = (o = {}) => {
  const calls = { spotify: 0, deezer: 0, apple: 0 };
  return {
    calls,
    spotifyIsrc: async () => { calls.spotify++; if (o.spotify instanceof Error) throw o.spotify; return o.spotify === undefined ? 'GBF076620670' : o.spotify; },
    deezerByIsrc: async () => { calls.deezer++; return o.deezer === undefined ? { url: 'https://www.deezer.com/track/1' } : o.deezer; },
    appleSearch: async ({ title }) => { calls.apple++; return o.apple === undefined ? { url: 'https://music.apple.com/us/album/x/1?i=1', title: `${title} (Apple)`, artist: 'Apple Band' } : o.apple; },
  };
};

let ARTIST;
async function clean() {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZPLK%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZPLK%'`);
}
before(async () => {
  await clean();
  ARTIST = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ('ZZZPLK Band','manual') RETURNING id`)).rows[0].id;
});
after(async () => { await clean(); await pool.end(); });

test('a Deezer hit is saved confirmed from the ISRC, an Apple hit proposed with what Apple called it, and the ISRC is stored', async () => {
  const s = await mkSong('ZZZPLK one');
  const f = fake();
  const run = await finish([s], f);
  assert.equal(run.state, 'done');
  assert.deepEqual(run.found, { deezer: 1, apple_proposed: 1 });
  const r = await rows(s);
  assert.deepEqual(r.map((x) => [x.platform, x.status, x.source]), [['apple_music', 'proposed', 'search'], ['deezer', 'confirmed', 'isrc']]);
  assert.equal(r[0].match_title, 'ZZZPLK one (Apple)');
  assert.equal(r[0].match_artist, 'Apple Band');
  assert.equal(await isrcOf(s), 'GBF076620670');
});

test('a confirmed or rejected row is never replaced, and its adapter is not called', async () => {
  const s = await mkSong('ZZZPLK two', { isrc: 'GBF076620670' });
  await pool.query(`INSERT INTO song_platform_links (song_id, platform, url, status, source) VALUES ($1,'deezer','https://www.deezer.com/track/keep','confirmed','isrc'), ($1,'apple_music','https://music.apple.com/x/rejected','rejected','search')`, [s]);
  const f = fake();
  await finish([s], f);
  assert.deepEqual(f.calls, { spotify: 0, deezer: 0, apple: 0 }, 'nothing to look up, and a stored ISRC is not fetched again');
  const r = await rows(s);
  assert.deepEqual(r.map((x) => [x.platform, x.url, x.status]), [['apple_music', 'https://music.apple.com/x/rejected', 'rejected'], ['deezer', 'https://www.deezer.com/track/keep', 'confirmed']]);
});

test('a Spotify failure skips Deezer for that song, counts it, and the run still finishes', async () => {
  const bad = await mkSong('ZZZPLK three a');
  const good = await mkSong('ZZZPLK three b');
  let first = true;
  const f = fake();
  f.spotifyIsrc = async () => { if (first) { first = false; const e = new Error('Spotify did not answer'); e.code = 'UPSTREAM'; throw e; } return 'GBF076620670'; };
  const run = await finish([bad, good], f);
  assert.equal(run.state, 'done');
  assert.equal(run.skipped, 1);
  assert.deepEqual((await rows(bad)).map((x) => x.platform), ['apple_music'], 'Apple does not need an ISRC');
  assert.deepEqual((await rows(good)).map((x) => x.platform), ['apple_music', 'deezer']);
});

test('no ISRC means no Deezer call but Apple still runs; a Deezer miss still tries Apple', async () => {
  const noIsrc = await mkSong('ZZZPLK four a');
  const f1 = fake({ spotify: null });
  await finish([noIsrc], f1);
  assert.equal(f1.calls.deezer, 0);
  assert.deepEqual((await rows(noIsrc)).map((x) => x.platform), ['apple_music']);

  const miss = await mkSong('ZZZPLK four b');
  const f2 = fake({ deezer: null });
  await finish([miss], f2);
  assert.equal(f2.calls.apple, 1);
  assert.deepEqual((await rows(miss)).map((x) => x.platform), ['apple_music']);
});

test('an Apple miss saves nothing, and a second run is BUSY while one is active', async () => {
  const s = await mkSong('ZZZPLK five');
  let release;
  const gate = new Promise((r) => { release = r; });
  const f = fake({ apple: null });
  const slow = f.deezerByIsrc;
  f.deezerByIsrc = async (...a) => { await gate; return slow(...a); };
  const { runId } = await pl.startRun(pool, { songIds: [s], adapters: f, gaps: GAPS });
  await assert.rejects(pl.startRun(pool, { songIds: [s], adapters: f, gaps: GAPS }), { code: 'BUSY' });
  assert.equal(pl.getRun(runId).state, 'running');
  release();
  await pl.waitForRun(runId);
  assert.deepEqual((await rows(s)).map((x) => x.platform), ['deezer']);
  const again = await pl.startRun(pool, { songIds: [s], adapters: fake(), gaps: GAPS });
  await pl.waitForRun(again.runId);
});

test('reviewLink confirms or rejects only a proposed link', async () => {
  const s = await mkSong('ZZZPLK six');
  await pool.query(`INSERT INTO song_platform_links (song_id, platform, url, status, source, match_title) VALUES ($1,'apple_music','https://music.apple.com/x/1','proposed','search','t')`, [s]);
  const done = await pl.reviewLink(pool, s, 'apple_music', { action: 'confirm' });
  assert.equal(done.status, 'confirmed');
  await assert.rejects(pl.reviewLink(pool, s, 'apple_music', { action: 'reject' }), { code: 'BAD_INPUT' });
  await assert.rejects(pl.reviewLink(pool, s, 'deezer', { action: 'confirm' }), { code: 'NOT_FOUND' });
  await assert.rejects(pl.reviewLink(pool, s, 'apple_music', { action: 'maybe' }), { code: 'BAD_INPUT' });
  await assert.rejects(pl.reviewLink(pool, s, 'spotify', { action: 'confirm' }), { code: 'BAD_INPUT' });

  const t = await mkSong('ZZZPLK six b');
  await pool.query(`INSERT INTO song_platform_links (song_id, platform, url, status, source) VALUES ($1,'apple_music','https://music.apple.com/x/2','proposed','search')`, [t]);
  assert.equal((await pl.reviewLink(pool, t, 'apple_music', { action: 'reject' })).status, 'rejected');
});

test('publicLinks serves confirmed rows only, in a fixed order; linksForSong shows every status', async () => {
  const s = await mkSong('ZZZPLK seven');
  await pool.query(`INSERT INTO song_platform_links (song_id, platform, url, status, source) VALUES
    ($1,'deezer','https://www.deezer.com/track/9','confirmed','isrc'),
    ($1,'tidal','https://tidal.com/track/9','confirmed','search'),
    ($1,'apple_music','https://music.apple.com/x/9','proposed','search')`, [s]);
  assert.deepEqual(await pl.publicLinks(pool, s), [{ platform: 'deezer', url: 'https://www.deezer.com/track/9' }, { platform: 'tidal', url: 'https://tidal.com/track/9' }]);
  await pool.query(`UPDATE song_platform_links SET status='confirmed' WHERE song_id=$1 AND platform='apple_music'`, [s]);
  assert.deepEqual((await pl.publicLinks(pool, s)).map((x) => x.platform), ['apple_music', 'deezer', 'tidal']);
  assert.equal((await pl.linksForSong(pool, s)).length, 3);
});

test('counts reports the proposed links and the confirmed ones per platform', async () => {
  const c = await pl.counts(pool);
  assert.ok(Number.isInteger(c.proposed));
  assert.deepEqual(Object.keys(c.confirmed).sort(), ['apple_music', 'deezer', 'tidal']);
});
