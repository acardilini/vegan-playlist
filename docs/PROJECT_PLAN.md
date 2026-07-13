# The Vegan Playlist — Modernisation Project Plan

_Last updated: 2026-07-06_

This is the phased roadmap for modernising the prototype into a clean, branded, deployable
product. See [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md) for the philosophy and
[`PROJECT_STATE.md`](./PROJECT_STATE.md) for where we currently are.

## How This Plan Works

- **Phases** are large, ordered stages of the modernisation. Finish one before starting the
  next (though Phase 0 findings may re-shape later phases).
- **Sessions** are the unit of work inside a phase — one focused chunk completable in a
  single working session. Sessions are a guide, not a contract; split or merge as reality
  demands, and record any change in `PROJECT_STATE.md`.
- **Smoke test** — every session that changes code ends with one: launch the backend and
  frontend and exercise the affected flow (as a user would), confirming nothing broke.
  Audit/design-only sessions have no smoke test (nothing to run) — note that instead.
- **YAGNI governs everything** — defer anything not needed now.

Legend: ☐ not started · ◐ in progress · ☑ complete

---

## Phase 0 — Discovery & Audit
**Goal:** Capture the full current state so nothing is lost. No production code changes.
**Exit criteria:** Feature Inventory complete; DB and Spotify audits documented; truth-source
model designed and recorded as a decision.

- ☑ **Session 0.1 — Feature Inventory.** Walk every screen and every endpoint of the running
  prototype. For each feature record: what it does, where it lives, what data it touches, and
  a decision (keep / rebuild / drop / defer). Output: a Feature Inventory document.
  _Smoke test: n/a (audit only). Done 2026-07-07 → [`FEATURE_INVENTORY.md`](./FEATURE_INVENTORY.md)._
- ☑ **Session 0.2 — Database audit.** Document the real schema (including migration files),
  row counts, data-quality issues, orphaned records, and the categorisation data actually
  present vs. empty. _Smoke test: n/a (read-only audit). Done 2026-07-07 →
  [`DATABASE_AUDIT.md`](./DATABASE_AUDIT.md). Headline: the DB holds NO curatorial data —
  all categorisation/review fields are empty; 1,208 = 674 (2025 import) + 534 (Apr 2026
  import); 18 true duplicate pairs; audio features all NULL and unobtainable from Spotify._
- ☑ **Session 0.3 — Spotify API audit.** Document what is currently pulled, what the API
  offers that we could use, the sync mechanism, auth flow, and rate limits. Identify which
  fields should be "enrichment" vs. "truth". _Done 2026-07-07 →
  [`SPOTIFY_API_AUDIT.md`](./SPOTIFY_API_AUDIT.md). Headlines: album covers still available —
  missing ones are our sync's bug (backfillable); audio features/previews/recommendations
  confirmed dead for this app; live playlist = 1,216 tracks vs 1,208 in DB. Shipped one fix:
  sync endpoints defaulted to the WRONG playlist (a Lofi Girl list) — now the real one._
- ☑ **Session 0.4 — Truth-source & data-source strategy.** Design the authoritative data
  model: how the curated dataset becomes the source of truth, how Spotify enrichment attaches,
  and how the messy new-songs file will be consolidated. Record as a decision. _Done
  2026-07-07 → [`TRUTH_SOURCE_DESIGN.md`](./TRUTH_SOURCE_DESIGN.md) (approved by curator).
  **Phase 0 exit criteria met — Phase 0 complete.**_

## Phase 1 — Data Foundation (Truth Source) ✅ complete (2026-07-08)
**Goal:** Stand up the authoritative dataset and the Spotify-enrichment approach.
**Exit criteria:** A single trusted dataset containing existing + newly identified songs;
enrichment pipeline defined; curatorial fields protected from sync overwrites. — _Met: truth
source + publication staging live, enrichment pipeline shipped, integrity pass done, and the
staging-queue admin UI (1.4) gives the curator end-to-end control over the pending → included →
published lifecycle._

- ☑ **Session 1.1 — Schema migration + consolidation import.** Per
  [`TRUTH_SOURCE_DESIGN.md`](./TRUTH_SOURCE_DESIGN.md): add `status`/`lyrics_status`/link
  columns + local-only `song_lyrics` table (first tracked migration file); import both
  spreadsheets (idempotent script, dry-run first, DB backup); public routes filter to
  `status='included'`. _Smoke test: site shows only included songs; counts match the design's
  expected end state; no lyrics reachable via API._ _Done 2026-07-07: migration
  `001_truth_source.sql` + `scripts/consolidateSpreadsheets.js`. End state 1,398 included /
  175 pending / 243 rejected / 929 local lyrics (matches design ±the 18 sheet-vs-DB status
  conflicts, reported not applied). Public routes also gained LEFT JOIN albums so
  non-Spotify songs render. Smoke test ✅._
- ☑ **Session 1.2 — Spotify enrichment pipeline.** Implement/adjust so the truth source is
  authoritative and Spotify fills details where a match exists, without overwriting
  curatorial data. Includes the queued backfill: re-enrich the 534 Apr-2026 songs (275 bare
  albums — covers/dates — and ~245 bare artists), and close the 8-track gap to the live
  playlist. Replaces all three legacy import paths (see `SPOTIFY_API_AUDIT.md` §3).
  _Smoke test: run enrichment on a sample, confirm reviews/coding untouched._ _Done
  2026-07-07: `scripts/enrichFromSpotify.js` + `utils/playlistSync.js`; 151/190 manual songs
  attached (34 to review in 1.3), all albums backfilled (covers/dates/labels), 414 artists
  enriched, 3 playlist tracks added as pending; admin sync endpoints rebuilt import-only.
  Curatorial md5 checksum byte-identical pre/post ✅._
- ☑ **Session 1.2b — Publication staging** (curator-requested, designed + approved
  2026-07-07 → [`PUBLICATION_STAGING_DESIGN.md`](./PUBLICATION_STAGING_DESIGN.md)).
  `published` flag orthogonal to `status`; public site = included **and** published;
  publish/unpublish admin endpoints; 1,359 grandfathered live, 39 in To-finalise.
  _Smoke test ✅: totals 1,359, publish/unpublish cycle, 409 on non-included._
- ☑ **Session 1.3 — Data integrity pass.** Merged the 18 duplicate pairs (kept the 2025
  canonical with its enrichment/YouTube; backfilled only NULL enrichment scalars; the one
  loser-side YouTube video was re-pointed, not lost). Swept 19 orphan albums + 1 orphan
  artist (Flaex — Queen V was no longer orphaned). Re-ran the consolidation: file-1
  multi-matches 27 → 5, lyrics applied to the newly-unblocked rows (song_lyrics 929 → 947).
  End state: **1,801 songs / 1,380 included / 1,341 live / 178 pending / 243 rejected**;
  0 orphans. Remaining curator judgment calls captured in
  [`SESSION_1.3_CURATOR_DECISIONS.md`](./SESSION_1.3_CURATOR_DECISIONS.md) (status conflicts,
  attach typos vs not-on-Spotify, a new CLEARxCUT dup from the 1.2 diff, unmatched rows).
  _Smoke test ✅: db-stats=1341, merged songs render with artists, search returns one row per
  former dup, deleted dup ids 404._
- ☑ **Session 1.4 — Minimal staging-queue admin UI.** Staging tab in `AdminInterface` with
  four sub-views per `PUBLICATION_STAGING_DESIGN.md`: **To process** (pending — Attach
  Spotify / Add play link / Include / Include&Publish / Reject), **To finalise** (included
  but unpublished — shows missing play link/artwork, Publish button), **Live** (published,
  search-to-find — Unpublish), and **Add candidates** (bulk Spotify track/playlist URL
  intake → pending, with spotify_id + title/artist dedupe). Lyrics paste + categorisation
  deferred (categorisation is non-essential per the design §4; YAGNI). Backend =
  `services/staging.js` + 6 admin endpoints + 13 node:test cases. _Smoke test ✅: totals 177
  pending / 39 to-finalise; include/reject/play-link/publish/unpublish and candidate-dedupe
  all exercised reversibly against the real DB, state restored byte-for-byte; frontend build
  clean._ **Branch `session-1.4-staging-queue` awaiting merge to `main` after curator
  click-through.**

## Phase 2 — Architecture Cleanup
**Goal:** A maintainable codebase, same behaviour.
**Exit criteria:** `App.jsx` decomposed into pages/components; dead scripts and duplicate
routes pruned; clear frontend/backend structure and conventions documented.

- ☑ **Session 2.1 — Frontend decomposition** _(done 2026-07-08)_. Extracted the five inline
  pages from `App.jsx` (2,001 → 49 lines) into `src/pages/` (Home, Song Detail, Playlists,
  Playlist Detail, About) and the shared inline components into `src/components/`
  (NavigationMenu, SongCard, PaginationControls, AddToPlaylistModal); deleted the dead
  `ArtistsPage` (~270 lines, Phase 0 drop) and unused `DescriptionSection`. _Smoke test ✅:
  all 9 routes rendered headlessly against the live backend — pages, data, search
  (`?q=vegan` → 198 hits), bad-song-id error state, admin login all behave as before;
  build + lint clean._
- ☑ **Session 2.2 — Backend consolidation** _(done 2026-07-08)_. Executed the admin audit
  ([`ADMIN_AUDIT.md`](./ADMIN_AUDIT.md)): deleted the 17 dead `admin.js` routes +
  `admin_simple.js`; converted the 2 DDL-over-HTTP routes to catch-up migrations
  (`003_lyrics_links.sql`, `004_discography_tracking.sql`) and removed their UI callers;
  grouped the 28 live routes into six banner-named domains in `admin.js` (2,926 → 2,237
  lines); added the submissions→pending bridge `POST /api/admin/submissions/:id/add-to-pending`
  (`staging.addSubmissionAsPending`, +4 node:test cases, 17/17 green); executed the Phase 0
  inventory's other drops (9 spotify.js debug/dead routes incl. `GET /artists`, 3 youtube.js
  routes, the lyrics.js router file, submissions `GET /stats`, analytics
  `GET /audio-features` + its Dashboard chart/filter). Net −1,779 lines. _Smoke test ✅:
  44/44 HTTP checks — public API intact (db-stats 1342, search 198 for `vegan`,
  song detail/similar, analytics, playlists, youtube), every deleted route 404s, all 28+1
  admin routes exercised incl. the live Spotify mismatch report, auth 401s without the
  password; frontend build + lint clean._
- ☑ **Session 2.2b — Admin UI consolidation** _(done 2026-07-09)_. Per `ADMIN_AUDIT.md` §3:
  shared `adminFetch` helper (`src/api/adminApi.js`, relative `/api` URLs + password header,
  all 11 admin components); `AdminInterface.jsx` 2,327 → 176 lines (Manage Songs/Playlists →
  `ManageSongsTab.jsx`/`ManagePlaylistsTab.jsx`); one shared `CategorizationFields.jsx`
  behind the manual-song form, edit modal, and Bulk Categorization; Sync + mismatch report
  moved into Staging → Add candidates (first *working* sync UI — the old buttons' functions
  were dead code); Duplicate Manager pure data-quality (dead removed-songs view deleted);
  Submissions "Approve & add to pending" wired to the authed 2.2 bridge. Net ≈ −975 lines.
  _Smoke test ✅ 28/28: headless walk of all 10 tabs + live mismatch report + end-to-end
  submission→pending bridge run, verified in DB and cleaned up; node:test 17/17._
- ☑ **Session 2.3 — Script cleanup** _(done 2026-07-10)_. Deleted 37 of the 41 one-off
  scripts (git history preserves them); kept 4 documented in a new
  `backend/scripts/README.md`: `consolidateSpreadsheets.js`, `enrichFromSpotify.js`,
  `auditDatabase.js`, `exportAllSongsData.js` (+ `database/migrations/` as the schema
  channel). Deviation from the Phase 0 inventory keep-list recorded in the Decision Log
  (`importSpotifyDataEnhanced.js`/`syncSpotifyPlaylist.js` superseded by the 1.2 pipeline;
  `runMigration.js` was hardcoded one-off DDL, not a runner). Stale sync docs in
  `README.md`/`CLAUDE.md` rewritten to the truth-source model. _Smoke test ✅: retained
  `auditDatabase.js` ran clean (read-only); backend started, public featured + search
  routes serve real data (search `vegan` = 198, unchanged)._

## Phase 3 — Brand & UI Rebuild
**Goal:** Apply the brand kit onto the now-clean frontend.
**Exit criteria:** Design system in place; all pages restyled to brand; responsive and
accessible. — _Met — **Phase 3 complete** (3.3 merged to `main` 2026-07-12 on curator
go-ahead): design system live since 3.1, every route
restyled to brand across 3.1–3.3, full-route smoke test found zero horizontal overflow
at 390px and zero console errors on all 11 routes, and Session 3.3's accessibility pass
added keyboard access + aria-labels + one-h1-per-route + focus-visible rings site-wide._

- ☑ **Session 3.1 — Design system foundation.** _Done 2026-07-10; merged to `main`
  2026-07-10 after curator click-through._ Brand-kit tokens →
  `frontend/src/styles/tokens/` + `base.css` + `components.css` (imported after App.css
  to win the cascade); legacy `:root` bridged to tokens so every page re-brands at once;
  Spotify greens + gradients swept; SongCard/MoodBadge de-emoji'd, striped artwork
  placeholder. Bonus: found + fixed the CSS bug (orphaned media query hiding
  `.song-artwork` globally) that had hidden all album covers — the "broken cover API"
  myth. _Smoke test ✅: home (desktop+mobile), song detail, artists, playlists render
  with brand styling; build + lint clean._
- ☑ **Session 3.2 — Public pages restyle.** _Done 2026-07-11; merged to `main`
  2026-07-11 after curator click-through._ Home (kit hero + stat badges +
  new copy), Browse/Search (token restyle of the filter suite), Song Detail (kit 16:9
  scrim hero; "Animal advocacy analysis" renamed + hidden when uncoded — curator
  request; dead audio-features panel removed), Artists (kit cards + photo-hero profile
  with popularity bars). ~2,700 lines of legacy App.css deleted; shared page vocabulary
  added to components.css. _Smoke test ✅: headless walk of all four pages at 1280 +
  390; build + lint clean (0 errors)._
- ☑ **Session 3.3 — Remaining pages & polish.** _Done 2026-07-11; merged to `main`
  2026-07-12 (merge `48a4529`) after curator go-ahead._
  Playlists made read-only (curator decision — create/remove controls deleted,
  `AddToPlaylistModal` removed; backend untouched), Playlist Detail restyled to
  artist-page row conventions (fixes the 3.2 40px-thumbnail clash), Submit (kit form +
  guidelines sidebar), Dashboard (kit layout, brand-token Chart.js), About (kit
  structure + curator's merged copy, live stat badges via new `utils/stats.js`).
  Accessibility pass: keyboard access + aria-labels on all clickable cards, one `<h1>`
  per route (app-shell heading became a `.site-title` link), focus-visible rings. Admin
  light touch: 10-tab headless walk found zero breakage, no admin code changed.
  App.css 6,287 → 5,187 lines; both pre-existing esbuild CSS warnings gone. The
  3.2-era "site-wide 390px overflow" **did not reproduce** — verified fixed already by
  3.2's own follow-up commit, so the planned shell-fix task was dropped (see Decision
  Log). _Smoke test ✅: full walkthrough of every route (11 routes × 1280 + 390 = 22
  checks) — no overflow, no console errors, no emoji in visible text; admin login + all
  10 tabs clean (two pre-existing, admin-only, untouched-this-session issues noted for
  the record, not regressions); `npm run build` clean; `npx eslint src/` → 0 errors._

## Phase 4 — Admin Rebuild
**Goal:** Make the admin the streamlined heart of the operation so the curator keeps adding
songs (anti-stagnation). Reorganise 10 tool-tabs → 5 job-areas around a single full-page
Curation Workbench fed by derived queues.
**Exit criteria:** The curator can take a song from capture → lyrics/enrichment → publish on
one screen; the old scattered tabs are gone; nothing data is lost.
**Design:** [`superpowers/specs/2026-07-12-admin-workbench-design.md`](./superpowers/specs/2026-07-12-admin-workbench-design.md)
(decomposes the rebuild into sub-projects A–F; brainstormed 2026-07-12).

Sub-projects (each = its own spec→plan→build cycle; A is split into plans A1–A4):

- ◐ **A — Curation Workbench & lifecycle/queues.** The spine: single-song workbench, derived
  queues, `song_processing` table, publish-incomplete. _Spec approved; plans:_
  - ☑ **A1 — Data & backend foundation** _(done 2026-07-13, merged to `main`)._ Migration 006
    (`song_processing`, `songs.language`, `song_lyrics.translation`); `curation.js` (processing
    state · queues + counts · workbench read · per-panel saves); `videos.js` (one-primary
    invariant); lyrics-privacy guardrail. Reuses `staging.js` lifecycle. Plan:
    [`superpowers/plans/2026-07-12-admin-workbench-A1-backend.md`](./superpowers/plans/2026-07-12-admin-workbench-A1-backend.md).
    _Smoke test ✅: `node --test` green (40/40) + admin route curl checks (counts/queue/workbench)
    + 404 on missing song + 401 without auth._
  - ☑ **A2 — Admin nav shell + Songs area** _(done 2026-07-14, branch `session-A2-shell-songs`
    pushed, awaiting curator click-through)._ 5-area nested-route shell (`AdminLayout` + sidebar);
    Songs area (queue rail off `/curation/counts` incl. new `live` count + paginated list off
    `/curation/queue` + search + Add-a-song); Artists/Playlists/Data-quality re-parented; Workbench
    **stub** at `/admin/song/:id`; old `AdminInterface` deleted. Backend: `live` count +
    `curation.quickCapture` (pending). _Smoke ✅: backend 42/42; build+eslint clean; headless 17/17._
  - ☐ **A3 — The Workbench page** (all panels, autosave-on-blur, prev/next, completeness
    checklist, reject-confirm, quick-search links, highlights picker). **Next up — priority:**
    closes the A2 editing gap (per-song editing is unavailable in the new admin until A3). Replaces
    the A2 stub at `/admin/song/:id`. Deletes StagingQueue/LyricsLookupManager/YouTubeVideoManager/
    Manage Songs modal after data-parity check.
  - ☐ **A4 — Dashboard landing + cleanup** (queue counts + Add a song; delete DataDashboard).
- ☐ **B — Analysis integration.** Delete the mocked 5-array categorisation; public song page +
  faceted browse read `song_lyric_analysis` (+ `taxonomy.json`); workbench shows read-only
  coding + lights up the "Needs analysis" queue. See `docs/LYRICS_ANALYSIS_INTEGRATION.md`.
- ☐ **C — Community submissions + moderation.** Public "Submit a song" → Inbox → accept into
  To-be-processed / spam. Reuses `staging.addSubmissionAsPending`.
- ☐ **D — YouTube assist.** Search YouTube from the workbench, present candidates, pick best.
- ☐ **E — Lyrics-search assist.** Multi-site search + capture (realistic MVP: quick-launch
  search links + paste box; full auto-fetch scoped carefully — ToS/fragility).
- ☐ **F — Spotify push.** Website→Spotify: paste Spotify URL → one button adds to the playlist
  (needs a one-time write-auth Spotify OAuth connection).

## Phase 5 — Deployment Hardening
**Goal:** Ship it, cheaply, from GitHub.
**Exit criteria:** Live deployment; secrets managed; DB hosted; documented deploy process.

- ☐ **Session 5.1 — Environment & security.** Externalise config/secrets; input validation
  and basic hardening on public + admin endpoints; admin access control. _Smoke test: run
  locally from env config; confirm secrets not committed._
- ☐ **Session 5.2 — Deploy pipeline & DB hosting.** Choose final platform; add deploy config
  (e.g. `render.yaml`); provision hosted Postgres; migrate data. _Smoke test: deploy a branch
  and load the live site._
- ☐ **Session 5.3 — Launch checklist.** Domain, HTTPS, performance/load-time check, backups.
  _Smoke test: full production walkthrough against the PRD's launch success criteria._

---

## Backlog / Deferred (YAGNI)

Items intentionally deferred until needed (from the PRD and the Session 0.1
[Feature Inventory](./FEATURE_INVENTORY.md)). Nothing here is built until it earns its place.

- **Public playlist creation/editing with accounts.** The public site is browse-only for
  playlists (Session 3.3 deleted the anonymous create/remove UI — see Decision Log); the
  backend routes still exist for the admin Manage Playlists tab. Public creation/editing
  returns once there is an auth/spam story (Phase 4 at the earliest); curated playlists
  remain browsable.
- **Audio previews / embedded player.** Song-card play buttons currently show a "coming soon"
  alert.
- **Clickable stat tiles** ("show all songs/artists" from the homepage stats).
- **Analytics event tracking** (PRD §3.4).
- **Custom visualisation builder** (PRD §3.4).
- **Offline capability / PWA** (PRD deferral).
