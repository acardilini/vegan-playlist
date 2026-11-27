# Explore › Data Redesign Handoff: Main Project (`vegan-playlist`) Integration Spec

This specification defines the redesign of **`/explore/data`** (`DataDashboard.jsx` + `backend/routes/analytics.js`), transforming the three-chart prototype into a unified, live-data **Curated Stories + Data Sandbox** workbench matching the style, visual restraint, and modular architecture of **`ExploreMap`** and **`AudioTimeline`**.

> **Interactive Prototype**: Open **`docs/explore_data_prototype.html`** (in this same `docs/` folder) in any browser to test the live PostgreSQL data, `Curated Stories` vs `Data Sandbox` toggle, Genre fallback switch, interactive Sankey flows, cross-tab heatmap (`Count` / `Row %` / `Lift`), Compare `A vs B` studio, and post-Part-2 artist preview layout before implementing.

> **Privacy & Legacy Audio Invariants**:
> 1. Never select or expose `song_lyrics.lyrics`, `song_lyrics.translation`, or `song_audio_transcripts.transcript` in any `/api/analytics/*` query (`backend/test/lyrics_privacy.test.js`).
> 2. Never read deprecated Spotify audio features or frozen `song_lyric_analysis` acoustic columns (`backend/test/legacyAudio.test.js`). All sound metrics come strictly from `song_audio_analysis` (`audioAnalysis.LATEST_AUDIO`).
> 3. Keep `songs.show_audio_samples === true` enforced server-side whenever reading `audio_samples`.

---

## 1. Current Bugs & Limitations Replaced by This Redesign

In the existing `frontend/src/components/DataDashboard.jsx` and `backend/routes/analytics.js`:
1. **Hardcoded `http://localhost:5000/api/analytics/...` URLs** in `DataDashboard.jsx` (lines 62, 87) instead of relative `/api/...` paths.
2. **`GET /api/analytics/vegan-themes` ignores filters**, and `/api/analytics/summary` ignores filters, causing KPI tiles and the themes bar chart to go out of sync with the selected genre/year filters.
3. **Raw `s.genre` / `s.parent_genre` queries** in `analytics.js` cover only `559 / 1,343` published songs instead of effective song-or-artist genres (`1,063`) or audio-inferred fallback genres (`1,314`).
4. **Static `max="2025"` year inputs** and `react-chartjs-2` usage that misses audio dimensions (`1,267` tracks), rhetoric pathways (`672` visible lyric codings), cross-tabs, and drill-down links into Browse Songs.

**Recommendation**: Replace the client-side `DataDashboard.jsx` implementation and retire `react-chartjs-2` from `/explore/data` in favor of a single payload endpoint + pure client-side aggregations (`node:test`-verified) and lightweight hand-rolled SVG charts (matching `ExploreMap` and `AudioTimeline`). Keep existing `/api/analytics/summary` etc. untouched only if anything external calls them, or remove dead routes once unused.

---

## 2. Backend Contract: `GET /api/analytics/dataset`

Because the live catalogue has `1,343` published songs and `642` published artists, one read-only JSON payload (mirroring `explore.mapPayload`) lets **every filter, slider, story chart, cross-tab matrix, and Compare A vs B chart** update in `< 10 ms` client-side with zero round-trip flicker.

### 2.1 Public-Safe Data Rules & Joins
Filter strictly on `s.status = 'included' AND s.published = true`:
- **Genre fields (two columns per song for the UI toggle)**:
  - `cp`: `getParentGenre(COALESCE(NULLIF(btrim(s.genre), ''), primary_artist_first_genre))` (`genreMapping.js`, `null` when neither song nor artist has a genre; `1,063` covered).
  - `ap`: `sau.inferred_parent_genre` from `audioAnalysis.LATEST_AUDIO` (`1,267` covered; combined `cp || ap` covers `1,314 / 1,343`).
  - **Option B provenance**: `ap` is read-only exploratory fallback and NEVER writes to `songs.genre`.
- **Lyric analysis fields (`analysis.LATEST_ANALYSIS`)**:
  - `hl`: boolean (`EXISTS real non-junk lyrics` AND visible `LATEST_ANALYSIS`, covering `672` tracks today).
  - Single scalars (omitting suppressed codes `ABSENT`, `UNSPECIFIED` via `metadataCodebook.js`): `persp` (`perspective`), `tone` (`lyrical_tone`), `clar` (`clarity`), `focus` (`focus_amount`), `aud` (`target_audience`).
  - Multi-value arrays (codebook-gated): `emo` (`emotions`), `thm` (`themes`), `thm_sd` (distinct taxonomy `sub_dimension` IDs), `tgt` (`topics`), `act` (`advocacy`, **never `tactics`**), `frm` (`moral_frames`).
- **Audio analysis fields (`audioAnalysis.LATEST_AUDIO` — `audio_status = 'OK'`)**:
  - `ha`: boolean (`1,267` covered).
  - Objective MIR: `bpm` (`NULL` when `tempo_stability = 'UNMETERED'`), `lufs` (`loudness_lufs`), `key` (`musical_key`), `mode` (`musical_mode`).
  - Qualitative dimensions: `aint` (`sonic_intensity`), `atex` (`production_texture`), `arhy` (`rhythmic_feel`), `aarc` (`dynamic_arc`), `amood` (`musical_mood`), `avoc` (`vocal_style`), `ains` (`instrumentation`), and `asmp` (`audio_samples`, **omitting `NONE` and ALWAYS `[]` unless `s.show_audio_samples IS TRUE`**).
- **Languages**:
  - `cl`: curator-approved `songs.language` (`126` published songs).
  - *(Optional AI preview toggle)* `al`: deduplicated canonical names from `COALESCE(sla.detected_languages, ...)` and `sat.detected_languages` (`WHERE sat.status = 'OK'`, **NEVER reading `sat.transcript`**). Wait until curator comfort is confirmed before enabling `+ AI preview` publicly, or gate/label explicitly as experimental AI detection.
- **Artists array (`artists`)**:
  - Aggregate over published included songs per artist (`642` rows): `{ id, name, n, y0, y1, cp, ap, country, formed, disbanded, last_rel, active }` where `active` uses `artistFacts.activeStatus({ lastReleaseYear, disbandedYear, override })`.
  - Keep `artist_members` vegan flags and internal curation notes (`discography_review_notes`, `thread_claims`) OUT of the public payload.
- **Labels dictionary (`labels`)**:
  - Build directly from `metadataCodebook.js`, `taxonomy.json` (+ `hierarchy.*.sub_dimensions`), and `acousticCodebook.js` (`HEADINGS`, omitting `hidden_in_ui: true` such as `NONE`, zero emojis — never `short_tag`).

### 2.2 Short Field Schema Reference (`songs[i]`)
Keep keys concise so the raw payload stays small (`~200–350 KB` gzipped) and add an in-process short-TTL cache or fast query (< 100 ms):
```ts
{
  id: number,
  t: string,           // songs.title
  a: string,           // display artist string (for drawer/scatter tooltip)
  aids: number[],      // song_artists artist IDs
  y: number | null,    // release year
  cp: string | null,   // curated/artist parent genre
  ap: string | null,   // audio-inferred parent genre
  cl: string[],        // curated songs.language
  hl: boolean,         // has visible non-junk lyric coding
  ha: boolean,         // has OK audio coding
  bpm: number | null,
  lufs: number | null,
  mode: 'major' | 'minor' | null,
  key: string | null,
  persp: string | null, tone: string | null, clar: string | null, focus: string | null, aud: string | null,
  emo: string[], thm: string[], thm_sd: string[], tgt: string[], act: string[], frm: string[],
  aint: string | null, atex: string | null, arhy: string | null, aarc: string | null,
  amood: string[], avoc: string[], ains: string[], asmp: string[]
}
```
> Note: Only ship fields actively used by `/explore/data` UI.

---

## 3. Frontend Architecture (`frontend/src/components/explore/data/`)

Mirror `ExploreMap`'s clean split between pure logic (`node --test` runnable) and React/SVG presentation:

1. **Pure, DOM-free modules**:
   - `frontend/src/utils/dataUrlState.js`:
     Owns URL query params for `/explore/data` (`mode=stories|sandbox`, `basis=curated|fallback`, `pg`, `yf`, `yt`, `era_m=count|share`, `era_b=5y|1y`, `flow`, `hm_r`, `hm_c`, `hm_m=count|rowPct|lift`, `cmp_m=genre|era`, `cmp_a`, `cmp_b`). Invalid params silently fall back to defaults.
   - `frontend/src/utils/browseUrlState.js` (reuse existing!):
     Build all **"Browse matching songs ↗"** and Drawer click-through links using `browseUrlState.js` vocabulary (`parent_genres`, `year_from`, `year_to`, `lyrical_tone`, `themes`, `actions`, `moral_frames`, `emotions`, `target_audience`, `sonic_intensity`, `production_texture`, `vocal_style`, `musical_mood`, `languages`).
   - `frontend/src/components/explore/data/dataModel.js`:
     Pure aggregation functions (`filterSongs`, `computeKpis`, `buildEraSeries`, `buildToneByDecade`, `buildSonicByDecade`, `buildRhetoricFlow`, `buildThemeCoOccurrence`, `buildCrossTab`, `buildCompareProfiles`, `buildFootprintSummary`, `buildSoundScatter`). Must include `node --test` unit tests covering edge cases (`0`-song filter slices, `n < 3` Lift suppression, genre fallback on/off, dual-year bounds).

2. **Top Shell & Shared Control Bar**:
   - Inside `ExplorePage.jsx` `/explore/data` outlet.
   - **Mode Toggle**: **`Curated Stories`** | **`Data Sandbox`** (shared filter bar persists across mode switches).
   - **Global Control Bar**:
     - **Genre source**: `Catalogue + audio fallback` *(default ON)* | `Catalogue genres only`.
     - **Parent Genre** dropdown + **Dual-handle Release Year slider** (reusing styling cues from `YearStrip.jsx`).
     - **Dynamic KPI strip** (`Songs`, `Artists`, `Release span`, `Genre covered %`, `Audio analysed %`, `Lyric coded %`) + **`Browse matching songs ↗`** `<Link>` using `browseUrlState.js`.

3. **Mode 1 — Curated Stories**:
   - **Story 1: History & Eras (`1967–2025`)**:
     - Dynamic insight strip auto-computed from the active slice (e.g. `1980s` vs `2020s` top genre shares).
     - Interactive SVG **Stacked Area / Streamgraph** of top 6 parent genres (`--explore-cat-1..6`) + `Other / remaining` (`--explore-cat-7`) with `Song Count | % Share`, `5-Year Eras | Yearly`, clickable legend soloing, hover crosshair tooltip, and click-to-open song drawer.
     - Two companion cards: **Lyrical Tone Shifts Across Decades** (`%` multi-line) and **Sonic Shift Across Decades** (Median BPM `--tl-pulse` vs Median LUFS `--tl-grit`).
   - **Story 2: Rhetoric Flow (*How Artists Argue for Animals*)**:
     - Pathway preset selector: `Genre → Lyrical Tone → Advocacy Action`, `Speaking To → Moral Frame → Advocacy Action`, `Vocal Style → Lyrical Tone → Primary Emotion`.
     - **3-Column SVG Alluvial / Sankey**: Top 6 nodes per column + `Other`, primary code per coded dimension, SVG cubic Bezier ribbons graded by exact matching song count. Hover highlights connected paths; click opens the Matching Songs Drawer with a `browseUrlState.js` link.
     - Companion card: **Themes That Travel Together** (top co-occurring theme pairs, clickable).
   - **Story 3: Global & Artist Footprint** *(see §4 Progressive Activation below)*.
   - **Story 4: Soundscape Snapshot (`1,267` Audio Tracks)**:
     - **Tempo (BPM) × Loudness (LUFS)** Canvas/SVG scatter coloured by parent genre (`--explore-cat-1..7`) + **Major vs. Minor Key Balance by Genre** horizontal 100%-stacked bars.

4. **Mode 2 — Data Sandbox**:
   - **Cross-Tab Explorer Matrix / Heatmap**:
     - Select any Row dimension (`Genre`, `Decade`, `Vocal Style`, `Intensity`, `Mood`, `Perspective`, `Speaking To`) × Column dimension (`Lyrical Tone`, `Themes Sub-dims`, `Themes Top 10`, `Advocacy Actions Top 10`, `Moral Frames Top 10`, `Emotions Top 10`, `Intensity`, `Production`, `Vocal Style`, `Mood`, `Dynamic Arc`).
     - Metric switcher: **`Count`** | **`Row %`** | **`Distinctiveness (Lift)`** (fade/mark cells with `n < 3` under Lift so noisy singletons don't mislead). Clicking a cell opens the Matching Songs Drawer.
   - **Side-by-Side "Compare A vs B" Studio**:
     - Toggle **`Genre vs Genre`** or **`Era vs Era`** with quick presets (`Metal vs Hip-Hop`, `Punk vs Folk`, `Metal vs Punk`, `1980s–90s vs 2020s`).
     - Synchronized mirrored butterfly bars (`--tl-grit` Orange for Group A vs `--tl-pulse` Blue for Group B — CVD-safe!) comparing Message Fingerprint (`Tone`, `Themes`, `Advocacy`) and Sound Fingerprint (`Intensity`, `Vocals`, `Mood`) + Median BPM/LUFS/% Minor summary.

---

## 4. Progressive Activation for Global & Artist Footprint (Part 2 Readiness)

At launch (`2026-11-22`), artist-level enrichment is sparse (`1 / 642` published artists have `artists.country`; `0 / 642` have `formed_year`). Design Story 3 in production to **honestly adapt without fake data**:

- **Live right now (100% populated)**:
  - **Catalogue Depth & Prolific Voices**: Song-count concentration histogram (`1`, `2–4`, `5–9`, `10+` songs) + clickable Top Contributors leaderboard (`642` artists).
  - **Language Diversity**: Ranked bar chart of curated `songs.language` (`126` published tracks). *(Note: Do NOT ship mock "Post-Part-2 Preview" data in production — that switch exists only in `docs/explore_data_prototype.html` for design review.)*
- **Auto-activating panels (`WITH_COUNTRY_THRESHOLD = 25`)**:
  - **Global Geography (World Map + Country Bars)** & **Active vs. Legacy Artist Cohorts**: When `artistsWithCountry < 25` (or `artistsWithActiveStatus < 25`), show a clean progress/status card (*"Collecting artist origin data — X of Y artists catalogued so far"*) paired with whatever real points exist (e.g., `USA`). Once the upcoming **Part 2 Artist Data Collection** pipeline fills `artists.country` and `formed_year` / `last_release_year` (`>= 25`), the full interactive choropleth/bubble world map and active/legacy breakdown activate automatically with zero frontend code changes.

---

## 5. Colour, Typography & Visual Constraints

- **Strictly reuse brand & validated Explore tokens** (`frontend/src/styles/tokens/{colors,typography}.css`, `components.css`):
  - Canvas/Surfaces: `--bg-canvas`, `--bg-surface`, `--bg-surface-raised`.
  - Categorical charts: **maximum 7 categorical slots** using `--explore-cat-1..7` + `--explore-not-coded` (`#898781`), already CVD-validated in `palette.js` + `components.css`. Collapse longer dimensions (like genres in Era Area or nodes in Sankey) to top 6 + `Other`.
  - Diverging/Two-group visuals (Compare `A vs B`, Decade Sonic lines, Major/Minor): `--tl-grit` (`#e8601f`) vs `--tl-pulse` (`#2a9fdc`), plus `--accent-moss-60` for positive Lift highlights.
  - Zero emojis anywhere in chart titles, dimension headings, or axis labels (`metadataCodebook.codeLabel` / `acousticCodebook.codeLabel`, never `short_tag`).
  - Honest coverage denominators on every section caption (`1,314 genre-covered`, `1,267 audio-analysed`, `672 lyric-coded`).

---

## 6. Verification Checklist (Main Project)

1. Run `node --test backend/test/*.test.js` — specifically verify `lyrics_privacy.test.js` and `legacyAudio.test.js` pass.
2. Add `node --test` coverage for pure `dataModel.js` and `dataUrlState.js` (checking genre fallback toggle, zero-song empty filter slices, Lift `n < 3` suppression, and `browseUrlState.js` parameter round-tripping).
3. Run `cd frontend && npm run lint && npm run build` with 0 warnings/errors.
4. Curator visual smoke check at `http://localhost:5173/explore/data`: toggle `Curated Stories` ↔ `Data Sandbox`, `Catalogue + audio fallback` ↔ `Catalogue genres only`, verify `YearStrip` sync, inspect mobile responsive stacking, and test Drawer click-throughs into `/?...`.
