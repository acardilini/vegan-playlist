# The Vegan Playlist — Project State

_This is the **living document**. Read it at the start of every session; update it at the end._
_See [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) for the full roadmap._

---

## Current State

- **Phase:** Phase 1 — Data Foundation (Truth Source). **Phase 0 complete 2026-07-07.**
- **Current session:** _between sessions (Session 1.3 complete)_
- **Next session:** Session 1.4 — Minimal staging-queue admin UI
- **Last updated:** 2026-07-07

### Next Tasks (start here)
1. **Session 1.4 — staging-queue admin UI** (see `PUBLICATION_STAGING_DESIGN.md`): three
   queues — **To process** (177 `pending`), **To finalise** (included+unpublished — 39),
   **Live** (1,341 included+published). Process pending songs end-to-end; finalise + publish.
2. **Curator decisions from 1.3 — status conflicts RESOLVED** (curator rule: one instance of
   include → default to include, so the 18 reject/pending-but-included stay live, no change;
   the new CLEARxCUT dup 5804 was merged into 80). Remaining **optional** items in
   [`SESSION_1.3_CURATOR_DECISIONS.md`](./SESSION_1.3_CURATOR_DECISIONS.md): 6 clear attach
   typos to fix then re-run `enrichFromSpotify.js --attach --apply`; 3 unmatched rows; 2
   unclassified Processed values — enrichment only, not blocking.
3. Optional curator to-do: **149 included songs are not on the Spotify playlist** — add by
   hand if desired (`GET /api/admin/spotify-playlist-mismatch` lists them).
4. The two source spreadsheets at `docs/playlist/` are now fully imported and can retire after
   the curator spot-checks the site (keep as archive; still gitignored — lyrics).

### Known Context / Watch-outs
- **Truth source is live (1.1) + publication staging (1.2b):** the public site shows
  `status='included' AND published=true` — **1,341 live / 39 to-finalise / 177 to-process
  (pending) / 243 rejected** (1,380 included total; 1,800 songs after the 1.3 dedup).
  Publishing is an explicit curator click (admin endpoints
  `POST /api/admin/songs/:id/publish|unpublish`); the 1.4 admin UI presents the three
  queues. Full lyrics for 947 songs live in the **local-only** `song_lyrics` table — no API
  route may ever SELECT it (grep before deploy), and Phase 4 production dumps must use
  `--exclude-table-data=song_lyrics`. `backups/` and `backend/logs/` are gitignored because
  they can contain lyrics.
- ~~The 190 new manual songs have no album/spotify data yet~~ **Solved (1.2):** 151 attached
  to Spotify (full album/artist enrichment); 39 remain manual-only (5 confirmed not on
  Spotify, 34 in review for typos). Public queries use `LEFT JOIN albums` so non-Spotify
  songs render; keep it that way.
- **Schema check constraints matter for enrichment:** `artists`/`albums` require
  `data_source='spotify'` whenever `spotify_id` is set (so attaching an id flips
  `data_source`); `songs` may stay `manual` with a spotify_id (provenance preserved).
- Frontend is a ~2,000-line `App.jsx` monolith with inline pages — Phase 2 target.
- Backend has duplicate route files (`admin.js` / `admin_simple.js`) and ~40 one-off scripts — Phase 2 target.
- **Vegan-themes analysis is future work, not a bug:** `analytics/vegan-themes` reports 0
  because the thematic coding of songs hasn't been done yet. Plan it as its own workstream
  once the truth source is in place.
- Deployment must be cheap and GitHub-driven — decided in Phase 4.
- **The DB holds no curatorial data** (all categorisation/review/rating fields empty across
  1,208 songs) — the curated dataset lives in the curator's external files. Protecting "the
  650-song dataset" means protecting those files + the DB's enrichment (671 YouTube videos,
  654 moods, 493 genres, 10 lyric links). See `DATABASE_AUDIT.md`.
- ~~The `songs` table holds 1,208 rows, not ~650~~ **Solved (0.2/0.3):** 674 from the 2025
  imports + 534 synced 2026-04-06 after the Spotify playlist grew (curator: a vetted batch).
  ~~18 true duplicate pairs to merge~~ **merged (1.3):** kept the 2025 canonical each time.
  A 19th dup (CLEARxCUT 80/5804, surfaced by the 1.2 diff) was merged after the curator's
  "default to include" ruling. Songs 1,819 → **1,800**.
- ~~2 orphan artists + 14 orphan albums~~ **Solved (1.3):** swept 19 orphan albums (13 old +
  6 freed by the merge) + 1 orphan artist (Flaex); Queen V had already been re-linked in 1.2.
  0 orphans remain.
- ~~450 songs are missing album covers~~ **Solved (1.2):** every album with a spotify_id now
  has images + release date (1,359/1,398 included songs have covers; the 39 without are the
  manual-only songs). Artists with genres 218 → 432 (the rest have no genres on Spotify's
  side).
- The old DB password remains in public GitHub history (rotated 2026-07-06, so harmless for the DB) — **user to change it anywhere else it was reused**.
- Admin auth is still a shared password shipped in the frontend bundle (env var now, but visible to any visitor once deployed) — real auth is a Phase 4 requirement before the admin routes go public.

---

## Decision Log

Newest first. Each entry: date · decision · why.

- **2026-07-07 — Duplicate merge keeps the 2025 canonical (Session 1.3).** For all 18 true
  dup pairs the 2025-import row was kept: it carries the curatorial enrichment (genre / mood),
  the YouTube video, and the playlist-added date; the 2026 row was bare except a fresher
  `popularity`. Merge backfills **only NULL enrichment scalars** (never curator-owned fields;
  `popularity` takes the max) and re-points child refs before deleting the loser — so nothing
  is lost (the one case where the loser also had a YouTube video re-pointed it, demoted to
  non-primary). To The Grave's two both-2026 pairs had no richer side; curator chose the
  "Still" release. Orphan albums/artists are pure Spotify enrichment with no songs pointing at
  them → safe to delete. Sheet-vs-DB status conflicts and attach typos stay curator calls
  (`SESSION_1.3_CURATOR_DECISIONS.md`), consistent with the 1.1 "import never overrides
  curator state" rule.
- **2026-07-07 — Publication staging added (Session 1.2b, approved).** Being in the
  catalogue (`status`, curator's inclusion decision — unchanged from 0.4) and being
  presentable are separate facts: a new `published` boolean marks included songs as live.
  Essentials for publishing: a play link (Spotify/Bandcamp/SoundCloud/YouTube) + album
  artwork + curator verification — verification IS the Publish click (never automatic;
  categorisation deliberately not required, or the site would empty). Migration
  grandfathered the 1,359 complete included songs as published; 39 incomplete wait in
  "To finalise". Workflow queues: To process = pending, To finalise = included+unpublished,
  Live = included+published. Spec: `PUBLICATION_STAGING_DESIGN.md`.
- **2026-07-07 — Enrichment is provably curatorial-safe (Session 1.2).** The pipeline writes
  only enrichment-class fields (audit §7); verified with an md5 checksum over all
  curator-owned columns + `song_lyrics` before/after the run — byte-identical for every
  pre-existing row. Attach matching is conservative (normalised title AND artist must both
  match) — 34 unmatched go to review rather than guessing. Sync endpoints are now
  import-only: playlist tracks missing from the catalogue become `pending`; nothing is ever
  flagged removed or auto-changed (`removed_from_playlist` is no longer written by anything).
- **2026-07-07 — Import conflicts never change curator state (Session 1.1).** Where a
  spreadsheet row said reject/pending but the matched DB song is `included` (18 rows), the
  import reports it and leaves the song untouched — sheet vs DB disagreements are for the
  curator, not the script. Rejected rows are imported minimally and stay minimal on re-runs
  (no lyrics/URLs). Unclassifiable `Processed` values become `pending` with the raw value in
  `status_notes` rather than being guessed at.
- **2026-07-07 — Public catalogue queries use `LEFT JOIN albums` (Session 1.1).** Non-Spotify
  songs have no album row; the old inner joins made them invisible while still counted.
  First-class non-Spotify songs are a core truth-source requirement, so album data is
  optional everywhere public.
- **2026-07-07 — Truth-source model decided (Session 0.4, approved).** A song is in the
  catalogue because the curator says so: `songs.status` (`pending`/`included`/`rejected`) is
  curator-owned; Spotify is optional enrichment, **import-only** (no push, no auto-removal);
  non-Spotify songs are first-class (Bandcamp/YouTube/SoundCloud); full lyrics live in a
  **local-only** `song_lyrics` table (never git/API/production — copyright); undecided
  spreadsheet rows become an in-website pending queue; rejected candidates are kept as
  `rejected` rows. Full spec: `TRUTH_SOURCE_DESIGN.md`. Spreadsheets at `docs/playlist/`
  gitignored same day.
- **2026-07-07 — Curator data decisions (from the 0.2 audit questions).** (1) The Apr-2026
  534-song batch is a vetted batch of new songs. (2) Curatorial coding lives in a couple of
  spreadsheets → they are the Phase 1 import source. (3) Mood/genre tags are **regenerable
  enrichment**, not curation — a more robust generation approach is future work. (4) **Drop
  audio features** (UI panels + analytics endpoint) — data is NULL and Spotify no longer
  provides it.
- **2026-07-07 — Sync endpoints re-pointed at the correct playlist.** The hardcoded default
  in `sync-spotify-playlist` / `spotify-playlist-mismatch` was an unrelated 500-track Lofi
  Girl playlist; one click of the admin Sync button would have flooded the DB and flagged the
  whole catalogue as removed. Default now `5hVygGomw9zax38quC6mhi` ("Animal Lib & Vegan
  Songs", verified live). Dataset-protection fix shipped mid-audit rather than waiting for
  the Phase 1 sync rebuild.
- **2026-07-07 — Curator confirmed the flagged inventory decisions.** Public playlist
  creation/mutation is **deferred** until a real auth story (Phase 4+); the two pre-auth
  admin test routes were **removed immediately** (`admin.js` — one wrote `songs.featured`
  with no password). Verified post-fix: both return 401; public API unaffected.
- **2026-07-07 — Feature Inventory decisions recorded** in
  [`FEATURE_INVENTORY.md`](./FEATURE_INVENTORY.md): all public screens and curation tooling
  **keep**; Spotify sync **rebuild** in Phase 1 (truth-source boundary); ~20 debug/superseded
  endpoints, `admin_simple.js`, dead `ArtistsPage`, and 3 DDL-over-HTTP endpoints **drop**
  (Phase 2); public playlist creation **defer** pending auth (⚑ user to confirm the flagged
  items). Rationale: preserve every behaviour the curator relies on; remove only what nothing
  calls.
- **2026-07-06 — Security cleanup before Phase 0.** Rotated the Postgres password (old one was
  committed to public GitHub history via `.claude/settings.local.json`); untracked and
  gitignored that file; moved the admin password out of frontend source into env vars
  (`ADMIN_PASSWORD` / `VITE_ADMIN_PASSWORD`) and rotated it; removed password logging from the
  admin auth middleware. Proper admin authentication deferred to Phase 4 (YAGNI — env-var
  shared password suffices while local-only).
- **2026-07-06 — One living state doc.** Current-state and decision log live together in this
  file (not split) — simplest thing that works (YAGNI). Revisit if it grows unwieldy.
- **2026-07-06 — Modernise, don't rewrite.** Preserve backend + PostgreSQL + 650-song dataset;
  rebuild frontend and ops layer. A greenfield rewrite risks losing subtle, hard-won logic and
  curation. Feature Inventory (Phase 0) is the safety net.
- **2026-07-06 — Truth source becomes the curated dataset; Spotify becomes enrichment.** A song
  exists because the curator says so, not because it's on a Spotify playlist. Spotify fills
  details where a match exists and never overwrites curatorial data. Enables multi-platform
  songs (Bandcamp, YouTube, etc.).
- **2026-07-06 — Retain the tech stack** (React/Vite, Node/Express, PostgreSQL). The pain is
  architecture/brand/deployment, not the stack itself.
- **2026-07-06 — Phased approach adopted** (Phases 0–4). Code-changing sessions end with a
  smoke test.

---

## Changelog

Newest first. What actually happened each session.

- **2026-07-07 (Session 1.3)** — Data-integrity pass. Pre-run backup to `backups/`
  (gitignored). **Merged 18 duplicate pairs** (transaction-wrapped merge script, dry-run
  first: keep 2025 canonical, backfill only NULL enrichment scalars + max `popularity`,
  re-point child refs, delete loser; sanity-checked keeps=18/drops=0/Δ=−18). **Swept orphans**
  (dry-run first): 19 albums + 1 artist (Flaex); confirmed only `songs.album_id` and
  `song_artists.artist_id` reference those tables. **Re-ran `consolidateSpreadsheets.js
  --apply`**: file-1 multi-matches 27 → 5 (the 5 remaining are genuinely non-dup), lyrics
  applied to the unblocked rows. End state: songs **1,819 → 1,801**, included **1,398 →
  1,380**, live **1,359 → 1,341**, song_lyrics **929 → 947**, orphans **0**. Curator judgment
  calls written to `docs/SESSION_1.3_CURATOR_DECISIONS.md` (18 status conflicts, new CLEARxCUT
  dup, 6 attach typos, 3 unmatched, 2 unclassified). No application code changed. Smoke test
  ✅: db-stats=1341, merged songs render with artist/album, search returns one row per former
  dup, deleted dup ids 404. **Follow-up (same day):** curator ruled "one instance of include →
  default to include" — the 18 sheet-vs-DB status conflicts stay included (no change); the new
  CLEARxCUT dup (pending 5804) was merged into included 80 (songs 1,801 → 1,800, pending
  178 → 177). Decisions recorded in `SESSION_1.3_CURATOR_DECISIONS.md`.
- **2026-07-07 (Session 1.2b)** — Publication staging (curator-requested design session +
  implementation): migration `002_published_flag.sql` adds `published`/`published_at` +
  CHECK (only included songs can be live) and grandfathers the 1,359 complete included
  songs; all public routes now filter `status='included' AND published=true`; admin
  `publish`/`unpublish` endpoints added (409 on non-included). Site totals 1,398 → 1,359;
  the 39 incomplete songs wait in To-finalise. Spec: `PUBLICATION_STAGING_DESIGN.md`.
  Smoke test ✅: totals consistent, to-finalise song 404s, publish→200/unpublish→404 cycle,
  state restored (one test hiccup caught: 5587 was legitimately published by the backfill —
  it gained artwork in 1.2 — republished after the test).
- **2026-07-07 (Session 1.2)** — Spotify enrichment pipeline live:
  `backend/scripts/enrichFromSpotify.js` + shared `backend/utils/playlistSync.js` (single
  replacement for the three legacy import paths; batched, honours Retry-After, dry-run
  default). Results: **151/190** manual songs attached to Spotify (34 to review — mostly
  spreadsheet typos; 5 confirmed not-on-Spotify); **817 albums** backfilled (covers,
  release dates, labels — 0 albums left without images/dates); **414 artists** backfilled
  (genres 218→432, images, followers); playlist diff added **3 tracks as pending** (other 3
  of the 6-track gap resolved via attach). Admin endpoints rebuilt truth-source-safe:
  `sync-spotify-playlist` = import-only (adds pending, never flags), `spotify-playlist-
  mismatch` = read-only two-way diff. Curatorial md5 checksum verified byte-identical
  pre/post. Pre-run backup in `backups/`. Smoke test ✅: 1,359/1,398 included songs with
  covers, year range intact, both admin endpoints exercised live, frontend loads.
- **2026-07-07 (Session 1.1)** — Truth source stood up. Migration
  `backend/database/migrations/001_truth_source.sql` (first tracked migration): `songs.status`
  /`status_notes`/`lyrics_status`/`bandcamp_url`/`soundcloud_url` + local-only `song_lyrics`
  table. Full DB backup to `backups/` (gitignored), then
  `backend/scripts/consolidateSpreadsheets.js` (dry-run default, idempotent — verified by
  three converging runs) imported both spreadsheets: end state **1,398 included** (+190 new),
  **175 pending**, **243 rejected**, **929 songs with local lyrics**, 519 lyrics links, 78
  bandcamp links, 278 new artists; 72-item review report in `backend/logs/` (multi-matches =
  the known dup pairs; 18 sheet-vs-DB status conflicts left for the curator). All public
  routes (spotify/analytics/playlists/youtube/lyrics) now filter `status='included'` and
  LEFT JOIN albums so non-Spotify songs render. Smoke test ✅: site totals 1,398 everywhere,
  pending/rejected songs 404, manual song renders with placeholder art, frontend loads, no
  route reads `song_lyrics`. exceljs added as backend devDependency.
- **2026-07-07 (Session 0.4)** — Truth-source design session (brainstorming with curator):
  inspected both spreadsheets (711 + 1,013 rows), measured DB overlap (659 exact matches;
  192 new included songs; 256 rejects; 179 pending), worked through 9 curator decisions, and
  wrote the approved spec → `docs/TRUTH_SOURCE_DESIGN.md`. Gitignored `docs/playlist/`
  (lyrics copyright). Phase 0 closed; Phase 1 sessions resequenced (1.1 import, 1.2
  enrichment, 1.3 integrity, 1.4 pending-queue UI). No production code changed.
- **2026-07-07 (Session 0.3)** — Spotify API audit complete → `docs/SPOTIFY_API_AUDIT.md`.
  Live-tested the API with the app's credentials: album images fully available (the missing
  covers are our sync's bug — 450 songs affected, backfillable); audio features (403),
  recommendations/related-artists (404), and preview URLs confirmed dead for this app; the
  real playlist is "Animal Lib & Vegan Songs", 1,216 tracks (DB 8 behind). Truth vs
  enrichment field classification drafted for Session 0.4. **Fix shipped:** sync endpoints'
  default playlist ID pointed at an unrelated Lofi Girl playlist — corrected to the real one
  (server reload + route smoke test ✅; sync itself intentionally not run). Curator answered
  the four 0.2 questions (recorded in Decision Log).
- **2026-07-07 (Session 0.2)** — Database audit complete → `docs/DATABASE_AUDIT.md`
  (read-only; no code changes, smoke test n/a). Headlines: **no curatorial data in the DB**
  (all categorisation/review fields = 0 rows); 1,208 songs = 674 (Jul–Aug 2025 imports, with
  moods/genres/playlist-dates) + 534 (bare 2026-04-06 import, origin ⚑ unconfirmed); id
  sequence at 5,195 → ~4k rows of historic churn; 18 true duplicate pairs identified; audio
  features + preview URLs NULL for all songs (Spotify API no longer provides them); live
  `songs` table has 51 columns vs 23 in `schema.sql`, much of it in no SQL file;
  `database/migrations/` is empty. Four open questions for the curator recorded in the audit.
- **2026-07-07 (Session 0.1 follow-up)** — Removed the two unauthenticated admin test routes
  from `backend/routes/admin.js` (the pre-auth `test-update/:id` and `test-featured-noauth/:id`,
  the latter writing `songs.featured` without a password). Smoke test: both endpoints now 401
  without credentials, `db-stats` still 200 ✅. Recorded curator confirmations (playlist
  deferral) and new context (lyrics being sourced in messy lists; vegan-themes coding is
  future work) in the inventory and this doc.
- **2026-07-07 (Session 0.1)** — Feature Inventory complete → `docs/FEATURE_INVENTORY.md`.
  Walked all 11 frontend routes, 9 admin tabs, and ~100 backend endpoints (every route group
  verified live). Key finds: `admin_simple.js` never mounted; `ArtistsPage` in `App.jsx` dead;
  duplicate route definitions inside `admin.js`; **two admin test routes mounted before the
  auth middleware — one writes `songs.featured` unauthenticated (verified)**; 3 endpoints run
  schema DDL over HTTP; lyrics route file unused by the frontend; live data = 1,208 songs /
  558 artists / 721 albums, lyrics links on 10 songs, vegan-theme analytics empty. Populated
  the Backlog in `PROJECT_PLAN.md`; updated PRD §11 pointer and `CLAUDE.md` architecture
  section. No code changed (audit only — smoke test n/a). / `stop-vegan-playlist.bat` launcher
  scripts (start opens both servers in titled log windows + browser, with already-running
  guard; stop kills by window title and by port 5000/5173). Smoke test: full
  stop → start → re-start cycle verified ✅. Documented in README Quick Start.

- **2026-07-06** — Security cleanup: rotated DB + admin passwords, moved admin password to env
  vars (8 frontend components), untracked/gitignored `.claude/settings.local.json`, removed
  password logging, expanded `.env.example` files, removed stray `backend/nul`. Smoke test:
  DB connection ✅, admin auth new password 200 / old 401 ✅, frontend 200 ✅. Discovered
  `songs` table has 1,208 rows (vs ~650 expected) — flagged for Session 0.2.
- **2026-07-06** — Modernisation planning established: created `PROJECT_OVERVIEW.md`,
  `PROJECT_PLAN.md`, `PROJECT_STATE.md`; updated `PRD.md` with the as-built feature inventory;
  updated `CLAUDE.md` with the Start/End-Session workflow and YAGNI principle.
