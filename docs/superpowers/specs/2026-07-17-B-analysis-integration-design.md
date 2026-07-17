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
- **`taxonomy.json`** — codebook at
  `C:\Users\Owner\.gemini\antigravity\scratch\vegan-playlist-analysis\data\taxonomy.json`. Five
  evidence dimensions as `{id, label, definition}` lists (themes 27, targets 61, actions 15,
  tactics 20, moral_frames 19) + scalar categories (perspectives, intensity_levels, clarity_levels,
  focus_amounts, lyrical_tones, target_audiences). **Vendored into this repo** by B (see §4).

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
   not shown as empty headings.
2. **Evidence quotes are shown publicly.** They are short verbatim lyric fragments (distinct from
   full `song_lyrics`, which stays local-only). Curator-approved.
3. **Faceted browse scope = Full.** All five dimensions + tone/intensity as collapsible facet
   groups alongside the existing Genre/Mood/Year filters.
4. **Combine logic = always AND, everywhere.** Multiple codes within a group must **all** match;
   groups AND together; analysis facets AND with Genre/Mood/Year. (Deliberately narrowing.)
5. **Only-coded filtering is correct**, with a **visible note** near the facets ("Filtering by
   analysis shows only the 685 lyrically-coded songs").
6. **Model = `gemma4:latest` only** everywhere (a shared backend constant). No model switcher.
7. **Vector map = its own top-nav "Explore" page** with **2D + 3D** views, a space toggle
   (Semantic / Thematic / Acoustic), colour-by (**default = dominant theme**; target-animal and
   tone also selectable), and a **spotlight filter** (theme/animal that dims non-matching points).
   Hover shows a song card; click opens the song page.
8. **Mock 5-array categorisation removed: UI + DB columns.** Drop the five empty `songs` columns
   via a migration and strip all their references.
9. **`analytics/vegan-themes` repointed at real data** so the public DataDashboard theme chart
   reflects the real thematic coding (B1 endpoint + B2 display).

## 4. Architecture

### Backend (Express / `pg`)

- **Vendor the codebook:** copy `taxonomy.json` into the repo (canonical home:
  `backend/data/taxonomy.json`). A small loader module exposes it for label lookup + facet option
  lists. Kept in sync manually on the analysis service's monthly cadence (documented).
- **Shared constant** `DEFAULT_MODEL = 'gemma4:latest'` (reuse/relocate the one already in
  `curation.js` so public + admin + curation share a single source).
- **Song analysis (public):** fold the gemma4 coding into the existing song-detail response (or a
  sibling `GET`), `model_used`-filtered; a song with no row returns an empty/absent analysis object.
  Dimension columns aliased to display names (`topics`→`targets`, `advocacy`→`actions`).
- **`GET /api/analysis/facets` (public):** taxonomy groups + labels + **per-code counts** over
  `status='included' AND published=true` songs, for the browse sidebar. Counts computed with the
  JSONB containment operator against the GIN indexes.
- **Extend browse/search (public):** accept analysis facet params; translate to `@>` predicates
  combined with **AND** (both within and across dimensions), joined to the existing
  genre/mood/year/text filters. Selecting any analysis facet implies the inner join to
  `song_lyric_analysis` (naturally restricting to coded songs).
- **`analytics/vegan-themes` repoint:** aggregate real `themes` code frequencies (gemma4) instead
  of the dropped mock arrays.
- **Workbench:** extend `curation.getWorkbench` to return the full analysis object (not just the
  `analysed` boolean) for the read-only panel.
- **Migration 007 — drop mock arrays:** verify all five columns are empty across every row, then
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
  like `CategorizationFields` was). Labels/definitions come from the vendored taxonomy (definitions
  power chip tooltips).
- **Song page (`SongDetailPage`):** replace the mock "Animal advocacy analysis" section with
  `LyricalAnalysis`.
- **Browse (`SearchAndFilter` + browse page):** add the full analysis facet groups (collapsible,
  counts, all-AND) + the only-coded note; wire to `/api/analysis/facets` and the extended search.
- **Explore page (new) + nav item:** loads `/vector_space.json`; 2D scatter (canvas/SVG or a light
  2D lib) + 3D scatter (WebGL, likely `react-three-fiber` — final call at plan time); space toggle,
  colour-by (default theme), spotlight filter, hover card, click→song. Proper dataviz treatment
  (accessible, validated palette) at build time.
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
