# Junk-lyrics checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect junk lyrics (scraper "Error:" stubs and YouTube-description text), queue them for the curator, and hide a flagged song's analysis from every public page until the flag clears.

**Architecture:** A pure detector (`lyricsQuality.js`) feeds two new columns on `song_lyrics` (`junk_kind`, `junk_dismissed`), maintained by a small service (`junkLyrics.js`: scan / list / dismiss / recheck). Public hiding is one `NOT EXISTS` added to the shared `LATEST_ANALYSIS` fragment and `hasAnalysisExists`, so every consumer inherits it. Admin gets a **Junk lyrics** queue (own list component, like the Inbox) and a banner in the workbench Lyrics panel.

**Tech Stack:** Node/Express 5, PostgreSQL (`pg`), `node:test`; React/Vite frontend.

**Spec:** `docs/superpowers/specs/2026-10-13-G-junk-lyrics-design.md`. **One refinement of spec §6:** the queue's rows come from a dedicated `GET /api/admin/junk-lyrics` (like the Inbox) rather than extending `/curation/queue`; `queueCounts`/`queueWhere` still gain `junk-lyrics` so the rail count works.

## Global Constraints

- `song_lyrics` is LOCAL ONLY (copyright): never SELECT `lyrics` from a public route; the only admin read is `listJunk`, which truncates to ~120 chars server-side.
- The web app is a **read-only consumer** of `song_lyric_analysis`: never write to it.
- Public routes keep `status='included' AND published=true`.
- Latest-pass-by-recency rule in `LATEST_ANALYSIS` is unchanged; hiding is a pure exclusion.
- Backend test files use their own fixture sentinel: this feature's file uses **`ZZZJUNK`** (never share a LIKE-prefix with another file). Tests must **never** call `scan()` without the `songIds` filter (it would flag real dev rows).
- Run backend tests serially: `cd backend && node --test --test-concurrency=1` (the parallel run has known count races between files).
- Migrations are additive/idempotent, live in `backend/database/migrations/`, and are applied to the dev DB with psql (`PGPASSWORD` from `backend/.env`).
- Frontend styling uses design tokens (`--space-*`, `--text-*`), no raw colours. Admin code fetches via `adminFetch`.
- Git: add explicit paths (never `git add backend` or `.`); commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; write multi-line messages to a scratchpad file and use `git commit -F`.
- Files may be CRLF or LF; use the Edit tool per hunk (or a Python replace that preserves each file's endings), never whole-file PowerShell rewrites.

## Review Focus

- A flagged song that **has an analysis** opens in the admin workbench without error (`getSongAnalysis` returns null while `analysed` is true).
- Saving **real lyrics over flagged junk** clears the flag **and** resets a previous dismissal; saving junk over a dismissed row re-flags it.
- **Whitespace-only / empty lyrics**: never flagged; a stale flag on an emptied row is cleared by scan.
- **A real lyric containing a URL or the word "subscribe"** (one weak marker, no strong marker) is NOT flagged; a real Genius page with a `[Verse 1]` header is NOT flagged.
- A flagged song that is **unpublished/pending** appears in the Junk queue but never leaks into any public count.

---

## File Structure

- Create `backend/services/lyricsQuality.js` — pure detector.
- Create `backend/database/migrations/012_junk_lyrics.sql` — two columns.
- Create `backend/services/junkLyrics.js` — scan / listJunk / dismiss / recheck.
- Modify `backend/services/analysis.js` — hide flagged songs in `LATEST_ANALYSIS` + `hasAnalysisExists`.
- Modify `backend/services/curation.js` — `HAS_LYRICS_SQL`, `needs-analysis`, `junk-lyrics` queue, `has_lyrics`, workbench `junk_kind`/completeness, `saveLyrics` → `recheck`.
- Modify `backend/routes/admin.js` — three routes.
- Create `backend/test/lyricsQuality.test.js`, `backend/test/junkLyrics.test.js`.
- Create `frontend/src/components/admin/JunkLyricsList.jsx`; modify `QueueRail.jsx`, `SongsArea.jsx`, `SongQueueList.jsx` (label), `Dashboard.jsx` (tile), `Workbench.jsx` + `LyricsPanel.jsx` (banner), `styles/admin.css`.

---

### Task 1: Detector

**Files:**
- Create: `backend/services/lyricsQuality.js`
- Test: `backend/test/lyricsQuality.test.js`

**Interfaces:**
- Produces: `classify(text) -> 'error' | 'youtube_description' | null`; `JUNK_KINDS = ['error','youtube_description']`.

- [ ] **Step 1: Write the failing test** — create `backend/test/lyricsQuality.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { classify, JUNK_KINDS } = require('../services/lyricsQuality');

test('JUNK_KINDS lists both kinds', () => {
  assert.deepEqual(JUNK_KINDS, ['error', 'youtube_description']);
});

test('the three real scraper error messages are flagged as error', () => {
  for (const t of [
    'Error: Lyrics container not found on this Bandcamp page.',
    'Error: Scraper for this domain is not implemented.',
    'Error: Could not find lyrics container on the page.',
    '  error: something else broke  ',
  ]) assert.equal(classify(t), 'error', t);
});

test('a long text that merely starts with "Error:" is not an error stub', () => {
  assert.equal(classify('Error: ' + 'la '.repeat(100)), null);
});

test('YouTube auto-generated description is flagged', () => {
  const t = 'Provided to YouTube by The Orchard Enterprises\n\nVampire in You · Universal Poplab\n\nI Could Say I\'m Sorry\n\n℗ 2011 Copyright Holder\n\nReleased on: 2011-01-01\n\nAuto-generated by YouTube.';
  assert.equal(classify(t), 'youtube_description');
});

test('other strong patterns are flagged on their own', () => {
  assert.equal(classify("Max Rage's official audio stream for ‘Animal Liberation’ from the album"), 'youtube_description');
  assert.equal(classify('FUK - New Wave Of British Punk Rock 2011 punk band from Bristol UK Music 1 songs Smash Up the Kitchen'), 'youtube_description');
});

test('two weak markers together are flagged; one alone is not', () => {
  assert.equal(classify('Download the song here:\nhttps://song.link/x\nSubscribe to the channel'), 'youtube_description');
  assert.equal(classify('Please subscribe to our newsletter when the track ends\nand we all stand up\nand we fight back'), null);
  assert.equal(classify('see https://example.org for the story\nand we all stand up\nand we fight back'), null);
});

test('a real Genius page with a verse header is never flagged, even with markers', () => {
  const t = '3 Contributors Cruelty to Animals Lyrics [Verse 1]\nPlug me in\nDon\'t count me in\nhttps://genius.com/x subscribe';
  assert.equal(classify(t), null);
});

test('real lyrics, empty, whitespace and non-strings are not flagged', () => {
  assert.equal(classify('Plug me in\nDon\'t count me in\nIts true not everybody wins'), null);
  assert.equal(classify(''), null);
  assert.equal(classify('   \n  '), null);
  assert.equal(classify(null), null);
  assert.equal(classify(undefined), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/lyricsQuality.test.js`
Expected: FAIL — `Cannot find module '../services/lyricsQuality'`.

- [ ] **Step 3: Implement** — create `backend/services/lyricsQuality.js`:

```js
// Pure, DB-free detector for stored "lyrics" that are not lyrics. Rules are deliberately conservative:
// a missed junk row costs nothing new, a false positive hides a song's analysis until the curator
// clicks "Not junk". Tuned against the real catalogue (2026-10-13): 185 error stubs and ~29 of ~32
// description candidates; a Genius page with a [Verse] header and two blurbs that contain real lyrics
// are intentionally NOT flagged.
const JUNK_KINDS = ['error', 'youtube_description'];

// Any one of these is enough on its own.
const STRONG = [
  /provided to youtube by/i,
  /auto-generated by youtube/i,
  /official audio stream for/i,
  /\bmusic \d+ songs?\b/i,
];
// Ordinary words and links also appear in real lyrics, so two distinct ones are required.
const WEAK = [
  /https?:\/\//i, /subscribe/i, /follow us/i, /released on/i,
  /all rights reserved/i, /℗/, /download the song/i,
];
// Evidence of real verse structure vetoes every description rule.
const VERSE_HEADER = /\[(verse|chorus|bridge|intro|outro|hook|pre-chorus)/i;

function classify(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t) return null;
  if (/^error:/i.test(t) && t.length < 200) return 'error';
  if (VERSE_HEADER.test(t)) return null;
  if (STRONG.some((re) => re.test(t))) return 'youtube_description';
  return WEAK.filter((re) => re.test(t)).length >= 2 ? 'youtube_description' : null;
}

module.exports = { classify, JUNK_KINDS };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test test/lyricsQuality.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/lyricsQuality.js backend/test/lyricsQuality.test.js
git commit -m "feat(lyrics): pure junk-lyrics detector (error stubs, YouTube descriptions)"
```

---

### Task 2: Migration 012 + junkLyrics service + saveLyrics recheck

**Files:**
- Create: `backend/database/migrations/012_junk_lyrics.sql`, `backend/services/junkLyrics.js`
- Modify: `backend/services/curation.js` (`saveLyrics`, ~line 345-365; and the `require` block at the top)
- Test: `backend/test/junkLyrics.test.js`

**Interfaces:**
- Consumes: `classify` from Task 1.
- Produces: `scan(db, { songIds? }) -> { scanned, flagged, cleared }` (`flagged` = rows newly flagged or re-kinded, `cleared` = rows whose flag was removed); `listJunk(db) -> rows[{ id, title, artists, status, published, junk_kind, snippet, has_analysis }]`; `dismiss(db, songId)` (throws `e.code === 'NOT_FOUND'`); `recheck(db, songId)`.
- Column semantics: flagged ⇔ `song_lyrics.junk_kind IS NOT NULL`; `junk_dismissed=true` makes `scan` skip the row.

- [ ] **Step 1: Write the migration and apply it**

Create `backend/database/migrations/012_junk_lyrics.sql`:

```sql
-- 012 — junk-lyrics flag (sub-project G). The detector (services/lyricsQuality.js) sets junk_kind;
-- 'Not junk' sets junk_dismissed so scans skip the row. Flagged <=> junk_kind IS NOT NULL.
-- Additive, idempotent. song_lyrics stays LOCAL ONLY.
ALTER TABLE song_lyrics ADD COLUMN IF NOT EXISTS junk_kind VARCHAR(30)
  CHECK (junk_kind IS NULL OR junk_kind IN ('error','youtube_description'));
ALTER TABLE song_lyrics ADD COLUMN IF NOT EXISTS junk_dismissed BOOLEAN NOT NULL DEFAULT FALSE;
```

Run (Bash, from `backend/`): `export PGPASSWORD="$(grep '^DB_PASSWORD=' .env | cut -d= -f2-)"; psql -h localhost -U postgres -d vegan_playlist -f database/migrations/012_junk_lyrics.sql`
Expected: `ALTER TABLE` twice.

- [ ] **Step 2: Write the failing tests** — create `backend/test/junkLyrics.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const junk = require('../services/junkLyrics');
const curation = require('../services/curation');

// Fixture sentinel for this file: ZZZJUNK. NEVER call scan() without songIds (it would flag real dev rows).

async function mk(title, lyrics, { status = 'included', published = true } = {}) {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source) VALUES ($1,$2,$3,'manual') RETURNING id`,
    [title, status, published])).rows[0];
  const a = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [`ZZZJUNK Artist ${title}`])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  if (lyrics !== null) await pool.query(`INSERT INTO song_lyrics (song_id, lyrics) VALUES ($1,$2)`, [s.id, lyrics]);
  return s.id;
}
const row = async (id) => (await pool.query('SELECT junk_kind, junk_dismissed FROM song_lyrics WHERE song_id=$1', [id])).rows[0];

after(async () => {
  await pool.query(`DELETE FROM song_lyric_analysis WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZJUNK%')`);
  await pool.query(`DELETE FROM song_lyrics WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZJUNK%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZJUNK%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZJUNK%'`);
  await pool.end();
});

test('scan flags error stubs and descriptions, leaves real lyrics alone, and is idempotent', async () => {
  const err = await mk('ZZZJUNK err', 'Error: Lyrics container not found on this Bandcamp page.');
  const yt = await mk('ZZZJUNK yt', 'Provided to YouTube by DistroKid\n\nSong · Artist\n\n℗ 2020');
  const ok = await mk('ZZZJUNK ok', 'Plug me in\nDon\'t count me in');
  const ids = [err, yt, ok];
  const r1 = await junk.scan(pool, { songIds: ids });
  assert.deepEqual({ scanned: r1.scanned, flagged: r1.flagged, cleared: r1.cleared }, { scanned: 3, flagged: 2, cleared: 0 });
  assert.equal((await row(err)).junk_kind, 'error');
  assert.equal((await row(yt)).junk_kind, 'youtube_description');
  assert.equal((await row(ok)).junk_kind, null);
  const r2 = await junk.scan(pool, { songIds: ids });
  assert.deepEqual({ flagged: r2.flagged, cleared: r2.cleared }, { flagged: 0, cleared: 0 }, 'second scan changes nothing');
});

test('scan clears a stale flag on emptied or now-fine lyrics, but skips dismissed rows', async () => {
  const emptied = await mk('ZZZJUNK emptied', 'Error: Could not find lyrics container on the page.');
  const dism = await mk('ZZZJUNK dismissed', 'Error: Could not find lyrics container on the page.');
  await junk.scan(pool, { songIds: [emptied, dism] });
  await junk.dismiss(pool, dism);
  await pool.query(`UPDATE song_lyrics SET lyrics='   ' WHERE song_id=$1`, [emptied]);
  const r = await junk.scan(pool, { songIds: [emptied, dism] });
  assert.equal(r.cleared, 1);
  assert.equal((await row(emptied)).junk_kind, null, 'blank text is not junk');
  const d = await row(dism);
  assert.equal(d.junk_kind, null);
  assert.equal(d.junk_dismissed, true);
  await pool.query(`UPDATE song_lyrics SET junk_kind=NULL WHERE song_id=$1`, [dism]);
  await junk.scan(pool, { songIds: [dism] });
  assert.equal((await row(dism)).junk_kind, null, 'a dismissed row is never re-flagged by scan');
});

test('dismiss on a song with no lyrics row throws NOT_FOUND', async () => {
  const none = await mk('ZZZJUNK nolyrics', null);
  await assert.rejects(junk.dismiss(pool, none), (e) => e.code === 'NOT_FOUND');
});

test('listJunk returns flagged songs with a truncated one-line snippet and has_analysis', async () => {
  const long = 'Provided to YouTube by X ' + 'word '.repeat(80);
  const id = await mk('ZZZJUNK listed', long, { status: 'pending', published: false });
  await junk.scan(pool, { songIds: [id] });
  const mine = (await junk.listJunk(pool)).find((r) => r.id === id);
  assert.ok(mine, 'listed');
  assert.equal(mine.junk_kind, 'youtube_description');
  assert.equal(mine.has_analysis, false);
  assert.ok(mine.snippet.length <= 120 && !mine.snippet.includes('\n'));
  assert.ok(mine.artists.includes('ZZZJUNK Artist listed'));
});

test('saveLyrics re-checks: junk flags, real text clears and resets a dismissal, junk over a dismissed row re-flags', async () => {
  const id = await mk('ZZZJUNK save', null);
  await curation.saveLyrics(pool, id, { lyrics: 'Error: Lyrics container not found on this Bandcamp page.' });
  assert.equal((await row(id)).junk_kind, 'error');
  await junk.dismiss(pool, id);
  assert.deepEqual(await row(id), { junk_kind: null, junk_dismissed: true });
  await curation.saveLyrics(pool, id, { lyrics: 'Error: Scraper for this domain is not implemented.' });
  assert.deepEqual(await row(id), { junk_kind: 'error', junk_dismissed: false }, 'new text re-flags despite earlier dismissal');
  await curation.saveLyrics(pool, id, { lyrics: 'Real words here\nand more real words' });
  assert.deepEqual(await row(id), { junk_kind: null, junk_dismissed: false });
  await curation.saveLyrics(pool, id, { lyrics: '' });
  assert.equal((await row(id)).junk_kind, null, 'cleared lyrics are not junk');
});

test('saving only a source_url / translation does not touch the flag', async () => {
  const id = await mk('ZZZJUNK keep', 'Error: Could not find lyrics container on the page.');
  await junk.scan(pool, { songIds: [id] });
  await curation.saveLyrics(pool, id, { source_url: 'https://example.org/x' });
  assert.equal((await row(id)).junk_kind, 'error');
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && node --test test/junkLyrics.test.js`
Expected: FAIL — `Cannot find module '../services/junkLyrics'`.

- [ ] **Step 4: Implement the service** — create `backend/services/junkLyrics.js`:

```js
// Junk-lyrics flag maintenance (sub-project G). Writes ONLY song_lyrics.junk_kind / junk_dismissed.
// The one place lyric text is read for admin display is listJunk, which truncates server-side.
const { classify } = require('./lyricsQuality');

// Re-check every non-dismissed lyric (optionally only `songIds` — tests MUST pass it). Idempotent.
// flagged = rows newly flagged or changed kind; cleared = rows whose flag was removed.
async function scan(db, { songIds } = {}) {
  const ids = Array.isArray(songIds) ? songIds : null;
  const rows = (await db.query(
    `SELECT song_id, lyrics, junk_kind FROM song_lyrics
     WHERE junk_dismissed = false AND ($1::int[] IS NULL OR song_id = ANY($1))`, [ids])).rows;
  let flagged = 0, cleared = 0;
  for (const r of rows) {
    const kind = classify(r.lyrics);
    if (kind === r.junk_kind) continue;
    await db.query('UPDATE song_lyrics SET junk_kind=$2 WHERE song_id=$1', [r.song_id, kind]);
    if (kind) flagged++; else cleared++;
  }
  return { scanned: rows.length, flagged, cleared };
}

async function listJunk(db) {
  return (await db.query(
    `SELECT s.id, s.title, s.status, s.published, sl.junk_kind,
            COALESCE((SELECT string_agg(a.name, ', ' ORDER BY sa.id)
                      FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
                      WHERE sa.song_id = s.id), '') AS artists,
            left(regexp_replace(btrim(sl.lyrics), '\\s+', ' ', 'g'), 120) AS snippet,
            EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = s.id) AS has_analysis
     FROM song_lyrics sl JOIN songs s ON s.id = sl.song_id
     WHERE sl.junk_kind IS NOT NULL
     ORDER BY s.id`)).rows;
}

async function dismiss(db, songId) {
  const r = await db.query(
    'UPDATE song_lyrics SET junk_kind=NULL, junk_dismissed=true WHERE song_id=$1 RETURNING song_id', [songId]);
  if (r.rows.length === 0) { const e = new Error('no lyrics for that song'); e.code = 'NOT_FOUND'; throw e; }
}

// After the lyrics TEXT changed: new text gets a fresh look, so an earlier dismissal no longer applies.
async function recheck(db, songId) {
  const r = (await db.query('SELECT lyrics FROM song_lyrics WHERE song_id=$1', [songId])).rows[0];
  if (!r) return;
  await db.query('UPDATE song_lyrics SET junk_dismissed=false, junk_kind=$2 WHERE song_id=$1', [songId, classify(r.lyrics)]);
}

module.exports = { scan, listJunk, dismiss, recheck };
```

- [ ] **Step 5: Hook `saveLyrics`** — in `backend/services/curation.js`, add `const junkLyrics = require('./junkLyrics');` next to the other requires at the top, and in `saveLyrics` immediately after the `if (lyrics !== undefined) { … } else if (…) { … }` block that writes `song_lyrics` (i.e. just before `const hasNewLyrics = …`), add:

```js
  if (lyrics !== undefined) await junkLyrics.recheck(db, id);
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && node --test --test-concurrency=1 test/junkLyrics.test.js test/curation.test.js`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/database/migrations/012_junk_lyrics.sql backend/services/junkLyrics.js backend/services/curation.js backend/test/junkLyrics.test.js
git commit -m "feat(lyrics): junk flag columns, scan/list/dismiss/recheck service, saveLyrics re-check"
```

---

### Task 3: Public hiding + admin queue semantics

**Files:**
- Modify: `backend/services/analysis.js:14-20` (`LATEST_ANALYSIS`, `hasAnalysisExists`)
- Modify: `backend/services/curation.js` (`HAS_LYRICS_SQL`, `QUEUE_NAMES`, `queueWhere`, `listCurationQueue` `has_lyrics`, `getWorkbench`)
- Test: `backend/test/junkLyrics.test.js` (append) and `backend/test/curation.test.js` (the `queueCounts` key list)

**Interfaces:**
- Consumes: `junk_kind` column (Task 2).
- Produces: queue key `'junk-lyrics'` in `QUEUE_NAMES`/`queueWhere`/`queueCounts`; `getWorkbench(...).junk_kind` (string|null); `completeness.lyrics` false when flagged.

- [ ] **Step 1: Write the failing tests** — append to `backend/test/junkLyrics.test.js`:

```js
const analysis = require('../services/analysis');

async function addAnalysis(id) {
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, perspective, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, 'zzzjunk-model', 'MORAL_JUDGEMENT', '[{"code":"captivity","evidence":"x"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`, [id]);
}

test('a flagged song loses its analysis in every shared read, and gets it back on dismiss', async () => {
  const id = await mk('ZZZJUNK hidden', 'Error: Lyrics container not found on this Bandcamp page.');
  await addAnalysis(id);
  const visible = async () => ({
    song: !!(await analysis.getSongAnalysis(pool, id)),
    exists: (await pool.query(`SELECT 1 FROM songs s WHERE s.id=$1 AND ${analysis.hasAnalysisExists('s')}`, [id])).rows.length === 1,
    latest: (await pool.query(`SELECT 1 FROM songs s JOIN ${analysis.LATEST_ANALYSIS} la ON la.song_id = s.id WHERE s.id=$1`, [id])).rows.length === 1,
  });
  assert.deepEqual(await visible(), { song: true, exists: true, latest: true }, 'visible before flagging');
  await junk.scan(pool, { songIds: [id] });
  assert.deepEqual(await visible(), { song: false, exists: false, latest: false }, 'hidden while flagged');
  await junk.dismiss(pool, id);
  assert.deepEqual(await visible(), { song: true, exists: true, latest: true }, 'back after Not junk');
});

test('browse facet counts exclude a flagged song and include it again after dismiss', async () => {
  const id = await mk('ZZZJUNK facet', 'Error: Lyrics container not found on this Bandcamp page.');
  await addAnalysis(id);
  // The same join every browse facet / filter count uses (browseFilters.joinSql, services/analysis.js consumers).
  const count = async () => (await pool.query(
    `SELECT COUNT(*)::int AS n FROM songs s JOIN ${analysis.LATEST_ANALYSIS} sa ON sa.song_id = s.id
     WHERE s.status='included' AND s.published=true AND s.title LIKE 'ZZZJUNK facet%'`)).rows[0].n;
  await junk.scan(pool, { songIds: [id] });
  assert.equal(await count(), 0);
  await junk.dismiss(pool, id);
  assert.equal(await count(), 1);
});

test('flagged songs read as having no lyrics: in needs-lyrics and junk-lyrics, never in needs-analysis', async () => {
  const id = await mk('ZZZJUNK queues', 'Provided to YouTube by DistroKid\n\nSong · Artist\n\n℗ 2020');
  await addAnalysis(id);
  await junk.scan(pool, { songIds: [id] });
  const inQ = async (q) => (await curation.listCurationQueue(pool, { queue: q })).rows.some((r) => r.id === id);
  assert.equal(await inQ('needs-lyrics'), true);
  assert.equal(await inQ('junk-lyrics'), true);
  assert.equal(await inQ('needs-analysis'), false);
  assert.ok((await curation.queueCounts(pool))['junk-lyrics'] >= 1);
  const wb = await curation.getWorkbench(pool, id);   // must not throw although analysed=true and analysis is hidden
  assert.equal(wb.junk_kind, 'youtube_description');
  assert.equal(wb.completeness.lyrics, false);
  assert.equal(wb.analysed, true);
  await junk.dismiss(pool, id);
  assert.equal(await inQ('junk-lyrics'), false);
  assert.equal(await inQ('needs-lyrics'), false);
  assert.equal((await curation.getWorkbench(pool, id)).junk_kind, null);
});
```

In `backend/test/curation.test.js`, add `'junk-lyrics'` to the key list in `queueCounts returns a number for every queue key` (the array containing `'no-video'`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test --test-concurrency=1 test/junkLyrics.test.js test/curation.test.js`
Expected: FAIL (analysis still visible while flagged; `junk-lyrics` unknown queue).

- [ ] **Step 3: Implement the public hiding** — in `backend/services/analysis.js` replace the `LATEST_ANALYSIS` and `hasAnalysisExists` definitions (keep the existing comment block above `LATEST_ANALYSIS`, and add one sentence to it: "Songs whose lyrics are flagged junk (song_lyrics.junk_kind) are excluded — their analysis was built from junk and must not show publicly.") with:

```js
const NOT_JUNK = (col) =>
  `NOT EXISTS (SELECT 1 FROM song_lyrics jl WHERE jl.song_id = ${col} AND jl.junk_kind IS NOT NULL)`;

const LATEST_ANALYSIS = `(SELECT DISTINCT ON (song_id) *
   FROM song_lyric_analysis
   WHERE ${NOT_JUNK('song_lyric_analysis.song_id')}
   ORDER BY song_id, analyzed_at DESC NULLS LAST, model_used DESC)`;

// "Has any analysis at all" — any row exists (a latest row therefore exists). Flagged-junk songs have none.
const hasAnalysisExists = (alias) =>
  `EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = ${alias}.id AND ${NOT_JUNK(`${alias}.id`)})`;
```

(`hasCodesExists` already reads through `LATEST_ANALYSIS`, so it inherits the exclusion.)

- [ ] **Step 4: Implement the queue semantics** — in `backend/services/curation.js`:

1. `HAS_LYRICS_SQL` becomes:

```js
const HAS_LYRICS_SQL = `EXISTS (SELECT 1 FROM song_lyrics sl
              WHERE sl.song_id=s.id AND sl.lyrics IS NOT NULL AND btrim(sl.lyrics) <> '' AND sl.junk_kind IS NULL)`;
```

2. Add `'junk-lyrics'` to `QUEUE_NAMES` (after `'no-video'`) and a case in `queueWhere` (before `'needs-analysis'`):

```js
    case 'junk-lyrics':
      return `EXISTS (SELECT 1 FROM song_lyrics jl WHERE jl.song_id=s.id AND jl.junk_kind IS NOT NULL)`;
```

3. In the `needs-analysis` case replace the inline `EXISTS (SELECT 1 FROM song_lyrics sl WHERE … btrim(sl.lyrics) <> '')` with `${HAS_LYRICS_SQL}`.
4. In `listCurationQueue`'s SELECT, the `AS has_lyrics` expression becomes `${HAS_LYRICS_SQL} AS has_lyrics`.
5. In `getWorkbench`: change the lyrics query to `SELECT lyrics, source_url, translation, junk_kind FROM song_lyrics WHERE song_id=$1`; add `junk_kind: lyricsRow ? lyricsRow.junk_kind : null,` to the returned object (next to `translation`); and make `completeness.lyrics` `!!(lyricsRow && lyricsRow.lyrics && lyricsRow.lyrics.trim() && !lyricsRow.junk_kind)`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && node --test --test-concurrency=1`
Expected: whole suite PASS (previous 277 + new tests). Also confirm no existing analysis/browse/explore test regressed.

- [ ] **Step 6: Commit**

```bash
git add backend/services/analysis.js backend/services/curation.js backend/test/junkLyrics.test.js backend/test/curation.test.js
git commit -m "feat(lyrics): hide flagged songs' analysis everywhere; flagged reads as no lyrics; junk-lyrics queue"
```

---

### Task 4: Admin routes + frontend

**Files:**
- Modify: `backend/routes/admin.js` (curation section, near `/curation/counts`, ~line 1900)
- Create: `frontend/src/components/admin/JunkLyricsList.jsx`
- Modify: `frontend/src/components/admin/QueueRail.jsx`, `SongsArea.jsx`, `SongQueueList.jsx`, `Dashboard.jsx`, `Workbench.jsx`, `LyricsPanel.jsx`, `frontend/src/styles/admin.css`

**Interfaces:**
- Consumes: `junkLyrics.{scan,listJunk,dismiss}`, queue key `junk-lyrics`, `wb.junk_kind`.
- Produces: `GET /api/admin/junk-lyrics -> { rows }`; `POST /api/admin/junk-lyrics/scan -> { scanned, flagged, cleared }`; `POST /api/admin/workbench/:id/junk-dismiss -> { success: true }` (404 `{error}` when no lyrics row).

- [ ] **Step 1: Add the routes** — in `backend/routes/admin.js` add `const junkLyrics = require('../services/junkLyrics');` with the other service requires, then after the `/curation/counts` route:

```js
router.get('/junk-lyrics', async (req, res) => {
  try {
    res.json({ rows: await junkLyrics.listJunk(pool) });
  } catch (e) {
    console.error('junk lyrics list error:', e);
    res.status(500).json({ error: 'Failed to list junk lyrics', details: e.message });
  }
});

router.post('/junk-lyrics/scan', async (req, res) => {
  try {
    res.json(await junkLyrics.scan(pool));
  } catch (e) {
    console.error('junk lyrics scan error:', e);
    res.status(500).json({ error: 'Scan failed', details: e.message });
  }
});

router.post('/workbench/:id/junk-dismiss', async (req, res) => {
  try {
    await junkLyrics.dismiss(pool, parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'No lyrics for that song' });
    console.error('junk dismiss error:', e);
    res.status(500).json({ error: 'Failed to dismiss', details: e.message });
  }
});
```

Verify the routes with the live backend (nodemon reloads): `curl -s -H "X-Admin-Password: $PW" localhost:5000/api/admin/junk-lyrics | head -c 200` returns `{"rows":[]}` before any scan (PW from `backend/.env` without echoing it).

- [ ] **Step 2: Rail, queue label, Dashboard tile, SongsArea wiring**
  - `QueueRail.jsx`: in the *Needs work* group add `['junk-lyrics', 'Junk lyrics', false],` after the `no-video` entry.
  - `SongQueueList.jsx` `QUEUE_LABELS`: add `'junk-lyrics': 'Junk lyrics'` (the generic list is not used for it, but the label map stays complete).
  - `Dashboard.jsx` `TILES`: add `['junk-lyrics', 'Junk lyrics', false],` after `needs-video`.
  - `SongsArea.jsx`: add `'junk-lyrics'` to `SELECTABLE_QUEUES`; `import JunkLyricsList from './JunkLyricsList';`; and extend the render ternary so `activeQueue === 'junk-lyrics'` renders `<JunkLyricsList refreshKey={refreshKey} onChanged={() => { loadCounts(); setRefreshKey(k => k + 1); }} />` (same shape as the `inbox` branch).

- [ ] **Step 3: Create `JunkLyricsList.jsx`**

```jsx
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';

const KIND_LABELS = { error: 'Error message', youtube_description: 'YouTube description' };

// Songs whose stored "lyrics" look like a scraper error or a YouTube description. Not junk = keep the text and stop
// flagging it; Clear lyrics = blank the text, so the song falls into Needs lyrics. A flagged song's analysis is hidden
// publicly until the flag clears.
function JunkLyricsList({ refreshKey, onChanged }) {
  const [rows, setRows] = useState(null);   // null = loading
  const [msg, setMsg] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(() => {
    adminFetch('/api/admin/junk-lyrics')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('load failed')))
      .then(d => { setRows(d.rows || []); })
      .catch(() => { setRows([]); setMsg('Could not load the list.'); });
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const scan = async () => {
    setScanning(true); setMsg('');
    try {
      const r = await adminFetch('/api/admin/junk-lyrics/scan', { method: 'POST', body: {} });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Scan failed');
      setMsg(`Scanned ${d.scanned} lyrics: ${d.flagged} newly flagged, ${d.cleared} cleared.`);
      onChanged();
    } catch (e) { setMsg(e.message); } finally { setScanning(false); }
  };

  const act = async (row, kind) => {
    setBusyId(row.id); setMsg('');
    try {
      const r = kind === 'dismiss'
        ? await adminFetch(`/api/admin/workbench/${row.id}/junk-dismiss`, { method: 'POST', body: {} })
        : await adminFetch(`/api/admin/workbench/${row.id}/lyrics`, { method: 'PUT', body: { lyrics: '' } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Request failed');
      onChanged();
    } catch (e) { setMsg(e.message); load(); } finally { setBusyId(null); }
  };

  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      <div className="queue-toolbar">
        <h2>Junk lyrics</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={scan} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Scan for junk lyrics'}
        </button>
      </div>
      <p className="admin-stub">Stored lyrics that look like an error message or a YouTube description. While a song is listed here its analysis is hidden on the public site.</p>
      {msg && <div className="modal-result">{msg}</div>}
      {rows === null ? <div className="queue-empty">Loading…</div>
        : rows.length === 0 ? <div className="queue-empty">Nothing flagged. Run a scan to check every song.</div>
        : rows.map(row => (
          <div key={row.id} className="song-row-wrap junk-row">
            <div className="song-row">
              <span className="song-meta">
                <span className="song-title"><Link to={`/admin/song/${row.id}`}>{row.title}</Link></span>
                <span className="song-artist">{row.artists || '—'}</span>
                <span className="junk-snippet">{row.snippet}</span>
              </span>
              <span className="origin-tag">{KIND_LABELS[row.junk_kind] || row.junk_kind}</span>
              {row.has_analysis && <span className="miss-chip warn">analysis hidden</span>}
            </div>
            <button type="button" className="btn btn-secondary btn-sm song-row-action" disabled={busyId === row.id}
              onClick={() => act(row, 'dismiss')}>Not junk</button>
            <button type="button" className="btn btn-secondary btn-sm song-row-action" disabled={busyId === row.id}
              onClick={() => { if (window.confirm(`Clear the stored lyrics for "${row.title}"?`)) act(row, 'clear'); }}>Clear lyrics</button>
          </div>
        ))}
    </div>
  );
}
export default JunkLyricsList;
```

Append to `frontend/src/styles/admin.css`:

```css
.junk-snippet { display: block; color: var(--text-muted); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 52ch; }
.wb-junk { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; margin-bottom: var(--space-2); }
```

- [ ] **Step 4: Workbench banner** — `Workbench.jsx`: change the `<LyricsPanel … />` line to also pass `reload={reload}`. `LyricsPanel.jsx`: add `import { adminFetch } from '../../api/adminApi';`, accept `reload` in the props (`function LyricsPanel({ wb, savePanel, saveProcessing, reload })`), and directly under `<h2>Lyrics</h2>` add:

```jsx
      {wb.junk_kind && (
        <div className="wb-junk">
          <span className="miss-chip warn">
            These lyrics look like {wb.junk_kind === 'error' ? 'a scraper error message' : 'a YouTube description'}
            {wb.analysed ? ' — the analysis is hidden on the public site' : ''}.
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={async () => {
            const r = await adminFetch(`/api/admin/workbench/${wb.id}/junk-dismiss`, { method: 'POST', body: {} });
            if (r.ok) reload();
          }}>Not junk</button>
        </div>
      )}
```

(To clear them the curator edits/empties the lyrics text with the existing field; saving re-checks automatically.)

- [ ] **Step 5: Lint, build, and the stale-transform check**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors (6 pre-existing warnings), build clean. Then `touch` the edited `.jsx` files (the dev server has served stale transforms of subagent-edited files) and load `http://localhost:5173/` and a song page in a real browser to confirm nothing is blank. **Lint/build cannot see an undefined-identifier crash; the page load must be done.**

- [ ] **Step 6: Commit**

```bash
git add backend/routes/admin.js frontend/src/components/admin/JunkLyricsList.jsx frontend/src/components/admin/QueueRail.jsx frontend/src/components/admin/SongsArea.jsx frontend/src/components/admin/SongQueueList.jsx frontend/src/components/admin/Dashboard.jsx frontend/src/components/admin/Workbench.jsx frontend/src/components/admin/LyricsPanel.jsx frontend/src/styles/admin.css
git commit -m "feat(admin): Junk lyrics queue, scan, Not junk, workbench banner"
```

---

### Task 5: Live verification and docs

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `CLAUDE.md` (architecture bullet for `services/junkLyrics.js` + `lyricsQuality.js` and the "flagged ⇒ analysis hidden / counts as no lyrics" invariant)

- [ ] **Step 1: Live data check (reversible)** — against the dev DB, WITHOUT using the admin UI scan on the whole catalogue first: run a read-only dry count with a scratchpad script (`require` with absolute paths, run from the scratchpad, never from `backend/`, so nodemon does not restart): `classify` over every `song_lyrics` row and print counts per kind (expect ~185 error, ~29 youtube_description) and the ids of the borderline non-flagged candidates from the spec (43, 2584, 4897). Report the list to the curator.
- [ ] **Step 2: Public effect check** — pick one real **live** flagged-candidate song that has an analysis (use the dry-run output + `has_analysis`): note its public analysis via `GET /api/analysis/songs/:id` (or the song page), then `POST /api/admin/junk-lyrics/scan` is NOT yet run on all; instead flag just that one with a scratchpad script calling `junkLyrics.scan(pool, { songIds:[id] })`, confirm the public analysis disappears from the song page and the browse analysed count drops by one, then `dismiss` (or restore `junk_kind=NULL, junk_dismissed=false`) and confirm it returns. **Leave the real data as found** (record `junk_kind`/`junk_dismissed` before and restore them).
- [ ] **Step 3: Full gates** — `cd backend && node --test --test-concurrency=1` (all pass), `cd frontend && npm run lint && npm run build`. Measure the Explore points and browse-facet endpoints before/after the fragment change on the dev DB (`curl -w '%{time_total}'`); report if either regressed noticeably.
- [ ] **Step 4: Docs** — update `PROJECT_STATE.md` (Current State bullet, Next Tasks note that the curator must run **Scan** once and review the queue; Decision Log entry: flag on `song_lyrics`, conservative detector, hide-while-flagged, borderline ids; Changelog), `PROJECT_PLAN.md` (mark G), and `CLAUDE.md`.
- [ ] **Step 5: Commit** (docs paths explicit) and report. Do NOT merge or push until the curator has smoked it (open the Junk lyrics queue, press Scan, review a few rows, Not junk / Clear lyrics one, check a public page).

---

## Self-Review notes

- **Spec coverage:** §2 → Task 1; §3 → Task 2; §4 → Task 2 (+ `saveLyrics` hook); §5 → Task 3; §6 → Tasks 3–4; §7 risks → Task 5 Step 3 (performance) and Review Focus; §8 testing → each task's tests plus Task 5.
- **Known gap by design:** ids 43, 2584, 4897 (a real Genius page and two blurbs containing real lyrics) are intentionally not flagged; Task 5 Step 1 reports them.
- **Type consistency:** `junk_kind` string|null everywhere; `scan` returns `{scanned, flagged, cleared}` in service, route and UI; queue key `junk-lyrics` in `QUEUE_NAMES`, rail, tiles, `SELECTABLE_QUEUES`.
- **Spec deviation recorded:** the Junk queue's rows use `GET /api/admin/junk-lyrics` (plan header).
