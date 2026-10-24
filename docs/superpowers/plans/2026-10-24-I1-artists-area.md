# Artists area (I1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken admin Artists page with an Artists area (queue rail + artist workbench) that owns artist details, links/identity and the catalogue (Band check) review, and fix the search error.

**Architecture:** A new `services/artists.js` (pure pg, `db` injected, like `bandCheck`) owns the queue predicates, list, read and update; four thin routes in `admin.js` replace the three old artist routes. The frontend gets `/admin/artists` (rail + list) and `/admin/artist/:id` (workbench: Details, Links, Catalogue, Notes). `BandCheck.jsx` is split: `IdentifyPanel` becomes the Links panel, `Review` becomes the Catalogue panel; the band list and the Songs > Band check view are retired along with `ArtistsManager`.

**Tech Stack:** Node/Express, PostgreSQL (`pg`), `node:test`; React 19 + Vite, react-router.

**Spec:** `docs/superpowers/specs/2026-10-24-I-artists-area-design.md` (this plan is I1; I2 - exclude, "new since reviewed" prompt - is a separate plan).

## Global Constraints

- YAGNI; every change weighed against "does this risk the 650-song curated dataset?" This plan writes **artist fields only**; it never writes `songs`.
- Migration 015 is additive and idempotent.
- Admin fetches go through `adminFetch` (relative `/api` URLs); never hardcode `localhost:5000` or the password header. Never type `ADMIN_PASSWORD`.
- Styling uses existing admin classes / `--*` tokens; no raw colours; no new explanatory chrome (definitional copy belongs on About pages).
- Nothing may log or rethrow a fetch error's message, URL or token (Band check rule; keep it when moving code).
- Backend tests: unique fixture sentinel per file (**ZZZART**); run with `cd backend && npm test` (serial). Never `taskkill /IM node.exe`; target PIDs. Do not create temp scripts inside `backend/` (nodemon restarts); use the scratchpad with absolute requires.
- `git add` explicit paths only (`backend/docs/` and `docs/examples/` are deliberately untracked). Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; on PowerShell write the message to a scratchpad file and use `git commit -F`.
- Do not use PowerShell whole-file read/replace/write on files with non-ASCII text; use the Edit tool per hunk.

## Review Focus

- Search with `%`, `_` or a quote in the term must not error or behave as a wildcard (the bug being fixed was a placeholder mismatch). Pinned in Task 1.
- A search term plus a queue plus paging together (count and list must agree). Pinned in Task 1.
- An artist with no songs, and one with all three identities null, must list without error. Pinned in Task 1.
- `PUT` with an empty name, a non-http(s) `website_url`, or an unknown field must be rejected / ignored, not written. Pinned in Task 1.
- A stale `?queue=` in the URL must fall back to the default queue, not render an empty broken list. Pinned in Task 5.
- Queue counts and queue lists must use the same predicates so a rail count never disagrees with its list. Pinned in Task 1.

---

### Task 1: Migration 015 and the artists service

**Files:**
- Create: `backend/database/migrations/015_artist_advocacy_none_needed.sql`
- Create: `backend/services/artists.js`
- Test: `backend/test/artists.test.js`

**Interfaces:**
- Consumes: `coded` from `backend/services/bandCheck/errors.js` (`coded(code, message)` returns an Error with `.code`).
- Produces (all `async`, first arg `db` = a pg Pool):
  - `QUEUES` - array of `{ key, label }` in rail order: `needs-identity`, `needs-check`, `needs-bio`, `needs-notes`, `done`, `all`.
  - `counts(db)` -> `{ 'needs-identity': n, 'needs-check': n, 'needs-bio': n, 'needs-notes': n, 'done': n, 'all': n }`.
  - `list(db, { queue='all', q='', limit=50, offset=0 })` -> `{ total, rows: [{ id, name, songs, live_songs, identity: {spotify,bandcamp,musicbrainz} (booleans), reviewed, has_bio, has_notes, none_needed }] }`. Unknown queue throws `BAD_INPUT`.
  - `get(db, id)` -> artist object (see test for exact keys) or throws `NOT_FOUND`.
  - `update(db, id, patch)` -> same shape as `get`. Whitelist: `name, bio, vegan_advocacy_notes, no_advocacy_notes_needed, website_url, genres, discography_reviewed, discography_review_notes`. Invalid input throws `BAD_INPUT`; missing artist throws `NOT_FOUND`.

- [ ] **Step 1: Write the migration**

`backend/database/migrations/015_artist_advocacy_none_needed.sql`:

```sql
-- 015 - artists area (sub-project I1). The curator can mark an artist "no advocacy notes needed" so it
-- can leave the Needs advocacy notes queue without inventing text. Additive, idempotent.
ALTER TABLE artists ADD COLUMN IF NOT EXISTS no_advocacy_notes_needed BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Apply it to the dev DB**

Run from `backend/` (a one-liner, no temp file):

```bash
cd backend && node -e "require('dotenv').config(); const fs=require('fs'); const p=require('./database/db'); p.query(fs.readFileSync('database/migrations/015_artist_advocacy_none_needed.sql','utf8')).then(()=>p.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='artists' AND column_name='no_advocacy_notes_needed'\")).then(r=>{console.log(r.rows);return p.end()})"
```

Expected: `[ { column_name: 'no_advocacy_notes_needed' } ]`. Run it twice; the second run must also succeed.

- [ ] **Step 3: Write the failing tests**

`backend/test/artists.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const svc = require('../services/artists');

// Fixture sentinel for this file: ZZZART.
async function mk(name, f = {}) {
  return (await pool.query(
    `INSERT INTO artists (name, spotify_id, bandcamp_url, musicbrainz_id, bio, vegan_advocacy_notes,
                          no_advocacy_notes_needed, discography_reviewed, data_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,   // artists_source_check ties spotify_id to data_source='spotify'
    [name, f.spotify_id || null, f.bandcamp_url || null, f.musicbrainz_id || null, f.bio || null,
     f.notes || null, !!f.none, !!f.reviewed, f.spotify_id ? 'spotify' : 'manual'])).rows[0].id;
}
async function mkSong(artistId, title, { status = 'included', published = true } = {}) {
  const id = (await pool.query(`INSERT INTO songs (title, status, published, data_source) VALUES ($1,$2,$3,'manual') RETURNING id`,
    [title, status, published])).rows[0].id;
  await pool.query(`INSERT INTO song_artists (song_id, artist_id) VALUES ($1,$2)`, [id, artistId]);
  return id;
}
async function clean() {
  await pool.query(`DELETE FROM song_artists WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZART%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZART%'`);
  await pool.query(`DELETE FROM artists WHERE name LIKE 'ZZZART%'`);
}
test('pre-clean leftovers from a crashed run', clean);
after(async () => { await clean(); await pool.end(); });

const ZQ = { q: 'ZZZART', limit: 200 };
const names = (r) => r.rows.map(x => x.name);

test('each queue lists exactly the artists its predicate describes, and counts agree with the lists', async () => {
  const MB = '11111111-2222-3333-4444-555555555555';
  await mk('ZZZART bare');                                                   // identity+check+bio+notes needed
  await mk('ZZZART ident', { bandcamp_url: 'https://x.bandcamp.com' });      // has identity
  await mk('ZZZART reviewed', { musicbrainz_id: MB, reviewed: true });
  await mk('ZZZART bio', { bio: 'A bio' });
  await mk('ZZZART notes', { notes: 'Some notes' });
  await mk('ZZZART none', { none: true });
  await mk('ZZZART done', { spotify_id: 'ZZZARTdddddddddddddddd', reviewed: true, bio: 'b', notes: 'n' });

  const L = async (queue) => names(await svc.list(pool, { queue, ...ZQ }));
  assert.deepEqual(await L('needs-identity'), ['ZZZART bio', 'ZZZART bare', 'ZZZART none', 'ZZZART notes'].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  assert.ok(!(await L('needs-identity')).includes('ZZZART ident'));
  assert.ok(!(await L('needs-check')).includes('ZZZART reviewed'));
  assert.ok((await L('needs-check')).includes('ZZZART bare'));
  assert.ok(!(await L('needs-bio')).includes('ZZZART bio'));
  assert.ok((await L('needs-bio')).includes('ZZZART bare'));
  assert.ok(!(await L('needs-notes')).includes('ZZZART notes'));
  assert.ok(!(await L('needs-notes')).includes('ZZZART none'), 'none-needed leaves the notes queue');
  assert.deepEqual(await L('done'), ['ZZZART done']);

  const c = await svc.counts(pool);
  for (const key of ['needs-identity', 'needs-check', 'needs-bio', 'needs-notes', 'done', 'all']) {
    assert.equal(c[key], (await svc.list(pool, { queue: key, limit: 1 })).total, `${key}: count must equal list total`);
  }
});

test('search is literal, combines with a queue and paging, and the total matches the list', async () => {
  await mk("ZZZART O'Brien");
  await mk('ZZZART 100% Real');
  await mk('ZZZART Under_score');
  const quote = await svc.list(pool, { q: "o'brien" });
  assert.deepEqual(names(quote), ["ZZZART O'Brien"]);
  assert.equal(quote.total, 1);
  assert.equal((await svc.list(pool, { q: 'ZZZART%' })).total, 0, '% is literal, not a wildcard');
  assert.equal((await svc.list(pool, { q: '100%' })).total, 1);
  assert.equal((await svc.list(pool, { q: 'ZZZART_' })).total, 0, '_ is literal, not a wildcard');
  const page2 = await svc.list(pool, { q: 'ZZZART', queue: 'needs-bio', limit: 2, offset: 2 });
  const all = await svc.list(pool, { q: 'ZZZART', queue: 'needs-bio', limit: 200 });
  assert.equal(page2.total, all.total);
  assert.deepEqual(names(page2), names(all).slice(2, 4));
});

test('rows carry song counts and flags; an artist with no songs lists fine; unknown queue is BAD_INPUT', async () => {
  const a = await mk('ZZZART counted', { bio: 'b' });
  await mkSong(a, 'ZZZART live', {}); await mkSong(a, 'ZZZART pend', { status: 'pending', published: false });
  const row = (await svc.list(pool, { q: 'ZZZART counted' })).rows[0];
  assert.deepEqual([row.songs, row.live_songs, row.has_bio, row.has_notes, row.reviewed, row.none_needed], [2, 1, true, false, false, false]);
  assert.deepEqual(row.identity, { spotify: false, bandcamp: false, musicbrainz: false });
  await assert.rejects(() => svc.list(pool, { queue: 'nope' }), { code: 'BAD_INPUT' });
});

test('get returns the full artist; missing id is NOT_FOUND', async () => {
  const id = await mk('ZZZART full', { bio: 'b', notes: 'n', bandcamp_url: 'https://f.bandcamp.com' });
  const a = await svc.get(pool, id);
  assert.equal(a.name, 'ZZZART full');
  for (const k of ['id', 'name', 'bio', 'vegan_advocacy_notes', 'no_advocacy_notes_needed', 'website_url', 'genres',
    'spotify_id', 'bandcamp_url', 'musicbrainz_id', 'discography_reviewed', 'discography_reviewed_date',
    'discography_review_notes', 'songs', 'live_songs']) assert.ok(k in a, `missing key ${k}`);
  assert.equal(a.bandcamp_url, 'https://f.bandcamp.com');
  await assert.rejects(() => svc.get(pool, 2147483000), { code: 'NOT_FOUND' });
});

test('update writes only whitelisted fields, validates, and stamps the review date', async () => {
  const id = await mk('ZZZART upd');
  let a = await svc.update(pool, id, { bio: 'New bio', vegan_advocacy_notes: 'N', no_advocacy_notes_needed: true,
    website_url: 'https://example.org', genres: ['punk', 'hardcore'], discography_review_notes: 'checked' });
  assert.deepEqual([a.bio, a.vegan_advocacy_notes, a.no_advocacy_notes_needed, a.website_url, a.genres, a.discography_review_notes],
    ['New bio', 'N', true, 'https://example.org', ['punk', 'hardcore'], 'checked']);
  a = await svc.update(pool, id, { discography_reviewed: true });
  assert.equal(a.discography_reviewed, true); assert.ok(a.discography_reviewed_date);
  a = await svc.update(pool, id, { discography_reviewed: false });
  assert.equal(a.discography_reviewed_date, null);
  a = await svc.update(pool, id, { website_url: '' });
  assert.equal(a.website_url, null, 'blank website clears it');
  // ignored fields: identity is written only by bandCheck.saveIdentity; unknown keys are dropped
  a = await svc.update(pool, id, { bandcamp_url: 'https://evil.example', spotify_id: 'x', bogus: 1, name: 'ZZZART upd2' });
  assert.equal(a.bandcamp_url, null); assert.equal(a.spotify_id, null); assert.equal(a.name, 'ZZZART upd2');
});

test('update rejects bad input without writing, and a missing artist is NOT_FOUND', async () => {
  const id = await mk('ZZZART guard');
  await assert.rejects(() => svc.update(pool, id, { name: '   ' }), { code: 'BAD_INPUT' });
  await assert.rejects(() => svc.update(pool, id, { website_url: 'javascript:alert(1)' }), { code: 'BAD_INPUT' });
  await assert.rejects(() => svc.update(pool, id, { genres: 'punk' }), { code: 'BAD_INPUT' });
  await assert.rejects(() => svc.update(pool, id, { no_advocacy_notes_needed: 'yes' }), { code: 'BAD_INPUT' });
  assert.equal((await svc.get(pool, id)).name, 'ZZZART guard');
  await assert.rejects(() => svc.update(pool, 2147483000, { bio: 'x' }), { code: 'NOT_FOUND' });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd backend && node --test test/artists.test.js`
Expected: FAIL - `Cannot find module '../services/artists'`.

- [ ] **Step 5: Implement the service**

`backend/services/artists.js`:

```js
// Artists service (sub-project I1): the admin Artists area's queues, list, read and update. Takes `db` (a pg Pool).
// The queue predicates live in ONE table below and feed both counts() and list(), so a rail count can never
// disagree with its list. Artist identity (spotify / bandcamp / musicbrainz) is NOT written here -
// bandCheck.saveIdentity is its single writer.
const { coded } = require('./bandCheck/errors');

const NO_IDENTITY = `COALESCE(a.spotify_id,'')='' AND COALESCE(a.bandcamp_url,'')='' AND a.musicbrainz_id IS NULL`;
const NOT_REVIEWED = `COALESCE(a.discography_reviewed,false)=false`;
const NO_BIO = `COALESCE(btrim(a.bio),'')=''`;
const NO_NOTES = `(COALESCE(btrim(a.vegan_advocacy_notes),'')='' AND NOT a.no_advocacy_notes_needed)`;

const PREDICATE = {
  'needs-identity': NO_IDENTITY,
  'needs-check': NOT_REVIEWED,
  'needs-bio': NO_BIO,
  'needs-notes': NO_NOTES,
  'done': `NOT (${NO_IDENTITY}) AND NOT (${NOT_REVIEWED}) AND NOT (${NO_BIO}) AND NOT ${NO_NOTES}`,
  'all': 'true',
};
const QUEUES = [
  { key: 'needs-identity', label: 'Needs identity' },
  { key: 'needs-check', label: 'Needs catalogue check' },
  { key: 'needs-bio', label: 'Needs bio' },
  { key: 'needs-notes', label: 'Needs advocacy notes' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All artists' },
];

const like = (s) => String(s).replace(/[\\%_]/g, c => '\\' + c);

async function counts(db) {
  const cols = Object.entries(PREDICATE).map(([k, p]) => `count(*) FILTER (WHERE ${p})::int AS "${k}"`).join(', ');
  return (await db.query(`SELECT ${cols} FROM artists a`)).rows[0];
}

async function list(db, { queue = 'all', q = '', limit = 50, offset = 0 } = {}) {
  const pred = PREDICATE[queue];
  if (!pred) throw coded('BAD_INPUT', 'Unknown queue');
  const lim = Math.min(Math.max(parseInt(limit) || 50, 1), 200), off = Math.max(parseInt(offset) || 0, 0);
  const pat = q ? `%${like(q)}%` : null;
  // One filter, built once, used by BOTH queries (the old route reused a $3 placeholder in a query that bound only $1).
  const where = `WHERE (${pred}) AND ($1::text IS NULL OR a.name ILIKE $1)`;
  const total = (await db.query(`SELECT count(*)::int AS n FROM artists a ${where}`, [pat])).rows[0].n;
  const rows = (await db.query(`
    SELECT a.id, a.name, a.spotify_id, a.bandcamp_url, a.musicbrainz_id, a.discography_reviewed,
           a.bio, a.vegan_advocacy_notes, a.no_advocacy_notes_needed,
           COUNT(DISTINCT sa.song_id)::int AS songs,
           (COUNT(DISTINCT sa.song_id) FILTER (WHERE s.status='included' AND s.published))::int AS live_songs
    FROM artists a
    LEFT JOIN song_artists sa ON sa.artist_id = a.id
    LEFT JOIN songs s ON s.id = sa.song_id
    ${where}
    GROUP BY a.id
    ORDER BY LOWER(a.name), a.id
    LIMIT $2 OFFSET $3`, [pat, lim, off])).rows;
  return {
    total,
    rows: rows.map(r => ({
      id: r.id, name: r.name, songs: r.songs, live_songs: r.live_songs,
      identity: { spotify: !!r.spotify_id, bandcamp: !!r.bandcamp_url, musicbrainz: !!r.musicbrainz_id },
      reviewed: !!r.discography_reviewed,
      has_bio: !!(r.bio && r.bio.trim()),
      has_notes: !!(r.vegan_advocacy_notes && r.vegan_advocacy_notes.trim()),
      none_needed: !!r.no_advocacy_notes_needed,
    })),
  };
}

async function get(db, id) {
  const a = (await db.query(`
    SELECT a.id, a.name, a.bio, a.vegan_advocacy_notes, a.no_advocacy_notes_needed, a.website_url, a.genres,
           a.spotify_id, a.bandcamp_url, a.musicbrainz_id,
           a.discography_reviewed, a.discography_reviewed_date, a.discography_review_notes,
           (SELECT COUNT(DISTINCT sa.song_id)::int FROM song_artists sa WHERE sa.artist_id = a.id) AS songs,
           (SELECT COUNT(DISTINCT sa.song_id)::int FROM song_artists sa JOIN songs s ON s.id = sa.song_id
             WHERE sa.artist_id = a.id AND s.status='included' AND s.published) AS live_songs
    FROM artists a WHERE a.id = $1`, [id])).rows[0];
  if (!a) throw coded('NOT_FOUND', 'Artist not found');
  return a;
}

const isHttp = (v) => { try { return /^https?:$/.test(new URL(v).protocol); } catch { return false; } };

async function update(db, id, patch = {}) {
  const sets = [], params = [];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (patch.name !== undefined) {
    const n = typeof patch.name === 'string' ? patch.name.trim() : '';
    if (!n || n.length > 255) throw coded('BAD_INPUT', 'Name is required (255 characters at most)');
    set('name', n);
  }
  for (const col of ['bio', 'vegan_advocacy_notes', 'discography_review_notes']) {
    if (patch[col] === undefined) continue;
    if (patch[col] !== null && typeof patch[col] !== 'string') throw coded('BAD_INPUT', `${col} must be text`);
    set(col, patch[col] === null || patch[col].trim() === '' ? null : patch[col]);
  }
  if (patch.no_advocacy_notes_needed !== undefined) {
    if (typeof patch.no_advocacy_notes_needed !== 'boolean') throw coded('BAD_INPUT', 'no_advocacy_notes_needed must be true or false');
    set('no_advocacy_notes_needed', patch.no_advocacy_notes_needed);
  }
  if (patch.website_url !== undefined) {
    const v = patch.website_url === null ? '' : String(patch.website_url).trim();
    if (v && !isHttp(v)) throw coded('BAD_INPUT', 'Website must be an http(s) address');
    set('website_url', v || null);
  }
  if (patch.genres !== undefined) {
    if (!Array.isArray(patch.genres) || patch.genres.some(g => typeof g !== 'string')) throw coded('BAD_INPUT', 'Genres must be a list of text');
    set('genres', patch.genres.map(g => g.trim()).filter(Boolean));
  }
  if (patch.discography_reviewed !== undefined) {
    if (typeof patch.discography_reviewed !== 'boolean') throw coded('BAD_INPUT', 'discography_reviewed must be true or false');
    set('discography_reviewed', patch.discography_reviewed);
    sets.push(`discography_reviewed_date = ${patch.discography_reviewed ? 'CURRENT_TIMESTAMP' : 'NULL'}`);
  }
  if (sets.length) {
    params.push(id);
    const r = await db.query(`UPDATE artists SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length} RETURNING id`, params);
    if (r.rows.length === 0) throw coded('NOT_FOUND', 'Artist not found');
  }
  return get(db, id);
}

module.exports = { QUEUES, counts, list, get, update };
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && node --test test/artists.test.js`
Expected: all PASS. If the first test's `needs-identity` expected array is wrong for ordering/content, fix the expectation (the artists with no identity are bare, bio, notes, none), not the service.

- [ ] **Step 7: Commit**

```bash
git add backend/database/migrations/015_artist_advocacy_none_needed.sql backend/services/artists.js backend/test/artists.test.js
git commit -m "feat(artists): queues, list/get/update service and migration 015"
```

---

### Task 2: Admin routes replace the old artist routes

**Files:**
- Modify: `backend/routes/admin.js` (the `// ==================== Artists ====================` block: delete `GET /all-artists`, `PUT /artists/:id`, `GET /artists-stats`; add the four routes below; add `const artistsSvc = require('../services/artists');` beside the other service requires at the top)

**Interfaces:**
- Consumes: `artists.counts/list/get/update`, `QUEUES` from Task 1.
- Produces (all under `/api/admin`, authed by the existing router-level password check):
  - `GET /artists/queues` -> `{ queues: [{key,label,count}] }` (rail order, counts merged in)
  - `GET /artists?queue=&q=&limit=&offset=` -> `{ total, rows }`
  - `GET /artists/:id` -> artist object
  - `PUT /artists/:id` (JSON body = patch) -> artist object
  - Errors: `NOT_FOUND` 404, `BAD_INPUT` 400, anything else 500 `{ error: 'Failed to ...' }` (logs the code only).

- [ ] **Step 1: Add the routes**

Replace the three old handlers (from `// Get all artists for admin management` through the end of `GET /artists-stats`, i.e. everything between the `// ==================== Artists ====================` banner and the `// ==================== Staging / lifecycle ====================` banner) with:

```js
function artistError(res, e, label) {
  const status = { NOT_FOUND: 404, BAD_INPUT: 400 }[e.code];
  if (status) return res.status(status).json({ error: e.code, message: e.message });
  console.error(`artists ${label} error:`, e.code || 'error');
  return res.status(500).json({ error: `Failed to ${label}` });
}
const artistId = (req) => { const n = parseInt(req.params.id, 10); return Number.isSafeInteger(n) && n > 0 ? n : -1; };

// Static path first so ':id' never swallows it.
router.get('/artists/queues', async (req, res) => {
  try {
    const c = await artistsSvc.counts(pool);
    res.json({ queues: artistsSvc.QUEUES.map(q => ({ ...q, count: c[q.key] })) });
  } catch (e) { artistError(res, e, 'count artists'); }
});

router.get('/artists', async (req, res) => {
  try {
    res.json(await artistsSvc.list(pool, {
      queue: String(req.query.queue || 'all'), q: String(req.query.q || '').slice(0, 100),
      limit: req.query.limit, offset: req.query.offset,
    }));
  } catch (e) { artistError(res, e, 'list artists'); }
});

router.get('/artists/:id', async (req, res) => {
  try { res.json(await artistsSvc.get(pool, artistId(req))); }
  catch (e) { artistError(res, e, 'read the artist'); }
});

router.put('/artists/:id', async (req, res) => {
  try { res.json(await artistsSvc.update(pool, artistId(req), req.body || {})); }
  catch (e) { artistError(res, e, 'update the artist'); }
});
```

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check routes/admin.js`
Expected: no output.

- [ ] **Step 3: Verify against the running backend**

Start (or confirm) the backend on :5000 (check the process tree first - the launch method varies; if it was started with plain `node` it needs a restart to see the new routes). Read the admin password from the environment of the running shell WITHOUT printing it, e.g. `PW=$(grep ^ADMIN_PASSWORD backend/.env | cut -d= -f2-)`, and call:

```bash
curl -s -H "X-Admin-Password: $PW" "http://localhost:5000/api/admin/artists/queues"
curl -s -H "X-Admin-Password: $PW" "http://localhost:5000/api/admin/artists?queue=all&q=blood&limit=5"
curl -s -o /dev/null -w "%{http_code}\n" -H "X-Admin-Password: $PW" "http://localhost:5000/api/admin/artists?queue=bogus"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5000/api/admin/artists"
```

Expected: queues JSON with six entries whose `all` count equals the artist total; a search that returns rows and a `total` (this is the call that used to 500); `400`; then `401`/`403` without the header. Do not paste the password anywhere.

- [ ] **Step 4: Run the backend suite**

Run: `cd backend && npm test`
Expected: all pass (361 existing + the new artists tests).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat(artists): admin queue/list/read/update routes; fixes artist search"
```

---

### Task 3: Public artist page shows Bandcamp and Website separately

**Files:**
- Modify: `backend/routes/spotify.js` (the artist-detail SELECT at the `a.website_url` line ~826: add `a.bandcamp_url`)
- Modify: `frontend/src/components/ArtistDetailPage.jsx:137-147` (the single website/Bandcamp anchor)

**Interfaces:**
- Consumes: `artists.bandcamp_url` (migration 014).
- Produces: public artist payload gains `bandcamp_url`.

- [ ] **Step 1: Serve `bandcamp_url`**

In the artist-detail query (`WHERE a.id = $1`, `a.website_url` is its last column) change `a.website_url` to `a.website_url,\n        a.bandcamp_url`. Do not touch the search-list query near line 752.

- [ ] **Step 2: Render two buttons**

Replace the `{artist.website_url && ( ... )}` block with:

```jsx
            {artist.bandcamp_url && (
              <a
                href={artist.bandcamp_url}
                target="_blank"
                rel="noopener noreferrer"
                className="overlay-btn"
              >
                Bandcamp
              </a>
            )}
            {artist.website_url && artist.website_url !== artist.bandcamp_url && (
              <a
                href={artist.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="overlay-btn"
              >
                {artist.website_url.includes('bandcamp.com') ? 'Bandcamp' : 'Website'}
              </a>
            )}
```

(The `!==` guard stops a duplicate button when both fields hold the same address; a legacy `website_url` that is a Bandcamp address still labels itself "Bandcamp" when `bandcamp_url` is unset.)

- [ ] **Step 3: Verify**

`cd backend && node --check routes/spotify.js`; `cd frontend && npm run lint` (0 errors). Fetch a public artist: `curl -s http://localhost:5000/api/spotify/artist/<id>` (use the route the page uses - confirm in `ArtistDetailPage.jsx`) and confirm `bandcamp_url` is present in the JSON.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/spotify.js frontend/src/components/ArtistDetailPage.jsx
git commit -m "feat(artist-page): show Bandcamp and Website as separate buttons"
```

---

### Task 4: Split BandCheck.jsx into Links and Catalogue pieces

**Files:**
- Create: `frontend/src/components/admin/bandCheckApi.js`
- Create: `frontend/src/components/admin/IdentifyPanel.jsx`
- Create: `frontend/src/components/admin/CatalogueReview.jsx`
- Modify: `frontend/src/components/admin/BandCheck.jsx` (becomes a thin leftover until Task 7 deletes it - keep it compiling by importing the moved pieces, or delete it now if nothing imports it after Task 6; prefer leaving it until Task 7)
- Modify: `frontend/src/components/admin/QueueRail.jsx` (accept a `groups` prop)

**Interfaces:**
- Produces:
  - `bandCheckApi.js`: `export const SOURCE_LABEL = { spotify:'Spotify', bandcamp:'Bandcamp', musicbrainz:'MusicBrainz' }`, `export const SOURCES = Object.keys(SOURCE_LABEL)`, `export async function api(path, opts)` (the existing helper, moved verbatim: throws an Error carrying `.artist`).
  - `IdentifyPanel.jsx`: default export `IdentifyPanel({ artistId, name, identity, initialOpen, onSaved, onDone })` - **moved verbatim** from `BandCheck.jsx`, plus `openLink` and `hostOf`, importing `api/SOURCES/SOURCE_LABEL` from `bandCheckApi.js`. `onDone` becomes optional: render the **Done** button only when `onDone` is provided.
  - `CatalogueReview.jsx`: default export `CatalogueReview({ artistId, identity, onNeedIdentity, onAdded, reviewed, onReviewedChange, refreshKey })` - the `Review` component, with the Identify card, the "Identify sources"/"Hide sources" toolbar button and the `← All bands` button removed (see Step 3).
  - `QueueRail({ counts, activeQueue, onSelect, groups })`: `groups` defaults to the current songs `GROUPS`.

- [ ] **Step 1: Create `bandCheckApi.js`**

```js
import { adminFetch } from '../../api/adminApi';

export const SOURCE_LABEL = { spotify: 'Spotify', bandcamp: 'Bandcamp', musicbrainz: 'MusicBrainz' };
export const SOURCES = Object.keys(SOURCE_LABEL);

export async function api(path, opts) {
  const r = await adminFetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(d.message || d.error || 'Request failed');
    err.artist = d.artist; // present on NO_IDENTITY: lets the view open the Identify step with the band's name
    throw err;
  }
  return d;
}
```

- [ ] **Step 2: Create `IdentifyPanel.jsx`**

Move `openLink`, `hostOf` and `IdentifyPanel` from `BandCheck.jsx` into the new file **unchanged** except: import `{ useEffect, useState, useCallback, useRef } from 'react'` and `{ api, SOURCES, SOURCE_LABEL } from './bandCheckApi'`; `export default IdentifyPanel`; and make the Done button conditional:

```jsx
        {onDone && <button className="btn btn-ghost btn-sm" onClick={onDone}>Done</button>}
```

The panel heading `Identify sources` stays. Its `onSaved` must be awaited by the caller (it already is: `await onSaved()`).

- [ ] **Step 3: Create `CatalogueReview.jsx`**

Move `stateChip`, `PARTIAL` and `Review` from `BandCheck.jsx` into the new file as `CatalogueReview`, importing `Link` from react-router-dom, `{ api, SOURCE_LABEL }` from `./bandCheckApi`. Apply exactly these edits to the moved `Review`:

1. Signature: `function CatalogueReview({ artistId, identity, onNeedIdentity, onAdded, reviewed, onReviewedChange, refreshKey })`.
2. Delete the `identify` state, `identifyN`, `identifyBtn`, `openIdentify`, the `<IdentifyPanel .../>` block and the "Identify sources" toolbar button; delete the `onBack` button (`← All bands`).
3. Replace every `openIdentify(x)` call with `onNeedIdentity(x)`: in the `NO_IDENTITY` catch (`onNeedIdentity(SOURCES.find(s => !(e.artist.identity || {})[s]) || null)` - import `SOURCES` too) and the suspect-source note buttons (`onClick={() => onNeedIdentity(n.source)}`). Remove the now-unused `setIdentify(null)` in `load`.
4. Reload when the parent says identity changed: `useEffect(() => { if (refreshKey) load(true); }, [refreshKey, load]);` (`refreshKey` starts at 0 so the first mount does not double-load).
5. The toolbar becomes just the title row with Refresh:

```jsx
  const toolbar = (
    <div className="queue-toolbar band-toolbar">
      <h2>Catalogue</h2>
      {data && <button className="btn btn-secondary btn-sm" onClick={() => { setResult(''); load(true); }}>Refresh</button>}
      {data && (
        <button className="btn btn-secondary btn-sm" onClick={() => onReviewedChange(!reviewed)}>
          {reviewed ? 'Clear reviewed mark' : 'Mark catalogue reviewed'}
        </button>
      )}
    </div>
  );
```

6. Unused `identity` prop: use it so the panel can say what is missing - if all three identity values are null and `data` is empty, render `<div className="queue-empty">Set at least one source under Links, then Refresh.</div>` instead of the release list. (`identity` is `{spotify,bandcamp,musicbrainz}` as served by `GET /artists/:id`.)
7. Keep everything else - picking, add, notes, `band-footer` - verbatim. The `Link to="/admin/songs?queue=to-process"` stays.

- [ ] **Step 4: `QueueRail` groups prop**

In `QueueRail.jsx` change the signature and the map source:

```jsx
function QueueRail({ counts, activeQueue, onSelect, groups = GROUPS }) {
  return (
    <nav className="queue-rail">
      {groups.map(([group, items]) => (
```

Remove the `['band-check', 'Band check', false, true]` entry from the songs `Capture` group (Band check now lives in the Artists area; `SongsArea` is updated in Task 6).

- [ ] **Step 5: Make `BandCheck.jsx` compile on the new pieces**

Until Task 7 deletes it, replace the in-file `IdentifyPanel`/`Review`/helpers by imports so the build stays green. Simplest: delete `BandCheck.jsx`'s `IdentifyPanel`, `Review`, `stateChip`, `PARTIAL`, `openLink`, `hostOf`, `api` and the `SOURCE_*` constants and leave only `BandList` and `BandCheck`, with `BandCheck` rendering `<p>Moved to Admin > Artists.</p>` for the `artist` param branch. (It is deleted in Task 7; this step exists only so each task ends with a green build.)

- [ ] **Step 6: Verify and commit**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors (6 pre-existing warnings), build clean. Fix any unused-import lint errors you introduced.

```bash
git add frontend/src/components/admin/bandCheckApi.js frontend/src/components/admin/IdentifyPanel.jsx frontend/src/components/admin/CatalogueReview.jsx frontend/src/components/admin/BandCheck.jsx frontend/src/components/admin/QueueRail.jsx
git commit -m "refactor(admin): split Band check into IdentifyPanel and CatalogueReview; QueueRail takes groups"
```

---

### Task 5: Artists area (rail + list) and routes

**Files:**
- Create: `frontend/src/components/admin/ArtistsArea.jsx`
- Create: `frontend/src/components/admin/ArtistQueueList.jsx`
- Modify: `frontend/src/App.jsx` (the `artists` admin route -> `ArtistsArea`; add `artist/:id` -> `ArtistWorkbench` in Task 6)
- Modify: `frontend/src/components/admin/SongsArea.jsx` (remove `band-check` and its import; redirect a stale `?queue=band-check`)

**Interfaces:**
- Consumes: `GET /api/admin/artists/queues`, `GET /api/admin/artists`, `QueueRail` `groups` prop.
- Produces: route `/admin/artists?queue=<key>&q=<text>&page=<n>`; row click navigates to `/admin/artist/:id` with `state: { ids, index }` (prev/next like songs).

- [ ] **Step 1: `ArtistQueueList.jsx`**

```jsx
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';

const PAGE_SIZE = 50;

function ArtistQueueList({ queue, label, q, page, onQuery, onPage }) {
  const navigate = useNavigate();
  const [text, setText] = useState(q);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  // The input is local state committed to the URL after a pause, so a router transition cannot reset it mid-typing.
  useEffect(() => { setText(q); }, [q, queue]);
  useEffect(() => {
    if (text === q) return undefined;
    const t = setTimeout(() => onQuery(text), 250);
    return () => clearTimeout(t);
  }, [text, q, onQuery]);

  const load = useCallback(() => {
    let live = true;
    const qs = new URLSearchParams({ queue, q, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    adminFetch(`/api/admin/artists?${qs}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message || 'Could not load artists'); return d; })
      .then((d) => { if (live) { setData(d); setError(''); } })
      .catch((e) => { if (live) { setData((prev) => prev || { rows: [], total: 0 }); setError(e.message); } });
    return () => { live = false; };
  }, [queue, q, page]);
  useEffect(() => load(), [load]);

  const rows = data ? data.rows : [];
  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      <div className="queue-toolbar">
        <h2>{label}</h2>
        <input className="input input-pill" aria-label="Search artists" placeholder="Search artists by name"
          value={text} onChange={(e) => setText(e.target.value)} style={{ width: 220 }} />
      </div>
      {error && <div className="admin-message error">{error}</div>}
      {data === null ? <div className="queue-empty">Loading…</div>
        : rows.length === 0 ? <div className="queue-empty">Nothing here right now.</div>
        : rows.map((r) => (
          <div key={r.id} className="song-row-wrap">
            <button className="song-row" onClick={() => navigate(`/admin/artist/${r.id}`, {
              state: { from: queue, ids: rows.map((x) => x.id), index: rows.findIndex((x) => x.id === r.id) },
            })}>
              <span className="song-meta">
                <span className="song-title">{r.name}</span>
                <span className="song-artist">{r.songs} songs · {r.live_songs} live</span>
              </span>
              <span className="miss-chips">
                {!(r.identity.spotify || r.identity.bandcamp || r.identity.musicbrainz) && <span className="miss-chip warn">no identity</span>}
                {!r.reviewed && <span className="miss-chip warn">not checked</span>}
                {!r.has_bio && <span className="miss-chip warn">no bio</span>}
                {!r.has_notes && !r.none_needed && <span className="miss-chip warn">no advocacy notes</span>}
              </span>
            </button>
          </div>
        ))}
      {data && data.total > PAGE_SIZE && (
        <div className="queue-pager">
          <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => onPage(Math.max(0, page - 1))}>← Prev</button>
          <span className="admin-stub">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.total)} of {data.total}</span>
          <button className="btn btn-secondary btn-sm" disabled={(page + 1) * PAGE_SIZE >= data.total} onClick={() => onPage(page + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
export default ArtistQueueList;
```

- [ ] **Step 2: `ArtistsArea.jsx`**

```jsx
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import QueueRail from './QueueRail';
import ArtistQueueList from './ArtistQueueList';

const DEFAULT_QUEUE = 'needs-check';
const GROUPS = [
  ['Needs work', [['needs-identity', 'Needs identity'], ['needs-check', 'Needs catalogue check'], ['needs-bio', 'Needs bio'], ['needs-notes', 'Needs advocacy notes']]],
  ['Finished', [['done', 'Done']]],
  ['Everything', [['all', 'All artists']]],
];
const LABELS = Object.fromEntries(GROUPS.flatMap(([, items]) => items.map(([k, l]) => [k, l])));

function ArtistsArea() {
  const [params, setParams] = useSearchParams();
  const rawQueue = params.get('queue');
  // a stale or typo'd ?queue= falls back rather than rendering a list that cannot load
  const queue = Object.hasOwn(LABELS, rawQueue) ? rawQueue : DEFAULT_QUEUE;
  const q = params.get('q') || '';
  const page = Math.max(0, parseInt(params.get('page'), 10) || 0);
  const [counts, setCounts] = useState(null);

  const loadCounts = useCallback(() => {
    adminFetch('/api/admin/artists/queues')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCounts(d ? Object.fromEntries(d.queues.map((x) => [x.key, x.count])) : null))
      .catch(() => setCounts(null));
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  const select = (key) => setParams({ queue: key });
  const setQuery = useCallback((v) => setParams((prev) => {
    const n = new URLSearchParams(prev); if (v) n.set('q', v); else n.delete('q'); n.delete('page'); return n;
  }, { replace: true }), [setParams]);
  const setPage = (p) => setParams((prev) => { const n = new URLSearchParams(prev); if (p > 0) n.set('page', String(p)); else n.delete('page'); return n; }, { replace: true });

  return (
    <div>
      <div className="queue-toolbar"><h1>Artists</h1></div>
      <div className="songs-layout">
        <QueueRail counts={counts} activeQueue={queue} onSelect={select} groups={GROUPS} />
        <ArtistQueueList queue={queue} label={LABELS[queue]} q={q} page={page} onQuery={setQuery} onPage={setPage} />
      </div>
    </div>
  );
}
export default ArtistsArea;
```

- [ ] **Step 3: Wire the route and drop Band check from Songs**

`App.jsx`: replace `import ArtistsManager from './components/ArtistsManager';` with `import ArtistsArea from './components/admin/ArtistsArea';` and the route element with `<ArtistsArea />`.

`SongsArea.jsx`: remove `import BandCheck`, remove `'band-check'` from `SELECTABLE_QUEUES` and the `activeQueue === 'band-check'` branch and the `onAdded` prop use; update the comment. A stale `?queue=band-check` then falls to the default queue via the existing guard (acceptable: Band check moved, the spec's "redirect" is satisfied by the guard plus the Artists nav link).

- [ ] **Step 4: Verify and commit**

Run: `cd frontend && npm run lint && npm run build` (0 errors). With backend and Vite running, load `/admin/artists` in the browser (login gate: use the Task 8 mock harness, never type the password): the rail shows six entries with counts, the list loads, a search for a band name returns rows (no "failed to fetch").

```bash
git add frontend/src/components/admin/ArtistsArea.jsx frontend/src/components/admin/ArtistQueueList.jsx frontend/src/App.jsx frontend/src/components/admin/SongsArea.jsx
git commit -m "feat(admin): Artists area with queue rail and list"
```

---

### Task 6: Artist workbench

**Files:**
- Create: `frontend/src/components/admin/ArtistWorkbench.jsx`
- Create: `frontend/src/components/admin/ArtistDetailsPanel.jsx`
- Create: `frontend/src/components/admin/ArtistLinksPanel.jsx`
- Modify: `frontend/src/App.jsx` (add `<Route path="artist/:id" element={<ArtistWorkbench />} />` beside `song/:id`)

**Interfaces:**
- Consumes: `GET/PUT /api/admin/artists/:id`, `AutoText` (`SavedField.jsx`: `AutoText({ label, initial, onSave, multiline, rows, placeholder })`, `onSave(v)` -> `{ ok, error? }`), `IdentifyPanel`, `CatalogueReview` (Task 4).
- Produces: route `/admin/artist/:id`.

- [ ] **Step 1: `ArtistDetailsPanel.jsx`**

```jsx
import { AutoText } from './SavedField';

function ArtistDetailsPanel({ artist, save }) {
  return (
    <section className="wb-panel">
      <h2>Details</h2>
      <AutoText label="Name" initial={artist.name} onSave={(v) => save({ name: v })} />
      <AutoText label="Biography" initial={artist.bio} multiline rows={5} onSave={(v) => save({ bio: v })} />
      <AutoText label="Vegan advocacy notes" initial={artist.vegan_advocacy_notes} multiline rows={4}
        onSave={(v) => save({ vegan_advocacy_notes: v })} />
      <label className="checkbox-label">
        <input type="checkbox" checked={!!artist.no_advocacy_notes_needed}
          onChange={(e) => save({ no_advocacy_notes_needed: e.target.checked })} />
        {' '}No advocacy notes needed
      </label>
      <AutoText label="Genres (comma-separated)" initial={(artist.genres || []).join(', ')}
        onSave={(v) => save({ genres: v.split(',').map((g) => g.trim()).filter(Boolean) })} />
    </section>
  );
}
export default ArtistDetailsPanel;
```

- [ ] **Step 2: `ArtistLinksPanel.jsx`**

```jsx
import IdentifyPanel from './IdentifyPanel';
import { AutoText } from './SavedField';

// Links = the three Band check identities (one writer: /band-check/.../identity) + the public Website.
// `focus` = { open, n } lets the Catalogue panel ask for a specific source row; n re-keys the panel.
function ArtistLinksPanel({ artist, save, focus, onIdentitySaved }) {
  const identity = { spotify: artist.spotify_id || null, bandcamp: artist.bandcamp_url || null, musicbrainz: artist.musicbrainz_id || null };
  return (
    <section className="wb-panel">
      <h2>Links</h2>
      <IdentifyPanel key={focus.n} artistId={artist.id} name={artist.name} identity={identity}
        initialOpen={focus.open} onSaved={onIdentitySaved} />
      <AutoText label="Website" placeholder="https://" initial={artist.website_url}
        onSave={(v) => save({ website_url: v })} />
    </section>
  );
}
export default ArtistLinksPanel;
```

- [ ] **Step 3: `ArtistWorkbench.jsx`**

```jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import ArtistDetailsPanel from './ArtistDetailsPanel';
import ArtistLinksPanel from './ArtistLinksPanel';
import CatalogueReview from './CatalogueReview';
import { AutoText } from './SavedField';

function ArtistWorkbench() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [artist, setArtist] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [focus, setFocus] = useState({ open: null, n: 0 }); // Links panel row requested by the Catalogue panel
  const [refreshKey, setRefreshKey] = useState(0);          // bumps when identity changes -> Catalogue re-checks
  const token = useRef(0);                                   // only the latest request's response wins

  const reload = useCallback(() => {
    const my = ++token.current;
    adminFetch(`/api/admin/artists/${id}`)
      .then(async (r) => {
        if (r.status === 404) { if (my === token.current) setNotFound(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((d) => { if (d && my === token.current) { setArtist(d); setNotFound(false); } })
      .catch(() => {});
  }, [id]);
  useEffect(() => { setArtist(null); setNotFound(false); setFocus({ open: null, n: 0 }); setRefreshKey(0); reload(); }, [reload]);

  const save = useCallback(async (patch) => {
    const my = token.current;
    try {
      const r = await adminFetch(`/api/admin/artists/${id}`, { method: 'PUT', body: patch });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { if (my === token.current) setArtist(d); return { ok: true }; }
      return { ok: false, error: d.message || d.error || 'Save failed' };
    } catch { return { ok: false, error: 'Request failed' }; }
  }, [id]);

  const onIdentitySaved = useCallback(async () => { await reload(); setRefreshKey((k) => k + 1); }, [reload]);
  const needIdentity = useCallback((source) => setFocus((f) => ({ open: source, n: f.n + 1 })), []);

  if (notFound) {
    return (<div><Link to="/admin/artists" className="btn btn-ghost btn-sm">&larr; Back to Artists</Link><h1>Artist not found</h1></div>);
  }
  if (!artist) return <div className="queue-empty">Loading…</div>;

  const navState = location.state && Array.isArray(location.state.ids) ? location.state : null;
  const idx = navState ? navState.ids.indexOf(parseInt(id, 10)) : -1;
  const go = (t) => navigate(`/admin/artist/${navState.ids[t]}`, { state: { ...navState, index: t } });
  const back = navState && navState.from ? `/admin/artists?queue=${navState.from}` : '/admin/artists';

  return (
    <div className="workbench">
      <div className="wb-topbar">
        <Link to={back} className="btn btn-ghost btn-sm">&larr; Back to Artists</Link>
        <h1 className="wb-title">{artist.name}</h1>
        <div className="wb-artist">{artist.songs} songs · {artist.live_songs} live</div>
        {navState && idx >= 0 && (
          <div>
            <button className="btn btn-secondary btn-sm" disabled={idx === 0} onClick={() => go(idx - 1)}>← Prev</button>
            {' '}
            <button className="btn btn-secondary btn-sm" disabled={idx >= navState.ids.length - 1} onClick={() => go(idx + 1)}>Next →</button>
          </div>
        )}
      </div>
      <div className="wb-grid">
        <div className="wb-col wb-col-main">
          <CatalogueReview key={artist.id} artistId={artist.id}
            identity={{ spotify: artist.spotify_id, bandcamp: artist.bandcamp_url, musicbrainz: artist.musicbrainz_id }}
            onNeedIdentity={needIdentity} refreshKey={refreshKey} onAdded={() => {}}
            reviewed={!!artist.discography_reviewed}
            onReviewedChange={(v) => save({ discography_reviewed: v })} />
        </div>
        <div className="wb-col wb-col-side">
          <ArtistDetailsPanel artist={artist} save={save} />
          <ArtistLinksPanel artist={artist} save={save} focus={focus} onIdentitySaved={onIdentitySaved} />
          <section className="wb-panel">
            <h2>Notes</h2>
            <AutoText label="Catalogue review notes" initial={artist.discography_review_notes} multiline rows={3}
              onSave={(v) => save({ discography_review_notes: v })} />
          </section>
        </div>
      </div>
    </div>
  );
}
export default ArtistWorkbench;
```

Add to `App.jsx` imports `import ArtistWorkbench from './components/admin/ArtistWorkbench';` and the route.

Note for the implementer: `CatalogueReview` calls `onNeedIdentity` and the Links panel's `key={focus.n}` re-mount opens the requested row; after a save `onIdentitySaved` reloads the artist and bumps `refreshKey`, which makes the Catalogue re-check (Task 4 Step 3 item 4). `CatalogueReview`'s own `load(true)` keeps picked ticks that are still new.

- [ ] **Step 4: Verify and commit**

`cd frontend && npm run lint && npm run build` (0 errors). Browser check is Task 8 (mock harness). Also confirm the Vite stale-transform hazard: touch the new files and load the page before declaring it ready.

```bash
git add frontend/src/components/admin/ArtistWorkbench.jsx frontend/src/components/admin/ArtistDetailsPanel.jsx frontend/src/components/admin/ArtistLinksPanel.jsx frontend/src/App.jsx
git commit -m "feat(admin): artist workbench (Details, Links, Catalogue, Notes)"
```

---

### Task 7: Retire ArtistsManager, BandCheck.jsx and dead CSS

**Files:**
- Delete: `frontend/src/components/ArtistsManager.jsx`
- Delete: `frontend/src/components/admin/BandCheck.jsx`
- Modify: `frontend/src/App.css` (remove blocks used only by `ArtistsManager`)

- [ ] **Step 1: Confirm nothing imports them**

Run (Grep tool): `ArtistsManager` and `BandCheck` across `frontend/src`. Expected: only their own files. If anything else imports, fix that first.

- [ ] **Step 2: Delete the files**

```bash
git rm frontend/src/components/ArtistsManager.jsx frontend/src/components/admin/BandCheck.jsx
```

- [ ] **Step 3: Remove dead CSS**

Collect every `className` string used in the deleted `ArtistsManager.jsx` (use `git show HEAD:frontend/src/components/ArtistsManager.jsx`). In `App.css` delete the rules for classes **used by no other file** (grep each class across `frontend/src`): expected to include `.artists-manager`, `.artists-stats-grid`, `.artists-table*`, and the edit-modal classes. **Keep** any class still used elsewhere - in particular `.stat-card` (also used by the public dashboard) and the Band check classes (`band-*`, `inbox-row`) which `CatalogueReview` and `IdentifyPanel` still use. Do not use PowerShell whole-file rewrites (UTF-8 hazard); use Edit per hunk, then run `grep -nP '[^\x00-\x7F]' frontend/src/App.css | head` before and after to confirm no mojibake appeared.

- [ ] **Step 4: Verify and commit**

`cd frontend && npm run lint && npm run build`: 0 errors, build clean, bundle not larger than before.

```bash
git add frontend/src/App.css
git commit -m "chore(admin): retire ArtistsManager and Songs > Band check view"
```

---

### Task 8: Verification, docs and handoff

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md` (if sessions are tracked there), `CLAUDE.md` (Backend Structure: add `services/artists.js`; Frontend Structure: the Artists area replaces `ArtistsManager`, Band check now lives in the artist workbench; migrations list), `docs/superpowers/specs/2026-10-24-I-artists-area-design.md` (section 3: note that the queues and the none-needed mark landed in I1 because the queue predicates need the column; I2 = Exclude + "new since reviewed" prompt)

- [ ] **Step 1: Full test run**

Run: `cd backend && npm test`. Expected: all pass (record the count). `cd frontend && npm run lint && npm run build`: 0 errors, clean build.

- [ ] **Step 2: Browser review with the mock harness**

Per the "Admin UI mock-harness review" practice: build a throwaway Vite mock harness **outside the repo** on :5199 that stubs `/api/admin/artists*` and `/api/admin/band-check/*`, and drive the real components in Chrome. Never type the password into the real login. Check: rail + counts; search returns rows and an empty search result shows "Nothing here right now."; stale `?queue=zzz` falls back to Needs catalogue check; row click opens the workbench; Prev/Next; Details autosave shows Saved; "No advocacy notes needed" toggles; the Links panel shows all three identities AND a Bandcamp address saved there shows in the Links panel and triggers a Catalogue re-check; a source warning in the Catalogue opens the right Links row; Mark catalogue reviewed / Clear toggles; phone width layout; keyboard focus order. Fix anything found, re-run lint/build.

- [ ] **Step 3: Real-data API check (read-only)**

With the real backend: `GET /api/admin/artists/queues` counts add up (`all` = total artists; the five others consistent with a SQL count run by hand on `artists`), and one search by a known band name returns it. Do not write to real artists during the check; if a write is needed, restore the row exactly.

- [ ] **Step 4: Update docs**

Apply the doc edits listed under Files; add a `PROJECT_STATE.md` Changelog entry and refresh "Next Tasks" (curator smoke list: Artists rail and counts, search, workbench panels, Bandcamp URL visible in Links and on the public artist page, a Catalogue check from inside the workbench; I2 next).

- [ ] **Step 5: Commit and push**

```bash
git add docs/PROJECT_STATE.md docs/PROJECT_PLAN.md CLAUDE.md docs/superpowers/specs/2026-10-24-I-artists-area-design.md
git commit -m "docs: sub-project I1 (Artists area) state"
git push
```

(Adjust the `git add` list to the files actually changed.)
