# Fixes Round 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four curator-reported data-integrity/workbench bugs before B4: lyrics-save wiping the source URL + translation, processing-state saves clobbering each other (park reason not sticking), the duplicate detector flagging same-title/different-band, and no way to reach an arbitrary song by search.

**Architecture:** All backend fixes replace whole-row overwrites with provided-fields-only writes (the `add()` helper pattern already in `curation.js`). The duplicate detector is extracted from the `admin.js` route into a pure, unit-testable `services/duplicates.js`. The "reach any song" scope already exists in the backend (`queue='all'`); the work is exposing it in the UI and adding its count.

**Tech Stack:** Node/Express, PostgreSQL (`pg`), `node:test`; React/Vite frontend; `adminFetch` for admin API calls.

## Global Constraints

- **Never null-clobber curatorial fields.** A save that omits a field must preserve it; only an explicit empty value clears it.
- **No migration.** No schema change in this round.
- **Backend tests:** `cd backend && node --test` must stay fully green (currently 75/75; this round adds cases).
- **Frontend gates:** `cd frontend && npm run build` and `npx eslint src/` must both be clean.
- **Test fixture sentinel:** curation tests use the `ZZZCUR` prefix (see `test/curation.test.js` cleanup); reuse it for any new DB-touching curation cases. `duplicates.test.js` is pure (no DB) — no sentinel needed.
- **Admin API:** frontend admin calls go through `adminFetch` (relative `/api`, password header) — never hardcode `localhost:5000`.

**Spec:** [`../specs/2026-07-20-fixes-round-1-design.md`](../specs/2026-07-20-fixes-round-1-design.md). Note: planning revealed `setProcessing` has the same partial-update data-loss bug as `saveLyrics`; Task 2 fixes it (an expansion of the spec's "display-only" #2).

---

## Task 1: #1 — `saveLyrics` preserves source URL + translation

**Files:**
- Modify: `backend/services/curation.js` — `saveLyrics()` (~228-257), `queueWhere()` needs-lyrics (~51) + needs-analysis (~58), `listCurationQueue()` has_lyrics (~106), `getWorkbench()` completeness (~202)
- Test: `backend/test/curation.test.js`

**Interfaces:**
- Consumes: `getWorkbench(db, id)` (unchanged signature).
- Produces: `saveLyrics(db, id, { lyrics, source_url, translation, lyrics_status, lyrics_url, lyrics_source })` — a save that omits `source_url`/`translation` leaves them intact; clearing `lyrics` keeps the row. "Has lyrics" everywhere means `lyrics IS NOT NULL AND btrim(lyrics) <> ''`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/test/curation.test.js` (before the final `after` block is fine; tests are order-independent):

```js
test('saveLyrics with only lyrics preserves existing source_url and translation', async () => {
  const id = await mkSong({ title: 'ZZZCUR PreserveURL' });
  await curation.saveLyrics(pool, id, { lyrics: 'first', source_url: 'http://src.example/x', translation: 'trad' });
  await curation.saveLyrics(pool, id, { lyrics: 'edited lyrics only' });
  const row = (await pool.query('SELECT lyrics, source_url, translation FROM song_lyrics WHERE song_id=$1', [id])).rows[0];
  assert.equal(row.lyrics, 'edited lyrics only');
  assert.equal(row.source_url, 'http://src.example/x');
  assert.equal(row.translation, 'trad');
});

test('saveLyrics can still explicitly clear source_url', async () => {
  const id = await mkSong({ title: 'ZZZCUR ClearURL' });
  await curation.saveLyrics(pool, id, { lyrics: 'x', source_url: 'http://src.example/y' });
  await curation.saveLyrics(pool, id, { lyrics: 'x', source_url: '' });
  const row = (await pool.query('SELECT source_url FROM song_lyrics WHERE song_id=$1', [id])).rows[0];
  assert.ok(row.source_url === null || row.source_url === '');
});

test('clearing lyrics keeps the row and its source_url/translation; song reads as needing lyrics', async () => {
  const id = await mkSong({ title: 'ZZZCUR ClearLyrics', status: 'included', published: true });
  await curation.saveLyrics(pool, id, { lyrics: 'words', source_url: 'http://s/z', translation: 'tr' });
  await curation.saveLyrics(pool, id, { lyrics: '' });
  const row = (await pool.query('SELECT lyrics, source_url, translation FROM song_lyrics WHERE song_id=$1', [id])).rows[0];
  assert.ok(row, 'row still exists');
  assert.equal(row.source_url, 'http://s/z');
  assert.equal(row.translation, 'tr');
  const wb = await curation.getWorkbench(pool, id);
  assert.equal(wb.completeness.lyrics, false);
  const needsIds = (await curation.listCurationQueue(pool, { queue: 'needs-lyrics' })).rows.map(r => r.id);
  assert.ok(needsIds.includes(id), 'a lyrics-cleared included song appears in needs-lyrics');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/curation.test.js`
Expected: the three new tests FAIL (source_url/translation nulled after lyrics-only save; cleared-lyrics row deleted).

- [ ] **Step 3: Rewrite `saveLyrics` to write only provided fields**

Replace the body of `saveLyrics` (`backend/services/curation.js`) with:

```js
async function saveLyrics(db, id, { lyrics, source_url, translation, lyrics_status, lyrics_url, lyrics_source } = {}) {
  await assertSong(db, id);
  if (lyrics_status != null && !LYRICS_STATUSES.includes(lyrics_status)) {
    const e = new Error('invalid lyrics_status'); e.code = 'BAD_INPUT'; throw e;
  }
  // NULL param = "not provided" → COALESCE keeps the stored value; an empty
  // string is an explicit clear. Never overwrite source_url/translation just
  // because a lyrics-text save omitted them.
  const srcParam = source_url === undefined ? null : source_url;
  const transParam = translation === undefined ? null : translation;
  if (lyrics !== undefined) {
    if (lyrics == null || lyrics === '') {
      // Clearing the lyrics text keeps the row so source_url + translation
      // survive (curator decision 2026-07-20); only null the lyrics column.
      await db.query(
        `UPDATE song_lyrics SET lyrics=NULL,
           source_url  = COALESCE($2, source_url),
           translation = COALESCE($3, translation)
         WHERE song_id=$1`, [id, srcParam, transParam]);
    } else {
      await db.query(`
        INSERT INTO song_lyrics (song_id, lyrics, source_url, translation)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (song_id) DO UPDATE SET
          lyrics=EXCLUDED.lyrics,
          source_url  = COALESCE($3, song_lyrics.source_url),
          translation = COALESCE($4, song_lyrics.translation)`,
        [id, lyrics, srcParam, transParam]);
    }
  } else if (translation !== undefined || source_url !== undefined) {
    await db.query(`
      UPDATE song_lyrics SET
        translation = COALESCE($2, translation),
        source_url  = COALESCE($3, source_url)
      WHERE song_id=$1`,
      [id, transParam, srcParam]);
  }
  const sets = [], params = [id];
  const add = (col, val) => { if (val !== undefined) { params.push(val === '' ? null : val); sets.push(`${col}=$${params.length}`); } };
  add('lyrics_status', lyrics_status); add('lyrics_url', lyrics_url); add('lyrics_source', lyrics_source);
  if (sets.length) await db.query(`UPDATE songs SET ${sets.join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, params);
  return getWorkbench(db, id);
}
```

- [ ] **Step 4: Make "has lyrics" mean non-empty everywhere in `curation.js`**

Because a cleared-lyrics row now persists, row-existence no longer means "has lyrics." Apply these edits:

`queueWhere('needs-lyrics')` — change:
```js
      return `s.status='included' AND NOT EXISTS (SELECT 1 FROM song_lyrics sl WHERE sl.song_id=s.id)`;
```
to:
```js
      return `s.status='included' AND NOT EXISTS (SELECT 1 FROM song_lyrics sl
              WHERE sl.song_id=s.id AND sl.lyrics IS NOT NULL AND btrim(sl.lyrics) <> '')`;
```

`queueWhere('needs-analysis')` — change its `EXISTS (SELECT 1 FROM song_lyrics sl WHERE sl.song_id=s.id)` line to:
```js
              AND EXISTS (SELECT 1 FROM song_lyrics sl
                          WHERE sl.song_id=s.id AND sl.lyrics IS NOT NULL AND btrim(sl.lyrics) <> '')
```

`listCurationQueue` SELECT — change:
```js
           EXISTS (SELECT 1 FROM song_lyrics sl WHERE sl.song_id=s.id) AS has_lyrics,
```
to:
```js
           EXISTS (SELECT 1 FROM song_lyrics sl WHERE sl.song_id=s.id
                   AND sl.lyrics IS NOT NULL AND btrim(sl.lyrics) <> '') AS has_lyrics,
```

`getWorkbench` completeness — change `lyrics: !!lyricsRow,` to:
```js
    lyrics: !!(lyricsRow && lyricsRow.lyrics && lyricsRow.lyrics.trim()),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && node --test test/curation.test.js`
Expected: PASS (all three new tests + existing curation cases).

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && node --test`
Expected: all green (was 75; now higher).

- [ ] **Step 7: Commit**

```bash
git add backend/services/curation.js backend/test/curation.test.js
git commit -m "fix(fixes-1): saveLyrics no longer wipes source_url/translation; clearing lyrics keeps the row"
```

---

## Task 2: #2a — `setProcessing` preserves untouched fields

**Files:**
- Modify: `backend/services/curation.js` — `setProcessing()` (~13-33)
- Test: `backend/test/curation.test.js`

**Interfaces:**
- Produces: `setProcessing(db, songId, { snooze_until, park_reason, lyrics_tried, processing_note })` — a call updates only the keys present; omitted keys are preserved. `park_reason: ''` / `snooze_until: ''` clear that field. Returns the full processing row.

- [ ] **Step 1: Write the failing tests**

Add to `backend/test/curation.test.js`:

```js
test('setProcessing updates only provided fields (toggling avenues keeps park reason + note)', async () => {
  const id = await mkSong({ title: 'ZZZCUR ProcPreserve' });
  await curation.setProcessing(pool, id, { park_reason: 'listened_unclear', processing_note: 'keep me' });
  await curation.setProcessing(pool, id, { lyrics_tried: ['google'] });
  const p = await curation.getProcessing(pool, id);
  assert.equal(p.park_reason, 'listened_unclear');
  assert.equal(p.processing_note, 'keep me');
  assert.deepEqual(p.lyrics_tried, ['google']);
});

test('setProcessing can explicitly clear the park reason', async () => {
  const id = await mkSong({ title: 'ZZZCUR ProcClear' });
  await curation.setProcessing(pool, id, { park_reason: 'listened_unclear' });
  await curation.setProcessing(pool, id, { park_reason: '' });
  const p = await curation.getProcessing(pool, id);
  assert.equal(p.park_reason, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/curation.test.js`
Expected: FAIL — the avenue toggle nulls `park_reason`/`processing_note` under the current code.

- [ ] **Step 3: Rewrite `setProcessing`**

Replace the body of `setProcessing` with:

```js
async function setProcessing(db, songId, { snooze_until, park_reason, lyrics_tried, processing_note } = {}) {
  if ((await db.query('SELECT 1 FROM songs WHERE id=$1', [songId])).rows.length === 0) {
    const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e;
  }
  if (park_reason != null && park_reason !== '' && !PARK_REASONS.includes(park_reason)) {
    const e = new Error('invalid park_reason'); e.code = 'BAD_INPUT'; throw e;
  }
  // Ensure a row exists, then update only the fields actually provided — a
  // single-field save must never null the others.
  await db.query(
    `INSERT INTO song_processing (song_id, updated_at) VALUES ($1, CURRENT_TIMESTAMP)
     ON CONFLICT (song_id) DO NOTHING`, [songId]);
  const sets = [], params = [songId];
  const add = (col, val, cast = '') => { params.push(val); sets.push(`${col}=$${params.length}${cast}`); };
  if (snooze_until !== undefined) add('snooze_until', snooze_until || null);
  if (park_reason !== undefined) add('park_reason', park_reason || null);
  if (processing_note !== undefined) add('processing_note', processing_note ?? null);
  if (lyrics_tried !== undefined) add('lyrics_tried', JSON.stringify(Array.isArray(lyrics_tried) ? lyrics_tried : []), '::jsonb');
  if (sets.length) {
    await db.query(`UPDATE song_processing SET ${sets.join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE song_id=$1`, params);
  }
  const r = await db.query(
    `SELECT song_id, snooze_until, park_reason, lyrics_tried, processing_note
     FROM song_processing WHERE song_id=$1`, [songId]);
  return r.rows[0];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/curation.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && node --test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/services/curation.js backend/test/curation.test.js
git commit -m "fix(fixes-1): setProcessing updates only provided fields (stop clobbering park/snooze/note)"
```

---

## Task 3: #2b — Park control reflects the current parked state

**Files:**
- Modify: `frontend/src/components/admin/WorkbenchTopBar.jsx` — the Park `<select>` (~68) and Remind `<input type="date">` (~72-73)

**Interfaces:**
- Consumes: `wb.processing.park_reason` / `wb.processing.snooze_until` (already on the workbench payload; updated in state by `saveProcessing` in `Workbench.jsx:59`). `onPark(body)` returns `{ ok }`.

- [ ] **Step 1: Make the Park select controlled + add an un-park option**

In `WorkbenchTopBar.jsx`, replace:
```jsx
          <select className="select" defaultValue="" onChange={(e) => { if (e.target.value) { park({ park_reason: e.target.value }); e.target.value = ''; } }}>
            <option value="">Park…</option>
            {PARK_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className="input" type="date" title="Remind me later"
            onChange={(e) => { if (e.target.value) park({ snooze_until: e.target.value }); }} style={{ width: 175 }} />
```
with:
```jsx
          <select className="select" value={wb.processing?.park_reason || ''}
            onChange={(e) => park({ park_reason: e.target.value })}>
            <option value="">Not parked</option>
            {PARK_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className="input" type="date" title="Remind me later"
            value={wb.processing?.snooze_until ? String(wb.processing.snooze_until).slice(0, 10) : ''}
            onChange={(e) => park({ snooze_until: e.target.value })} style={{ width: 175 }} />
```

- [ ] **Step 2: Verify the build + lint are clean**

Run: `cd frontend && npm run build && npx eslint src/`
Expected: build succeeds; eslint 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/admin/WorkbenchTopBar.jsx
git commit -m "fix(fixes-1): park control shows the current parked reason + allows un-park"
```

---

## Task 4: #3 — Duplicate detection gates on title AND artist

**Files:**
- Create: `backend/services/duplicates.js`
- Modify: `backend/routes/admin.js` — top requires + `GET /duplicate-songs` handler (~1224-1374)
- Test: `backend/test/duplicates.test.js`

**Interfaces:**
- Produces: `findDuplicateGroups(songs)` where each song is `{ id, title, artists, created_at, popularity }` → returns `[{ groupId, songs, confidence, recommendedAction }]`. `isDuplicatePair(a, b)` → boolean, true only when titles AND artists both match. Exports also `normalizeText`, `titlesMatch`, `artistsMatch`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/duplicates.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { findDuplicateGroups, isDuplicatePair } = require('../services/duplicates');

test('same title, different artist is NOT a duplicate', () => {
  assert.equal(isDuplicatePair(
    { title: 'Hurt', artists: 'Nine Inch Nails' },
    { title: 'Hurt', artists: 'Johnny Cash' }), false);
});

test('same title, same artist (with a suffix) IS a duplicate', () => {
  assert.equal(isDuplicatePair(
    { title: 'Hurt', artists: 'Johnny Cash' },
    { title: 'Hurt (Remastered)', artists: 'Johnny Cash' }), true);
});

test('findDuplicateGroups groups only title+artist matches', () => {
  const songs = [
    { id: 1, title: 'Hurt', artists: 'Nine Inch Nails', created_at: '2020-01-01', popularity: 50 },
    { id: 2, title: 'Hurt', artists: 'Johnny Cash', created_at: '2021-01-01', popularity: 60 },
    { id: 3, title: 'Hurt (Live)', artists: 'Johnny Cash', created_at: '2019-01-01', popularity: 40 },
  ];
  const groups = findDuplicateGroups(songs);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].songs.map(s => s.id).sort(), [2, 3]);
  assert.equal(groups[0].songs[0].id, 3); // oldest first
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test test/duplicates.test.js`
Expected: FAIL with "Cannot find module '../services/duplicates'".

- [ ] **Step 3: Create the service**

Create `backend/services/duplicates.js`:

```js
// Duplicate-song detection. A pair is a candidate ONLY when the normalised
// title AND the normalised artist both match — the same conservative rule the
// 1.2/1.3 dedup used, so different bands sharing a song title are not flagged.

function normalizeText(text) {
  if (!text) return '';
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function titlesMatch(a, b) {
  const t1 = normalizeText(a), t2 = normalizeText(b);
  if (!t1 || !t2) return false;
  if (t1 === t2) return true;
  if (t1.includes(t2) || t2.includes(t1)) return true;
  const w1 = t1.split(' ').filter(w => w.length > 2);
  const w2 = t2.split(' ').filter(w => w.length > 2);
  if (!w1.length || !w2.length) return false;
  const common = w1.filter(w => w2.includes(w));
  return common.length / Math.max(w1.length, w2.length) >= 0.6;
}

function artistsMatch(a, b) {
  const a1 = normalizeText(a), a2 = normalizeText(b);
  if (!a1 || !a2) return false;
  return a1 === a2 || a1.includes(a2) || a2.includes(a1);
}

function isDuplicatePair(s1, s2) {
  return titlesMatch(s1.title, s2.title) && artistsMatch(s1.artists, s2.artists);
}

function findDuplicateGroups(songs) {
  const groups = [];
  const processed = new Set();
  for (let i = 0; i < songs.length; i++) {
    if (processed.has(songs[i].id)) continue;
    const dupes = [songs[i]];
    for (let j = i + 1; j < songs.length; j++) {
      if (processed.has(songs[j].id)) continue;
      if (isDuplicatePair(songs[i], songs[j])) { dupes.push(songs[j]); processed.add(songs[j].id); }
    }
    if (dupes.length > 1) {
      dupes.sort((a, b) => {
        if (a.created_at !== b.created_at) return new Date(a.created_at) - new Date(b.created_at);
        return (b.popularity || 0) - (a.popularity || 0);
      });
      groups.push({
        groupId: groups.length + 1,
        songs: dupes,
        confidence: dupes.length > 2 ? 'high' : 'medium',
        recommendedAction: `Keep "${dupes[0].title}" by ${dupes[0].artists} (oldest/most popular)`,
      });
    }
    processed.add(songs[i].id);
  }
  return groups;
}

module.exports = { normalizeText, titlesMatch, artistsMatch, isDuplicatePair, findDuplicateGroups };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test test/duplicates.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the route to the service**

In `backend/routes/admin.js`, add near the other top-of-file requires:
```js
const { findDuplicateGroups } = require('../services/duplicates');
```
Then in the `GET /duplicate-songs` handler, keep the `songsResult` SQL query as-is and **replace everything from `const songs = songsResult.rows;` through the end of the grouping loop** (i.e. the `normalize` helper, `calculateSimilarity`, and both `for` loops, up to but not including the `console.log('Found ...')`) with:
```js
    const duplicateGroups = findDuplicateGroups(songsResult.rows);
```
Leave the existing `console.log`, the `res.json({ success: true, duplicateGroups, summary: {...} })` (its `summary.totalSongs` must become `songsResult.rows.length`), and the `catch` untouched.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && node --test`
Expected: all green (duplicates + curation + everything else).

- [ ] **Step 7: Commit**

```bash
git add backend/services/duplicates.js backend/test/duplicates.test.js backend/routes/admin.js
git commit -m "fix(fixes-1): duplicate detector requires title AND artist match (extract to services/duplicates)"
```

---

## Task 5: #4 — Expose the "All songs" search scope

**Files:**
- Modify: `backend/services/curation.js` — `queueCounts()` keys (~122)
- Modify: `frontend/src/components/admin/QueueRail.jsx` — `GROUPS`
- Modify: `frontend/src/components/admin/SongsArea.jsx` — `SELECTABLE_QUEUES`
- Modify: `frontend/src/components/admin/SongQueueList.jsx` — `QUEUE_LABELS` + search placeholder
- Test: `backend/test/curation.test.js`

**Interfaces:**
- Consumes: existing `queueWhere('all')` → `TRUE` and `listCurationQueue({ queue: 'all', q })` (already supported).
- Produces: `queueCounts()` includes an `all` key (total song count); the Songs UI offers an "All songs" scope whose search spans the whole catalogue.

- [ ] **Step 1: Write the failing test**

Add to `backend/test/curation.test.js`:

```js
test('queueCounts includes an all-catalogue total', async () => {
  const c = await curation.queueCounts(pool);
  assert.equal(typeof c.all, 'number');
  assert.ok(c.all >= c.live, 'all songs >= live songs');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test test/curation.test.js`
Expected: FAIL — `c.all` is `undefined`.

- [ ] **Step 3: Add `all` to `queueCounts` keys**

In `backend/services/curation.js` `queueCounts()`, change:
```js
  const keys = ['to-process','awaiting-community','remind-later','needs-lyrics',
    'needs-cover','needs-video','needs-analysis','to-finalise','live'];
```
to append `'all'`:
```js
  const keys = ['to-process','awaiting-community','remind-later','needs-lyrics',
    'needs-cover','needs-video','needs-analysis','to-finalise','live','all'];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test test/curation.test.js`
Expected: PASS.

- [ ] **Step 5: Expose the scope in the Songs UI**

`frontend/src/components/admin/QueueRail.jsx` — append a group to `GROUPS`:
```js
  ['Everything', [['all', 'All songs', false]]],
```

`frontend/src/components/admin/SongsArea.jsx` — add `'all'` to `SELECTABLE_QUEUES`:
```js
const SELECTABLE_QUEUES = [
  'to-process', 'needs-lyrics', 'needs-cover', 'needs-video',
  'awaiting-community', 'remind-later', 'to-finalise', 'live', 'all',
];
```

`frontend/src/components/admin/SongQueueList.jsx` — add the label and a scope-aware placeholder. In `QUEUE_LABELS` add:
```js
  'live': 'Live', 'all': 'All songs',
```
and change the search input's placeholder:
```jsx
        <input className="input input-pill" placeholder={queue === 'all' ? 'Search all songs…' : 'Search this queue…'}
```

- [ ] **Step 6: Verify build + lint**

Run: `cd frontend && npm run build && npx eslint src/`
Expected: clean.

- [ ] **Step 7: Run full backend suite + commit**

Run: `cd backend && node --test` → green.
```bash
git add backend/services/curation.js backend/test/curation.test.js frontend/src/components/admin/QueueRail.jsx frontend/src/components/admin/SongsArea.jsx frontend/src/components/admin/SongQueueList.jsx
git commit -m "feat(fixes-1): All songs search scope in the admin Songs area"
```

---

## Task 6: #4 data fix — correct song/1's YouTube video (manual, curator-confirmed)

Not a TDD task — a one-off data correction, done once the "All songs" scope (Task 5) makes song 1 reachable.

- [ ] **Step 1: Inspect the current video**

Run (backend must have DB env): `cd backend && node -e "const p=require('./database/db'); p.query('SELECT s.id,s.title,yv.youtube_id,yv.video_title,yv.is_primary FROM songs s LEFT JOIN youtube_videos yv ON yv.song_id=s.id WHERE s.id=1').then(r=>{console.table(r.rows);return p.end();})"`
Expected: shows the wrong (Rick Astley) video row(s) attached to song 1.

- [ ] **Step 2: Confirm the correct video with the curator**

Ask the curator for the correct YouTube URL/ID for song 1 ("Some of My Best Friends Are Meat Eaters"), or propose one found via YouTube search and get explicit confirmation. **Do not guess** — this writes curatorial data.

- [ ] **Step 3: Apply the fix via the workbench**

In the running admin app: Songs → **All songs** → search the title → open the workbench → Video panel → remove the wrong video, add the confirmed one, set primary. (If the curator prefers, a targeted SQL `UPDATE youtube_videos … WHERE song_id=1` is equivalent — but the workbench path is the point of Task 5 and leaves an `updated_at` trail.)

- [ ] **Step 4: Verify on the public page**

Load the public song page for id 1 and confirm the correct video renders.

---

## End-of-round wrap (after all tasks reviewed & merged-ready)

- [ ] **Smoke test (curator-style):** start backend + frontend; in admin, edit a song's lyrics that has a source URL + translation → both survive; park a pending song → the reason shows and persists across an avenue toggle; open Data quality → a known same-title/different-band pair is no longer flagged; use All songs to reach + fix song 1's video. On the public site, confirm the fixed video.
- [ ] **Docs:** update `docs/PROJECT_STATE.md` (Changelog + Decision Log entry noting the setProcessing data-loss discovery) and, if you want it tracked in the roadmap, add a "Fixes Round 1" line. Note the remaining triaged items (thematic `key_focus_pipeline` switch, browse/search polish, featured redesign, About/AI page, B4) as the next rounds.
- [ ] **Merge:** `finishing-a-development-branch` — merge `session-fixes-round-1` no-ff to `main` and push after curator go-ahead.

---

## Self-review notes

- **Spec coverage:** #1 → Task 1; #2 → Tasks 2 (backend, expanded per discovery) + 3 (frontend); #3 → Task 4; #4 → Tasks 5 (code) + 6 (data). All spec sections covered.
- **Type consistency:** `findDuplicateGroups`/`isDuplicatePair` names match between service, tests, and route wiring. `saveLyrics`/`setProcessing`/`queueCounts` signatures unchanged for callers.
- **has-lyrics consistency:** the row-persistence change in Task 1 is matched by the four "non-empty" edits in the same task, plus the `needs-analysis` queue — no other `song_lyrics` existence check remains in `curation.js`.
- **Deviation from spec:** Task 2 fixes a backend data-loss bug the spec labeled "display-only." Flagged for the curator; the fix pattern mirrors Task 1.
