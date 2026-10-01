# YouTube Assist (Sub-project D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the workbench Video panel, search YouTube for a song, tick several real candidates, set each one's type, and add them in one action.

**Architecture:** A new focused `backend/services/youtubeSearch.js` talks to the official YouTube Data API v3 (`search.list` + `videos.list`), with `fetch` injectable for tests; `services/videos.js` gains a transactional `addVideos` that reuses `addVideo` (so the one-primary invariant holds). Two new authed routes in `routes/admin.js` expose search and bulk-add. `VideoPanel.jsx` gains a "Find videos" results list. No migration.

**Tech Stack:** Node/Express + `pg` + built-in `fetch`, `node:test` (`npm test` in `backend/`), React 19 + Vite (frontend), Puppeteer (smoke, scratchpad only).

**Spec:** [`docs/superpowers/specs/2026-10-01-D-youtube-assist-design.md`](../specs/2026-10-01-D-youtube-assist-design.md)

## Global Constraints

- The API key is read from `process.env.YOUTUBE_API_KEY` (already in `backend/.env`; git-ignored). **It must never appear in a log line, an error message, a response body, or the frontend.** The request URL contains it, so errors/logs carry only the HTTP status and Google's `reason` — never the URL, never a fetch error's `.cause`/message.
- Search cost is ~101 quota units (`search.list` 100 + `videos.list` 1) of 10,000/day. **Automated tests never touch the network** (`fetchImpl` is mocked). Only the final live smoke makes **one** real search.
- `suggested_type` ∈ the existing `VIDEO_TYPES` (`official`, `live`, `lyric`, `fan-made`, `other`); precedence **lyric → live → official → other**; `fan-made` is never guessed.
- Bulk add: 1–10 items, **one transaction**, a `youtube_id` already on the song (or repeated within the batch) is **skipped, not an error**, an invalid item aborts the whole batch, the first video on an empty song becomes primary.
- No key → `{ configured: false }` with no network call. Quota → HTTP **429** `{ error:'quota' }`; upstream failure/timeout → **502**. Never a bare 500 for these.
- Styling uses `--bg-*` / `--text-*` / `--space-*` tokens and existing workbench classes; no raw colours.
- Backend test files use a **unique fixture prefix** (`ZZZYT`; the existing `videos.test.js` keeps `ZZZVID`). Tests run with `--test-concurrency=1` (already in `npm test`).
- **Never** put smoke/temp scripts in `backend/` (nodemon restarts the server mid-test). Run them from the scratchpad with absolute requires. **Never** `taskkill /IM node.exe`; target specific PIDs.
- `git add` **explicit paths only** — the untracked `backend/docs/` and `docs/examples/` must stay untracked. Write commit messages to a file and use `git commit -F <file>`; run git from the repo root. End each commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- The curated dataset must not be touched: tests/smoke only create and delete `ZZZ…` rows, and the smoke removes every video it adds.

## Review Focus

1. **The API key leaking** into a thrown error, a `console` line or a response when Google returns an error or the fetch itself throws. (Task 1 tests.)
2. **Quota exhausted / key missing / Google down / timeout** — expected: a clear message in the panel, never a blank panel or a bare 500. (Task 1 + Task 3.)
3. **A video the song already has** (already_added in search; the same id twice, or already on the song, in a bulk batch) — expected: skipped, no duplicate row. (Task 1 + Task 2 tests.)
4. **Prev/Next while a search is in flight, or switching songs with results open** — expected: the old song's results never show on the new song. (Task 3.)
5. **Titles with HTML entities (`Guns N&#39; Roses`, `&amp;`) and a candidate missing from the details response** — expected: decoded titles; the candidate kept with unknown duration/embeddability. (Task 1 tests.)

---

### Task 1: YouTube search service

**Files:**
- Create: `backend/services/youtubeSearch.js`
- Create: `backend/test/youtubeSearch.test.js`

**Interfaces:**
- Produces (used by Task 2):
  - `guessType(title, channel) → 'lyric'|'live'|'official'|'other'`
  - `formatDuration(iso) → string|null`
  - `decodeEntities(s) → string`
  - `searchVideos(query, { fetchImpl?, apiKey? }) → Promise<{ configured: boolean, candidates: Array<{ youtube_id, title, channel, thumbnail, duration, embeddable, suggested_type }> }>` — throws `Error` with `.code` `'QUOTA'` or `'UPSTREAM'`.
  - `findCandidatesForSong(db, songId, opts) → Promise<{ configured, query, candidates: Array<…, already_added: boolean> }>` — throws `.code` `'NOT_FOUND'` for an unknown song, plus the codes above.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/youtubeSearch.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`): `node --test --test-concurrency=1 test/youtubeSearch.test.js`
Expected: FAIL — `Cannot find module '../services/youtubeSearch'`.

- [ ] **Step 3: Implement the service**

Create `backend/services/youtubeSearch.js`:

```js
// YouTube candidate search for the workbench Video panel (sub-project D).
// Official YouTube Data API v3. `fetch` is injectable so tests never touch the network.
// SECURITY: the request URL contains the API key, so nothing here may log or rethrow a URL,
// a fetch error's message, or its `.cause` — only the HTTP status and Google's `reason`.
const API = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 8000;
const MAX_RESULTS = 8;

function coded(code, message) { const e = new Error(message); e.code = code; return e; }

const NAMED = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
function decodeEntities(s) {
  return String(s ?? '').replace(/&(?:#(\d+)|#x([0-9a-f]+)|[a-z]+);/gi, (m, dec, hex) => {
    if (dec || hex) {
      const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[m.toLowerCase()] ?? m;
  });
}

// ISO-8601 duration -> "m:ss" / "h:mm:ss"; null when absent/unparseable (e.g. live streams: "P0D").
function formatDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const h = +(m[1] || 0), min = +(m[2] || 0), s = +(m[3] || 0);
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(min).padStart(2, '0')}:${ss}` : `${min}:${ss}`;
}

// First match wins: lyric -> live -> official -> other. `fan-made` is never guessed.
function guessType(title, channel) {
  const t = String(title || '').toLowerCase(), c = String(channel || '').toLowerCase();
  if (/\blyrics?\b/.test(t)) return 'lyric';
  if (/\blive\b|\bconcert\b/.test(t)) return 'live';
  if (/\bofficial\b/.test(t) || /- topic$/.test(c) || /vevo$/.test(c)) return 'official';
  return 'other';
}

async function callApi(fetchImpl, path, params) {
  let res;
  try {
    res = await fetchImpl(`${API}/${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw coded('UPSTREAM', 'could not reach YouTube'); // deliberately drops the error: its message/cause can hold the URL
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || 'unknown';
    console.warn(`youtube api ${path} failed: HTTP ${res.status} (${reason})`);
    const quota = reason === 'quotaExceeded' || reason === 'dailyLimitExceeded';
    throw coded(quota ? 'QUOTA' : 'UPSTREAM', `YouTube API error (HTTP ${res.status})`);
  }
  return body || {};
}

async function searchVideos(query, { fetchImpl = fetch, apiKey = process.env.YOUTUBE_API_KEY } = {}) {
  if (!apiKey) return { configured: false, candidates: [] };
  const s = await callApi(fetchImpl, 'search', {
    part: 'snippet', type: 'video', maxResults: String(MAX_RESULTS), q: query, key: apiKey,
  });
  const items = (s.items || []).filter(i => i.id && i.id.videoId);
  if (!items.length) return { configured: true, candidates: [] };
  const d = await callApi(fetchImpl, 'videos', {
    part: 'contentDetails,status', id: items.map(i => i.id.videoId).join(','), key: apiKey,
  });
  const byId = new Map((d.items || []).map(v => [v.id, v]));
  const candidates = items.map(i => {
    const id = i.id.videoId;
    const title = decodeEntities(i.snippet?.title);
    const channel = decodeEntities(i.snippet?.channelTitle);
    const det = byId.get(id);
    return {
      youtube_id: id,
      title,
      channel,
      thumbnail: i.snippet?.thumbnails?.medium?.url || `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
      duration: det ? formatDuration(det.contentDetails?.duration) : null,
      embeddable: det && typeof det.status?.embeddable === 'boolean' ? det.status.embeddable : null,
      suggested_type: guessType(title, channel),
    };
  });
  return { configured: true, candidates };
}

// The workbench entry point: query = "<artists> <title>", and each candidate is flagged when the
// song already has that video.
async function findCandidatesForSong(db, songId, opts = {}) {
  const song = (await db.query(`
    SELECT s.title, COALESCE(string_agg(DISTINCT a.name, ' '), '') AS artists
    FROM songs s
    LEFT JOIN song_artists sa ON sa.song_id = s.id
    LEFT JOIN artists a ON a.id = sa.artist_id
    WHERE s.id = $1
    GROUP BY s.id`, [songId])).rows[0];
  if (!song) throw coded('NOT_FOUND', 'song not found');
  const query = `${song.artists} ${song.title}`.trim();
  const result = await searchVideos(query, opts);
  const have = new Set((await db.query('SELECT youtube_id FROM youtube_videos WHERE song_id=$1', [songId]))
    .rows.map(r => r.youtube_id));
  return {
    configured: result.configured,
    query,
    candidates: result.candidates.map(c => ({ ...c, already_added: have.has(c.youtube_id) })),
  };
}

module.exports = { guessType, formatDuration, decodeEntities, searchVideos, findCandidatesForSong };
```

- [ ] **Step 4: Run to verify it passes**

Run (from `backend/`): `node --test --test-concurrency=1 test/youtubeSearch.test.js`
Expected: 13 tests PASS, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add backend/services/youtubeSearch.js backend/test/youtubeSearch.test.js
# write message to a scratchpad file, then:
git commit -F <msgfile>   # "feat(youtube): YouTube candidate search service (official API, injectable fetch, key never leaks)"
```

---

### Task 2: Bulk add, routes, mock removal

**Files:**
- Modify: `backend/services/videos.js` (add `addVideos`, export it)
- Modify: `backend/test/videos.test.js` (append bulk tests; keeps prefix `ZZZVID`)
- Modify: `backend/routes/admin.js` (require + two routes after the existing `POST /workbench/:id/videos`)
- Modify: `backend/routes/youtube.js` (delete the mock `POST /search` handler)
- Modify: `backend/.env.example` (add `YOUTUBE_API_KEY=`)

**Interfaces:**
- Consumes: `videos.addVideo(db, songId, { youtube_id, video_title, video_type })`; `youtubeSearch.findCandidatesForSong` from Task 1.
- Produces (used by Task 3):
  - `videos.addVideos(pool, songId, items) → Promise<{ added: Array<row>, skipped: string[] }>` — throws `.code` `'BAD_INPUT'` (not an array, 0 or >10 items, or any invalid item — whole batch rolled back) or `'NOT_FOUND'`.
  - `GET  /api/admin/workbench/:id/video-search` → `{ success:true, configured, query, candidates:[{ youtube_id, title, channel, thumbnail, duration, embeddable, suggested_type, already_added }] }`; 404 unknown song; 429 `{ error:'quota', message }`; 502 `{ error:'upstream', message }`.
  - `POST /api/admin/workbench/:id/videos/bulk` body `{ videos:[{ youtube_id, video_title?, video_type }] }` → `{ success:true, added:[...], skipped:[...] }`; 400 on `BAD_INPUT`; 404 unknown song.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/videos.test.js` (it already defines `mkSong`, `primaries`, and cleans `ZZZVID%` songs):

```js
// --- bulk add (sub-project D) ---

test('addVideos: first video on an empty song is primary, the rest are not, all are added in order', async () => {
  const id = await mkSong('ZZZVID Bulk Empty');
  const r = await videos.addVideos(pool, id, [
    { youtube_id: 'aaaaaaaaaaa', video_title: 'One', video_type: 'official' },
    { youtube_id: 'bbbbbbbbbbb', video_title: 'Two', video_type: 'lyric' },
  ]);
  assert.deepEqual(r.added.map(v => v.youtube_id), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.deepEqual(r.skipped, []);
  const rows = await primaries(id);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(x => x.is_primary).length, 1, 'exactly one primary');
  assert.equal(r.added[0].is_primary, true);
});

test('addVideos leaves an existing primary alone', async () => {
  const id = await mkSong('ZZZVID Bulk HasPrimary');
  const first = await videos.addVideo(pool, id, { youtube_id: 'ccccccccccc', video_type: 'official' });
  await videos.addVideos(pool, id, [{ youtube_id: 'ddddddddddd', video_type: 'live' }]);
  const rows = await primaries(id);
  assert.equal(rows.find(x => x.id === first.id).is_primary, true);
  assert.equal(rows.filter(x => x.is_primary).length, 1);
});

test('addVideos skips a video the song already has, and a duplicate within the batch', async () => {
  const id = await mkSong('ZZZVID Bulk Dupes');
  await videos.addVideo(pool, id, { youtube_id: 'eeeeeeeeeee', video_type: 'official' });
  const r = await videos.addVideos(pool, id, [
    { youtube_id: 'eeeeeeeeeee', video_type: 'official' },   // already on the song
    { youtube_id: 'fffffffffff', video_type: 'live' },
    { youtube_id: 'fffffffffff', video_type: 'lyric' },       // repeated in the batch
  ]);
  assert.deepEqual(r.added.map(v => v.youtube_id), ['fffffffffff']);
  assert.deepEqual(r.skipped, ['eeeeeeeeeee', 'fffffffffff']);
  assert.equal((await primaries(id)).length, 2);
});

test('addVideos aborts the WHOLE batch when one item is invalid: nothing is inserted', async () => {
  const id = await mkSong('ZZZVID Bulk Atomic');
  await assert.rejects(() => videos.addVideos(pool, id, [
    { youtube_id: 'ggggggggggg', video_type: 'official' },
    { youtube_id: 'short', video_type: 'official' },
  ]), (e) => e.code === 'BAD_INPUT');
  assert.equal((await primaries(id)).length, 0);
});

test('addVideos rejects an invalid type, an empty batch, >10 items and a non-array; unknown song is NOT_FOUND', async () => {
  const id = await mkSong('ZZZVID Bulk Bad');
  await assert.rejects(() => videos.addVideos(pool, id, [{ youtube_id: 'hhhhhhhhhhh', video_type: 'nonsense' }]), (e) => e.code === 'BAD_INPUT');
  await assert.rejects(() => videos.addVideos(pool, id, []), (e) => e.code === 'BAD_INPUT');
  await assert.rejects(() => videos.addVideos(pool, id, undefined), (e) => e.code === 'BAD_INPUT');
  const eleven = Array.from({ length: 11 }, (_, i) => ({ youtube_id: String(i).padStart(11, 'x'), video_type: 'other' }));
  await assert.rejects(() => videos.addVideos(pool, id, eleven), (e) => e.code === 'BAD_INPUT');
  await assert.rejects(() => videos.addVideos(pool, 999999999, [{ youtube_id: 'iiiiiiiiiii', video_type: 'other' }]), (e) => e.code === 'NOT_FOUND');
  assert.equal((await primaries(id)).length, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`): `node --test --test-concurrency=1 test/videos.test.js`
Expected: FAIL — `videos.addVideos is not a function` (the 5 new tests fail; the 3 old ones still pass).

- [ ] **Step 3: Implement `addVideos`**

In `backend/services/videos.js`, add before `module.exports`:

```js
// Bulk add for the workbench "Find videos" picker. One transaction through addVideo (so the
// one-primary invariant and the first-video-is-primary rule hold). A youtube_id the song already
// has — or repeated inside the batch — is skipped, not an error; any invalid item rolls the
// whole batch back.
async function addVideos(pool, songId, items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 10) {
    const e = new Error('videos must be an array of 1-10 items'); e.code = 'BAD_INPUT'; throw e;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if ((await client.query('SELECT 1 FROM songs WHERE id=$1', [songId])).rows.length === 0) {
      const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e;
    }
    const have = new Set((await client.query('SELECT youtube_id FROM youtube_videos WHERE song_id=$1', [songId]))
      .rows.map(r => r.youtube_id));
    const added = [], skipped = [];
    for (const item of items) {
      const id = item && item.youtube_id;
      if (have.has(id)) { skipped.push(id); continue; }
      added.push(await addVideo(client, songId, item));
      have.add(id);
    }
    await client.query('COMMIT');
    return { added, skipped };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

and change the export to `module.exports = { VIDEO_TYPES, addVideo, addVideos, updateVideo, setPrimaryVideo, deleteVideo };`

- [ ] **Step 4: Run to verify it passes**

Run (from `backend/`): `node --test --test-concurrency=1 test/videos.test.js`
Expected: 8 tests PASS.

- [ ] **Step 5: Add the routes, remove the mock, update `.env.example`**

In `backend/routes/admin.js` add `const youtubeSearch = require('../services/youtubeSearch');` beside the other service requires, and insert directly **after** the existing `router.post('/workbench/:id/videos', …)` handler:

```js
// YouTube assist (sub-project D): search real candidates, then add several at once.
router.get('/workbench/:id/video-search', async (req, res) => {
  try {
    res.json({ success: true, ...(await youtubeSearch.findCandidatesForSong(pool, parseInt(req.params.id))) });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    if (e.code === 'QUOTA') return res.status(429).json({ error: 'quota', message: "Today's YouTube search quota is used up" });
    if (e.code === 'UPSTREAM') return res.status(502).json({ error: 'upstream', message: 'YouTube search is unavailable right now' });
    console.error('video search error:', e.message); // message only: never the request URL (it holds the key)
    res.status(500).json({ error: 'Failed to search YouTube' });
  }
});
router.post('/workbench/:id/videos/bulk', async (req, res) => {
  try {
    const out = await videos.addVideos(pool, parseInt(req.params.id), (req.body || {}).videos);
    res.json({ success: true, ...out });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    console.error('bulk add videos error:', e);
    res.status(500).json({ error: 'Failed to add videos', details: e.message });
  }
});
```

In `backend/routes/youtube.js` delete the whole `// Search YouTube for videos based on song info` block, i.e. `router.post('/search', …)` through its closing `});` (about lines 163–245; stop before `// Get songs that need YouTube videos`). Nothing in `frontend/src` or `backend` calls it (verified 2026-10-01).

In `backend/.env.example` append:

```
# YouTube Data API v3 key (workbench "Find videos"); search is disabled when unset
YOUTUBE_API_KEY=
```

- [ ] **Step 6: Run the full backend suite and a route smoke**

Run (from `backend/`): `npm test`
Expected: all pass (previous 200 + 13 youtubeSearch + 5 videos = 218).

Then confirm the routes load in the running nodemon backend (do not restart it by hand; check the process tree first if it is not picking up changes) and answer correctly **without spending quota** — `bad-id` and an empty batch never reach Google:

```bash
PW=$(grep '^ADMIN_PASSWORD' backend/.env | cut -d= -f2 | tr -d '\r')
curl -s -o /dev/null -w "unknown song: %{http_code}\n" -H "X-Admin-Password: $PW" http://localhost:5000/api/admin/workbench/999999999/video-search      # expect 404
curl -s -o /dev/null -w "empty bulk: %{http_code}\n" -X POST -H "X-Admin-Password: $PW" -H "Content-Type: application/json" -d '{"videos":[]}' http://localhost:5000/api/admin/workbench/1/videos/bulk   # expect 400
curl -s -o /dev/null -w "mock removed: %{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"query":"x"}' http://localhost:5000/api/youtube/search   # expect 404
```

- [ ] **Step 7: Commit**

```bash
git add backend/services/videos.js backend/test/videos.test.js backend/routes/admin.js backend/routes/youtube.js backend/.env.example
git commit -F <msgfile>   # "feat(youtube): bulk add + workbench video-search routes; remove the dead mock search"
```

---

### Task 3: Frontend — Find videos in the Video panel

**Files:**
- Modify: `frontend/src/components/admin/VideoPanel.jsx`
- Modify: `frontend/src/styles/admin.css` (append `wb-vsearch-*` rules)

**Interfaces:**
- Consumes: the two routes from Task 2; `adminFetch(path, { method, body })`; the `wb`, `id`, `reload` props `Workbench` already passes.
- Produces: nothing for later tasks.

- [ ] **Step 1: Replace `VideoPanel.jsx`'s imports and state, and add the search handlers**

Change the first import line to `import { useEffect, useRef, useState } from 'react';`. Inside `VideoPanel`, directly after the existing `const [status, setStatus] = useState('idle');` add:

```jsx
  // "Find videos": candidates from the YouTube API. Cleared whenever the song changes, and a response
  // for a song the curator has already navigated away from is ignored.
  const [results, setResults] = useState(null);     // null | candidate[]
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState('');
  const [ticked, setTicked] = useState({});         // { [youtube_id]: true }
  const [types, setTypes] = useState({});           // { [youtube_id]: chosen type }
  const [adding, setAdding] = useState(false);
  const idRef = useRef(id);
  useEffect(() => {
    idRef.current = id;
    setResults(null); setSearching(false); setSearchMsg(''); setTicked({}); setTypes({}); setAdding(false);
  }, [id]);

  const find = async () => {
    const forId = id;
    setSearching(true); setSearchMsg(''); setResults(null); setTicked({}); setTypes({});
    try {
      const r = await adminFetch(`/api/admin/workbench/${forId}/video-search`);
      const d = await r.json().catch(() => ({}));
      if (idRef.current !== forId) return;
      if (r.status === 429) setSearchMsg("Today's YouTube search quota is used up — try again tomorrow, or paste a URL below.");
      else if (!r.ok) setSearchMsg(d.message || d.error || 'Search failed');
      else if (!d.configured) setSearchMsg("YouTube search isn't configured — add YOUTUBE_API_KEY to backend/.env. You can still paste a URL below.");
      else if (!d.candidates || d.candidates.length === 0) setSearchMsg('No results — try Search YouTube.');
      else setResults(d.candidates);
    } catch {
      if (idRef.current === forId) setSearchMsg('Request failed');
    } finally {
      if (idRef.current === forId) setSearching(false);
    }
  };

  const toggle = (yid) => setTicked((t) => {
    const next = { ...t };
    if (next[yid]) delete next[yid]; else next[yid] = true;
    return next;
  });

  const tickedCount = (results || []).filter((c) => ticked[c.youtube_id] && !c.already_added).length;

  const addSelected = async () => {
    const forId = id;
    const picks = (results || [])
      .filter((c) => ticked[c.youtube_id] && !c.already_added)
      .map((c) => ({ youtube_id: c.youtube_id, video_title: c.title, video_type: types[c.youtube_id] || c.suggested_type }));
    if (picks.length === 0) return;
    setAdding(true); setSearchMsg(''); setStatus('saving');
    try {
      const r = await adminFetch(`/api/admin/workbench/${forId}/videos/bulk`, { method: 'POST', body: { videos: picks } });
      if (idRef.current !== forId) return;
      if (r.ok) { setResults(null); setTicked({}); setTypes({}); setStatus('saved'); reload(); }
      else {
        const d = await r.json().catch(() => ({}));
        setSearchMsg(d.error || 'Add failed');
        setStatus('error');
      }
    } catch {
      if (idRef.current === forId) { setSearchMsg('Request failed'); setStatus('error'); }
    } finally {
      if (idRef.current === forId) setAdding(false);
    }
  };
```

- [ ] **Step 2: Add the button and the results list to the JSX**

Replace the `wb-quicklinks` block with:

```jsx
      <div className="wb-quicklinks">
        <span className="wb-field-label">Find a video:</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={find} disabled={searching}>
          {searching ? 'Searching…' : 'Find videos'}
        </button>
        <a className="btn btn-secondary btn-sm" href={ytSearch} target="_blank" rel="noreferrer">Search YouTube</a>
      </div>

      {searchMsg && <div className="modal-result">{searchMsg}</div>}
      {results && (
        <div className="wb-vsearch">
          <ul className="wb-vsearch-list">
            {results.map((c) => (
              <li key={c.youtube_id} className={`wb-vsearch-row${c.already_added ? ' is-added' : ''}`}>
                <input type="checkbox" aria-label={`Select ${c.title}`}
                  checked={!!ticked[c.youtube_id] && !c.already_added}
                  disabled={c.already_added} onChange={() => toggle(c.youtube_id)} />
                <img className="wb-vsearch-thumb" src={c.thumbnail} alt="" loading="lazy" />
                <span className="wb-vsearch-meta">
                  <span className="wb-vsearch-title">{c.title}</span>
                  <span className="wb-vsearch-sub">
                    {c.channel}{c.duration ? ` · ${c.duration}` : ''}
                    {' · '}<a href={`https://www.youtube.com/watch?v=${c.youtube_id}`} target="_blank" rel="noreferrer">Preview</a>
                  </span>
                  {c.already_added && <span className="wb-vsearch-note">Already added</span>}
                  {c.embeddable === false && <span className="wb-vsearch-note warn">Won’t embed on the site</span>}
                </span>
                <select className="select" aria-label={`Type for ${c.title}`} disabled={c.already_added}
                  value={types[c.youtube_id] || c.suggested_type}
                  onChange={(e) => setTypes((t) => ({ ...t, [c.youtube_id]: e.target.value }))}>
                  {VIDEO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </li>
            ))}
          </ul>
          <div className="wb-vsearch-footer">
            <button type="button" className="btn btn-primary btn-sm" disabled={tickedCount === 0 || adding} onClick={addSelected}>
              {adding ? 'Adding…' : `Add ${tickedCount} selected`}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setResults(null); setTicked({}); setTypes({}); }}>Close</button>
          </div>
        </div>
      )}
```

(The `Search YouTube` link keeps its existing `ytSearch` variable. `searchMsg` also carries a failed bulk-add message, which is intended.)

- [ ] **Step 3: Append the styles to `frontend/src/styles/admin.css`**

```css
/* Find videos (sub-project D) */
.wb-vsearch { border: 1px solid var(--border-hairline); border-radius: var(--radius-md); margin-bottom: var(--space-3); background: var(--bg-surface); }
.wb-vsearch-list { list-style: none; margin: 0; padding: 0; }
.wb-vsearch-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border-hairline); }
.wb-vsearch-row.is-added { opacity: 0.55; }
.wb-vsearch-thumb { width: 96px; height: 54px; object-fit: cover; border-radius: var(--radius-sm); flex-shrink: 0; background: var(--bg-surface-raised); }
.wb-vsearch-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 0.85rem; }
.wb-vsearch-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.wb-vsearch-sub { color: var(--text-muted); font-size: 0.78rem; }
.wb-vsearch-note { font-size: 0.72rem; color: var(--text-muted); }
.wb-vsearch-note.warn { color: var(--accent-ember-60); }
.wb-vsearch-footer { display: flex; gap: var(--space-2); padding: var(--space-2) var(--space-3); }
@media (max-width: 600px) {
  .wb-vsearch-row { flex-wrap: wrap; }
  .wb-vsearch-thumb { width: 72px; height: 40px; }
}
```

- [ ] **Step 4: Lint and build**

Run (from `frontend/`): `npm run lint && npm run build`
Expected: 0 errors (the 6 existing warnings only), build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/VideoPanel.jsx frontend/src/styles/admin.css
git commit -F <msgfile>   # "feat(youtube): Find videos picker in the workbench Video panel (multi-select, per-row type)"
```

---

### Task 4: Live smoke, docs, push

**Files:**
- Create (scratchpad only, never committed): `smoke-youtube.cjs`
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `CLAUDE.md`, `docs/PRD.md` (only if its feature inventory mentions YouTube search)

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Check the running stack**

Confirm `:5000` (backend) and `:5173` (Vite) are listening and that the backend has the new routes (the Task 2 curl checks returning 404/400/404 is that proof). Do not claim a restart is needed without checking the process tree. Puppeteer is already installed in the scratchpad.

- [ ] **Step 2: Write and run `smoke-youtube.cjs` (scratchpad)**

The admin login is **client-side state — a reload logs out** — so after `goto('/admin')` and logging in with the password from `backend/.env`, navigate only by clicking. `process.chdir('<repo>/backend')` before requiring `<repo>/backend/database/db.js` (it loads `.env` from the cwd), and run the script from the scratchpad. It must:

1. Pick a **live song with no video** from the DB (`status='included' AND published=true` and no `youtube_videos` row) and remember its id; record `max(id)` of `youtube_videos` as the baseline.
2. Log in; click **Songs**; click the **Needs video** queue; click the row for that song (search it by title if it is not first) to open the workbench.
3. **Stubbed states first (no quota):** with request interception on, answer the next `video-search` with `429 {"error":"quota"}` → click **Find videos** → assert the "quota is used up" text; then answer `200 {"success":true,"configured":false,…}` → assert the "isn't configured" text; then answer `200` with two canned candidates, one `already_added:true` and one `embeddable:false` → assert the "Already added" label, a disabled checkbox on it, and the "Won’t embed" warning. Turn interception off.
4. **One real search (~101 units):** click **Find videos** → assert ≥ 3 candidate rows with a non-empty title and an `https://` thumbnail, and that every type dropdown's value is one of the five valid types.
5. Tick the first two rows, change the second row's type to `lyric`, assert the footer reads **Add 2 selected**, click it.
6. Assert the panel list now shows 2 videos, the DB has exactly 2 new `youtube_videos` rows for that song (id > baseline), **exactly one `is_primary`**, and the second row's `video_type` is `lyric`.
7. Navigate Prev/Next away and back is not required; instead assert the panel shows **no** results list after the add (it closed).
8. Narrow to 390px and assert no horizontal page scroll with a results list open (re-run **Find videos** with the stubbed canned candidates for this one, to spend no more quota).
9. **Cleanup in a `finally`:** `DELETE FROM youtube_videos WHERE song_id=$1 AND id > $2` (the baseline), then verify the song's video count is back to 0 and **no other song's videos changed** (compare `count(*)` of `youtube_videos` with the count taken at the start).

Expected: every check prints PASS and the final line is `N/N checks passed`. If a check fails, diagnose the cause (systematic-debugging); do not weaken the assertion. Print the number of search calls made — it must be exactly **one real call**.

- [ ] **Step 3: Docs (End-Session Guide)**

- `docs/PROJECT_STATE.md`: advance Current session to D built; refresh Next Tasks (E, F remain); add a Changelog entry and Decision-Log entries for (a) the official API with a curator-owned key, (b) multi-select with a guessed-but-editable type, (c) bulk add is all-or-nothing with duplicates skipped, (d) the key-never-leaks rule, (e) the deleted mock route. Record the verified numbers: backend total, lint, build size, smoke result and the number of real search calls (quota spent).
- `docs/PROJECT_PLAN.md`: mark D ☑/◐ (◐ until the curator's smoke).
- `CLAUDE.md`: add a `services/youtubeSearch.js` bullet (official API, injectable fetch, key never logged/rethrown, `searchVideos`/`findCandidatesForSong`, bulk `videos.addVideos`) beside `services/inbox.js`; add `YOUTUBE_API_KEY` to the Environment Setup block (optional — search disabled when unset); note the deleted mock `POST /api/youtube/search` in the `youtube.js` mention.
- `docs/PRD.md` §11 only if it lists YouTube search; `docs/FEATURE_INVENTORY.md` if it lists the mock search.

- [ ] **Step 4: Final gates, commit and push**

Run: `cd backend && npm test`, `cd frontend && npm run lint && npm run build` — report the actual numbers. Then:

```bash
git add CLAUDE.md docs/PROJECT_STATE.md docs/PROJECT_PLAN.md docs/PRD.md docs/FEATURE_INVENTORY.md   # only those that changed
git commit -F <msgfile>   # "docs: record sub-project D (YouTube assist)"
git push -u origin <branch>
```

Report the smoke result honestly — including any check that was skipped or failed.
