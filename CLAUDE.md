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
- **Import/enrich data**: `backend/scripts/enrichFromSpotify.js` (dry-run by default) or the admin Dashboard's **Spotify playlist** card (Pull) — both import-only

## Architecture

### Backend Structure (`backend/`)
- **server.js**: Main Express server; mounts 9 routers: `/api/spotify`, `/api/admin`,
  `/api/playlists`, `/api/youtube`, `/api/submissions`, `/api/analytics`, `/api/analysis`,
  `/api/content`, `/api/spotify-auth` (**separate from `admin.js` on purpose:** `admin.js` checks `X-Admin-Password`
  on every route and Spotify's redirect back to us is a plain browser navigation that cannot send it —
  `POST /start` + `GET /status` are header-authed, `GET /callback` is guarded by a single-use 10-minute `state`)
- **routes/**: `spotify.js` (public site API), `admin.js` (~2,200 lines, password-protected
  curation API in six banner-named domains: Songs/curation (incl. the Submissions Inbox) ·
  Enrichment · Data quality · Sync (import-only) · Artists · Staging/lifecycle, plus the Band check routes; see
  `docs/ADMIN_AUDIT.md`), `playlists.js`, `youtube.js`, `submissions.js`, `analytics.js`,
  `content.js` (triage 6 — the two-route `GET /api/content/:slug` read behind the About
  section's Markdown pages; the `slug` is looked up in a hard-coded `Map` of `{about, analysis}`
  → filename, deliberately **not** a plain object, since a plain-object lookup of `constructor`
  returns a truthy inherited function that would then be used as a filename — 404 for anything
  else, so path traversal is impossible by construction rather than by sanitising).
  Dead code pruned in Session 2.2 (`admin_simple.js`, `lyrics.js`, ~33 endpoints).
  `submissions.js` is now **public-only** (`POST /submit`); submissions moderation lives in `admin.js`
  (`/curation/inbox*`, authed) — the old unauthenticated `/api/submissions/admin*` routes were deleted in C
- **services/staging.js**: staging-queue service (queues, include/reject/publish, candidate
  intake, submissions→pending bridge); tests in `test/staging.test.js` (node:test)
- **services/spotifyAuth.js + services/spotifyPush.js** (sub-project F, Spotify sync): `spotifyAuth` is the one-time
  Authorization-Code sign-in (scopes `playlist-modify-public/private` only) keeping **only a refresh token in the
  gitignored `backend/.spotify-token.json`** (no DB row, per-machine); `getAccessToken()` refreshes per use. **Nothing there
  may log or rethrow the code, a token, a request body or a fetch error's message** (errors are fixed strings + `.code`:
  NOT_CONNECTED / REAUTH / UPSTREAM; REAUTH only for `invalid_grant` on a *refresh*). `spotifyPush` is **add-only,
  click-only and never writes the DB**: `compare` buckets pullable / pushable / possibleDuplicates / noSpotifyId /
  onPlaylistNotLive; `pushSongs` re-reads the **live** playlist first (idempotent), adds in chunks of 100 via a direct
  `POST /v1/playlists/{id}/items` (the library's `/tracks` write path is reportedly 403'd by Spotify's March-2026 dev-mode
  change; reads work on both), one push at a time (`BUSY`), 429 with Retry-After > 30s fails fast. **Possible duplicate** =
  same normalised title + first artist (`staging.normalizeName`, which strips parentheticals and " - …") as a playlist
  track with a *different* id — unless that playlist track is itself a **live** catalogue song (Vox 2 / Vox 3). Duplicates
  leave the push list and the bulk push; only an explicit per-song push with `allowDuplicates` overrides. Compare's playlist
  read is a slim parallel read (`fetchPlaylistTracksLite`, ~3s) cached 60s (`?fresh=1` bypasses but writes; a
  generation counter stops a pre-push read re-caching); push never uses the cache. Routes: `GET /api/admin/spotify/compare`,
  `POST /api/admin/spotify/push`; pull is the unchanged import-only `POST /api/admin/sync-spotify-playlist` (needs a JSON
  body — `adminFetch` must send `body: {}`).
- **services/youtubeSearch.js**: the workbench's "Find videos" (sub-project D) over the **official YouTube
  Data API v3** — `searchVideos` (`search.list` ~100 quota units + `videos.list` 1 unit; 10,000/day, so ~99
  searches), `findCandidatesForSong` (query = **first-listed artist** + title, i.e. the lowest
  `song_artists.id`, because joining a collaboration's artists made YouTube return nothing; flags
  `already_added`), and the pure `guessType` (lyric → live → official → other; `fan-made` is never guessed).
  `fetch` is injected so the tests never touch the network. **The key is in the request URL, so nothing may
  log or rethrow a URL, a fetch error's message or its `.cause`** — errors carry only the HTTP status and
  Google's `reason`, mapped to `QUOTA` (429) / `CONFIG` (bad or disabled key, 502 with a fix-the-key message)
  / `UPSTREAM` (502). `videos.addVideos` is the transactional bulk add (1–10 items, duplicates skipped, any
  invalid item rolls back the batch). The dead mock `POST /api/youtube/search` was deleted
- **services/lyricsQuality.js + services/junkLyrics.js** (sub-project G): `lyricsQuality.classify` is the pure detector
  (`error` stubs from failed scrapers; `youtube_description` boilerplate — strong patterns alone, two weak markers together, a `[Verse`
  header vetoes). `junkLyrics` maintains `song_lyrics.junk_kind` / `junk_dismissed` (scan / listJunk / dismiss / recheck; `saveLyrics`
  re-checks on every text change). **Invariants:** a flagged song's analysis is excluded by `NOT_JUNK` inside the shared `LATEST_ANALYSIS` and
  `hasAnalysisExists` (so every public read hides it, no per-query edits), and `curation.HAS_LYRICS_SQL` requires `junk_kind IS NULL` so it reads
  (Public hiding is also **row-level stale**: real lyrics replacing flagged junk stamp `analysis_stale_since`, hiding older passes until a newer one exists; the
  Explore map additionally requires `hasRealLyricsExists` + `hasAnalysisExists`.) (A **blank** flagged row keeps its flag - Clear lyrics must not resurrect the junk-derived analysis - and is excluded from the Junk queue; real
  lyrics saved later let `recheck` decide.)   as having no lyrics. `scan(db, {songIds})` — tests must always pass `songIds`. `listJunk` is the only admin read of lyric text and truncates
  to 120 chars server-side
- **services/bandCheck/** (sub-project H, multi-source Band check): per-band, on-demand review of a band's catalogue across **Spotify, Bandcamp and MusicBrainz**.
  Three injected adapters (`spotify.js`, `bandcamp.js` reads the page's embedded JSON-LD, `musicbrainz.js` paced ~1.1s/request; `http.js` `defaultFetch`), the pure
  `merge.js` (`keyOf` Unicode-aware title key, `mergeCatalogues`, `buildIndex`/`classify` vs the catalogue by spotify id / bandcamp url / title), and `index.js`
  (`listBands`, `identifyCandidates`, `saveIdentity`, `checkBand`, `addSelected`). **Identity is curator-confirmed per source** in `artists.spotify_id` (replace, never
  clear; `spotify_url` written with it) / `artists.bandcamp_url` / `artists.musicbrainz_id` (migration 014). Sources fail independently on read (coded errors, 5-minute
  cache, `?fresh`), but **any failed source aborts an add**; one add at a time (`BUSY`), cap 100 (I2: `addSelected` also takes `rejectKeys` - those new songs are saved as `rejected` rows, flipped only among the pending rows that same apply just created, so an existing catalogue song is never touched; `keys.length + rejectKeys.length` is the cap, a key in both lists is `BAD_INPUT`, the response carries `rejected`). **Nothing may log or rethrow a fetch error's message, URL or token.**
  Five routes under `/api/admin/band-check/...`; adds go through `staging.insertManualCandidate` / `insertCandidates` as pending, tagged `bandcheck` ("From band check").
  Tests: `test/bandCheck*.test.js`. Frontend: `components/admin/CatalogueReview.jsx` (the artist workbench's Catalogue panel: per-song Process/Reject choice applied in one action, plus "mark catalogue reviewed" prompts shown only after a complete error-free read) + `IdentifyPanel.jsx` (its Links panel) over `bandCheckApi.js`; the old Songs > Band check view was retired in I1
- **services/artists.js** (sub-project I1, Artists area): the admin Artists queues, list, read and update. The five queue predicates (`needs-identity`, `needs-check`, `needs-bio`,
  `needs-notes`, `done`; plus `all`) live in ONE `PREDICATE` table feeding both `counts()` and `list()`, so a rail count cannot disagree with its list; search is literal
  (`%`/`_` escaped) and the list and count queries share one filter (the old `/all-artists` reused a `$3` placeholder in the count query and failed on any search). `update` writes
  only whitelisted artist columns (never `songs`) and **never identity** - `bandCheck.saveIdentity` is the single writer of `spotify_id`/`bandcamp_url`/`musicbrainz_id`.
  `artists.no_advocacy_notes_needed` (migration 015) lets an artist leave the notes queue. `discography_reviewed` now means "catalogue checked via Band check". Routes: `GET /api/admin/artists/queues`,
  `GET /api/admin/artists`, `GET|PUT /api/admin/artists/:id` (the old `/all-artists`, `/artists-stats` are gone). Tests: `test/artists.test.js` (sentinel `ZZZART`)
- **services/inbox.js**: the Submissions Inbox (sub-project C) — `listInbox` (pending, **oldest first**,
  catalogue match flagged with `live`), `acceptSubmission`, `dismissSubmission`. **Accept claims the row
  first** (`approved`, match cleared) and only then bridges via staging, reverting to `pending` if the bridge
  throws or yields no song — so a concurrent accept/dismiss gets `NOT_PENDING` and can't orphan a song.
  The submit-time match is a fuzzy prefix match, so Accept stays available on matched rows; staging's
  title|artist dedupe makes an exact duplicate resolve to the existing song. Tests in `test/inbox.test.js`
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
  appears with no code change — with **one named exception, `HIDDEN_SPACES`** (currently `semantic`, dropped
  at the curator's 2026-08-02 smoke); un-hiding is deleting a word from that set. Each space also carries a
  short `description` saying what it was built from (`SPACE_DESCRIPTIONS`; unknown spaces serve `null` and
  the page renders nothing). `mapPayload` serves spaces, colour-by legends, coverage and all 640
  points in **one** response (~393KB), which is why switching space/colour/spotlight/search costs no
  further request. **Both the `space` and `colour` URL params are validated against what the catalogue
  actually serves** — a stale shared link falls back to the default rather than drawing an empty or all-grey
  map. Colour-by is a curated low-cardinality menu. **Genre names every value but colours only
  the top 3**: a song carries its *raw* parent genre, while the legend gives slots 1–3 to the top three by
  count and lists every remaining genre as a named `child` of an "Other genres" group that **shares slot 4**
  — so a 1-song genre is visible and individually spotlightable without a colour of its own. That split
  was designed when **four simultaneous categorical colours was the measured ceiling** (the `dataviz` skill's
  documented 8 hues score 9.8 for 5 colours on the all-pairs normal-vision gate against a floor of 15). On
  2026-10-01 the palette was replaced by a **searched 7-colour set that passes every gate in both modes** (worst
  CVD 9.5, normal 18.3; `components.css` holds the values and validator command) so the Vocals dimension (5 live
  codes, 7 in the codebook) keeps all its codes; genre keeps the top-3 + Other split, now a choice and not a
  limit. The top-N set
  is computed **once** and shared by the legend builder and the colour assignment, so a point can never carry
  a bucket its own legend doesn't explain. Spotlight state holds raw codes, and a group toggle is tri-state
  (`aria-pressed="mixed"` when only some members are lit). **Similarity is a REGISTRY, not discovery** (`SIMILARITY`) — coordinates are
  interchangeable, but each embedding needs a metric and a normalisation judgement code must not guess:
  `message` is cosine over the full 768-dim `lyric_embedding`, `sound` is Euclidean **after per-dimension
  z-scoring** (without it the tab is a danceability ranking in disguise — sd 0.66 vs acousticness' 0.023).
  **Every query touching `audio_embedding` MUST carry `array_length(audio_embedding,1)=6`** — the column
  still holds 1,041 old 1024-dim rows. A tab is omitted when its embedding is missing; only when no tab
  has anything does the honest **"More in this genre"** fallback fire (692 of 1,333 live songs, 52%, have
  no embeddings). Read-only — never writes to any analysis table
- **services/referenceCodebook.js**: the read behind the About section's Reference tab
  (`GET /api/analysis/codebook`). **Composes** `metadataCodebook.js`, `acousticCodebook.js` and the
  taxonomy rather than re-reading their JSON, so label rules and suppression stay owned in one place
  each. Deliberately a **different** shape from `analysis.facetTree`: the facet tree drops any code
  with a zero count and carries no definition (right for a filter sidebar), while the reference lists
  **all 107 thematic terms including zero-count ones**, all 7 lyric-metadata components and all 6
  acoustic dimensions — a term nobody's song currently carries is itself information on a glossary
  page. Two small getters were added to `acousticCodebook.js` for this (`derivationSource(key)`,
  `codeThreshold(key, code)`), following the existing `componentDescription`/`codeDefinition` shape.
  Counts are **16 count queries** — one per family member (4 thematic dimensions + 7 metadata
  components + 5 acoustic dimensions) — **plus 5 coverage queries**, all reusing the shared
  `LATEST_ANALYSIS` fragment and the `status='included' AND published=true` gate, exactly like every
  other public read — this is
  the one invariant a future change here must not drift from, or the reference page will disagree
  with the browse sidebar. The response also carries a `coverage` block (live-song/artist/analysed/
  mapped counts, plus the latest coding pass's models and date) that both the Reference tab and the
  explainer's `{{tokens}}` read
- **`backend/data/{about,analysis}.md`**: **curator-editable copy served live** by
  `GET /api/content/:slug` — edit the file, refresh the browser, no rebuild needed. Both ship with a
  complete first draft; the curator's prose replaces the drafted text in place. Live figures reach the
  prose as `{{tokens}}` (`frontend/src/utils/contentTokens.js`'s `substituteTokens`, pure/DOM-free/
  node-tested) — `{{songs}}`, `{{artists}}`, `{{analysed}}`, `{{analysedPct}}`, `{{mapped}}`,
  `{{codingModels}}`, `{{codingDate}}` — so the sentence stays under curator control while the number
  in it tracks the live data. An **unrecognised token renders as itself** rather than vanishing, which
  is what makes a typo visible. The same two files are also imported at build time via Vite's `?raw`
  as a **bundled fallback** (one file in git, not two, so it can't drift from the live copy) — a
  build-time snapshot that goes stale until the next build if the curator edits after deploying, which
  is correct: the fallback exists for an unreachable API, not for freshness
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
  PlaylistDetailPage, **ExplorePage** (a tab shell over `/explore` = Map and
  `/explore/data` = the analytics dashboard; **the standalone Dashboard nav item is retired and
  `/dashboard` redirects to `/explore/data`**), **AboutPage** (triage 6 — became a second tab
  shell mirroring `ExplorePage`'s pattern, `NavLink` × 3 + `Outlet`, over three routes:
  `/about` → `pages/about/AboutOverview.jsx`, `/about/analysis` →
  `pages/about/AnalysisExplainer.jsx` ("How the analysis works" — the AI-disclosure explainer),
  `/about/reference` → `pages/about/AnalysisReference.jsx` (the 107-term/7-component/6-dimension
  glossary, one scroll with a sticky jump nav, each term's count linking through to a filtered
  browse via `termHref` on `utils/browseUrlState.js` — a zero-count term's count renders as plain
  text instead, since a link to an empty result set is a dead end). `/about` keeps working exactly
  as before, so no existing link breaks. All three consume `pages/about/useCodebook.js`, a small
  hook fetching `GET /api/analysis/codebook` once and sharing it across the tabs. Single-consumer
  helpers stay local to their page file
- **src/components/**: components (public + admin; the **Artists area** - `ArtistsArea` + `ArtistQueueList` (rail and list, `/admin/artists?queue=&q=&page=`) and `ArtistWorkbench` (`/admin/artist/:id`: Details, Links, Catalogue = Band check, Notes); `QueueRail` takes a `groups` prop so both areas share it; **SpotifySyncCard** on the Dashboard and **SpotifyLists**, the Songs > Spotify sync view) — public (SearchAndFilter,
  ArtistSearchResults, ArtistDetailPage, SongSubmissionForm, DataDashboard, MoodBadge,
  YouTubeEmbed, **SimilarSongs** (the song page's two embedding tabs + genre fallback), plus
  **`components/explore/`** — `ExploreMap` (hand-rolled canvas scatter, **no charting
  dependency**), `exploreUrlState.js` (every `derive*`/`format*` that reads or writes the map's URL
  params — space, colour, spotlight, search, selection, and the `view=k,tx,ty` viewport — pulled
  into one pure, DOM-free module because the B4 final review found three separate URL-state
  defects all living in one unextracted block of `ExploreMap.jsx`; being pure lets `node --test`
  exercise it directly with no frontend test runner), `mapGeometry.js` (pure fit/zoom/pan geometry
  — `layout()`, `clampView`, `zoomAtPoint`, `FIT_VIEW`, `MIN_K`/`MAX_K` — shared by the gesture
  hook and the draw loop so the maths that moves the map and the maths that draws it can never
  disagree; also pure and node-tested), `useMapTransform.js` (the gesture hook: a non-passive
  wheel listener zooming toward the cursor, drag-pan with a 4px click-vs-drag threshold, the
  `+`/`−`/Reset buttons, and a 300ms debounced URL commit — kept out of `ExploreMap.jsx` because
  it is imperative pointer/wheel-event plumbing, not rendering), `SelectedSongCard`,
  `useExplorePoints`, `palette.js` (categorical colours live in
  CSS as `--explore-cat-*` so theming stays in the token layer; JS only reads them) — plus the
  shared NavigationMenu, SongCard, PaginationControls) and admin
  (AdminInterface is a
  login + tab-nav shell over ManageSongsTab, ManagePlaylistsTab and the 8 other tab
  components; `CategorizationFields` is the one categorisation form shared by Manage
  Songs and Bulk Categorization). Song intake lives in the Staging tab
  (Add candidates); Spotify sync (Pull / Push / Refresh, with its five lists under Songs > Spotify sync) lives in the Dashboard
  card; queue rows carry an `origin` tag ("From Spotify" / "From submit form"); Duplicate Manager is
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
  variant (icons were removed as clutter). Use it for any new hover help. **A third, from triage 6:
  `MarkdownPage`** — fetches `GET /api/content/:slug`, substitutes `{{tokens}}` via
  `utils/contentTokens.js`, then renders with `react-markdown` + `remark-gfm` (the project's first
  new frontend dependency in a long while — a deliberate exception to the avoid-a-dependency habit
  formed against the *charting* library the Explore scatter hand-rolls instead of importing; a
  Markdown parser is a different problem, correctness-critical and thoroughly solved, where a
  hand-rolled subset fails by *silently* rendering a construct as literal text). On fetch failure it
  falls back to the matching `backend/data/*.md` file bundled at build time via Vite's `?raw`, with
  no visible error UI — a visitor should never see the site's own plumbing. `react-markdown` escapes
  raw HTML by default and no raw-HTML plugin is added; that default is load-bearing, since the
  Markdown arrives over HTTP from a file on disk. **Public playlists are read-only (browse-only)** — Session 3.3
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
  import-only sync (pull), plus an add-only user-auth push; never overwrites curatorial fields and never removes playlist tracks

## Key Features

### Spotify Integration
- Uses `spotify-web-api-node` library with client credentials flow for reads; playlist **writes** use the signed-in user's refresh token (see `spotifyAuth`)
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
YOUTUBE_API_KEY=optional_youtube_data_api_v3_key   # workbench "Find videos"; search is disabled when unset
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5000/api/spotify-auth/callback   # must match a Redirect URI registered in the Spotify dashboard
ADMIN_RETURN_URL=http://localhost:5173/admin   # where the OAuth callback sends the browser afterwards
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