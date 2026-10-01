# Submissions Inbox (Sub-project C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Community song submissions become reviewable in the admin: an Inbox queue (oldest first) where the curator accepts a submission into *To be processed* or dismisses it.

**Architecture:** A new focused `backend/services/inbox.js` (list / accept / dismiss, taking `db` first like `curation.js`) is exposed by three new routes in `routes/admin.js` (already behind the admin-password middleware). The unauthenticated `/api/submissions/admin*` routes, the superseded `add-to-pending` route and the unmounted `SubmissionsManager.jsx` are deleted. The frontend adds one component, `InboxList.jsx`, rendered by `SongsArea` when the `inbox` queue is active. No migration.

**Tech Stack:** Node/Express + `pg`, `node:test` (backend, run with `npm test` in `backend/`), React 19 + Vite + react-router v7 (frontend), Puppeteer (smoke, installed in the scratchpad only).

**Spec:** [`docs/superpowers/specs/2026-10-01-C-submissions-inbox-design.md`](../specs/2026-10-01-C-submissions-inbox-design.md)

## Global Constraints

- Inbox order is **oldest first**: `ORDER BY created_at ASC, id ASC`.
- Inbox = `song_submissions.status = 'pending'` (catalogue matches **included**, shown with a badge).
- Statuses used: accept → `approved`, dismiss → `rejected` (both already allowed by the table's CHECK). **No migration.**
- Accept/dismiss only act on a `pending` submission — otherwise **409**; unknown id → **404**.
- `already_exists` returned to a submitter is true **only for a live match** (`songs.status='included' AND published=true`); `existing_song_id` is still stored for any match.
- Bad email / release year on `POST /submit` (Postgres error `23514`) → **400** with a plain message, never 500.
- Spam: **dismiss only** — no honeypot, no rate limit, no auto-classification.
- Styling uses the `--bg-*` / `--text-*` / `--space-*` tokens and existing classes (`.song-row-wrap`, `.btn`, `.queue-empty`); never raw colours.
- Backend test files use a **unique fixture prefix** (`ZZZINBOX`, `ZZZSUB`) — shared prefixes race under parallel runs. Tests run with `--test-concurrency=1` (already in `npm test`).
- **Never** put smoke/temp scripts in `backend/` (nodemon restarts the server mid-test). Run them from the scratchpad with absolute requires. **Never** `taskkill /IM node.exe`; target specific PIDs.
- Git: write commit messages to a file and use `git commit -F <file>`; run git from the repo root. End each commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- The 650-song curated dataset must not be touched: tests/smoke only create and delete `ZZZ…` rows; the two real submissions (ids 13, 14) must be left exactly as found.

## Review Focus

1. **Double-click / second accept of the same submission** — expected: the second call gets 409, no duplicate song. (Task 1 test.)
2. **A submission matching a song that is *not* live** (pending/rejected/unpublished) — expected: submitter is NOT told "already on the site", the Inbox still badges it, linking to the workbench. (Task 1 + Task 2 tests.)
3. **Typo'd email or year 1850 on the public form** — expected: a readable 400, not "Failed to submit". (Task 2 test.)
4. **Accept a submission whose song already exists in the catalogue (matched)** — expected: no new song is created. The UI hides Accept for matched rows (see Task 3), but the API must still be safe. (Task 1 test.)
5. **Empty Inbox / dismiss note blank or whitespace** — expected: "Inbox is clear" state; blank note stored as NULL. (Task 1 test + Task 3 UI.)

---

### Task 1: Inbox service + count

**Files:**
- Create: `backend/services/inbox.js`
- Create: `backend/test/inbox.test.js`
- Modify: `backend/services/curation.js:142-143` (inbox count)

**Interfaces:**
- Consumes: `staging.addSubmissionAsPending(db, submissionId) → { added, skippedExisting, song_id, matchedSpotify }`; `curation.queueCounts(db)`.
- Produces (used by Task 2):
  - `listInbox(db) → Promise<Array<{ id, song_title, artist_name, album_name, release_year, youtube_url, lyrics_excerpt, submission_reason, submitter_name, submitter_email, created_at, match: null | { song_id, title, live } }>>`
  - `acceptSubmission(db, id) → Promise<{ song_id, added }>` — throws `Error` with `.code` `'NOT_FOUND'` or `'NOT_PENDING'`.
  - `dismissSubmission(db, id, note) → Promise<void>` — same error codes; `note` is trimmed, blank → `NULL`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/inbox.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const inbox = require('../services/inbox');
const curation = require('../services/curation');

// Unique fixture sentinel for this file: ZZZINBOX.
async function mkSong({ title, status = 'pending', published = false, artist = 'ZZZINBOX Artist' }) {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source) VALUES ($1,$2,$3,'manual') RETURNING id`,
    [title, status, published])).rows[0];
  const a = (await pool.query(
    `INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [artist])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  return s.id;
}
async function mkSub({ title, artist = 'ZZZINBOX SubArtist', status = 'pending', created_at = null, existing_song_id = null }) {
  return (await pool.query(
    `INSERT INTO song_submissions (song_title, artist_name, status, existing_song_id, created_at)
     VALUES ($1,$2,$3,$4, COALESCE($5, CURRENT_TIMESTAMP)) RETURNING id`,
    [title, artist, status, existing_song_id, created_at])).rows[0].id;
}
const mine = (rows) => rows.filter(r => r.song_title.startsWith('ZZZINBOX'));

after(async () => {
  await pool.query(`DELETE FROM song_submissions WHERE song_title LIKE 'ZZZINBOX%'`);
  await pool.query(`DELETE FROM youtube_videos WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZINBOX%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZINBOX%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZINBOX%'`);
  await pool.end();
});

test('listInbox is oldest first and pending only', async () => {
  // inserted newest-first on purpose, so insertion order cannot explain the result
  await mkSub({ title: 'ZZZINBOX Newer', created_at: '2020-01-02' });
  await mkSub({ title: 'ZZZINBOX Older', created_at: '2020-01-01' });
  await mkSub({ title: 'ZZZINBOX Done', created_at: '2019-01-01', status: 'approved' });
  const rows = mine(await inbox.listInbox(pool));
  assert.deepEqual(rows.map(r => r.song_title), ['ZZZINBOX Older', 'ZZZINBOX Newer']);
  assert.equal(rows[0].match, null);
});

test('listInbox flags a catalogue match and whether it is live', async () => {
  const live = await mkSong({ title: 'ZZZINBOX LiveSong', status: 'included', published: true });
  const notLive = await mkSong({ title: 'ZZZINBOX PendingSong', status: 'pending' });
  await mkSub({ title: 'ZZZINBOX SubLive', existing_song_id: live, created_at: '2020-02-01' });
  await mkSub({ title: 'ZZZINBOX SubNotLive', existing_song_id: notLive, created_at: '2020-02-02' });
  const rows = mine(await inbox.listInbox(pool));
  const a = rows.find(r => r.song_title === 'ZZZINBOX SubLive');
  const b = rows.find(r => r.song_title === 'ZZZINBOX SubNotLive');
  assert.deepEqual(a.match, { song_id: live, title: 'ZZZINBOX LiveSong', live: true });
  assert.deepEqual(b.match, { song_id: notLive, title: 'ZZZINBOX PendingSong', live: false });
});

test('acceptSubmission creates a pending song, approves the row, and a second accept is NOT_PENDING', async () => {
  const id = await mkSub({ title: 'ZZZINBOX Accept Me', artist: 'ZZZINBOX NewArtist' });
  const r = await inbox.acceptSubmission(pool, id);
  assert.ok(r.song_id, 'song id returned');
  const song = (await pool.query('SELECT status FROM songs WHERE id=$1', [r.song_id])).rows[0];
  assert.equal(song.status, 'pending');
  const sub = (await pool.query('SELECT status, resolved_at FROM song_submissions WHERE id=$1', [id])).rows[0];
  assert.equal(sub.status, 'approved');
  assert.ok(sub.resolved_at);
  await assert.rejects(() => inbox.acceptSubmission(pool, id), (e) => e.code === 'NOT_PENDING');
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM songs WHERE title='ZZZINBOX Accept Me'`)).rows[0].n;
  assert.equal(n, 1, 'no duplicate song');
});

test('acceptSubmission on a matched submission creates no new song', async () => {
  const songId = await mkSong({ title: 'ZZZINBOX Matched', status: 'included', published: true });
  const id = await mkSub({ title: 'ZZZINBOX Matched', existing_song_id: songId });
  const before = (await pool.query(`SELECT COUNT(*)::int AS n FROM songs WHERE title='ZZZINBOX Matched'`)).rows[0].n;
  const r = await inbox.acceptSubmission(pool, id);
  assert.equal(r.song_id, songId);
  const after = (await pool.query(`SELECT COUNT(*)::int AS n FROM songs WHERE title='ZZZINBOX Matched'`)).rows[0].n;
  assert.equal(after, before);
});

test('acceptSubmission / dismissSubmission on an unknown id throw NOT_FOUND', async () => {
  await assert.rejects(() => inbox.acceptSubmission(pool, 999999999), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(() => inbox.dismissSubmission(pool, 999999999, ''), (e) => e.code === 'NOT_FOUND');
});

test('dismissSubmission rejects the row, stores a trimmed note, blank note is NULL, repeat is NOT_PENDING', async () => {
  const a = await mkSub({ title: 'ZZZINBOX Dismiss A' });
  const b = await mkSub({ title: 'ZZZINBOX Dismiss B' });
  await inbox.dismissSubmission(pool, a, '  looks like spam  ');
  await inbox.dismissSubmission(pool, b, '   ');
  const ra = (await pool.query('SELECT status, admin_notes, resolved_at FROM song_submissions WHERE id=$1', [a])).rows[0];
  const rb = (await pool.query('SELECT status, admin_notes FROM song_submissions WHERE id=$1', [b])).rows[0];
  assert.equal(ra.status, 'rejected');
  assert.equal(ra.admin_notes, 'looks like spam');
  assert.ok(ra.resolved_at);
  assert.equal(rb.admin_notes, null);
  await assert.rejects(() => inbox.dismissSubmission(pool, a, ''), (e) => e.code === 'NOT_PENDING');
});

test('queueCounts.inbox counts pending submissions including catalogue matches', async () => {
  const before = (await curation.queueCounts(pool)).inbox;
  const songId = await mkSong({ title: 'ZZZINBOX CountSong', status: 'included', published: true });
  await mkSub({ title: 'ZZZINBOX CountMatched', existing_song_id: songId });
  await mkSub({ title: 'ZZZINBOX CountPlain' });
  await mkSub({ title: 'ZZZINBOX CountDone', status: 'rejected' });
  const after = (await curation.queueCounts(pool)).inbox;
  assert.equal(after, before + 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`): `node --test --test-concurrency=1 test/inbox.test.js`
Expected: FAIL — `Cannot find module '../services/inbox'`.

- [ ] **Step 3: Implement the service**

Create `backend/services/inbox.js`:

```js
// Submissions Inbox (sub-project C): community suggestions awaiting a curator decision.
// Functions take `db` (pool or client) first, like services/curation.js.
const staging = require('./staging');

function coded(code, message) { const e = new Error(message); e.code = code; return e; }

// Oldest first (FIFO). A catalogue match is flagged, not hidden; `live` says whether
// the matched song is on the public site.
async function listInbox(db) {
  const r = await db.query(`
    SELECT ss.id, ss.song_title, ss.artist_name, ss.album_name, ss.release_year, ss.youtube_url,
           ss.lyrics_excerpt, ss.submission_reason, ss.submitter_name, ss.submitter_email, ss.created_at,
           s.id AS match_id, s.title AS match_title,
           (s.status = 'included' AND s.published = true) AS match_live
    FROM song_submissions ss
    LEFT JOIN songs s ON s.id = ss.existing_song_id
    WHERE ss.status = 'pending'
    ORDER BY ss.created_at ASC, ss.id ASC`);
  return r.rows.map(({ match_id, match_title, match_live, ...row }) => ({
    ...row,
    match: match_id ? { song_id: match_id, title: match_title, live: match_live } : null,
  }));
}

async function assertPending(db, id) {
  const cur = (await db.query('SELECT status FROM song_submissions WHERE id=$1', [id])).rows[0];
  if (!cur) throw coded('NOT_FOUND', 'submission not found');
  if (cur.status !== 'pending') throw coded('NOT_PENDING', `submission is already ${cur.status}`);
}

// Bridges the submission into the pending songs queue (staging dedupes against the
// catalogue, so a matched submission creates nothing), then marks it approved. The
// final UPDATE is guarded on status='pending' so a concurrent second accept loses cleanly.
async function acceptSubmission(db, id) {
  await assertPending(db, id);
  const bridged = await staging.addSubmissionAsPending(db, id);
  const u = await db.query(
    `UPDATE song_submissions SET status='approved', resolved_at=CURRENT_TIMESTAMP, resolved_by='admin'
     WHERE id=$1 AND status='pending'`, [id]);
  if (!u.rowCount) throw coded('NOT_PENDING', 'submission was already resolved');
  return { song_id: bridged.song_id, added: bridged.added };
}

async function dismissSubmission(db, id, note) {
  const text = typeof note === 'string' && note.trim() ? note.trim() : null;
  const u = await db.query(
    `UPDATE song_submissions SET status='rejected', admin_notes=$2, resolved_at=CURRENT_TIMESTAMP, resolved_by='admin'
     WHERE id=$1 AND status='pending'`, [id, text]);
  if (!u.rowCount) await assertPending(db, id); // distinguishes NOT_FOUND / NOT_PENDING
}

module.exports = { listInbox, acceptSubmission, dismissSubmission };
```

- [ ] **Step 4: Change the Inbox count**

In `backend/services/curation.js`, replace

```js
  // inbox = community submissions not yet bridged to a song (list/moderation is sub-project C)
  out.inbox = (await db.query(`SELECT COUNT(*)::int AS n FROM song_submissions WHERE existing_song_id IS NULL`)).rows[0].n;
```

with

```js
  // inbox = pending community submissions (sub-project C; catalogue matches are included, badged in the UI)
  out.inbox = (await db.query(`SELECT COUNT(*)::int AS n FROM song_submissions WHERE status='pending'`)).rows[0].n;
```

- [ ] **Step 5: Run to verify it passes**

Run (from `backend/`): `node --test --test-concurrency=1 test/inbox.test.js`
Expected: 7 tests PASS. (A `submission bridge: Spotify lookup failed` warning is normal — the bridge falls back to a manual song.)

- [ ] **Step 6: Commit**

```bash
git add backend/services/inbox.js backend/test/inbox.test.js backend/services/curation.js
# write message to a scratchpad file, then:
git commit -F <msgfile>   # "feat(inbox): inbox service (FIFO list, accept, dismiss) + pending-based count"
```

---

### Task 2: Routes, public submit fixes, remove the unauthenticated routes

**Files:**
- Modify: `backend/routes/admin.js:1824-1835` (replace the `add-to-pending` route with the three inbox routes)
- Modify: `backend/routes/submissions.js` (delete lines 91–282, the `/admin*` routes; fix `/submit`)
- Create: `backend/test/submissions.test.js`

**Interfaces:**
- Consumes: `inbox.listInbox / acceptSubmission / dismissSubmission` from Task 1.
- Produces (used by Task 3):
  - `GET  /api/admin/curation/inbox` → `{ rows: [...] }` (shape of `listInbox`)
  - `POST /api/admin/curation/inbox/:id/accept` → `{ success: true, song_id, added }`; 404 / 409 on `NOT_FOUND` / `NOT_PENDING`
  - `POST /api/admin/curation/inbox/:id/dismiss` body `{ note? }` → `{ success: true }`; 404 / 409 likewise
  - `POST /api/submissions/submit` → 201 `{ message, submission: { id, song_title, artist_name, already_exists, status, created_at } }` where `already_exists` = live match only; 400 `{ error }` for bad email/year.

- [ ] **Step 1: Write the failing test for `/submit`**

Create `backend/test/submissions.test.js` (fixture prefix `ZZZSUB`; the route is mounted on an ephemeral-port express app so no running server is needed):

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const pool = require('../database/db');
const router = require('../routes/submissions');

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/submissions', router);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/submissions`;
});
after(async () => {
  await new Promise(r => server.close(r));
  await pool.query(`DELETE FROM song_submissions WHERE song_title LIKE 'ZZZSUB%'`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZSUB%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZSUB%'`);
  await pool.end();
});

async function mkSong(title, status, published, artist) {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source) VALUES ($1,$2,$3,'manual') RETURNING id`,
    [title, status, published])).rows[0];
  const a = (await pool.query(`INSERT INTO artists (name, data_source) VALUES ($1,'manual') RETURNING id`, [artist])).rows[0];
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [s.id, a.id]);
  return s.id;
}
const post = (body) => fetch(`${base}/submit`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('a live catalogue match is reported as already_exists', async () => {
  const songId = await mkSong('ZZZSUB Live Song', 'included', true, 'ZZZSUB LiveArtist');
  const res = await post({ song_title: 'ZZZSUB Live Song', artist_name: 'ZZZSUB LiveArtist' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.submission.already_exists, true);
  const row = (await pool.query('SELECT existing_song_id FROM song_submissions WHERE id=$1', [body.submission.id])).rows[0];
  assert.equal(row.existing_song_id, songId);
});

test('a match that is NOT live is stored as a match but not reported to the submitter', async () => {
  const songId = await mkSong('ZZZSUB Pending Song', 'pending', false, 'ZZZSUB PendArtist');
  const res = await post({ song_title: 'ZZZSUB Pending Song', artist_name: 'ZZZSUB PendArtist' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.submission.already_exists, false);
  const row = (await pool.query('SELECT existing_song_id FROM song_submissions WHERE id=$1', [body.submission.id])).rows[0];
  assert.equal(row.existing_song_id, songId);
});

test('a live match wins over a not-live match for the same title and artist', async () => {
  await mkSong('ZZZSUB Twin', 'rejected', false, 'ZZZSUB TwinArtist');
  const liveId = await mkSong('ZZZSUB Twin', 'included', true, 'ZZZSUB TwinArtist');
  const res = await post({ song_title: 'ZZZSUB Twin', artist_name: 'ZZZSUB TwinArtist' });
  const body = await res.json();
  assert.equal(body.submission.already_exists, true);
  const row = (await pool.query('SELECT existing_song_id FROM song_submissions WHERE id=$1', [body.submission.id])).rows[0];
  assert.equal(row.existing_song_id, liveId);
});

test('a malformed email returns 400 with a readable message, and stores nothing', async () => {
  const res = await post({ song_title: 'ZZZSUB BadEmail', artist_name: 'ZZZSUB X', submitter_email: 'not-an-email' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /email/i);
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM song_submissions WHERE song_title='ZZZSUB BadEmail'`)).rows[0].n;
  assert.equal(n, 0);
});

test('an out-of-range release year returns 400 with a readable message', async () => {
  const res = await post({ song_title: 'ZZZSUB BadYear', artist_name: 'ZZZSUB X', release_year: 1850 });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /year/i);
});

test('missing title or artist still returns 400', async () => {
  const res = await post({ song_title: '', artist_name: 'ZZZSUB X' });
  assert.equal(res.status, 400);
});

test('the unauthenticated /admin routes are gone', async () => {
  assert.equal((await fetch(`${base}/admin`)).status, 404);
  assert.equal((await fetch(`${base}/admin/1`, { method: 'DELETE' })).status, 404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`): `node --test --test-concurrency=1 test/submissions.test.js`
Expected: FAIL — the non-live case reports `already_exists: true`, the bad-email case returns 500, and `/admin` returns 200.

- [ ] **Step 3: Fix `POST /submit` and delete the admin routes**

In `backend/routes/submissions.js`:

1. Replace the `existingSongQuery` constant so it also selects status/published and prefers a live match:

```js
    const existingSongQuery = `
      SELECT s.id, s.title, s.spotify_url, a.name as artist_name,
             (s.status = 'included' AND s.published = true) AS is_live
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      WHERE LOWER(a.name) = LOWER($2)
      AND (
        LOWER(s.title) = LOWER($1) OR
        LOWER(s.title) LIKE LOWER($1) || '%' OR
        LOWER(REGEXP_REPLACE(s.title, ' - \\d+ Remaster$', '', 'i')) = LOWER($1) OR
        LOWER(REGEXP_REPLACE(s.title, ' \\(.*\\)$', '', 'i')) = LOWER($1)
      )
      ORDER BY (s.status = 'included' AND s.published = true) DESC, s.id
      LIMIT 1
    `;
```

2. Directly after `const existing_song_id = ...`, add:

```js
    const matchIsLive = existingSong.rows.length > 0 && existingSong.rows[0].is_live === true;
```

3. In the 201 response change `already_exists: existing_song_id !== null,` to `already_exists: matchIsLive,`.

4. In the `/submit` `catch`, before the generic 500, map constraint violations:

```js
    if (error.code === '23514') {
      const msg = error.constraint === 'valid_email'
        ? 'Please check the email address — it does not look valid.'
        : error.constraint === 'valid_year'
          ? 'Please check the release year — it should be between 1900 and next year.'
          : 'Please check the details you entered.';
      return res.status(400).json({ error: msg });
    }
```

5. Delete everything from the `// Get all submissions for admin` comment (line 91) to just above `module.exports` (the `GET /admin`, `GET /admin/:id`, `PUT /admin/:id/status` and `DELETE /admin/:id` handlers). Keep `module.exports = router;`.

- [ ] **Step 4: Add the three inbox routes; remove `add-to-pending`**

In `backend/routes/admin.js` add `const inbox = require('../services/inbox');` beside the other service requires (line ~8). Replace the whole `// Submissions → pending bridge … router.post('/submissions/:id/add-to-pending' …)` block (lines 1824–1835) with:

```js
// ==================== Submissions Inbox (Sub-project C) ====================
// Community suggestions awaiting a decision, oldest first. Accept bridges into the
// pending queue (staging dedupes); dismiss rejects. Both 409 unless still pending.

function inboxError(res, e, label) {
  if (e.code === 'NOT_FOUND') return res.status(404).json({ error: 'Submission not found' });
  if (e.code === 'NOT_PENDING') return res.status(409).json({ error: e.message });
  console.error(`inbox ${label} error:`, e);
  return res.status(500).json({ error: `Failed to ${label}`, details: e.message });
}

router.get('/curation/inbox', async (req, res) => {
  try {
    res.json({ rows: await inbox.listInbox(pool) });
  } catch (e) { inboxError(res, e, 'load the inbox'); }
});

router.post('/curation/inbox/:id/accept', async (req, res) => {
  try {
    const out = await inbox.acceptSubmission(pool, parseInt(req.params.id));
    res.json({ success: true, ...out });
  } catch (e) { inboxError(res, e, 'accept the submission'); }
});

router.post('/curation/inbox/:id/dismiss', async (req, res) => {
  try {
    await inbox.dismissSubmission(pool, parseInt(req.params.id), (req.body || {}).note);
    res.json({ success: true });
  } catch (e) { inboxError(res, e, 'dismiss the submission'); }
});
```

Also update the `admin.js` header comment / `CLAUDE.md` route counts in Task 4 (29 routes → 31: −1 `add-to-pending`, +3 inbox).

- [ ] **Step 5: Run the full backend suite**

Run (from `backend/`): `npm test`
Expected: all pass (previous 179 + 7 inbox + 7 submissions = 193; the lyrics-privacy test still passes since `submissions.js` has no `song_lyrics`).

- [ ] **Step 6: Commit**

```bash
git add backend/routes/admin.js backend/routes/submissions.js backend/test/submissions.test.js
git commit -F <msgfile>   # "feat(inbox): admin inbox routes; live-only already_exists + 400s on /submit; remove unauthenticated submissions admin routes"
```

---

### Task 3: Frontend — Inbox UI, form fix, delete the legacy manager

**Files:**
- Create: `frontend/src/components/admin/relTime.js`
- Create: `frontend/src/components/admin/InboxList.jsx`
- Modify: `frontend/src/components/admin/Dashboard.jsx` (import `relTime`; enable the Inbox tile)
- Modify: `frontend/src/components/admin/QueueRail.jsx`
- Modify: `frontend/src/components/admin/SongsArea.jsx`
- Modify: `frontend/src/styles/admin.css` (append Inbox styles)
- Modify: `frontend/src/components/SongSubmissionForm.jsx:86-92`
- Delete: `frontend/src/components/SubmissionsManager.jsx`; the `/* Submissions Manager Styles */` … `/* Responsive Design for Submissions */` blocks in `frontend/src/App.css` (lines ~4042–4421, up to but not including `/* Artists listing …`)

**Interfaces:**
- Consumes: the three admin routes from Task 2; `adminFetch(path, { method, body })`.
- Produces: `InboxList({ refreshKey, onChanged })`; `relTime(ts) → string`.

- [ ] **Step 1: Share `relTime`**

Create `frontend/src/components/admin/relTime.js` by moving the function out of `Dashboard.jsx` verbatim:

```js
// "just now" / "5m ago" / "3h ago" / "2d ago".
export function relTime(ts) {
  if (!ts) return '';
  const secs = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
```

In `Dashboard.jsx` delete the local `relTime` function, add `import { relTime } from './relTime';`, and enable the tile: change `['inbox', 'Inbox', true],` to `['inbox', 'Inbox', false],` and update the comment above `TILES` to `// Action tiles: [queueKey, label, disabled].`

- [ ] **Step 2: Enable the rail slot and select the queue**

`QueueRail.jsx`: change `['inbox', 'Inbox', true]` to `['inbox', 'Inbox', false]` and the header comment to say only Needs analysis remains reserved (sub-project B).

`SongsArea.jsx`: add `'inbox'` as the first entry of `SELECTABLE_QUEUES`, replace its explanatory comment with `// Only these queues are selectable — Needs analysis is rail-disabled (reserved for sub-project B). Guard against a stale/typo'd ?queue= landing on a queue that cannot render.`, import `InboxList`, and render it:

```jsx
import InboxList from './InboxList';
...
        {activeQueue === 'inbox'
          ? <InboxList refreshKey={refreshKey} onChanged={() => { loadCounts(); setRefreshKey(k => k + 1); }} />
          : <SongQueueList queue={activeQueue} refreshKey={refreshKey} />}
```

(replacing the single `<SongQueueList … />` line).

- [ ] **Step 3: Create `InboxList.jsx`**

```jsx
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import { relTime } from './relTime';

// The Inbox: pending community submissions, oldest first. A catalogue match shows a badge
// and a link instead of an Accept button (nothing to add) — Dismiss clears it.
function InboxList({ refreshKey, onChanged }) {
  const [rows, setRows] = useState(null);       // null = loading
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(null);     // { title, songId } after an accept
  const [busyId, setBusyId] = useState(null);
  const [dismissingId, setDismissingId] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    adminFetch('/api/admin/curation/inbox')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('load failed')))
      .then(d => { setRows(d.rows || []); setError(''); })
      .catch(() => { setRows([]); setError('Could not load the inbox.'); });
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const act = async (row, kind) => {
    setBusyId(row.id); setError('');
    try {
      const r = await adminFetch(`/api/admin/curation/inbox/${row.id}/${kind}`, {
        method: 'POST', body: kind === 'dismiss' ? { note } : undefined,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Request failed');
      setFlash(kind === 'accept' && d.song_id ? { title: row.song_title, songId: d.song_id } : null);
      setDismissingId(null); setNote('');
      onChanged();
    } catch (e) {
      setError(e.message);
      load(); // the row may already have been resolved elsewhere
    } finally { setBusyId(null); }
  };

  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      <div className="queue-toolbar"><h2>Inbox</h2></div>
      {error && <div className="admin-message error">{error}</div>}
      {flash && (
        <div className="admin-message success">
          Added “{flash.title}” to To be processed — <Link to={`/admin/song/${flash.songId}`}>open in workbench</Link>
        </div>
      )}
      {rows === null ? (
        <div className="queue-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="queue-empty">Inbox is clear.</div>
      ) : rows.map(row => (
        <div key={row.id} className="inbox-row">
          <div className="inbox-head">
            <span className="song-title">{row.song_title}</span>
            <span className="song-artist">{row.artist_name}</span>
            <span className="admin-stub">{relTime(row.created_at)}</span>
            {row.match && (
              <Link className="miss-chip warn" to={`/admin/song/${row.match.song_id}`}>
                Already in catalogue{row.match.live ? ' (live)' : ' (not live)'}
              </Link>
            )}
          </div>
          <div className="inbox-detail">
            {(row.submitter_name || row.submitter_email) && (
              <div>From {[row.submitter_name, row.submitter_email].filter(Boolean).join(' · ')}</div>
            )}
            {row.submission_reason && <div>“{row.submission_reason}”</div>}
            {row.album_name && <div>Album: {row.album_name}{row.release_year ? ` (${row.release_year})` : ''}</div>}
            {!row.album_name && row.release_year && <div>Year: {row.release_year}</div>}
            {row.youtube_url && <div><a href={row.youtube_url} target="_blank" rel="noreferrer">YouTube link</a></div>}
            {row.lyrics_excerpt && <div className="inbox-excerpt">{row.lyrics_excerpt}</div>}
          </div>
          <div className="inbox-actions">
            {!row.match && (
              <button className="btn btn-primary btn-sm" disabled={busyId === row.id}
                onClick={() => act(row, 'accept')}>Add to To be processed</button>
            )}
            {dismissingId === row.id ? (
              <>
                <input className="input" placeholder="Note (optional)" value={note}
                  onChange={(e) => setNote(e.target.value)} />
                <button className="btn btn-secondary btn-sm" disabled={busyId === row.id}
                  onClick={() => act(row, 'dismiss')}>Confirm dismiss</button>
                <button className="btn btn-secondary btn-sm"
                  onClick={() => { setDismissingId(null); setNote(''); }}>Cancel</button>
              </>
            ) : (
              <button className="btn btn-secondary btn-sm" disabled={busyId === row.id}
                onClick={() => { setDismissingId(row.id); setNote(''); }}>Dismiss</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
export default InboxList;
```

Note for implementers: the spec §5 lists both buttons on every row. This plan deliberately **hides Accept on matched rows** (accepting one is a no-op that would mark it approved and create nothing; the badge links to the song instead). The API still handles accept-on-a-match safely (Task 1 test).

- [ ] **Step 4: Append the Inbox styles to `frontend/src/styles/admin.css`**

```css
/* Inbox (sub-project C) — `.admin-message.success` did not exist; mirrors `.error` with the moss accent */
.admin-message.success { color: var(--accent-moss-60); background: var(--bg-surface-raised); border: 1px solid var(--accent-moss-50); border-radius: var(--radius-md); padding: var(--space-2) var(--space-3); margin-bottom: var(--space-3); font-size: 0.85rem; }
.inbox-row { padding: var(--space-3) var(--space-2); border-bottom: 1px solid var(--border-hairline); display: flex; flex-direction: column; gap: var(--space-2); }
.inbox-head { display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; }
.inbox-detail { font-size: 0.85rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: var(--space-1); }
.inbox-excerpt { white-space: pre-wrap; color: var(--text-muted); border-left: 2px solid var(--border-hairline); padding-left: var(--space-3); }
.inbox-actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.inbox-actions .input { flex: 1; min-width: 160px; max-width: 320px; }
```

- [ ] **Step 5: Fix the public form**

In `SongSubmissionForm.jsx`, replace `text: result.already_exists` with `text: result.submission.already_exists` and change the already-exists wording to `We found "${result.submission.song_title}" by ${result.submission.artist_name} is already on the site — thanks anyway! Your suggestion has been noted for review.`. The existing `else` branch already shows `result.error`, which now carries the 400 messages. (Leave the hard-coded `http://localhost:5000` — Phase 5.)

- [ ] **Step 6: Delete the legacy manager**

```bash
git rm frontend/src/components/SubmissionsManager.jsx
```

In `frontend/src/App.css` delete from `/* Submissions Manager Styles */` through the end of the `/* Responsive Design for Submissions */` media-query block (the line just before `/* Artists listing (cards, grid, responsive)…`). Then verify:

Run: `grep -rn "submissions-manager\|submission-main\|SubmissionsManager" frontend/src` — expected: no output.

- [ ] **Step 7: Lint and build**

Run (from `frontend/`): `npm run lint && npm run build`
Expected: 0 errors (the 6 existing warnings only), build succeeds.

- [ ] **Step 8: Commit**

```bash
git add -A frontend/src
git commit -F <msgfile>   # "feat(inbox): Inbox queue UI; public form shows live-match message; delete SubmissionsManager"
```

---

> **Post-review amendments (2026-10-01, from the final whole-branch review).** (1) `acceptSubmission` is **claim-first**:
> it flips the row to `approved` and clears `existing_song_id` before bridging, and reverts to `pending` (restoring the
> match) if the bridge throws or yields no song (`NO_SONG`). (2) **Accept is shown on matched rows** — Task 3's "hide
> Accept on matches" was wrong: the submit-time match is a fuzzy prefix match. (3) The banner distinguishes
> added from already-in-catalogue. (4) `/submit` rejects whitespace-only titles and escapes LIKE wildcards.
> (5) `.stat-label` in `App.css` regained the uppercase/letter-spacing the deleted block used to merge in.

### Task 4: Live smoke, docs, push

**Files:**
- Create (scratchpad only, never committed): `smoke-inbox.cjs`
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `CLAUDE.md`, `docs/PRD.md` (only if its feature inventory lists submissions admin)

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Start the stack and install Puppeteer in the scratchpad**

Check what already serves `:5000` and the Vite port before starting anything (the launch method varies — plain node vs nodemon; do not claim a restart is needed without checking the process tree). The running backend is nodemon in dev, so the new routes load automatically; if `:5000` is not up, start `cd backend && npm run dev` and `cd frontend && npm run dev` in the background. In the scratchpad directory: `npm init -y && npm install puppeteer`.

- [ ] **Step 2: Write and run `smoke-inbox.cjs` (scratchpad)**

The admin login is **client-side state** — a full page reload logs out — so after the first `goto('/admin')` and login, navigate only by clicking in-app links. The script reads the admin password from `backend/.env` (absolute path). It must:

1. `POST /api/submissions/submit` (via `fetch`) three rows titled `ZZZSMOKE A`, `ZZZSMOKE B`, and `ZZZSMOKE Live` where the last matches a currently live catalogue song (pick one by querying `GET /api/spotify/songs/featured` or any public song and reuse its exact title/artist). Assert the third response has `already_exists: true`, the first two `false`.
2. Open `/admin`, log in, click **Songs**, click **Inbox**; assert the three `ZZZSMOKE` rows are present, that A is listed **before** B (FIFO), and that the Live row shows "Already in catalogue (live)" and **no** "Add to To be processed" button. Assert the rail/tile Inbox count includes them.
3. Click **Add to To be processed** on A; assert the success banner "open in workbench" appears, A leaves the list, and the **To be processed** queue now contains `ZZZSMOKE A`.
4. Click **Dismiss** on B → type a note → **Confirm dismiss**; assert B leaves the list.
5. Click **Dismiss** → **Confirm dismiss** on the Live row; assert the Inbox shows only the real submissions (ids 13, 14 — `Waste not want not`, `Peacemeal`) — they must still be present and untouched.
6. Narrow the viewport to 390px and assert the Inbox row has no horizontal page scroll.
7. **Cleanup in a `finally`:** delete `song_submissions WHERE song_title LIKE 'ZZZSMOKE%'`, the bridged song (`songs WHERE title LIKE 'ZZZSMOKE%'`) with its `youtube_videos`/`song_artists`, and `artists WHERE name LIKE 'ZZZSMOKE%'` — using absolute requires of `backend/database/db.js` from the scratchpad. Then verify the real submissions 13 and 14 are still `pending` with unchanged text.

Expected: all checks pass; print a PASS/FAIL line per check. If a check fails, diagnose the cause (systematic-debugging) — do not weaken the assertion.

- [ ] **Step 3: Docs (End-Session Guide)**

- `docs/PROJECT_STATE.md`: advance "Current session" to C built; refresh Next Tasks (D, E, F remain); add a Changelog entry and Decision-Log entries for (a) catalogue matches shown in the Inbox, (b) live-only `already_exists`, (c) auth gap closed by removing `/api/submissions/admin*`, (d) Accept hidden on matched rows, (e) spam = dismiss-only (YAGNI). Record the verified counts: backend test total, lint, build size, smoke result.
- `docs/PROJECT_PLAN.md`: mark C ☑.
- `CLAUDE.md`: server.js/routes bullet — `admin.js` route count 29 → 31 and add "Submissions Inbox" to its domains; remove the "`/api/submissions/admin*` is currently unauthenticated" note; mention `services/inbox.js` beside `services/staging.js`; frontend: `components/admin/InboxList.jsx`, and `SubmissionsManager` deleted.
- `docs/PRD.md` §11 only if it lists submissions moderation.
- Remove the stale "submissions-admin auth" item from the Phase 5 / Watch-outs text in `PROJECT_STATE.md`.

- [ ] **Step 4: Final gates, commit and push**

Run: `cd backend && npm test`, `cd frontend && npm run lint && npm run build` — report the actual numbers. Then:

```bash
git add -A docs CLAUDE.md
git commit -F <msgfile>   # "docs: record sub-project C (Submissions Inbox)"
git push
```

Report the smoke result honestly — including any check that was skipped or failed.
