# Admin Workbench — A1: Data & Backend Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the database schema and admin API that the Curation Workbench UI (plans A2–A4) will consume — queue queries, a single "assemble everything for one song" read, and per-panel save endpoints — reusing the existing `staging.js` lifecycle service.

**Architecture:** A new `backend/services/curation.js` (db-first, mirroring `services/staging.js`) holds all workbench logic; a new `backend/services/videos.js` owns the `youtube_videos` one-primary invariant. Routes are added to `backend/routes/admin.js` under a new "Curation workbench" banner, all behind the existing `authenticateAdmin` middleware. Schema changes go in one migration file applied via psql. Tests are node:test in `backend/test/`, using the established `ZZZTEST` disposable-fixture pattern.

**Tech Stack:** Node/Express, PostgreSQL (`pg` pool via `backend/database/db.js`), node:test + node:assert.

**Spec:** [`docs/superpowers/specs/2026-07-12-admin-workbench-design.md`](../specs/2026-07-12-admin-workbench-design.md) — this plan implements §3 (state/queue model) and the backend half of §4/§6.

## Global Constraints

- **Local-only lyrics (copyright).** `song_lyrics.lyrics` and the new `song_lyrics.translation` must **never** be SELECTed by a public route. Only admin routes (behind `authenticateAdmin`) may return them. Excluded from prod dumps via `pg_dump --exclude-table-data=song_lyrics`.
- **Curatorial safety.** No endpoint here writes to Spotify or overwrites curatorial fields silently; all writes are explicit per-panel saves.
- **Service functions take `db` first** (pool or client) for testability — match `services/staging.js`.
- **Error codes → HTTP:** service throws `Error` with `e.code` in `{'NOT_FOUND','BAD_INPUT','BAD_QUEUE'}`; routes map to 404 / 400 / 400. Match the existing staging routes.
- **DB access:** `const pool = require('../database/db')` (module exports the pool directly).
- **Default analysis model:** `'gemma4:latest'` (from `docs/LYRICS_ANALYSIS_INTEGRATION.md`) — a controlled constant, never user input.
- **Migrations are SQL files** in `backend/database/migrations/`, applied via psql in numeric order (next number: `006`). No DDL-over-HTTP.
- **Work on a branch** `session-A1-workbench-backend` (not `main`). End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Windows/PowerShell note:** run git from the repo root; for multi-line commit messages use `git commit -F <file>` (long here-strings fail to parse in PS 5.1).

---

### Task 1: Migration 006 — schema

**Files:**
- Create: `backend/database/migrations/006_curation_workbench.sql`
- Test: `backend/test/migration006.test.js`

**Interfaces:**
- Consumes: existing `songs`, `song_lyrics` tables.
- Produces: table `song_processing(song_id PK, snooze_until DATE, park_reason VARCHAR(30) CHECK, lyrics_tried JSONB, processing_note TEXT, updated_at TIMESTAMP)`; column `songs.language VARCHAR(40)`; column `song_lyrics.translation TEXT`.

- [ ] **Step 1: Write the migration SQL**

Create `backend/database/migrations/006_curation_workbench.sql`:

```sql
-- Migration 006 — Curation workbench foundation (Sub-project A1)
-- Spec: docs/superpowers/specs/2026-07-12-admin-workbench-design.md §3
-- Additive only.

-- Non-derivable per-song curation workflow state (kept off the fat songs table).
CREATE TABLE IF NOT EXISTS song_processing (
  song_id         INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
  snooze_until    DATE,                       -- "remind me later"; NULL = not snoozed
  park_reason     VARCHAR(30)
     CHECK (park_reason IS NULL OR park_reason IN
            ('awaiting_community','needs_transcription','listened_unclear')),
  lyrics_tried    JSONB NOT NULL DEFAULT '[]', -- avenues exhausted e.g. ["google","genius"]
  processing_note TEXT,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Language the song is sung in (public catalogue metadata).
ALTER TABLE songs ADD COLUMN IF NOT EXISTS language VARCHAR(40);

-- Translation of the lyrics — copyright-sensitive, LOCAL ONLY (same rules as song_lyrics.lyrics).
ALTER TABLE song_lyrics ADD COLUMN IF NOT EXISTS translation TEXT;
```

- [ ] **Step 2: Apply the migration**

Run (adjust connection to match `backend/.env` `DATABASE_URL`):
```bash
psql "$DATABASE_URL" -f backend/database/migrations/006_curation_workbench.sql
```
Expected: `CREATE TABLE` / `ALTER TABLE` notices, no errors.

- [ ] **Step 3: Write a schema-verification test**

Create `backend/test/migration006.test.js`:
```js
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');

after(async () => { await pool.end(); });

test('song_processing table exists with expected columns', async () => {
  const cols = (await pool.query(`
    SELECT column_name FROM information_schema.columns WHERE table_name='song_processing'`)).rows.map(r => r.column_name);
  for (const c of ['song_id','snooze_until','park_reason','lyrics_tried','processing_note','updated_at']) {
    assert.ok(cols.includes(c), `missing column ${c}`);
  }
});

test('park_reason CHECK rejects an invalid value', async () => {
  await assert.rejects(
    pool.query(`INSERT INTO song_processing (song_id, park_reason) VALUES (-999, 'bogus')`),
    /check constraint|violates/i);
});

test('songs.language and song_lyrics.translation columns exist', async () => {
  const songCols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='songs'`)).rows.map(r => r.column_name);
  const lyricCols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='song_lyrics'`)).rows.map(r => r.column_name);
  assert.ok(songCols.includes('language'));
  assert.ok(lyricCols.includes('translation'));
});
```
*(The `-999` insert fails the CHECK before the FK is evaluated for the bogus value; either error message matches the assertion.)*

- [ ] **Step 4: Run the test**

Run: `node --test backend/test/migration006.test.js`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/database/migrations/006_curation_workbench.sql backend/test/migration006.test.js
git commit -F commit-msg.txt   # message: "feat(A1): migration 006 — song_processing, songs.language, song_lyrics.translation"
```

---

### Task 2: Processing state service + route

**Files:**
- Create: `backend/services/curation.js`
- Create: `backend/test/curation.test.js`
- Modify: `backend/routes/admin.js` (add require + "Curation workbench" banner + processing routes, before `module.exports`)

**Interfaces:**
- Produces:
  - `getProcessing(db, songId) -> { song_id, snooze_until, park_reason, lyrics_tried, processing_note }` (defaults when no row).
  - `setProcessing(db, songId, { snooze_until, park_reason, lyrics_tried, processing_note }) -> row` — upsert; throws `NOT_FOUND` / `BAD_INPUT`.
  - `PARK_REASONS`, `DEFAULT_MODEL` constants.
- Consumes: `pool`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/curation.test.js`:
```js
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const curation = require('../services/curation');

async function mkSong({ title, status = 'pending', published = false, spotify_url = null,
  bandcamp_url = null, album_id = null, artist = 'ZZZTEST Artist' }) {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, spotify_url, bandcamp_url, album_id, data_source)
     VALUES ($1,$2,$3,$4,$5,$6,'manual') RETURNING id`,
    [title, status, published, spotify_url, bandcamp_url, album_id])).rows[0];
  const a = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [artist])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  return s.id;
}

after(async () => {
  await pool.query(`DELETE FROM song_processing WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZTEST%')`);
  await pool.query(`DELETE FROM song_lyrics WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZTEST%')`);
  await pool.query(`DELETE FROM youtube_videos WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZTEST%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZTEST%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZTEST%'`);
  await pool.query(`DELETE FROM albums WHERE name = 'ZZZTEST Album'`);
  await pool.end();
});

test('getProcessing returns defaults when no row', async () => {
  const id = await mkSong({ title: 'ZZZTEST Proc Default' });
  const p = await curation.getProcessing(pool, id);
  assert.equal(p.snooze_until, null);
  assert.equal(p.park_reason, null);
  assert.deepEqual(p.lyrics_tried, []);
});

test('setProcessing upserts and validates park_reason', async () => {
  const id = await mkSong({ title: 'ZZZTEST Proc Set' });
  const r = await curation.setProcessing(pool, id, { park_reason: 'awaiting_community', lyrics_tried: ['google','genius'] });
  assert.equal(r.park_reason, 'awaiting_community');
  assert.deepEqual(r.lyrics_tried, ['google','genius']);
  await assert.rejects(curation.setProcessing(pool, id, { park_reason: 'bogus' }), e => e.code === 'BAD_INPUT');
});

test('setProcessing throws NOT_FOUND for missing song', async () => {
  await assert.rejects(curation.setProcessing(pool, -12345, { processing_note: 'x' }), e => e.code === 'NOT_FOUND');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test backend/test/curation.test.js`
Expected: FAIL — `Cannot find module '../services/curation'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/services/curation.js`:
```js
// Curation-workbench service. Functions take `db` (pool or client) first for testability.
// Mirrors services/staging.js conventions.
const DEFAULT_MODEL = 'gemma4:latest';
const PARK_REASONS = ['awaiting_community', 'needs_transcription', 'listened_unclear'];

async function getProcessing(db, songId) {
  const r = await db.query(
    `SELECT song_id, snooze_until, park_reason, lyrics_tried, processing_note
     FROM song_processing WHERE song_id=$1`, [songId]);
  return r.rows[0] || { song_id: songId, snooze_until: null, park_reason: null, lyrics_tried: [], processing_note: null };
}

async function setProcessing(db, songId, { snooze_until, park_reason, lyrics_tried, processing_note } = {}) {
  if ((await db.query('SELECT 1 FROM songs WHERE id=$1', [songId])).rows.length === 0) {
    const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e;
  }
  if (park_reason != null && park_reason !== '' && !PARK_REASONS.includes(park_reason)) {
    const e = new Error('invalid park_reason'); e.code = 'BAD_INPUT'; throw e;
  }
  const tried = lyrics_tried === undefined ? null : JSON.stringify(Array.isArray(lyrics_tried) ? lyrics_tried : []);
  const r = await db.query(`
    INSERT INTO song_processing (song_id, snooze_until, park_reason, lyrics_tried, processing_note, updated_at)
    VALUES ($1,$2,$3,COALESCE($4::jsonb,'[]'::jsonb),$5,CURRENT_TIMESTAMP)
    ON CONFLICT (song_id) DO UPDATE SET
      snooze_until    = EXCLUDED.snooze_until,
      park_reason     = EXCLUDED.park_reason,
      lyrics_tried    = COALESCE($4::jsonb, song_processing.lyrics_tried),
      processing_note = EXCLUDED.processing_note,
      updated_at      = CURRENT_TIMESTAMP
    RETURNING song_id, snooze_until, park_reason, lyrics_tried, processing_note`,
    [songId, snooze_until || null, (park_reason || null), tried, (processing_note ?? null)]);
  return r.rows[0];
}

module.exports = { DEFAULT_MODEL, PARK_REASONS, getProcessing, setProcessing };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test backend/test/curation.test.js`
Expected: 3 tests pass.

- [ ] **Step 5: Add the route and commit**

In `backend/routes/admin.js`, add near the top requires (after `const staging = require('../services/staging');`):
```js
const curation = require('../services/curation');
```
Immediately before `module.exports = router;` add:
```js
// ==================== Curation workbench (Sub-project A) ====================

router.put('/workbench/:id/processing', async (req, res) => {
  try {
    const row = await curation.setProcessing(pool, parseInt(req.params.id), req.body || {});
    res.json({ success: true, processing: row });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    console.error('processing save error:', e);
    res.status(500).json({ error: 'Failed to save processing state', details: e.message });
  }
});
```
Commit:
```bash
git add backend/services/curation.js backend/test/curation.test.js backend/routes/admin.js
git commit -F commit-msg.txt   # "feat(A1): song_processing service + /workbench/:id/processing route"
```

---

### Task 3: Derived queue queries + counts

**Files:**
- Modify: `backend/services/curation.js` (add queue functions to exports)
- Modify: `backend/test/curation.test.js` (add tests)
- Modify: `backend/routes/admin.js` (add `/curation/queue` + `/curation/counts` routes)

**Interfaces:**
- Consumes: `getProcessing` (Task 2), `DEFAULT_MODEL`.
- Produces:
  - `QUEUE_NAMES` — array of valid queue keys.
  - `listCurationQueue(db, { queue, q='', limit=null, offset=0 }) -> { queue, total, rows }` where each row is `{ id, title, artists, status, published, language, has_art, has_lyrics, has_youtube, has_play_link, play_link_kinds, snooze_until, park_reason, missing }`. Throws `BAD_QUEUE`.
  - `queueCounts(db) -> { 'to-process': n, 'awaiting-community': n, 'remind-later': n, 'needs-lyrics': n, 'needs-cover': n, 'needs-video': n, 'needs-analysis': n, 'to-finalise': n, inbox: n }`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/test/curation.test.js` (before the `after` hook is fine; node:test runs in order):
```js
test('listCurationQueue to-process excludes awaiting-community and future snoozed', async () => {
  const active = await mkSong({ title: 'ZZZTEST Q Active', status: 'pending' });
  const waiting = await mkSong({ title: 'ZZZTEST Q Waiting', status: 'pending' });
  const snoozed = await mkSong({ title: 'ZZZTEST Q Snoozed', status: 'pending' });
  await curation.setProcessing(pool, waiting, { park_reason: 'awaiting_community' });
  await curation.setProcessing(pool, snoozed, { snooze_until: '2999-01-01' });

  const ids = (await curation.listCurationQueue(pool, { queue: 'to-process' })).rows.map(r => r.id);
  assert.ok(ids.includes(active));
  assert.ok(!ids.includes(waiting), 'awaiting-community excluded from to-process');
  assert.ok(!ids.includes(snoozed), 'future-snoozed excluded from to-process');

  const wIds = (await curation.listCurationQueue(pool, { queue: 'awaiting-community' })).rows.map(r => r.id);
  assert.ok(wIds.includes(waiting));
  const rIds = (await curation.listCurationQueue(pool, { queue: 'remind-later' })).rows.map(r => r.id);
  assert.ok(rIds.includes(snoozed));
});

test('listCurationQueue needs-lyrics = included songs with no lyrics row', async () => {
  const missing = await mkSong({ title: 'ZZZTEST Q NoLyrics', status: 'included', published: true });
  const has = await mkSong({ title: 'ZZZTEST Q HasLyrics', status: 'included', published: true });
  await pool.query(`INSERT INTO song_lyrics (song_id, lyrics) VALUES ($1, 'la la')`, [has]);
  const ids = (await curation.listCurationQueue(pool, { queue: 'needs-lyrics' })).rows.map(r => r.id);
  assert.ok(ids.includes(missing));
  assert.ok(!ids.includes(has));
});

test('listCurationQueue unknown queue throws BAD_QUEUE', async () => {
  await assert.rejects(curation.listCurationQueue(pool, { queue: 'nope' }), e => e.code === 'BAD_QUEUE');
});

test('queueCounts returns a number for every queue key', async () => {
  const c = await curation.queueCounts(pool);
  for (const k of ['to-process','awaiting-community','remind-later','needs-lyrics','needs-cover','needs-video','needs-analysis','to-finalise','inbox']) {
    assert.equal(typeof c[k], 'number', `count for ${k}`);
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test backend/test/curation.test.js`
Expected: FAIL — `curation.listCurationQueue is not a function`.

- [ ] **Step 3: Implement the queue functions**

In `backend/services/curation.js`, add above `module.exports` and extend the exports:
```js
const ARTWORK_SQL = `(al.images IS NOT NULL AND al.images::text NOT IN ('null','[]',''))`;
const MODEL_LITERAL = `'${DEFAULT_MODEL.replace(/'/g, "''")}'`; // controlled constant, safe to inline
const QUEUE_NAMES = ['to-process','awaiting-community','remind-later','needs-lyrics',
  'needs-cover','needs-video','needs-analysis','to-finalise','live','all'];

function queueWhere(queue) {
  switch (queue) {
    case 'to-process':
      return `s.status='pending'
              AND sp.park_reason IS DISTINCT FROM 'awaiting_community'
              AND (sp.snooze_until IS NULL OR sp.snooze_until <= CURRENT_DATE)`;
    case 'awaiting-community':
      return `s.status='pending' AND sp.park_reason='awaiting_community'`;
    case 'remind-later':
      return `sp.snooze_until IS NOT NULL AND sp.snooze_until > CURRENT_DATE`;
    case 'needs-lyrics':
      return `s.status='included' AND NOT EXISTS (SELECT 1 FROM song_lyrics sl WHERE sl.song_id=s.id)`;
    case 'needs-cover':
      return `s.status='included' AND NOT ${ARTWORK_SQL}`;
    case 'needs-video':
      return `s.status='included' AND NOT EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id=s.id)`;
    case 'needs-analysis':
      return `s.status='included'
              AND EXISTS (SELECT 1 FROM song_lyrics sl WHERE sl.song_id=s.id)
              AND NOT EXISTS (SELECT 1 FROM song_lyric_analysis sa
                              WHERE sa.song_id=s.id AND sa.model_used=${MODEL_LITERAL})`;
    case 'to-finalise':
      return `s.status='included' AND s.published=false`;
    case 'live':
      return `s.status='included' AND s.published=true`;
    case 'all':
      return `TRUE`;
    default: { const e = new Error('unknown queue'); e.code = 'BAD_QUEUE'; throw e; }
  }
}

function mapQueueRow(r) {
  const kinds = [];
  if (r.spotify_url) kinds.push('spotify');
  if (r.bandcamp_url) kinds.push('bandcamp');
  if (r.soundcloud_url) kinds.push('soundcloud');
  if (r.has_youtube) kinds.push('youtube');
  const has_play_link = kinds.length > 0;
  const missing = [];
  if (!r.has_lyrics) missing.push('lyrics');
  if (!r.has_art) missing.push('cover');
  if (!r.has_youtube) missing.push('video');
  if (!has_play_link) missing.push('play link');
  return {
    id: r.id, title: r.title, artists: r.artists, status: r.status, published: r.published,
    language: r.language, has_art: r.has_art, has_lyrics: r.has_lyrics, has_youtube: r.has_youtube,
    has_play_link, play_link_kinds: kinds, snooze_until: r.snooze_until, park_reason: r.park_reason, missing,
  };
}

async function listCurationQueue(db, { queue, q = '', limit = null, offset = 0 } = {}) {
  const where = queueWhere(queue);
  const params = [];
  let searchClause = '';
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    searchClause = ` AND (s.title ILIKE $${params.length} OR EXISTS (
      SELECT 1 FROM song_artists sa2 JOIN artists a2 ON a2.id=sa2.artist_id
      WHERE sa2.song_id=s.id AND a2.name ILIKE $${params.length}))`;
  }
  let sql = `
    SELECT s.id, s.title, s.status, s.published, s.language,
           s.spotify_url, s.bandcamp_url, s.soundcloud_url,
           ${ARTWORK_SQL} AS has_art,
           COALESCE(string_agg(DISTINCT a.name, ', '), '') AS artists,
           EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id=s.id) AS has_youtube,
           EXISTS (SELECT 1 FROM song_lyrics sl WHERE sl.song_id=s.id) AS has_lyrics,
           sp.snooze_until, sp.park_reason
    FROM songs s
    LEFT JOIN albums al ON al.id=s.album_id
    LEFT JOIN song_processing sp ON sp.song_id=s.id
    LEFT JOIN song_artists sa ON sa.song_id=s.id
    LEFT JOIN artists a ON a.id=sa.artist_id
    WHERE (${where})${searchClause}
    GROUP BY s.id, al.images, sp.snooze_until, sp.park_reason
    ORDER BY s.id`;
  if (limit) { params.push(limit); sql += ` LIMIT $${params.length}`; params.push(offset); sql += ` OFFSET $${params.length}`; }
  const rows = (await db.query(sql, params)).rows.map(mapQueueRow);
  return { queue, total: rows.length, rows };
}

async function queueCounts(db) {
  const keys = ['to-process','awaiting-community','remind-later','needs-lyrics',
    'needs-cover','needs-video','needs-analysis','to-finalise'];
  const out = {};
  for (const queue of keys) {
    const r = await db.query(`
      SELECT COUNT(*)::int AS n FROM songs s
      LEFT JOIN albums al ON al.id=s.album_id
      LEFT JOIN song_processing sp ON sp.song_id=s.id
      WHERE (${queueWhere(queue)})`);
    out[queue] = r.rows[0].n;
  }
  // inbox = community submissions not yet bridged to a song (list/moderation is sub-project C)
  out.inbox = (await db.query(`SELECT COUNT(*)::int AS n FROM song_submissions WHERE existing_song_id IS NULL`)).rows[0].n;
  return out;
}
```
Update the `module.exports` line to:
```js
module.exports = { DEFAULT_MODEL, PARK_REASONS, QUEUE_NAMES,
  getProcessing, setProcessing, listCurationQueue, queueCounts };
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test backend/test/curation.test.js`
Expected: all tests pass (Task 2 + Task 3).

- [ ] **Step 5: Add routes and commit**

In `backend/routes/admin.js`, inside the "Curation workbench" banner, add:
```js
router.get('/curation/queue', async (req, res) => {
  try {
    const { queue, q, limit, offset } = req.query;
    const out = await curation.listCurationQueue(pool, {
      queue, q: q || '', limit: limit ? parseInt(limit) : null, offset: offset ? parseInt(offset) : 0,
    });
    res.json(out);
  } catch (e) {
    if (e.code === 'BAD_QUEUE') return res.status(400).json({ error: 'Unknown queue' });
    console.error('curation queue error:', e);
    res.status(500).json({ error: 'Failed to list queue', details: e.message });
  }
});

router.get('/curation/counts', async (req, res) => {
  try {
    res.json(await curation.queueCounts(pool));
  } catch (e) {
    console.error('curation counts error:', e);
    res.status(500).json({ error: 'Failed to load queue counts', details: e.message });
  }
});
```
Commit:
```bash
git add backend/services/curation.js backend/test/curation.test.js backend/routes/admin.js
git commit -F commit-msg.txt   # "feat(A1): derived curation queues + counts (/curation/queue, /curation/counts)"
```

---

### Task 4: Workbench assemble-read

**Files:**
- Modify: `backend/services/curation.js` (add `getWorkbench`)
- Modify: `backend/test/curation.test.js` (add tests)
- Modify: `backend/routes/admin.js` (add `GET /workbench/:id`)

**Interfaces:**
- Consumes: `getProcessing`, `DEFAULT_MODEL`.
- Produces: `getWorkbench(db, id) -> object` with keys: `id, title, status, published, language, spotify_id, spotify_url, bandcamp_url, soundcloud_url, lyrics_status, lyrics_url, lyrics_source, lyrics_highlights, status_notes, album{name,images,release_date}, artists[], videos[], lyrics, lyrics_source_url, translation, processing, analysed, completeness{lyrics,cover,video,play_link,analysis}`. Throws `NOT_FOUND`. **Admin-only** (returns full lyrics + translation).

- [ ] **Step 1: Write the failing test**

Add to `backend/test/curation.test.js`:
```js
test('getWorkbench assembles song, lyrics, processing, completeness', async () => {
  const id = await mkSong({ title: 'ZZZTEST WB', status: 'included', published: true, spotify_url: 'http://x' });
  await pool.query(`INSERT INTO song_lyrics (song_id, lyrics, source_url, translation) VALUES ($1,$2,$3,$4)`,
    [id, 'full lyric text', 'http://genius/x', 'translated text']);
  await pool.query(`UPDATE songs SET language='Spanish', lyrics_highlights='a great line' WHERE id=$1`, [id]);

  const wb = await curation.getWorkbench(pool, id);
  assert.equal(wb.id, id);
  assert.equal(wb.language, 'Spanish');
  assert.equal(wb.lyrics, 'full lyric text');            // full lyrics returned (admin-only path)
  assert.equal(wb.translation, 'translated text');
  assert.equal(wb.lyrics_source_url, 'http://genius/x');
  assert.equal(wb.lyrics_highlights, 'a great line');
  assert.equal(wb.completeness.lyrics, true);
  assert.equal(wb.completeness.play_link, true);
  assert.equal(wb.completeness.video, false);
  assert.ok(Array.isArray(wb.artists) && wb.artists.length >= 1);
});

test('getWorkbench throws NOT_FOUND for missing song', async () => {
  await assert.rejects(curation.getWorkbench(pool, -777), e => e.code === 'NOT_FOUND');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test backend/test/curation.test.js`
Expected: FAIL — `curation.getWorkbench is not a function`.

- [ ] **Step 3: Implement `getWorkbench`**

In `backend/services/curation.js`, add before `module.exports`:
```js
function hasArt(images) {
  return !!(images && !['null', '[]', ''].includes(String(images).trim()));
}

async function getWorkbench(db, id) {
  const s = (await db.query(`
    SELECT s.*, al.name AS album_name, al.images AS album_images, al.release_date AS album_release_date
    FROM songs s LEFT JOIN albums al ON al.id=s.album_id WHERE s.id=$1`, [id])).rows[0];
  if (!s) { const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e; }

  const artists = (await db.query(
    `SELECT a.id, a.name, a.website_url FROM song_artists sa JOIN artists a ON a.id=sa.artist_id
     WHERE sa.song_id=$1 ORDER BY a.name`, [id])).rows;
  const videos = (await db.query(
    `SELECT id, youtube_id, video_title, video_type, is_primary FROM youtube_videos
     WHERE song_id=$1 ORDER BY is_primary DESC, id`, [id])).rows;
  const lyricsRow = (await db.query(
    `SELECT lyrics, source_url, translation FROM song_lyrics WHERE song_id=$1`, [id])).rows[0] || null;
  const processing = await getProcessing(db, id);
  const analysed = (await db.query(
    `SELECT 1 FROM song_lyric_analysis WHERE song_id=$1 AND model_used=$2`, [id, DEFAULT_MODEL])).rows.length > 0;

  const cover = hasArt(s.album_images);
  const play_link = !!(s.spotify_url || s.bandcamp_url || s.soundcloud_url || videos.length > 0);
  return {
    id: s.id, title: s.title, status: s.status, published: s.published, language: s.language,
    spotify_id: s.spotify_id, spotify_url: s.spotify_url, bandcamp_url: s.bandcamp_url, soundcloud_url: s.soundcloud_url,
    lyrics_status: s.lyrics_status, lyrics_url: s.lyrics_url, lyrics_source: s.lyrics_source,
    lyrics_highlights: s.lyrics_highlights, status_notes: s.status_notes,
    album: { name: s.album_name, images: s.album_images, release_date: s.album_release_date },
    artists, videos,
    lyrics: lyricsRow ? lyricsRow.lyrics : null,
    lyrics_source_url: lyricsRow ? lyricsRow.source_url : null,
    translation: lyricsRow ? lyricsRow.translation : null,
    processing, analysed,
    completeness: { lyrics: !!lyricsRow, cover, video: videos.length > 0, play_link, analysis: analysed },
  };
}
```
Add `getWorkbench` and `hasArt` to `module.exports` (export `getWorkbench`; `hasArt` optional).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test backend/test/curation.test.js`
Expected: all pass.

- [ ] **Step 5: Add route and commit**

In `backend/routes/admin.js` (Curation workbench banner):
```js
router.get('/workbench/:id', async (req, res) => {
  try {
    res.json(await curation.getWorkbench(pool, parseInt(req.params.id)));
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    console.error('workbench read error:', e);
    res.status(500).json({ error: 'Failed to load workbench', details: e.message });
  }
});
```
Commit:
```bash
git add backend/services/curation.js backend/test/curation.test.js backend/routes/admin.js
git commit -F commit-msg.txt   # "feat(A1): workbench assemble-read (GET /workbench/:id)"
```

---

### Task 5: Per-panel save endpoints (details, lyrics, highlights, links, cover)

**Files:**
- Modify: `backend/services/curation.js`
- Modify: `backend/test/curation.test.js`
- Modify: `backend/routes/admin.js`

**Interfaces:**
- Consumes: `getWorkbench` (returned by the save functions so the UI can refresh).
- Produces (all throw `NOT_FOUND` / `BAD_INPUT` as noted; each returns the reassembled workbench via `getWorkbench`):
  - `saveDetails(db, id, { title, language, status_notes }) -> workbench`
  - `saveLyrics(db, id, { lyrics, source_url, translation, lyrics_status, lyrics_url, lyrics_source }) -> workbench` (upserts/deletes `song_lyrics`; validates `lyrics_status`)
  - `saveHighlights(db, id, { lyrics_highlights }) -> workbench`
  - `saveLinks(db, id, { spotify_url, bandcamp_url, soundcloud_url }) -> workbench` (each must be http(s) if provided non-empty)
  - `setCover(db, id, { cover_url }) -> workbench` (http(s); upserts a manual album's `images`)
  - `LYRICS_STATUSES` constant.

- [ ] **Step 1: Write the failing tests**

Add to `backend/test/curation.test.js`:
```js
test('saveDetails updates title + language', async () => {
  const id = await mkSong({ title: 'ZZZTEST Save Details' });
  const wb = await curation.saveDetails(pool, id, { title: 'ZZZTEST Save Details 2', language: 'French' });
  assert.equal(wb.title, 'ZZZTEST Save Details 2');
  assert.equal(wb.language, 'French');
});

test('saveLyrics upserts local lyrics + translation and sets lyrics_status', async () => {
  const id = await mkSong({ title: 'ZZZTEST Save Lyrics' });
  const wb = await curation.saveLyrics(pool, id, { lyrics: 'line one', source_url: 'http://src', translation: 'trans', lyrics_status: 'found' });
  assert.equal(wb.lyrics, 'line one');
  assert.equal(wb.translation, 'trans');
  assert.equal(wb.lyrics_status, 'found');
  await assert.rejects(curation.saveLyrics(pool, id, { lyrics_status: 'bogus' }), e => e.code === 'BAD_INPUT');
});

test('saveLyrics with empty lyrics deletes the local row', async () => {
  const id = await mkSong({ title: 'ZZZTEST Del Lyrics' });
  await curation.saveLyrics(pool, id, { lyrics: 'temp' });
  const wb = await curation.saveLyrics(pool, id, { lyrics: '' });
  assert.equal(wb.lyrics, null);
});

test('saveHighlights updates public highlights', async () => {
  const id = await mkSong({ title: 'ZZZTEST Highlights' });
  const wb = await curation.saveHighlights(pool, id, { lyrics_highlights: 'a memorable line' });
  assert.equal(wb.lyrics_highlights, 'a memorable line');
});

test('saveLinks validates http(s)', async () => {
  const id = await mkSong({ title: 'ZZZTEST Links' });
  const wb = await curation.saveLinks(pool, id, { bandcamp_url: 'https://band.camp/x' });
  assert.equal(wb.bandcamp_url, 'https://band.camp/x');
  await assert.rejects(curation.saveLinks(pool, id, { spotify_url: 'ftp://nope' }), e => e.code === 'BAD_INPUT');
});

test('setCover upserts album images for a non-Spotify song', async () => {
  const id = await mkSong({ title: 'ZZZTEST Cover' });
  const wb = await curation.setCover(pool, id, { cover_url: 'https://img/cover.jpg' });
  assert.equal(wb.completeness.cover, true);
  assert.ok(String(wb.album.images).includes('https://img/cover.jpg'));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test backend/test/curation.test.js`
Expected: FAIL — `curation.saveDetails is not a function`.

- [ ] **Step 3: Implement the save functions**

In `backend/services/curation.js`, add before `module.exports`:
```js
const LYRICS_STATUSES = ['found', 'not_found', 'not_searched'];

async function assertSong(db, id) {
  if ((await db.query('SELECT 1 FROM songs WHERE id=$1', [id])).rows.length === 0) {
    const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e;
  }
}
function assertHttp(v, label) {
  if (v != null && v !== '' && !/^https?:\/\//i.test(v)) {
    const e = new Error(`${label} must be an http(s) URL`); e.code = 'BAD_INPUT'; throw e;
  }
}

async function saveDetails(db, id, { title, language, status_notes } = {}) {
  await assertSong(db, id);
  const sets = [], params = [id];
  const add = (col, val) => { if (val !== undefined) { params.push(val === '' ? null : val); sets.push(`${col}=$${params.length}`); } };
  add('title', title); add('language', language); add('status_notes', status_notes);
  if (sets.length) await db.query(`UPDATE songs SET ${sets.join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, params);
  return getWorkbench(db, id);
}

async function saveLyrics(db, id, { lyrics, source_url, translation, lyrics_status, lyrics_url, lyrics_source } = {}) {
  await assertSong(db, id);
  if (lyrics_status != null && !LYRICS_STATUSES.includes(lyrics_status)) {
    const e = new Error('invalid lyrics_status'); e.code = 'BAD_INPUT'; throw e;
  }
  if (lyrics !== undefined) {
    if (lyrics == null || lyrics === '') {
      await db.query('DELETE FROM song_lyrics WHERE song_id=$1', [id]);
    } else {
      await db.query(`
        INSERT INTO song_lyrics (song_id, lyrics, source_url, translation)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (song_id) DO UPDATE SET
          lyrics=EXCLUDED.lyrics, source_url=EXCLUDED.source_url, translation=EXCLUDED.translation`,
        [id, lyrics, source_url || null, translation || null]);
    }
  } else if (translation !== undefined || source_url !== undefined) {
    await db.query(`
      UPDATE song_lyrics SET
        translation = COALESCE($2, translation),
        source_url  = COALESCE($3, source_url)
      WHERE song_id=$1`,
      [id, translation === undefined ? null : translation, source_url === undefined ? null : source_url]);
  }
  const sets = [], params = [id];
  const add = (col, val) => { if (val !== undefined) { params.push(val === '' ? null : val); sets.push(`${col}=$${params.length}`); } };
  add('lyrics_status', lyrics_status); add('lyrics_url', lyrics_url); add('lyrics_source', lyrics_source);
  if (sets.length) await db.query(`UPDATE songs SET ${sets.join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, params);
  return getWorkbench(db, id);
}

async function saveHighlights(db, id, { lyrics_highlights } = {}) {
  await assertSong(db, id);
  await db.query(`UPDATE songs SET lyrics_highlights=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
    [id, lyrics_highlights || null]);
  return getWorkbench(db, id);
}

async function saveLinks(db, id, { spotify_url, bandcamp_url, soundcloud_url } = {}) {
  await assertSong(db, id);
  assertHttp(spotify_url, 'spotify_url'); assertHttp(bandcamp_url, 'bandcamp_url'); assertHttp(soundcloud_url, 'soundcloud_url');
  const sets = [], params = [id];
  const add = (col, val) => { if (val !== undefined) { params.push(val === '' ? null : val); sets.push(`${col}=$${params.length}`); } };
  add('spotify_url', spotify_url); add('bandcamp_url', bandcamp_url); add('soundcloud_url', soundcloud_url);
  if (sets.length) await db.query(`UPDATE songs SET ${sets.join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, params);
  return getWorkbench(db, id);
}

async function setCover(db, id, { cover_url } = {}) {
  await assertSong(db, id);
  if (!cover_url || !/^https?:\/\//i.test(cover_url)) {
    const e = new Error('cover_url must be an http(s) URL'); e.code = 'BAD_INPUT'; throw e;
  }
  const images = JSON.stringify([{ url: cover_url }]);
  const song = (await db.query('SELECT album_id, title FROM songs WHERE id=$1', [id])).rows[0];
  if (song.album_id) {
    await db.query('UPDATE albums SET images=$2 WHERE id=$1', [song.album_id, images]);
  } else {
    const album = (await db.query(
      `INSERT INTO albums (name, images, data_source) VALUES ($1, $2, 'manual') RETURNING id`,
      [song.title || 'Untitled', images])).rows[0];
    await db.query('UPDATE songs SET album_id=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1', [id, album.id]);
  }
  return getWorkbench(db, id);
}
```
Extend `module.exports` with: `LYRICS_STATUSES, saveDetails, saveLyrics, saveHighlights, saveLinks, setCover`.

> **Cleanup note for the test `after` hook:** `setCover` may create a manual album named after the song title (`ZZZTEST …`). Add this line to the `after` cleanup in `curation.test.js`, before the `DELETE FROM songs` line:
> ```js
> await pool.query(`DELETE FROM albums WHERE name LIKE 'ZZZTEST%'`);
> ```
> (Keep the existing `DELETE FROM albums WHERE name = 'ZZZTEST Album'` or replace it with the LIKE form.)

- [ ] **Step 4: Run to verify they pass**

Run: `node --test backend/test/curation.test.js`
Expected: all pass.

- [ ] **Step 5: Add routes and commit**

In `backend/routes/admin.js` (Curation workbench banner), add a small helper + the five routes:
```js
// Shared handler for the per-panel saves that return the reassembled workbench.
function panelSave(fn) {
  return async (req, res) => {
    try {
      const wb = await fn(pool, parseInt(req.params.id), req.body || {});
      res.json({ success: true, workbench: wb });
    } catch (e) {
      if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
      if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
      console.error('workbench save error:', e);
      res.status(500).json({ error: 'Failed to save', details: e.message });
    }
  };
}
router.put('/workbench/:id/details',    panelSave(curation.saveDetails));
router.put('/workbench/:id/lyrics',     panelSave(curation.saveLyrics));
router.put('/workbench/:id/highlights', panelSave(curation.saveHighlights));
router.put('/workbench/:id/links',      panelSave(curation.saveLinks));
router.put('/workbench/:id/cover',      panelSave(curation.setCover));
```
Commit:
```bash
git add backend/services/curation.js backend/test/curation.test.js backend/routes/admin.js
git commit -F commit-msg.txt   # "feat(A1): per-panel save endpoints (details, lyrics, highlights, links, cover)"
```

---

### Task 6: Video panel endpoints (one-primary invariant)

**Files:**
- Create: `backend/services/videos.js`
- Create: `backend/test/videos.test.js`
- Modify: `backend/routes/admin.js`

**Interfaces:**
- Produces (in `services/videos.js`):
  - `addVideo(db, songId, { youtube_id, video_title, video_type, is_primary }) -> row` — validates 11-char `youtube_id` and `video_type ∈ {official,live,lyric,fan-made,other}`; if `is_primary` (or it's the song's first video) clears other primaries first. Throws `NOT_FOUND` (song) / `BAD_INPUT`.
  - `updateVideo(db, videoId, { video_title, video_type }) -> row` — throws `NOT_FOUND`/`BAD_INPUT`.
  - `deleteVideo(db, videoId) -> { deleted: true, song_id }` — if the deleted video was primary, promote the lowest-id remaining video to primary. Throws `NOT_FOUND`.
  - `setPrimaryVideo(db, videoId) -> row` — clears siblings, sets this primary. Throws `NOT_FOUND`.
  - `VIDEO_TYPES` constant.
- `youtube_id` regex: `/^[a-zA-Z0-9_-]{11}$/` (matches the table CHECK).

- [ ] **Step 1: Write the failing tests**

Create `backend/test/videos.test.js`:
```js
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const videos = require('../services/videos');

async function mkSong(title) {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, data_source) VALUES ($1,'pending','manual') RETURNING id`, [title])).rows[0];
  return s.id;
}
async function primaries(songId) {
  return (await pool.query(`SELECT id, is_primary FROM youtube_videos WHERE song_id=$1 ORDER BY id`, [songId])).rows;
}

after(async () => {
  await pool.query(`DELETE FROM youtube_videos WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZTEST%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZTEST%'`);
  await pool.end();
});

test('addVideo rejects a malformed youtube_id', async () => {
  const id = await mkSong('ZZZTEST Vid Bad');
  await assert.rejects(videos.addVideo(pool, id, { youtube_id: 'short' }), e => e.code === 'BAD_INPUT');
});

test('first video is primary; second only-primary-if-asked; setting primary clears siblings', async () => {
  const id = await mkSong('ZZZTEST Vid Primary');
  const v1 = await videos.addVideo(pool, id, { youtube_id: 'aaaaaaaaaaa', video_type: 'official' });
  assert.equal(v1.is_primary, true, 'first video auto-primary');
  const v2 = await videos.addVideo(pool, id, { youtube_id: 'bbbbbbbbbbb', video_type: 'live' });
  assert.equal(v2.is_primary, false, 'second not primary by default');

  await videos.setPrimaryVideo(pool, v2.id);
  const rows = await primaries(id);
  assert.equal(rows.filter(r => r.is_primary).length, 1, 'exactly one primary');
  assert.equal(rows.find(r => r.id === v2.id).is_primary, true);
});

test('deleting the primary promotes another remaining video', async () => {
  const id = await mkSong('ZZZTEST Vid Delete');
  const v1 = await videos.addVideo(pool, id, { youtube_id: 'ccccccccccc' });   // primary
  const v2 = await videos.addVideo(pool, id, { youtube_id: 'ddddddddddd' });
  await videos.deleteVideo(pool, v1.id);
  const rows = await primaries(id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, v2.id);
  assert.equal(rows[0].is_primary, true, 'remaining video promoted to primary');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test backend/test/videos.test.js`
Expected: FAIL — `Cannot find module '../services/videos'`.

- [ ] **Step 3: Implement `services/videos.js`**

```js
// YouTube video panel service — owns the "exactly one primary per song" invariant.
const VIDEO_TYPES = ['official', 'live', 'lyric', 'fan-made', 'other'];
const YT_ID = /^[a-zA-Z0-9_-]{11}$/;

async function addVideo(db, songId, { youtube_id, video_title = null, video_type = 'official', is_primary = false } = {}) {
  if ((await db.query('SELECT 1 FROM songs WHERE id=$1', [songId])).rows.length === 0) {
    const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e;
  }
  if (!YT_ID.test(String(youtube_id || ''))) { const e = new Error('invalid youtube_id (need 11 chars)'); e.code = 'BAD_INPUT'; throw e; }
  if (!VIDEO_TYPES.includes(video_type)) { const e = new Error('invalid video_type'); e.code = 'BAD_INPUT'; throw e; }

  const count = (await db.query('SELECT COUNT(*)::int AS n FROM youtube_videos WHERE song_id=$1', [songId])).rows[0].n;
  const makePrimary = is_primary || count === 0; // first video is always primary
  if (makePrimary) await db.query('UPDATE youtube_videos SET is_primary=false WHERE song_id=$1', [songId]);
  const r = await db.query(`
    INSERT INTO youtube_videos (song_id, youtube_id, video_title, thumbnail_url, video_type, is_primary, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
    RETURNING id, song_id, youtube_id, video_title, video_type, is_primary`,
    [songId, youtube_id, video_title, `https://img.youtube.com/vi/${youtube_id}/mqdefault.jpg`, video_type, makePrimary]);
  return r.rows[0];
}

async function updateVideo(db, videoId, { video_title, video_type } = {}) {
  if (video_type != null && !VIDEO_TYPES.includes(video_type)) { const e = new Error('invalid video_type'); e.code = 'BAD_INPUT'; throw e; }
  const sets = [], params = [videoId];
  const add = (col, val) => { if (val !== undefined) { params.push(val === '' ? null : val); sets.push(`${col}=$${params.length}`); } };
  add('video_title', video_title); add('video_type', video_type);
  if (!sets.length) { const e = new Error('no fields to update'); e.code = 'BAD_INPUT'; throw e; }
  const r = await db.query(`UPDATE youtube_videos SET ${sets.join(', ')} WHERE id=$1
    RETURNING id, song_id, youtube_id, video_title, video_type, is_primary`, params);
  if (!r.rows.length) { const e = new Error('video not found'); e.code = 'NOT_FOUND'; throw e; }
  return r.rows[0];
}

async function setPrimaryVideo(db, videoId) {
  const v = (await db.query('SELECT song_id FROM youtube_videos WHERE id=$1', [videoId])).rows[0];
  if (!v) { const e = new Error('video not found'); e.code = 'NOT_FOUND'; throw e; }
  await db.query('UPDATE youtube_videos SET is_primary=false WHERE song_id=$1', [v.song_id]);
  const r = await db.query(`UPDATE youtube_videos SET is_primary=true WHERE id=$1
    RETURNING id, song_id, youtube_id, video_title, video_type, is_primary`, [videoId]);
  return r.rows[0];
}

async function deleteVideo(db, videoId) {
  const v = (await db.query('SELECT song_id, is_primary FROM youtube_videos WHERE id=$1', [videoId])).rows[0];
  if (!v) { const e = new Error('video not found'); e.code = 'NOT_FOUND'; throw e; }
  await db.query('DELETE FROM youtube_videos WHERE id=$1', [videoId]);
  if (v.is_primary) {
    const next = (await db.query('SELECT id FROM youtube_videos WHERE song_id=$1 ORDER BY id LIMIT 1', [v.song_id])).rows[0];
    if (next) await db.query('UPDATE youtube_videos SET is_primary=true WHERE id=$1', [next.id]);
  }
  return { deleted: true, song_id: v.song_id };
}

module.exports = { VIDEO_TYPES, addVideo, updateVideo, setPrimaryVideo, deleteVideo };
```

> **Note on the partial unique index** `idx_youtube_videos_one_primary_per_song` (`WHERE is_primary=true`): every function above clears siblings **before** setting a new primary, so at most one row is ever `is_primary=true` per song — no constraint violation.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test backend/test/videos.test.js`
Expected: all pass.

- [ ] **Step 5: Add routes and commit**

In `backend/routes/admin.js`, add `const videos = require('../services/videos');` with the other requires, and in the Curation workbench banner:
```js
router.post('/workbench/:id/videos', async (req, res) => {
  try {
    const row = await videos.addVideo(pool, parseInt(req.params.id), req.body || {});
    res.json({ success: true, video: row });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Song not found' });
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    console.error('add video error:', e);
    res.status(500).json({ error: 'Failed to add video', details: e.message });
  }
});
router.put('/workbench/videos/:videoId', async (req, res) => {
  try {
    res.json({ success: true, video: await videos.updateVideo(pool, parseInt(req.params.videoId), req.body || {}) });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Video not found' });
    if (e.code === 'BAD_INPUT') return res.status(400).json({ error: e.message });
    console.error('update video error:', e);
    res.status(500).json({ error: 'Failed to update video', details: e.message });
  }
});
router.put('/workbench/videos/:videoId/primary', async (req, res) => {
  try {
    res.json({ success: true, video: await videos.setPrimaryVideo(pool, parseInt(req.params.videoId)) });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Video not found' });
    console.error('set primary error:', e);
    res.status(500).json({ error: 'Failed to set primary', details: e.message });
  }
});
router.delete('/workbench/videos/:videoId', async (req, res) => {
  try {
    res.json({ success: true, ...(await videos.deleteVideo(pool, parseInt(req.params.videoId))) });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Video not found' });
    console.error('delete video error:', e);
    res.status(500).json({ error: 'Failed to delete video', details: e.message });
  }
});
```
Commit:
```bash
git add backend/services/videos.js backend/test/videos.test.js backend/routes/admin.js
git commit -F commit-msg.txt   # "feat(A1): video panel endpoints with one-primary invariant"
```

---

### Task 7: Guardrails — lyrics-leak check, docs, full-suite smoke

**Files:**
- Create: `backend/test/lyrics_privacy.test.js`
- Modify: `backend/scripts/README.md` (note the new local-only column)
- Modify: `docs/PROJECT_STATE.md` (changelog + next-tasks — see End-Session)

**Interfaces:** none (verification + docs).

- [ ] **Step 1: Write a guardrail test that public routes never expose lyrics/translation**

Create `backend/test/lyrics_privacy.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// The full-lyrics table (song_lyrics.lyrics/.translation) is LOCAL ONLY. Only admin.js
// (behind auth) may reference it. Guard against a public route ever SELECTing it.
const PUBLIC_ROUTES = ['spotify.js', 'playlists.js', 'youtube.js', 'submissions.js', 'analytics.js'];

test('no public route references song_lyrics', () => {
  for (const f of PUBLIC_ROUTES) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8');
    assert.ok(!/song_lyrics/.test(src), `${f} must not reference song_lyrics`);
  }
});

test('no public route references the translation column', () => {
  for (const f of PUBLIC_ROUTES) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8');
    assert.ok(!/\btranslation\b/.test(src), `${f} must not reference translation`);
  }
});
```

- [ ] **Step 2: Run the guardrail test**

Run: `node --test backend/test/lyrics_privacy.test.js`
Expected: 2 tests pass. *(If it fails, a public route is leaking local-only data — stop and fix that route, do not weaken the test.)*

- [ ] **Step 3: Run the whole backend test suite**

Run: `node --test backend/test/`
Expected: all suites pass (`migration006`, `curation`, `videos`, `lyrics_privacy`, plus the pre-existing `staging`).

- [ ] **Step 4: Manual route smoke (server running)**

Start the backend (`cd backend && npm run dev`), then with the admin password from `backend/.env`:
```bash
PW=$ADMIN_PASSWORD
curl -s -H "x-admin-password: $PW" "http://localhost:5000/api/admin/curation/counts"
curl -s -H "x-admin-password: $PW" "http://localhost:5000/api/admin/curation/queue?queue=to-process&limit=3"
# pick a real included song id from the queue output, then:
curl -s -H "x-admin-password: $PW" "http://localhost:5000/api/admin/workbench/541"
# 401 check (no header):
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5000/api/admin/curation/counts"   # expect 401
```
Expected: counts JSON; queue rows with `missing[]`; a full workbench object (including `lyrics` when present); `401` without the header.

- [ ] **Step 5: Update the local-only-column note and commit**

In `backend/scripts/README.md`, in the section that describes the local-only lyrics rule, add a line:
> Migration 006 added `song_lyrics.translation` — also local-only (copyright); the same rule and `--exclude-table-data=song_lyrics` dump exclusion cover it.

Commit:
```bash
git add backend/test/lyrics_privacy.test.js backend/scripts/README.md
git commit -F commit-msg.txt   # "test(A1): guardrail — no public route exposes lyrics/translation; doc note"
```

---

## Self-Review (completed by plan author)

**Spec coverage (spec §3/§4/§6 backend half):**
- §3 `song_processing` table + derived queues → Tasks 1–3. ✅
- §3 `songs.language`, `song_lyrics.translation` → Task 1; surfaced/saved in Tasks 4–5. ✅
- §4 Workbench data (details, lyrics+translation+source, highlights, links, cover, video, analysis status, completeness) → Tasks 4–6 (read) + Task 5–6 (writes). ✅
- §4 lifecycle (include/reject/publish/unpublish/play-link/attach-spotify) → **reused from `staging.js`, unchanged** (no new work; A2 wires the existing endpoints into the UI). ✅
- §6 guardrail: full lyrics admin-only, never public → Task 7. ✅
- **Out of A1 scope (correctly):** all frontend (nav shell, Songs list, Workbench page, Dashboard) → plans A2–A4; quick-search links, YouTube search (D), lyrics fetch (E), Spotify push (F), analysis display (B), submissions moderation (C).

**Placeholder scan:** none — every step has runnable code/SQL/commands.

**Type consistency:** service functions are `(db, id, body)`; all throw `e.code` in `{NOT_FOUND,BAD_INPUT,BAD_QUEUE}`; routes map consistently. `getWorkbench` is the single return shape reused by every save. Queue keys are identical across `queueWhere`, `listCurationQueue`, `queueCounts`, and the tests.

---

## Follow-on plans (written after A1 lands, against its real endpoints)

- **A2 — Admin nav shell + Songs area:** replace the 10-tab `AdminInterface` with the 5-area shell; build the Songs queue-rail + list consuming `/curation/queue` + `/curation/counts`; re-parent Artists / Playlists / Data quality. (Deletes: old tab shell wiring; keeps `ArtistsManager`, `ManagePlaylistsTab`, `DuplicateManager`.)
- **A3 — The Workbench page:** the full-page `/admin/song/:id` route with all panels, autosave-on-blur, prev/next, completeness checklist, reject-confirm, quick-search links, highlights picker — consuming the Task 4–6 endpoints and the reused `staging.js` lifecycle routes. (Deletes: `StagingQueue`, `LyricsLookupManager`, `YouTubeVideoManager`, Manage Songs edit modal — after verifying data parity.)
- **A4 — Dashboard landing + cleanup:** the Dashboard (queue counts + Add a song + recent activity); delete `DataDashboard`; final IA polish. (Each delete session verifies data reachable in the new UI first — no-data-loss guardrail.)
