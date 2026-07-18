# Sub-project B — Analysis Integration (Design Spec)

_Phase 4 (Admin Rebuild), sub-project B. Brainstormed 2026-07-17. Design approved by the curator (visual companion walk-through + terminal decisions)._

## 1. Purpose

Replace the **mocked, always-empty** 5-array categorisation with the **real** qualitative lyric
analysis and vector-mapping data produced by the separate analysis service and stored in the
shared PostgreSQL instance. The main app becomes a **display-only** consumer of this data across
five surfaces: the public song page, the faceted browse, a new "Explore" vector-space map, the
public Data Dashboard's theme chart, and the admin Curation Workbench (read-only). Regeneration of
the analysis stays entirely in the analysis service — B never runs models.

**Integration reference:** [`docs/LYRICS_VECTOR_ANALYSIS_INTEGRATION.md`](../../LYRICS_VECTOR_ANALYSIS_INTEGRATION.md).

## 2. Data sources (verified 2026-07-17)

All present in the shared `vegan_playlist` DB / repo:

- **`song_lyric_analysis`** — 685 songs coded with `model_used='gemma4:latest'` (508 with
  `gemini-3.5-flash`, unused). Composite PK `(song_id, model_used)` — **every query MUST filter
  `model_used`**. Columns: five evidence-bearing JSONB arrays of `{code, evidence}` —
  `themes`, `topics` (= **targets**), `advocacy` (= **actions**), `tactics`, `moral_frames` — plus
  scalar `perspective`, `emotions TEXT[]`, `intensity`, `clarity`, `focus_amount`, `lyrical_tone`,
  `target_audience`, and `explanation`. GIN indexes exist on all five JSONB columns.
- **`song_embeddings`** — 1,748 rows (raw vectors; not read directly by B).
- **`frontend/public/vector_space.json`** — array of 658 songs, each `{song_id, title, artist,
  themes, semantic_2d, semantic_3d, thematic_2d, thematic_3d, audio_2d, audio_3d}`. Already
  committed.
- **`taxonomy.json`** — codebook, **vendored into the repo at `backend/data/taxonomy.json`**
  (curator maintains it in the analysis service and re-vendors on the monthly cadence). **Now a
  4-level hierarchy** (updated 2026-07-17): the five evidence dimensions list codes as
  `{id, label, definition, sub_dimension, group}` (themes 27, targets 60, actions 15, tactics 20,
  moral_frames 19), and a top-level **`hierarchy`** block gives display labels for every level —
  `hierarchy.<dimension>.label`, `.sub_dimensions.<subId>.label`, `.sub_dimensions.<subId>.groups.<groupId>`.
  So each dimension nests **Dimension → Sub-dimension → Group → Code** (themes 5 sub-dims/11 groups;
  targets 4/14; actions 3/7; tactics 3/8; moral_frames 4/9). Every code's `sub_dimension`/`group`
  is guaranteed present in `hierarchy` (validated: 0 orphans). Scalar categories (perspectives,
  intensity_levels, clarity_levels, focus_amounts, lyrical_tones, target_audiences) stay flat.
  **Code ids are unchanged from the pre-hierarchy version, so the `song_lyric_analysis` data needs no
  re-coding** — the hierarchy is a pure presentation/organisation layer.

**Coverage:** 685 of 1,342 live songs are analysed (~51%). The `needs-analysis` derived queue
(already implemented in A1's `curation.js`, keyed on `song_lyric_analysis` + `gemma4:latest`)
surfaces the un-coded songs to the curator. B does not add coding UI.

**Name mapping** (DB column → taxonomy/display label), used everywhere:
`themes→Themes`, `topics→Targets`, `advocacy→Actions`, `tactics→Tactics`, `moral_frames→Moral frames`.

## 3. Decisions (from the brainstorm)

1. **Song-page layout = "Option C, expanded, emoji-free."** Compact-by-default: an attributes
   card (perspective, tone, intensity, clarity, focus, emotions — **no** target-audience/"speaks
   to") + a grid of **all** chips for every non-empty dimension. A **"Show evidence"** disclosure
   reveals the plain-English `explanation` ("Summary") and, grouped by dimension, **one verbatim
   evidence quote per code** tagged with its code label. **Empty dimensions/attributes are hidden**,
   not shown as empty headings. Chips stay flat (no sub-headings) but are **colour-coded by
   sub-dimension**, with a compact **inline mini-legend** under each dimension heading listing only
   the sub-dimensions that song actually uses (curator choice 2026-07-17, "Option A"). The
   sub-dimension colour system is shared with the Explore map (§3.10).
2. **Evidence quotes are shown publicly.** They are short verbatim lyric fragments (distinct from
   full `song_lyrics`, which stays local-only). Curator-approved.
3. **Faceted browse scope = Full, rendered as a hierarchical tree.** All five evidence dimensions
   (+ tone/intensity as flat pick-lists) alongside the existing Genre/Mood/Year filters. Each
   evidence dimension is a **collapsible `Dimension → Sub-dimension → Group → code` tree** (curator
   choice 2026-07-17), mirroring the existing genre tree, with **counts at each level** and a
   parent checkbox (group / sub-dimension) that selects all its descendant codes. Filtering is still
   per-code (§3.4).
4. **Combine logic = always AND, everywhere.** Multiple codes within a group must **all** match;
   groups AND together; analysis facets AND with Genre/Mood/Year. (Deliberately narrowing.)
5. **Only-coded filtering is correct**, with a **visible note** near the facets ("Filtering by
   analysis shows only the 685 lyrically-coded songs").
6. **Model = `gemma4:latest` only** everywhere (a shared backend constant). No model switcher.
7. **Vector map = its own top-nav "Explore" page** with **2D + 3D** views, a space toggle
   (Semantic / Thematic / Acoustic), colour-by (**default = sub-dimension** for a legible legend —
   curator choice 2026-07-17; individual code / group also selectable at runtime), and a
   **spotlight filter** (theme/animal that dims non-matching points). Hover shows a song card;
   click opens the song page.
8. **Mock 5-array categorisation removed: UI + DB columns.** Drop the five empty `songs` columns
   via a migration and strip all their references.
9. **`analytics/vegan-themes` repointed at real data** so the public DataDashboard theme chart
   reflects the real thematic coding (B1 endpoint + B2 display).
10. **The 4-level taxonomy hierarchy is a shared presentation layer** (added 2026-07-17 after the
    codebook restructure). The **sub-dimension** level is the unit of visual grouping: one
    accessible, colour-blind-safe, light+dark palette maps sub-dimension → colour, used identically
    on the song-page chips (§3.1) and as the Explore map's default colouring (§3.7), so the whole
    site reads as one system. The palette is built with the `dataviz` skill at frontend-build time
    (B2/B4). The backend serves the hierarchy + labels; the frontend owns the colour assignment.

## 4. Architecture

### Backend (Express / `pg`)

- **Vendor the codebook:** `taxonomy.json` lives at `backend/data/taxonomy.json`. A small loader
  module exposes it for label lookup, per-code `sub_dimension`/`group` resolution, and the
  `hierarchy` tree. Kept in sync manually on the analysis service's monthly cadence (documented).
- **Shared constant** `DEFAULT_MODEL = 'gemma4:latest'` (reuse/relocate the one already in
  `curation.js` so public + admin + curation share a single source).
- **Song analysis (public):** fold the gemma4 coding into the existing song-detail response (or a
  sibling `GET`), `model_used`-filtered; a song with no row returns an empty/absent analysis object.
  Dimension columns aliased to display names (`topics`→`targets`, `advocacy`→`actions`). **Each code
  is enriched from the taxonomy with its `sub_dimension` id + `sub_dimension_label`** (and `group`),
  so the frontend can colour chips and build the inline mini-legend without shipping the taxonomy.
- **`GET /api/analysis/facets` (public):** returns the **hierarchical facet tree** for the browse
  sidebar — per dimension: `{ label, sub_dimensions: [{ id, label, count, groups: [{ id, label,
  count, codes: [{ code, label, count }] }] }] }` — where each `count` is the number of
  `status='included' AND published=true` songs matching that node (code counts via JSONB containment
  against the GIN indexes; group/sub-dimension/dimension counts are the distinct-song rollups of
  their descendants, **not** naive sums, since a song can carry sibling codes). Empty nodes may be
  omitted.
- **Extend browse/search (public):** accept analysis facet params; translate to `@>` predicates
  combined with **AND** (both within and across dimensions), joined to the existing
  genre/mood/year/text filters. Selecting any analysis facet implies the inner join to
  `song_lyric_analysis` (naturally restricting to coded songs).
- **`analytics/vegan-themes` repoint:** aggregate real `themes` code frequencies (gemma4) instead
  of the dropped mock arrays.
- **Workbench:** extend `curation.getWorkbench` to return the full analysis object (not just the
  `analysed` boolean) for the read-only panel.
- **Migration 007 — drop mock arrays:** verify all five columns are empty across every row, then
  `DROP VIEW IF EXISTS songs_with_manual_categories` (a dead legacy view that COALESCEs these
  columns with the 0-row `manual_categorizations` table — referenced nowhere in app code) and
  `DROP COLUMN` `vegan_focus`, `animal_category`, `advocacy_style`, `advocacy_issues`,
  `lyrical_explicitness` from `songs`. Remove their references in `admin.js` (manual-song create,
  edit, bulk-categorisation, `categorization-options`), `spotify.js` (public SELECTs), and
  `analytics.js`.
- **Copyright guardrail preserved:** new routes surface only the short evidence fragments +
  taxonomy/coding fields; they **never** `SELECT song_lyrics.lyrics` or `.translation`. The existing
  `lyrics_privacy.test.js` guardrail must stay green.

### Frontend (React / Vite)

- **`LyricalAnalysis` component** (new) — the Option-C display. Consumed by the song page and,
  **read-only**, by the admin workbench Analysis panel (single implementation, one source of truth,
  like `CategorizationFields` was). Chips are **coloured by `sub_dimension`** (from the enriched
  analysis payload) via the shared sub-dimension palette; each dimension heading carries an **inline
  mini-legend** of only the sub-dimensions present. Labels/definitions come from the payload
  (definitions power chip tooltips).
- **Shared sub-dimension palette** (new small frontend module) — maps `sub_dimension` id → accessible
  colour (light + dark), built with the `dataviz` skill. Imported by `LyricalAnalysis` and the Explore
  map so colours are identical site-wide.
- **Song page (`SongDetailPage`):** replace the mock "Animal advocacy analysis" section with
  `LyricalAnalysis`.
- **Browse (`SearchAndFilter` + browse page):** add the analysis facets as a **collapsible
  `Dimension → Sub-dimension → Group → code` tree** (counts at each level; parent checkbox selects
  descendants; all-AND) + the only-coded note; wire to `/api/analysis/facets` and the extended
  search. Follows the existing genre-tree pattern.
- **Explore page (new) + nav item:** loads `/vector_space.json`; 2D scatter (canvas/SVG or a light
  2D lib) + 3D scatter (WebGL, likely `react-three-fiber` — final call at plan time); space toggle,
  **colour-by sub-dimension by default** (via the shared palette; code/group also selectable),
  spotlight filter, hover card, click→song. Proper dataviz treatment (accessible, validated palette)
  at build time.
- **DataDashboard:** consume the repointed `vegan-themes` to render a real theme distribution.
- **Delete mock categorisation UI:** remove `CategorizationFields.jsx`, `BulkCategorizationWorkflow`,
  the categorisation portions of `BulkEditModal`, and the mock reads in `HomePage`,
  `DataDashboard` (old array reads), `ArtistDetailPage`, `SearchAndFilter`. The `rating` field is
  **out of scope** and left untouched.

## 5. Testing

- **Backend `node:test`:** facets endpoint (correct per-code counts + AND semantics), song-analysis
  read (model filter; missing song → empty), migration verify-empty guard, `vegan-themes` real
  aggregation, and the existing lyrics-privacy guardrail still green. Use **unique sentinel
  fixture prefixes per file** (per the parallel-run hazard).
- **Frontend:** `npm run build` + `eslint` clean; headless smoke of the song-page analysis
  (chips + expand + evidence), browse facet filtering (AND narrowing + only-coded note), the Explore
  map (load, space/dimension/colour toggles, spotlight, click→song), and the workbench read-only
  panel.
- **DB safety:** queue counts + a curator-owned-field checksum unchanged before/after (the only
  schema change is dropping five provably-empty columns).

## 6. Decomposition (one spec → four implementation plans)

Mirrors A's A1–A4 shape; each plan its own TDD build + review.

- **B1 — Backend & data foundation.** Vendor `taxonomy.json` + loader; `DEFAULT_MODEL` constant;
  song-analysis read; `GET /api/analysis/facets`; extended browse/search facet filtering;
  `vegan-themes` repoint; `getWorkbench` full analysis; migration 007 + mock-reference removal;
  guardrail test intact.
- **B2 — Song page + workbench panel + mock-UI deletion.** `LyricalAnalysis` component; song-page
  integration; admin workbench read-only panel; DataDashboard theme chart; delete the mock
  categorisation components/reads.
- **B3 — Faceted browse.** Full facet groups, all-AND, only-coded note, counts.
- **B4 — Explore vector map.** 2D + 3D scatter, space/colour toggles, spotlight filter, hover/click.

## 7. Out of scope (YAGNI)

- `gemini-3.5-flash` model and any model switcher.
- The monthly regeneration pipeline (`sync-and-code`, `vectors`) — owned by the analysis service.
- The `songs.rating` scalar field — untouched.
- Multi-image playlist mosaics, and any new curation/coding UI in the admin.
