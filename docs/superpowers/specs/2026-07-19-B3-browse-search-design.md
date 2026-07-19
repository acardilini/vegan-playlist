# B3 — Browse & Search Overhaul — Design

_Date: 2026-07-19 · Sub-project B (Analysis Integration), build B3._
_Parent spec: [`2026-07-17-B-analysis-integration-design.md`](./2026-07-17-B-analysis-integration-design.md)._

## Context

B3 was originally scoped narrowly as "hierarchical faceted browse" — a collapsible
`Dimension → Sub-dimension → Group → Code` facet tree over B1's `facetTree` endpoint with
`/search` AND filtering. In this session the curator expanded B3 into a broader **browse &
search overhaul**, adding four fixes to the existing filter UI. This spec captures the full,
expanded B3.

The browse experience lives in `frontend/src/components/SearchAndFilter.jsx` (the filter panel
+ genre tree) driving `GET /api/spotify/search` and `GET /api/spotify/filter-options` in
`backend/routes/spotify.js`. B1 already added `GET /api/analysis/facets` (`facetTree` with
distinct-song rollup counts) and wired analysis-facet AND filtering into `/search`.

### Data reality (live songs = `status='included' AND published=true`), audited 2026-07-19

| Signal | Live songs | Note |
|---|---|---|
| Total live | **1,332** | |
| `songs.genre` populated | **492** | what the current facet counts — hence sum ≪ total |
| Genre via primary artist's first genre (COALESCE) | **1,003 covered / 329 uncovered** | the artist genres are far richer |
| Songs with exactly one artist | 1,262 | multi-artist is rare (70 songs) |
| Has duration | 1,325 (0.1–19.7 min, avg 3.1) | usable length filter |
| Has YouTube video (`youtube_videos`) | 711 | usable |
| Has lyrics analysis (`song_lyric_analysis`) | 640 | = the thematic facet-tree population |
| On Spotify (`spotify_id`) | 1,325 | filters out almost nothing on its own |
| Language set | 35 (English 32, +German/Portuguese/Māori) | sparse |

## The four curator notes (drivers)

1. Year-range inputs are too small for their placeholder text.
2. Add more filters beyond genre + year, from the thematic analysis and available data.
3. Genre counts are wrong — they sum to far fewer than the total songs; make search/filter
   capture the whole catalogue.
4. Bring back the removable filter chips, positioned **below** the filters panel.

## Design

### 1. Genre fix — effective genre (curator's rule)

Compute an **effective genre** per song at query time:

```
effective_genre = COALESCE(NULLIF(songs.genre,''), primary-artist's first genre)
```

- **"Primary artist's first genre"**: for a song's linked artists that have a non-empty
  `genres` array, pick the one with the lowest `song_artists.id` (deterministic; unambiguous
  for the 1,262 single-artist songs), then element `[1]` of that artist's `genres`.
- Parent genre is derived from the effective genre via `genreMapping.getParentGenre()`.
- **The same expression drives both** the facet counts (`/filter-options`) and the genre
  filter (`/search`), so a genre's count always equals the number of results clicking it
  returns.
- **Query-time only — no stored write** to song rows (preserves the dataset-safety
  invariant; genre is regenerable enrichment per the Decision Log, but we still avoid a
  lossy stored pick).
- Coverage rises 492 → **1,003**; a visible note reports the **329** songs with no genre
  from any source (they still appear in unfiltered browse and under every non-genre filter).
- The hardcoded frontend fallback counts (metal 169, hardcore 134…) and the hardcoded
  `GENRE_HIERARCHY` map in `SearchAndFilter.jsx` are **deleted**; the genre tree (parents,
  subgenres, counts) becomes fully backend-driven from `/filter-options`.

### 2. Thematic facet tree (original B3 core)

Collapsible `Dimension → Sub-dimension → Group → Code` tree fed by B1's
`GET /api/analysis/facets` (`facetTree`, distinct-song rollup counts). Sub-dimension colouring
reuses B2's shared `styles/subDimensionPalette.js`. **AND** logic within and across groups
(as decided for sub-project B). A visible note: *"Only songs with lyrics analysis (640) are
counted here."* Selecting any code restricts results to coded songs.

Adds the **deferred 2-codes-same-group `facetTree` test** (from the B1 Decision Log).

### 3. Filter set & semantics

Standard semantics everywhere: **OR within a single facet, AND across facets.**

| Filter | Exposed as | Population |
|---|---|---|
| Genre | backend-driven collapsible parent→subgenre tree (fixed per §1) | 1,003 |
| Themes & advocacy | the facet tree (§2) | 640 |
| Year range | two number inputs, **resized so placeholder text fits** | — |
| Song length | presets: Short `<2 min` · Medium `2–4 min` · Long `4+ min` | 1,325 |
| Available on | `On Spotify` · `Has YouTube` (grouped, so "On Spotify" isn't a lone near-no-op) | 1,325 / 711 |
| Has lyrics analysis | single toggle | 640 |
| Language | data-driven checkboxes — only languages that have songs (English 32, …) | 35 |

Length presets map to `duration_ms` ranges (Short `<120000`, Medium `[120000,240000]`,
Long `>240000`); multiple presets selected = OR. `On Spotify` = `spotify_id` present;
`Has YouTube` = a `youtube_videos` row exists; `Has lyrics analysis` = a `song_lyric_analysis`
row exists. Language = `songs.language = ANY(selected)`.

**On-Spotify and Language are included at the curator's request despite sparse/near-total
data** — implemented honestly (On Spotify grouped under Availability; Language options driven
from real data so no empty rows appear).

### 4. Filter chips (restored, repositioned)

One removable chip per active filter — the search term, each selected genre/parent genre, each
theme code, the year range, each length preset, each availability/analysis toggle, each
language. Rendered in a wrapping row **below the filters panel**, visible whether the panel is
open or closed (so active filters are always visible while browsing). Each chip's `✕` clears
only that filter; the existing "Clear all" button remains. `sort_by` is not a chip.

### 5. Panel layout (year-range sizing fixed here)

```
[ Search songs, artists, albums…            ] [ Filters (3) ] [ Clear all ]
Sort by: [ Popularity ▾ ]

┌─ Filters (when open) ──────────────────────────────────────┐
│ ▸ Genre                 collapsible tree · backend-driven  │
│ ▸ Themes & advocacy     facet tree · Dim→Sub→Group→Code    │
│ ▸ Year range   [ From 1965 ]  to  [ To 2024 ]   ← widened  │
│ ▸ Song length  □ Short   □ Medium   □ Long                 │
│ ▸ Available on □ On Spotify   □ Has YouTube                │
│ ▸ Analysis     □ Has lyrics analysis                       │
│ ▸ Language     □ English (32)  □ German (1) …              │
│ notes: 329 songs have no genre · 640 have analysis         │
└────────────────────────────────────────────────────────────┘
[✕ vegan] [✕ Genre: metal] [✕ 1990–2000] [✕ Short] [✕ Has YouTube]   ← chips
```

Filter groups are collapsible sections (the genre tree and facet tree are large). Styling uses
the design-system tokens (`--bg-*`/`--text-*`/`--accent-*`/`--space-*`), never raw colours.

### 6. Backend changes

- **`GET /api/spotify/filter-options`** — return the effective-genre tree (parents +
  subgenres with distinct-song counts under the COALESCE expression), the language list (only
  languages present, with counts), and availability counts. Remove reliance on the old
  song-level-only genre grouping.
- **`GET /api/spotify/search`** — filter genre/parent by the effective-genre expression;
  add `length` (preset list → duration ranges), `has_youtube`, `has_analysis`, `on_spotify`,
  and `language`. `year_from`/`year_to` and the B1 analysis facets already exist.
- Keep both endpoints filtered to `status='included' AND published=true` and `LEFT JOIN
  albums` (non-Spotify songs must stay visible).

### 7. Out of scope (YAGNI)

- No stored genre backfill migration (query-time COALESCE covers it).
- No new sort options (sort stays popularity/title/artist/year; popularity remains
  display-suppressed per Phase 3 but still sortable).
- No B4 Explore vector map (separate build).
- Language/on-Spotify filters are shipped but will only become genuinely useful as the
  underlying data grows.

## Verification

- Backend `node --test` green, including new tests for the effective-genre expression, each
  new filter, and the deferred 2-codes-same-group `facetTree` test.
- Frontend `npm run build` clean; `eslint src/` 0 errors.
- Live smoke: genre counts sum to ~1,003 (not 492); each new filter narrows results
  correctly and its chip appears/removes; the facet tree ANDs and narrows; year inputs fit
  their text; unfiltered browse still shows all 1,332 live songs.
