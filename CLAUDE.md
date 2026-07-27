# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The Vegan Playlist is a web-based resource for vegan-themed music featuring a curated database of 650+ songs. It consists of a React frontend and Node.js/Express backend with PostgreSQL database integration and Spotify API connectivity.

The project is undergoing a **structured modernisation** (messy prototype → clean, branded, deployable product) without a full rewrite. The backend, PostgreSQL schema, and 650-song dataset are preserved and cleaned; the frontend and ops layer are rebuilt. See the modernisation docs in `docs/`.

## Modernisation Workflow

This project is worked on in **phases** and **sessions** (see [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md)). Follow the Start-Session and End-Session guides below every session.

### Core principle: YAGNI
Build only what is needed now. No speculative features, abstractions, or infrastructure. If the PRD lists something not needed yet, defer it (record it in the Backlog/Deferred section of `PROJECT_PLAN.md`) rather than building it. Prefer the simplest thing that works. Every change is also weighed against one question: **does this risk the 650-song curated dataset?**

### Key documents (read/update these, not just code)
- [`docs/PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md) — what & why; modernisation philosophy. (Stable)
- [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) — phases → sessions → smoke tests. (Update as phases progress)
- [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) — **living doc**: current phase/session, next tasks, decision log, changelog.
- [`docs/PRD.md`](docs/PRD.md) — product vision + as-built feature inventory (§11).

### Start-Session Guide
Run at the beginning of every working session:
1. **Read [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md)** — identify the current phase, the current/next session, and the "Next Tasks" list.
2. **Read the relevant phase in [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md)** for the session's tasks and its smoke-test expectation.
3. **Check the Decision Log** in `PROJECT_STATE.md` for constraints that affect today's work.
4. **State the plan for the session** to the user (which session, what tasks, expected outcome) before starting work.
5. **Check git status** so you begin from a known-clean state.

### End-Session Guide
Run before ending every working session:
1. **Smoke test** (if any code changed): launch backend + frontend and exercise the affected flow as a user would; confirm nothing broke. Report the result.
2. **Update [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md)**: advance the current/next session, refresh "Next Tasks", add any new entries to the Decision Log, and append a Changelog entry for what was done.
3. **Update [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md)**: mark sessions ☑/◐, and adjust upcoming sessions if the work reshaped them.
4. **Update other docs if affected** (`PRD.md` feature inventory, `PROJECT_OVERVIEW.md`, this file).
5. **Commit and push**: stage the work + doc updates, write a clear commit message, and push. End commit messages with the required co-author trailer.

## Development Commands

### Backend (Node.js/Express)
- **Development server**: `cd backend && npm run dev` (uses nodemon)
- **Production server**: `cd backend && npm start`
- **Install dependencies**: `cd backend && npm install`

### Frontend (React/Vite)
- **Development server**: `cd frontend && npm run dev`
- **Build for production**: `cd frontend && npm run build`
- **Lint code**: `cd frontend && npm run lint`
- **Preview production build**: `cd frontend && npm run preview`
- **Install dependencies**: `cd frontend && npm install`

### Database
- **Create tables**: Run `backend/database/schema.sql` against PostgreSQL database, then the migrations in `backend/database/migrations/` (psql, in order)
- **Import/enrich data**: `backend/scripts/enrichFromSpotify.js` (dry-run by default) or the admin Staging tab's Sync — both import-only

## Architecture

### Backend Structure (`backend/`)
- **server.js**: Main Express server; mounts 7 routers: `/api/spotify`, `/api/admin`,
  `/api/playlists`, `/api/youtube`, `/api/submissions`, `/api/analytics`, `/api/analysis`
- **routes/**: `spotify.js` (public site API), `admin.js` (~2,200 lines, password-protected
  curation API — 29 routes in six banner-named domains: Songs/curation · Enrichment ·
  Data quality · Sync (import-only) · Artists · Staging/lifecycle; see
  `docs/ADMIN_AUDIT.md`), `playlists.js`, `youtube.js`, `submissions.js`, `analytics.js`.
  Dead code pruned in Session 2.2 (`admin_simple.js`, `lyrics.js`, ~33 endpoints).
  Note: `/api/submissions/admin*` is currently unauthenticated (Phase 4 item)
- **services/staging.js**: staging-queue service (queues, include/reject/publish, candidate
  intake, submissions→pending bridge); tests in `test/staging.test.js` (node:test)
- **services/analysis.js + services/metadataCodebook.js**: the lyric-analysis read. Every consumer
  (song page, browse facets, `/search` filters, `themeCounts`, the admin `needs-analysis` queue) reads
  each song's **latest coding pass** — the single newest `song_lyric_analysis` row by `MAX(analyzed_at)`,
  via the shared `LATEST_ANALYSIS` fragment (`DISTINCT ON (song_id) … ORDER BY analyzed_at DESC …`).
  **There is no hard-coded model string anywhere** — the old two-tier `CODE_MODEL`/`SCALAR_MODEL`/
  `ANY_TIER_SQL` constants were deleted (2026-07-25); selection is purely by recency. **Contract:** each
  pass must be written as one *complete* row per song, or a partial newer row would override a richer one.
  The song page **codebook-gates** thematic codes and scalars so it shows exactly what the browse filters
  count. The top summary comes from the `lyric_summary` column (exposed as `summary`); `hasAnalysisExists`/
  `hasCodesExists` are the shared has-analysis/has-codes EXISTS helpers. `metadataCodebook.js` is pure (no
  DB) and owns `data/master_metadata_codebook.json` — labels, definitions, the hidden absence codes, and
  the scalar filter clauses (the `target_audience` heading is **"Speaking to"**)
- **services/acousticCodebook.js**: the sibling codebook service for the **six acoustic dimensions**
  (`sonic_energy`, `emotional_mood`, `rhythmic_style`, `acoustic_type`, `vocal_delivery`, `tempo_bpm`) —
  audio-derived, stored on the same `song_lyric_analysis` row. Pure (no DB); owns
  `data/acoustic_codebook.json`. Headings are Energy · Mood · Rhythm · Instruments · Vocals · Tempo
  (`tempo_bpm` is an integer, so it lives in `TEMPO` **outside** `COMPONENTS` and filters as a range).
  **Its gating rule is the reverse of the lyrical one, deliberately:** display is *ungated* — `codeLabel`
  title-cases an off-codebook value instead of dropping it, so the page shows what the pipeline emitted —
  while filter selections *are* gated through `cleanSelection`. `analysis.js` adds `acousticFacets`
  (exclude-self sidebar counts) and `tempoRange`; `getSongAnalysis` returns an `acoustic` array in the
  **same cell shape as `attributes`**, which is what lets the song page render both with one loop.
  Acoustic filters reuse the existing `sca` latest-analysis join — **they add no new SQL join**
- **services/explore.js**: the read-only consumer of `song_coordinates` + `song_embeddings` behind the
  Explore map and the song page's "You might also like". Two halves. **The map:** space discovery is
  *data-driven* — it reads whichever `*_2d` columns the catalogue holds, so a space the pipeline adds
  appears with no code change — and `mapPayload` serves spaces, colour-by legends, coverage and all 640
  points in **one** response (~393KB), which is why switching space/colour/spotlight/search costs no
  further request. Colour-by is a curated low-cardinality menu; **parent genre folds to the top 3 +
  "Other genres"** because it carries 13 values against a 5-slot palette, and the fold is computed **once**
  and shared by the legend builder and the per-song code map so a point can never carry a bucket its own
  legend doesn't explain. **Similarity is a REGISTRY, not discovery** (`SIMILARITY`) — coordinates are
  interchangeable, but each embedding needs a metric and a normalisation judgement code must not guess:
  `message` is cosine over the full 768-dim `lyric_embedding`, `sound` is Euclidean **after per-dimension
  z-scoring** (without it the tab is a danceability ranking in disguise — sd 0.66 vs acousticness' 0.023).
  **Every query touching `audio_embedding` MUST carry `array_length(audio_embedding,1)=6`** — the column
  still holds 1,041 old 1024-dim rows. A tab is omitted when its embedding is missing; only when no tab
  has anything does the honest **"More in this genre"** fallback fire (692 of 1,333 live songs, 52%, have
  no embeddings). Read-only — never writes to any analysis table
- **database/db.js**: PostgreSQL connection pool; **database/schema.sql** + 6 add-on SQL files
- **scripts/**: 4 documented maintenance scripts (see `backend/scripts/README.md`);
  the ~37 one-off scripts were deleted in Session 2.3 (git history preserves them)
- **utils/genreMapping.js**: parent-genre mapping used by admin + search
- **utils/playlistSync.js**: truth-source-safe Spotify helpers (import-only playlist diff,
  add-as-pending, album/artist upserts) shared by `scripts/enrichFromSpotify.js` and the
  admin sync endpoints

### Frontend Structure (`frontend/`)
- **src/App.jsx** (~50 lines): router shell only — routes, header/nav, footer
- **src/pages/**: one file per route — HomePage, SongDetailPage, PlaylistsPage,
  PlaylistDetailPage, AboutPage, **ExplorePage** (a tab shell over `/explore` = Map and
  `/explore/data` = the analytics dashboard; **the standalone Dashboard nav item is retired and
  `/dashboard` redirects to `/explore/data`**). Single-consumer helpers stay local to their page file
- **src/components/**: 42 components (27 public + 15 admin) — public (SearchAndFilter,
  ArtistSearchResults, ArtistDetailPage, SongSubmissionForm, DataDashboard, MoodBadge,
  YouTubeEmbed, **SimilarSongs** (the song page's two embedding tabs + genre fallback), plus
  **`components/explore/`** — `ExploreMap` (hand-rolled canvas scatter, **no charting
  dependency**), `SelectedSongCard`, `useExplorePoints`, `palette.js` (categorical colours live in
  CSS as `--explore-cat-*` so theming stays in the token layer; JS only reads them) — plus the
  shared NavigationMenu, SongCard, PaginationControls) and admin
  (AdminInterface is a
  login + tab-nav shell over ManageSongsTab, ManagePlaylistsTab and the 8 other tab
  components; `CategorizationFields` is the one categorisation form shared by Manage
  Songs and Bulk Categorization). Song intake/sync lives in the Staging tab
  (Add candidates + import-only Sync + mismatch report); Duplicate Manager is
  data-quality only. **Two shared presentation primitives:** `FilterSection` — every
  browse-sidebar group is one, so they all collapse identically; it nests, which is how the
  five theme dimensions, seven metadata components and five acoustic dimensions read as the
  same unit. `ScalarFacetGroups` is generic over `{key: {heading, options}}` and renders both
  the "Lyric metadata" and the "Sound" families — don't fork it for a third. Its `note` is
  **usage help only** (caveats, what the options mean): the curator twice rejected
  definitional copy in the sidebar, so "what this filter is" text belongs on the About
  pages, not here — the API serves it (`scalarFacets`/`facetTree` `description`) but the
  browse UI deliberately ignores it. `InfoTip` — the tooltip used instead of the native
  `title` attribute (which waits ~1s and can't be styled); wraps its trigger, no icon
  variant (icons were removed as clutter). Use it for any new hover help. **Public playlists are read-only (browse-only)** — Session 3.3
  deleted `AddToPlaylistModal` and the create/remove-song UI (curator decision, no auth
  story yet); the backend playlist routes are untouched and still serve the admin
  Manage Playlists tab. Playlist creation returns to the public site in Phase 4+ once
  there's real auth
- **src/api/**: `spotifyService.js`, `playlistService.js`, and `adminApi.js` —
  admin code must fetch via `adminFetch` (relative `/api` URLs through the Vite proxy +
  `X-Admin-Password` header), never hardcode `localhost:5000` or the header
- **src/styles/**: the design system (Session 3.1, from the brand kit) —
  `tokens/{colors,typography,spacing}.css` (oklch warm-dark palette, Ember/Moss accents,
  Manrope/Public Sans), `base.css` (global element styles), `components.css` (core
  component classes; imported **after** `App.css` in `App.jsx` so it wins the cascade).
  New/updated styling must use the `--bg-*`/`--text-*`/`--accent-*`/`--space-*` tokens,
  never raw colors. `App.css` is the legacy monolith: its `:root` is a bridge re-pointing
  old variable names at the tokens; its page blocks are deleted (with their bridge
  entries) as Sessions 3.2/3.3 restyle each page
- See [`docs/FEATURE_INVENTORY.md`](docs/FEATURE_INVENTORY.md) for the full screen/endpoint
  audit with keep/rebuild/drop/defer decisions

### Database Schema
- **Core tables**: songs, artists, albums with many-to-many relationships
- **Truth source**: `songs.status` (`pending`/`included`/`rejected`) is curator-owned; the
  orthogonal `songs.published` flag marks included songs as ready-to-show (curator clicks
  Publish — never automatic). Every public route filters
  `status='included' AND published=true` and LEFT JOINs albums (non-Spotify songs have no
  album row). See `docs/TRUTH_SOURCE_DESIGN.md` + `docs/PUBLICATION_STAGING_DESIGN.md`.
  Migrations live in `backend/database/migrations/`
- **`song_lyrics` is LOCAL ONLY** (copyright): full lyrics for analysis; never SELECT it from
  an API route, never commit it (`backups/` and `backend/logs/` are gitignored), and exclude
  it from production dumps (`pg_dump --exclude-table-data=song_lyrics`)
- **Analysis-service tables** (written by the curator's separate analysis project; the web app is a
  **read-only** consumer): `song_lyric_analysis` (see `services/analysis.js`), `song_embeddings`
  (`lyric_embedding` 768-dim `float8[]`; `audio_embedding` — **careful: 6-dim
  `[energy, valence, danceability, acousticness, speechiness, normalized_bpm]` on newer rows but still
  1024-dim on ~1,041 older ones, so any distance query must constrain `array_length(...)=6`**), and
  `song_coordinates` (one row per song; eight `float8[]` UMAP projections —
  `{semantic,thematic,audio,holistic}_{2d,3d}`). Only ~640 live songs have coordinates/embeddings, and
  some rows belong to unpublished songs, so **public reads must still filter
  `status='included' AND published=true`**. No `pgvector` is installed — similarity is a multi-array
  `unnest` cosine/distance in SQL (measured median **224ms**, so no cache was built). All three tables are
  read through `services/explore.js` via `GET /api/analysis/explore/points` and
  `GET /api/analysis/songs/:id/similar`. **`frontend/public/vector_space.json` is deleted** (B4): it was
  superseded by `song_coordinates` and was a real publication-staging leak — being a static asset it
  bypassed the publish filter every API route enforces, exposing 22 unpublished + 2 pending songs
- **Categorization**: Flexible TEXT[] arrays for vegan focus, advocacy styles, animal categories
- **User features**: playlists, playlist_songs for user-generated content
- **Spotify integration**: Stores spotify_id, URLs, and metadata — enrichment only,
  import-only sync; never overwrites curatorial fields

## Key Features

### Spotify Integration
- Uses `spotify-web-api-node` library with client credentials flow
- Fetches playlist data, track metadata, artist info, and audio features
- Backend routes: `/api/spotify/playlist/:id`, `/api/spotify/songs/featured`, `/api/spotify/search`

### Database Operations
- PostgreSQL with complex joins for song-artist-album relationships
- Full-text search across songs, artists, and albums
- Pagination support for large datasets
- Random/featured song selection for homepage

### Frontend Features
- React Router for navigation between Browse Songs, Artists, Playlists, About
- Dynamic stats display fetched from database
- Song cards with play buttons and navigation to detail pages
- Responsive design with CSS styling

## Environment Setup

### Required Environment Variables (backend/.env)
```
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
DB_HOST=localhost
DB_PORT=5432
DB_NAME=vegan_playlist
DB_USER=your_pg_user
DB_PASSWORD=your_pg_password
ADMIN_PASSWORD=shared_admin_password
PORT=5000
```

**Note:** `database/db.js` reads the five discrete `DB_*` vars above — there is **no `DATABASE_URL`**
(earlier docs claimed one; scripts that build their own pool must use the `DB_*` vars).

### Development Workflow
1. Start PostgreSQL database
2. Run database schema setup
3. Configure backend environment variables
4. Start backend: `cd backend && npm run dev`
5. Start frontend: `cd frontend && npm run dev`
6. Backend runs on port 5000, frontend on Vite's default port

## Important Notes

- Backend uses PostgreSQL with connection pooling via `pg` library
- Frontend communicates with backend API at `http://localhost:5000/api/spotify`
- Song categorization system uses flexible TEXT[] arrays for multiple values per category
- Spotify API requires client credentials for public playlist access
- Project follows monorepo structure with separate package.json files for frontend/backend