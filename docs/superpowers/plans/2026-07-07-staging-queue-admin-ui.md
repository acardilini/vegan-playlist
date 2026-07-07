# Staging-Queue Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a curator-only "Staging" admin screen (To process / To finalise / Live / Add candidates) plus the endpoints that drive it, so the publication pipeline can be worked in-app and the source spreadsheets retired.

**Architecture:** Backend logic lives in a new testable service module (`backend/services/staging.js`); thin route handlers in `backend/routes/admin.js` call it, mirroring the 1.2b publish/unpublish handlers. The frontend is a new isolated `StagingQueue.jsx` component mounted as one new tab in `AdminInterface.jsx` (no queue logic added to the monolith). Tests use Node 22's built-in `node:test` (zero new dependencies) against disposable DB rows.

**Tech Stack:** Node/Express, PostgreSQL (`pg`), React/Vite, `spotify-web-api-node` (via existing `utils/playlistSync.js`), `node:test`.

## Global Constraints

- **Admin auth:** every new endpoint sits behind the existing `x-admin-password` middleware; the frontend sends header `X-Admin-Password: import.meta.env.VITE_ADMIN_PASSWORD`. `API_BASE = 'http://localhost:5000/api/admin'`.
- **Truth-source rules:** intake is import-only/additive (new rows = `status='pending'`, unpublished); `include`/`reject` touch only `status` (+ coupled `published` clear on reject); `publish`/`unpublish` touch only `published`; Spotify attach writes **only enrichment-class fields**, never curatorial ones.
- **Constraint:** `songs_published_check` = `(NOT published OR status='included')` must never be violated — set `published=false` in the same statement as any move away from `included`.
- **Public/enrichment conventions:** always `LEFT JOIN albums` (non-Spotify songs have no album row). **No route or query may ever SELECT `song_lyrics`.**
- **Artwork test (matches migration 002):** artwork present ⇔ `al.images IS NOT NULL AND al.images::text NOT IN ('null','[]','')`.
- **Play-link test:** present ⇔ `spotify_url` OR `bandcamp_url` OR `soundcloud_url` OR a `youtube_videos` row exists.
- Tests require the local Postgres running and `backend/.env` present; they create rows with the sentinel prefix `ZZZTEST` and delete them in an `after()` hook.

---

## File Structure

- **Create** `backend/services/staging.js` — all queue/transition/intake logic as functions taking `db` (the pool or a client) first, for testability.
- **Create** `backend/test/staging.test.js` — `node:test` suite against disposable rows.
- **Modify** `backend/package.json` — set `"test": "node --test"`.
- **Modify** `backend/routes/admin.js` — add 6 thin route handlers near the publish/unpublish block (~line 2849).
- **Create** `frontend/src/components/StagingQueue.jsx` — the four-view component.
- **Modify** `frontend/src/components/AdminInterface.jsx` — add the "Staging" tab button + conditional render + import.

Interfaces produced by `backend/services/staging.js` (used by routes + tests):
- `listQueue(db, { queue, q?, limit?, offset? }) → { queue, total, rows[] }` where each row = `{ id, title, artists, status, published, has_art, has_play_link, play_link_kinds[], missing? }` (`missing` only for `to-finalise`). Throws `Error` with `.code` in `{ 'BAD_QUEUE','Q_REQUIRED' }`.
- `includeSong(db, id, { publish? }) → { id, title, status, published }` — throws `.code='NOT_FOUND'`.
- `rejectSong(db, id) → { id, title, status, published }` — throws `.code='NOT_FOUND'`.
- `setPlayLink(db, id, { bandcamp_url?, soundcloud_url? }) → { id, title, bandcamp_url, soundcloud_url }` — throws `.code` in `{ 'BAD_INPUT','NOT_FOUND' }`.
- `insertCandidates(db, tracks[]) → { added, skippedExisting }` (tracks in `fetchPlaylistTracks` shape).
- `resolveSpotifyUrls(urls[]) → { tracks[], invalid[] }` (network).
- `attachSpotifyToSong(db, id) → { matched:boolean, spotify_id? }` (network) — throws `.code='NOT_FOUND'`.
- `normalizeName(s) → string` (exported for tests).

---

### Task 1: Service module + `listQueue` (pending, to-finalise) with test harness

**Files:**
- Create: `backend/services/staging.js`
- Create: `backend/test/staging.test.js`
- Modify: `backend/package.json` (scripts.test)

**Interfaces:**
- Produces: `listQueue`, `normalizeName` (see File Structure).

- [ ] **Step 1: Set the test script**

In `backend/package.json` replace the `test` script line with:

```json
    "test": "node --test",
```

- [ ] **Step 2: Write the failing test**

Create `backend/test/staging.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const staging = require('../services/staging');

// --- disposable fixture helpers (sentinel prefix ZZZTEST) ---
async function mkAlbum(images = '[{"url":"http://example.com/a.jpg","height":640,"width":640}]') {
  return (await pool.query(
    `INSERT INTO albums (name, images, data_source) VALUES ('ZZZTEST Album', $1, 'manual') RETURNING id`, [images]
  )).rows[0].id;
}
async function mkSong({ title, status = 'pending', published = false, spotify_url = null,
  bandcamp_url = null, soundcloud_url = null, album_id = null, artist = 'ZZZTEST Artist' }) {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, spotify_url, bandcamp_url, soundcloud_url, album_id, data_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'manual') RETURNING id`,
    [title, status, published, spotify_url, bandcamp_url, soundcloud_url, album_id])).rows[0];
  const a = (await pool.query(
    `INSERT INTO artists (name, data_source) VALUES ($1, 'manual') RETURNING id`, [artist])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  return s.id;
}

after(async () => {
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZTEST%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZTEST%'`);
  await pool.query(`DELETE FROM albums WHERE name = 'ZZZTEST Album'`);
  await pool.end();
});

test('listQueue pending returns pending rows with presence flags', async () => {
  const albumId = await mkAlbum();
  const id = await mkSong({ title: 'ZZZTEST Pending Complete', status: 'pending', spotify_url: 'http://x', album_id: albumId });
  const { queue, rows } = await staging.listQueue(pool, { queue: 'pending' });
  assert.equal(queue, 'pending');
  const row = rows.find(r => r.id === id);
  assert.ok(row, 'inserted pending song present');
  assert.equal(row.has_art, true);
  assert.equal(row.has_play_link, true);
  assert.ok(row.play_link_kinds.includes('spotify'));
});

test('listQueue to-finalise annotates missing[]', async () => {
  const noArtNoLink = await mkSong({ title: 'ZZZTEST Finalise Bare', status: 'included', published: false });
  const { rows } = await staging.listQueue(pool, { queue: 'to-finalise' });
  const row = rows.find(r => r.id === noArtNoLink);
  assert.ok(row);
  assert.deepEqual(row.missing.sort(), ['artwork', 'play link']);
});

test('listQueue unknown queue throws BAD_QUEUE', async () => {
  await assert.rejects(() => staging.listQueue(pool, { queue: 'nope' }), (e) => e.code === 'BAD_QUEUE');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && node --test test/staging.test.js`
Expected: FAIL — `Cannot find module '../services/staging'`.

- [ ] **Step 4: Write minimal implementation**

Create `backend/services/staging.js`:

```js
// Staging-queue service. Functions take `db` (pool or client) first for testability.
const { getSpotifyClient, withRetry, fetchPlaylistTracks,
        addTracksAsPending, upsertAlbum, upsertArtist } = require('../utils/playlistSync');

function normalizeName(s) {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '').replace(/ - .*/, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

const ARTWORK_SQL = `(al.images IS NOT NULL AND al.images::text NOT IN ('null','[]',''))`;

async function listQueue(db, { queue, q = '', limit = null, offset = 0 } = {}) {
  let where;
  const params = [];
  if (queue === 'pending') where = `s.status = 'pending'`;
  else if (queue === 'to-finalise') where = `s.status = 'included' AND s.published = false`;
  else if (queue === 'live') {
    if (!q || !q.trim()) { const e = new Error('search term required for live queue'); e.code = 'Q_REQUIRED'; throw e; }
    where = `s.status = 'included' AND s.published = true`;
    params.push(`%${q.trim()}%`);
    where += ` AND (s.title ILIKE $${params.length} OR EXISTS (
      SELECT 1 FROM song_artists sa2 JOIN artists a2 ON a2.id = sa2.artist_id
      WHERE sa2.song_id = s.id AND a2.name ILIKE $${params.length}))`;
  } else { const e = new Error('unknown queue'); e.code = 'BAD_QUEUE'; throw e; }

  let sql = `
    SELECT s.id, s.title, s.status, s.published,
           s.spotify_url, s.bandcamp_url, s.soundcloud_url,
           ${ARTWORK_SQL} AS has_art,
           COALESCE(string_agg(DISTINCT a.name, ', '), '') AS artists,
           EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id = s.id) AS has_youtube
    FROM songs s
    LEFT JOIN albums al ON al.id = s.album_id
    LEFT JOIN song_artists sa ON sa.song_id = s.id
    LEFT JOIN artists a ON a.id = sa.artist_id
    WHERE ${where}
    GROUP BY s.id, al.images
    ORDER BY s.id`;
  if (limit) { params.push(limit); sql += ` LIMIT $${params.length}`; params.push(offset); sql += ` OFFSET $${params.length}`; }

  const rows = (await db.query(sql, params)).rows.map(r => {
    const kinds = [];
    if (r.spotify_url) kinds.push('spotify');
    if (r.bandcamp_url) kinds.push('bandcamp');
    if (r.soundcloud_url) kinds.push('soundcloud');
    if (r.has_youtube) kinds.push('youtube');
    const has_play_link = kinds.length > 0;
    const out = {
      id: r.id, title: r.title, artists: r.artists, status: r.status, published: r.published,
      has_art: r.has_art, has_play_link, play_link_kinds: kinds,
    };
    if (queue === 'to-finalise') {
      const missing = [];
      if (!has_play_link) missing.push('play link');
      if (!r.has_art) missing.push('artwork');
      out.missing = missing;
    }
    return out;
  });
  return { queue, total: rows.length, rows };
}

module.exports = { normalizeName, listQueue };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && node --test test/staging.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/services/staging.js backend/test/staging.test.js backend/package.json
git commit -m "feat(staging): listQueue service (pending/to-finalise) + node:test harness"
```

---

### Task 2: `listQueue` live search guard

**Files:**
- Modify: `backend/services/staging.js` (already handles live; add the guard test)
- Modify: `backend/test/staging.test.js`

**Interfaces:**
- Consumes: `listQueue` from Task 1.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/staging.test.js` (before the `after` is fine; order doesn't matter for `node:test`):

```js
test('listQueue live without q throws Q_REQUIRED', async () => {
  await assert.rejects(() => staging.listQueue(pool, { queue: 'live' }), (e) => e.code === 'Q_REQUIRED');
});

test('listQueue live with q finds published match, excludes pending', async () => {
  const liveId = await mkSong({ title: 'ZZZTEST LiveSong Zeta', status: 'included', published: true });
  const pendId = await mkSong({ title: 'ZZZTEST LiveSong Zeta Pending', status: 'pending' });
  const { rows } = await staging.listQueue(pool, { queue: 'live', q: 'ZZZTEST LiveSong Zeta' });
  const ids = rows.map(r => r.id);
  assert.ok(ids.includes(liveId), 'published match present');
  assert.ok(!ids.includes(pendId), 'pending excluded from live');
});
```

- [ ] **Step 2: Run tests to verify the new ones pass**

Run: `cd backend && node --test test/staging.test.js`
Expected: PASS (5 tests). The live logic already exists from Task 1; this task locks it with tests. If the guard test fails, ensure the `Q_REQUIRED` throw precedes the `where` assignment for `live`.

- [ ] **Step 3: Commit**

```bash
git add backend/test/staging.test.js
git commit -m "test(staging): cover live-queue search + q-required guard"
```

---

### Task 3: `includeSong` (+publish) and `rejectSong`

**Files:**
- Modify: `backend/services/staging.js`
- Modify: `backend/test/staging.test.js`

**Interfaces:**
- Produces: `includeSong(db, id, {publish})`, `rejectSong(db, id)`.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/staging.test.js`:

```js
test('includeSong moves pending -> included, stays unpublished', async () => {
  const id = await mkSong({ title: 'ZZZTEST Include A', status: 'pending' });
  const r = await staging.includeSong(pool, id, {});
  assert.equal(r.status, 'included');
  assert.equal(r.published, false);
});

test('includeSong {publish:true} includes and publishes', async () => {
  const id = await mkSong({ title: 'ZZZTEST Include B', status: 'pending' });
  const r = await staging.includeSong(pool, id, { publish: true });
  assert.equal(r.status, 'included');
  assert.equal(r.published, true);
});

test('rejectSong on a published row also unpublishes', async () => {
  const id = await mkSong({ title: 'ZZZTEST Reject A', status: 'included', published: true });
  const r = await staging.rejectSong(pool, id);
  assert.equal(r.status, 'rejected');
  assert.equal(r.published, false);
});

test('includeSong on missing id throws NOT_FOUND', async () => {
  await assert.rejects(() => staging.includeSong(pool, 999999999, {}), (e) => e.code === 'NOT_FOUND');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test test/staging.test.js`
Expected: FAIL — `staging.includeSong is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `backend/services/staging.js`, add before `module.exports`:

```js
async function includeSong(db, id, { publish = false } = {}) {
  const sql = publish
    ? `UPDATE songs SET status='included', published=true, published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 RETURNING id, title, status, published`
    : `UPDATE songs SET status='included', updated_at=CURRENT_TIMESTAMP
       WHERE id=$1 RETURNING id, title, status, published`;
  const r = await db.query(sql, [id]);
  if (r.rows.length === 0) { const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e; }
  return r.rows[0];
}

async function rejectSong(db, id) {
  const r = await db.query(
    `UPDATE songs SET status='rejected', published=false, published_at=NULL, updated_at=CURRENT_TIMESTAMP
     WHERE id=$1 RETURNING id, title, status, published`, [id]);
  if (r.rows.length === 0) { const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e; }
  return r.rows[0];
}
```

And extend the exports line:

```js
module.exports = { normalizeName, listQueue, includeSong, rejectSong };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test test/staging.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/staging.js backend/test/staging.test.js
git commit -m "feat(staging): includeSong (+publish) and rejectSong transitions"
```

---

### Task 4: `setPlayLink`

**Files:**
- Modify: `backend/services/staging.js`
- Modify: `backend/test/staging.test.js`

**Interfaces:**
- Produces: `setPlayLink(db, id, { bandcamp_url?, soundcloud_url? })`.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/staging.test.js`:

```js
test('setPlayLink sets bandcamp_url', async () => {
  const id = await mkSong({ title: 'ZZZTEST Link A', status: 'pending' });
  const r = await staging.setPlayLink(pool, id, { bandcamp_url: 'https://x.bandcamp.com/track/y' });
  assert.equal(r.bandcamp_url, 'https://x.bandcamp.com/track/y');
});

test('setPlayLink with no url throws BAD_INPUT', async () => {
  const id = await mkSong({ title: 'ZZZTEST Link B', status: 'pending' });
  await assert.rejects(() => staging.setPlayLink(pool, id, {}), (e) => e.code === 'BAD_INPUT');
});

test('setPlayLink with non-http url throws BAD_INPUT', async () => {
  const id = await mkSong({ title: 'ZZZTEST Link C', status: 'pending' });
  await assert.rejects(() => staging.setPlayLink(pool, id, { soundcloud_url: 'not-a-url' }), (e) => e.code === 'BAD_INPUT');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test test/staging.test.js`
Expected: FAIL — `staging.setPlayLink is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `backend/services/staging.js`, add before `module.exports`:

```js
async function setPlayLink(db, id, { bandcamp_url, soundcloud_url } = {}) {
  const provided = [['bandcamp_url', bandcamp_url], ['soundcloud_url', soundcloud_url]].filter(([, v]) => v != null && v !== '');
  if (provided.length === 0) { const e = new Error('a bandcamp_url or soundcloud_url is required'); e.code = 'BAD_INPUT'; throw e; }
  for (const [, v] of provided) {
    if (!/^https?:\/\//i.test(v)) { const e = new Error('play link must be an http(s) URL'); e.code = 'BAD_INPUT'; throw e; }
  }
  const params = [id];
  const sets = provided.map(([col, v]) => { params.push(v); return `${col}=$${params.length}`; });
  const r = await db.query(
    `UPDATE songs SET ${sets.join(', ')}, updated_at=CURRENT_TIMESTAMP
     WHERE id=$1 RETURNING id, title, bandcamp_url, soundcloud_url`, params);
  if (r.rows.length === 0) { const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e; }
  return r.rows[0];
}
```

Extend exports:

```js
module.exports = { normalizeName, listQueue, includeSong, rejectSong, setPlayLink };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test test/staging.test.js`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/staging.js backend/test/staging.test.js
git commit -m "feat(staging): setPlayLink for non-Spotify play links"
```

---

### Task 5: `insertCandidates` (dedupe + add-as-pending)

**Files:**
- Modify: `backend/services/staging.js`
- Modify: `backend/test/staging.test.js`

**Interfaces:**
- Consumes: `addTracksAsPending`, `upsertAlbum`, `upsertArtist` from `utils/playlistSync.js`.
- Produces: `insertCandidates(db, tracks[]) → { added, skippedExisting }`. `tracks` are in `fetchPlaylistTracks` shape: `{ spotify_id, title, ..., artists:[{spotify_id,name,spotify_url}], album:{...}|null, added_at? }`.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/staging.test.js`:

```js
test('insertCandidates adds new, skips existing spotify_id and title+artist dupes', async () => {
  // existing catalogue row with a known spotify_id + artist
  const dupSpotifyId = 'ZZZTESTSPOTIFYID000001';
  await pool.query(
    `INSERT INTO songs (title, status, spotify_id, data_source) VALUES ('ZZZTEST Existing By Id', 'included', $1, 'manual')`,
    [dupSpotifyId]);
  const existTitleId = await mkSong({ title: 'ZZZTEST Existing By Title', status: 'included', artist: 'ZZZTEST DupArtist' });

  const mkTrack = (sid, title, artist) => ({
    spotify_id: sid, title, duration_ms: 1000, popularity: 0, explicit: false,
    track_number: 1, disc_number: 1, spotify_url: 'http://x', added_at: null,
    artists: [{ spotify_id: sid + 'A', name: artist, spotify_url: 'http://a' }], album: null,
  });

  const tracks = [
    mkTrack(dupSpotifyId, 'ZZZTEST Existing By Id', 'ZZZTEST WhoeverArtist'),      // skip: spotify_id
    mkTrack('ZZZTESTSPOTIFYID000002', 'ZZZTEST Existing By Title', 'ZZZTEST DupArtist'), // skip: title+artist
    mkTrack('ZZZTESTSPOTIFYID000003', 'ZZZTEST Brand New Candidate', 'ZZZTEST NewArtist'), // add
  ];
  const res = await staging.insertCandidates(pool, tracks);
  assert.equal(res.added, 1);
  assert.equal(res.skippedExisting, 2);

  const check = await pool.query(`SELECT status FROM songs WHERE spotify_id = 'ZZZTESTSPOTIFYID000003'`);
  assert.equal(check.rows[0].status, 'pending');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test test/staging.test.js`
Expected: FAIL — `staging.insertCandidates is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `backend/services/staging.js`, add before `module.exports`:

```js
async function insertCandidates(db, tracks) {
  const existing = (await db.query(`
    SELECT s.spotify_id, s.title, COALESCE(string_agg(a.name, ', '), '') AS artists
    FROM songs s
    LEFT JOIN song_artists sa ON sa.song_id = s.id
    LEFT JOIN artists a ON a.id = sa.artist_id
    GROUP BY s.id`)).rows;
  const existingIds = new Set(existing.filter(e => e.spotify_id).map(e => e.spotify_id));
  const existingTA = new Set(existing.map(e => normalizeName(e.title) + '|' + normalizeName(e.artists)));

  const seenIds = new Set(), seenTA = new Set(), toAdd = [];
  let skippedExisting = 0;
  for (const t of tracks) {
    const ta = normalizeName(t.title) + '|' + normalizeName((t.artists || []).map(a => a.name).join(', '));
    if ((t.spotify_id && existingIds.has(t.spotify_id)) || existingTA.has(ta) ||
        (t.spotify_id && seenIds.has(t.spotify_id)) || seenTA.has(ta)) {
      skippedExisting++; continue;
    }
    if (t.spotify_id) seenIds.add(t.spotify_id);
    seenTA.add(ta);
    toAdd.push(t);
  }
  const added = await addTracksAsPending(db, toAdd, 'added as candidate via staging intake');
  return { added, skippedExisting };
}
```

Extend exports:

```js
module.exports = { normalizeName, listQueue, includeSong, rejectSong, setPlayLink, insertCandidates };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test test/staging.test.js`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/staging.js backend/test/staging.test.js
git commit -m "feat(staging): insertCandidates with spotify_id + title/artist dedupe"
```

---

### Task 6: Spotify-facing helpers — `resolveSpotifyUrls` + `attachSpotifyToSong`

These call the Spotify API (network), so they are verified by manual smoke rather than unit tests.

**Files:**
- Modify: `backend/services/staging.js`

**Interfaces:**
- Consumes: `getSpotifyClient`, `withRetry`, `fetchPlaylistTracks`, `upsertAlbum`, `upsertArtist` from `utils/playlistSync.js`.
- Produces: `resolveSpotifyUrls(urls[])`, `attachSpotifyToSong(db, id)`, `parseSpotifyRef(str)`.

- [ ] **Step 1: Write the implementation**

In `backend/services/staging.js`, add before `module.exports`:

```js
// 'https://open.spotify.com/track/ID', 'spotify:playlist:ID', or a bare 22-char id (assumed track)
function parseSpotifyRef(u) {
  const s = String(u).trim();
  const m = s.match(/(track|playlist)[/:]([A-Za-z0-9]{22})/);
  if (m) return { type: m[1], id: m[2] };
  if (/^[A-Za-z0-9]{22}$/.test(s)) return { type: 'track', id: s };
  return null;
}

// Shape a raw Spotify track object like fetchPlaylistTracks does (no added_at).
function mapTrack(t) {
  return {
    spotify_id: t.id, title: t.name, duration_ms: t.duration_ms, popularity: t.popularity,
    explicit: t.explicit, track_number: t.track_number, disc_number: t.disc_number,
    spotify_url: t.external_urls && t.external_urls.spotify, added_at: null,
    artists: (t.artists || []).map(a => ({ spotify_id: a.id, name: a.name, spotify_url: a.external_urls && a.external_urls.spotify })),
    album: t.album && t.album.id ? {
      spotify_id: t.album.id, name: t.album.name, images: t.album.images || [],
      release_date: t.album.release_date || null, total_tracks: t.album.total_tracks || null,
      album_type: t.album.album_type || null, spotify_url: t.album.external_urls && t.album.external_urls.spotify,
    } : null,
  };
}

async function resolveSpotifyUrls(urls) {
  const api = await getSpotifyClient();
  const refs = urls.map(parseSpotifyRef);
  const invalid = urls.filter((_, i) => !refs[i]);
  const trackIds = [], playlistIds = [];
  refs.forEach(r => { if (!r) return; (r.type === 'track' ? trackIds : playlistIds).push(r.id); });
  const tracks = [];
  for (let i = 0; i < trackIds.length; i += 50) {
    const batch = trackIds.slice(i, i + 50);
    const res = await withRetry(() => api.getTracks(batch));
    for (const t of res.body.tracks) if (t && t.id) tracks.push(mapTrack(t));
  }
  for (const pid of playlistIds) tracks.push(...await fetchPlaylistTracks(api, pid));
  return { tracks, invalid };
}

// Conservative single-song attach: normalised title AND artist must both match a Spotify hit.
async function attachSpotifyToSong(db, id) {
  const song = (await db.query('SELECT id, title FROM songs WHERE id=$1', [id])).rows[0];
  if (!song) { const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e; }
  const artists = (await db.query(
    'SELECT a.name FROM song_artists sa JOIN artists a ON a.id=sa.artist_id WHERE sa.song_id=$1', [id])).rows.map(r => r.name);
  const api = await getSpotifyClient();
  const res = await withRetry(() => api.searchTracks(`track:${song.title} artist:${artists[0] || ''}`, { limit: 10 }));
  const nt = normalizeName(song.title), na0 = normalizeName(artists[0] || '');
  const hit = (res.body.tracks.items || []).find(t =>
    normalizeName(t.name) === nt && t.artists.some(a => normalizeName(a.name) === na0));
  if (!hit) return { matched: false };
  const track = mapTrack(hit);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const albumId = await upsertAlbum(client, track.album);
    await client.query(`
      UPDATE songs SET spotify_id=$2, spotify_url=$3, album_id=COALESCE(album_id,$4),
        duration_ms=COALESCE(duration_ms,$5), popularity=$6, explicit=$7,
        track_number=COALESCE(track_number,$8), disc_number=COALESCE(disc_number,$9),
        updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
      [id, track.spotify_id, track.spotify_url, albumId, track.duration_ms, track.popularity,
       track.explicit, track.track_number, track.disc_number]);
    for (const a of track.artists) {
      const artistId = await upsertArtist(client, a);
      await client.query('INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2) ON CONFLICT (song_id, artist_id) DO NOTHING', [id, artistId]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  return { matched: true, spotify_id: track.spotify_id };
}
```

Extend exports:

```js
module.exports = {
  normalizeName, listQueue, includeSong, rejectSong, setPlayLink, insertCandidates,
  resolveSpotifyUrls, attachSpotifyToSong, parseSpotifyRef,
};
```

- [ ] **Step 2: Smoke-check the Spotify helpers against a disposable row**

Run (creates a manual-only song for a known Spotify track, attaches, then deletes it):

```bash
cd backend && node -e "
const pool=require('./database/db'); const s=require('./services/staging');
(async()=>{
  const a=(await pool.query(\"INSERT INTO artists (name,data_source) VALUES ('Ecostrike','manual') RETURNING id\")).rows[0].id;
  const id=(await pool.query(\"INSERT INTO songs (title,status,data_source) VALUES ('A Better Way','pending','manual') RETURNING id\")).rows[0].id;
  await pool.query('INSERT INTO song_artists (song_id,artist_id) VALUES (\$1,\$2)',[id,a]);
  console.log('attach:', await s.attachSpotifyToSong(pool,id));
  console.log('resolve:', (await s.resolveSpotifyUrls(['https://open.spotify.com/track/0gfe1CjEEZuNi3idzGMqMO'])).tracks.length, 'track(s)');
  await pool.query('DELETE FROM songs WHERE id=\$1',[id]);
  await pool.query('DELETE FROM artists WHERE id=\$1',[a]);
  await pool.end();
})().catch(e=>{console.error(e);process.exit(1);});
"
```

Expected: `attach: { matched: true, spotify_id: ... }` and `resolve: 1 track(s)`. (If Spotify rate-limits, re-run.)

- [ ] **Step 3: Commit**

```bash
git add backend/services/staging.js
git commit -m "feat(staging): resolveSpotifyUrls + single-song attachSpotifyToSong"
```

---

### Task 7: Route handlers in `admin.js`

**Files:**
- Modify: `backend/routes/admin.js` (insert before `module.exports = router;` at ~line 2851)

**Interfaces:**
- Consumes: all `staging.js` exports.

- [ ] **Step 1: Add the require at the top of `admin.js`**

Near the other requires at the top of `backend/routes/admin.js`, add:

```js
const staging = require('../services/staging');
```

- [ ] **Step 2: Add the handlers before `module.exports = router;`**

```js
// ---- Session 1.4 staging queue ----
router.get('/staging', async (req, res) => {
  try {
    const { queue, q, limit, offset } = req.query;
    const out = await staging.listQueue(pool, {
      queue, q: q || '', limit: limit ? parseInt(limit) : null, offset: offset ? parseInt(offset) : 0,
    });
    res.json(out);
  } catch (e) {
    if (e.code === 'BAD_QUEUE') return res.status(400).json({ error: 'Unknown queue' });
    if (e.code === 'Q_REQUIRED') return res.status(400).json({ error: 'A search term (q) is required for the live queue' });
    console.error('staging list error:', e);
    res.status(500).json({ error: 'Failed to list queue', details: e.message });
  }
});

router.post('/songs/:id/include', async (req, res) => {
  try {
    const song = await staging.includeSong(pool, parseInt(req.params.id), { publish: req.body && req.body.publish === true });
    res.json({ success: true, song, message: `Included${song.published ? ' & published' : ''}: ${song.title}` });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    console.error('include error:', e);
    res.status(500).json({ error: 'Failed to include song', details: e.message });
  }
});

router.post('/songs/:id/reject', async (req, res) => {
  try {
    const song = await staging.rejectSong(pool, parseInt(req.params.id));
    res.json({ success: true, song, message: `Rejected: ${song.title}` });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    console.error('reject error:', e);
    res.status(500).json({ error: 'Failed to reject song', details: e.message });
  }
});

router.post('/songs/:id/play-link', async (req, res) => {
  try {
    const song = await staging.setPlayLink(pool, parseInt(req.params.id), req.body || {});
    res.json({ success: true, song, message: `Play link saved: ${song.title}` });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    console.error('play-link error:', e);
    res.status(500).json({ error: 'Failed to save play link', details: e.message });
  }
});

router.post('/songs/:id/attach-spotify', async (req, res) => {
  try {
    const result = await staging.attachSpotifyToSong(pool, parseInt(req.params.id));
    res.json({ success: true, ...result });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    console.error('attach-spotify error:', e);
    res.status(500).json({ error: 'Failed to attach Spotify', details: e.message });
  }
});

router.post('/staging/candidates', async (req, res) => {
  try {
    const urls = (req.body && req.body.urls) || [];
    if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: 'Provide urls: [] (Spotify track/playlist URLs)' });
    const { tracks, invalid } = await staging.resolveSpotifyUrls(urls);
    const { added, skippedExisting } = await staging.insertCandidates(pool, tracks);
    res.json({ success: true, added, skippedExisting, invalid });
  } catch (e) {
    console.error('candidates error:', e);
    res.status(500).json({ error: 'Failed to import candidates', details: e.message });
  }
});
```

- [ ] **Step 3: Smoke-test the routes against a running server**

Start the server and exercise the read + a transition on a disposable row:

```bash
cd backend && node server.js > /tmp/vp.log 2>&1 &
sleep 4
PW=$(grep ADMIN_PASSWORD .env | cut -d= -f2)
echo "== pending count =="; curl -s -H "X-Admin-Password: $PW" "http://localhost:5000/api/admin/staging?queue=pending" | head -c 200
echo; echo "== live w/o q (expect 400) =="; curl -s -o /dev/null -w "%{http_code}\n" -H "X-Admin-Password: $PW" "http://localhost:5000/api/admin/staging?queue=live"
echo "== no auth (expect 401) =="; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5000/api/admin/staging?queue=pending"
kill %1
```

Expected: pending JSON with `"queue":"pending"`; live-without-q → `400`; no-auth → `401`.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat(staging): admin routes for queues, include/reject, play-link, attach, candidates"
```

---

### Task 8: `StagingQueue.jsx` component

**Files:**
- Create: `frontend/src/components/StagingQueue.jsx`

**Interfaces:**
- Consumes: the `/api/admin/staging*` and `/api/admin/songs/:id/*` endpoints from Task 7 (auth header `X-Admin-Password`).
- Produces: default-exported `<StagingQueue />` React component (no props; reads `VITE_ADMIN_PASSWORD` itself).

- [ ] **Step 1: Create the component**

Create `frontend/src/components/StagingQueue.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react';

const API_BASE = 'http://localhost:5000/api/admin';
const PW = import.meta.env.VITE_ADMIN_PASSWORD;
const auth = { 'X-Admin-Password': PW };
const authJson = { ...auth, 'Content-Type': 'application/json' };

const SUBVIEWS = [
  ['to-process', 'To process'],
  ['to-finalise', 'To finalise'],
  ['live', 'Live'],
  ['add', 'Add candidates'],
];
const QUEUE_PARAM = { 'to-process': 'pending', 'to-finalise': 'to-finalise', 'live': 'live' };

export default function StagingQueue() {
  const [view, setView] = useState('to-process');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [liveQ, setLiveQ] = useState('');

  const load = useCallback(async () => {
    if (view === 'add') return;
    const queue = QUEUE_PARAM[view];
    if (queue === 'live' && !liveQ.trim()) { setRows([]); setTotal(0); return; }
    setLoading(true);
    try {
      const qs = queue === 'live' ? `&q=${encodeURIComponent(liveQ.trim())}` : '';
      const r = await fetch(`${API_BASE}/staging?queue=${queue}${qs}`, { headers: auth });
      const data = await r.json();
      setRows(data.rows || []); setTotal(data.total || 0);
    } catch (e) { setMsg('Error loading queue'); setRows([]); } finally { setLoading(false); }
  }, [view, liveQ]);

  useEffect(() => { load(); }, [load]);

  async function act(url, body) {
    setMsg('');
    try {
      const r = await fetch(url, { method: 'POST', headers: authJson, body: body ? JSON.stringify(body) : undefined });
      const data = await r.json();
      if (!r.ok) { setMsg(data.error || 'Action failed'); return null; }
      setMsg(data.message || 'Done');
      await load();
      return data;
    } catch (e) { setMsg('Request failed'); return null; }
  }

  const include = (id, publish) => act(`${API_BASE}/songs/${id}/include`, { publish: !!publish });
  const reject = (id) => act(`${API_BASE}/songs/${id}/reject`);
  const publish = (id) => act(`${API_BASE}/songs/${id}/publish`);
  const unpublish = (id) => act(`${API_BASE}/songs/${id}/unpublish`);
  const attach = (id) => act(`${API_BASE}/songs/${id}/attach-spotify`);
  const addLink = (id) => {
    const url = window.prompt('Bandcamp or SoundCloud URL:');
    if (!url) return;
    const key = /soundcloud/i.test(url) ? 'soundcloud_url' : 'bandcamp_url';
    return act(`${API_BASE}/songs/${id}/play-link`, { [key]: url });
  };

  const badge = (ok, label) => (
    <span style={{ marginRight: 8, color: ok ? '#1a7f37' : '#b00', fontSize: 12 }}>{ok ? '✓' : '✗'} {label}</span>
  );

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {SUBVIEWS.map(([k, label]) => (
          <button key={k} onClick={() => { setView(k); setMsg(''); }}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc',
              background: view === k ? '#007bff' : '#fff', color: view === k ? '#fff' : '#333', cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>
      {msg && <div style={{ marginBottom: 10, padding: 8, background: '#f0f6ff', border: '1px solid #cfe0ff', borderRadius: 6 }}>{msg}</div>}

      {view === 'add' ? (
        <AddCandidates onDone={setMsg} />
      ) : (
        <>
          {view === 'live' && (
            <input value={liveQ} onChange={e => setLiveQ(e.target.value)} placeholder="Search published songs to unpublish…"
              style={{ padding: 8, width: 320, marginBottom: 12 }} />
          )}
          <div style={{ marginBottom: 8, color: '#555' }}>{loading ? 'Loading…' : `${total} song(s)`}</div>
          {rows.map(row => (
            <div key={row.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 10px', borderBottom: '1px solid #eee', gap: 10 }}>
              <div>
                <strong>{row.title}</strong> <span style={{ color: '#666' }}>— {row.artists}</span>
                <div style={{ marginTop: 4 }}>
                  {badge(row.has_play_link, row.play_link_kinds.join('/') || 'play link')}
                  {badge(row.has_art, 'artwork')}
                  {view === 'to-finalise' && row.missing && row.missing.length > 0 &&
                    <span style={{ color: '#b00', fontSize: 12 }}>⚠ missing: {row.missing.join(', ')}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {view !== 'live' && <button onClick={() => attach(row.id)}>Attach Spotify</button>}
                {view !== 'live' && <button onClick={() => addLink(row.id)}>Add play link</button>}
                {view === 'to-process' && <>
                  <button onClick={() => include(row.id, false)}>Include</button>
                  {row.has_play_link && row.has_art &&
                    <button onClick={() => include(row.id, true)} style={{ background: '#1a7f37', color: '#fff' }}>Include &amp; Publish</button>}
                  <button onClick={() => reject(row.id)} style={{ color: '#b00' }}>Reject</button>
                </>}
                {view === 'to-finalise' && <button onClick={() => publish(row.id)} style={{ background: '#1a7f37', color: '#fff' }}>Publish</button>}
                {view === 'live' && <button onClick={() => unpublish(row.id)}>Unpublish</button>}
              </div>
            </div>
          ))}
          {!loading && rows.length === 0 && view !== 'live' && <div style={{ color: '#888' }}>Queue empty 🎉</div>}
        </>
      )}
    </div>
  );
}

function AddCandidates({ onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function submit() {
    const urls = text.split('\n').map(s => s.trim()).filter(Boolean);
    if (urls.length === 0) return;
    setBusy(true); setResult(null);
    try {
      const r = await fetch(`${API_BASE}/staging/candidates`, { method: 'POST', headers: authJson, body: JSON.stringify({ urls }) });
      const data = await r.json();
      if (!r.ok) { onDone(data.error || 'Import failed'); return; }
      setResult(data);
      onDone(`Imported ${data.added} new, skipped ${data.skippedExisting} existing.`);
    } catch (e) { onDone('Import failed'); } finally { setBusy(false); }
  }

  return (
    <div>
      <p style={{ color: '#555' }}>Paste Spotify <strong>track</strong> or <strong>playlist</strong> URLs, one per line. New songs are imported as <em>pending</em>.</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={8} style={{ width: '100%', fontFamily: 'monospace' }}
        placeholder="https://open.spotify.com/track/…" />
      <div style={{ marginTop: 8 }}>
        <button onClick={submit} disabled={busy}>{busy ? 'Importing…' : 'Import'}</button>
      </div>
      {result && <pre style={{ marginTop: 10 }}>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/StagingQueue.jsx
git commit -m "feat(staging): StagingQueue component with four sub-views"
```

---

### Task 9: Mount the "Staging" tab in `AdminInterface.jsx`

**Files:**
- Modify: `frontend/src/components/AdminInterface.jsx`

**Interfaces:**
- Consumes: default export from `StagingQueue.jsx`.

- [ ] **Step 1: Import the component**

At the top of `frontend/src/components/AdminInterface.jsx` (with the other imports), add:

```jsx
import StagingQueue from './StagingQueue';
```

- [ ] **Step 2: Add the tab button**

Find the tab-button group (the `manage-songs` button is at ~line 919). Immediately after the opening `manage-songs` `<button>…</button>` block, add a new button mirroring the existing inline style:

```jsx
              <button
                className={`admin-tab ${activeTab === 'staging' ? 'active' : ''}`}
                onClick={() => setActiveTab('staging')}
                style={{
                  padding: '10px 20px', border: 'none', borderRadius: '5px', cursor: 'pointer',
                  backgroundColor: activeTab === 'staging' ? '#007bff' : '#fff',
                  color: activeTab === 'staging' ? '#fff' : '#333',
                }}
              >
                Staging
              </button>
```

- [ ] **Step 3: Render the component for the active tab**

Find where tab bodies render (each guarded by `activeTab === '<name>'`). Add, alongside the others:

```jsx
      {activeTab === 'staging' && <StagingQueue />}
```

- [ ] **Step 4: Verify in the browser**

```bash
cd backend && node server.js > /tmp/vp-be.log 2>&1 &
cd frontend && npm run dev > /tmp/vp-fe.log 2>&1 &
sleep 6
```

Open the admin page, enter the admin password, click the new **Staging** tab. Confirm: To process lists pending songs with ✓/✗ badges; To finalise shows `⚠ missing`; Live search returns published songs; Add candidates renders the textarea. Stop servers when done (`kill %1 %2` or the stop launcher).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminInterface.jsx
git commit -m "feat(staging): mount Staging tab in AdminInterface"
```

---

### Task 10: End-to-end smoke test + docs + session close

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`

- [ ] **Step 1: Full backend test run**

Run: `cd backend && npm test`
Expected: all `staging.test.js` tests PASS; no `ZZZTEST` rows left behind (the `after` hook cleans up — verify with `psql`/a quick query if desired).

- [ ] **Step 2: Manual end-to-end smoke (per PROJECT_PLAN 1.4)**

With both servers running and a fresh pre-smoke DB backup (`pg_dump -Fc`):
1. In **To process**, pick a real pending song → **Attach Spotify** (or **Add play link**) → **Include**. Confirm it leaves To process and appears in **To finalise**.
2. **Reject** a different pending song → confirm it disappears from To process (now `rejected`).
3. In **To finalise**, **Publish** one song → confirm public API shows it (`GET /api/spotify/songs/:id` → 200) and it moves to Live.
4. In **Live**, search that song → **Unpublish** → confirm public API 404s it again.
5. In **Add candidates**, paste 1–2 Spotify track URLs (one already in the catalogue, one new) → confirm `{ added:1, skippedExisting:1 }` and the new one appears in To process.
6. Restore intentional test changes if any were on real curated rows (or unpublish/re-publish to original state).

- [ ] **Step 3: Update docs**

In `docs/PROJECT_PLAN.md` mark Session 1.4 ☑ with a one-line result. In `docs/PROJECT_STATE.md` advance Current State (Phase 1 complete → Phase 2 next), refresh Next Tasks, add a Decision Log entry (lean-triage staging screen; `node:test` introduced) and a Changelog entry (endpoints + component + test counts + smoke result).

- [ ] **Step 4: Final commit**

```bash
git add docs/PROJECT_STATE.md docs/PROJECT_PLAN.md
git commit -m "Session 1.4: staging-queue admin UI — queues, intake, tests, docs"
git push
```

---

## Self-Review Notes

- **Spec coverage:** queues (Tasks 1–2, 8–9); include/reject/publish one-click (Tasks 3, 7, 8); attach-spotify (Tasks 6–8); play-link (Tasks 4, 7, 8); candidate intake + dedupe (Tasks 5–7, 8); auth + guardrails (Global Constraints, enforced in each task); testing (unit Tasks 1–5, network smoke Task 6, HTTP smoke Task 7, e2e Task 10). Live search-only + no browsable 1,341 list honoured (Task 1 `Q_REQUIRED`, Task 8 requires `liveQ`).
- **No new dependencies:** `node:test` + `fetch` are built into Node 22.14.
- **Type consistency:** row shape (`has_art`, `has_play_link`, `play_link_kinds`, `missing`) defined in Task 1 and consumed unchanged in Task 8; service signatures match the Interfaces blocks and the route handlers in Task 7.
- **Guardrail check:** no task selects `song_lyrics`; attach writes only enrichment fields; reject sets `published=false` in the same statement (CHECK-safe); intake is additive via `addTracksAsPending`.
