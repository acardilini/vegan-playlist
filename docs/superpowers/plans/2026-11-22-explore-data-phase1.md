# Explore > Data, Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the Chart.js dashboard with a tabbed Data area whose first tab (Over time) reads one read-only `GET /api/analytics/dataset` payload, with a shared filter bar and URL state; retire the old dashboard, its five routes and Chart.js.

**Architecture:** `backend/services/dataset.js` builds `{songs, labels, coverage}` from live songs (one SQL read, short in-process cache); a thin route serves it. The frontend fetches it once (`useDataset`), and pure tested modules (`dataUrlState.js`, `dataModel.js`) do all filtering/aggregation; hand-rolled SVG charts present it. Same pattern as `explore.mapPayload` + `components/explore/`.

**Tech Stack:** Node/Express/pg, `node:test`, React 19 + Vite, hand-rolled SVG, design tokens only.

**Spec:** `docs/superpowers/specs/2026-11-22-explore-data-redesign-design.md`

## Global Constraints

- Live songs only: `s.status = 'included' AND s.published = true`.
- Lyric fields only through `analysis.LATEST_ANALYSIS`; sound fields only through `audioAnalysis.LATEST_AUDIO` (OK rows). Scalar codes gated with `metadataCodebook.cleanSelection` (drops suppressed/invented/legacy codes).
- Genre is ONE field `g` = `getParentGenre(EFFECTIVE_GENRE_SUBQUERY)` else `getParentGenre(sau.inferred_parent_genre)`; no provenance anywhere in payload or UI copy.
- Dataset service/route must not mention `song_lyrics`, `translation`, `song_audio_transcripts`, `audio_samples`; no frontend/backend file may reintroduce retired audio names (`legacyAudio.test.js`).
- No `localhost:5000` URLs; relative `/api/...`. Tokens only (`--bg-*`, `--text-*`, `--accent-*`, `--explore-cat-1..7`, `--explore-not-coded`, `--tl-grit`, `--tl-pulse`); max 6 hues + grey Other. No emojis.
- Thresholds as named constants: `MIN_GROUP_FOR_SENTENCE = 30`, `MIN_POINT_N = 10`.
- Year bounds come from the data. Every chart states its denominator and has a table view.
- Explicit `git add` paths; commit with `git commit -F <scratchpad file>`; end messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Songs with no album/year are excluded from time charts but counted in KPIs (denominator stated).
- A song whose latest tone is a legacy/ERROR code must not appear as a tone (cleanSelection gate).
- Unmetered tempo is null, not 0 (excluded from medians).
- A stale/invalid URL param falls back to defaults rather than an empty chart.
- Decade points with n < 10 are not plotted; table view still lists them with n.

---

### Task 1: Dataset service and route

**Files:**
- Create: `backend/services/dataset.js`, `backend/test/dataset.test.js`
- Modify: `backend/routes/analytics.js` (replace whole file), `backend/test/lyrics_privacy.test.js` (add dataset guard)

**Interfaces:**
- Produces: `buildDataset(db) -> Promise<{songs, labels, coverage}>`; `songs[i] = {id, t, a, y, g, ha, hl, tone, bpm, lufs}` (`a` = artists joined with ", "; `tone` = cleaned lyrical_tone code or null; `bpm` null when tempo_stability is `UNMETERED`); `labels = {genres: {code: label}, tone: {code: label}}` (tone labels only for codes present); `coverage = {live, dated, genre, audio, lyric}`; `getDataset(db)` = `buildDataset` cached 60 s; `_clearCache()`.
- Route: `GET /api/analytics/dataset` -> `getDataset(pool)` JSON, 500 `{error}` on failure. All five old routes deleted.

- [ ] **Step 1: Write failing tests** in `dataset.test.js` (sentinel `ZZZDSET`): seed with `songs`/`artists`/`song_artists`/`albums`/`song_audio_analysis`/`song_lyric_analysis` rows: (a) a published song with own genre `Hardcore Punk` -> `g === 'punk'`... (use `getParentGenre('hardcore punk')`), (b) a song with no genre but an OK audio row `inferred_parent_genre='metal'` -> `g === 'metal'`, (c) an unpublished song is absent, (d) a song with `lyrical_tone='ERROR'` -> `tone === null`, valid code stays, (e) `tempo_stability='UNMETERED'` -> `bpm === null`, (f) coverage counts agree with songs array (`live === songs.length`, `genre === songs.filter(s=>s.g).length`), (g) JSON of the payload contains none of `inferred`, `lyrics`, `transcript`, `samples`, (h) `getDataset` returns the same object twice until `_clearCache()`.
- [ ] **Step 2: Run** `cd backend && node --test test/dataset.test.js`. Expected: FAIL, cannot find `../services/dataset`.
- [ ] **Step 3: Implement** `dataset.js` per Interfaces: a single query over live songs (pattern of `explore.mapRows`: `LEFT JOIN albums`, `EFFECTIVE_GENRE_SUBQUERY`, `LEFT JOIN LATEST_ANALYSIS sla`, `LEFT JOIN LATEST_AUDIO sau`, artists via `ARRAY_AGG` scalar subquery); map rows in JS with `getParentGenre` and `codebook.cleanSelection('lyrical_tone', …)`. `labels.genres` title-cases each present parent; `labels.tone` from `codebook.codeLabel`.
- [ ] **Step 4: Replace `routes/analytics.js`** with the single route; add to `lyrics_privacy.test.js` a test that `services/dataset.js` and `routes/analytics.js` contain none of `song_lyrics`, `translation`, `song_audio_transcripts`, `audio_samples`.
- [ ] **Step 5: Run** `node --test test/dataset.test.js test/lyrics_privacy.test.js test/legacyAudio.test.js test/leads.test.js`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(data): dataset service and /api/analytics/dataset; drop the five old analytics routes`.

### Task 2: Pure URL-state and model modules

**Files:**
- Create: `frontend/src/utils/dataUrlState.js`, `frontend/src/utils/dataUrlState.test.js`, `frontend/src/components/explore/data/dataModel.js`, `frontend/src/components/explore/data/dataModel.test.js`

**Interfaces (produces):**
- `dataUrlState`: `ERA_MODES = ['count','share']`, `ERA_BUCKETS = ['5y','1y']`; `deriveDataState(params, bounds) -> {pg: string|'', yf, yt, eraMode, eraBucket}` (`pg` free string; `yf/yt` ints clamped inside `bounds {min,max}` and ordered, default = bounds; invalid mode/bucket -> `'count'`/`'5y'`); `formatDataState(state, bounds) -> URLSearchParams` omitting defaults (`pg` empty, `yf/yt` at bounds, defaults of mode/bucket) with params `pg`, `yf`, `yt`, `era_m`, `era_b`; `browseHref(state, bounds) -> string` (`/browse?` + `parent_genres=<pg>` and `year_from`/`year_to` when not at bounds; no count).
- `dataModel`: constants `MIN_GROUP_FOR_SENTENCE`, `MIN_POINT_N`, `TOP_GENRES = 6`; `yearBounds(songs) -> {min,max}|null`; `filterSongs(songs, {pg, yf, yt})` (songs with `y == null` pass only when the year window is at bounds is NOT required: they are excluded whenever the window is narrower than bounds; pass `bounds` as third arg); `computeKpis(songs) -> {songs, withGenre, audio, lyric}`; `genreRanking(songs) -> [{g,n}]` desc; `buildEraSeries(songs, {bucket, mode, top}) -> {eras:[{start,label,total}], series:[{key,values:[n|share]}], other:boolean}` (top N genres by overall count get own series, rest folded to key `other`; songs with no `y` or no `g` skipped; share = n/total per era); `buildToneByDecade(songs, minN) -> {decades:[{decade,n}], tones:[{key,values:[share|null]}]}` (lyric-coded with tone and year only; a decade under `minN` has null values; top 5 tones plus `other`); `buildSonicByDecade(songs, minN) -> [{decade,n,bpm,lufs}]` medians, decades under `minN` dropped from the array result's plotted flag (`plot:false`); `eraInsight(series...)`: `topGenreByDecadeSentence(songs, decade, labels) -> string|null` only when decade n >= `MIN_GROUP_FOR_SENTENCE`, hedged wording ("about 49%").

- [ ] **Step 1: Write failing tests** for every function: defaults, clamping/ordering of years, invalid params fall back, defaults omitted on format and round-trip (`derive(format(s)) == s`), `browseHref` has no count and no provenance words, era bucketing (1y vs 5y labels, 5y buckets aligned to multiples of 5), top-N folding with grey `other`, share sums to 1, songs without year/genre skipped, tone decade below `minN` -> nulls, median with even/odd counts and null bpm ignored, insight sentence null below 30 songs and present with "about" at/above.
- [ ] **Step 2: Run** `cd frontend && node --test src/utils/dataUrlState.test.js src/components/explore/data/dataModel.test.js`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** both modules (pure, no DOM, ESM like `exploreUrlState.js`).
- [ ] **Step 4: Run** the same command plus `node --test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(data): pure URL-state and aggregation modules for the Data tabs`.

### Task 3: Data shell, filter bar and Over time charts

**Files:**
- Create: `frontend/src/pages/DataPage.jsx`, `frontend/src/components/explore/data/useDataset.js`, `DataFilterBar.jsx`, `OverTimeTab.jsx`, `EraChart.jsx`, `LineSeriesChart.jsx`, `ChartTable.jsx`
- Modify: `frontend/src/App.jsx` (explore data routes; remove DataDashboard import), `frontend/src/styles/components.css` (data styles), `frontend/src/pages/ExplorePage.jsx` (no change expected beyond tab link), `frontend/package.json` (remove `chart.js`, `react-chartjs-2`)
- Delete: `frontend/src/components/DataDashboard.jsx`

**Interfaces:**
- Consumes: Task 2 modules; `GET /api/analytics/dataset`.
- Routes: `/explore/data` index -> `Navigate` to `over-time`; `/explore/data/over-time` -> `OverTimeTab`; `/dashboard` still redirects to `/explore/data`. Only built tabs appear in the sub-tab row (phase 1: Over time).
- `DataPage` owns state from the URL (`useSearchParams` + `deriveDataState`), renders sub-tabs (NavLink), `DataFilterBar`, and an `Outlet` with context `{songs, labels, coverage, state, bounds, setState}`.

- [ ] **Step 1: Implement `useDataset`** (single fetch, loading/error/ready, no retry loops) and `DataPage` + `DataFilterBar` (parent genre select from `genreRanking`, two-handle year range in the style of `YearStrip`, one-line count "N songs · M with a genre", "Browse these songs" link from `browseHref`).
- [ ] **Step 2: Implement charts**: `EraChart` (stacked SVG area, legend, hover crosshair tooltip, Count|Share and 5-year|Yearly toggles), `LineSeriesChart` (tone shares by decade as lines; sonic shift as two single-series charts: median tempo, median loudness), each with caption stating denominator and a `ChartTable` toggle. Colours via `--explore-cat-N` (read through existing `palette.js` helper if suitable, else CSS vars) and `--explore-not-coded` for Other; sonic charts use `--tl-grit` / `--tl-pulse`.
- [ ] **Step 3: Wire routes** in `App.jsx`, delete `DataDashboard.jsx`, `npm uninstall chart.js react-chartjs-2`.
- [ ] **Step 4: Run** `cd frontend && npm run lint && npm run build && node --test`. Expected: 0 lint errors (5 existing warnings), build succeeds, tests pass.
- [ ] **Step 5: Browser check** with backend + frontend running: `/explore/data` redirects to Over time, charts render, filters change URL and charts, phone width, table views, no console errors.
- [ ] **Step 6: Commit** `feat(data): Data sub-tab shell, shared filter bar and Over time tab; retire Chart.js dashboard`.

### Task 4: Docs and full verification

**Files:** `CLAUDE.md`, `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `docs/PRD.md` (feature inventory line), spec status.

- [ ] **Step 1:** Update CLAUDE.md (analytics route + dataset service, ExplorePage/Data structure, drop Chart.js mentions), PROJECT_STATE (changelog, Next Tasks: phases 2-5, smoke steps), PLAN, PRD inventory.
- [ ] **Step 2:** Run `cd backend && node --test --test-concurrency=1`, `cd frontend && node --test && npm run lint && npm run build`. Expected: all green.
- [ ] **Step 3:** Commit docs; give smoke steps in chat; wait for "Merge".
