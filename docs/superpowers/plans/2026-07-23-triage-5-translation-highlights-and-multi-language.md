# Triage 5 — Translation Highlights + Multi-Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the curator add a key-lyrics highlight from the English translation, and record more than one language per song (with browse filtering on each).

**Architecture:** Two independent halves that meet on non-English songs. The highlights half is frontend-only — one hardwired ref in `LyricsPanel` becomes two, with no storage change. The language half migrates `songs.language` from `VARCHAR(40)` to `TEXT[]` (migration 009) and converts every consumer: an array-overlap filter clause, `unnest`-based facet counts, an array-normalising `saveDetails`, a new read-only suggestions endpoint, a chip editor in the workbench, and a "Sung in" cell on the public song page.

**Tech Stack:** Node/Express + PostgreSQL (`pg`), React 18 + Vite, `node:test` for backend tests (run against the live dev database — there is no frontend test runner; frontend changes are verified by lint, build and live smoke, as in Phase 3 / B2 / B3).

**Spec:** [`../specs/2026-07-23-triage-5-translation-highlights-and-multi-language-design.md`](../specs/2026-07-23-triage-5-translation-highlights-and-multi-language-design.md)

## Global Constraints

- **Never SELECT `song_lyrics` (lyrics/translation) from a public API route.** Only admin-path code may read it. Task 3 publishes *short fragments* into `songs.lyrics_highlights`, which is a different, already-public column — do not widen any public query to `song_lyrics`.
- **Backend tests are `node:test` against the live dev DB.** Run from `backend/`: `npm test`. Each test file uses its own fixture prefix (`ZZZCUR` in `curation.test.js`, `ZZZANL` in `analysis.test.js`) — never reuse another file's prefix; parallel runs share a database and prefix-LIKE cleanup races.
- **Do not run temporary scripts from inside `backend/`** — nodemon restarts the dev server mid-run. Put them in the scratchpad directory and `require()` backend modules by absolute path (including `dotenv`, which is only installed under `backend/node_modules`). Wherever this plan writes `<scratchpad>`, substitute your session's scratchpad directory; for the session this plan was written in that is
  `C:\Users\Owner\AppData\Local\Temp\claude\C--Users-Owner-Documents-AI-Applications-vegan-playlist\38d5bf42-b356-4e20-86ec-6edb863e2a12\scratchpad`.
- **Never run `taskkill /F /IM node.exe`.** Kill background processes by their specific PID only.
- **New/updated CSS must use the design tokens** (`--bg-*`, `--text-*`, `--accent-*`, `--space-*`, `--radius-*`), never raw colours.
- **Admin frontend code fetches via `adminFetch`** (relative `/api` URL through the Vite proxy + `X-Admin-Password` header) — never hardcode `localhost:5000` or the header.
- **After any edit containing non-ASCII characters** (`Māori`, `×`, `…`, `—`), verify the file did not get double-encoded: `rg -nP '[^\x00-\x7F]' <file>` must show the intended glyphs, not mojibake.
- Frontend verification commands, run from `frontend/`: `npm run lint` (expect **0 errors**) and `npm run build` (expect success).

---

### Task 1: Migration 009 + backend conversion to `TEXT[]`

The migration and its consumers ship together: the moment the column becomes an array, the old
`s.language = ANY(...)` clause still parses but the facet queries' `s.language <> ''` raises
`malformed array literal`. Splitting this would leave `/browse-facets` returning 500.

**Files:**
- Create: `backend/database/migrations/009_multi_language.sql`
- Create: `backend/test/migration009.test.js`, `backend/test/languageFilter.test.js`
- Modify: `backend/services/browseFilters.js:43-45`
- Modify: `backend/services/curation.js:231-238`
- Modify: `backend/routes/spotify.js:209-254` (`/songs/:id`), `:390-395` (`/filter-options`), `:466-469` (`/browse-facets`)
- Modify: `backend/test/browseFilters.test.js:42-48`
- Modify: `backend/test/analysis.test.js:262-275`, `:340-349`
- Modify: `backend/test/curation.test.js:209-237`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `songs.language` is `text[]` (or `NULL`). `curation.saveDetails(db, id, { language })` accepts `string[] | string | null | undefined`, normalises to a deduped trimmed array, and stores `NULL` for empty. `curation.getWorkbench(db, id)` returns `language: string[] | null`. `GET /api/spotify/songs/:id` returns `language: string[] | null`. Task 2 adds `curation.listLanguages`; Tasks 4–5 consume the array shape.

- [ ] **Step 1: Snapshot the current language values (reversibility insurance)**

The `songs` table holds the curated dataset. Before altering it, dump the 38 populated values so the
change is trivially reversible. Create
`<scratchpad>/lang-snapshot.js` (`<scratchpad>` = the session scratchpad directory):

```js
const fs = require('fs');
const backend = 'C:/Users/Owner/Documents/AI Applications/vegan-playlist/backend/';
require(backend + 'node_modules/dotenv').config({ path: backend + '.env' });
const db = require(backend + 'database/db');

(async () => {
  const r = await db.query(
    `SELECT id, language FROM songs WHERE language IS NOT NULL ORDER BY id`);
  fs.writeFileSync(__dirname + '/lang-snapshot.json', JSON.stringify(r.rows, null, 2));
  console.log('snapshot rows:', r.rows.length);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
```

Run: `node "<scratchpad>/lang-snapshot.js"`
Expected: `snapshot rows: 38`

- [ ] **Step 2: Write the failing migration test**

Create `backend/test/migration009.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');

after(async () => { await pool.end(); });

test('songs.language is a text array', async () => {
  const r = await pool.query(`
    SELECT data_type, udt_name FROM information_schema.columns
    WHERE table_name = 'songs' AND column_name = 'language'`);
  assert.equal(r.rows[0].data_type, 'ARRAY');
  assert.equal(r.rows[0].udt_name, '_text');
});

test('existing language values survived the conversion', async () => {
  const r = await pool.query(`
    SELECT COUNT(*)::int AS n FROM songs WHERE language IS NOT NULL AND cardinality(language) > 0`);
  assert.ok(r.rows[0].n >= 38, `expected at least the 38 pre-migration rows, got ${r.rows[0].n}`);
});

test("the 'Mouri' typo was corrected to 'Māori'", async () => {
  const bad = await pool.query(`SELECT COUNT(*)::int AS n FROM songs WHERE 'Mouri' = ANY(language)`);
  assert.equal(bad.rows[0].n, 0, "no row should still say 'Mouri'");
  const good = await pool.query(`SELECT COUNT(*)::int AS n FROM songs WHERE 'Māori' = ANY(language)`);
  assert.equal(good.rows[0].n, 1);
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run from `backend/`: `node --test test/migration009.test.js`
Expected: FAIL — first assertion gets `'character varying'`, not `'ARRAY'`.

- [ ] **Step 4: Write the migration**

Create `backend/database/migrations/009_multi_language.sql`:

```sql
-- 009 — songs.language becomes multi-valued (bilingual songs).
-- VARCHAR(40) -> text[]. Idempotent: the type change is guarded, the data fix is
-- self-limiting. regexp_split_to_array (not string_to_array) because it trims the
-- whitespace around the separator in one pass, and because ALTER ... USING forbids
-- the subquery a per-element btrim would need.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'songs' AND column_name = 'language'
               AND data_type <> 'ARRAY') THEN
    ALTER TABLE songs ALTER COLUMN language TYPE text[]
      USING CASE WHEN btrim(COALESCE(language, '')) = '' THEN NULL
                 ELSE regexp_split_to_array(btrim(language), '\s*;\s*') END;
    UPDATE songs SET language = NULLIF(array_remove(language, ''), '{}')
      WHERE language IS NOT NULL;
  END IF;
END $$;

-- Data fix: 'Mouri' is a typo for 'Māori' (1 row).
UPDATE songs SET language = array_replace(language, 'Mouri', 'Māori')
  WHERE language IS NOT NULL AND 'Mouri' = ANY(language);
```

Then verify the encoding survived: `rg -nP '[^\x00-\x7F]' backend/database/migrations/009_multi_language.sql`
Expected: two lines, both showing `Māori` (not `MÄori` or similar).

- [ ] **Step 5: Apply the migration**

Create `<scratchpad>/apply-009.js`:

```js
const fs = require('fs');
const backend = 'C:/Users/Owner/Documents/AI Applications/vegan-playlist/backend/';
require(backend + 'node_modules/dotenv').config({ path: backend + '.env' });
const db = require(backend + 'database/db');
const sql = fs.readFileSync(backend + 'database/migrations/009_multi_language.sql', 'utf8');

(async () => {
  await db.query(sql);
  const r = await db.query(
    `SELECT language, COUNT(*)::int AS n FROM songs WHERE language IS NOT NULL GROUP BY language ORDER BY n DESC`);
  console.table(r.rows);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
```

Run: `node "<scratchpad>/apply-009.js"`
Expected: a table of array values — `[ 'English' ]` ×35, `[ 'German' ]`, `[ 'Māori' ]`, `[ 'Portuguese' ]`.

- [ ] **Step 6: Run the migration test to verify it passes**

Run from `backend/`: `node --test test/migration009.test.js`
Expected: PASS (3/3).

- [ ] **Step 7: Update the language filter tests — unit + DB-level (still failing)**

Two levels, because a string-matching unit test cannot prove Postgres actually matches a bilingual
row. **(a)** In `backend/test/browseFilters.test.js` (pure, no DB), add after the existing
`buildWhere numbers params from startIndex` test (which needs no change — it only asserts
parameter positions):

```js
test('language filter uses array overlap so a bilingual song matches either language', () => {
  const r = b.buildWhere({ languages: ['English', 'Portuguese'] });
  const clause = r.where.find(c => c.includes('s.language'));
  assert.ok(clause, 'a language clause is emitted');
  assert.ok(clause.includes('&&'), 'overlap operator, not = ANY');
  assert.ok(clause.includes('::text[]'), 'parameter is cast to text[]');
  assert.deepEqual(r.params[0], ['English', 'Portuguese']);
});
```

**(b)** Create `backend/test/languageFilter.test.js` — DB-backed, with its own fixture prefix
`ZZZLNG` (never reuse another file's prefix):

```js
// DB-level cover for the multi-language browse behaviour: a bilingual song must be
// findable under EITHER language and counted under BOTH. The facet SQL below mirrors
// the canonical copy in routes/spotify.js (/filter-options, /browse-facets); the live
// smoke in the plan's final task is the anti-drift check on that duplication.
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const browse = require('../services/browseFilters');

const PREFIX = 'ZZZLNG';
after(async () => {
  await pool.query(`DELETE FROM songs WHERE title LIKE '${PREFIX}%'`);
  await pool.end();
});

async function mkBilingual() {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, data_source, language)
     VALUES ('${PREFIX} Bilingual', 'included', true, 'manual', ARRAY['ZZZLNGPor','ZZZLNGEng'])
     RETURNING id`)).rows[0].id;
}

test('a bilingual song is returned when filtering by either of its languages', async () => {
  const id = await mkBilingual();
  for (const lang of ['ZZZLNGPor', 'ZZZLNGEng']) {
    const bw = browse.buildWhere({ languages: [lang] }, { startIndex: 1 });
    const r = await pool.query(
      `SELECT s.id FROM songs s${browse.joinSql(bw.joins)}
       WHERE s.status='included' AND s.published=true AND ${bw.where.join(' AND ')}`, bw.params);
    assert.ok(r.rows.some((row) => row.id === id), `found under ${lang}`);
  }
});

test('a bilingual song counts under both languages in the unnest facet', async () => {
  await mkBilingual();
  const r = await pool.query(`
    SELECT lang AS value, COUNT(*)::int AS count
    FROM songs s, unnest(s.language) AS lang
    WHERE s.status = 'included' AND s.published = true
    GROUP BY lang`);
  const por = r.rows.find((x) => x.value === 'ZZZLNGPor');
  const eng = r.rows.find((x) => x.value === 'ZZZLNGEng');
  assert.ok(por && por.count >= 1, 'counted under its first language');
  assert.ok(eng && eng.count >= 1, 'counted under its second language');
});
```

- [ ] **Step 8: Run them to make sure they fail**

Run from `backend/`: `node --test test/browseFilters.test.js test/languageFilter.test.js`
Expected: FAIL — `clause.includes('&&')` is false (the clause is still
`s.language = ANY($1::text[])`), and the DB tests fail because `= ANY` on a `text[]` column
compares the whole array, so neither single language matches.

- [ ] **Step 9: Convert the filter clause**

In `backend/services/browseFilters.js`, replace lines 43-45:

```js
  if (inc('language') && asList(filters.languages).length) {
    where.push(`s.language && $${idx}::text[]`); params.push(asList(filters.languages)); idx++;
  }
```

- [ ] **Step 10: Run them to verify they pass**

Run from `backend/`: `node --test test/browseFilters.test.js test/languageFilter.test.js`
Expected: PASS (all tests in both files).

- [ ] **Step 11: Update the `saveDetails` / `getWorkbench` tests (failing)**

In `backend/test/curation.test.js`, change line 213 and its assertion at 217:

```js
  await pool.query(`UPDATE songs SET language=ARRAY['Spanish'], lyrics_highlights='a great line' WHERE id=$1`, [id]);
```

```js
  assert.deepEqual(wb.language, ['Spanish']);
```

and replace the `saveDetails updates title + language` test (lines 232-237) with:

```js
test('saveDetails updates title + language', async () => {
  const id = await mkSong({ title: 'ZZZCUR Save Details' });
  const wb = await curation.saveDetails(pool, id, {
    title: 'ZZZCUR Save Details 2', language: ['French', 'English'],
  });
  assert.equal(wb.title, 'ZZZCUR Save Details 2');
  assert.deepEqual(wb.language, ['French', 'English']);
});

test('saveDetails normalises languages: trims, drops blanks, dedupes case-insensitively', async () => {
  const id = await mkSong({ title: 'ZZZCUR Lang Norm' });
  const wb = await curation.saveDetails(pool, id, { language: ['  German ', '', 'german', 'English'] });
  assert.deepEqual(wb.language, ['German', 'English']);
});

test('saveDetails accepts a semicolon string and clears with an empty array', async () => {
  const id = await mkSong({ title: 'ZZZCUR Lang String' });
  const a = await curation.saveDetails(pool, id, { language: 'German; English' });
  assert.deepEqual(a.language, ['German', 'English']);
  const b = await curation.saveDetails(pool, id, { language: [] });
  assert.equal(b.language, null);
});
```

- [ ] **Step 12: Run them to make sure they fail**

Run from `backend/`: `node --test test/curation.test.js`
Expected: FAIL — the normalisation tests error (`malformed array literal` / the raw array is stored
undeduped), because `saveDetails` still writes the value through untouched.

- [ ] **Step 13: Normalise languages in `saveDetails`**

In `backend/services/curation.js`, add above `saveDetails` (around line 231):

```js
// language is text[] since migration 009. Accepts an array (the workbench chip
// editor), a legacy semicolon string, or ''/null to clear. Trims, drops blanks,
// dedupes case-insensitively while keeping the curator's chosen casing + order.
function normLanguages(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const arr = Array.isArray(v) ? v : String(v).split(';');
  const out = [];
  for (const raw of arr) {
    const s = String(raw).trim();
    if (!s) continue;
    if (out.some((k) => k.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
  }
  return out.length ? out : null;
}
```

and change the body of `saveDetails` to normalise before the shared `add`:

```js
async function saveDetails(db, id, { title, language, status_notes } = {}) {
  await assertSong(db, id);
  const sets = [], params = [id];
  const add = (col, val) => { if (val !== undefined) { params.push(val === '' ? null : val); sets.push(`${col}=$${params.length}`); } };
  add('title', title); add('language', normLanguages(language)); add('status_notes', status_notes);
  if (sets.length) await db.query(`UPDATE songs SET ${sets.join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, params);
  return getWorkbench(db, id);
}
```

`normLanguages` returns `undefined` when the caller omitted `language`, so `add` still skips it —
a title-only save must never clear the language.

- [ ] **Step 14: Run them to verify they pass**

Run from `backend/`: `node --test test/curation.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 15: Convert the two `analysis.test.js` constraint fixtures (failing first)**

These use `songs.language` as a convenient scalar constraint for facet tests. Change line 265-266:

```js
    `INSERT INTO songs (title, status, published, data_source, language)
     VALUES ('ZZZANL Constrained', 'included', true, 'manual', ARRAY['English']) RETURNING id`)).rows[0];
```

line 274:

```js
    joinSql: '', where: [`s.language && $2::text[]`], params: [['ZZZ-NoSuchLang']],
```

line 343:

```js
  await pool.query(`UPDATE songs SET language = ARRAY['ZZZ-NoSuchLang'] WHERE id = $1`, [id]);
```

and line 345:

```js
    perspective: { joinSql: '', where: [`s.language && $1::text[]`], params: [['ZZZ-NoSuchLang']] },
```

- [ ] **Step 16: Run the analysis suite**

Run from `backend/`: `node --test test/analysis.test.js`
Expected: PASS. (If run *before* the edits it fails with `malformed array literal: "ZZZ-NoSuchLang"`
— that is the failure these edits fix.)

- [ ] **Step 17: Convert the three route-level SQL sites**

`backend/routes/spotify.js`. **(a)** `/songs/:id` — add `s.language` to the SELECT list, immediately
after `s.lyrics_highlights,` (line 235):

```js
        s.lyrics_highlights,
        s.language,
```

and extend the GROUP BY on line 254 (the query aggregates artists, so every non-aggregated column
must be grouped — `s.id` alone is not enough here because `s.language` is not functionally
dependent in the eyes of older planners; grouping it explicitly is safe either way):

```js
      GROUP BY s.id, s.language, al.id
```

**(b)** `/filter-options` — replace the `languagesQuery` (lines 390-395):

```js
    const languagesQuery = `
      SELECT lang AS value, COUNT(*)::int AS count
      FROM songs s, unnest(s.language) AS lang
      WHERE s.status = 'included' AND s.published = true
      GROUP BY lang
      ORDER BY count DESC, value ASC`;
```

**(c)** `/browse-facets` — replace `langSql` (lines 466-469):

```js
    const bwLang = browse.buildWhere(f, { exclude: 'language' });
    const langSql = `SELECT lang AS value, COUNT(DISTINCT s.id)::int AS count
      FROM songs s${browse.joinSql(bwLang.joins)} CROSS JOIN LATERAL unnest(s.language) AS lang
      ${whereSql(bwLang)}
      GROUP BY lang ORDER BY count DESC, value ASC`;
```

In both facet queries the old `AND s.language IS NOT NULL AND s.language <> ''` guards are **gone
on purpose**: `unnest` in the `FROM` list already drops rows whose array is NULL or empty, and
`<> ''` would now raise a type error.

- [ ] **Step 18: Run the whole backend suite**

Run from `backend/`: `npm test`
Expected: PASS — the previous total was **121**; this task adds 3 migration + 1 filter-clause
+ 2 DB-level language + 2 normalisation tests, so expect **129 passing, 0 failing**.

- [ ] **Step 19: Smoke the three converted endpoints against a temp backend**

Start a backend on port 5001 so the curator's dev server is untouched (PowerShell):

```powershell
$env:PORT = '5001'
$p = Start-Process node -ArgumentList 'server.js' -WorkingDirectory 'C:\Users\Owner\Documents\AI Applications\vegan-playlist\backend' -PassThru
$p.Id
```

Then (song 4691 is the live Portuguese song):

```powershell
(Invoke-RestMethod 'http://localhost:5001/api/spotify/songs/4691').language
(Invoke-RestMethod 'http://localhost:5001/api/spotify/filter-options').languages
(Invoke-RestMethod 'http://localhost:5001/api/spotify/browse-facets').languages
(Invoke-RestMethod 'http://localhost:5001/api/spotify/search?languages=Portuguese').songs.Count
```

Expected: `Portuguese`; both facet lists show `English` (~32), `German`, `Māori`, `Portuguese` each
with a count of 1; the filtered search returns **1**.

Stop it by PID only — never `taskkill /F /IM node.exe`:

```powershell
Stop-Process -Id $p.Id
```

- [ ] **Step 20: Commit**

```bash
git add backend/database/migrations/009_multi_language.sql backend/test/migration009.test.js \
        backend/test/languageFilter.test.js backend/services/browseFilters.js \
        backend/services/curation.js backend/routes/spotify.js \
        backend/test/browseFilters.test.js backend/test/analysis.test.js backend/test/curation.test.js
git commit -m "feat(language): songs.language becomes text[] (migration 009)

Bilingual songs can now carry several languages. The filter clause becomes an
array overlap and both facet queries unnest, so a song counts under each of its
languages and ticking either finds it. saveDetails normalises (trim, drop blanks,
dedupe case-insensitively, empty -> NULL). Migration also fixes the 'Mouri' typo.

Three existing tests used the column as a scalar and were converted, not dropped.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `GET /api/admin/languages` (chip suggestions)

**Files:**
- Modify: `backend/services/curation.js` (add + export `listLanguages`)
- Modify: `backend/routes/admin.js` (new route in the "Curation workbench (Sub-project A)" section, after `/curation/recent` at line 1871-1879)
- Modify: `backend/test/curation.test.js` (new test)

**Interfaces:**
- Consumes: `songs.language` is `text[]` (Task 1).
- Produces: `curation.listLanguages(db) → Promise<Array<{ value: string, count: number }>>`, ordered by count desc then value asc, covering **all** songs regardless of status. Served as `GET /api/admin/languages → { success: true, languages: [...] }`. Task 4 consumes this endpoint.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/curation.test.js`:

```js
test('listLanguages returns distinct languages across all statuses, most-used first', async () => {
  const a = await mkSong({ title: 'ZZZCUR Lang List A' });
  const b = await mkSong({ title: 'ZZZCUR Lang List B' });
  await curation.saveDetails(pool, a, { language: ['ZZZCURLangOne', 'ZZZCURLangTwo'] });
  await curation.saveDetails(pool, b, { language: ['ZZZCURLangOne'] });

  const rows = await curation.listLanguages(pool);
  const one = rows.find(r => r.value === 'ZZZCURLangOne');
  const two = rows.find(r => r.value === 'ZZZCURLangTwo');
  assert.ok(one && two, 'both seeded languages are listed');
  assert.equal(one.count, 2, 'counts every song carrying the language');
  assert.equal(two.count, 1);
  assert.ok(rows.indexOf(one) < rows.indexOf(two), 'ordered by count desc');
});
```

(`mkSong` creates pending, unpublished songs — which is exactly the point: this endpoint must see
songs the public `/filter-options` cannot.)

- [ ] **Step 2: Run it to make sure it fails**

Run from `backend/`: `node --test test/curation.test.js`
Expected: FAIL — `curation.listLanguages is not a function`.

- [ ] **Step 3: Add the service function**

In `backend/services/curation.js`, add next to the other read helpers and add `listLanguages` to
the `module.exports` list:

```js
// Distinct languages across the WHOLE catalogue (any status) — feeds the workbench
// chip suggestions. The public /filter-options equivalent sees published songs only,
// and the curator edits unpublished ones.
async function listLanguages(db) {
  const r = await db.query(`
    SELECT lang AS value, COUNT(*)::int AS count
    FROM songs s, unnest(s.language) AS lang
    GROUP BY lang
    ORDER BY count DESC, value ASC`);
  return r.rows;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run from `backend/`: `node --test test/curation.test.js`
Expected: PASS.

- [ ] **Step 5: Add the route**

In `backend/routes/admin.js`, directly after the `/curation/recent` handler (ends line 1879):

```js
// Distinct languages in the catalogue — suggestion source for the workbench
// language chips. Read-only.
router.get('/languages', async (req, res) => {
  try {
    res.json({ success: true, languages: await curation.listLanguages(pool) });
  } catch (error) {
    console.error('Error fetching languages:', error);
    res.status(500).json({ error: 'Failed to fetch languages', details: error.message });
  }
});
```

- [ ] **Step 6: Verify the route serves**

Start a temp backend on 5001 exactly as in Task 1 Step 19, then:

```powershell
(Invoke-RestMethod 'http://localhost:5001/api/admin/languages' -Headers @{ 'X-Admin-Password' = $env:ADMIN_PASSWORD }).languages
```

(the password is `ADMIN_PASSWORD` in `backend/.env` — read it from there if the env var is unset.)
Expected: `English` with the largest count, then `German` / `Māori` / `Portuguese`. Confirm the route
is registered rather than shadowed: it must **not** return the SPA/404 body. Stop by PID.

- [ ] **Step 7: Commit**

```bash
git add backend/services/curation.js backend/routes/admin.js backend/test/curation.test.js
git commit -m "feat(admin): GET /api/admin/languages for workbench chip suggestions

Read-only distinct-language list over the whole catalogue (any status), so the
workbench can suggest languages on unpublished songs too.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: "+ Add selection" on the translation field

Frontend-only, no storage change: the highlight blob and `saveHighlights` are untouched.

**Files:**
- Modify: `frontend/src/components/admin/LyricsPanel.jsx`

**Interfaces:**
- Consumes: `wb.translation` (already returned by `getWorkbench`), `savePanel('highlights', { lyrics_highlights })` (unchanged).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Generalise the highlight handler**

In `frontend/src/components/admin/LyricsPanel.jsx`, add the second ref beside `lyricsRef`
(line 27) and a translation-presence flag beside `hasLyrics` (line 26):

```jsx
  const hasLyrics = !!(wb.lyrics && wb.lyrics.trim());
  const hasTranslation = !!(wb.translation && wb.translation.trim());
  const lyricsRef = useRef(null);
  const translationRef = useRef(null);
```

Replace `addHighlight` (lines 41-53) with:

```jsx
  const addHighlightFrom = async (ref, sourceLabel) => {
    const el = ref.current;
    if (!el) return;
    const raw = el.value.substring(el.selectionStart, el.selectionEnd).trim();
    // Collapse internal newlines/whitespace to a single space so a multi-line
    // passage (e.g. a couplet) stays one entry in the newline-joined storage —
    // otherwise it would fragment on the next `split('\n')` read.
    const sel = raw.replace(/\s*\n\s*/g, ' ');
    if (!sel) { window.alert(`Select a passage in the ${sourceLabel} box first.`); return; }
    setHighlightsSave('saving');
    const res = await savePanel('highlights', { lyrics_highlights: [...highlights, sel].join('\n') });
    setHighlightsSave(res.ok ? 'saved' : 'error');
  };
```

- [ ] **Step 2: Give the translation field a ref and its own button**

Replace the translation block (lines 96-99) with:

```jsx
      <div className="wb-field">
        <div className="wb-highlights-head">
          <span className="wb-field-label">Translation (local-only)</span>
          <button type="button" className="btn btn-secondary btn-sm"
            disabled={!hasLyrics || !hasTranslation}
            onClick={() => addHighlightFrom(translationRef, 'translation')}>+ Add selection</button>
        </div>
        <AutoText label="" initial={wb.translation} multiline rows={6}
          disabled={!hasLyrics}
          inputRef={translationRef}
          onSave={(v) => savePanel('lyrics', { translation: v })} />
      </div>
      {!hasLyrics && <p className="admin-stub">Add full lyrics first</p>}
```

`AutoText` renders its own `<label>` with a `SaveTag`, so passing `label=""` keeps the save
indicator working while the heading above carries the field name and the button — the same
head/button pattern the Key-lyrics block already uses.

- [ ] **Step 3: Point the existing lyrics button at the new handler**

Line 104's button becomes:

```jsx
          <button type="button" className="btn btn-secondary btn-sm"
            onClick={() => addHighlightFrom(lyricsRef, 'lyrics')}>+ Add selection</button>
```

and the empty-state hint (line 107) mentions both sources:

```jsx
          ? <p className="admin-stub">Select a line in the lyrics or translation box above, then “Add selection”.</p>
```

- [ ] **Step 4: Lint and build**

Run from `frontend/`: `npm run lint`
Expected: 0 errors.
Run from `frontend/`: `npm run build`
Expected: build succeeds.

Then `rg -nP '[^\x00-\x7F]' src/components/admin/LyricsPanel.jsx` — the curly quotes in the hint
must still read `“Add selection”`, not mojibake.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/LyricsPanel.jsx
git commit -m "feat(workbench): add key-lyric highlights from the translation

addHighlight becomes addHighlightFrom(ref, label); the translation field gets its
own ref and '+ Add selection' button, disabled until a translation is saved.
Highlights stay a flat newline-joined list — no storage change.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Workbench language chip editor

**Files:**
- Modify: `frontend/src/components/admin/DetailsPanel.jsx`
- Modify: `frontend/src/styles/admin.css:92-94`

**Interfaces:**
- Consumes: `wb.language: string[] | null` (Task 1), `GET /api/admin/languages` (Task 2), `savePanel('details', { language })`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the `LanguageChips` component**

In `frontend/src/components/admin/DetailsPanel.jsx`, change the imports (line 1-2) to:

```jsx
import { useCallback, useEffect, useState } from 'react';
import { AutoText, SaveTag } from './SavedField';
import { adminFetch } from '../../api/adminApi';
```

and add the component above `DetailsPanel` (it has a single consumer, so it stays in this file per
the project's convention):

```jsx
// Multi-value language editor. songs.language is text[] since migration 009.
// Every mutation saves immediately and reports through SaveTag (the A3 standard:
// no fire-and-forget saves).
function LanguageChips({ wb, savePanel }) {
  const langs = Array.isArray(wb.language) ? wb.language : [];
  const [status, setStatus] = useState('idle');
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState([]);

  const loadSuggestions = useCallback(() => {
    adminFetch('/api/admin/languages')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.languages)) setSuggestions(d.languages.map((l) => l.value)); })
      .catch(() => {});
  }, []);
  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  const save = async (next) => {
    setStatus('saving');
    const res = await savePanel('details', { language: next });
    setStatus(res && res.ok ? 'saved' : 'error');
    // A newly typed language becomes a suggestion for the next song.
    if (res && res.ok) loadSuggestions();
  };

  const has = (v) => langs.some((l) => l.toLowerCase() === v.toLowerCase());
  const add = (value) => {
    const v = (value || '').trim();
    setDraft('');
    if (!v || has(v)) return;
    save([...langs, v]);
  };
  const remove = (idx) => save(langs.filter((_, i) => i !== idx));

  const unused = suggestions.filter((s) => !has(s)).slice(0, 6);

  return (
    <div className="wb-field wb-lang">
      <span className="wb-field-label">Language sung in <SaveTag status={status} /></span>
      <div className="wb-lang-chips">
        {langs.length === 0
          ? <span className="admin-stub">None recorded</span>
          : langs.map((l, idx) => (
              <span key={`${l}-${idx}`} className="wb-lang-chip">{l}
                <button type="button" className="wb-lang-x" aria-label={`Remove ${l}`}
                  onClick={() => remove(idx)}>×</button>
              </span>
            ))}
      </div>
      <input className="input" value={draft} placeholder="Add a language, then press Enter"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }}
        onBlur={() => add(draft)} />
      {unused.length > 0 && (
        <div className="wb-lang-suggest">
          {unused.map((s) => (
            <button key={s} type="button" className="btn btn-secondary btn-sm"
              onClick={() => add(s)}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Use it, and delete the old single-value field**

In `DetailsPanel`, delete the `langSave` state and the `setEnglish` handler (lines 14-20) — the
"Set English" button is absorbed into the suggestion row, where `English` sorts first as the most
used value. Replace the `<div className="wb-lang">…</div>` block (lines 26-33) with:

```jsx
      <LanguageChips wb={wb} savePanel={savePanel} />
```

`useState` remains imported because `LanguageChips` uses it.

- [ ] **Step 3: Style the chips**

In `frontend/src/styles/admin.css`, replace lines 92-94 (`.wb-lang`, `.wb-lang .wb-field`,
`.wb-lang .btn`) with:

```css
.wb-lang { margin-bottom: var(--space-3); }
.wb-lang-chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: var(--space-1) 0; min-height: 24px; }
.wb-lang-chip { display: inline-flex; align-items: center; gap: var(--space-1); padding: 1px var(--space-2); border-radius: var(--radius-pill); font-size: 0.75rem; background: var(--bg-surface-raised); border: 1px solid var(--border-hairline); color: var(--text-secondary); }
.wb-lang-x { background: none; border: none; padding: 0; cursor: pointer; color: var(--text-muted); font-size: 0.95rem; line-height: 1; }
.wb-lang-x:hover { color: var(--accent-ember-60); }
.wb-lang-suggest { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
```

Every value is an existing token (all six are already used elsewhere in this file).

- [ ] **Step 4: Lint and build**

Run from `frontend/`: `npm run lint`
Expected: 0 errors (in particular no unused-variable error for the removed `setEnglish`).
Run from `frontend/`: `npm run build`
Expected: build succeeds.

Then `rg -nP '[^\x00-\x7F]' src/components/admin/DetailsPanel.jsx` — the remove button must read
`×`, not mojibake.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/DetailsPanel.jsx frontend/src/styles/admin.css
git commit -m "feat(workbench): language chips + catalogue suggestions

Replaces the single free-text language field with removable chips, an add input
(Enter), and one-click suggestions drawn from languages already in the catalogue.
The old 'Set English' button is absorbed into the suggestion row.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Song page — "Sung in" cell + translation note

**Files:**
- Modify: `frontend/src/pages/SongDetailPage.jsx:131-144` (hero stats), `:182-196` (Key lyrics)

**Interfaces:**
- Consumes: `song.language: string[] | null` from `GET /api/spotify/songs/:id` (Task 1 Step 17a).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the hero stat cell**

In `frontend/src/pages/SongDetailPage.jsx`, inside `.song-hero-stats`, after the Duration cell
(closing `</div>` on line 143):

```jsx
            {song.language?.length > 0 && (
              <div className="stat-cell">
                <span className="stat-cell-label">Sung in</span>
                <span className="stat-cell-value">{song.language.join(', ')}</span>
              </div>
            )}
```

- [ ] **Step 2: Vary the Key-lyrics note for non-English songs**

Add near the other derived values at the top of the render (beside `artistNames`):

```jsx
  const nonEnglish = (song.language || []).some((l) => l.trim().toLowerCase() !== 'english');
```

and replace the note on line 194:

```jsx
          <span className="section-note">
            {nonEnglish
              ? 'Brief excerpts, with English translation, for analytical purposes'
              : 'Brief excerpts for analytical purposes'}
          </span>
```

Known imprecision, accepted by the curator at brainstorm: the public payload cannot tell an
original-language highlight from a translated one, so this asserts a translation is present
whenever the song is non-English.

- [ ] **Step 3: Lint and build**

Run from `frontend/`: `npm run lint`
Expected: 0 errors.
Run from `frontend/`: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SongDetailPage.jsx
git commit -m "feat(song page): show the language(s) and a translation-aware note

A 'Sung in' cell joins Year and Duration when a song has languages recorded, and
the Key lyrics note names the English translation on non-English songs.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Full verification + live smoke

No new code — this is the gate before handing the branch to the curator.

**Files:** none modified (unless a defect is found, in which case fix it here and note it).

- [ ] **Step 1: Full backend suite**

Run from `backend/`: `npm test`
Expected: **130 passing, 0 failing** — 121 before this branch, + 3 migration + 1 filter-clause
+ 2 DB-level language + 2 normalisation (Task 1) + 1 `listLanguages` (Task 2). If the figure
differs, account for the difference before proceeding rather than accepting it.

- [ ] **Step 2: Frontend lint + build**

Run from `frontend/`: `npm run lint && npm run build`
Expected: 0 errors, build succeeds.

- [ ] **Step 3: Confirm no public route reads `song_lyrics`**

Run: `rg -n "song_lyrics" backend/routes/spotify.js backend/routes/playlists.js backend/routes/analytics.js backend/routes/submissions.js backend/routes/youtube.js`
Expected: **no matches**. (Task 3 publishes translation *fragments* through the already-public
`songs.lyrics_highlights`; no public query may reach the table itself.)

- [ ] **Step 4: Live smoke — the curator's flows**

Start both servers the normal way (`cd backend && npm run dev`, `cd frontend && npm run dev`) and
walk these, noting the result of each:

1. **Workbench, song 4691** (`/admin` → Songs → search "Holocausto Animal" → open): the Details
   panel shows a `Portuguese` chip; add `English` from the suggestion row → "Saved"; reload → both
   chips persist; remove `English` → "Saved"; type a new language and press Enter → chip appears
   and "Saved"; remove it again.
2. **Translation highlight, same song**: in the Lyrics panel select a phrase in the **Translation**
   box → "+ Add selection" → it appears under Key lyrics; reload → still there; remove it.
   Confirm the translation "+ Add selection" button is **disabled** on a song with no translation.
3. **Browse sidebar** (`/`): the Language section lists `English` / `German` / `Māori` /
   `Portuguese` with counts; tick `Portuguese` → 1 result (song 4691); with a song made bilingual
   in step 1, it appears under **both** its languages and either tick finds it; untick.
4. **Song page 4691**: "Sung in Portuguese" in the hero strip; the Key lyrics note reads "…with
   English translation…". Open an English song → plain note, "Sung in English". Open a song with no
   language recorded → **no** "Sung in" cell.

- [ ] **Step 5: Report and hand off**

Report the suite figure, lint/build result, and the outcome of each of the four smoke flows —
including anything that behaved unexpectedly. Then follow the End-Session Guide in `CLAUDE.md`
(update `PROJECT_STATE.md`, `PROJECT_PLAN.md`, `CURATOR_TRIAGE_BACKLOG.md` — item 5 moves to
✅ Resolved — commit, push, and hold the merge for the curator's own smoke, as with triage 1–4).
