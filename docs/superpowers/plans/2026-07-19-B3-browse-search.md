# B3 — Browse & Search Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the genre facet so it covers the whole catalogue, add the thematic facet tree plus song-length / availability / analysis / language filters, restore removable filter chips, and lay the browse filters out as a two-column panel — with the year-range inputs sized to fit their text.

**Architecture:** Backend adds a small pure `services/genres.js` (effective-genre = `COALESCE(songs.genre, primary artist's first genre)`, computed at query time — no stored migration) that both `/filter-options` (facet counts) and `/search` (filtering) consume, plus new `/search` filters for length/availability/analysis/language. Frontend replaces the hardcoded genre map in `SearchAndFilter.jsx` with backend-driven data and three focused sub-components (`GenreFilterTree`, `ThemeFacetTree`, `FilterChips`), arranged in a two-column drop-down panel with a chips row below it.

**Tech Stack:** Node/Express + PostgreSQL (`pg`) backend, `node:test`; React/Vite frontend (no unit-test runner — frontend tasks verify via `npm run build` + `npx eslint src/` + headless/manual smoke). Design system tokens in `frontend/src/styles/`.

## Global Constraints

- Every public query filters `status = 'included' AND published = true` and `LEFT JOIN albums` (non-Spotify songs must stay visible). Copy verbatim.
- Genre coverage is fixed **at query time** — no stored `UPDATE`/migration to `songs`.
- Analysis is **read-only**; never SELECT `song_lyrics` from any API route; `song_lyric_analysis` model filter is always `model_used = 'gemma4:latest'` (`analysis.DEFAULT_MODEL`).
- Backend tests run serially: `npm test` = `node --test --test-concurrency=1`. Any DB-touching test file uses a **unique fixture sentinel prefix** (existing: `ZZZANL` in `analysis.test.js`); pure-function test files touch no DB.
- Styling uses design-system tokens only (`--bg-*` / `--text-*` / `--accent-*` / `--space-*` / `--radius-*`) — never raw colours. No emoji in visible text.
- Frontend calls the analysis API via **relative** `/api/...` (Vite proxy), mirroring `spotifyService.getAnalysis`; never hardcode an origin for new calls.
- Commit after every task; end commit messages with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01Wo1dRPzyss3anKUdqe5erz`

---

### Task 1: `services/genres.js` — effective-genre helpers (pure)

**Files:**
- Create: `backend/services/genres.js`
- Test: `backend/test/genres.test.js`

**Interfaces:**
- Consumes: `utils/genreMapping.js` → `getParentGenre(subgenre)` (returns parent, `'other'` if unmapped).
- Produces:
  - `EFFECTIVE_GENRE_JOIN` (string) — SQL `LEFT JOIN LATERAL … efg` for a query whose songs table is aliased `s`; exposes `efg.g` = primary artist's first genre.
  - `EFFECTIVE_GENRE_EXPR` (string) — `LOWER(COALESCE(NULLIF(s.genre, ''), efg.g))`.
  - `buildGenreTree(rows)` → `{ parents: [{ value, count, subgenres: [{ value, count }] }], uncovered_count }` (rows = `[{ effective_genre }]`).
  - `genreFilterClause(genres, startIndex)` → `{ clause, params } | null`.
  - `LENGTH_BUCKETS` (array) and `lengthFilterClause(lengths)` → `string | null`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/genres.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const g = require('../services/genres');

// Pure-function tests only — this file touches no DB (no sentinel needed).

test('buildGenreTree groups effective genres under parents with summed counts', () => {
  const rows = [
    { effective_genre: 'metalcore' },
    { effective_genre: 'metalcore' },
    { effective_genre: 'death metal' },
    { effective_genre: 'pop punk' },
    { effective_genre: null },
    { effective_genre: '' },
  ];
  const t = g.buildGenreTree(rows);
  assert.equal(t.uncovered_count, 2);
  const metal = t.parents.find(p => p.value === 'metal');
  assert.equal(metal.count, 3); // metalcore x2 + death metal
  const metalcore = metal.subgenres.find(s => s.value === 'metalcore');
  assert.equal(metalcore.count, 2);
  const punk = t.parents.find(p => p.value === 'punk');
  assert.equal(punk.count, 1);
  // parents sorted by count desc
  assert.equal(t.parents[0].value, 'metal');
});

test('buildGenreTree lowercases and buckets unmapped genres under "other"', () => {
  const t = g.buildGenreTree([{ effective_genre: 'ZZ Totally Unknown Genre' }]);
  const other = t.parents.find(p => p.value === 'other');
  assert.ok(other, 'unmapped genre lands in "other"');
  assert.equal(other.subgenres[0].value, 'zz totally unknown genre');
});

test('genreFilterClause builds an ANY clause with a lowercased list', () => {
  const r = g.genreFilterClause(['Metalcore', 'pop punk'], 4);
  assert.equal(r.clause, `${g.EFFECTIVE_GENRE_EXPR} = ANY($4::text[])`);
  assert.deepEqual(r.params, [['metalcore', 'pop punk']]);
});

test('genreFilterClause returns null for empty input', () => {
  assert.equal(g.genreFilterClause([], 1), null);
  assert.equal(g.genreFilterClause(undefined, 1), null);
});

test('lengthFilterClause maps presets to duration ranges (OR)', () => {
  assert.equal(g.lengthFilterClause(['short']), '((s.duration_ms < 120000))');
  assert.equal(
    g.lengthFilterClause(['short', 'long']),
    '((s.duration_ms < 120000) OR (s.duration_ms >= 240000))');
  assert.equal(g.lengthFilterClause(['medium']), '((s.duration_ms >= 120000 AND s.duration_ms < 240000))');
  assert.equal(g.lengthFilterClause([]), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test test/genres.test.js`
Expected: FAIL — `Cannot find module '../services/genres'`.

- [ ] **Step 3: Write the implementation**

Create `backend/services/genres.js`:

```js
// Effective-genre helpers (pure). Effective genre = the song's own genre when set,
// else its primary artist's first Spotify genre — computed at query time, never stored.
// Both /filter-options (counts) and /search (filtering) use the same expression so a
// genre's count always equals what clicking it returns.
const { getParentGenre } = require('../utils/genreMapping');

// Primary artist's first genre for a song aliased `s`, exposed as efg.g.
// "Primary" = the linked artist with the lowest song_artists.id that has genres.
const EFFECTIVE_GENRE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT (a2.genres)[1] AS g
    FROM song_artists sa2
    JOIN artists a2 ON a2.id = sa2.artist_id
    WHERE sa2.song_id = s.id AND array_length(a2.genres, 1) > 0
    ORDER BY sa2.id
    LIMIT 1
  ) efg ON true`;

const EFFECTIVE_GENRE_EXPR = `LOWER(COALESCE(NULLIF(s.genre, ''), efg.g))`;

function buildGenreTree(rows) {
  const parents = new Map(); // parent -> Map(subgenre -> count)
  let uncovered = 0;
  for (const row of rows) {
    const raw = row.effective_genre;
    const gk = raw ? String(raw).toLowerCase().trim() : '';
    if (!gk) { uncovered++; continue; }
    const parent = getParentGenre(gk); // 'other' when unmapped
    if (!parents.has(parent)) parents.set(parent, new Map());
    const subs = parents.get(parent);
    subs.set(gk, (subs.get(gk) || 0) + 1);
  }
  const out = [];
  for (const [parent, subs] of parents) {
    const subgenres = [...subs.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    out.push({ value: parent, count: subgenres.reduce((s, x) => s + x.count, 0), subgenres });
  }
  out.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return { parents: out, uncovered_count: uncovered };
}

function genreFilterClause(genres, startIndex) {
  const list = (Array.isArray(genres) ? genres : [genres])
    .filter(Boolean).map(x => String(x).toLowerCase());
  if (list.length === 0) return null;
  return { clause: `${EFFECTIVE_GENRE_EXPR} = ANY($${startIndex}::text[])`, params: [list] };
}

// Fixed preset -> duration_ms range (ms). Values are constants, safe to inline into SQL.
const LENGTH_BUCKETS = [
  { value: 'short', label: 'Short (< 2 min)', min: null, max: 120000 },
  { value: 'medium', label: 'Medium (2–4 min)', min: 120000, max: 240000 },
  { value: 'long', label: 'Long (4+ min)', min: 240000, max: null },
];

function lengthFilterClause(lengths) {
  const keys = (Array.isArray(lengths) ? lengths : [lengths]).filter(Boolean);
  const buckets = LENGTH_BUCKETS.filter(b => keys.includes(b.value));
  if (buckets.length === 0) return null;
  const parts = buckets.map(b => {
    const c = [];
    if (b.min != null) c.push(`s.duration_ms >= ${b.min}`);
    if (b.max != null) c.push(`s.duration_ms < ${b.max}`);
    return `(${c.join(' AND ')})`;
  });
  return `(${parts.join(' OR ')})`;
}

module.exports = {
  EFFECTIVE_GENRE_JOIN, EFFECTIVE_GENRE_EXPR,
  buildGenreTree, genreFilterClause, LENGTH_BUCKETS, lengthFilterClause,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --test test/genres.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/services/genres.js backend/test/genres.test.js
git commit -m "feat(B3): effective-genre + length filter helpers (services/genres.js)"
```

---

### Task 2: `/filter-options` — effective-genre tree, languages, length buckets, availability

**Files:**
- Modify: `backend/routes/spotify.js:490-567` (the whole `/filter-options` handler)
- Modify: `backend/routes/spotify.js:4` (require line — see Step 4)

**Interfaces:**
- Consumes: `services/genres.js` (`EFFECTIVE_GENRE_JOIN`, `EFFECTIVE_GENRE_EXPR`, `buildGenreTree`, `LENGTH_BUCKETS`), `services/analysis.js` (`DEFAULT_MODEL`).
- Produces: `GET /api/spotify/filter-options` JSON:
  ```
  { genre_tree: { parents: [{value,count,subgenres:[{value,count}]}], uncovered_count },
    year_range: { min_year, max_year },
    languages: [{ value, count }],
    length_buckets: [{ value, label, count }],
    availability: { total, on_spotify, has_youtube, has_analysis } }
  ```

- [ ] **Step 1: Add the require for the genres service**

At the top of `backend/routes/spotify.js`, just after the existing `analysis` require, add — aliased `genres_svc` because the `/search` handler in this same file already binds `const genres` from `req.query`:

```js
const genres_svc = require('../services/genres');
```

(`analysis` is already required in this file — confirm with `grep -n "require('../services/analysis')" backend/routes/spotify.js`. If it is not, add `const analysis = require('../services/analysis');` too.)

- [ ] **Step 2: Replace the `/filter-options` handler body**

Replace the entire handler at `backend/routes/spotify.js:490-567` with:

```js
// Get filter options and counts for the browse UI.
router.get('/filter-options', async (req, res) => {
  try {
    const LIVE = `s.status = 'included' AND s.published = true`;

    // Effective genre per live song (song genre, else primary artist's first genre).
    const effectiveGenreQuery = `
      SELECT ${genres_svc.EFFECTIVE_GENRE_EXPR} AS effective_genre
      FROM songs s
      ${genres_svc.EFFECTIVE_GENRE_JOIN}
      WHERE ${LIVE}`;

    const yearRangeQuery = `
      SELECT MIN(EXTRACT(YEAR FROM release_date)) AS min_year,
             MAX(EXTRACT(YEAR FROM release_date)) AS max_year
      FROM albums
      WHERE release_date IS NOT NULL
        AND id IN (SELECT album_id FROM songs WHERE status = 'included' AND published = true AND album_id IS NOT NULL)`;

    const languagesQuery = `
      SELECT language AS value, COUNT(*)::int AS count
      FROM songs
      WHERE status = 'included' AND published = true AND language IS NOT NULL AND language <> ''
      GROUP BY language
      ORDER BY count DESC, value ASC`;

    const lengthCountsQuery = `
      SELECT
        COUNT(*) FILTER (WHERE duration_ms < 120000)::int AS short,
        COUNT(*) FILTER (WHERE duration_ms >= 120000 AND duration_ms < 240000)::int AS medium,
        COUNT(*) FILTER (WHERE duration_ms >= 240000)::int AS long
      FROM songs
      WHERE status = 'included' AND published = true AND duration_ms > 0`;

    const availabilityQuery = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE spotify_id IS NOT NULL AND spotify_id <> '')::int AS on_spotify,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id = songs.id))::int AS has_youtube,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = songs.id AND la.model_used = $1))::int AS has_analysis
      FROM songs
      WHERE status = 'included' AND published = true`;

    const [effGenres, yearRange, languages, lengthCounts, availability] = await Promise.all([
      pool.query(effectiveGenreQuery),
      pool.query(yearRangeQuery),
      pool.query(languagesQuery),
      pool.query(lengthCountsQuery),
      pool.query(availabilityQuery, [analysis.DEFAULT_MODEL]),
    ]);

    const lc = lengthCounts.rows[0] || {};
    res.json({
      genre_tree: genres_svc.buildGenreTree(effGenres.rows),
      year_range: yearRange.rows[0] || { min_year: null, max_year: null },
      languages: languages.rows,
      length_buckets: genres_svc.LENGTH_BUCKETS.map(b => ({ value: b.value, label: b.label, count: lc[b.value] || 0 })),
      availability: availability.rows[0] || { total: 0, on_spotify: 0, has_youtube: 0, has_analysis: 0 },
    });
  } catch (error) {
    console.error('Error fetching filter options:', error);
    res.status(500).json({ error: 'Failed to fetch filter options', details: error.message });
  }
});
```

- [ ] **Step 3: Verify the endpoint live**

Start a fresh backend on an unused port so the curator's :5000 is untouched:

```bash
cd backend && PORT=5055 node server.js &
sleep 2
curl -s 'http://localhost:5055/api/spotify/filter-options' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('parents:',j.genre_tree.parents.length,'uncovered:',j.genre_tree.uncovered_count);console.log('sum of parent counts:',j.genre_tree.parents.reduce((s,p)=>s+p.count,0));console.log('languages:',j.languages.length,'availability:',JSON.stringify(j.availability));console.log('length_buckets:',JSON.stringify(j.length_buckets));})"
kill %1
```

Expected: parent counts sum to ~1,003 (not 492), `uncovered ≈ 329`, `availability.has_analysis ≈ 640`, `has_youtube ≈ 711`, languages includes `English`.

- [ ] **Step 4: Remove now-unused genreMapping imports if eslint flags them**

Run: `cd backend && npx eslint routes/spotify.js` (if eslint is configured) or `node -e "require('./routes/spotify.js')"` to confirm it still loads.
If `getParentGenres` / `getAllSubgenres` / `getSubgenres` are no longer referenced in `spotify.js` (check: `grep -nE "getParentGenres|getAllSubgenres|getSubgenres" backend/routes/spotify.js`), trim them from the `require('../utils/genreMapping')` destructure at line 4. Leave any that are still used.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/spotify.js
git commit -m "feat(B3): /filter-options returns effective-genre tree, languages, length buckets, availability"
```

---

### Task 3: `/search` — effective-genre filter + length / availability / analysis / language

**Files:**
- Modify: `backend/routes/spotify.js` — the `/search` handler (destructure ~272-292; genre block ~355-369; query assembly ~420-461).

**Interfaces:**
- Consumes: `services/genres.js` (`EFFECTIVE_GENRE_JOIN`, `genreFilterClause`, `lengthFilterClause`), `analysis.DEFAULT_MODEL`.
- Produces: `GET /api/spotify/search` accepts new params `genres` (effective-genre values), `lengths` (preset keys), `has_youtube`/`has_analysis`/`on_spotify` (`'true'`), `languages` (array). Existing `year_from`/`year_to` and analysis facets (`themes`/`targets`/`actions`/`tactics`/`moral_frames`) unchanged.

- [ ] **Step 1: Extend the destructure**

In the `/search` handler, add to the `req.query` destructure (alongside the existing keys):

```js
      lengths,
      has_youtube,
      has_analysis,
      on_spotify,
      languages,
```

- [ ] **Step 2: Replace the genre filtering block**

Replace the two genre blocks (`if (genres) { … s.genre = ANY … }` and `if (parent_genres) { … s.parent_genre = ANY … }`, lines ~355-369) with:

```js
    // Effective-genre filtering: song genre, else primary artist's first genre.
    // The frontend expands a selected parent into its subgenre values, so we only
    // ever match subgenre-level effective values here.
    let needsEffectiveGenreJoin = false;
    const gf = genres ? genres_svc.genreFilterClause(genres, paramIndex) : null;
    if (gf) {
      whereConditions.push(gf.clause);
      queryParams.push(...gf.params);
      paramIndex += gf.params.length;
      needsEffectiveGenreJoin = true;
    }

    // Song length presets (Short/Medium/Long) -> duration_ms ranges (no params).
    const lengthClause = lengths ? genres_svc.lengthFilterClause(lengths) : null;
    if (lengthClause) whereConditions.push(lengthClause);

    // Availability / analysis toggles.
    if (has_youtube === 'true') {
      whereConditions.push(`EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id = s.id)`);
    }
    if (has_analysis === 'true') {
      whereConditions.push(`EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = s.id AND la.model_used = '${analysis.DEFAULT_MODEL}')`);
    }
    if (on_spotify === 'true') {
      whereConditions.push(`s.spotify_id IS NOT NULL AND s.spotify_id <> ''`);
    }

    // Language filter (sung-in language).
    if (languages) {
      const langList = Array.isArray(languages) ? languages : [languages];
      whereConditions.push(`s.language = ANY($${paramIndex}::text[])`);
      queryParams.push(langList);
      paramIndex++;
    }
```

> Note: this handler already binds `const genres` from `req.query` (the selected genre list). The service was required as `genres_svc` in Task 2 precisely to avoid this collision — use `genres_svc.` for all service calls here.

- [ ] **Step 3: Add the effective-genre LATERAL join to both queries**

Define the join variable just before `const searchQuery = ...`:

```js
    const effectiveGenreJoin = needsEffectiveGenreJoin ? genres_svc.EFFECTIVE_GENRE_JOIN : '';
```

In `searchQuery`, add `${effectiveGenreJoin}` on its own line immediately after
`LEFT JOIN LATERAL UNNEST(COALESCE(a.genres, ARRAY[]::text[])) AS genre_elem ON true` and before `${facetJoin}`.

In `countQuery`, add `${effectiveGenreJoin}` immediately after
`JOIN artists a ON sart.artist_id = a.id` and before `${facetJoin}`.

- [ ] **Step 4: Verify live (fresh backend, curator's :5000 untouched)**

```bash
cd backend && PORT=5055 node server.js &
sleep 2
base='http://localhost:5055/api/spotify/search'
get(){ curl -s "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(process.argv[1],JSON.parse(d).pagination.total)})" "$2"; }
get "$base?limit=1" "all:"
get "$base?genres=metalcore&limit=1" "genre=metalcore:"
get "$base?lengths=short&limit=1" "short:"
get "$base?has_youtube=true&limit=1" "has_youtube:"
get "$base?has_analysis=true&limit=1" "has_analysis:"
get "$base?languages=English&limit=1" "language=English:"
get "$base?themes=killing&limit=1" "theme=killing:"
get "$base?themes=killing&has_youtube=true&limit=1" "killing+youtube(AND):"
kill %1
```

Expected: `all` ≈ 1,332; `has_analysis` ≈ 640; `language=English` ≈ 32; each single filter ≤ all; the combined `killing+youtube` ≤ each single filter (AND narrows). No SQL errors.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/spotify.js
git commit -m "feat(B3): /search adds effective-genre, length, availability, analysis and language filters"
```

---

### Task 4: Deferred facetTree test — two codes in the same group

**Files:**
- Modify: `backend/test/analysis.test.js` (add one test; reuse the `ZZZANL` sentinel + `after` cleanup already in the file).

**Interfaces:**
- Consumes: `analysis.facetTree(pool)`; taxonomy fact — `killing` and `brutality` are both theme codes in sub-dimension `cruelty_suffering`, group `violence`.

- [ ] **Step 1: Write the failing test**

Add to `backend/test/analysis.test.js`, before the final `after(...)` hook:

```js
test('facetTree rolls up two codes in the same group with distinct-song counts', async () => {
  // Song A: both violence codes; Song B: only killing. Group "violence" = 2 distinct songs.
  const a = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ('ZZZANL TwoCode A', 'included', true, 'manual') RETURNING id`)).rows[0];
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, 'gemma4:latest', $2::jsonb, '[]', '[]', '[]', '[]')`,
    [a.id, JSON.stringify([{ code: 'killing', evidence: 'x' }, { code: 'brutality', evidence: 'y' }])]);
  const b = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ('ZZZANL TwoCode B', 'included', true, 'manual') RETURNING id`)).rows[0];
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, 'gemma4:latest', $2::jsonb, '[]', '[]', '[]', '[]')`,
    [b.id, JSON.stringify([{ code: 'killing', evidence: 'z' }])]);

  const t = await analysis.facetTree(pool);
  const cruelty = t.themes.sub_dimensions.find(s => s.id === 'cruelty_suffering');
  const violence = cruelty.groups.find(g => g.id === 'violence');
  const killing = violence.codes.find(c => c.code === 'killing');
  const brutality = violence.codes.find(c => c.code === 'brutality');
  // Distinct-song rollup: killing in A+B, brutality in A only, group = 2 distinct songs.
  assert.ok(killing.count >= 2, 'killing counts both songs');
  assert.ok(brutality.count >= 1, 'brutality counts song A');
  assert.ok(violence.count >= 2, 'group counts distinct songs, not code occurrences');
  assert.ok(violence.count >= killing.count, 'group >= any single code (distinct-song union)');
});
```

- [ ] **Step 2: Run it (passes against the real service)**

Run: `cd backend && node --test test/analysis.test.js`
Expected: PASS (new test green; existing tests still pass). The `after` hook already deletes `ZZZANL%` fixtures.

- [ ] **Step 3: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: all files green (serial run).

- [ ] **Step 4: Commit**

```bash
git add backend/test/analysis.test.js
git commit -m "test(B3): facetTree rolls up two same-group codes by distinct song"
```

---

### Task 5: Frontend API — `getFacets`

**Files:**
- Modify: `frontend/src/api/spotifyService.js` (add one method after `getAnalysis`).

**Interfaces:**
- Produces: `spotifyService.getFacets()` → the `/api/analysis/facets` object (`{ themes, targets, actions, tactics, moral_frames }`, each `{ label, count, sub_dimensions: [...] }`) or `{}` on failure.

- [ ] **Step 1: Add the method**

In `frontend/src/api/spotifyService.js`, immediately after the `getAnalysis` method (keep the trailing comma structure), add:

```js
  // Get the analysis facet tree for browse filters. Relative URL — Vite proxies /api.
  getFacets: async () => {
    try {
      const response = await fetch('/api/analysis/facets');
      if (!response.ok) throw new Error('Failed to fetch facets');
      return await response.json();
    } catch (error) {
      console.warn('Could not load facets:', error);
      return {};
    }
  },
```

- [ ] **Step 2: Verify build + lint**

Run: `cd frontend && npm run build && npx eslint src/api/spotifyService.js`
Expected: build clean; 0 eslint errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/spotifyService.js
git commit -m "feat(B3): spotifyService.getFacets for the browse facet tree"
```

---

### Task 6: `GenreFilterTree.jsx` — backend-driven genre tree

**Files:**
- Create: `frontend/src/components/GenreFilterTree.jsx`
- (SearchAndFilter integration happens in Task 9; this task builds and lint-verifies the component in isolation.)

**Interfaces:**
- Consumes (props): `tree` = `{ parents: [{ value, count, subgenres: [{ value, count }] }], uncovered_count }`; `selectedGenres` (string[]), `selectedParents` (string[]); `onToggleParent(parentValue, checked, subgenreValues)`; `onToggleGenre(genreValue, checked)`.
- Produces: a `<div className="filter-section hierarchical-genre-filter">` with a genre search box, expandable parents, subgenre checkboxes, counts, and an uncovered-count note. Replaces the old inline `HierarchicalGenreFilter` + hardcoded `GENRE_HIERARCHY`/fallback counts.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/GenreFilterTree.jsx`:

```jsx
import { useState } from 'react';

// Backend-driven genre tree (data from /filter-options genre_tree). No hardcoded
// hierarchy or counts — parents/subgenres/counts all come from the effective-genre
// rollup so the numbers match what filtering returns.
function GenreFilterTree({ tree, selectedGenres, selectedParents, onToggleParent, onToggleGenre }) {
  const [expanded, setExpanded] = useState(new Set());
  const [term, setTerm] = useState('');

  const parents = tree?.parents || [];
  const q = term.trim().toLowerCase();

  const matchParent = (p) =>
    !q || p.value.toLowerCase().includes(q) || p.subgenres.some(s => s.value.toLowerCase().includes(q));

  const toggleExpand = (value) => {
    const next = new Set(expanded);
    next.has(value) ? next.delete(value) : next.add(value);
    setExpanded(next);
  };

  return (
    <div className="filter-section hierarchical-genre-filter">
      <h3 className="filter-title">Genre</h3>

      <div className="filter-search">
        <input
          type="text"
          className="filter-search-input"
          placeholder="Search genres…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>

      <div className="filter-options scrollable">
        {parents.filter(matchParent).map((parent) => {
          const isExpanded = expanded.has(parent.value) || !!q;
          const subs = q ? parent.subgenres.filter(s => s.value.toLowerCase().includes(q)) : parent.subgenres;
          const subValues = parent.subgenres.map(s => s.value);
          return (
            <div key={parent.value} className="genre-hierarchy-item">
              <div className="parent-genre-row">
                <button
                  className="expand-toggle"
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${parent.value} subgenres`}
                  onClick={() => toggleExpand(parent.value)}
                >
                  {isExpanded ? '▼' : '▶'}
                </button>
                <label className="filter-option parent-genre">
                  <input
                    type="checkbox"
                    checked={selectedParents.includes(parent.value)}
                    onChange={(e) => onToggleParent(parent.value, e.target.checked, subValues)}
                  />
                  <span className="filter-label">
                    <strong>{parent.value}</strong>
                    <span className="filter-count">({parent.count})</span>
                  </span>
                </label>
              </div>

              {isExpanded && (
                <div className="subgenres-container">
                  {subs.map((sub) => (
                    <label key={sub.value} className="filter-option subgenre">
                      <input
                        type="checkbox"
                        checked={selectedGenres.includes(sub.value)}
                        onChange={(e) => onToggleGenre(sub.value, e.target.checked)}
                      />
                      <span className="filter-label">
                        {sub.value}
                        <span className="filter-count">({sub.count})</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {tree?.uncovered_count > 0 && (
        <p className="filter-note">{tree.uncovered_count} songs have no genre tag.</p>
      )}
    </div>
  );
}

export default GenreFilterTree;
```

- [ ] **Step 2: Verify build + lint**

Run: `cd frontend && npx eslint src/components/GenreFilterTree.jsx`
Expected: 0 errors. (`npm run build` runs after wiring in Task 9.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/GenreFilterTree.jsx
git commit -m "feat(B3): backend-driven GenreFilterTree component"
```

---

### Task 7: `ThemeFacetTree.jsx` — thematic facet tree

**Files:**
- Create: `frontend/src/components/ThemeFacetTree.jsx`
- Modify: `frontend/src/styles/components.css` (append facet-tree styles — see Step 2)

**Interfaces:**
- Consumes (props): `facets` (the `getFacets()` object), `selected` = `{ themes:[], targets:[], actions:[], tactics:[], moral_frames:[] }`, `onToggle(dimKey, code, checked)`, `codedCount` (number for the note).
- Consumes: `subDimensionColor(subId)` from `../styles/subDimensionPalette`.
- Produces: a `<div className="filter-section theme-facet-tree">` rendering Dimension → Sub-dimension → Group → Code, code checkboxes coloured by sub-dimension, counts, and a coded-only note.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/ThemeFacetTree.jsx`:

```jsx
import { useState } from 'react';
import { subDimensionColor } from '../styles/subDimensionPalette';

const DIM_ORDER = ['themes', 'targets', 'actions', 'tactics', 'moral_frames'];

// Hierarchical analysis facet tree (Dimension -> Sub-dimension -> Group -> Code).
// Counts are distinct-song rollups from /api/analysis/facets; codes are coloured by
// sub-dimension (shared palette). All selections AND together (within and across groups).
function ThemeFacetTree({ facets, selected, onToggle, codedCount }) {
  const [open, setOpen] = useState(new Set(['themes'])); // dimension keys expanded

  const dims = DIM_ORDER.filter(k => facets && facets[k] && facets[k].sub_dimensions?.length);
  if (dims.length === 0) return null;

  const toggleOpen = (key) => {
    const next = new Set(open);
    next.has(key) ? next.delete(key) : next.add(key);
    setOpen(next);
  };

  return (
    <div className="filter-section theme-facet-tree">
      <h3 className="filter-title">Themes &amp; advocacy</h3>
      <p className="filter-note">
        Only songs with lyrics analysis ({codedCount}) are counted here; selections narrow together.
      </p>

      <div className="filter-options scrollable">
        {dims.map((dimKey) => {
          const dim = facets[dimKey];
          const isOpen = open.has(dimKey);
          return (
            <div key={dimKey} className="facet-dim">
              <button
                type="button"
                className="facet-dim-header"
                aria-expanded={isOpen}
                onClick={() => toggleOpen(dimKey)}
              >
                <span>{isOpen ? '▼' : '▶'} {dim.label}</span>
                <span className="filter-count">({dim.count})</span>
              </button>

              {isOpen && dim.sub_dimensions.map((sub) => (
                <div key={sub.id} className="facet-sub" style={{ borderLeftColor: subDimensionColor(sub.id) }}>
                  <div className="facet-sub-label" style={{ color: subDimensionColor(sub.id) }}>
                    {sub.label}
                  </div>
                  {sub.groups.map((group) => (
                    <div key={group.id} className="facet-group">
                      <div className="facet-group-label">{group.label}</div>
                      {group.codes.map((c) => (
                        <label key={c.code} className="filter-option facet-code">
                          <input
                            type="checkbox"
                            checked={(selected[dimKey] || []).includes(c.code)}
                            onChange={(e) => onToggle(dimKey, c.code, e.target.checked)}
                          />
                          <span className="filter-label">
                            <span>
                              <span className="facet-dot" style={{ background: subDimensionColor(sub.id) }} />
                              {c.label}
                            </span>
                            <span className="filter-count">({c.count})</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ThemeFacetTree;
```

- [ ] **Step 2: Append facet-tree styles**

Append to `frontend/src/styles/components.css`:

```css
/* B3 — thematic facet tree */
.theme-facet-tree .filter-options.scrollable { max-height: 320px; }
.filter-note {
  color: var(--text-muted);
  font: var(--text-meta);
  margin: var(--space-1) 0 var(--space-2);
}
.facet-dim-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  background: none;
  border: none;
  color: var(--text-primary);
  font: var(--text-label);
  cursor: pointer;
  padding: var(--space-1) 0;
}
.facet-sub {
  border-left: 3px solid var(--border-hairline);
  padding-left: var(--space-2);
  margin: var(--space-1) 0 var(--space-1) var(--space-2);
}
.facet-sub-label { font: var(--text-meta); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 2px; }
.facet-group-label { color: var(--text-secondary); font: var(--text-body-sm); margin: 2px 0; }
.facet-code { padding-left: var(--space-2); }
.facet-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: var(--space-1); vertical-align: middle; }
```

- [ ] **Step 3: Verify lint**

Run: `cd frontend && npx eslint src/components/ThemeFacetTree.jsx`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ThemeFacetTree.jsx frontend/src/styles/components.css
git commit -m "feat(B3): ThemeFacetTree component + facet-tree styles"
```

---

### Task 8: `FilterChips.jsx` — removable active-filter chips

**Files:**
- Create: `frontend/src/components/FilterChips.jsx`
- Modify: `frontend/src/styles/components.css` (append chip styles — see Step 2)

**Interfaces:**
- Consumes (props): `chips` = `[{ key, label }]` (already-built display list), `onRemove(key)`.
- Produces: a `<div className="filter-chips">` of removable pills. The `key` encodes type+value as `"<type>:<value>"` so the parent's `onRemove` can route the removal. (The chip list itself is built in Task 9's `buildChips`.)

- [ ] **Step 1: Create the component**

Create `frontend/src/components/FilterChips.jsx`:

```jsx
// Presentational chips row. The parent builds `chips` (key + label) and handles removal.
function FilterChips({ chips, onRemove }) {
  if (!chips || chips.length === 0) return null;
  return (
    <div className="filter-chips" aria-label="Active filters">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="filter-chip"
          onClick={() => onRemove(chip.key)}
          aria-label={`Remove filter ${chip.label}`}
        >
          <span className="filter-chip-label">{chip.label}</span>
          <span className="filter-chip-x" aria-hidden="true">✕</span>
        </button>
      ))}
    </div>
  );
}

export default FilterChips;
```

- [ ] **Step 2: Append chip styles**

Append to `frontend/src/styles/components.css`:

```css
/* B3 — active filter chips (below the filters panel) */
.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  background: var(--bg-surface-raised);
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-full, 999px);
  color: var(--text-secondary);
  font: var(--text-body-sm);
  padding: 2px var(--space-2);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.filter-chip:hover { border-color: var(--accent-ember-60); color: var(--text-primary); }
.filter-chip:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--focus-ring); }
.filter-chip-x { color: var(--text-muted); font-size: 0.8em; }
```

- [ ] **Step 3: Verify lint**

Run: `cd frontend && npx eslint src/components/FilterChips.jsx`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/FilterChips.jsx frontend/src/styles/components.css
git commit -m "feat(B3): FilterChips component + chip styles"
```

---

### Task 9: `SearchAndFilter.jsx` — integrate everything (two-column panel + chips + new filters)

**Files:**
- Modify: `frontend/src/components/SearchAndFilter.jsx` (full rewrite of the component body — replaces the inline `HierarchicalGenreFilter`, hardcoded `GENRE_HIERARCHY`, and fallback counts)
- Modify: `frontend/src/styles/components.css` (two-column panel layout + year-range sizing fix + compact filters — see Step 3)

**Interfaces:**
- Consumes: `GenreFilterTree`, `ThemeFacetTree`, `FilterChips`, `spotifyService.getFilterOptions()` (now returns `genre_tree`/`languages`/`length_buckets`/`availability`), `spotifyService.getFacets()`.
- Produces: unchanged outward contract — same props (`onResults`, `onLoading`, `onError`, `initialQuery`, `currentPage`, `onPageReset`) and still calls `spotifyService.searchSongs(searchParams)`; new params flow through the existing generic serializer.

- [ ] **Step 1: Replace the whole file**

Replace `frontend/src/components/SearchAndFilter.jsx` with:

```jsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import { spotifyService } from '../api/spotifyService';
import GenreFilterTree from './GenreFilterTree';
import ThemeFacetTree from './ThemeFacetTree';
import FilterChips from './FilterChips';

const DIM_KEYS = ['themes', 'targets', 'actions', 'tactics', 'moral_frames'];

const EMPTY_FILTERS = {
  genres: [], parent_genres: [],
  year_from: '', year_to: '',
  lengths: [],
  has_youtube: false, has_analysis: false, on_spotify: false,
  languages: [],
  themes: [], targets: [], actions: [], tactics: [], moral_frames: [],
  sort_by: 'popularity',
};

function SearchAndFilter({ onResults, onLoading, onError, initialQuery = '', currentPage = 1, onPageReset }) {
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterOptions, setFilterOptions] = useState({});
  const [facets, setFacets] = useState({});
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialQuery && initialQuery !== searchQuery) setSearchQuery(initialQuery);
  }, [initialQuery]);

  // Load filter options + facet tree once.
  useEffect(() => {
    (async () => {
      try {
        const [opts, fac] = await Promise.all([
          spotifyService.getFilterOptions(),
          spotifyService.getFacets(),
        ]);
        setFilterOptions(opts || {});
        setFacets(fac || {});
      } catch (error) {
        console.error('Error loading filter options:', error);
      }
    })();
  }, []);

  const performSearch = useCallback(async (searchParams) => {
    try {
      setLoading(true);
      onLoading(true);
      const results = await spotifyService.searchSongs(searchParams);
      onResults(results);
    } catch (error) {
      console.error('Search error:', error);
      onError('Failed to search songs: ' + error.message);
    } finally {
      setLoading(false);
      onLoading(false);
    }
  }, [onResults, onLoading, onError]);

  // Only send booleans when true (keeps the query string clean); arrays/strings pass through.
  const buildSearchParams = useCallback(() => {
    const p = { q: searchQuery, page: currentPage, limit: 20, sort_by: filters.sort_by };
    if (filters.genres.length) p.genres = filters.genres;
    if (filters.year_from) p.year_from = filters.year_from;
    if (filters.year_to) p.year_to = filters.year_to;
    if (filters.lengths.length) p.lengths = filters.lengths;
    if (filters.has_youtube) p.has_youtube = 'true';
    if (filters.has_analysis) p.has_analysis = 'true';
    if (filters.on_spotify) p.on_spotify = 'true';
    if (filters.languages.length) p.languages = filters.languages;
    DIM_KEYS.forEach(k => { if (filters[k].length) p[k] = filters[k]; });
    return p;
  }, [searchQuery, filters, currentPage]);

  useEffect(() => {
    const params = buildSearchParams();
    const t = setTimeout(() => performSearch(params), 300);
    return () => clearTimeout(t);
  }, [buildSearchParams, performSearch]);

  useEffect(() => {
    if (onPageReset && currentPage !== 1) onPageReset();
  }, [searchQuery, JSON.stringify(filters)]);

  // --- mutation helpers ---
  const toggleInArray = (key, value, checked) => setFilters(prev => ({
    ...prev,
    [key]: checked ? [...prev[key], value] : prev[key].filter(v => v !== value),
  }));

  const onToggleGenre = (value, checked) => toggleInArray('genres', value, checked);

  const onToggleParent = (parentValue, checked, subValues) => setFilters(prev => {
    const parents = checked
      ? [...prev.parent_genres, parentValue]
      : prev.parent_genres.filter(v => v !== parentValue);
    const genres = checked
      ? Array.from(new Set([...prev.genres, ...subValues]))
      : prev.genres.filter(v => !subValues.includes(v));
    return { ...prev, parent_genres: parents, genres };
  });

  const onToggleFacet = (dimKey, code, checked) => toggleInArray(dimKey, code, checked);

  const setScalar = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));
  const toggleBool = (key) => setFilters(prev => ({ ...prev, [key]: !prev[key] }));

  const clearAllFilters = () => { setFilters(EMPTY_FILTERS); setSearchQuery(''); };

  // --- chips ---
  const codeLabelMap = useMemo(() => {
    const m = {};
    DIM_KEYS.forEach(dim => {
      m[dim] = {};
      (facets[dim]?.sub_dimensions || []).forEach(sub =>
        sub.groups.forEach(gr => gr.codes.forEach(c => { m[dim][c.code] = c.label; })));
    });
    return m;
  }, [facets]);

  const lengthLabelMap = useMemo(() => {
    const m = {};
    (filterOptions.length_buckets || []).forEach(b => { m[b.value] = b.label; });
    return m;
  }, [filterOptions]);

  const chips = useMemo(() => {
    const list = [];
    if (searchQuery) list.push({ key: 'q:', label: `"${searchQuery}"` });
    filters.parent_genres.forEach(p => list.push({ key: `parent:${p}`, label: `Genre: ${p}` }));
    // subgenres selected on their own (parent not selected) get their own chip
    const parentSubs = new Set();
    (filterOptions.genre_tree?.parents || [])
      .filter(p => filters.parent_genres.includes(p.value))
      .forEach(p => p.subgenres.forEach(s => parentSubs.add(s.value)));
    filters.genres.filter(g => !parentSubs.has(g)).forEach(g => list.push({ key: `genre:${g}`, label: g }));
    if (filters.year_from || filters.year_to) {
      list.push({ key: 'year:', label: `${filters.year_from || '…'}–${filters.year_to || '…'}` });
    }
    filters.lengths.forEach(l => list.push({ key: `length:${l}`, label: lengthLabelMap[l] || l }));
    if (filters.has_youtube) list.push({ key: 'has_youtube:', label: 'Has YouTube' });
    if (filters.has_analysis) list.push({ key: 'has_analysis:', label: 'Has analysis' });
    if (filters.on_spotify) list.push({ key: 'on_spotify:', label: 'On Spotify' });
    filters.languages.forEach(l => list.push({ key: `language:${l}`, label: l }));
    DIM_KEYS.forEach(dim => filters[dim].forEach(code =>
      list.push({ key: `${dim}:${code}`, label: codeLabelMap[dim]?.[code] || code })));
    return list;
  }, [searchQuery, filters, filterOptions, lengthLabelMap, codeLabelMap]);

  const removeChip = (key) => {
    const [type, value] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (type === 'q') return setSearchQuery('');
    if (type === 'year') return setFilters(prev => ({ ...prev, year_from: '', year_to: '' }));
    if (type === 'parent') {
      const parent = (filterOptions.genre_tree?.parents || []).find(p => p.value === value);
      return onToggleParent(value, false, parent ? parent.subgenres.map(s => s.value) : []);
    }
    if (type === 'genre') return toggleInArray('genres', value, false);
    if (type === 'length') return toggleInArray('lengths', value, false);
    if (type === 'language') return toggleInArray('languages', value, false);
    if (['has_youtube', 'has_analysis', 'on_spotify'].includes(type)) return setScalar(type, false);
    if (DIM_KEYS.includes(type)) return toggleInArray(type, value, false);
  };

  const activeCount = chips.length;
  const yr = filterOptions.year_range || {};

  return (
    <div className="search-and-filter">
      <div className="search-container">
        <input
          type="text"
          className="search-input"
          placeholder="Search songs, artists, albums..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button
          className={`filter-toggle ${isFiltersOpen ? 'active' : ''}`}
          onClick={() => setIsFiltersOpen(!isFiltersOpen)}
        >
          Filters {activeCount > 0 && <span className="filter-badge">{activeCount}</span>}
        </button>
        {activeCount > 0 && (
          <button className="clear-filters" onClick={clearAllFilters}>Clear all</button>
        )}
      </div>

      <div className="sort-container">
        <label>Sort by:</label>
        <select value={filters.sort_by} onChange={(e) => setScalar('sort_by', e.target.value)}>
          <option value="popularity">Popularity</option>
          <option value="title">Title</option>
          <option value="artist">Artist</option>
          <option value="year">Year</option>
        </select>
      </div>

      {isFiltersOpen && (
        <div className="filters-panel">
          <div className="filters-layout">
            <div className="filters-col-main">
              <GenreFilterTree
                tree={filterOptions.genre_tree}
                selectedGenres={filters.genres}
                selectedParents={filters.parent_genres}
                onToggleGenre={onToggleGenre}
                onToggleParent={onToggleParent}
              />
              <ThemeFacetTree
                facets={facets}
                selected={filters}
                onToggle={onToggleFacet}
                codedCount={filterOptions.availability?.has_analysis || 0}
              />
            </div>

            <div className="filters-col-side">
              <div className="filter-section">
                <h3 className="filter-title">Year range</h3>
                <div className="range-inputs">
                  <input
                    type="number"
                    placeholder={yr.min_year ? `From ${yr.min_year}` : 'From'}
                    value={filters.year_from}
                    onChange={(e) => setScalar('year_from', e.target.value)}
                    min={yr.min_year} max={yr.max_year}
                  />
                  <span>to</span>
                  <input
                    type="number"
                    placeholder={yr.max_year ? `To ${yr.max_year}` : 'To'}
                    value={filters.year_to}
                    onChange={(e) => setScalar('year_to', e.target.value)}
                    min={yr.min_year} max={yr.max_year}
                  />
                </div>
              </div>

              <div className="filter-section">
                <h3 className="filter-title">Song length</h3>
                <div className="filter-options">
                  {(filterOptions.length_buckets || []).map(b => (
                    <label key={b.value} className="filter-option">
                      <input
                        type="checkbox"
                        checked={filters.lengths.includes(b.value)}
                        onChange={(e) => toggleInArray('lengths', b.value, e.target.checked)}
                      />
                      <span className="filter-label">{b.label}<span className="filter-count">({b.count})</span></span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="filter-section">
                <h3 className="filter-title">Available on</h3>
                <div className="filter-options">
                  <label className="filter-option">
                    <input type="checkbox" checked={filters.on_spotify} onChange={() => toggleBool('on_spotify')} />
                    <span className="filter-label">On Spotify<span className="filter-count">({filterOptions.availability?.on_spotify || 0})</span></span>
                  </label>
                  <label className="filter-option">
                    <input type="checkbox" checked={filters.has_youtube} onChange={() => toggleBool('has_youtube')} />
                    <span className="filter-label">Has YouTube<span className="filter-count">({filterOptions.availability?.has_youtube || 0})</span></span>
                  </label>
                </div>
              </div>

              <div className="filter-section">
                <h3 className="filter-title">Analysis</h3>
                <div className="filter-options">
                  <label className="filter-option">
                    <input type="checkbox" checked={filters.has_analysis} onChange={() => toggleBool('has_analysis')} />
                    <span className="filter-label">Has lyrics analysis<span className="filter-count">({filterOptions.availability?.has_analysis || 0})</span></span>
                  </label>
                </div>
              </div>

              {(filterOptions.languages?.length > 0) && (
                <div className="filter-section">
                  <h3 className="filter-title">Language</h3>
                  <div className="filter-options">
                    {filterOptions.languages.map(l => (
                      <label key={l.value} className="filter-option">
                        <input
                          type="checkbox"
                          checked={filters.languages.includes(l.value)}
                          onChange={(e) => toggleInArray('languages', l.value, e.target.checked)}
                        />
                        <span className="filter-label">{l.value}<span className="filter-count">({l.count})</span></span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <FilterChips chips={chips} onRemove={removeChip} />

      {loading && <div className="search-loading">Searching...</div>}
    </div>
  );
}

export default SearchAndFilter;
```

- [ ] **Step 2: Verify build + lint**

Run: `cd frontend && npm run build && npx eslint src/components/SearchAndFilter.jsx`
Expected: build clean; 0 eslint errors.

- [ ] **Step 3: Two-column layout + year-range sizing + compact filters CSS**

In `frontend/src/styles/components.css`, change `.range-inputs input` (line ~941) — replace `max-width: 90px;` with `min-width: 0;` so the placeholder text fits. Then append:

```css
/* B3 — two-column filters panel (Option B) */
.filters-layout {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: var(--space-6);
  align-items: start;
}
.filters-col-main { display: flex; flex-direction: column; gap: var(--space-5); }
.filters-col-side { display: flex; flex-direction: column; gap: var(--space-5); }
@media (max-width: 768px) {
  .filters-layout { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Rebuild after CSS**

Run: `cd frontend && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SearchAndFilter.jsx frontend/src/styles/components.css
git commit -m "feat(B3): two-column filters panel with genre tree, facet tree, new filters and chips"
```

---

### Task 10: Full live smoke + verification

**Files:** none (verification only).

- [ ] **Step 1: Backend suite**

Run: `cd backend && npm test`
Expected: all files green.

- [ ] **Step 2: Frontend build + lint**

Run: `cd frontend && npm run build && npx eslint src/`
Expected: build clean; 0 eslint errors (pre-existing warnings acceptable).

- [ ] **Step 3: Live end-to-end smoke**

Start backend + frontend (fresh backend so the curator's running instance is untouched):

```bash
cd backend && PORT=5000 node server.js &
cd frontend && npm run dev &
```

In the browser Browse page, confirm:
- Genre parent counts now sum to ~1,003 (far more than the old 492); the "N songs have no genre" note shows.
- Opening Filters shows the two-column panel; year-range inputs show their full "From 1965" / "To 2024" placeholder text without clipping.
- Selecting a genre, a theme code, a length preset, "Has YouTube", a language each narrows results and drops a chip below the panel; the chip's ✕ removes just that filter; "Clear all" empties everything.
- Selecting a theme code + "Has YouTube" narrows further (AND).
- The facet tree shows the "Only songs with lyrics analysis (640) are counted here" note and sub-dimension colours.
- Unfiltered browse still lists all live songs.

- [ ] **Step 4: Stop the smoke servers**

Stop the two backgrounded dev servers (Ctrl-C or kill their specific PIDs — never `taskkill /F /IM node.exe`, which would kill unrelated node processes).

---

## Self-Review

**Spec coverage:**
- §1 genre fix → Tasks 1, 2, 3, 6, 9. ✔
- §2 facet tree → Tasks 5, 7, 9; deferred same-group test → Task 4. ✔
- §3 filter set (length/availability/analysis/language, year sizing) → Tasks 2, 3, 9. ✔
- §4 chips below panel → Tasks 8, 9. ✔
- §5 two-column layout + year sizing → Task 9. ✔
- §6 backend endpoints → Tasks 2, 3. ✔
- §7 verification → Task 10. ✔

**Type consistency:** `genre_tree.parents[].subgenres[].value`, `filters.genres` (subgenre values), `onToggleParent(parent, checked, subValues)`, facet dim keys `themes/targets/actions/tactics/moral_frames`, chip `key = "<type>:<value>"` — consistent across GenreFilterTree, ThemeFacetTree, FilterChips, SearchAndFilter. Backend service required as `genres_svc` in both Task 2 and Task 3 (single consistent alias; avoids colliding with the `/search` `genres` query param).

**Placeholder scan:** none — every step has concrete code/commands.
