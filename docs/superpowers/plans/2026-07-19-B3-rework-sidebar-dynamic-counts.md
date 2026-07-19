# B3 Rework — Sidebar Layout + Dynamic Counts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the browse filters into a left sidebar (mobile drawer), make every filter group's counts dynamic with exclude-self faceted semantics, and drop the Popularity sort — on the existing `session-B3-browse-search` branch, before merge.

**Architecture:** A shared `services/browseFilters.js` `buildWhere(filters,{exclude,startIndex})` produces per-group-tagged WHERE clauses; `/search` uses all groups, a new `/api/spotify/browse-facets` uses all-groups-minus-one per counted group to compute exclude-self counts in one call. `analysis.facetTree` gains an optional constraint so the theme tree can be counted over a filtered subset. Frontend: `SearchAndFilter` becomes a sidebar that receives the results node as `children`; it refetches `browse-facets` (debounced, stale-guarded) on every filter change.

**Tech Stack:** Node/Express + PostgreSQL (`pg`), `node:test`; React/Vite (no frontend unit-test runner — verify via `npm run build` + `npx eslint src/` + live smoke). Design tokens in `frontend/src/styles/`.

## Global Constraints

- Every query keeps `status = 'included' AND published = true`. Effective genre stays query-time (no stored writes). Never SELECT `song_lyrics`; analysis model filter is always `gemma4:latest` (`analysis.DEFAULT_MODEL`).
- **Exclude-self semantics:** a counted group's counts apply all OTHER groups' filters, never its own. Groups: `genre`, `analysis` (whole theme tree = one group), `length`, `available` (on_spotify+has_youtube), `analysis_toggle` (has_analysis), `language`. Always-applied, never a counted facet: text `q` and `year`.
- `/search` filtering and `browse-facets` counts MUST share `buildWhere` — they can never diverge.
- Backend tests serial (`node --test --test-concurrency=1`); DB-touching files use a unique sentinel; pure files touch no DB.
- Design tokens only in CSS (no raw colours; sub-dimension hexes only via inline style). No emoji in visible text. New frontend API calls use relative `/api`. No horizontal overflow at any width.
- Booleans arrive as the string `'true'`. The genres service is `genres_svc`; analysis service is `analysis`.
- Commit after every task; end messages with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01Wo1dRPzyss3anKUdqe5erz`

---

### Task 1: `services/browseFilters.js` — shared tagged filter builder (pure)

**Files:**
- Create: `backend/services/browseFilters.js`
- Test: `backend/test/browseFilters.test.js`

**Interfaces:**
- Consumes: `services/genres.js` (`EFFECTIVE_GENRE_EXPR`, `EFFECTIVE_GENRE_JOIN`, `genreFilterClause`, `lengthFilterClause`), `services/analysis.js` (`facetFilterConditions`, `DEFAULT_MODEL`).
- Produces:
  - `buildWhere(filters, { exclude=null, startIndex=1 })` → `{ where: string[], params: any[], nextIndex: number, joins: {albums,artists,effectiveGenre,analysis} }`. `where` does NOT include the `status/published` clause (each caller adds it). `filters` is a `req.query`-shaped object.
  - `joinSql(joins)` → FROM-join string for a count query.

- [ ] **Step 1: Write the failing test**

Create `backend/test/browseFilters.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const b = require('../services/browseFilters');
const genres = require('../services/genres');

// Pure-function tests — no DB, no sentinel.

test('buildWhere with no filters is empty', () => {
  const r = b.buildWhere({});
  assert.deepEqual(r.where, []);
  assert.deepEqual(r.params, []);
  assert.equal(r.nextIndex, 1);
  assert.deepEqual(r.joins, { albums: false, artists: false, effectiveGenre: false, analysis: false });
});

test('buildWhere text search sets albums+artists joins and one param', () => {
  const r = b.buildWhere({ q: 'vegan' });
  assert.equal(r.params.length, 1);
  assert.equal(r.params[0], '%vegan%');
  assert.ok(r.joins.albums && r.joins.artists);
  assert.ok(r.where[0].includes('a.name') && r.where[0].includes('al.name'));
});

test('buildWhere genre sets effectiveGenre join and uses the shared clause', () => {
  const r = b.buildWhere({ genres: ['metalcore'] });
  assert.ok(r.joins.effectiveGenre);
  assert.ok(r.where.some(c => c.includes(genres.EFFECTIVE_GENRE_EXPR)));
});

test('buildWhere exclude omits that group but keeps others', () => {
  const r = b.buildWhere({ genres: ['metalcore'], lengths: ['short'] }, { exclude: 'genre' });
  assert.ok(!r.joins.effectiveGenre, 'genre group excluded');
  assert.ok(r.where.some(c => c.includes('duration_ms')), 'length kept');
});

test('buildWhere analysis facets set analysis join and AND clauses', () => {
  const r = b.buildWhere({ themes: ['killing'], targets: ['cows'] });
  assert.ok(r.joins.analysis);
  assert.equal(r.where.filter(c => c.includes('@>')).length, 2);
});

test('buildWhere numbers params from startIndex', () => {
  const r = b.buildWhere({ q: 'x', languages: ['English'] }, { startIndex: 2 });
  // q -> $2, language -> $3
  assert.ok(r.where[0].includes('$2'));
  assert.ok(r.where.some(c => c.includes('$3')));
  assert.equal(r.nextIndex, 4);
});

test('joinSql emits only the needed joins', () => {
  assert.equal(b.joinSql({ albums: false, artists: false, effectiveGenre: false, analysis: false }), '');
  assert.ok(b.joinSql({ albums: true }).includes('LEFT JOIN albums'));
  assert.ok(b.joinSql({ effectiveGenre: true }).includes('LATERAL'));
  assert.ok(b.joinSql({ analysis: true }).includes('song_lyric_analysis sa'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/browseFilters.test.js`
Expected: FAIL — `Cannot find module '../services/browseFilters'`.

- [ ] **Step 3: Implement**

Create `backend/services/browseFilters.js`:

```js
// Shared browse filter builder. buildWhere returns per-group-tagged WHERE clauses so
// /search (all groups) and /browse-facets (all groups minus one, for exclude-self counts)
// share one source and can never drift. `where` omits the status/published clause — each
// caller prepends it. Booleans arrive as the string 'true'.
const genres_svc = require('./genres');
const analysis = require('./analysis');

function asList(v) { return v == null ? [] : (Array.isArray(v) ? v : [v]); }

function buildWhere(filters, { exclude = null, startIndex = 1 } = {}) {
  const where = [];
  const params = [];
  let idx = startIndex;
  const joins = { albums: false, artists: false, effectiveGenre: false, analysis: false };
  const inc = (g) => g !== exclude;

  const q = (filters.q || '').trim();
  if (q) {
    where.push(`(LOWER(s.title) LIKE LOWER($${idx}) OR LOWER(a.name) LIKE LOWER($${idx}) OR LOWER(al.name) LIKE LOWER($${idx}) OR LOWER(s.your_review) LIKE LOWER($${idx}))`);
    params.push(`%${q}%`); idx++;
    joins.albums = true; joins.artists = true;
  }
  if (filters.year_from) { where.push(`EXTRACT(YEAR FROM al.release_date) >= $${idx}`); params.push(parseInt(filters.year_from)); idx++; joins.albums = true; }
  if (filters.year_to)   { where.push(`EXTRACT(YEAR FROM al.release_date) <= $${idx}`); params.push(parseInt(filters.year_to)); idx++; joins.albums = true; }

  if (inc('genre') && asList(filters.genres).length) {
    const gf = genres_svc.genreFilterClause(filters.genres, idx);
    if (gf) { where.push(gf.clause); params.push(...gf.params); idx += gf.params.length; joins.effectiveGenre = true; }
  }
  if (inc('length') && asList(filters.lengths).length) {
    const lc = genres_svc.lengthFilterClause(filters.lengths);
    if (lc) where.push(lc);
  }
  if (inc('available')) {
    if (filters.on_spotify === 'true') where.push(`s.spotify_id IS NOT NULL AND s.spotify_id <> ''`);
    if (filters.has_youtube === 'true') where.push(`EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id = s.id)`);
  }
  if (inc('analysis_toggle') && filters.has_analysis === 'true') {
    where.push(`EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = s.id AND la.model_used = '${analysis.DEFAULT_MODEL}')`);
  }
  if (inc('language') && asList(filters.languages).length) {
    where.push(`s.language = ANY($${idx}::text[])`); params.push(asList(filters.languages)); idx++;
  }
  if (inc('analysis')) {
    const sel = { themes: filters.themes, targets: filters.targets, actions: filters.actions, tactics: filters.tactics, moral_frames: filters.moral_frames };
    const f = analysis.facetFilterConditions(sel, idx);
    if (f.needsJoin) { where.push(...f.clauses); params.push(...f.params); idx += f.params.length; joins.analysis = true; }
  }

  return { where, params, nextIndex: idx, joins };
}

// FROM-clause joins for a browse-facets COUNT query. /search keeps its own fixed FROM.
function joinSql(joins) {
  let s = '';
  if (joins.albums) s += ` LEFT JOIN albums al ON s.album_id = al.id`;
  if (joins.artists) s += ` JOIN song_artists sart ON s.id = sart.song_id JOIN artists a ON sart.artist_id = a.id`;
  if (joins.effectiveGenre) s += ` ${genres_svc.EFFECTIVE_GENRE_JOIN}`;
  if (joins.analysis) s += ` JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = '${analysis.DEFAULT_MODEL}'`;
  return s;
}

module.exports = { buildWhere, joinSql };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test test/browseFilters.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/services/browseFilters.js backend/test/browseFilters.test.js
git commit -m "feat(B3): shared tagged browse filter builder (services/browseFilters.js)"
```

---

### Task 2: Refactor `/search` to use `buildWhere`

**Files:**
- Modify: `backend/routes/spotify.js` — the `/search` handler.

**Interfaces:**
- Consumes: `browseFilters.buildWhere`.
- Produces: unchanged `/search` behaviour and response (verified by identical totals).

- [ ] **Step 1: Require the builder**

At the top of `backend/routes/spotify.js`, alongside the existing requires, add:

```js
const browse = require('../services/browseFilters');
```

- [ ] **Step 2: Replace the WHERE-building block**

In the `/search` handler, delete everything from `let whereConditions = [...]` through the end of the language-filter block **and** the separate `genreFilterClause`/length/boolean/language additions and the audio-feature blocks and the `parent_genres` block (all the per-filter WHERE building), replacing them with:

```js
    const bw = browse.buildWhere(req.query, { startIndex: 1 });
    const whereConditions = [`s.status = 'included' AND s.published = true`, ...bw.where];
    const queryParams = [...bw.params];
    let paramIndex = bw.nextIndex;
    const effectiveGenreJoin = bw.joins.effectiveGenre ? genres_svc.EFFECTIVE_GENRE_JOIN : '';
    const facetJoin = bw.joins.analysis
      ? `JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = '${analysis.DEFAULT_MODEL}'`
      : '';
```

Remove the now-dead destructured params (`energy_min`…`valence_max`, `genres`, `parent_genres`, `themes`…`moral_frames`, `lengths`, `has_youtube`, `has_analysis`, `on_spotify`, `languages`, `year_from`, `year_to`) from the `req.query` destructure — keep only `q`, `page`, `limit`, `sort_by` (buildWhere reads the rest straight off `req.query`). Keep the existing `orderBy` switch, the `searchQuery`/`countQuery` templates (which already interpolate `${effectiveGenreJoin}` and `${facetJoin}`), pagination, and the response — but simplify `filters_applied` to what the frontend still uses:

```js
      filters_applied: {
        query: q || null,
        genres: req.query.genres ? (Array.isArray(req.query.genres) ? req.query.genres : [req.query.genres]) : null,
        year_range: { from: req.query.year_from || null, to: req.query.year_to || null },
        sort_by
      }
```

- [ ] **Step 3: Live-verify totals unchanged**

```bash
cd backend && PORT=5055 node server.js > /tmp/s.log 2>&1 & SRV=$!
sleep 2.5
b='http://localhost:5055/api/spotify/search'
t(){ curl -s "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(process.argv[1],JSON.parse(d).pagination.total))" "$2"; }
t "$b?limit=1" "all(1332)......"
t "$b?genres=metalcore&limit=1" "metalcore(54)."
t "$b?lengths=short&limit=1" "short(260)...."
t "$b?has_youtube=true&limit=1" "youtube(711).."
t "$b?languages=English&limit=1" "English(32)..."
t "$b?themes=killing&limit=1" "killing(358).."
t "$b?themes=killing&has_youtube=true&limit=1" "kill+YT(188).."
t "$b?q=vegan&limit=1" "q=vegan......."
kill $SRV; echo killed
```

Expected: identical to the pre-refactor numbers (1332/54/260/711/32/358/188; `q=vegan` returns a nonzero total). No SQL errors.

- [ ] **Step 4: Backend suite**

Run: `cd backend && npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/spotify.js
git commit -m "refactor(B3): /search builds its WHERE via the shared browseFilters.buildWhere"
```

---

### Task 3: `analysis.facetTree` optional constraint

**Files:**
- Modify: `backend/services/analysis.js` (`facetTree`)
- Modify: `backend/test/analysis.test.js` (add one constrained test)

**Interfaces:**
- Produces: `facetTree(db, constraint = null)` where `constraint = { joinSql: string, where: string[], params: any[] }`. When present, the extra joins are spliced into the FROM, the extra `where` is ANDed, and `params` are appended after the model param (so the caller numbers them from `$2`). No-arg behaviour is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `backend/test/analysis.test.js` (before the final `after` hook; reuse `ZZZANL`):

```js
test('facetTree accepts a constraint that narrows the counted set', async () => {
  // One coded song with theme killing; constrain to a non-matching language -> zero counts.
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source, language)
     VALUES ('ZZZANL Constrained', 'included', true, 'manual', 'English') RETURNING id`)).rows[0];
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, 'gemma4:latest', $2::jsonb, '[]', '[]', '[]', '[]')`,
    [s.id, JSON.stringify([{ code: 'killing', evidence: 'x' }])]);

  // Constrain to a language that no coded song has -> killing count unaffected by our new row.
  const constrained = await analysis.facetTree(pool, {
    joinSql: '', where: [`s.language = $2`], params: ['ZZZ-NoSuchLang'],
  });
  // themes dimension should have no 'killing' contribution from our English song under this constraint
  const cruelty = (constrained.themes.sub_dimensions || []).find(sd => sd.id === 'cruelty_suffering');
  const killing = cruelty && cruelty.groups.find(g => g.id === 'violence')?.codes.find(c => c.code === 'killing');
  const constrainedCount = killing ? killing.count : 0;

  const unconstrained = await analysis.facetTree(pool);
  const uKilling = unconstrained.themes.sub_dimensions.find(sd => sd.id === 'cruelty_suffering')
    .groups.find(g => g.id === 'violence').codes.find(c => c.code === 'killing');
  assert.ok(uKilling.count > constrainedCount, 'constraint reduces the counted set');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/analysis.test.js`
Expected: FAIL — `facetTree` ignores the second arg, so constrained == unconstrained.

- [ ] **Step 3: Implement the constraint**

In `backend/services/analysis.js`, change `facetTree` to accept and apply the constraint. Replace the query construction inside the `for` loop:

```js
async function facetTree(db, constraint = null) {
  const out = {};
  const extraJoin = constraint ? (constraint.joinSql || '') : '';
  const extraWhere = constraint && constraint.where && constraint.where.length
    ? ' AND ' + constraint.where.join(' AND ') : '';
  const extraParams = constraint && constraint.params ? constraint.params : [];
  for (const [col, pub] of Object.entries(PUBLIC_DIMS)) {
    const rows = (await db.query(
      `SELECT DISTINCT s.id AS song_id, elem->>'code' AS code
       FROM songs s${extraJoin}
       JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = $1
       CROSS JOIN LATERAL jsonb_array_elements(sa.${col}) AS elem
       WHERE s.status = 'included' AND s.published = true${extraWhere}`,
      [DEFAULT_MODEL, ...extraParams])).rows;
    // ... (rest of the loop body unchanged: bump/codeSongs/groupSongs/subSongs/dimSongs, build subDimensions, out[pub] = ...)
  }
  return out;
}
```

(Leave the entire post-query aggregation body of the loop exactly as it is.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test test/analysis.test.js`
Expected: PASS (new test green; existing facetTree tests still pass — they call `facetTree(pool)` with no constraint).

- [ ] **Step 5: Backend suite + commit**

Run: `cd backend && npm test` → all green.

```bash
git add backend/services/analysis.js backend/test/analysis.test.js
git commit -m "feat(B3): facetTree accepts an optional constraint for filtered counts"
```

---

### Task 4: `GET /api/spotify/browse-facets` — exclude-self counts

**Files:**
- Modify: `backend/routes/spotify.js` (add the route)

**Interfaces:**
- Consumes: `browse.buildWhere`/`joinSql`, `genres_svc` (`EFFECTIVE_GENRE_EXPR`, `buildGenreTree`, `LENGTH_BUCKETS`), `analysis.facetTree`.
- Produces: `GET /api/spotify/browse-facets` (same query params as `/search`) →
  `{ genre_tree, facets, length_buckets, availability:{on_spotify,has_youtube,has_analysis}, languages, year_range }`, each group counted exclude-self.

- [ ] **Step 1: Add the route**

Add to `backend/routes/spotify.js` (after `/filter-options`):

```js
// Dynamic, cross-filtered facet counts (exclude-self). Same params as /search.
router.get('/browse-facets', async (req, res) => {
  try {
    const f = req.query;
    const LIVE = `s.status = 'included' AND s.published = true`;
    const whereSql = (bw) => 'WHERE ' + [LIVE, ...bw.where].join(' AND ');
    const MODEL = analysis.DEFAULT_MODEL;

    const bwG = browse.buildWhere(f, { exclude: 'genre' });
    const genreSql = `SELECT DISTINCT s.id, ${genres_svc.EFFECTIVE_GENRE_EXPR} AS effective_genre
      FROM songs s${browse.joinSql({ ...bwG.joins, effectiveGenre: true })} ${whereSql(bwG)}`;

    const bwL = browse.buildWhere(f, { exclude: 'length' });
    const lengthSql = `SELECT
        COUNT(DISTINCT s.id) FILTER (WHERE s.duration_ms >= 1 AND s.duration_ms < 120000)::int AS short,
        COUNT(DISTINCT s.id) FILTER (WHERE s.duration_ms >= 120000 AND s.duration_ms < 240000)::int AS medium,
        COUNT(DISTINCT s.id) FILTER (WHERE s.duration_ms >= 240000)::int AS long
      FROM songs s${browse.joinSql(bwL.joins)} ${whereSql(bwL)}`;

    const bwA = browse.buildWhere(f, { exclude: 'available' });
    const availSql = `SELECT
        COUNT(DISTINCT s.id) FILTER (WHERE s.spotify_id IS NOT NULL AND s.spotify_id <> '')::int AS on_spotify,
        COUNT(DISTINCT s.id) FILTER (WHERE EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id = s.id))::int AS has_youtube
      FROM songs s${browse.joinSql(bwA.joins)} ${whereSql(bwA)}`;

    const bwT = browse.buildWhere(f, { exclude: 'analysis_toggle' });
    const toggleSql = `SELECT
        COUNT(DISTINCT s.id) FILTER (WHERE EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = s.id AND la.model_used = '${MODEL}'))::int AS has_analysis
      FROM songs s${browse.joinSql(bwT.joins)} ${whereSql(bwT)}`;

    const bwLang = browse.buildWhere(f, { exclude: 'language' });
    const langSql = `SELECT s.language AS value, COUNT(DISTINCT s.id)::int AS count
      FROM songs s${browse.joinSql(bwLang.joins)} ${whereSql(bwLang)} AND s.language IS NOT NULL AND s.language <> ''
      GROUP BY s.language ORDER BY count DESC, value ASC`;

    const bwAn = browse.buildWhere(f, { exclude: 'analysis', startIndex: 2 });
    const constraint = { joinSql: browse.joinSql(bwAn.joins), where: bwAn.where, params: bwAn.params };

    const yearSql = `SELECT MIN(EXTRACT(YEAR FROM release_date)) AS min_year, MAX(EXTRACT(YEAR FROM release_date)) AS max_year
      FROM albums WHERE release_date IS NOT NULL
        AND id IN (SELECT album_id FROM songs WHERE status = 'included' AND published = true AND album_id IS NOT NULL)`;

    const [gR, lR, aR, tR, langR, facets, yR] = await Promise.all([
      pool.query(genreSql, bwG.params),
      pool.query(lengthSql, bwL.params),
      pool.query(availSql, bwA.params),
      pool.query(toggleSql, bwT.params),
      pool.query(langSql, bwLang.params),
      analysis.facetTree(pool, constraint),
      pool.query(yearSql),
    ]);

    const lc = lR.rows[0] || {};
    res.json({
      genre_tree: genres_svc.buildGenreTree(gR.rows),
      facets,
      length_buckets: genres_svc.LENGTH_BUCKETS.map(b => ({ value: b.value, label: b.label, count: lc[b.value] || 0 })),
      availability: {
        on_spotify: aR.rows[0]?.on_spotify || 0,
        has_youtube: aR.rows[0]?.has_youtube || 0,
        has_analysis: tR.rows[0]?.has_analysis || 0,
      },
      languages: langR.rows,
      year_range: yR.rows[0] || { min_year: null, max_year: null },
    });
  } catch (error) {
    console.error('Error in browse-facets:', error);
    res.status(500).json({ error: 'Failed to load browse facets', details: error.message });
  }
});
```

- [ ] **Step 2: Live-verify exclude-self**

```bash
cd backend && PORT=5055 node server.js > /tmp/bf.log 2>&1 & SRV=$!
sleep 2.5
u='http://localhost:5055/api/spotify/browse-facets'
show(){ curl -s "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const gsum=j.genre_tree.parents.reduce((s,p)=>s+p.count,0);const killing=(j.facets.themes.sub_dimensions.find(x=>x.id==='cruelty_suffering')||{}).groups?.find(g=>g.id==='violence')?.codes.find(c=>c.code==='killing')?.count;console.log(process.argv[1],'genreSum='+gsum,'killing='+killing,'has_analysis='+j.availability.has_analysis,'English='+(j.languages.find(l=>l.value==='English')||{}).count)})" "$2"; }
show "$u" "unfiltered....."
show "$u?themes=killing" "theme=killing.."
show "$u?genres=death%20metal" "genre=deathmtl."
kill $SRV; echo killed
```

Expected: **unfiltered** genreSum ~1003, has_analysis 640, English 32, killing 358. **theme=killing**: genreSum drops (genre counts now among killing songs), has_analysis unchanged-ish (analysis_toggle excludes its own group but killing is an analysis-group filter → has_analysis reflects killing subset), English drops, **killing stays 358** (its own group excluded → still shows full count so it's re-selectable). **genre=death metal**: killing drops (themes now among death-metal songs), genreSum stays ~1003 (genre is its own group, excluded → all genres still counted).

- [ ] **Step 3: Backend suite + commit**

Run: `cd backend && npm test` → all green (no new tests here; the route is integration-verified live, its logic covered by Task 1/3 unit tests).

```bash
git add backend/routes/spotify.js
git commit -m "feat(B3): /browse-facets endpoint — exclude-self cross-filtered counts"
```

---

### Task 5: Frontend API — `getBrowseFacets`

**Files:**
- Modify: `frontend/src/api/spotifyService.js`

**Interfaces:**
- Produces: `spotifyService.getBrowseFacets(filters)` → the `/browse-facets` object, or `{}` on failure. `filters` is the same params object `searchSongs` takes (arrays + `'true'` booleans); serialize identically (skip null/undefined/''), via a **relative** `/api/spotify/browse-facets` URL.

- [ ] **Step 1: Add the method**

In `frontend/src/api/spotifyService.js`, after `getFacets`, add:

```js
  // Dynamic cross-filtered facet counts for the browse sidebar. Relative URL (Vite proxy).
  getBrowseFacets: async (filters = {}) => {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v === null || v === undefined || v === '') return;
        if (Array.isArray(v)) v.forEach(x => params.append(k, x));
        else params.append(k, v);
      });
      const res = await fetch(`/api/spotify/browse-facets?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch browse facets');
      return await res.json();
    } catch (error) {
      console.warn('Could not load browse facets:', error);
      return {};
    }
  },
```

- [ ] **Step 2: Verify + commit**

Run: `cd frontend && npm run build && npx eslint src/api/spotifyService.js` → clean, 0 errors.

```bash
git add frontend/src/api/spotifyService.js
git commit -m "feat(B3): spotifyService.getBrowseFacets for dynamic sidebar counts"
```

---

### Task 6: Sidebar layout + drop Popularity sort

**Files:**
- Modify: `frontend/src/components/SearchAndFilter.jsx`
- Modify: `frontend/src/pages/HomePage.jsx` (`SearchSection`)
- Modify: `frontend/src/styles/components.css`

**Interfaces:**
- `SearchAndFilter` gains a `children` prop (the results node) and renders the browse layout: full-width search bar + sort + chips on top, then a two-column grid `filter-sidebar | children`. On narrow viewports the sidebar collapses behind a "Filters" button → slide-in drawer.
- `SearchSection` passes its results block as `children` of `SearchAndFilter` instead of rendering it as a sibling.

- [ ] **Step 1: Restructure `SearchAndFilter.jsx`**

Make these changes to the current file:
1. Signature: `function SearchAndFilter({ onResults, onLoading, onError, initialQuery = '', currentPage = 1, onPageReset, children })`.
2. `EMPTY_FILTERS.sort_by`: change `'popularity'` → `'year'`.
3. Add drawer state: `const [drawerOpen, setDrawerOpen] = useState(false);` (replace the old `isFiltersOpen`).
4. Sort dropdown: remove the `<option value="popularity">Popularity</option>` line (keep Title/Artist/Year).
5. Replace the whole `return (...)` with the sidebar layout below. It reuses all existing handlers/state (`chips`, `removeChip`, `GenreFilterTree`, `ThemeFacetTree`, the compact sections). The filter groups move into an `<aside className="browse-sidebar">`; the search bar + sort + chips sit on top; `children` render in the results column.

```jsx
  const filterGroups = (
    <div className="sidebar-groups">
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
      <div className="filter-section">
        <h3 className="filter-title">Year range</h3>
        <div className="range-inputs">
          <input type="number" placeholder={yr.min_year ? `From ${yr.min_year}` : 'From'}
            value={filters.year_from} onChange={(e) => setScalar('year_from', e.target.value)}
            min={yr.min_year} max={yr.max_year} />
          <span>to</span>
          <input type="number" placeholder={yr.max_year ? `To ${yr.max_year}` : 'To'}
            value={filters.year_to} onChange={(e) => setScalar('year_to', e.target.value)}
            min={yr.min_year} max={yr.max_year} />
        </div>
      </div>
      <div className="filter-section">
        <h3 className="filter-title">Song length</h3>
        <div className="filter-options">
          {(filterOptions.length_buckets || []).map(b => (
            <label key={b.value} className="filter-option">
              <input type="checkbox" checked={filters.lengths.includes(b.value)}
                onChange={(e) => toggleInArray('lengths', b.value, e.target.checked)} />
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
                <input type="checkbox" checked={filters.languages.includes(l.value)}
                  onChange={(e) => toggleInArray('languages', l.value, e.target.checked)} />
                <span className="filter-label">{l.value}<span className="filter-count">({l.count})</span></span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="browse">
      <div className="browse-top">
        <div className="search-container">
          <input type="text" className="search-input" placeholder="Search songs, artists, albums..."
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          <button className="filter-toggle drawer-toggle" onClick={() => setDrawerOpen(true)}>
            Filters {activeCount > 0 && <span className="filter-badge">{activeCount}</span>}
          </button>
          {activeCount > 0 && (
            <button className="clear-filters" onClick={clearAllFilters}>Clear all</button>
          )}
        </div>
        <div className="sort-container">
          <label>Sort by:</label>
          <select value={filters.sort_by} onChange={(e) => setScalar('sort_by', e.target.value)}>
            <option value="title">Title</option>
            <option value="artist">Artist</option>
            <option value="year">Year</option>
          </select>
        </div>
        <FilterChips chips={chips} onRemove={removeChip} />
      </div>

      <div className="browse-body">
        <aside className={`browse-sidebar ${drawerOpen ? 'open' : ''}`}>
          <div className="sidebar-drawer-head">
            <h2 className="sidebar-title">Filters</h2>
            <button className="drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close filters">✕</button>
          </div>
          {filterGroups}
        </aside>
        {drawerOpen && <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />}
        <div className="browse-results">
          {loading && <div className="search-loading">Searching...</div>}
          {children}
        </div>
      </div>
    </div>
  );
```

- [ ] **Step 2: Move the results into `SearchAndFilter` as children (`HomePage.jsx`)**

In `frontend/src/pages/HomePage.jsx` `SearchSection`, change the render so the `home-search-results` block is passed as `children`:

```jsx
        <SearchAndFilter
          onResults={handleResults}
          onLoading={handleLoading}
          onError={handleError}
          currentPage={currentPage}
          onPageReset={() => setCurrentPage(1)}
          initialQuery={initialSearchQuery}
        >
          {hasSearched && (
            <div className="home-search-results">
              {/* ...unchanged results/loading/error/pagination JSX... */}
            </div>
          )}
        </SearchAndFilter>
```

(Move the existing `{hasSearched && (...)}` block verbatim inside the `<SearchAndFilter>...</SearchAndFilter>` tags; delete it from where it was a sibling.) Also update the initial-load `sort_by: 'popularity'` at `HomePage.jsx:137` to `sort_by: 'year'` so the first page matches the new default.

- [ ] **Step 3: Sidebar CSS**

In `frontend/src/styles/components.css`, remove the old two-column panel rules added in the prior task (`.filters-layout`, `.filters-col-main`, `.filters-col-side`, and the `.filters-panel` open-panel block if now unused) and append:

```css
/* B3 rework — browse sidebar layout */
.browse-top { margin-bottom: var(--space-4); }
.browse-body { display: grid; grid-template-columns: 260px 1fr; gap: var(--space-6); align-items: start; }
.browse-sidebar { display: flex; flex-direction: column; gap: var(--space-5);
  background: var(--bg-surface); border: 1px solid var(--border-hairline);
  border-radius: var(--radius-md); padding: var(--space-4); position: sticky; top: var(--space-4); }
.sidebar-groups { display: flex; flex-direction: column; gap: var(--space-5); }
.sidebar-drawer-head { display: none; }
.browse-results { min-width: 0; }
.drawer-toggle { display: none; }
.drawer-scrim { display: none; }

@media (max-width: 900px) {
  .browse-body { grid-template-columns: 1fr; }
  .drawer-toggle { display: inline-flex; }
  .browse-sidebar { position: fixed; top: 0; left: 0; bottom: 0; z-index: 50;
    width: min(320px, 85vw); transform: translateX(-100%); transition: transform var(--duration-fast) var(--ease-standard);
    overflow-y: auto; border-radius: 0; }
  .browse-sidebar.open { transform: translateX(0); }
  .sidebar-drawer-head { display: flex; justify-content: space-between; align-items: center; }
  .drawer-close { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1rem; }
  .drawer-scrim { display: block; position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,0.5); }
}
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run build && npx eslint src/` → build clean; 0 errors.
Confirm no leftover `isFiltersOpen`/`filters-panel`/`filters-layout` references: `grep -rn "isFiltersOpen\|filters-layout\|filters-col" frontend/src` → empty.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SearchAndFilter.jsx frontend/src/pages/HomePage.jsx frontend/src/styles/components.css
git commit -m "feat(B3): left-sidebar browse layout + mobile drawer; drop Popularity sort"
```

---

### Task 7: Dynamic counts wiring + zero-count greying

**Files:**
- Modify: `frontend/src/components/SearchAndFilter.jsx`
- Modify: `frontend/src/components/GenreFilterTree.jsx`
- Modify: `frontend/src/components/ThemeFacetTree.jsx`

**Interfaces:**
- On every filter change, `SearchAndFilter` refetches `getBrowseFacets(params)` (debounced, stale-guarded) and feeds the fresh `genre_tree`/`facets`/`length_buckets`/`availability`/`languages` into the existing state (`filterOptions`, `facets`). Initial mount uses `getBrowseFacets({})` (unfiltered).
- `GenreFilterTree` / `ThemeFacetTree` grey+disable a non-selected option whose count is 0.

- [ ] **Step 1: Replace the initial-load + add a dynamic-count effect in `SearchAndFilter.jsx`**

Replace the mount effect (the `useEffect` that calls `getFilterOptions()` + `getFacets()`) with a single dynamic loader driven by the same params as search, guarded against stale responses:

```jsx
  const facetsReq = useRef(0);
  useEffect(() => {
    const params = buildSearchParams();
    const token = ++facetsReq.current;
    const t = setTimeout(async () => {
      const data = await spotifyService.getBrowseFacets(params);
      if (token !== facetsReq.current) return; // stale — a newer request superseded this
      setFilterOptions({
        genre_tree: data.genre_tree, year_range: data.year_range,
        languages: data.languages, length_buckets: data.length_buckets,
        availability: data.availability,
      });
      setFacets(data.facets || {});
    }, 300);
    return () => clearTimeout(t);
  }, [buildSearchParams]);
```

Add `useRef` to the React import. Remove the now-unused `getFilterOptions`/`getFacets` imports usage (the methods stay in the service for other callers). `buildSearchParams` already excludes `page`/`limit` effects on identity except via `currentPage`; that's fine (facets don't depend on page — acceptable to refetch, or drop `page`/`limit` from the params passed to `getBrowseFacets`). To avoid needless refetch on page change, pass a page-less object:

```jsx
    const { page, limit, ...facetParams } = buildSearchParams();
    const data = await spotifyService.getBrowseFacets(facetParams);
```

- [ ] **Step 2: Grey+disable zero-count options in `GenreFilterTree.jsx`**

For each subgenre `<label>`, disable + grey when its count is 0 and it is not selected:

```jsx
                    {subs.map((sub) => {
                      const zero = sub.count === 0 && !selectedGenres.includes(sub.value);
                      return (
                        <label key={sub.value} className={`filter-option subgenre ${zero ? 'is-zero' : ''}`}>
                          <input type="checkbox" disabled={zero}
                            checked={selectedGenres.includes(sub.value)}
                            onChange={(e) => onToggleGenre(sub.value, e.target.checked)} />
                          <span className="filter-label">{sub.value}<span className="filter-count">({sub.count})</span></span>
                        </label>
                      );
                    })}
```

Apply the same `is-zero`/`disabled` treatment to the parent-genre `<label>` when `parent.count === 0 && !selectedParents.includes(parent.value)`.

- [ ] **Step 3: Grey+disable zero-count codes in `ThemeFacetTree.jsx`**

For each code `<label>`:

```jsx
                      {group.codes.map((c) => {
                        const sel = (selected[dimKey] || []).includes(c.code);
                        const zero = c.count === 0 && !sel;
                        return (
                          <label key={c.code} className={`filter-option facet-code ${zero ? 'is-zero' : ''}`}>
                            <input type="checkbox" disabled={zero} checked={sel}
                              onChange={(e) => onToggle(dimKey, c.code, e.target.checked)} />
                            <span className="filter-label">
                              <span><span className="facet-dot" style={{ background: subDimensionColor(sub.id) }} />{c.label}</span>
                              <span className="filter-count">({c.count})</span>
                            </span>
                          </label>
                        );
                      })}
```

(The backend already omits empty groups/sub-dimensions from an unfiltered tree; under filters, a code that drops to 0 stays visible via this greying because it's within a group that still has other non-zero codes — acceptable.)

- [ ] **Step 4: `is-zero` style**

Append to `frontend/src/styles/components.css`:

```css
/* B3 rework — zero-count (unavailable under current filters) */
.filter-option.is-zero { opacity: 0.4; cursor: not-allowed; }
.filter-option.is-zero input { cursor: not-allowed; }
```

- [ ] **Step 5: Verify + commit**

Run: `cd frontend && npm run build && npx eslint src/` → build clean; 0 errors.

```bash
git add frontend/src/components/SearchAndFilter.jsx frontend/src/components/GenreFilterTree.jsx frontend/src/components/ThemeFacetTree.jsx frontend/src/styles/components.css
git commit -m "feat(B3): dynamic exclude-self counts wired into the sidebar + zero-count greying"
```

---

### Task 8: Full smoke + verification

**Files:** none.

- [ ] **Step 1: Backend suite** — `cd backend && npm test` → all green.
- [ ] **Step 2: Frontend** — `cd frontend && npm run build && npx eslint src/` → build clean, 0 errors.
- [ ] **Step 3: Live smoke** — fresh backend on :5000 + `npm run dev`; in the browser Browse page confirm:
  - Filters are a **left sidebar**; results to the right; nothing pushed down; no horizontal scroll at 1280 or 390px (drawer opens via the Filters button on narrow width).
  - **Sort** dropdown has no Popularity; default order is Year (newest first).
  - Pick **genre = death metal** → theme/length/language/availability counts drop to that subset; other genres still show counts (addable); zero-count options greyed.
  - Pick a **theme** → genre counts reflect it; the theme's own group still shows full counts.
  - Chips above results; add/remove works; results and counts refresh together.
  - Unfiltered counts equal the pre-rework numbers (genre sum ~1,003; has_analysis 640; English 32).
- [ ] **Step 4: Stop the smoke servers** (kill the specific PIDs — never `taskkill /F /IM node.exe`).

---

## Self-Review

**Spec coverage:** §1 sidebar → Task 6; §2 dynamic exclude-self counts → Tasks 1,3,4,7; §3 backend (shared builder + browse-facets + facetTree constraint) → Tasks 1,2,3,4; §4 frontend (getBrowseFacets + wiring + greying) → Tasks 5,7; §5 drop Popularity → Task 6. ✔

**Type consistency:** `buildWhere(filters,{exclude,startIndex})→{where,params,nextIndex,joins}` used identically in Tasks 2 and 4; `facetTree(db,{joinSql,where,params})` defined in Task 3, called in Task 4; `getBrowseFacets(filters)` returns `{genre_tree,facets,length_buckets,availability,languages,year_range}` consumed in Task 7 exactly as `filterOptions`/`facets` shapes the components already expect. ✔

**Placeholder scan:** none — every step has concrete code/commands. The one `filters_applied.genres` note in Task 2 offers the simpler expression explicitly.
