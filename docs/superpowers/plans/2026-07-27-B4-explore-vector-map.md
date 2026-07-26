# B4 — Explore Vector Map + Vector Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an Explore page — a 2D canvas map of the catalogue in four projected spaces, with the existing analytics dashboard beside it as a second tab — and replace the song page's dead "You might also like" with two embedding-based tabs plus an honest genre fallback.

**Architecture:** One new backend service (`services/explore.js`) owns everything: reading `song_coordinates`, discovering which coordinate spaces exist, assembling colour-by options, and computing similarity through a small metric registry. Two read-only routes hang off the existing `/api/analysis` router. The frontend gets one new page (`ExplorePage`) that is a tab shell over a hand-rolled canvas map and the relocated `DataDashboard`, plus a `SimilarSongs` component on the song page. Nothing writes to the database.

**Tech Stack:** Node/Express, PostgreSQL (`pg`, no `pgvector`), `node:test`; React 18 + Vite, react-router v7, plain canvas 2D (no new dependency).

**Spec:** [`docs/superpowers/specs/2026-07-27-B4-explore-vector-map-design.md`](../specs/2026-07-27-B4-explore-vector-map-design.md)

## Global Constraints

- **Read-only feature.** No writes to `song_coordinates`, `song_embeddings` or `song_lyric_analysis`; no migrations; no pipeline changes.
- **Never `SELECT` from `song_lyrics`** in any API route (`test/lyrics_privacy.test.js` guards this).
- **Every public query filters `status='included' AND published=true`** and uses `LEFT JOIN albums` (non-Spotify songs have no album row).
- **Every query touching `audio_embedding` MUST carry `array_length(audio_embedding, 1) = 6`** — that column still holds 1,041 rows of old 1024-dim vectors alongside 664 new 6-dim ones.
- **Colour/theme data comes from the latest analysis pass only**, via `analysis.LATEST_ANALYSIS`. No hard-coded model string anywhere.
- **CSS uses design tokens only** — `--bg-*` / `--text-*` / `--accent-*` / `--space-*` / `--radius-*`. Never raw colours. New component classes go in `frontend/src/styles/components.css`.
- **`InfoTip` for hover help**, never the native `title` attribute.
- **The `dataviz` skill MUST be invoked before writing any palette or chart code** (Task 5, Step 1).
- **Backend test file gets its own sentinel prefix: `ZZZEXP`.** Shared LIKE-prefix cleanup races under parallel runs. Baseline to preserve: **151/151 passing**.
- **Frontend gates:** `npm run lint` → 0 errors (6 pre-existing warnings are expected) and `npm run build` → clean. There is no frontend test runner.
- **Smoke tests run on isolated ports** — backend `:5001`, Vite `:5199`. The curator's `:5000`/`:5173` must survive. **Kill by PID only — never `taskkill /F /IM node.exe`.**
- **No temp scripts under `backend/`** (nodemon restarts the server mid-run). Use the scratchpad with absolute `require` paths.
- **Commits:** `git commit -F <scratchpad msg file>` run from the repo root, with the co-author and session trailers.
- Work on a branch: `git checkout -b session-B4-explore-map`.

---

### Task 1: `services/explore.js` — space discovery and the map read

**Files:**
- Create: `backend/services/explore.js`
- Create: `backend/test/explore.test.js`

**Interfaces:**
- Consumes: `analysis.LATEST_ANALYSIS` (string SQL fragment), `genres.EFFECTIVE_GENRE_JOIN` / `genres.EFFECTIVE_GENRE_EXPR`.
- Produces:
  - `SPACE_LABELS: Record<string,string>`
  - `spaceLabel(key: string): string`
  - `discoverSpaces(db): Promise<Array<{key,column,label}>>`
  - `mapRows(db, spaces): Promise<Array<row>>` — raw DB rows, one per mapped live song.

- [ ] **Step 1: Write the failing test**

Create `backend/test/explore.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const explore = require('../services/explore');

// Unique fixture sentinel per test file: ZZZEXP.

test('spaceLabel maps audio to the site word and title-cases anything unknown', () => {
  assert.equal(explore.spaceLabel('semantic'), 'Semantic');
  assert.equal(explore.spaceLabel('audio'), 'Sound');
  assert.equal(explore.spaceLabel('holistic'), 'Holistic');
  assert.equal(explore.spaceLabel('some_new_space'), 'Some New Space');
});

test('discoverSpaces reads the *_2d columns from the live table', async () => {
  const spaces = await explore.discoverSpaces(pool);
  const keys = spaces.map(s => s.key);
  for (const expected of ['semantic', 'thematic', 'audio', 'holistic']) {
    assert.ok(keys.includes(expected), `expected space ${expected}`);
  }
  for (const s of spaces) {
    assert.ok(s.column.endsWith('_2d'), 'column is a 2d column');
    assert.ok(s.label, 'every space has a label');
  }
});

after(async () => { await pool.end(); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx node --test test/explore.test.js`
Expected: FAIL — `Cannot find module '../services/explore'`.

- [ ] **Step 3: Create the service with discovery only**

Create `backend/services/explore.js`:

```js
// Explore-service reads over song_coordinates / song_embeddings.
// Read-only: this service never writes. Functions take `db` (pool or client) first,
// mirroring services/analysis.js.
const analysis = require('./analysis');
const genres = require('./genres');
const acoustic = require('./acousticCodebook');
const codebook = require('./metadataCodebook');
const { getParentGenre } = require('../utils/genreMapping');

// Friendly names for the projected spaces. `audio` is shown as "Sound" — the site's word
// for the acoustic dimensions everywhere else. Unknown spaces title-case rather than
// vanish, so a space the pipeline adds appears without a code change.
const SPACE_LABELS = {
  semantic: 'Semantic',
  thematic: 'Thematic',
  audio: 'Sound',
  holistic: 'Holistic',
};

function titleCase(key) {
  return String(key).toLowerCase().split('_')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

function spaceLabel(key) {
  return SPACE_LABELS[key] || titleCase(key);
}

// Which 2D coordinate sets exist right now. Column names come from the catalogue, never
// from user input, and are re-checked against a strict pattern before being spliced into
// SQL as identifiers.
const SPACE_COLUMN = /^[a-z][a-z0-9_]*_2d$/;

async function discoverSpaces(db) {
  const r = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'song_coordinates'
      ORDER BY ordinal_position`);
  return r.rows
    .map(x => x.column_name)
    .filter(c => SPACE_COLUMN.test(c))
    .map(c => {
      const key = c.slice(0, -3);
      return { key, column: c, label: spaceLabel(key) };
    });
}

module.exports = { SPACE_LABELS, spaceLabel, discoverSpaces };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx node --test test/explore.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the failing test for the map read**

Append to `backend/test/explore.test.js` (above the `after` hook):

```js
// --- fixtures -------------------------------------------------------------
const made = { songs: [] };

async function mkSong(title, { published = true, status = 'included' } = {}) {
  const id = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ($1, $2, $3, 'manual') RETURNING id`, [title, status, published])).rows[0].id;
  made.songs.push(id);
  return id;
}

async function addCoords(songId) {
  await pool.query(
    `INSERT INTO song_coordinates
       (song_id, semantic_2d, semantic_3d, thematic_2d, thematic_3d,
        audio_2d, audio_3d, holistic_2d, holistic_3d)
     VALUES ($1, '{1,2}', '{1,2,3}', '{3,4}', '{1,2,3}',
             '{5,6}', '{1,2,3}', '{7,8}', '{1,2,3}')`, [songId]);
}

async function addAnalysis(songId, fields = {}) {
  const f = { sonic_energy: null, focus_amount: null, ...fields };
  await pool.query(
    `INSERT INTO song_lyric_analysis
       (song_id, model_used, analyzed_at, themes, topics, advocacy, tactics, moral_frames,
        sonic_energy, focus_amount)
     VALUES ($1,'zzzexp-model','2026-07-27 10:00:00',
             '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$2,$3)`,
    [songId, f.sonic_energy, f.focus_amount]);
}

test('mapRows returns live mapped songs only', async () => {
  const spaces = await explore.discoverSpaces(pool);

  const live = await mkSong('ZZZEXP Live');
  await addCoords(live);
  await addAnalysis(live, { sonic_energy: 'EXPLOSIVE_HIGH_INTENSITY' });

  const unpublished = await mkSong('ZZZEXP Unpublished', { published: false });
  await addCoords(unpublished);

  const pending = await mkSong('ZZZEXP Pending', { status: 'pending' });
  await addCoords(pending);

  const unmapped = await mkSong('ZZZEXP No coords');

  const rows = await explore.mapRows(pool, spaces);
  const ids = rows.map(r => r.id);

  assert.ok(ids.includes(live), 'live mapped song is present');
  assert.ok(!ids.includes(unpublished), 'included-but-unpublished song is excluded');
  assert.ok(!ids.includes(pending), 'pending song is excluded');
  assert.ok(!ids.includes(unmapped), 'song without coordinates is excluded');

  const row = rows.find(r => r.id === live);
  assert.deepEqual(row.semantic_2d, [1, 2], 'coordinates come through as numbers');
  assert.equal(row.sonic_energy, 'EXPLOSIVE_HIGH_INTENSITY', 'latest-pass codes come through');
  assert.equal(row.title, 'ZZZEXP Live');
});
```

And replace the `after` hook with:

```js
after(async () => {
  if (made.songs.length) {
    await pool.query('DELETE FROM song_coordinates WHERE song_id = ANY($1::int[])', [made.songs]);
    await pool.query('DELETE FROM song_lyric_analysis WHERE song_id = ANY($1::int[])', [made.songs]);
    await pool.query('DELETE FROM songs WHERE id = ANY($1::int[])', [made.songs]);
  }
  await pool.end();
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd backend && npx node --test test/explore.test.js`
Expected: FAIL — `explore.mapRows is not a function`.

- [ ] **Step 7: Implement `mapRows`**

Add to `backend/services/explore.js`, before `module.exports`:

```js
// One row per live, mapped song. Artists come from a scalar subquery rather than an
// aggregate so the statement needs no GROUP BY. Coordinate columns are spliced from the
// discovered (catalogue-sourced, pattern-checked) list.
async function mapRows(db, spaces) {
  const coordCols = spaces.map(s => `sc.${s.column}`).join(',\n           ');
  const r = await db.query(
    `SELECT s.id,
            s.title,
            EXTRACT(YEAR FROM al.release_date)::int AS year,
            al.images->0->>'url' AS art,
            (SELECT ARRAY_AGG(a.name ORDER BY sa.id)
               FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
              WHERE sa.song_id = s.id) AS artists,
            ${genres.EFFECTIVE_GENRE_EXPR} AS genre,
            sla.sonic_energy, sla.emotional_mood, sla.rhythmic_style,
            sla.acoustic_type, sla.vocal_delivery, sla.focus_amount,
            ${coordCols}
       FROM songs s
       JOIN song_coordinates sc ON sc.song_id = s.id
       LEFT JOIN albums al ON al.id = s.album_id
       ${genres.EFFECTIVE_GENRE_JOIN}
       LEFT JOIN ${analysis.LATEST_ANALYSIS} sla ON sla.song_id = s.id
      WHERE s.status = 'included' AND s.published = true
      ORDER BY s.id`);
  return r.rows;
}
```

Update the exports line:

```js
module.exports = { SPACE_LABELS, spaceLabel, discoverSpaces, mapRows };
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend && npx node --test test/explore.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 9: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: all pass — 151 pre-existing + 3 new.

- [ ] **Step 10: Commit**

```bash
git add backend/services/explore.js backend/test/explore.test.js
git commit -F <scratchpad msg file>   # feat(explore): space discovery + publish-filtered map read
```

---

### Task 2: Colour-by options, coverage, and the assembled payload

**Files:**
- Modify: `backend/services/explore.js`
- Modify: `backend/test/explore.test.js`

**Interfaces:**
- Consumes: `mapRows`, `discoverSpaces` from Task 1.
- Produces:
  - `NOT_CODED = 'NOT_CODED'` (string constant)
  - `COLOUR_DIMENSIONS: Array<{key, label, source}>` where `source` is `'acoustic' | 'scalar' | 'genre'`
  - `codeFor(dimension, row): string` — the colour bucket for one song under one dimension
  - `mapPayload(db): Promise<{spaces, colourBy, coverage, songs}>`

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/explore.test.js` (above the `after` hook):

```js
test('codeFor collapses absent, suppressed and missing values into NOT_CODED', () => {
  assert.equal(explore.codeFor('sonic_energy', { sonic_energy: 'EXPLOSIVE_HIGH_INTENSITY' }),
    'EXPLOSIVE_HIGH_INTENSITY');
  assert.equal(explore.codeFor('sonic_energy', { sonic_energy: null }), explore.NOT_CODED);
  // ABSENCE_OF_FOCUS is a suppressed absence code, not a finding
  assert.equal(explore.codeFor('focus_amount', { focus_amount: 'ABSENCE_OF_FOCUS' }), explore.NOT_CODED);
  assert.equal(explore.codeFor('focus_amount', { focus_amount: 'CENTRAL_THESIS' }), 'CENTRAL_THESIS');
  // genre buckets to its parent
  assert.equal(explore.codeFor('genre', { genre: 'metalcore' }), 'metal');
  assert.equal(explore.codeFor('genre', { genre: null }), explore.NOT_CODED);
});

test('mapPayload assembles spaces, legends, coverage and songs', async () => {
  const id = await mkSong('ZZZEXP Payload');
  await addCoords(id);
  await addAnalysis(id, { sonic_energy: 'EXPLOSIVE_HIGH_INTENSITY', focus_amount: 'ABSENCE_OF_FOCUS' });

  const p = await explore.mapPayload(pool);

  assert.ok(p.spaces.some(s => s.key === 'audio' && s.label === 'Sound'));
  assert.ok(p.coverage.mapped > 0 && p.coverage.live >= p.coverage.mapped,
    'coverage counts are sane');
  assert.equal(p.coverage.mapped, p.songs.length, 'mapped count matches the songs served');

  const energy = p.colourBy.find(c => c.key === 'sonic_energy');
  assert.equal(energy.label, 'Energy');
  assert.ok(energy.codes.every(c => c.count > 0), 'legend lists only codes actually present');
  assert.ok(energy.codes.some(c => c.code === 'EXPLOSIVE_HIGH_INTENSITY'));

  const notCoded = energy.codes.find(c => c.code === explore.NOT_CODED);
  if (notCoded) {
    assert.equal(notCoded.label, 'Not coded');
    assert.equal(energy.codes[energy.codes.length - 1].code, explore.NOT_CODED,
      'Not coded sorts last');
  }

  const song = p.songs.find(s => s.id === id);
  assert.deepEqual(song.coords.semantic, [1, 2]);
  assert.equal(song.codes.sonic_energy, 'EXPLOSIVE_HIGH_INTENSITY');
  assert.equal(song.codes.focus_amount, explore.NOT_CODED, 'suppressed code is bucketed');
  assert.equal(song.artist, '', 'a song with no artist rows serves an empty artist string');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx node --test test/explore.test.js`
Expected: FAIL — `explore.codeFor is not a function`.

- [ ] **Step 3: Implement colour dimensions and the payload**

Add to `backend/services/explore.js`, before `module.exports`:

```js
// One bucket for every "we have no finding here" case: a null, a missing analysis row, or
// one of the four absence codes. Drawn as neutral grey and always listed last, consistent
// with the 2026-07-22 decision to hide absence codes rather than give them a colour.
const NOT_CODED = 'NOT_CODED';
const NOT_CODED_LABEL = 'Not coded';

// The curated, low-cardinality colour-by menu: five acoustic dimensions (3–4 codes each),
// one scalar component, and parent genre. Deliberately NOT all seven scalar components —
// `lyrical_tone` has 16 codes and a legend that long stops being a key.
const COLOUR_DIMENSIONS = [
  ...acoustic.COMPONENTS.map(c => ({ key: c.key, label: c.heading, source: 'acoustic' })),
  { key: 'focus_amount', label: 'Focus', source: 'scalar' },
  { key: 'genre', label: 'Genre', source: 'genre' },
];

const DIMENSION_BY_KEY = Object.fromEntries(COLOUR_DIMENSIONS.map(d => [d.key, d]));

// The colour bucket for one song under one dimension.
function codeFor(dimensionKey, row) {
  const dim = DIMENSION_BY_KEY[dimensionKey];
  if (!dim) return NOT_CODED;
  if (dim.source === 'genre') {
    return getParentGenre(row.genre) || NOT_CODED;
  }
  const v = row[dimensionKey];
  if (!v) return NOT_CODED;
  if (dim.source === 'scalar' && codebook.isSuppressed(v)) return NOT_CODED;
  return v;
}

function labelFor(dim, code) {
  if (code === NOT_CODED) return NOT_CODED_LABEL;
  if (dim.source === 'acoustic') return acoustic.codeLabel(dim.key, code);
  if (dim.source === 'scalar') return codebook.codeLabel(dim.key, code);
  return titleCase(code);
}

// Legend entries for one dimension, counted over the songs actually on the map. Codebook
// order first (so the legend reads the way the codebook does), then any observed
// off-codebook code by descending count, then "Not coded" last. Zero-count codes are
// omitted — the legend describes what is on screen.
function legendFor(dim, rows) {
  const counts = new Map();
  for (const r of rows) {
    const code = codeFor(dim.key, r);
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  const ordered = [];
  const seen = new Set([NOT_CODED]);
  const known = dim.source === 'acoustic' ? acoustic.optionsFor(dim.key)
    : dim.source === 'scalar' ? codebook.optionsFor(dim.key)
    : [];
  for (const o of known) {
    seen.add(o.code);
    if (counts.has(o.code)) ordered.push({ code: o.code, label: o.label, count: counts.get(o.code) });
  }
  const extras = [...counts.entries()]
    .filter(([code]) => !seen.has(code))
    .sort((a, b) => b[1] - a[1]);
  for (const [code, count] of extras) {
    ordered.push({ code, label: labelFor(dim, code), count });
  }
  if (counts.has(NOT_CODED)) {
    ordered.push({ code: NOT_CODED, label: NOT_CODED_LABEL, count: counts.get(NOT_CODED) });
  }
  return ordered;
}

// Everything the Explore page needs, in one response: switching space, switching colour-by,
// spotlighting and searching then need no further request, and the selected-song card needs
// no second fetch.
async function mapPayload(db) {
  const spaces = await discoverSpaces(db);
  const rows = await mapRows(db, spaces);
  const live = await db.query(
    `SELECT COUNT(*)::int AS n FROM songs WHERE status = 'included' AND published = true`);

  const songs = rows.map(r => {
    const coords = {};
    for (const s of spaces) coords[s.key] = r[s.column];
    const codes = {};
    for (const d of COLOUR_DIMENSIONS) codes[d.key] = codeFor(d.key, r);
    return {
      id: r.id,
      title: r.title,
      artist: (r.artists || []).join(', '),
      year: r.year,
      art: r.art,
      coords,
      codes,
    };
  });

  return {
    spaces: spaces.map(s => ({ key: s.key, label: s.label })),
    colourBy: COLOUR_DIMENSIONS.map(d => ({ key: d.key, label: d.label, codes: legendFor(d, rows) })),
    coverage: { mapped: songs.length, live: live.rows[0].n },
    songs,
  };
}
```

Update the exports line:

```js
module.exports = {
  SPACE_LABELS, spaceLabel, discoverSpaces, mapRows,
  NOT_CODED, COLOUR_DIMENSIONS, codeFor, mapPayload,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx node --test test/explore.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/services/explore.js backend/test/explore.test.js
git commit -F <scratchpad msg file>   # feat(explore): colour-by legends, coverage and the map payload
```

---

### Task 3: The map endpoint

**Files:**
- Modify: `backend/routes/analysis.js`

**Interfaces:**
- Consumes: `explore.mapPayload(db)` from Task 2.
- Produces: `GET /api/analysis/explore/points` → the payload object.

- [ ] **Step 1: Add the route**

In `backend/routes/analysis.js`, add the require under the existing ones:

```js
const explore = require('../services/explore');
```

And add this route **immediately after the `/facets` route and before `/song/:id`** — Express matches in declaration order, so a route declared after `/song/:id` would never be reached for a path that could parse as an id:

```js
// The whole Explore map in one response: spaces, colour-by legends, coverage and points.
// Publish-filtered — unlike the retired public/vector_space.json, which leaked 24 non-live songs.
router.get('/explore/points', async (req, res) => {
  try {
    res.json(await explore.mapPayload(pool));
  } catch (e) {
    console.error('explore points error:', e);
    res.status(500).json({ error: 'Failed to load explore points' });
  }
});
```

- [ ] **Step 2: Verify the route is mounted**

Run from the scratchpad (never under `backend/`), with absolute requires:

```js
// <scratchpad>/routes-check.js
const router = require('C:/Users/Owner/Documents/AI Applications/vegan-playlist/backend/routes/analysis.js');
console.log(router.stack.filter(l => l.route).map(l => l.route.path));
```

Run: `node <scratchpad>/routes-check.js`
Expected: `[ '/facets', '/explore/points', '/song/:id' ]`

- [ ] **Step 3: Smoke the endpoint against live data**

Start an isolated backend on port 5001 (the curator's :5000 must survive):

```bash
cd backend && PORT=5001 node server.js &
curl -s "http://localhost:5001/api/analysis/explore/points" > <scratchpad>/points.json
```

Check with `node -e` from the scratchpad:

Expected: `coverage.mapped` ≈ **640**, `coverage.live` ≈ **1333**, `spaces.length` = **4** including `{key:'audio',label:'Sound'}`, `songs.length === coverage.mapped`, and every song carrying four `coords` entries of two numbers each.

Record the payload size: `ls -l <scratchpad>/points.json` — expected ~250KB. If it exceeds 1MB, stop and report.

Kill the backend **by PID** (`kill <pid>`), never `taskkill /F /IM node.exe`.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/analysis.js
git commit -F <scratchpad msg file>   # feat(explore): GET /api/analysis/explore/points
```

---

### Task 4: Nav, routes, and the Explore tab shell

**Files:**
- Create: `frontend/src/pages/ExplorePage.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/NavigationMenu.jsx`
- Modify: `frontend/src/components/DataDashboard.jsx` (one line — heading level)
- Modify: `frontend/src/styles/components.css`

**Interfaces:**
- Produces: routes `/explore` (index) and `/explore/data`; `/dashboard` redirects to `/explore/data`. `ExplorePage` renders the page heading, the tab links and an `<Outlet />`.
- Consumes: nothing from earlier tasks. The map itself is a placeholder here and is built in Task 5.

- [ ] **Step 1: Create the tab shell**

Create `frontend/src/pages/ExplorePage.jsx`:

```jsx
import { NavLink, Outlet } from 'react-router-dom';

// Two ways of looking at the whole catalogue: the vector map, and the analytics the
// standalone /dashboard used to serve. Tabs are real routes so each is linkable.
function ExplorePage() {
  return (
    <div className="explore-page">
      <header className="explore-head">
        <h1>Explore</h1>
        <nav className="explore-tabs" aria-label="Explore views">
          <NavLink to="/explore" end className={({ isActive }) => `explore-tab ${isActive ? 'active' : ''}`}>
            Map
          </NavLink>
          <NavLink to="/explore/data" className={({ isActive }) => `explore-tab ${isActive ? 'active' : ''}`}>
            Data
          </NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

export default ExplorePage;
```

- [ ] **Step 2: Wire the routes**

In `frontend/src/App.jsx`, extend the react-router import:

```jsx
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
```

Add the page import next to the other page imports:

```jsx
import ExplorePage from './pages/ExplorePage';
import ExploreMap from './components/explore/ExploreMap';
```

Replace the `/dashboard` route line with:

```jsx
          <Route path="/explore" element={<ExplorePage />}>
            <Route index element={<ExploreMap />} />
            <Route path="data" element={<DataDashboard />} />
          </Route>
          <Route path="/dashboard" element={<Navigate to="/explore/data" replace />} />
```

- [ ] **Step 3: Create a placeholder map so the route resolves**

Create `frontend/src/components/explore/ExploreMap.jsx`:

```jsx
// Placeholder — the canvas map lands in Task 5.
function ExploreMap() {
  return <div className="explore-map">Map</div>;
}

export default ExploreMap;
```

- [ ] **Step 4: Update the nav**

In `frontend/src/components/NavigationMenu.jsx`, **replace** the Dashboard `<li>` block (currently `isActive('/dashboard')` … `Dashboard`) with nothing, and insert this new `<li>` immediately **after** the Playlists `<li>`:

```jsx
        <li className={`nav-item ${isActive('/explore') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/explore', 'Explore'); }}>
            Explore
          </a>
        </li>
```

- [ ] **Step 5: Demote the dashboard heading**

In `frontend/src/components/DataDashboard.jsx` line 187, change:

```jsx
        <h1>Vegan music analytics</h1>
```

to:

```jsx
        <h2>Vegan music analytics</h2>
```

(The page's `<h1>` is now "Explore".)

- [ ] **Step 6: Add the shell styles**

Append to `frontend/src/styles/components.css`:

```css
/* ===== Explore page ===== */
.explore-page {
  max-width: var(--container-max, 1280px);
  margin: 0 auto;
  padding: var(--space-5) var(--space-4);
}

.explore-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-5);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.explore-tabs {
  display: flex;
  gap: var(--space-2);
}

.explore-tab {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  text-decoration: none;
  font: var(--text-label);
}

.explore-tab:hover { color: var(--text-primary); }

.explore-tab.active {
  background: var(--bg-surface);
  color: var(--text-primary);
}
```

If `--container-max` or `--radius-md` are not defined in `styles/tokens/`, use the value the browse page already uses — check `.browse-body` in the same file and match it rather than inventing a token.

- [ ] **Step 7: Verify**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors (6 pre-existing warnings), build clean.

Then start Vite on the isolated port and check by hand:

```bash
cd frontend && npm run dev -- --port 5199
```

Expected: `/explore` shows the heading, both tabs, and the word "Map"; `/explore/data` shows the analytics dashboard under one `<h1>`; `/dashboard` redirects to `/explore/data`; the nav shows Explore after Playlists and no Dashboard item.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/ExplorePage.jsx frontend/src/components/explore/ExploreMap.jsx frontend/src/App.jsx frontend/src/components/NavigationMenu.jsx frontend/src/components/DataDashboard.jsx frontend/src/styles/components.css
git commit -F <scratchpad msg file>   # feat(explore): Explore shell with Map/Data tabs; retire the Dashboard nav item
```

---

### Task 5: The palette and the canvas map

**Files:**
- Create: `frontend/src/components/explore/palette.js`
- Create: `frontend/src/components/explore/useExplorePoints.js`
- Modify: `frontend/src/components/explore/ExploreMap.jsx`
- Modify: `frontend/src/styles/components.css`

**Interfaces:**
- Consumes: `GET /api/analysis/explore/points` from Task 3.
- Produces:
  - `palette.js` → `NOT_CODED`, `colourScale(codes: string[]): (code) => string`, `DIM_COLOUR: string`
  - `useExplorePoints()` → `{ data, loading, error, reload }`
  - `ExploreMap` renders the toolbar (space chips, colour-by select) and the canvas, coloured, rescaled per space.

- [ ] **Step 1: Invoke the `dataviz` skill — REQUIRED BEFORE WRITING `palette.js`**

This is a project rule and the skill's own trigger: categorical colours for a scatter plot. Read it and take the categorical palette and the contrast rules from it. Do not hand-pick hex values.

The palette must satisfy:
- **≤ 5 categories per legend** (the largest dimension here has 4 codes plus "Not coded").
- Readable in **both light and dark** — the site ships a warm-dark theme with tokens in `frontend/src/styles/tokens/colors.css`.
- **"Not coded" is neutral grey**, never a palette colour.
- Values written as CSS custom properties in `components.css` so both themes can be handled by the existing token mechanism, and read from JS via `getComputedStyle` — do not duplicate hex values in the JS.

- [ ] **Step 2: Write the palette module**

Create `frontend/src/components/explore/palette.js`:

```js
// Categorical colours for the map. Values live in CSS (components.css, --explore-cat-*)
// so light/dark theming stays in the token layer; JS only reads them.
export const NOT_CODED = 'NOT_CODED';

const CAT_VARS = [
  '--explore-cat-1', '--explore-cat-2', '--explore-cat-3',
  '--explore-cat-4', '--explore-cat-5',
];

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Colour lookup for one legend. Codes arrive in legend order; NOT_CODED always takes the
// neutral, never a categorical slot.
export function colourScale(codes) {
  const cats = CAT_VARS.map(v => cssVar(v, '#888'));
  const neutral = cssVar('--explore-not-coded', '#8a8a8a');
  const map = new Map();
  let i = 0;
  for (const code of codes) {
    if (code === NOT_CODED) { map.set(code, neutral); continue; }
    map.set(code, cats[i % cats.length]);
    i += 1;
  }
  return (code) => map.get(code) || neutral;
}

export function dimColour() {
  return cssVar('--explore-dimmed', 'rgba(140,140,140,0.22)');
}
```

Add the variables to `frontend/src/styles/components.css` — **fill these five in from the `dataviz` skill's categorical palette**, and give the dark theme its own block if the skill's values need adjusting for the warm-dark background:

```css
:root {
  --explore-cat-1: /* from dataviz */;
  --explore-cat-2: /* from dataviz */;
  --explore-cat-3: /* from dataviz */;
  --explore-cat-4: /* from dataviz */;
  --explore-cat-5: /* from dataviz */;
  --explore-not-coded: /* neutral grey, from dataviz */;
  --explore-dimmed: /* the same neutral at ~20% alpha */;
}
```

- [ ] **Step 3: Write the fetch hook**

Create `frontend/src/components/explore/useExplorePoints.js`:

```js
import { useCallback, useEffect, useState } from 'react';

// One request serves the whole page. Relative URL so it goes through the Vite proxy —
// never hardcode localhost:5000 in new code.
export function useExplorePoints() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analysis/explore/points');
      if (!res.ok) throw new Error('Failed to load the map');
      setData(await res.json());
    } catch (e) {
      setError(e.message || 'Failed to load the map');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
```

- [ ] **Step 4: Render the map**

Replace `frontend/src/components/explore/ExploreMap.jsx` entirely:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useExplorePoints } from './useExplorePoints';
import { colourScale, dimColour } from './palette';

const DOT_RADIUS = 3.2;
const PAD = 18;

// Each space is projected on its own scale (semantic_2d x spans -3.6..14.0 where
// holistic_2d spans -4.7..5.1), so extents are recomputed per space — never assume a
// shared domain.
function extentsFor(songs, spaceKey) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of songs) {
    const c = s.coords[spaceKey];
    if (!c) continue;
    if (c[0] < minX) minX = c[0];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[1] > maxY) maxY = c[1];
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  if (minX === maxX) { minX -= 0.5; maxX += 0.5; }
  if (minY === maxY) { minY -= 0.5; maxY += 0.5; }
  return { minX, maxX, minY, maxY };
}

function ExploreMap() {
  const { data, loading, error, reload } = useExplorePoints();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [space, setSpace] = useState(null);
  const [colour, setColour] = useState(null);

  // Default to the first discovered space and to Energy when it exists.
  useEffect(() => {
    if (!data) return;
    setSpace(prev => prev || (data.spaces[0] && data.spaces[0].key));
    setColour(prev => prev ||
      (data.colourBy.find(c => c.key === 'sonic_energy') || data.colourBy[0] || {}).key);
  }, [data]);

  // Track the plot box so the canvas can be backing-store accurate.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.max(240, r.width), h: Math.max(280, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const legend = useMemo(
    () => (data && data.colourBy.find(c => c.key === colour)) || null,
    [data, colour]);

  const scale = useMemo(
    () => colourScale(legend ? legend.codes.map(c => c.code) : []),
    [legend]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !space) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const { minX, maxX, minY, maxY } = extentsFor(data.songs, space);
    const sx = (size.w - PAD * 2) / (maxX - minX);
    const sy = (size.h - PAD * 2) / (maxY - minY);

    for (const song of data.songs) {
      const c = song.coords[space];
      if (!c) continue;
      const x = PAD + (c[0] - minX) * sx;
      // Canvas y grows downward; flip so the plot reads like a chart.
      const y = size.h - PAD - (c[1] - minY) * sy;
      ctx.beginPath();
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = scale(song.codes[colour]);
      ctx.globalAlpha = 0.85;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [data, space, colour, scale, size]);

  if (loading) return <div className="explore-loading">Loading the map…</div>;
  if (error) {
    return (
      <div className="explore-error">
        <p>{error}</p>
        <button type="button" onClick={reload}>Try again</button>
      </div>
    );
  }

  return (
    <div className="explore-map">
      <div className="explore-toolbar">
        <span className="explore-toolbar-label">Space</span>
        <div className="explore-space-chips">
          {data.spaces.map(s => (
            <button
              key={s.key}
              type="button"
              className={`explore-chip ${s.key === space ? 'on' : ''}`}
              aria-pressed={s.key === space}
              onClick={() => setSpace(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="explore-colour-by">
          <span className="explore-toolbar-label">Colour by</span>
          <select value={colour || ''} onChange={(e) => setColour(e.target.value)}>
            {data.colourBy.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
      </div>

      <div className="explore-body">
        <div className="explore-plot" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Map of ${data.coverage.mapped} songs positioned by ${
              (data.spaces.find(s => s.key === space) || {}).label} similarity, coloured by ${
              (legend || {}).label}.`}
          />
        </div>
        <aside className="explore-rail">
          <div className="explore-rail-label">{(legend || {}).label}</div>
          <ul className="explore-legend">
            {legend && legend.codes.map(c => (
              <li key={c.code}>
                <span className="explore-swatch" style={{ background: scale(c.code) }} />
                {c.label} <span className="explore-legend-count">({c.count})</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <p className="explore-coverage">
        Showing {data.coverage.mapped} of {data.coverage.live} songs — only songs the
        analysis has mapped appear here.
      </p>
    </div>
  );
}

export default ExploreMap;
```

`dimColour` is imported but unused until Task 6 — **remove the import for now** to keep lint at 0 errors, and add it back in Task 6.

- [ ] **Step 5: Add the map styles**

Append to `frontend/src/styles/components.css`:

```css
.explore-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.explore-toolbar-label {
  font: var(--text-label);
  color: var(--text-secondary);
}

.explore-space-chips { display: flex; gap: var(--space-2); }

.explore-chip {
  border: 1px solid var(--border-subtle);
  background: none;
  color: var(--text-secondary);
  border-radius: 999px;
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
}

.explore-chip.on {
  background: var(--accent-moss);
  border-color: var(--accent-moss);
  color: var(--text-on-accent, #fff);
}

.explore-colour-by { display: flex; align-items: center; gap: var(--space-2); }

.explore-body { display: flex; gap: var(--space-4); align-items: stretch; }

.explore-plot {
  flex: 1;
  min-width: 0;
  min-height: 520px;
  position: relative;
}

.explore-rail {
  width: 232px;
  flex: none;
  padding-left: var(--space-3);
  border-left: 1px solid var(--border-subtle);
}

.explore-rail-label { font: var(--text-label); color: var(--text-secondary); }

.explore-legend { list-style: none; padding: 0; margin: var(--space-2) 0 0; }
.explore-legend li { display: flex; align-items: center; gap: var(--space-2); padding: 2px 0; }
.explore-legend-count { color: var(--text-secondary); }

.explore-swatch { width: 10px; height: 10px; border-radius: 50%; flex: none; }

.explore-coverage {
  margin-top: var(--space-3);
  color: var(--text-secondary);
  font-size: 0.9rem;
}

@media (max-width: 860px) {
  .explore-body { flex-direction: column; }
  .explore-rail { width: auto; border-left: 0; padding-left: 0; }
}
```

Check the token names against `frontend/src/styles/tokens/colors.css` before using them — if `--border-subtle` or `--accent-moss` differ, use the names that file actually defines.

- [ ] **Step 6: Verify**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors, build clean.

Then with the isolated backend (`PORT=5001 node server.js`) and Vite (`npm run dev -- --port 5199`), open `/explore`:
Expected: ~640 dots, four space chips that visibly re-layout the plot when clicked, a colour-by select that recolours the dots, a legend whose counts sum to 640, and the coverage line reading "Showing 640 of 1,333 songs".

**Check both themes.** If the site has no runtime theme toggle, verify the palette against the dark tokens as shipped, and confirm the categorical colours are distinguishable at 3px dot size — not just as large swatches.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/explore/ frontend/src/styles/components.css
git commit -F <scratchpad msg file>   # feat(explore): canvas scatter with per-space rescaling and a categorical palette
```

---

### Task 6: Interaction — hover, selection, spotlight, search, and URL state

**Files:**
- Create: `frontend/src/components/explore/SelectedSongCard.jsx`
- Modify: `frontend/src/components/explore/ExploreMap.jsx`
- Modify: `frontend/src/styles/components.css`

**Interfaces:**
- Consumes: `useExplorePoints`, `colourScale`, `dimColour` from Task 5.
- Produces: URL params `space`, `colour`, `codes` (comma-separated), `q`, `song`; `SelectedSongCard({ song, colourLabel, colourValue })`.

- [ ] **Step 1: Create the selected-song card**

Create `frontend/src/components/explore/SelectedSongCard.jsx`:

```jsx
import { Link } from 'react-router-dom';

// Docked in the rail rather than anchored to the point: a popover covers the dot's
// neighbours, which are exactly the songs being compared (spec §5.2).
function SelectedSongCard({ song, colourLabel, colourValue }) {
  if (!song) {
    return <p className="explore-hint">Click a song to see what it is.</p>;
  }
  return (
    <div className="explore-song-card">
      {song.art && <img className="explore-song-art" src={song.art} alt="" />}
      <div className="explore-song-title">{song.title}</div>
      <div className="explore-song-meta">
        {song.artist}{song.year ? ` · ${song.year}` : ''}
      </div>
      {colourValue && (
        <div className="explore-song-meta">{colourLabel}: {colourValue}</div>
      )}
      <Link className="explore-song-link" to={`/song/${song.id}`}>View song →</Link>
    </div>
  );
}

export default SelectedSongCard;
```

- [ ] **Step 2: Move map state into the URL**

In `ExploreMap.jsx`, replace the `useState` for `space`/`colour` and the defaulting effect with `useSearchParams`, matching the pattern `frontend/src/utils/browseUrlState.js` set for browse (URL is the source of truth; `replace` so the history isn't spammed):

```jsx
import { useSearchParams } from 'react-router-dom';
```

```jsx
  const [params, setParams] = useSearchParams();

  const space = params.get('space') || (data && data.spaces[0] && data.spaces[0].key) || null;
  const colour = params.get('colour')
    || (data && (data.colourBy.find(c => c.key === 'sonic_energy') || data.colourBy[0] || {}).key)
    || null;
  const query = params.get('q') || '';
  const selectedId = params.get('song') ? Number(params.get('song')) : null;
  const spotlit = useMemo(() => {
    const raw = params.get('codes');
    return new Set(raw ? raw.split(',').filter(Boolean) : []);
  }, [params]);

  // One writer for every param, so a change never clobbers its neighbours.
  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value == null || value === '') next.delete(key);
    else next.set(key, value);
    // Changing the colour dimension invalidates a spotlight expressed in its codes.
    if (key === 'colour') next.delete('codes');
    setParams(next, { replace: true });
  };
```

Delete the now-unused `setSpace` / `setColour` and the defaulting `useEffect`. Wire the toolbar to `setParam('space', s.key)` and `setParam('colour', e.target.value)`.

- [ ] **Step 3: Add the search box and derive matches**

Add above the return, after `legend`:

```jsx
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return null;   // null = "no query", distinct from "no matches"
    return data.songs.filter(s =>
      s.title.toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q));
  }, [data, query]);

  const matchIds = useMemo(
    () => (matches ? new Set(matches.map(s => s.id)) : null), [matches]);

  const selected = useMemo(
    () => (data && selectedId ? data.songs.find(s => s.id === selectedId) || null : null),
    [data, selectedId]);
```

Add the input to the toolbar, after the colour-by label:

```jsx
        <label className="explore-search">
          <span className="explore-toolbar-label">Find a song</span>
          <input
            type="search"
            value={query}
            placeholder="Title or artist…"
            onChange={(e) => setParam('q', e.target.value)}
          />
        </label>
```

And put the results under the rail's legend — this list is the keyboard and screen-reader route into the map, so each entry must be a real button (spec §5.5):

```jsx
          {matches && (
            <div className="explore-matches">
              <div className="explore-rail-label">
                {matches.length === 0 ? 'No songs match' : `${matches.length} match${matches.length === 1 ? '' : 'es'}`}
              </div>
              <ul>
                {matches.slice(0, 20).map(s => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setParam('song', String(s.id))}>
                      {s.title} <span className="explore-legend-count">{s.artist}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
```

- [ ] **Step 4: Make the legend a spotlight**

Replace each legend `<li>` body with a toggle button:

```jsx
              <li key={c.code}>
                <button
                  type="button"
                  className={`explore-legend-toggle ${spotlit.size && !spotlit.has(c.code) ? 'off' : ''}`}
                  aria-pressed={spotlit.has(c.code)}
                  onClick={() => {
                    const next = new Set(spotlit);
                    if (next.has(c.code)) next.delete(c.code); else next.add(c.code);
                    setParam('codes', [...next].join(','));
                  }}
                >
                  <span className="explore-swatch" style={{ background: scale(c.code) }} />
                  {c.label} <span className="explore-legend-count">({c.count})</span>
                </button>
              </li>
```

- [ ] **Step 5: Draw dimming, the selection ring, and add hit-testing**

In the draw effect, compute a per-song projected position array so the same numbers serve drawing and hit-testing. Replace the body of the drawing loop with a two-pass render — dimmed first, then lit, then the ring:

```jsx
  const positionsRef = useRef([]);
```

Inside the effect, after computing `sx`/`sy`:

```jsx
    const dim = dimColour();
    const positions = [];
    const lit = [];
    for (const song of data.songs) {
      const c = song.coords[space];
      if (!c) continue;
      const x = PAD + (c[0] - minX) * sx;
      const y = size.h - PAD - (c[1] - minY) * sy;
      positions.push({ id: song.id, x, y });
      const passesSpotlight = spotlit.size === 0 || spotlit.has(song.codes[colour]);
      const passesSearch = !matchIds || matchIds.has(song.id);
      if (passesSpotlight && passesSearch) lit.push({ song, x, y });
      else {
        ctx.beginPath();
        ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = dim;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 0.85;
    for (const p of lit) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = scale(p.song.codes[colour]);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    positionsRef.current = positions;

    if (selectedId) {
      const hit = positions.find(p => p.id === selectedId);
      if (hit) {
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, DOT_RADIUS + 4, 0, Math.PI * 2);
        ctx.strokeStyle = getComputedStyle(document.documentElement)
          .getPropertyValue('--text-primary').trim() || '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
```

Add `spotlit`, `matchIds` and `selectedId` to the effect's dependency array.

- [ ] **Step 6: Add hover and click**

Add hover state and handlers, and render the cursor-following card. It must be `pointer-events: none` — a card under the cursor eats its own hover:

```jsx
  const [hover, setHover] = useState(null);   // { song, x, y }

  const nearest = (mx, my) => {
    let best = null, bestD = 12 * 12;   // 12px grab radius, squared
    for (const p of positionsRef.current) {
      const dx = p.x - mx, dy = p.y - my;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  };

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const hit = nearest(mx, my);
    if (!hit) { setHover(null); return; }
    const song = data.songs.find(s => s.id === hit.id);
    setHover(song ? { song, x: hit.x, y: hit.y } : null);
  };

  const onClick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const hit = nearest(e.clientX - r.left, e.clientY - r.top);
    if (hit) setParam('song', String(hit.id));
  };
```

Put `onMouseMove={onMove}`, `onMouseLeave={() => setHover(null)}` and `onClick={onClick}` on the `<canvas>`, and render inside `.explore-plot`:

```jsx
          {hover && (
            <div
              className="explore-hovercard"
              style={{
                left: Math.min(hover.x + 14, size.w - 190),
                top: Math.max(hover.y - 10, 0),
              }}
            >
              <div className="explore-song-title">{hover.song.title}</div>
              <div className="explore-song-meta">
                {hover.song.artist}{hover.song.year ? ` · ${hover.song.year}` : ''}
              </div>
              {legend && (
                <div className="explore-song-meta">
                  {legend.label}: {
                    (legend.codes.find(c => c.code === hover.song.codes[colour]) || {}).label
                  }
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 7: Mount the selected card**

Import it and render it in the rail beneath the legend:

```jsx
import SelectedSongCard from './SelectedSongCard';
```

```jsx
          <div className="explore-rail-label">Selected</div>
          <SelectedSongCard
            song={selected}
            colourLabel={(legend || {}).label}
            colourValue={selected && legend
              ? (legend.codes.find(c => c.code === selected.codes[colour]) || {}).label
              : null}
          />
```

A `?song=` naming a song that isn't on the map (unmapped, unpublished, or a stale link) leaves `selected` as `null`, so the hint shows and nothing errors — that is the intended behaviour, not a bug to guard.

- [ ] **Step 8: Add the interaction styles**

Append to `frontend/src/styles/components.css`:

```css
.explore-search { display: flex; align-items: center; gap: var(--space-2); }

.explore-legend-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  background: none;
  border: 0;
  padding: 2px 0;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.explore-legend-toggle.off { opacity: 0.45; }

.explore-hovercard {
  position: absolute;
  pointer-events: none;
  width: 180px;
  padding: var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.28);
  font-size: 0.85rem;
}

.explore-song-card { margin-top: var(--space-2); }
.explore-song-art { width: 100%; border-radius: var(--radius-md); display: block; }
.explore-song-title { font-weight: 600; }
.explore-song-meta { color: var(--text-secondary); font-size: 0.85rem; }
.explore-song-link { display: inline-block; margin-top: var(--space-2); color: var(--accent-ember); }
.explore-hint { color: var(--text-secondary); font-size: 0.85rem; }

.explore-matches ul { list-style: none; padding: 0; margin: var(--space-2) 0 0; }
.explore-matches button {
  background: none; border: 0; padding: 2px 0; color: inherit;
  text-align: left; cursor: pointer; width: 100%;
}
```

- [ ] **Step 9: Verify**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors, build clean.

Then in the browser at `:5199`, confirm each of these:
1. Hovering a dot shows the card; it follows the cursor and never sits under it.
2. Clicking a dot rings it and fills the rail card; **the page does not navigate**.
3. "View song →" navigates; the browser Back button returns to the same map — same space, colour, spotlight, and selected song.
4. Clicking two legend entries dims everything else; clicking them again restores.
5. Typing in the search box dims non-matches and lists matches; clicking a match selects that point.
6. Changing colour-by clears the spotlight and relabels the hover card's third line.
7. Copying the URL into a new tab reproduces the same view.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/explore/ frontend/src/styles/components.css
git commit -F <scratchpad msg file>   # feat(explore): hover, selection, legend spotlight, search and URL state
```

---

### Task 7: Map-half checkpoint

**Files:** none — this is a verification gate.

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test`
Expected: 156/156 (151 baseline + 5 new).

- [ ] **Step 2: Frontend gates**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors; build clean.

- [ ] **Step 3: Report to the curator**

The map half is independently shippable. Report: the coverage numbers observed live, the payload size, whether the palette reads at dot size in both themes, and anything the seven manual checks turned up. **Stop here for curator review before starting Task 8** — the recommendations half touches the song page, which is the most-visited screen on the site.

---

### Task 8: Similarity — the registry and the message metric

**Files:**
- Modify: `backend/services/explore.js`
- Modify: `backend/test/explore.test.js`

**Interfaces:**
- Produces:
  - `SIMILARITY: Array<{key, label, column, dims, metric}>`
  - `similarByEmbedding(db, songId, entry, limit): Promise<Array<song>>` where each song is `{id, title, artists, album_images, album_name}` — the same shape the existing `.similar-song-card` markup consumes.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/explore.test.js` (above the `after` hook):

```js
async function addLyricEmbedding(songId, vec) {
  await pool.query(
    `INSERT INTO song_embeddings (song_id, lyric_embedding, updated_at)
     VALUES ($1, $2::float8[], now())
     ON CONFLICT (song_id) DO UPDATE SET lyric_embedding = EXCLUDED.lyric_embedding`,
    [songId, vec]);
}

test('message similarity ranks by cosine and respects the publish filter', async () => {
  const target = await mkSong('ZZZEXP Target');
  const near = await mkSong('ZZZEXP Near');
  const far = await mkSong('ZZZEXP Far');
  const hidden = await mkSong('ZZZEXP Hidden', { published: false });

  // 3-dim vectors: `near` points almost the same way as the target, `far` is orthogonal.
  await addLyricEmbedding(target, [1, 0, 0]);
  await addLyricEmbedding(near, [0.98, 0.2, 0]);
  await addLyricEmbedding(far, [0, 1, 0]);
  await addLyricEmbedding(hidden, [1, 0, 0]);   // a perfect match, but unpublished

  const entry = explore.SIMILARITY.find(s => s.key === 'message');
  const rows = await explore.similarByEmbedding(pool, target, entry, 10);
  const ids = rows.map(r => r.id);

  assert.ok(!ids.includes(target), 'the song itself is excluded');
  assert.ok(!ids.includes(hidden), 'unpublished songs are excluded');
  assert.ok(ids.indexOf(near) < ids.indexOf(far), 'nearer song ranks first');
});
```

Note: the fixtures use 3-dim vectors while the live catalogue is 768-dim. That is deliberate and safe — the query matches candidates on **the target's own dimensionality**, so the fixture set and the live set never mix.

Add the embeddings table to the `after` cleanup, before the songs delete:

```js
    await pool.query('DELETE FROM song_embeddings WHERE song_id = ANY($1::int[])', [made.songs]);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx node --test test/explore.test.js`
Expected: FAIL — `explore.SIMILARITY is undefined`.

- [ ] **Step 3: Implement the registry and the cosine query**

Add to `backend/services/explore.js`, before `module.exports`:

```js
// Similarity metrics are a REGISTRY, not discovery. Coordinates are interchangeable — every
// one is an (x, y) to plot — but each embedding needs a metric and a normalisation
// judgement that code must not guess. Adding a third tab is one entry plus a test.
const SIMILARITY = [
  { key: 'message', label: 'Similar message', column: 'lyric_embedding',
    dims: null, metric: 'cosine' },
  { key: 'sound', label: 'Similar sound', column: 'audio_embedding',
    dims: 6, metric: 'zeuclidean' },
];

// The card fields the song page already renders. LEFT JOIN albums: non-Spotify songs have
// no album row.
const SIMILAR_SELECT = `
  s.id, s.title, s.spotify_url,
  al.name AS album_name, al.images AS album_images,
  (SELECT ARRAY_AGG(a.name ORDER BY sa.id)
     FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
    WHERE sa.song_id = s.id) AS artists`;

async function similarByEmbedding(db, songId, entry, limit = 6) {
  if (!entry) return [];
  const sql = entry.metric === 'cosine' ? cosineSql(entry) : zEuclideanSql(entry);
  const r = await db.query(sql, [songId, limit]);
  return r.rows;
}

// Cosine over the full embedding. Candidates are matched on the TARGET's dimensionality, so
// a mixed-width column can never compare vectors of different lengths.
function cosineSql(entry) {
  return `
    WITH target AS (
      SELECT ${entry.column} AS v FROM song_embeddings WHERE song_id = $1
    ),
    t AS (
      SELECT u.ord, u.val FROM target, unnest(target.v) WITH ORDINALITY AS u(val, ord)
    ),
    cand AS (
      SELECT se.song_id, u.ord, u.val
        FROM song_embeddings se
        JOIN songs s2 ON s2.id = se.song_id
        CROSS JOIN LATERAL unnest(se.${entry.column}) WITH ORDINALITY AS u(val, ord)
       WHERE se.song_id <> $1
         AND s2.status = 'included' AND s2.published = true
         AND array_length(se.${entry.column}, 1)
             = (SELECT array_length(v, 1) FROM target)
    ),
    sim AS (
      SELECT c.song_id,
             SUM(c.val * t.val)
               / NULLIF(sqrt(SUM(c.val * c.val)) * sqrt(SUM(t.val * t.val)), 0) AS score
        FROM cand c JOIN t ON t.ord = c.ord
       GROUP BY c.song_id
    )
    SELECT ${SIMILAR_SELECT}
      FROM sim
      JOIN songs s ON s.id = sim.song_id
      LEFT JOIN albums al ON al.id = s.album_id
     WHERE sim.score IS NOT NULL
     ORDER BY sim.score DESC, s.id
     LIMIT $2`;
}
```

Add a temporary stub so the module loads (the real one lands in Task 9):

```js
function zEuclideanSql() { throw new Error('not implemented until Task 9'); }
```

Update the exports line to add `SIMILARITY, similarByEmbedding`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx node --test test/explore.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Measure the query against live data — this is a decision point**

From the scratchpad, with absolute requires, time the message query on a real song that has a 768-dim embedding:

```js
// <scratchpad>/measure.js
const pool = require('C:/Users/Owner/Documents/AI Applications/vegan-playlist/backend/database/db');
const explore = require('C:/Users/Owner/Documents/AI Applications/vegan-playlist/backend/services/explore');
(async () => {
  const { rows } = await pool.query(
    `SELECT se.song_id FROM song_embeddings se JOIN songs s ON s.id = se.song_id
      WHERE s.status='included' AND s.published=true
        AND array_length(se.lyric_embedding,1) = 768 LIMIT 1`);
  const entry = explore.SIMILARITY.find(s => s.key === 'message');
  for (let i = 0; i < 5; i++) {
    const t = Date.now();
    await explore.similarByEmbedding(pool, rows[0].song_id, entry, 6);
    console.log(`run ${i + 1}: ${Date.now() - t}ms`);
  }
  await pool.end();
})();
```

Run: `node <scratchpad>/measure.js`

**Record the median in the plan's completion notes and in `PROJECT_STATE.md`.**
- Under **500ms**: proceed. This is one query on one page load.
- **500ms or more**: **STOP and report to the curator.** Do not silently build a cache — the spec ruled that out as speculative, and the fix (a process-level cache keyed on `MAX(updated_at)` of `song_embeddings`) is a decision for them, not a default.

- [ ] **Step 6: Commit**

```bash
git add backend/services/explore.js backend/test/explore.test.js
git commit -F <scratchpad msg file>   # feat(explore): similarity registry + full-dimensional cosine over lyric_embedding
```

---

### Task 9: The sound metric — z-scored Euclidean over the 6-dim audio embedding

**Files:**
- Modify: `backend/services/explore.js`
- Modify: `backend/test/explore.test.js`

**Interfaces:**
- Consumes: `SIMILARITY`, `similarByEmbedding` from Task 8.
- Produces: a working `zEuclideanSql(entry)` (private).

- [ ] **Step 1: Write the failing test**

Append to `backend/test/explore.test.js` (above the `after` hook):

```js
async function addAudioEmbedding(songId, vec) {
  await pool.query(
    `INSERT INTO song_embeddings (song_id, audio_embedding, updated_at)
     VALUES ($1, $2::float8[], now())
     ON CONFLICT (song_id) DO UPDATE SET audio_embedding = EXCLUDED.audio_embedding`,
    [songId, vec]);
}

test('sound similarity standardises dimensions and ignores 1024-dim rows', async () => {
  const target = await mkSong('ZZZEXP Sound target');
  const nearOnSmallSd = await mkSong('ZZZEXP Sound near');
  const nearOnBigSd = await mkSong('ZZZEXP Sound far');
  const oldShape = await mkSong('ZZZEXP Sound legacy');

  // Dimension 4 (acousticness) has a tiny spread live; dimension 3 (danceability) a huge
  // one. Raw Euclidean would call the big-sd song "closer"; z-scoring must not.
  await addAudioEmbedding(target,          [0.2, 1.0, 1.30, 0.030, 0.11, 0.5]);
  await addAudioEmbedding(nearOnSmallSd,   [0.2, 1.0, 1.30, 0.031, 0.11, 0.5]);
  await addAudioEmbedding(nearOnBigSd,     [0.2, 1.0, 1.55, 0.030, 0.11, 0.5]);
  await addAudioEmbedding(oldShape, new Array(1024).fill(0.2));

  const entry = explore.SIMILARITY.find(s => s.key === 'sound');
  const rows = await explore.similarByEmbedding(pool, target, entry, 50);
  const ids = rows.map(r => r.id);

  assert.ok(!ids.includes(oldShape), '1024-dim rows never enter the distance');
  assert.ok(!ids.includes(target), 'the song itself is excluded');
  assert.ok(ids.includes(nearOnSmallSd) && ids.includes(nearOnBigSd), 'both 6-dim songs rank');
});

test('every audio_embedding query constrains the array length', () => {
  const entry = explore.SIMILARITY.find(s => s.key === 'sound');
  assert.equal(entry.dims, 6, 'the registry records the expected width');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx node --test test/explore.test.js`
Expected: FAIL — `not implemented until Task 9`.

- [ ] **Step 3: Implement the metric**

Replace the `zEuclideanSql` stub in `backend/services/explore.js`:

```js
// Euclidean distance AFTER per-dimension z-scoring over the live set. Without this the
// result is a danceability ranking wearing a disguise: danceability's sd is 0.67 where
// acousticness's is 0.02, a 30x spread (these are Librosa proxies, not Spotify's 0-1
// features). The array_length constraint is not optional — the column still holds 1,041
// rows of the old 1024-dim vectors.
function zEuclideanSql(entry) {
  return `
    WITH live AS (
      SELECT se.song_id, se.${entry.column} AS v
        FROM song_embeddings se
        JOIN songs s2 ON s2.id = se.song_id
       WHERE s2.status = 'included' AND s2.published = true
         AND array_length(se.${entry.column}, 1) = ${entry.dims}
    ),
    stats AS (
      SELECT u.ord, avg(u.val) AS mu, stddev_pop(u.val) AS sd
        FROM live, unnest(live.v) WITH ORDINALITY AS u(val, ord)
       GROUP BY u.ord
    ),
    z AS (
      SELECT l.song_id, u.ord,
             (u.val - st.mu) / NULLIF(st.sd, 0) AS zv
        FROM live l
        CROSS JOIN LATERAL unnest(l.v) WITH ORDINALITY AS u(val, ord)
        JOIN stats st ON st.ord = u.ord
    ),
    tgt AS (SELECT ord, zv FROM z WHERE song_id = $1),
    d AS (
      SELECT z.song_id,
             sqrt(SUM(power(COALESCE(z.zv, 0) - COALESCE(tgt.zv, 0), 2))) AS dist
        FROM z JOIN tgt ON tgt.ord = z.ord
       WHERE z.song_id <> $1
       GROUP BY z.song_id
    )
    SELECT ${SIMILAR_SELECT}
      FROM d
      JOIN songs s ON s.id = d.song_id
      LEFT JOIN albums al ON al.id = s.album_id
     ORDER BY d.dist ASC, s.id
     LIMIT $2`;
}
```

`NULLIF(st.sd, 0)` guards a constant dimension; `COALESCE(..., 0)` then treats it as contributing nothing to the distance rather than propagating NULL through the sum.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx node --test test/explore.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/services/explore.js backend/test/explore.test.js
git commit -F <scratchpad msg file>   # feat(explore): z-scored Euclidean sound similarity over the 6-dim audio embedding
```

---

### Task 10: Assemble the tabs, the genre fallback, and the endpoint

**Files:**
- Modify: `backend/services/explore.js`
- Modify: `backend/test/explore.test.js`
- Modify: `backend/routes/analysis.js`
- Modify: `backend/routes/spotify.js` (delete the old route)

**Interfaces:**
- Produces:
  - `genreFallback(db, songId, limit): Promise<Array<song>>`
  - `similarFor(db, songId, limit): Promise<{tabs, fallback}>`
  - `GET /api/analysis/songs/:id/similar`

- [ ] **Step 1: Write the failing test**

Append to `backend/test/explore.test.js` (above the `after` hook):

```js
test('similarFor omits a tab with no embedding and falls back to genre when both are missing', async () => {
  // A song with neither embedding, sharing a genre with two others.
  const lonely = await mkSong('ZZZEXP Lonely');
  const mate1 = await mkSong('ZZZEXP Mate one');
  const mate2 = await mkSong('ZZZEXP Mate two');
  await pool.query(`UPDATE songs SET genre = 'zzzexp-genre' WHERE id = ANY($1::int[])`,
    [[lonely, mate1, mate2]]);

  const none = await explore.similarFor(pool, lonely, 6);
  assert.deepEqual(none.tabs, [], 'no embeddings means no tabs');
  assert.ok(none.fallback, 'the genre fallback fires');
  assert.equal(none.fallback.label, 'More in this genre');
  const fallbackIds = none.fallback.songs.map(s => s.id);
  assert.ok(fallbackIds.includes(mate1) && fallbackIds.includes(mate2));
  assert.ok(!fallbackIds.includes(lonely), 'the song itself is excluded');

  // A song with only a lyric embedding gets one tab and no fallback.
  const messageOnly = await mkSong('ZZZEXP Message only');
  await addLyricEmbedding(messageOnly, [1, 0, 0]);
  const one = await explore.similarFor(pool, messageOnly, 6);
  assert.deepEqual(one.tabs.map(t => t.key), ['message']);
  assert.equal(one.fallback, null, 'no fallback when at least one tab exists');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx node --test test/explore.test.js`
Expected: FAIL — `explore.similarFor is not a function`.

- [ ] **Step 3: Implement the fallback and the assembler**

Add to `backend/services/explore.js`, before `module.exports`:

```js
// The honest fallback for the 693 of 1,333 live songs (52%) with no embeddings. This is the
// old /songs/:id/similar query with its dead audio-feature clause removed (songs.energy is
// NULL catalogue-wide, so that half never matched) and its RANDOM() removed. It uses the
// EFFECTIVE genre — the artist's genre when the song has none — the same expression browse
// uses, which is why its coverage is ~1,003 songs rather than 492.
async function genreFallback(db, songId, limit = 6) {
  const r = await db.query(
    `WITH cs AS (
       SELECT ${genres.EFFECTIVE_GENRE_EXPR} AS g
         FROM songs s ${genres.EFFECTIVE_GENRE_JOIN}
        WHERE s.id = $1
     )
     SELECT ${SIMILAR_SELECT}
       FROM songs s
       ${genres.EFFECTIVE_GENRE_JOIN}
       LEFT JOIN albums al ON al.id = s.album_id
       CROSS JOIN cs
      WHERE s.id <> $1
        AND s.status = 'included' AND s.published = true
        AND cs.g IS NOT NULL
        AND ${genres.EFFECTIVE_GENRE_EXPR} = cs.g
      ORDER BY s.popularity DESC NULLS LAST, s.id
      LIMIT $2`, [songId, limit]);
  return r.rows;
}

// Both tabs and the fallback in one response, so switching tabs needs no request. A tab is
// omitted when its embedding is missing; the fallback fires only when no tab has anything.
async function similarFor(db, songId, limit = 6) {
  const tabs = [];
  for (const entry of SIMILARITY) {
    const songs = await similarByEmbedding(db, songId, entry, limit);
    if (songs.length > 0) tabs.push({ key: entry.key, label: entry.label, songs });
  }
  if (tabs.length > 0) return { tabs, fallback: null };
  const songs = await genreFallback(db, songId, limit);
  return {
    tabs: [],
    fallback: songs.length ? { label: 'More in this genre', songs } : null,
  };
}
```

Update the exports line to add `genreFallback, similarFor`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx node --test test/explore.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the route**

In `backend/routes/analysis.js`, after `/explore/points` and still **above** the `/song/:id` route:

```js
// Two tabs (message / sound) plus the genre fallback, in one response.
router.get('/songs/:id/similar', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad song id' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 6, 24);
    res.json(await explore.similarFor(pool, id, limit));
  } catch (e) {
    console.error('similar songs error:', e);
    res.status(500).json({ error: 'Failed to load similar songs' });
  }
});
```

The `Number.isFinite` guard is deliberate — the acoustic session's one real defect was a `NaN` reaching an `integer` column and 500ing the endpoint.

- [ ] **Step 6: Delete the old route**

In `backend/routes/spotify.js`, delete the whole `router.get('/songs/:id/similar', …)` handler (the one whose comment reads "Simple approach: get songs with similar genre or audio features"). Nothing else in the backend references it.

Verify nothing else calls it:

Run: `cd backend && grep -rn "songs/:id/similar" routes/ services/`
Expected: only the new route in `routes/analysis.js`.

- [ ] **Step 7: Run the full suite**

Run: `cd backend && npm test`
Expected: all pass — 151 baseline + 9 new = 160.

- [ ] **Step 8: Commit**

```bash
git add backend/services/explore.js backend/test/explore.test.js backend/routes/analysis.js backend/routes/spotify.js
git commit -F <scratchpad msg file>   # feat(explore): similar-songs endpoint with two tabs and a genre fallback
```

---

### Task 11: The song page's "You might also like"

**Files:**
- Create: `frontend/src/components/SimilarSongs.jsx`
- Modify: `frontend/src/pages/SongDetailPage.jsx`
- Modify: `frontend/src/api/spotifyService.js`
- Modify: `frontend/src/styles/components.css`

**Interfaces:**
- Consumes: `GET /api/analysis/songs/:id/similar` from Task 10.
- Produces: `SimilarSongs({ songId })`.

- [ ] **Step 1: Replace the service call**

In `frontend/src/api/spotifyService.js`, replace the whole `getSimilarSongs` method with:

```js
  // Two embedding tabs plus the genre fallback. Relative URL (Vite proxy) — the analysis
  // API is not on the spotify base.
  getSimilarSongs: async (songId, limit = 6) => {
    const response = await fetch(`/api/analysis/songs/${songId}/similar?limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch similar songs');
    return await response.json();
  },
```

- [ ] **Step 2: Build the component**

Create `frontend/src/components/SimilarSongs.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { spotifyService } from '../api/spotifyService';

function SongGrid({ songs }) {
  const navigate = useNavigate();
  return (
    <div className="similar-songs-grid">
      {songs.map((song) => (
        <div
          key={song.id}
          className="similar-song-card"
          role="button"
          tabIndex={0}
          aria-label={`Open song ${song.title}`}
          onClick={() => navigate(`/song/${song.id}`)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              navigate(`/song/${song.id}`);
            }
          }}
        >
          <div className="similar-artwork">
            {song.album_images?.[0]?.url && <img src={song.album_images[0].url} alt="" />}
          </div>
          <div className="similar-info">
            <h3 className="similar-title">{song.title}</h3>
            <p className="similar-artist">
              {Array.isArray(song.artists) ? song.artists.join(', ') : song.artists}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// Two tabs when the song has embeddings; the honest genre panel when it has none. A failed
// request omits the section rather than showing a broken panel.
function SimilarSongs({ songId }) {
  const [data, setData] = useState(null);
  const [active, setActive] = useState(null);

  useEffect(() => {
    let cancelled = false;
    spotifyService.getSimilarSongs(songId, 6)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setActive(d.tabs?.[0]?.key || null);
      })
      .catch((err) => {
        console.warn('Could not load similar songs:', err);
        if (!cancelled) setData(null);
      });
    return () => { cancelled = true; };
  }, [songId]);

  if (!data) return null;

  const tabs = data.tabs || [];
  const current = tabs.find((t) => t.key === active) || tabs[0] || null;

  if (tabs.length === 0) {
    if (!data.fallback) return null;
    return (
      <section className="detail-section">
        <h2>You might also like</h2>
        <p className="similar-note">{data.fallback.label}</p>
        <SongGrid songs={data.fallback.songs} />
      </section>
    );
  }

  return (
    <section className="detail-section">
      <h2>You might also like</h2>
      <div className="similar-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === current.key}
            className={`similar-tab ${t.key === current.key ? 'active' : ''}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <SongGrid songs={current.songs} />
    </section>
  );
}

export default SimilarSongs;
```

- [ ] **Step 3: Wire it into the song page**

In `frontend/src/pages/SongDetailPage.jsx`:

1. Add the import: `import SimilarSongs from '../components/SimilarSongs';`
2. Delete the `similarSongs` state (line 11), the `spotifyService.getSimilarSongs(...)` entry from the `Promise.all` (lines 23–26), the destructured `similarData`, and the `setSimilarSongs(...)` line (37).
3. Replace the whole `{similarSongs.length > 0 && ( … )}` block (lines 226–266) with:

```jsx
      <SimilarSongs songId={songId} />
```

- [ ] **Step 4: Add the tab styles**

Append to `frontend/src/styles/components.css`:

```css
.similar-tabs {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.similar-tab {
  border: 1px solid var(--border-subtle);
  background: none;
  color: var(--text-secondary);
  border-radius: 999px;
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
}

.similar-tab.active {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.similar-note {
  color: var(--text-secondary);
  margin-bottom: var(--space-3);
}
```

- [ ] **Step 5: Verify**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors, build clean.

In the browser at `:5199`, check all three coverage cases — find the ids from the DB first:
- a song with both embeddings → two tabs, 6 cards each, tabs switch without a network request;
- a song with only one → exactly one tab, no fallback;
- a song with neither → no tabs, the "More in this genre" line and its grid.

Confirm a card click navigates and the cards look identical to before (the markup is unchanged).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/SimilarSongs.jsx frontend/src/pages/SongDetailPage.jsx frontend/src/api/spotifyService.js frontend/src/styles/components.css
git commit -F <scratchpad msg file>   # feat(explore): embedding-based You might also like with a genre fallback
```

---

### Task 12: Cleanup, docs, and final verification

**Files:**
- Delete: `frontend/public/vector_space.json`
- Modify: `CLAUDE.md`, `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `docs/PRD.md`

- [ ] **Step 1: Delete the superseded static file**

```bash
git rm frontend/public/vector_space.json
```

It has been uncommitted-modified in the working tree for several sessions as "B4 input". It is superseded by `song_coordinates`, and it was a real publication-staging leak: of its 664 songs, 22 were `included`-but-unpublished and 2 were `pending`, served as a static asset that bypassed the filter every API route enforces.

Verify nothing references it:

Run: `grep -rn "vector_space" frontend/src backend --include=*.js --include=*.jsx`
Expected: no matches.

- [ ] **Step 2: Update `CLAUDE.md`**

- Backend structure: add `services/explore.js` beside `services/analysis.js`, describing it as the read-only consumer of `song_coordinates` / `song_embeddings`, with the `array_length(audio_embedding,1)=6` rule and the "registry, not discovery" note for metrics.
- Frontend structure: add `pages/ExplorePage.jsx` and `components/explore/`; update the component count; note that `/dashboard` now redirects to `/explore/data`.
- Database schema: note that `song_coordinates` is now read through `/api/analysis/explore/points` and that `frontend/public/vector_space.json` is gone.

- [ ] **Step 3: Update `docs/PROJECT_STATE.md`**

- Advance the current session; refresh Next Tasks (**triage 6 — the About analysis-explainer + AI-disclosure page** is next).
- Add a Decision Log entry dated 2026-07-27 recording what was built, the measured cosine timing from Task 8 Step 5, and the palette chosen.
- Append a Changelog entry.
- Remove the stale note about the uncommitted `vector_space.json` — it no longer exists.

- [ ] **Step 4: Update `docs/PROJECT_PLAN.md` and `docs/PRD.md`**

- Mark B4 ☑ in the plan; note that 3D is a deliberate follow-up, not an omission.
- Add the Explore page and the two similarity tabs to the PRD's §11 as-built feature inventory.

- [ ] **Step 5: Full verification**

Run: `cd backend && npm test`
Expected: 160/160.

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors; build clean.

Run the isolated live smoke one more time end to end: `/explore` map, both tabs, a song page with two similarity tabs, a song page with the genre fallback, `/dashboard` redirecting. Kill both servers **by PID**.

- [ ] **Step 6: Commit and hand over for curator smoke**

```bash
git add -A
git commit -F <scratchpad msg file>   # docs: record the B4 Explore map session
git push -u origin session-B4-explore-map
```

**Do not merge.** Every session since triage 1 has been held for the curator's own smoke test before merging to `main`.

---

## Notes for the implementer

- **The single most likely defect in this build** is a 1024-dim `audio_embedding` row reaching a distance query. Task 9's test fails if the constraint is dropped; keep it.
- **The second most likely** is the sound tab silently becoming a danceability ranking. Task 9's fixtures are built so that a missing z-score changes the ranking.
- If a step's code doesn't match what you find in the file, **stop and report** rather than adapting — line numbers here were read on 2026-07-27 and the curator may have changed things.
- Token names (`--border-subtle`, `--accent-moss`, `--accent-ember`, `--radius-md`, `--space-*`) are used from memory of the design system. **Check `frontend/src/styles/tokens/` before using each one**, and match whatever the browse page already uses rather than inventing names.
