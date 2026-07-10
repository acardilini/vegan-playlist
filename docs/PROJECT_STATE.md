# The Vegan Playlist — Project State

_This is the **living document**. Read it at the start of every session; update it at the end._
_See [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) for the full roadmap._

---

## Current State

- **Phase:** Phase 3 — Brand & UI Rebuild (3.1 ☑ merged; 3.2 ☑ on branch, awaiting
  merge). Phases 0–2 complete.
- **Current session:** _Session 3.2 done on branch `session-3.2-public-pages`
  2026-07-11 (pushed), awaiting curator click-through + merge_
- **Next session:** Session 3.3 — Remaining pages & polish (Playlists, Submit,
  Dashboard, About, Admin; responsive + accessibility pass)
- **Last updated:** 2026-07-11 _(3.2 built: Home/Browse/Song Detail/Artists restyled;
  advocacy section renamed + hidden-when-empty)_

### Next Tasks (start here)
1. **Curator: click through branch `session-3.2-public-pages`** (start both servers;
   browse home, search/filters, a song page e.g. `/song/541`, `/artists`, an artist
   page) and give the merge go-ahead. Biggest visible changes: kit hero with rounded
   stat badges + new copy ("A searchable database of vegan & animal-liberation songs",
   "1,300+ songs, tagged by theme, genre, artist, and date"); song page rebuilt as the
   kit's 16:9 cover hero (title/artist/album + Year/Duration/Popularity + actions in a
   scrim over the artwork); artist page rebuilt as the kit's photo hero (genre tags +
   stat boxes in the scrim) over a numbered song list with moss popularity bars;
   artists grid now kit cards (circular photo, meta row, genre pills); filter chips are
   ember pills; all emoji gone from public pages.
   **Same-day follow-up (curator-requested):** popularity removed from all public song
   and artist surfaces; followers removed from artist cards (kept on the artist page as
   "Spotify followers"); artist-page songs now **grouped by album, newest first** (cover
   + year · count header, per-album numbering); new **Bandcamp/Website button** on the
   artist page — populate it per artist via the admin **Artists tab → Edit → "Website /
   Bandcamp URL"** (new `artists.website_url` column, migration `005` applied;
   currently empty for all artists so no button shows yet).
2. **Session 3.3 — Remaining pages & polish**: Playlists (+ detail), Submit, Dashboard,
   About, Admin; responsive + accessibility pass. Known responsive item: **every page
   still overflows horizontally at 390px** (pre-existing shell issue — verified on the
   untouched About page too; the nav now wraps but something page-level still forces
   width). Also from 3.2: playlist-detail rows inherit the artist-page `.song-item` row
   styling from components.css (40px thumbs) — fold into the Playlists restyle.
3. Bridge cleanup continues: App.css is down to ~6,100 lines (from ~8,800); delete
   remaining legacy page blocks + emptied bridge `:root` entries as 3.3 restyles each
   page.
2. ✅ Looks **done — curator appears to have run the playlist sync**: the DB held 1,821
   songs on 2026-07-10 (= 1,800 + the 21 mismatch-report tracks from 2026-07-09).
   Curator to confirm it was intentional; the new tracks are in the To-process queue.
3. ✅ **Done — `session-2.2b-admin-ui-consolidation` merged to `main`** 2026-07-09
   (click-through confirmed; Sync button located after a refresh).
4. ✅ **Done — `session-2.2-backend-consolidation` merged to `main`** 2026-07-09.
5. ✅ **Done — `session-2.1-frontend-decomposition` merged to `main`** 2026-07-08.
4. ✅ **Done — `session-1.4-staging-queue` merged to `main`** 2026-07-08 (merge `032a126`,
   pushed).
4. **Curator decisions from 1.3 — status conflicts RESOLVED** (curator rule: one instance of
   include → default to include, so the 18 reject/pending-but-included stay live, no change;
   the new CLEARxCUT dup 5804 was merged into 80). Remaining **optional** items in
   [`SESSION_1.3_CURATOR_DECISIONS.md`](./SESSION_1.3_CURATOR_DECISIONS.md): 6 clear attach
   typos to fix then re-run `enrichFromSpotify.js --attach --apply`; 3 unmatched rows; 2
   unclassified Processed values — enrichment only, not blocking.
5. Optional curator to-do: **149 included songs are not on the Spotify playlist** — add by
   hand if desired (`GET /api/admin/spotify-playlist-mismatch` lists them).
6. The two source spreadsheets at `docs/playlist/` are now fully imported and can retire after
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
- ~~Frontend is a ~2,000-line `App.jsx` monolith with inline pages~~ **Solved (2.1):**
  `App.jsx` is a 49-line router shell; pages live in `src/pages/`, shared pieces in
  `src/components/`. Dead `ArtistsPage` + `DescriptionSection` deleted.
- ~~Backend has duplicate route files (`admin.js` / `admin_simple.js`)~~ **Solved (2.2):**
  `admin_simple.js`, `lyrics.js`, 17 dead admin routes, 2 DDL-over-HTTP routes and ~14 other
  dead endpoints deleted; `admin.js` reads as six named domains. The ~40 one-off scripts
  remain — Session 2.3 target.
- **`/api/submissions/admin*` endpoints have no auth** (found in 2.2): the whole submissions
  router is mounted without the admin password middleware. Since 2.2b the frontend sends
  `X-Admin-Password` on every admin call (including submissions, via the shared
  `adminFetch` helper), so the backend can start enforcing it without frontend changes —
  fold submissions-admin auth into the Phase 4 real-auth work (local-only until then).
- **Staging queue counts drift as the curator works them** — smoke tests should treat the
  totals as informational, not fixed expectations (2.2 observed 172 pending / 42 to-finalise /
  1,342 live vs 1.4's 177/39/1,341).
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

- **2026-07-11 — Public-page restyle choices (Session 3.2).** (1) **Restyle preserved
  behaviour; only the two detail pages changed structure** — Song Detail and Artist
  Detail were rebuilt to the kit's scrim-hero layouts (`ui_kits/website/song.html` /
  `artist.html`); Home/Browse/Artists kept their component structure and got token CSS
  (the kit's browse-filters sidebar mockup was *not* adopted — the existing toggle
  filter panel keeps the hierarchical genre tree, which the flat mockup can't express).
  (2) **Advocacy section renamed and gated (curator request):** "Vegan Advocacy
  Analysis" → **"Animal advocacy analysis"** (kit sentence case), rendered only when at
  least one of the five categorisation arrays is non-empty — today that's no songs, by
  design. (3) **Dead code removed with the restyle:** song-page audio-features panel +
  technical details (fields NULL for all songs; Phase 0 drop), preview-play buttons
  (`preview_url` dead), energy/danceability/valence sort options, the artists-grid
  "View Artist" hover overlay, all `via.placeholder.com` fallbacks (striped placeholder
  instead), and dead CSS (`.song-tags`, `.view-all-results`, `.coming-soon`,
  audio-feature badge variants). (4) **Generic vocabulary lives once in
  components.css** — `.songs-grid`, `.section-header`, messages/empty states,
  `.page-container`/`.page-header`, search+filter suite — so Playlists/Submit/About and
  admin inherit the brand look before their 3.3 restyle. (5) **Flexbox gotcha fixed and
  documented:** page containers are flex items of the column-flex `.app-container`, and
  `margin: 0 auto` disables flex stretch (container collapses to content width) — every
  centered page container now sets `width: 100%` explicitly. (6) Two "Filters applied"
  guards fixed (empty `year_range` object / default `min_songs: 1` made the empty label
  render).
- **2026-07-11 — Popularity metrics off the public site; artist website link added
  (Session 3.2 follow-up, curator-requested).** Popularity "sets up a comparison we're
  not interested in": removed from song cards, the song-page hero, artist cards, artist
  song rows, and the artist-page stat boxes (the letter of the request covered songs +
  artist-card followers; popularity was removed from artist surfaces too under the same
  rationale — easy to restore if wanted). Followers stay only on the artist page,
  relabelled **"Spotify followers"**. Sorting by popularity still works (display-only
  change). Artist-page songs are grouped by album (newest release first, "Other songs"
  last; per-album numbering under a cover + year · count header). New curator-owned
  `artists.website_url` (migration `005_artist_website.sql`) renders as a
  "Bandcamp"/"Website" hero button (label by URL host); editable in the admin Artists
  tab; never touched by sync/enrichment.
- **2026-07-10 — Design-system layering: bridge + override, not a rewrite (Session 3.1).**
  (1) Brand tokens live in new `frontend/src/styles/tokens/` (kit's colors/typography/
  spacing verbatim; fonts via a Google Fonts `<link>` in `index.html` instead of the
  kit's CSS `@import`); global element styles in `styles/base.css`; the core-component
  classes in `styles/components.css`, imported **after** `App.css` so the design system
  wins the cascade over the 7,900-line legacy monolith (whose bare-class duplicate
  blocks otherwise "last-rule-wins" everything). (2) The monolith's legacy `:root`
  variables were **re-pointed at the brand tokens** (a documented BRIDGE block) — every
  page, admin included, picks up the palette at once without touching page CSS; the 56
  hardcoded Spotify-green values and 4 gradients were swept to tokens/flat fills
  (brand: flat, no gradients). 3.2/3.3 delete legacy blocks + bridge entries page by
  page. (3) Also mapped five legacy variables that were used but **never defined**
  (`--color-border`, `--color-surface`, `--color-primary`, `--color-vegan-primary/
  secondary`) — borders silently fell back to `currentColor` before. (4) Brand-voice
  rules applied to core components: no emoji (🔥 popularity, mood emojis removed),
  mood badge became a neutral scrim pill (two intentional accent hues only), missing
  covers render the kit's striped placeholder — the dead `via.placeholder.com` fallback
  is gone.
- **2026-07-10 — "Cover API broken" was a CSS bug, now fixed (Session 3.1).** The brand
  kit (and the curator) believed the album-cover API was broken. Root cause found while
  smoke-testing 3.1: an old cleanup in `App.css` deleted a `@media (max-width: 768px)`
  opener but left its body, leaking mobile artist-page rules — including
  `.song-artwork { display: none }` — into **global** scope. Song cards therefore never
  showed covers on any viewport even though the DB has had them since Session 1.2. Fix:
  restored the media-query wrapper and scoped the hide rule to `.song-item .song-artwork`
  (artist-page rows only). Covers now render on desktop and mobile cards; the kit's
  striped-placeholder guidance stays for the 39 manual-only songs.
- **2026-07-10 — Script keep-list revised at execution time (Session 2.3).** The Phase 0
  inventory's keep-list was written before Phase 1 existed; by 2.3 two of its five keeps
  were superseded and one was misnamed. **Kept 4:** `consolidateSpreadsheets.js` +
  `enrichFromSpotify.js` (the Phase 1 truth-source/enrichment pipeline, both dry-run by
  default), `auditDatabase.js` + `exportAllSongsData.js` (read-only utilities). **Dropped
  from the keep-list:** `importSpotifyDataEnhanced.js` and `syncSpotifyPlaylist.js`
  (enrichFromSpotify.js is explicitly the "single replacement for the three legacy import
  paths"; the inventory kept sync only "until the Phase 1 pipeline replaces it") and
  `runMigration.js` (despite the name it was hardcoded one-off ALTER TABLEs — half of them
  the dropped audio-features columns — not a migration runner; schema changes are SQL
  files in `database/migrations/` applied via psql). Deleted rather than archived (user
  choice; git history preserves all 37 — `git log --diff-filter=D -- backend/scripts`).
  Verified before deleting: no script is referenced by package.json, server code, the
  launcher .bat files, or another script.
- **2026-07-09 — Admin UI consolidation choices (Session 2.2b).** (1) **Approve = approve +
  queue**: the Submissions "Approve" button became "Approve & add to pending" — one action
  that sets the status and calls the authed 2.2 bridge (per the audit decision that approval
  must stop being a status-only dead end); a separate "Add to pending queue" button covers
  submissions approved before the bridge existed (the bridge is idempotent, so double-clicks
  are safe). (2) **The shared categorisation form uses toggle buttons** (the Bulk workflow's
  interaction), replacing the Manage Songs modal's ctrl-click multi-selects — same five
  fields, same endpoints, one component (`CategorizationFields.jsx`); the workflow also
  stops rendering genre lists as category buttons (it used to render *every* key of
  `categorization-options`, including the 149 subgenres). (3) **`adminFetch` sends the
  password header everywhere, including unauthenticated `/api/submissions/admin*`** —
  harmless today, and it means Phase 4 can turn auth on server-side without touching the
  frontend. (4) **Audio-features form fields kept** in the two song-edit forms (only the
  analytics endpoint + dashboard chart were in the Phase 0 drop; removing form fields is a
  curator call for later). (5) **Fixed rather than preserved:** the genre/parent-genre
  selects in both song forms were broken no-ops (a multi-select whose onChange never fired) —
  rebuilt as real single selects, and the modal now actually submits `genre`/`parent_genre`. (1) **`admin.js` stays one
  file with six banner-named domain sections** rather than splitting into per-domain modules
  — the audit allowed either; a single file with banners is the smallest change that makes
  the file read as its domains (YAGNI; revisit if a domain grows). (2) **The
  submissions→pending bridge matches Spotify conservatively first** (same normalised
  title-AND-artist rule as 1.2's attach) and imports via the staging candidate intake for
  full enrichment; with no confident match it creates a minimal `manual` pending song —
  preserving the submitted YouTube link as the song's play link — and never guesses. Either
  way the submission row's `existing_song_id` is pointed at the catalogue song, making the
  bridge idempotent. (3) **Catch-up migrations document applied state, not the routes'
  literal DDL** — `004` records `artists.data_source` as the live `VARCHAR(20)` (the
  deleted route's `VARCHAR(50)` ADD COLUMN was always a no-op against the existing column).
- **2026-07-08 — Frontend folder convention (Session 2.1).** Route-level screens live in
  `src/pages/` (one file per route); anything used by more than one page or section lives in
  `src/components/`. Single-consumer helpers stay local to their page file (YAGNI — e.g.
  `CreatePlaylistModal` inside `PlaylistsPage.jsx`, `AudioFeatureBar`/`CategoryBadges` inside
  `SongDetailPage.jsx`). Extraction was verbatim (same behaviour); the only code removed was
  dead: `ArtistsPage` (never routed, Phase 0 drop) and the unused `DescriptionSection`.
- **2026-07-08 — Admin consolidation decisions (audit → [`ADMIN_AUDIT.md`](./ADMIN_AUDIT.md),
  curator-confirmed).** (1) **Sync moves into the Staging tab** — the Duplicate Manager Sync
  button and Staging's Add candidates do the same import-as-pending job on the same backend
  (`utils/playlistSync.js`); one intake surface, and Duplicate Manager becomes pure
  data-quality. (2) **One shared categorisation form, both entry points kept** — the Manage
  Songs modal and the Bulk Categorization workflow duplicate the same form against the same
  endpoints; extract one component, lose no workflow. (3) **Submissions→pending bridge built
  in 2.2** (curator chose build over defer): approving a community submission will add the
  song to the pending queue via the existing staging candidate-intake service, instead of
  being a status-only dead end. Audit also fixed the scope of 2.2: of `admin.js`'s 47 route
  definitions only 28 are live; 17 are dead (6 test, 5 playlist endpoints unused because the
  tab uses the public API — two of them duplicate definitions in the same file, 3 sync-era
  reports on a column nothing writes since 1.2, 3 misc) and 2 are DDL-over-HTTP to convert
  to migrations.
- **2026-07-08 — Staging UI ships without lyrics paste / categorisation (Session 1.4).** The
  `PROJECT_PLAN.md` line for 1.4 mentioned lyrics paste + categorisation in the To-process
  view, but `PUBLICATION_STAGING_DESIGN.md` §4 rules categorisation explicitly *non-essential*
  for going live (requiring it would empty the site; vegan-themes coding is its own future
  workstream). Curator confirmed **ship as-is** (YAGNI): the To-process view exposes Attach
  Spotify / Add play link / Include / Include&Publish / Reject — enough to take a pending song
  live end-to-end. Local-only lyrics paste and categorisation editing are deferred to a later
  session when the thematic-coding workstream starts.
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

- **2026-07-11 (Session 3.2)** — Public pages restyle. On branch
  `session-3.2-public-pages` (3.1 merged to `main` first, curator-confirmed), from the
  brand-kit mockups (`ui_kits/website/index|browse-filters|song|artists|artist.html`
  via DesignSync): **(1) Home** — kit hero (display headline + "1,300+ songs, tagged by
  theme, genre, artist, and date" + `.stat-badge` cards fed by live stats rounded down
  to the hundred), "Featured songs" / "Browse the collection" sentence-case headers,
  emoji stripped. **(2) Browse/Search** — token restyle of the whole SearchAndFilter
  suite (pill search input, secondary Filters button with count chip, ember filter
  chips, kit select, surface filters panel, moss parent-genre labels); dead audio
  sort options + debug logs removed. Shared with the artists page's twin component.
  **(3) Song Detail** — rebuilt to the kit layout: 760px column, ghost Back / secondary
  Share, 16:9 cover hero with scrim (title, ember artist, italic album, Year/Duration/
  Popularity stat cells, Open in Spotify + View lyrics buttons), "Music video",
  "Key lyrics" ember-border quote card, **"Animal advocacy analysis"** (renamed per
  curator request; whole section hidden unless one of the five categorisation arrays
  has data — currently no songs), "You might also like" compact cards. Audio-features
  panel + preview-play deleted (dead data). **(4) Artists** — kit cards (72px circular
  photo, meta row, genre pills, moss advocacy label) and Artist Detail rebuilt to the
  kit photo-hero (overlay Back/Spotify/Share buttons, genre tags + 4 translucent stat
  boxes in the scrim) over numbered song rows with moss popularity bars. **(5) CSS** —
  all styles token-based in `styles/components.css` (+~1,100 lines incl. shared
  page-shell/messages/search vocabulary); legacy App.css blocks deleted (~2,700 lines:
  hero/stats, featured/search sections, song-card leftovers, whole search+filter
  region, both song-detail layouts, video-section width hacks + 🎥, artist pages ×2
  regions, dead `.song-tags`/`.view-all-results`/`.coming-soon`). Bug fixes en route:
  page containers collapsing to content width inside the column-flex app shell
  (`width: 100%` + documented in Decision Log), two always-on "Filters applied" labels,
  admin `.artist-info` row rule leaking into public artist cards, nav now wraps on
  narrow viewports. Net ≈ **+1,600/−2,900 lines**. Smoke test ✅ (headless-Chrome walk,
  desktop 1280 + mobile 390): home (hero copy + stat badges + covers), song/541
  (scrim hero, video embed, no advocacy section — correct, no data), artists grid,
  artist/83 (hero + popularity bars), playlists unchanged; `npm run build` clean
  (2.1s); eslint **0 errors** on all six touched files (5 pre-existing errors in them
  also fixed; 6 deliberate hook warnings remain). Known-remaining: site-wide 390px
  horizontal overflow (pre-existing, verified on untouched About page) → 3.3
  responsive pass. Branch pushed, awaiting curator click-through + merge.
  **Same-day follow-up (curator-requested, same branch):** (1) popularity displays
  removed site-wide (song cards, song hero, artist cards/rows/stat box — see Decision
  Log) and artist-card followers removed; artist-page followers relabelled "Spotify
  followers". (2) Artist-page songs grouped by album, newest first (56px cover +
  "year · N songs" header, per-album row numbering, rows slimmed to title + duration).
  (3) `artists.website_url` added (migration `005_artist_website.sql`, applied):
  selected by the public artist route + admin all-artists, writable via
  `PUT /api/admin/artists/:id`, new "Website / Bandcamp URL" field in the admin
  Artists edit modal, rendered as a "Bandcamp"/"Website" hero button. Backend
  restarted; verified end-to-end (set URL via admin API → button renders → reverted
  to empty). Build clean; eslint 0 errors on touched files.
- **2026-07-10 (Session 3.1)** — Design system foundation (opens Phase 3). On branch
  `session-3.1-design-system`, from the brand kit (Claude Design project "Website brand
  kit development", read via DesignSync): **(1)** new `frontend/src/styles/` —
  `tokens/colors.css` (warm-dark oklch neutrals + Ember/Moss accents), `tokens/
  typography.css` (Manrope display / Public Sans body scale), `tokens/spacing.css`
  (4px scale, radii, shadows, motion), `base.css` (element defaults: canvas bg, display
  headings, ember links, focus ring), `components.css` (app shell, song card, striped
  artwork placeholder, pagination, mood badge, plus kit Button/Input/Select/Tag/Badge
  classes as `.btn/.input/.select/.tag/.stat-badge` for 3.2/3.3); `index.css` now just
  imports these; Google Fonts link + real `<title>` in `index.html`. **(2)** `App.css`:
  legacy `:root` re-pointed at tokens (bridge), 13 hex + 43 rgba() Spotify greens and 4
  gradients swept, 5 never-defined variables now defined. **(3)** JSX: `App.jsx` imports
  components.css after App.css; `SongCard` lost the 🔥 emoji and the dead
  `via.placeholder.com` fallback (striped placeholder instead); `MoodBadge` rewritten as
  a token pill (no emoji, no per-mood ad hoc colors). **(4)** Two cascade bugs fixed in
  legacy CSS: restored the deleted `@media` opener that had leaked
  `.song-artwork{display:none}` globally (this — not a broken API — is why cards never
  showed album covers; see Decision Log), and added `min-width:0` to cards so long
  nowrap titles can't blow out grid columns. Net ≈ +900/−120 lines, all frontend.
  Smoke test ✅: headless-Chrome walk of home (desktop 1280 + mobile 390), song/541,
  artists, playlists — all render on-brand (warm dark canvas, ember nav/stats/actions,
  moss genre labels, covers visible on cards for the first time); `npm run build` clean
  (2.2s); eslint 0 errors on changed files. Known-remaining: mobile hero-stats overflow
  (pre-existing, → 3.3 responsive pass); hero copy still old voice (→ 3.2). Branch
  pushed, awaiting curator click-through + merge.
- **2026-07-10 (Session 2.3)** — Script cleanup (closes Phase 2). On branch
  `session-2.3-script-cleanup`: **deleted 37 of the 41 files in `backend/scripts/`**
  (all `test*`/`check*`/`debug*`/`diagnose*` one-offs, the `add*`/`create*`/`setup*`
  one-off DDL, genre-migration scripts, the three legacy import/sync paths
  superseded by 1.2, the dead `removed_from_playlist` pair, `restartServer.js`,
  `youtubeApiServer.js`, and `runMigration.js` — see Decision Log for the keep-list
  deviations). **Kept 4** documented in a new `backend/scripts/README.md`:
  `consolidateSpreadsheets.js`, `enrichFromSpotify.js`, `auditDatabase.js`,
  `exportAllSongsData.js`. Verified first that nothing references any script (no
  package.json entries, no requires from server code, no .bat callers, no
  cross-requires). Rewrote the stale sync documentation: `README.md`'s "Spotify playlist
  is the source of truth" section replaced with the truth-source model (import-only sync
  via Staging tab or `enrichFromSpotify.js`), scripts-reference table cut to the 4 keeps,
  admin-workflow table updated (Staging row added, dead removed-from-playlist row gone);
  `CLAUDE.md` import/scripts lines corrected (had pointed at a nonexistent
  `importSpotifyData.js`). Net **≈ −4,900 lines**. Smoke test ✅: retained
  `auditDatabase.js` ran clean (read-only), backend started and public routes serve real
  data (featured song OK, search `vegan` = 198, unchanged from 2.1/2.2). **Observed:**
  DB now holds 1,821 songs = 1,800 + the 21 mismatch tracks — the curator appears to
  have used the new Sync button (2.2b's first working sync UI) between sessions;
  flagged in Next Tasks for the curator to confirm.
- **2026-07-09 (Session 2.2b)** — Admin UI consolidation (executes `ADMIN_AUDIT.md` §3;
  frontend only, backend untouched). First merged 2.2 to `main` (curator go-ahead), then on
  branch `session-2.2b-admin-ui-consolidation`: **(1)** new `src/api/adminApi.js` —
  `adminFetch` helper (relative `/api` URLs through the Vite proxy + `X-Admin-Password` on
  every call); all 11 admin components converted; zero hardcoded `localhost:5000` left in
  admin code (public pages still hardcode it — Phase 4). **(2)** `AdminInterface.jsx`
  2,327 → 176 lines: login + tab nav shell; Manage Songs (list, manual-song form,
  edit modal) → `ManageSongsTab.jsx`; Manage Playlists → `ManagePlaylistsTab.jsx`.
  **(3)** One shared `CategorizationFields.jsx` (five category arrays + rating, toggle
  buttons) behind the manual-song form, the edit modal, and the Bulk Categorization
  workflow; fixed the broken genre/parent-genre selects while extracting (see Decision
  Log). **(4)** Sync moved into **Staging → Add candidates**: "Sync from playlist"
  (import-only POST) + "Check playlist mismatch" (read-only report) — note both old sync
  functions in AdminInterface/DuplicateManager were dead code no button ever called, so
  this is the sync's first working UI since the 1.2 rebuild. **(5)** Duplicate Manager is
  pure data-quality: dead "Removed from Playlist" sub-tab deleted (read
  `removed_from_playlist`, unwritten since 1.2; its help text pointed at scripts deleted in
  Phase 0/2.2). **(6)** Submissions: "Approve & add to pending" calls the authed 2.2 bridge;
  catch-up "Add to pending queue" button for approved-unbridged; result messages surfaced.
  Also deleted dead code found en route (unused `searchResults` state, unreachable batch-
  categorise stub whose `b` shortcut called an undefined function). Net **≈ −975 lines**.
  Lint: 0 errors in every touched file (5 pre-existing errors remain in untouched public
  `SearchAndFilter`/`ArtistSearchResults`). Smoke test ✅ **28/28** (headless Chrome walk:
  login, all 10 tabs render, staging sub-views + sync panel, live mismatch report
  149/21, Cleanup tab shows no removed-songs view) **plus a live end-to-end bridge test**:
  public submission → "Approve & add to pending" click → verified in DB (manual pending
  song, submitted YouTube link kept as primary play link, `existing_song_id` set) → all
  test rows cleaned up, `db-stats` unchanged at 1,342; backend node:test 17/17. Found for
  the curator: the mismatch report now shows **21 playlist tracks not in the catalogue**
  (playlist grew since 2.2) — the new Sync button imports them when ready. Branch pushed,
  awaiting curator click-through + merge.
- **2026-07-08 (Session 2.2)** — Backend consolidation (executes the admin audit). On branch
  `session-2.2-backend-consolidation`: deleted the 17 dead `admin.js` routes,
  `admin_simple.js` (390 lines, never mounted), and the Phase 0 inventory's other drops —
  9 `spotify.js` debug/dead routes (incl. `GET /artists` + the unused
  `spotifyService.getArtists`), 3 `youtube.js` routes (PUT/DELETE `/videos/:id`,
  `extract-id`), the whole `lyrics.js` router (unmounted from `server.js`), submissions
  `GET /stats`, analytics `GET /audio-features` (+ its Dashboard doughnut chart and
  audio-feature filter). Converted the 2 DDL-over-HTTP routes to catch-up migrations
  `003_lyrics_links.sql` + `004_discography_tracking.sql` (schema objects verified live
  first) and removed their UI callers (Lyrics Manager setup button; ArtistsManager ran the
  DDL on every mount). Regrouped `admin.js` (2,926 → 2,237 lines) into six banner-named
  domains; `server.js` mounts cleaned. Built the **submissions→pending bridge**:
  `staging.addSubmissionAsPending` + authed `POST /api/admin/submissions/:id/add-to-pending`
  (conservative Spotify match → candidate intake; else minimal manual pending song keeping
  the submitted YouTube link; idempotent via `existing_song_id`); +4 node:test cases
  (17/17 green). Net **−1,779 lines**; zero dead routes; zero DDL-over-HTTP. Found along the
  way: `/api/submissions/admin*` has no auth (recorded as a Phase 4 watch-out). Smoke test ✅
  44/44: public API intact (db-stats 1342, search `vegan` 198, song 541 detail/similar,
  analytics, playlists, youtube primary), every deleted route 404s, all 28+1 admin routes
  exercised (incl. live Spotify mismatch report: 149 included-not-on-playlist, unchanged),
  401 without password, Vite loads, `npm run build` + eslint clean (0 errors; the 3
  pre-existing hook warnings remain). Queue totals observed: 172 pending / 42 to-finalise /
  1,342 live (curator has been working the queues since 1.4). Branch pushed, awaiting merge
  go-ahead.
- **2026-07-08 (Session 2.1)** — Frontend decomposition (opens Phase 2). On branch
  `session-2.1-frontend-decomposition`: `App.jsx` 2,001 → 49 lines (router shell only).
  Extracted verbatim to `src/pages/`: HomePage (with its Hero/Stats/Featured/Search
  sections), SongDetailPage, PlaylistsPage (CreatePlaylistModal kept local), 
  PlaylistDetailPage, AboutPage; to `src/components/`: NavigationMenu, SongCard,
  PaginationControls, AddToPlaylistModal. Deleted dead code only: `ArtistsPage` (~270
  lines, never routed — Phase 0 drop) and unused `DescriptionSection`; also removed two
  dead-variable lint errors carried over (unused `section` param, unused `pagination`
  state). Net −257 lines. Smoke test ✅ (headless Chrome against live backend + Vite dev
  server): all 9 routes rendered with real data — home (stats 1342+/630+, featured cards,
  browse grid), song/541 detail (artwork, meta, YouTube embed), playlists + playlist/1,
  about, artists search, admin login; error path (`/song/999999` → "Song not found") and
  URL search (`/?q=vegan` → 198 songs) behave as before; `npm run build` clean, eslint 0
  errors on changed files (2 pre-existing deliberate hook warnings remain). Noticed live
  totals are 1,342 (docs said 1,341) — one song appears newly published (curator was
  exercising the staging UI 2026-07-08); flagged for the curator to confirm it was
  intentional.
- **2026-07-08 (Admin consolidation audit)** — Audit-only session (no code changed, smoke
  test n/a). Cross-referenced all 47 `admin.js` route definitions against every frontend
  fetch → [`ADMIN_AUDIT.md`](./ADMIN_AUDIT.md): **28 keep / 17 delete / 2 convert to
  migrations**, plus `admin_simple.js` (360 lines, unmounted) to delete. Key finds beyond
  Phase 0's inventory: the admin playlist endpoints are *all* dead (the Manage Playlists tab
  uses the public API); the three `removed-songs`/`discrepancies` reports can never show data
  again (nothing writes `removed_from_playlist` since 1.2); song intake now exists in three
  UIs; categorisation and YouTube-attach UIs each exist twice; submission approval never
  creates a song. Curator confirmed three consolidation decisions (see Decision Log).
  `PROJECT_PLAN.md` Session 2.2 rescoped precisely + new Session 2.2b (admin UI
  consolidation) added.
- **2026-07-08 (Session 1.4)** — Staging-queue admin UI (closes Phase 1). Built on branch
  `session-1.4-staging-queue`: `backend/services/staging.js` (queue listing +
  include/reject/play-link/attach-spotify/candidate-intake, `db`-first for testability),
  6 admin endpoints in `admin.js`, `backend/test/staging.test.js` (13 node:test cases, all
  green), and `frontend/src/components/StagingQueue.jsx` with 4 sub-views (To process / To
  finalise / Live / Add candidates) mounted as a Staging tab in `AdminInterface`. Scope call:
  shipped without lyrics paste / categorisation (deferred — see Decision Log). Smoke test ✅
  (reversible, ran against real DB then restored state byte-for-byte): queue totals **177
  pending / 39 to-finalise** as expected; live queue requires a search term (400 without `q`,
  133 hits for `q=vegan`); include moves pending→included and across queues; play-link saves
  and rejects non-http URLs (400); reject→rejected; publish makes a To-finalise song appear in
  Live search, unpublish removes it; candidate intake dedupes an existing Spotify id (added 0 /
  skipped 1, exercising the live Spotify API) and reports invalid URLs; unknown id → 404;
  frontend `npm run build` clean. `RESTORE MATCHES ORIGINAL: true`. **Curator click-through
  confirmed live 2026-07-08** — Staging tab verified working in the browser at `/admin` (also
  surfaced that the admin password had been rotated in the 2026-07-06 cleanup and the curator
  needed the current one from `frontend/.env.local`; a stale Vite process was restarted with
  its cache cleared). Branch is ready to merge to `main`, awaiting the go-ahead.
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
