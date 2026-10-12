# Sub-project E — Lyrics assist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click multi-site lyric search links in the Lyrics panel, plus a *To transcribe* queue and a *Lyrics on hold* shelf that keep unfindable-lyrics songs out of the processing queues.

**Architecture:** Part 1 is frontend-only: a pure `utils/lyricsSearchUrls.js` builds Google `site:` queries and per-site links; `LyricsPanel` renders them. Part 2 changes `services/curation.js` queue definitions and `saveLyrics` (backend), renames/adds rail entries (frontend), and adds a "can't find them" action row to the Lyrics panel using the existing `savePanel` / `saveProcessing` calls. **No migration, no new route, no new dependency, no network call, no read of `song_lyrics` from any API.**

**Tech Stack:** Node `node:test` (backend, real dev DB; frontend pure modules), Express/pg, React 19 + Vite.

**Spec:** `docs/superpowers/specs/2026-10-02-E-lyrics-assist-design.md` (revised 2026-10-12: Brave rejected, Part 1 is link-building only).

## Global Constraints

- No paid/external search API, no scraping or fetching of lyric text (spec §1, §3).
- No migration: `song_processing.park_reason` CHECK already allows `awaiting_community`, `needs_transcription`, `listened_unclear` (spec §2).
- `song_lyrics` is local-only: nothing added may SELECT it into an API response (CLAUDE.md). Queue SQL may use `EXISTS` on it exactly as `needs-lyrics` already does.
- Queue counts come from the one `queueWhere` function so counts and lists cannot disagree (spec §4.2).
- Backend test file uses its own sentinel: `ZZZCUR` (existing `curation.test.js`). Do not add a second file that shares a LIKE-prefix cleanup.
- Use `--bg-*`/`--text-*`/`--space-*` tokens; admin styles live in `frontend/src/styles/admin.css`.
- Edit files per hunk with the Edit tool; after any scripted rewrite run `grep -nP '[^\x00-\x7F]'` on the file (PS 5.1 UTF-8 hazard). Commit with `git commit -F <file>`; `git add` explicit paths only (`backend/docs/` and `docs/examples/` stay untracked). Never `taskkill /IM node.exe`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A parked song that already has lyrics (inserted outside `saveLyrics`) must still appear in *To be processed*, not vanish from every queue.
2. A rejected song with a lyric park reason appears in neither *To transcribe* nor *Lyrics on hold*.
3. Titles/artists containing `"`, `&`, `#`, `+` or non-ASCII must produce a correct, well-formed search URL; a song with no artist must not produce `"" `.
4. `saveLyrics` with an explicit `lyrics_source` must not be overwritten by the "Transcribed by curator" label; saving empty lyrics must NOT clear the park reason.
5. A stale bookmark `?queue=awaiting-community` must fall back to the default queue, not render a broken list.

---

## File Structure

- Create `frontend/src/utils/lyricsSearchUrls.js` — pure URL/query/site-name helpers + the `LYRIC_SITES` list.
- Create `frontend/src/utils/lyricsSearchUrls.test.js` — `node --test`.
- Modify `backend/services/curation.js` — queue definitions, `queueCounts` keys, `saveLyrics` leave-queue behaviour.
- Modify `backend/test/curation.test.js` — queue and saveLyrics tests; fix existing tests that name `awaiting-community`.
- Modify `frontend/src/components/admin/QueueRail.jsx`, `SongQueueList.jsx`, `SongsArea.jsx` — rename + new queue.
- Modify `frontend/src/components/admin/LyricsPanel.jsx` — search block, source suggestion, hold actions.
- Modify `frontend/src/styles/admin.css` — a few small rules.
- Docs: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `CLAUDE.md` (one line).

---

### Task 1: Backend queues — To transcribe and Lyrics on hold

**Files:**
- Modify: `backend/services/curation.js:40-145`
- Test: `backend/test/curation.test.js`

**Interfaces:**
- Produces: queue keys `'to-transcribe'` and `'lyrics-on-hold'` (the latter **replaces** `'awaiting-community'`, which now throws `BAD_QUEUE`). `queueCounts()` returns a number for both. `to-process` and `needs-lyrics` exclude lyric-parked songs.

- [ ] **Step 1: Write the failing tests.** In `curation.test.js`, replace the test titled `listCurationQueue to-process excludes awaiting-community and future snoozed` and update the `queueCounts` key list, then add the new tests:

```js
test('listCurationQueue to-process excludes lyric-parked and future snoozed', async () => {
  const active = await mkSong({ title: 'ZZZCUR Q Active', status: 'pending' });
  const waiting = await mkSong({ title: 'ZZZCUR Q Waiting', status: 'pending' });
  const snoozed = await mkSong({ title: 'ZZZCUR Q Snoozed', status: 'pending' });
  await curation.setProcessing(pool, waiting, { park_reason: 'awaiting_community' });
  await curation.setProcessing(pool, snoozed, { snooze_until: '2999-01-01' });

  const ids = (await curation.listCurationQueue(pool, { queue: 'to-process' })).rows.map(r => r.id);
  assert.ok(ids.includes(active));
  assert.ok(!ids.includes(waiting), 'lyrics-on-hold excluded from to-process');
  assert.ok(!ids.includes(snoozed), 'future-snoozed excluded from to-process');

  const wIds = (await curation.listCurationQueue(pool, { queue: 'lyrics-on-hold' })).rows.map(r => r.id);
  assert.ok(wIds.includes(waiting));
  const rIds = (await curation.listCurationQueue(pool, { queue: 'remind-later' })).rows.map(r => r.id);
  assert.ok(rIds.includes(snoozed));
});

test('to-transcribe and lyrics-on-hold hold the right park reasons, pending or included', async () => {
  const tr = await mkSong({ title: 'ZZZCUR E Transcribe', status: 'pending' });
  const trInc = await mkSong({ title: 'ZZZCUR E TranscribeInc', status: 'included', published: true });
  const hold = await mkSong({ title: 'ZZZCUR E HoldCommunity', status: 'pending' });
  const holdUnclear = await mkSong({ title: 'ZZZCUR E HoldUnclear', status: 'included' });
  await curation.setProcessing(pool, tr, { park_reason: 'needs_transcription' });
  await curation.setProcessing(pool, trInc, { park_reason: 'needs_transcription' });
  await curation.setProcessing(pool, hold, { park_reason: 'awaiting_community' });
  await curation.setProcessing(pool, holdUnclear, { park_reason: 'listened_unclear' });

  const ids = async (queue) => (await curation.listCurationQueue(pool, { queue })).rows.map(r => r.id);
  const t = await ids('to-transcribe'), h = await ids('lyrics-on-hold');
  assert.ok(t.includes(tr) && t.includes(trInc));
  assert.ok(!t.includes(hold) && !t.includes(holdUnclear));
  assert.ok(h.includes(hold) && h.includes(holdUnclear));
  assert.ok(!h.includes(tr) && !h.includes(trInc));
  // shelved songs stop clogging the processing queues
  assert.ok(!(await ids('to-process')).includes(tr));
  assert.ok(!(await ids('needs-lyrics')).includes(trInc), 'included + parked is not in needs-lyrics');
  assert.ok(!(await ids('needs-lyrics')).includes(holdUnclear));
});

test('lyric-parked queues skip rejected songs and songs that already have lyrics', async () => {
  const rej = await mkSong({ title: 'ZZZCUR E RejectedParked', status: 'rejected' });
  const has = await mkSong({ title: 'ZZZCUR E ParkedHasLyrics', status: 'pending' });
  await curation.setProcessing(pool, rej, { park_reason: 'needs_transcription' });
  await curation.setProcessing(pool, has, { park_reason: 'needs_transcription' });
  await pool.query(`INSERT INTO song_lyrics (song_id, lyrics) VALUES ($1, 'la la')`, [has]);
  const ids = async (queue) => (await curation.listCurationQueue(pool, { queue })).rows.map(r => r.id);
  assert.ok(!(await ids('to-transcribe')).includes(rej));
  assert.ok(!(await ids('lyrics-on-hold')).includes(rej));
  assert.ok(!(await ids('to-transcribe')).includes(has), 'has lyrics, so not waiting on a transcription');
  assert.ok((await ids('to-process')).includes(has), 'a parked song that has lyrics is not lost from to-process');
});

test('queue counts equal list lengths for the new queues', async () => {
  const c = await curation.queueCounts(pool);
  for (const k of ['to-transcribe', 'lyrics-on-hold', 'to-process', 'needs-lyrics']) {
    assert.equal(c[k], (await curation.listCurationQueue(pool, { queue: k })).rows.length, k);
  }
});

test('the retired awaiting-community queue key is rejected', async () => {
  await assert.rejects(curation.listCurationQueue(pool, { queue: 'awaiting-community' }), e => e.code === 'BAD_QUEUE');
});
```

In the existing `queueCounts returns a number for every queue key` test, replace `'awaiting-community'` with `'lyrics-on-hold'` and add `'to-transcribe'`.

- [ ] **Step 2: Run to verify failure.** `cd backend && node --test test/curation.test.js` — Expected: the new/changed tests FAIL (`unknown queue`/`BAD_QUEUE`), everything else passes.

- [ ] **Step 3: Implement.** In `curation.js` replace lines 40-56 and the `keys` array in `queueCounts`:

```js
const ARTWORK_SQL = `(al.images IS NOT NULL AND al.images::text NOT IN ('null','[]',''))`;
const LYRIC_PARK_REASONS_SQL = `('awaiting_community','needs_transcription','listened_unclear')`;
const HAS_LYRICS_SQL = `EXISTS (SELECT 1 FROM song_lyrics sl
              WHERE sl.song_id=s.id AND sl.lyrics IS NOT NULL AND btrim(sl.lyrics) <> '')`;
// A song is "shelved" while it carries a lyric park reason AND still has no lyrics. Once lyrics
// exist it re-enters normal processing even if the reason was never cleared.
const SHELVED_SQL = `(sp.park_reason IN ${LYRIC_PARK_REASONS_SQL} AND NOT ${HAS_LYRICS_SQL})`;
const QUEUE_NAMES = ['to-process','to-transcribe','lyrics-on-hold','remind-later','needs-lyrics',
  'needs-cover','needs-video','needs-analysis','to-finalise','live','all','featured'];

function queueWhere(queue) {
  switch (queue) {
    case 'to-process':
      return `s.status='pending'
              AND NOT ${SHELVED_SQL}
              AND (sp.snooze_until IS NULL OR sp.snooze_until <= CURRENT_DATE)`;
    case 'to-transcribe':
      return `s.status IN ('pending','included') AND sp.park_reason='needs_transcription'
              AND NOT ${HAS_LYRICS_SQL}`;
    case 'lyrics-on-hold':
      return `s.status IN ('pending','included')
              AND sp.park_reason IN ('awaiting_community','listened_unclear')
              AND NOT ${HAS_LYRICS_SQL}`;
    case 'remind-later':
      return `sp.snooze_until IS NOT NULL AND sp.snooze_until > CURRENT_DATE`;
    case 'needs-lyrics':
      return `s.status='included' AND NOT ${HAS_LYRICS_SQL} AND sp.park_reason IS NULL`;
```

(The remaining cases — `needs-cover` onward — stay as they are.) In `queueCounts` replace the literal `keys` array with `const keys = QUEUE_NAMES;`. Check that `QUEUE_NAMES` is not used elsewhere with the old key (`grep -n QUEUE_NAMES backend`); if a route validates against it, the new names flow through automatically.

- [ ] **Step 4: Run to verify pass.** `cd backend && node --test test/curation.test.js` — Expected: all PASS. Then the full suite: `cd backend && npm test` — Expected: all PASS (baseline was 222).

- [ ] **Step 5: Commit** `curation.js` and `curation.test.js`: `feat(curation): To transcribe and Lyrics on hold queues`.

---

### Task 2: Backend — adding lyrics takes a song off the shelf

**Files:**
- Modify: `backend/services/curation.js` (`saveLyrics`)
- Test: `backend/test/curation.test.js`

**Interfaces:**
- Consumes: Task 1's queues (the tests assert queue membership).
- Produces: `saveLyrics(db, id, { lyrics: <non-empty> })` additionally (a) sets `songs.lyrics_status='found'` unless `lyrics_status` was passed, (b) clears a lyric `park_reason`, (c) if the prior reason was `needs_transcription` and no `lyrics_source` was passed, sets `lyrics_source='Transcribed by curator'`.

- [ ] **Step 1: Write the failing tests:**

```js
test('saving lyrics takes a song off the transcription shelf and labels the source', async () => {
  const id = await mkSong({ title: 'ZZZCUR E Transcribed', status: 'pending' });
  await curation.setProcessing(pool, id, { park_reason: 'needs_transcription' });
  const wb = await curation.saveLyrics(pool, id, { lyrics: 'by ear words' });
  assert.equal(wb.processing.park_reason, null);
  assert.equal(wb.lyrics_status, 'found');
  assert.equal(wb.lyrics_source, 'Transcribed by curator');
  assert.ok(!(await curation.listCurationQueue(pool, { queue: 'to-transcribe' })).rows.some(r => r.id === id));
  assert.ok((await curation.listCurationQueue(pool, { queue: 'to-process' })).rows.some(r => r.id === id));
});

test('saving lyrics keeps an explicit source and status, and clears a hold reason without labelling', async () => {
  const a = await mkSong({ title: 'ZZZCUR E ExplicitSrc', status: 'pending' });
  await curation.setProcessing(pool, a, { park_reason: 'needs_transcription' });
  const wa = await curation.saveLyrics(pool, a, { lyrics: 'x', lyrics_source: 'Booklet', lyrics_status: 'not_searched' });
  assert.equal(wa.lyrics_source, 'Booklet');
  assert.equal(wa.lyrics_status, 'not_searched');
  const b = await mkSong({ title: 'ZZZCUR E HoldCleared', status: 'included' });
  await curation.setProcessing(pool, b, { park_reason: 'awaiting_community' });
  const wb = await curation.saveLyrics(pool, b, { lyrics: 'from the community' });
  assert.equal(wb.processing.park_reason, null);
  assert.equal(wb.lyrics_source, null);
});

test('saving empty or translation-only lyrics does not clear the park reason', async () => {
  const id = await mkSong({ title: 'ZZZCUR E KeepParked', status: 'pending' });
  await curation.setProcessing(pool, id, { park_reason: 'needs_transcription' });
  await curation.saveLyrics(pool, id, { lyrics: '' });
  await curation.saveLyrics(pool, id, { lyrics_url: 'https://example.com/x' });
  assert.equal((await curation.getProcessing(pool, id)).park_reason, 'needs_transcription');
});
```

- [ ] **Step 2: Run to verify failure.** `cd backend && node --test test/curation.test.js` — Expected: the first two FAIL (park reason still set / status not `found`).

- [ ] **Step 3: Implement.** In `saveLyrics`, immediately after the `assertSong` / `lyrics_status` validation and before the `lyrics !== undefined` block, read the prior state; after the existing `songs` UPDATE, apply the leave-queue effects. Replace the tail of the function (from `const sets = [], params = [id];` to the `return`) with:

```js
  const hasNewLyrics = typeof lyrics === 'string' && lyrics.trim() !== '';
  let priorPark = null;
  if (hasNewLyrics) {
    priorPark = (await db.query(`SELECT park_reason FROM song_processing WHERE song_id=$1`, [id])).rows[0]?.park_reason || null;
  }
  const sets = [], params = [id];
  const add = (col, val) => { if (val !== undefined) { params.push(val === '' ? null : val); sets.push(`${col}=$${params.length}`); } };
  // Adding real lyrics means they were found; an explicit status from the caller wins.
  add('lyrics_status', hasNewLyrics && lyrics_status === undefined ? 'found' : lyrics_status);
  add('lyrics_url', lyrics_url);
  // Transcribed-by-ear songs get a plain label, but only when the caller named no source.
  const autoSource = hasNewLyrics && priorPark === 'needs_transcription' && lyrics_source === undefined
    ? 'Transcribed by curator' : lyrics_source;
  add('lyrics_source', autoSource);
  if (sets.length) await db.query(`UPDATE songs SET ${sets.join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, params);
  if (hasNewLyrics && priorPark) {
    await db.query(`UPDATE song_processing SET park_reason=NULL, updated_at=CURRENT_TIMESTAMP WHERE song_id=$1`, [id]);
  }
  return getWorkbench(db, id);
```

Note for the implementer: `saveLyrics` receives a pool in tests and a pool in the route (no existing transaction), so this is a short read-then-write sequence, not one DB transaction. That is acceptable for the single-curator admin (each statement is idempotent) and is a recorded deviation from the spec's "same transaction" wording — put it in the Decision Log in Task 6.

- [ ] **Step 4: Run to verify pass.** `cd backend && npm test` — Expected: all PASS.

- [ ] **Step 5: Commit**: `feat(curation): adding lyrics takes a song off the lyric shelves`.

---

### Task 3: Frontend queue rail and labels

**Files:**
- Modify: `frontend/src/components/admin/QueueRail.jsx:11`, `SongQueueList.jsx:8-12`, `SongsArea.jsx:14-15`

**Interfaces:**
- Consumes: Task 1's queue keys.
- Produces: rail group **Parked** = *To transcribe* (`to-transcribe`), *Lyrics on hold* (`lyrics-on-hold`), *Remind me later*; both keys selectable.

- [ ] **Step 1: Edit** `QueueRail.jsx` line 11 to:

```js
  ['Parked', [['to-transcribe', 'To transcribe', false], ['lyrics-on-hold', 'Lyrics on hold', false], ['remind-later', 'Remind me later', false]]],
```

`SongQueueList.jsx`: in `QUEUE_LABELS` replace `'awaiting-community': 'Awaiting community',` with `'to-transcribe': 'To transcribe', 'lyrics-on-hold': 'Lyrics on hold',`.
`SongsArea.jsx`: in `SELECTABLE_QUEUES` replace `'awaiting-community',` with `'to-transcribe', 'lyrics-on-hold',`.

- [ ] **Step 2: Verify.** `cd frontend && npm run lint` (0 errors; 6 pre-existing warnings) and `npm run build` (clean). Run `grep -rn "awaiting-community" frontend/src backend --include=*.js --include=*.jsx` — Expected: no hits (the `awaiting_community` underscore park reason remains legitimately in `NotesPanel`, `WorkbenchTopBar`, `curation.js`).
- [ ] **Step 3: Manual check** (backend + frontend running): Admin → Songs shows *To transcribe* and *Lyrics on hold* under Parked with counts; `/admin/songs?queue=awaiting-community` (stale link) lands on the default queue, not a blank list.
- [ ] **Step 4: Commit**: `feat(admin): rail entries for To transcribe and Lyrics on hold`.

---

### Task 4: Pure search-URL module

**Files:**
- Create: `frontend/src/utils/lyricsSearchUrls.js`
- Test: `frontend/src/utils/lyricsSearchUrls.test.js`

**Interfaces:**
- Produces (all exported, pure, no DOM):
  - `LYRIC_SITES: Array<{ key, name, host, avenue, search: ((encodedQuery: string) => string) | null }>` where `avenue` is one of the existing `lyrics_tried` keys (`genius`, `bandcamp`, `genre_site`).
  - `buildQuery({ title, artist }) -> string` e.g. `"Title" "Artist" lyrics`.
  - `allSitesUrl({ title, artist }) -> string` (one Google URL, all sites OR-ed).
  - `siteUrl(site, { title, artist }) -> string`.
  - `sourceNameFromUrl(url) -> string` (`''` for blank/invalid/non-http(s)).

- [ ] **Step 1: Write the failing test file:**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { LYRIC_SITES, buildQuery, allSitesUrl, siteUrl, sourceNameFromUrl } from './lyricsSearchUrls.js';

test('buildQuery quotes title and first artist and adds the word lyrics', () => {
  assert.equal(buildQuery({ title: 'Meat Is Murder', artist: 'The Smiths' }), '"Meat Is Murder" "The Smiths" lyrics');
});

test('buildQuery drops a missing artist rather than emitting empty quotes', () => {
  assert.equal(buildQuery({ title: 'Solo', artist: '' }), '"Solo" lyrics');
  assert.equal(buildQuery({ title: 'Solo' }), '"Solo" lyrics');
});

test('buildQuery strips double quotes and collapses whitespace', () => {
  assert.equal(buildQuery({ title: '  Say  "No"  ', artist: 'A' }), '"Say No" "A" lyrics');
});

test('allSitesUrl is one Google URL with every site OR-ed and the query encoded', () => {
  const u = new URL(allSitesUrl({ title: 'Rock & Roll #1', artist: 'Sigur Rós' }));
  assert.equal(u.origin + u.pathname, 'https://www.google.com/search');
  const q = u.searchParams.get('q');
  assert.ok(q.startsWith('"Rock & Roll #1" "Sigur Rós" lyrics ('));
  for (const s of LYRIC_SITES) assert.ok(q.includes(`site:${s.host}`), s.host);
  assert.equal((q.match(/ OR /g) || []).length, LYRIC_SITES.length - 1);
});

test('siteUrl uses a site search URL when it has one, else a single-site Google query', () => {
  const withSearch = LYRIC_SITES.find((s) => s.search);
  const without = LYRIC_SITES.find((s) => !s.search);
  assert.ok(withSearch && without, 'list has both kinds');
  assert.ok(siteUrl(withSearch, { title: 'T', artist: 'A' }).startsWith('https://'));
  const g = new URL(siteUrl(without, { title: 'T', artist: 'A' }));
  assert.equal(g.hostname, 'www.google.com');
  assert.ok(g.searchParams.get('q').endsWith(` site:${without.host}`));
});

test('every site declares a known avenue', () => {
  for (const s of LYRIC_SITES) assert.ok(['genius', 'bandcamp', 'genre_site'].includes(s.avenue), s.key);
});

test('sourceNameFromUrl maps known hosts to display names and falls back to the bare hostname', () => {
  assert.equal(sourceNameFromUrl('https://www.azlyrics.com/lyrics/x/y.html'), 'AZLyrics');
  assert.equal(sourceNameFromUrl('https://genius.com/Band-song-lyrics'), 'Genius');
  assert.equal(sourceNameFromUrl('https://someband.bandcamp.com/track/x'), 'Bandcamp');
  assert.equal(sourceNameFromUrl('https://www.example.org/page'), 'example.org');
});

test('sourceNameFromUrl returns empty for blank, garbage and non-http input', () => {
  for (const v of ['', '  ', null, undefined, 'not a url', 'ftp://x.org/a', 'javascript:alert(1)']) {
    assert.equal(sourceNameFromUrl(v), '', String(v));
  }
});
```

- [ ] **Step 2: Run to verify failure.** `cd frontend && node --test src/utils/lyricsSearchUrls.test.js` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `lyricsSearchUrls.js`:

```js
// Pure lyric-search link builders (sub-project E). No network, no DOM. The site list is the one
// place to edit when the curator names another site. `search` is that site's own search URL
// (given the already-encoded query) or null when we don't know a reliable one - those fall back
// to a Google query restricted to the site.
export const LYRIC_SITES = [
  { key: 'genius', name: 'Genius', host: 'genius.com', avenue: 'genius', search: (q) => `https://genius.com/search?q=${q}` },
  { key: 'bandcamp', name: 'Bandcamp', host: 'bandcamp.com', avenue: 'bandcamp', search: (q) => `https://bandcamp.com/search?q=${q}` },
  { key: 'musixmatch', name: 'Musixmatch', host: 'musixmatch.com', avenue: 'genre_site', search: (q) => `https://www.musixmatch.com/search/${q}` },
  { key: 'lyricscom', name: 'Lyrics.com', host: 'lyrics.com', avenue: 'genre_site', search: (q) => `https://www.lyrics.com/serp.php?st=${q}` },
  { key: 'azlyrics', name: 'AZLyrics', host: 'azlyrics.com', avenue: 'genre_site', search: null },
  { key: 'letras', name: 'Letras', host: 'letras.com', avenue: 'genre_site', search: null },
  { key: 'lyricstranslate', name: 'Lyrics Translate', host: 'lyricstranslate.com', avenue: 'genre_site', search: null },
  { key: 'darklyrics', name: 'DarkLyrics', host: 'darklyrics.com', avenue: 'genre_site', search: null },
  { key: 'lyricsfreak', name: 'LyricsFreak', host: 'lyricsfreak.com', avenue: 'genre_site', search: null },
];

const clean = (s) => String(s ?? '').replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
const google = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

export function buildQuery({ title, artist } = {}) {
  const t = clean(title), a = clean(artist);
  return [t && `"${t}"`, a && `"${a}"`, 'lyrics'].filter(Boolean).join(' ');
}

export function allSitesUrl(song) {
  const sites = LYRIC_SITES.map((s) => `site:${s.host}`).join(' OR ');
  return google(`${buildQuery(song)} (${sites})`);
}

export function siteUrl(site, song) {
  if (site.search) return site.search(encodeURIComponent(`${clean(song?.title)} ${clean(song?.artist)}`.trim()));
  return google(`${buildQuery(song)} site:${site.host}`);
}

export function sourceNameFromUrl(url) {
  let host;
  try {
    const u = new URL(String(url ?? '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    host = u.hostname.replace(/^www\./, '').toLowerCase();
  } catch { return ''; }
  const hit = LYRIC_SITES.find((s) => host === s.host || host.endsWith(`.${s.host}`));
  return hit ? hit.name : host;
}
```

- [ ] **Step 4: Run to verify pass.** `cd frontend && node --test src/utils/lyricsSearchUrls.test.js` — Expected: PASS (8). Also confirm the existing utils tests still pass: `node --test src/utils/`.
- [ ] **Step 5: Commit**: `feat(admin): pure lyric-search link builders`.

---

### Task 5: Lyrics panel — search block, source suggestion, hold actions

**Files:**
- Modify: `frontend/src/components/admin/LyricsPanel.jsx`
- Modify: `frontend/src/styles/admin.css` (append)

**Interfaces:**
- Consumes: Task 4's helpers; Task 2's backend behaviour; existing props `wb`, `savePanel(panel, body)`, `saveProcessing(body)`, each resolving `{ ok }`.
- `wb.artists[0]` is the artist used (the workbench orders artists by name, so for a collaboration this is the alphabetically first, not the lowest `song_artists.id`; acceptable, noted in the Decision Log).

- [ ] **Step 1: Search block.** Add `import { LYRIC_SITES, allSitesUrl, siteUrl, sourceNameFromUrl } from '../../utils/lyricsSearchUrls';`. Inside the component add:

```jsx
  const song = { title: wb.title, artist: (wb.artists || [])[0]?.name || '' };
  // Opening a site marks its avenue tried. Add-only: unticking stays with the Avenues checkboxes.
  const markTried = (avenue) => {
    if (!tried.includes(avenue)) saveProcessing({ lyrics_tried: [...tried, avenue] });
  };
```

Directly under the existing `wb-quicklinks` block render:

```jsx
      <div className="wb-lyric-search">
        <a className="btn btn-primary btn-sm" href={allSitesUrl(song)} target="_blank" rel="noreferrer"
          onClick={() => markTried('google')}>Search all lyric sites &#8599;</a>
        <span className="wb-field-label">or one site:</span>
        {LYRIC_SITES.map((s) => (
          <a key={s.key} className="btn btn-ghost btn-sm" href={siteUrl(s, song)} target="_blank" rel="noreferrer"
            onClick={() => markTried(s.avenue)}>{s.name}</a>
        ))}
      </div>
```

- [ ] **Step 2: Source suggestion.** Change the "Lyrics source URL" field's save so a blank `lyrics_source` is filled from the host:

```jsx
        onSave={(v) => {
          const body = { source_url: v };
          const name = sourceNameFromUrl(v);
          if (name && !wb.lyrics_source) body.lyrics_source = name;
          return savePanel('lyrics', body);
        }} />
```

(No public change: the song page only renders a lyrics link when `lyrics_url` is set, which this does not touch.)

- [ ] **Step 3: Hold actions.** Add state `const [holdSave, setHoldSave] = useState('idle');`, `const park = wb.processing?.park_reason || null;` and a handler:

```jsx
  const LYRIC_PARKS = ['needs_transcription', 'awaiting_community', 'listened_unclear'];
  const canShelve = (wb.status === 'pending' || wb.status === 'included') && !hasLyrics;
  const setHold = async (reason) => {
    setHoldSave('saving');
    // "not found" is implied by every shelving action; Clear leaves the status alone.
    if (reason) await savePanel('lyrics', { lyrics_status: 'not_found' });
    const res = await saveProcessing({ park_reason: reason || '' });
    setHoldSave(res.ok ? 'saved' : 'error');
  };
```

Render, after the Avenues block (only `canShelve` or an existing lyric park):

```jsx
      {(canShelve || LYRIC_PARKS.includes(park)) && (
        <div className="wb-field">
          <span className="wb-field-label">Can&rsquo;t find them? <SaveTag status={holdSave} /></span>
          <div className="wb-hold-actions">
            <button type="button" className={`btn btn-sm ${park === 'needs_transcription' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setHold('needs_transcription')}>Could transcribe by ear</button>
            <button type="button" className={`btn btn-sm ${park === 'awaiting_community' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setHold('awaiting_community')}>Put on hold &mdash; crowd-source</button>
            <button type="button" className={`btn btn-sm ${park === 'listened_unclear' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setHold('listened_unclear')}>Put on hold &mdash; can&rsquo;t make them out</button>
            {LYRIC_PARKS.includes(park) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHold(null)}>Clear</button>}
          </div>
        </div>
      )}
```

Verify `saveProcessing` and `savePanel` exist with these signatures in `Workbench.jsx` before relying on them (`grep -n "saveProcessing\|savePanel" frontend/src/components/admin/Workbench.jsx`); if `saveProcessing` does not return `{ ok }` for a body with `park_reason`, adapt the handler to what it returns. Note that `saveProcessing` for a `park_reason` also reaches `NotesPanel` via the same workbench state, so the parked banner updates.

- [ ] **Step 4: CSS.** Append to `admin.css`:

```css
.wb-lyric-search { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
.wb-hold-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
```

- [ ] **Step 5: Verify.** `cd frontend && npm run lint` (0 errors) and `npm run build` (clean); `grep -nP '[^\x00-\x7F]' frontend/src/components/admin/LyricsPanel.jsx` (expect none; the file uses HTML entities).
- [ ] **Step 6: Commit**: `feat(admin): lyric-site search links and lyric shelving in the Lyrics panel`.

---

### Task 6: Smoke test, whole-branch review, docs

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `CLAUDE.md`

- [ ] **Step 1: Gates.** `cd backend && npm test` (all pass), `cd frontend && node --test src/utils/ && npm run lint && npm run build`.
- [ ] **Step 2: Browser smoke** (Chrome tools or Puppeteer, from a scratchpad script with absolute requires — never a temp file under `backend/`; check the :5000 process tree before restarting anything; never kill all node). Using a throwaway song created via quick-capture, with the original state restored afterwards: (a) *Search all lyric sites* opens one Google tab whose `q` contains the quoted title/artist and every `site:`; a per-site link opens and the avenue ticks; (b) paste a source URL and watch `lyrics_source` fill; (c) *Could transcribe by ear* → song appears under *To transcribe*, disappears from *To be processed*; paste lyrics → it leaves *To transcribe*, `lyrics_source` reads "Transcribed by curator", status `found`; (d) *Put on hold* → *Lyrics on hold* count rises; *Clear* returns it; (e) the stale `?queue=awaiting-community` link; (f) 390px layout of the Lyrics panel. Delete the throwaway song and confirm counts return to baseline.
- [ ] **Step 3: Whole-branch review.** Dispatch a fresh opus reviewer on the diff `main...HEAD`; fix Critical/Important findings.
- [ ] **Step 4: Docs.** `PROJECT_STATE.md`: advance the current session, refresh Next Tasks (next: F, then the logged requests 2 and 3), Decision Log entries (Brave rejected 2026-10-12; link-building only; per-site open marks the avenue add-only instead of a tick; artist = `wb.artists[0]`; `saveLyrics` effects are sequential statements, not one transaction; `awaiting-community` queue key retired), and a Changelog entry. `PROJECT_PLAN.md`: mark E ☑/◐. `CLAUDE.md`: update the `curation` queue mentions only if any name `awaiting-community` (grep first).
- [ ] **Step 5: Commit and push** the docs; hold the merge for the curator's smoke, as with C and D.

---

## Self-review

- **Spec coverage:** §3 (search all / per-site / source suggestion / first artist / pure tested module) → Tasks 4-5; §4.1 (not-found, transcribe, hold, clear in Lyrics panel for pending + included) → Task 5; §4.2 (queue table, counts from `queueWhere`, rail) → Tasks 1, 3; §4.3 (`saveLyrics` leaves queue, transcription label) → Task 2, and the "verify where `lyrics_source` surfaces publicly" item is resolved: `SongDetailPage` shows a lyrics link only when `lyrics_url` is set, so a source label with no URL is invisible; §6 testing → Tasks 1, 2, 4, 6. §5 out-of-scope respected (no public page change).
- **Deliberate deviations from the spec text** (record in Decision Log): per-site "tick" is add-only on opening a link; "same transaction" is sequential statements; the rename touches `QueueRail`, `SongQueueList`, `SongsArea` only (no `NotesPanel`/`WorkbenchTopBar` change was needed: they use the underscore park reasons, not the queue key).
- **Types/names:** `to-transcribe`, `lyrics-on-hold`, `LYRIC_SITES`, `buildQuery`, `allSitesUrl`, `siteUrl`, `sourceNameFromUrl`, `markTried`, `setHold` are used identically across tasks.
