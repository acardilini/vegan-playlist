const { test, after, mock } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const yt = require('../services/youtubeSearch');

// Unique fixture sentinel for this file: ZZZYT. No test touches the network: fetch is injected.
const KEY = 'ZZZYT-SECRET-KEY-123';

after(async () => {
  await pool.query(`DELETE FROM youtube_videos WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZYT%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZYT%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZYT%'`);
  await pool.end();
});

// A fake fetch: routes by URL path, records the calls, returns Response-like objects.
function fakeFetch({ search, videos, status = 200, throws = null }) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    if (throws) throw throws;
    const body = String(url).includes('/search?') ? search : videos;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}
const hit = (id, title, channel = 'Some Channel') => ({
  id: { videoId: id }, snippet: { title, channelTitle: channel, thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mq.jpg` } } },
});
const detail = (id, duration, embeddable = true) => ({ id, contentDetails: { duration }, status: { embeddable } });

test('guessType: precedence lyric > live > official > other, case-insensitive', () => {
  assert.equal(yt.guessType('Song (Official Lyric Video)', 'X'), 'lyric');
  assert.equal(yt.guessType('Song LYRICS', 'X'), 'lyric');
  assert.equal(yt.guessType('Song - Live at Wembley', 'X'), 'live');
  assert.equal(yt.guessType('Song (Official Video)', 'X'), 'official');
  assert.equal(yt.guessType('Song', 'Artist - Topic'), 'official');
  assert.equal(yt.guessType('Song', 'ArtistVEVO'), 'official');
  assert.equal(yt.guessType('Song cover by a fan', 'Fan'), 'other');
  assert.equal(yt.guessType('', ''), 'other');
  assert.equal(yt.guessType(undefined, undefined), 'other');
});

test('guessType: "live" must be a whole word ("Alive" is not live)', () => {
  assert.equal(yt.guessType('Alive and Well', 'X'), 'other');
});

test('decodeEntities handles named, decimal and hex entities and leaves unknowns alone', () => {
  assert.equal(yt.decodeEntities('Guns N&#39; Roses &amp; Co &quot;hi&quot;'), `Guns N' Roses & Co "hi"`);
  assert.equal(yt.decodeEntities('caf&#xe9;'), 'café');
  assert.equal(yt.decodeEntities('a &unknown; b'), 'a &unknown; b');
  assert.equal(yt.decodeEntities('&#99999999999;'), '&#99999999999;');
  assert.equal(yt.decodeEntities(undefined), '');
});

test('formatDuration', () => {
  assert.equal(yt.formatDuration('PT3M34S'), '3:34');
  assert.equal(yt.formatDuration('PT1H2M3S'), '1:02:03');
  assert.equal(yt.formatDuration('PT45S'), '0:45');
  assert.equal(yt.formatDuration('PT10M'), '10:00');
  assert.equal(yt.formatDuration('P0D'), null);   // live streams
  assert.equal(yt.formatDuration(undefined), null);
});

test('searchVideos with no key returns configured:false and never calls fetch', async () => {
  const f = fakeFetch({});
  const r = await yt.searchVideos('anything', { fetchImpl: f, apiKey: '' });
  assert.deepEqual(r, { configured: false, candidates: [] });
  assert.equal(f.calls.length, 0);
});

test('searchVideos maps candidates in API order, decodes titles, keeps a video missing from the details', async () => {
  const f = fakeFetch({
    search: { items: [hit('aaaaaaaaaaa', 'Guns N&#39; Roses - Song (Official Video)', 'GunsNRosesVEVO'), hit('bbbbbbbbbbb', 'Song lyrics'), hit('ccccccccccc', 'Song live')] },
    videos: { items: [detail('aaaaaaaaaaa', 'PT3M34S'), detail('bbbbbbbbbbb', 'PT4M', false)] },   // ccc… missing
  });
  const r = await yt.searchVideos('guns song', { fetchImpl: f, apiKey: KEY });
  assert.equal(r.configured, true);
  assert.deepEqual(r.candidates.map(c => c.youtube_id), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
  assert.equal(r.candidates[0].title, `Guns N' Roses - Song (Official Video)`);
  assert.equal(r.candidates[0].duration, '3:34');
  assert.equal(r.candidates[0].embeddable, true);
  assert.equal(r.candidates[0].suggested_type, 'official');
  assert.equal(r.candidates[1].embeddable, false);
  assert.equal(r.candidates[1].suggested_type, 'lyric');
  assert.equal(r.candidates[2].duration, null);
  assert.equal(r.candidates[2].embeddable, null);
  assert.equal(r.candidates[2].suggested_type, 'live');
  assert.match(r.candidates[0].thumbnail, /^https:\/\//);
  assert.equal(f.calls.length, 2, 'one search + one details call');
});

test('searchVideos with zero hits makes no details call', async () => {
  const f = fakeFetch({ search: { items: [] }, videos: { items: [] } });
  const r = await yt.searchVideos('nothing', { fetchImpl: f, apiKey: KEY });
  assert.deepEqual(r, { configured: true, candidates: [] });
  assert.equal(f.calls.length, 1);
});

test('a quota error maps to code QUOTA; the key is in neither the error nor any log line', async () => {
  const warn = mock.method(console, 'warn', () => {});
  const err = mock.method(console, 'error', () => {});
  try {
    const f = fakeFetch({ status: 403, search: { error: { message: `quota key=${KEY}`, errors: [{ reason: 'quotaExceeded' }] } } });
    await assert.rejects(() => yt.searchVideos('q', { fetchImpl: f, apiKey: KEY }), (e) => {
      assert.equal(e.code, 'QUOTA');
      assert.ok(!String(e.message).includes(KEY) && !String(e.stack).includes(KEY));
      return true;
    });
    const logged = JSON.stringify([...warn.mock.calls, ...err.mock.calls]);
    assert.ok(!logged.includes(KEY), 'key must not be logged');
  } finally { warn.mock.restore(); err.mock.restore(); }
});

test('a non-quota HTTP error maps to UPSTREAM', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    const f = fakeFetch({ status: 500, search: { error: { errors: [{ reason: 'backendError' }] } } });
    await assert.rejects(() => yt.searchVideos('q', { fetchImpl: f, apiKey: KEY }), (e) => e.code === 'UPSTREAM');
  } finally { warn.mock.restore(); }
});

test('a fetch that throws (network/timeout) maps to UPSTREAM and the thrown message/cause never reaches the caller', async () => {
  const f = fakeFetch({ throws: Object.assign(new Error(`failed https://x/search?key=${KEY}`), { cause: new Error(KEY) }) });
  await assert.rejects(() => yt.searchVideos('q', { fetchImpl: f, apiKey: KEY }), (e) => {
    assert.equal(e.code, 'UPSTREAM');
    assert.ok(!String(e.message).includes(KEY) && !String(e.stack).includes(KEY) && e.cause === undefined);
    return true;
  });
});

async function mkSong(title, artist) {
  const s = (await pool.query(`INSERT INTO songs (title, status, data_source) VALUES ($1,'pending','manual') RETURNING id`, [title])).rows[0];
  const a = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [artist])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  return s.id;
}

test('findCandidatesForSong builds "<artists> <title>" and flags videos the song already has', async () => {
  const id = await mkSong('ZZZYT Find Song', 'ZZZYT Find Artist');
  await pool.query(`INSERT INTO youtube_videos (song_id, youtube_id, video_type, is_primary) VALUES ($1,'aaaaaaaaaaa','official',true)`, [id]);
  const f = fakeFetch({
    search: { items: [hit('aaaaaaaaaaa', 'Have it'), hit('bbbbbbbbbbb', 'New one')] },
    videos: { items: [detail('aaaaaaaaaaa', 'PT3M'), detail('bbbbbbbbbbb', 'PT3M')] },
  });
  const r = await yt.findCandidatesForSong(pool, id, { fetchImpl: f, apiKey: KEY });
  assert.equal(r.query, 'ZZZYT Find Artist ZZZYT Find Song');
  assert.ok(f.calls[0].includes(encodeURIComponent('ZZZYT Find Artist ZZZYT Find Song')) || f.calls[0].includes('ZZZYT+Find+Artist'));
  assert.deepEqual(r.candidates.map(c => [c.youtube_id, c.already_added]), [['aaaaaaaaaaa', true], ['bbbbbbbbbbb', false]]);
});

test('findCandidatesForSong on an unknown song throws NOT_FOUND before any network call', async () => {
  const f = fakeFetch({});
  await assert.rejects(() => yt.findCandidatesForSong(pool, 999999999, { fetchImpl: f, apiKey: KEY }), (e) => e.code === 'NOT_FOUND');
  assert.equal(f.calls.length, 0);
});

test('findCandidatesForSong with no key reports configured:false (and still no network call)', async () => {
  const id = await mkSong('ZZZYT NoKey Song', 'ZZZYT NoKey Artist');
  const f = fakeFetch({});
  const r = await yt.findCandidatesForSong(pool, id, { fetchImpl: f, apiKey: '' });
  assert.equal(r.configured, false);
  assert.deepEqual(r.candidates, []);
  assert.equal(f.calls.length, 0);
});

test('findCandidatesForSong uses the FIRST-listed artist only: a collaboration joined into one query finds nothing', async () => {
  // insert order, not alphabetical order, decides who is first ("ZZZYT Zed" before "ZZZYT Alpha")
  const s = (await pool.query(`INSERT INTO songs (title, status, data_source) VALUES ('ZZZYT Multi Song','pending','manual') RETURNING id`)).rows[0];
  for (const name of ['ZZZYT Zed Artist', 'ZZZYT Alpha Artist']) {
    const a = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [name])).rows[0];
    await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  }
  const f = fakeFetch({ search: { items: [] }, videos: { items: [] } });
  const r = await yt.findCandidatesForSong(pool, s.id, { fetchImpl: f, apiKey: KEY });
  assert.equal(r.query, 'ZZZYT Zed Artist ZZZYT Multi Song');
});

test('findCandidatesForSong for a song with no artist searches by title alone', async () => {
  const s = (await pool.query(`INSERT INTO songs (title, status, data_source) VALUES ('ZZZYT Orphan Song','pending','manual') RETURNING id`)).rows[0];
  const f = fakeFetch({ search: { items: [] }, videos: { items: [] } });
  const r = await yt.findCandidatesForSong(pool, s.id, { fetchImpl: f, apiKey: KEY });
  assert.equal(r.query, 'ZZZYT Orphan Song');
});

// --- review fixes (final whole-branch review) ---

test('a bad/disabled key maps to CONFIG, not UPSTREAM, so the curator is told to fix the key', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    for (const [status, reason] of [[400, 'keyInvalid'], [403, 'accessNotConfigured'], [403, 'ipRefererBlocked'], [403, 'forbidden'], [400, 'badRequest']]) {
      const f = fakeFetch({ status, search: { error: { errors: [{ reason }], message: `secret ${KEY}` } } });
      await assert.rejects(() => yt.searchVideos('q', { fetchImpl: f, apiKey: KEY }), (e) => {
        assert.equal(e.code, 'CONFIG', `${status} ${reason}`);
        assert.ok(!String(e.message).includes(KEY));
        return true;
      });
    }
  } finally { warn.mock.restore(); }
});

test('quota and a plain 5xx are still QUOTA / UPSTREAM (CONFIG must not swallow them)', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    await assert.rejects(() => yt.searchVideos('q', { fetchImpl: fakeFetch({ status: 403, search: { error: { errors: [{ reason: 'quotaExceeded' }] } } }), apiKey: KEY }), (e) => e.code === 'QUOTA');
    await assert.rejects(() => yt.searchVideos('q', { fetchImpl: fakeFetch({ status: 503, search: { error: { errors: [{ reason: 'backendError' }] } } }), apiKey: KEY }), (e) => e.code === 'UPSTREAM');
  } finally { warn.mock.restore(); }
});
