# The Vegan Playlist — Project State

_This is the **living document**. Read it at the start of every session; update it at the end._
_See [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) for the full roadmap._

---

## Current State

- **Phase:** **Phase 4 — Admin Rebuild (in progress).** Phases 0–3 complete (Phase 3 —
  Brand & UI Rebuild merged 2026-07-12, merge `48a4529`). Deployment Hardening moved to
  **Phase 5**.
- **Current session:** _**A2 — admin nav shell + Songs area: complete** on branch
  `session-A2-shell-songs` (pushed, awaiting curator click-through + merge). Brainstormed →
  spec → plan → executed 7 tasks via subagent-driven development (per-task reviews + final
  whole-branch review, all clean). 42/42 backend tests green; headless smoke 17/17 ✅._
- **Next session:** **Write & execute A3 — the Curation Workbench** (full-page `/admin/song/:id`,
  replacing the A2 stub). **Should follow promptly:** A2 replaced the old shell outright, so
  per-song editing (lyrics/publish/include-reject) is unavailable in the new admin until A3.
  Start with brainstorming → writing-plans.
- **Last updated:** 2026-07-14 _(A2 shell + Songs area done + pushed; A3 is next and gated by
  the editing gap)._

### Next Tasks (start here)
1. **~~A1 (backend foundation)~~ + ~~A2 (shell + Songs area)~~ — DONE.** A1 merged (`145efbb`).
   A2 on branch `session-A2-shell-songs` (pushed, awaiting curator click-through + merge): the
   5-area nested-route admin shell (`AdminLayout` + top-bar nav), the Songs area (queue rail off
   `/curation/counts` incl. new `live` count + paginated list off `/curation/queue` + search),
   a working **Add a song** (quick capture → new `curation.quickCapture`/`POST /curation/quick-capture`
   pending; Spotify paste → existing `/staging/candidates`), Artists/Playlists/Data-quality
   re-parented untouched, and a `/admin/song/:id` Workbench **stub**. Old `AdminInterface` deleted.
2. **Write + execute A3 — the Curation Workbench** (full-page `/admin/song/:id`) against A1's
   `GET/PUT /workbench/*` + video endpoints and the `staging` lifecycle. Deletes StagingQueue/
   LyricsLookupManager/YouTubeVideoManager/ManageSongs-modal after a parity check. **Priority:**
   closes the A2 editing gap (per-song lyrics/publish/include-reject are unavailable in the new
   admin until A3). Then A4 (Dashboard landing, replacing the stub; deletes the admin dashboard).
   _Plan-naming note: A4 must delete `DataCompletionDashboard` (the admin dashboard), NOT
   `DataDashboard.jsx` (the PUBLIC `/dashboard` page, which stays)._
3. **Deferred to their own sub-projects:** B (analysis display / delete the mock
   categorisation), C (submissions moderation / Inbox), D (YouTube search), E (lyrics
   fetch), F (Spotify push). Design: [`specs/2026-07-12-admin-workbench-design.md`](./superpowers/specs/2026-07-12-admin-workbench-design.md).
4. **Phase 5 — Deployment Hardening** (was Phase 4): externalise config/secrets, input
   validation, admin access control. Known items in Watch-outs: public pages hardcode
   `http://localhost:5000` (deployment breaks them until proxied/env-based),
   submissions-admin auth, real admin auth.
**Still-open optional curator to-dos** (non-blocking, carried forward):

- The **Bandcamp/Website artist button** ships empty — populate `artists.website_url` per
  artist via the admin Artists tab whenever ready.
- **149 included songs are not on the Spotify playlist** — add by hand if desired
  (`GET /api/admin/spotify-playlist-mismatch` lists them). _(Sub-project F later makes this a
  one-click push from the workbench.)_
- 1.3 leftovers in [`SESSION_1.3_CURATOR_DECISIONS.md`](./SESSION_1.3_CURATOR_DECISIONS.md):
  6 attach typos to fix then re-run `enrichFromSpotify.js --attach --apply`; 3 unmatched rows;
  2 unclassified Processed values — enrichment only, not blocking.
- The two source spreadsheets at `docs/playlist/` are fully imported and can retire after a
  site spot-check (keep as archive; still gitignored — lyrics).

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
- **Known cosmetic debt for the Phase 4 admin pass** (found in the 3.3 final review, not
  fixed — admin is out of scope until Phase 4): the admin loading spinner has a 3px
  cascade shift, and 8 pre-existing undefined legacy vars are used in admin `App.css`
  blocks (`--color-card-bg`, `--color-primary-dark`, `--shadow-sm/md/lg`,
  `--border-radius-full`, `--color-bg-quaternary`, `--color-text-light`) — fold into the
  Phase 4 admin restyle.
- **`DataDashboard.jsx`, `spotifyService.js`, `playlistService.js` hardcode
  `http://localhost:5000`** (2.2b only fixed admin code, per the changelog above) — Phase
  4 deployment (Session 4.2) breaks every public page until these go through the Vite
  proxy or an env-based base URL; name it explicitly for 4.1/4.2 planning.

---

## Decision Log

Newest first. Each entry: date · decision · why.

- **2026-07-12 — Admin layer to be rebuilt as a dedicated phase, decomposed A–F
  (brainstorm session).** The curator flagged the 10-tab admin as clunky/disjointed and a
  stagnation risk ("if I can't easily add/update songs, the playlist goes stale"). Rather than
  more incremental audit-cleanups, we designed a **workflow-oriented admin**: a single
  full-page **Curation Workbench** (everything about one song on one screen) fed by
  **derived queues**, reorganising 10 tool-tabs → 5 job-areas. Scoped as **6 sub-projects**
  (A workbench+lifecycle · B analysis display / delete the mock categorisation · C submissions
  moderation · D YouTube search · E lyrics fetch · F Spotify push), each with its own
  spec→plan→build cycle. **Admin Rebuild becomes Phase 4; Deployment Hardening moves to
  Phase 5.** Design: [`specs/2026-07-12-admin-workbench-design.md`](./superpowers/specs/2026-07-12-admin-workbench-design.md).
  Key sub-decisions: workbench is one screen for _both_ processing and editing; autosave-on-blur;
  reject-with-confirm; the mocked 5-array categorisation is **deleted in B** and replaced by
  the external `song_lyric_analysis` table (read-only in admin — the main app only displays it);
  new `song_processing` table holds only the non-derivable workflow state (snooze / park reason /
  lyrics avenues tried); `songs.language` (sung-in) is public metadata, `song_lyrics.translation`
  stays local-only (copyright); publish-incomplete is supported with to-do queues tracking gaps;
  the "Submit a song" page stays public (community submissions, moderated into the Inbox);
  Spotify becomes a push target (website is truth), needing a one-time write-auth OAuth in F.
- **2026-07-11 — Public playlists made read-only (Session 3.3, curator decision at
  design time).** Anyone-can-create/anyone-can-remove was never a real feature — it had
  no auth story and no spam protection (see the Backlog entry). Rather than leave dead
  or misleading controls in the restyled UI: the Create-playlist button/modal was
  **deleted, not hidden** (`CreatePlaylistModal` and its trigger removed from
  `PlaylistsPage.jsx`), `AddToPlaylistModal.jsx` was deleted outright (26 → 25
  components), the remove-song control was removed from the playlist-detail row, and
  the dead "coming soon" play-button alert was removed from `SongCard`. Backend
  playlist routes (`playlists.js`) were **not touched** — the admin Manage Playlists
  tab still consumes the same API. Playlist creation returns to the public site once
  there's real auth (Phase 4+); browsing curated playlists is unaffected.
- **2026-07-11 — The 3.2-era "site-wide 390px overflow" no longer reproduces (Session
  3.3 planning).** Verified headlessly on all 11 routes with real data at planning time
  (2026-07-11): no route overflowed at 390px. It's evidently fixed by 3.2's own
  same-day follow-up (nav-wrap fix + `width: 100%` container fixes) — no dedicated
  shell-fix task was needed, and the task planned for it in the 3.3 brief was dropped.
  Re-confirmed in the Task 10 full-route smoke test (all 11 routes × 2 viewports, no
  overflow).
- **2026-07-11 — About-page copy: curator edits merged onto the kit structure
  (Session 3.3, curator-approved "merge" option).** The curator had uncommitted
  working-tree edits to `AboutPage.jsx` (care/appreciation framing, "critique animal
  exploitation" wording, a revised animal-focus line, themes described without an
  environment mention) that conflicted with the kit's About copy queued for this
  session. Curator chose to merge: kit structure + curator's content, with typos fixed.
  The curator's same-session Submit-page copy tweaks were committed as-is (`11a2760`,
  curator-authored, care/connection framing).
- **2026-07-11 — Admin light-touch scope confirmed by inspection, not rebuild (Session
  3.3, Task 8).** A headless walk of all 10 admin tabs after the public restyle found
  **no breakage**: `ManagePlaylistsTab` uses the namespaced `admin-playlist-card` class,
  so it doesn't collide with the public `.playlist-card` restyle. Zero admin fixes were
  needed — the task produced no diff and no code review.
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

- **2026-07-14 (A2 — admin nav shell + Songs area)** — Brainstormed → spec
  ([`specs/2026-07-13-admin-workbench-A2-shell-songs-design.md`](./superpowers/specs/2026-07-13-admin-workbench-A2-shell-songs-design.md))
  → plan ([`plans/2026-07-13-admin-workbench-A2-shell-songs.md`](./superpowers/plans/2026-07-13-admin-workbench-A2-shell-songs.md))
  → executed 7 tasks via **subagent-driven development** (fresh implementer + per-task spec/quality
  review each, then a final whole-branch review — all clean) on branch `session-A2-shell-songs`
  (base `0e8ce62`). **Delivered:** the old 10-tab `AdminInterface` replaced by a **5-area
  nested-route shell** (`AdminLayout` = client-side login gate + horizontal top-bar nav + `<Outlet>`;
  routes `/admin` Dashboard-stub · `/admin/songs` · `/admin/artists` · `/admin/playlists` ·
  `/admin/data-quality` · `/admin/song/:id` Workbench-**stub**); the **Songs area** (`QueueRail`
  off `/curation/counts` grouped Capture/Needs-work/Parked/Publish with Inbox + Needs-analysis
  disabled as C/B stubs; `SongQueueList` off `/curation/queue` with missing-item chips, debounced
  search, Prev/Next paging that never misuses `total`, `?queue=` URL sync + sanitize→`to-process`
  for disabled/unknown keys, row-click → Workbench stub); a working **Add a song** modal (quick
  capture + Spotify paste); Artists/Playlists/Data-quality **re-parented untouched**. **Two small
  backend additions (TDD):** a `live` key in `curation.queueCounts`; `curation.quickCapture` +
  `POST /api/admin/curation/quick-capture` creating a **pending** manual song (the legacy
  `manual-songs` endpoint defaults `status='included'`, wrong for fresh captures). New
  `frontend/src/styles/admin.css` (design tokens only). `AdminInterface.jsx` deleted; 7 superseded
  tool components **unmounted** (files retained for A3/A4). **Verification:** backend `node --test`
  **42/42**; `npm run build` clean, `eslint` 0 errors; **headless smoke 17/17** (login gate,
  5-area top-bar nav, rail with live count 1342, disabled slots, 50-row list + friendly header +
  chips, add-a-song bumping to-process 193→194, search, row→stub `/admin/song/6573`, all areas
  render; test rows cleaned, to-process back to 192). Two console errors observed are
  **pre-existing, in re-parented untouched components** (ArtistsManager's stray
  `via.placeholder.com` → `ERR_CONNECTION_CLOSED`; a `<style jsx>` non-boolean-attr warning),
  flagged since 3.3 — not A2 regressions. Final review deferred a handful of Minors to A3
  (non-transactional quickCapture upsert; debounce delays paging + no AbortController; a11y
  backdrop-close). Branch pushed; **not merged to `main`** — awaiting curator click-through.
- **2026-07-13 (A1 — data & backend foundation; incl. power-outage recovery)** — Executed plan
  [`A1`](./superpowers/plans/2026-07-12-admin-workbench-A1-backend.md) — all 7 TDD tasks:
  **migration 006** (`song_processing` table, `songs.language`, local-only
  `song_lyrics.translation` — applied via psql); **`backend/services/curation.js`** (processing
  state upsert with `park_reason`/snooze; derived queues `to-process` / `awaiting-community` /
  `remind-later` / `needs-lyrics` / `needs-cover` / `needs-video` / `needs-analysis` /
  `to-finalise` + `queueCounts` incl. submissions `inbox`; `getWorkbench` assemble-read; per-panel
  saves details/lyrics/highlights/links/cover); **`backend/services/videos.js`** (the
  "exactly one primary per song" invariant — add/update/setPrimary/delete with promotion);
  **lyrics-privacy guardrail** (`lyrics_privacy.test.js` asserts no public route references
  `song_lyrics`/`translation`). Routes added to `admin.js` under a "Curation workbench" banner,
  all behind `authenticateAdmin`. Reuses `staging.js` lifecycle unchanged. **The session was cut
  off by a power outage** after the work was committed + merged to `main` (`145efbb`, plus a
  parallel-race test fix `35a632a`) but before End-Session ran. **Recovered 2026-07-13:** re-ran
  the full suite (**40/40 green**), live-route smoke against a fresh backend ✅
  (`curation/counts` → 200 real data [192 to-process, 603 needs-lyrics, 715 needs-video, 43
  to-finalise, 2 inbox]; `curation/queue` → rows with computed `missing[]`; `workbench/541` →
  full assembled object, completeness all true, full lyrics returned on the admin path;
  `workbench/-999` → 404; no-header → 401), updated these docs, and pushed the 9 backlogged
  commits. **No frontend yet** — A2–A4 consume these endpoints (A2 plan still to be written).
- **2026-07-12 (Admin brainstorm + A1 planning)** — Design/planning session, **no production
  code changed** (no smoke test). Brainstormed the admin-layer rebuild with the curator via
  user stories; wrote and committed the design spec
  [`superpowers/specs/2026-07-12-admin-workbench-design.md`](./superpowers/specs/2026-07-12-admin-workbench-design.md)
  (`45a5566`) — admin reorganised 10 tabs → 5 job-areas around a single full-page Curation
  Workbench + derived queues, decomposed into sub-projects A–F (see Decision Log). Then wrote
  and committed the first implementation plan
  [`superpowers/plans/2026-07-12-admin-workbench-A1-backend.md`](./superpowers/plans/2026-07-12-admin-workbench-A1-backend.md)
  (`c1ac727`) — A1 = data + backend foundation, 7 TDD tasks (migration 006:
  `song_processing` / `songs.language` / `song_lyrics.translation`; `curation.js` service:
  processing state · derived queues + counts · workbench assemble-read · per-panel saves;
  `videos.js`: one-primary invariant; a lyrics-privacy guardrail test), reusing the existing
  `staging.js` lifecycle. Also created `docs/LYRICS_ANALYSIS_INTEGRATION.md` (curator-supplied)
  documenting the shared `song_lyric_analysis` table + `taxonomy.json` codebook that B will
  consume. `PROJECT_STATE.md` + `PROJECT_PLAN.md` updated: admin rebuild = **Phase 4**,
  deployment → **Phase 5**. Frontend plans A2–A4 to be written against A1's real endpoints.
- **2026-07-11 (Session 3.3)** — Remaining pages & polish (closes Phase 3). On branch
  `session-3.3-remaining-pages` (base `4627464`, plan committed at `c272c1d`), 9 code
  tasks + full smoke test, all review-approved: **(1) Playlists made read-only**
  (curator decision — see Decision Log): kit playlist cards, Create-playlist button/
  modal and `AddToPlaylistModal.jsx` deleted (26 → 25 components), remove-song control
  gone from playlist detail, dead "coming soon" play button removed from `SongCard`;
  backend playlist routes untouched (still serve the admin Manage Playlists tab).
  **(2) Playlist Detail** restyled to artist-page row conventions, fixing the 3.2-era
  40px-thumbnail clash. **(3) Submit** — kit form + guidelines sidebar. **(4) Dashboard**
  — kit layout, Chart.js recolored to brand tokens (ember line, moss bars — rainbow
  palette gone). **(5) About** — kit structure with the curator's merged copy (care/
  appreciation framing, "critique animal exploitation" wording — see Decision Log),
  live stat badges via new shared `frontend/src/utils/stats.js`. **(6) Accessibility
  pass**: keyboard access (Enter + Space + `aria-label`) on every clickable card,
  `aria-label`s on icon-only controls, an alt-text audit, exactly one `<h1>` per route
  (the app-shell heading became `.site-title` — a home link — freeing each page to own
  its `<h1>`), focus-visible rings on cards. **(7) Admin light touch**: headless walk of
  all 10 tabs found zero breakage from the public restyle (no diff, no task review —
  see Decision Log). **(8) App.css bridge cleanup**: legacy monolith **6,287 → 5,187
  lines** this session (dead public blocks + unused bridge `:root` vars removed); both
  pre-existing esbuild CSS warnings eliminated. **Incident:** a PowerShell 5.1
  whole-file rewrite corrupted BOM-less UTF-8 into mojibake in
  `ArtistSearchAndFilter.jsx` (Task 7) — repaired byte-identical in a follow-up commit
  (`58393cb`); root cause + fix now a standing watch-out (per-hunk `Edit`, never a
  whole-file PowerShell rewrite, for any file with non-ASCII glyphs like → or box-
  drawing characters). **Smoke test ✅ (Task 10):** full headless walk of all 11 routes
  at 1280 **and** 390 (22 checks) — real data renders, zero horizontal overflow, zero
  console/page errors, zero emoji in visible public text (the only unicode hits are
  intentional `←`/`→`/`↗` navigation glyphs); `grep via.placeholder frontend/src` = 1
  match, but it's in admin-only `ArtistsManager.jsx`, untouched since before this
  session (pre-existing, out of scope — flagged for a future admin pass). Admin login +
  all 10 tabs walked at 1280: clean except two **pre-existing, admin-only, untouched-
  this-session** issues surfaced for the record — a `net::ERR_CONNECTION_CLOSED` on the
  Manage Artists tab's stray `via.placeholder.com` fallback image, and a `<style jsx>`
  non-boolean-attribute React warning in `DataCompletionDashboard.jsx` (last touched in
  3.2, not 3.3). `npm run build` clean (2.3s); `npx eslint src/` → **0 errors**
  repo-wide (13 pre-existing `react-hooks/exhaustive-deps` warnings remain, none new).
  Branch pushed; **not merged to `main`** — awaiting curator click-through. **Phase 3
  exit criteria met pending that click-through.**
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
