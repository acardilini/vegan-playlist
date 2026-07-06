# Feature Inventory — Session 0.1 (Phase 0)

_Compiled 2026-07-07 by walking every frontend route, every backend endpoint (verified live
against the running backend), and every component/script. This is the safety net for the
modernisation: nothing gets rebuilt or removed without appearing here first._

**Decision legend**
- **keep** — feature stays; will be restyled (Phase 3) but behaviour preserved.
- **rebuild** — feature stays but its implementation is replaced (phase noted).
- **drop** — remove; dead code, debug leftovers, or superseded.
- **defer** — intentionally postponed; listed in the Backlog in `PROJECT_PLAN.md`.

Decisions marked **⚑ confirm** need the curator's sign-off before being acted on.

---

## 1. Public site — screens (11 routes in `App.jsx`)

| Route | Screen | What it does / data touched | Decision |
|---|---|---|---|
| `/` | HomePage (inline, App.jsx:1115) | Hero + live stats (`db-stats`), 4 featured songs (`songs/featured`), full browse/search with filters + pagination (`search`, `filter-options`) | **keep** — the core experience |
| `/search` | SearchResults.jsx (21 lines) | Just redirects to `/` preserving the query | **drop** the stub; keep redirect behaviour via router config (Phase 2.1) |
| `/song/:id` | SongDetailPage (inline, App.jsx:226) | Artwork, meta, lyric highlights, vegan categorisation badges, audio features, review, YouTube embed (`songs/:id`, `songs/:id/similar`, `youtube …/video/primary`) | **keep** — core |
| `/artists` | ArtistSearchResults.jsx | Artist grid with search/filter/sort (`artists/search`, `artist-filter-options`) | **keep** |
| `/artist/:id` | ArtistDetailPage.jsx | Artist bio/images/genres + their songs (`artists/:id`) | **keep** |
| `/playlists` | PlaylistsPage (inline, App.jsx:1404) | Lists playlists; **anyone can create playlists anonymously** (`/api/playlists` CRUD) | **keep** browsing curated playlists; **defer** public playlist creation until there's an auth/spam story (Phase 4+) **⚑ confirm** |
| `/playlist/:id` | PlaylistDetailPage (inline) | Playlist songs; **anyone can remove songs** from any playlist | same as above — public mutation deferred **⚑ confirm** |
| `/submit` | SongSubmissionForm.jsx | Community song suggestions with validation (`submissions/submit`) | **keep** |
| `/dashboard` | DataDashboard.jsx | Public analytics: year/genre distributions, audio features, vegan themes (`analytics/*`) | **keep**, but vegan-themes chart is empty today (`songs_with_themes: 0`) — data fixed in Phase 1 |
| `/about` | AboutPage (inline) | Static mission/approach text | **keep** (copy refresh in Phase 3) |
| `/admin` | AdminInterface.jsx (2,188 lines) | Whole admin suite behind a shared password | **keep** features, **rebuild** auth (Phase 4.1); split into components (Phase 2.1) |

Dead code found in `App.jsx`:
- `ArtistsPage` (App.jsx:1132, ~270 lines) — never routed; `/artists` renders `ArtistSearchResults` instead. **drop** (Phase 2.1).
- `SongCard` play button and stat-tile clicks show "coming soon" alerts; "40+ Hours" stat is hardcoded. Resolve in Phase 3 (real behaviour or remove the affordance).

## 2. Admin interface — 9 tabs (`AdminInterface.jsx`)

| Tab | Component | What it does / endpoints | Decision |
|---|---|---|---|
| Manage Songs | inline + BulkEditModal | List/search all songs (`all-songs`), edit song + featured flag (`update-song/:id`), manual song CRUD (`manual-songs*`), per-song categorisation (`songs/:id/categorize`), CSV bulk upload (`bulk-upload`) | **keep** — this is the curation tooling |
| Manage Playlists | inline | Create/delete curated playlists (uses public `/api/playlists` + `/api/spotify/playlist/:id`) | **keep** |
| Manage Artists | ArtistsManager.jsx | Artist list/stats/edit (`all-artists`, `artists-stats`, `artists/:id`); "setup discography tracking" button runs DDL | **keep**, except the DDL button — **drop** (becomes a migration) |
| Song Submissions | SubmissionsManager.jsx | Review queue: approve/reject/delete (`submissions/admin*`) | **keep** |
| Dashboard | DataCompletionDashboard.jsx | Data-completion stats (`completion-stats`) | **keep** — useful for Phase 1 |
| YouTube Videos | YouTubeVideoManager.jsx | Songs missing videos, YouTube search, save video (`youtube/*`, `save-youtube-video`) | **keep** |
| Lyrics Manager | LyricsLookupManager.jsx | Songs missing lyrics links, save lyric links (`songs-missing-lyrics`, `save-lyrics-link`); "setup lyrics" DDL button | **keep**, **drop** the DDL button |
| Bulk Categorization | BulkCategorizationWorkflow.jsx | One-song-at-a-time categorisation flow | **keep** |
| Duplicate Manager | DuplicateManager.jsx | Duplicate detection (`duplicate-songs`), Spotify validation (`spotify-validation`), playlist sync (`sync-spotify-playlist`), song delete | **keep** UI; sync itself is **rebuilt in Phase 1** to fit the truth-source model |

## 3. Backend endpoints (verified live 2026-07-07)

All 7 route groups respond. Auth: admin routes use a shared password accepted via header,
body, **or query string** (`admin.js:49`) — query-string acceptance should go in Phase 4.1.

### `routes/spotify.js` → `/api/spotify` (public)

| Endpoint | Purpose | Decision |
|---|---|---|
| `GET /songs/featured`, `/songs/:id`, `/songs/:id/similar`, `/search`, `/filter-options`, `/artists/search`, `/artist-filter-options`, `/artists/:id`, `/db-stats` | The public API the site actually uses | **keep** |
| `GET /playlist/:playlistId` | Live Spotify playlist fetch (admin sync check) | **rebuild** in Phase 1 (enrichment pipeline) |
| `GET /artists` | Older artist list; only referenced by dead `ArtistsPage` and unused `spotifyService.getArtists` | **drop** (consolidate on `/artists/search`, Phase 2.2) |
| `GET /test`, `/db-songs`, `/songs`, `/songs/featured-simple`, `/database-check`, `/debug/audio-features`, `/features/:trackIds`, `/artist/:artistId` | Debug/superseded/unused (note: Spotify deprecated the audio-features API for new apps in Nov 2024) | **drop** (Phase 2.2) |

### `routes/admin.js` → `/api/admin` (password-protected, 42 route definitions ~3,100 lines)

| Endpoint group | Purpose | Decision |
|---|---|---|
| `all-songs`, `update-song/:id`, `manual-songs` CRUD, `categorization-options`, `songs/:id/categorize`, `bulk-upload`, `songs/:id` DELETE | Core curation | **keep** |
| `save-youtube-video`, `save-lyrics-link`, `songs-missing-lyrics`, `completion-stats` | Enrichment tooling | **keep** |
| `all-artists`, `artists/:id` PUT, `artists-stats` | Artist management | **keep** |
| `duplicate-songs`, `spotify-validation` | Data-quality checks | **keep** |
| `sync-spotify-playlist` | Pulls the hardcoded-default Spotify playlist, adds new songs, flags removed ones | **rebuild** in Phase 1 — this is exactly the truth-source/enrichment boundary |
| `removed-songs`, `removed-songs-simple`, `spotify-playlist-mismatch`, `playlist-discrepancies` | Sync-adjacent reports, unused by the frontend | **drop**; fold anything useful into the Phase 1 sync design |
| `setup-lyrics`, `setup-playlist-sync`, `setup-discography-tracking` | **One-off schema migrations run over HTTP** (DDL from the browser) | **drop** — convert to migration files (Phase 2.2) |
| `admin-playlists`, `playlists` GET ×2, `playlists/:id` DELETE ×2 | Duplicate definitions *within the same file* (Express only ever hits the first) | **drop** duplicates, keep one (Phase 2.2) |
| `categorize-songs` (bulk POST) | Unused by frontend (UI categorises per-song) | **drop** |
| `test-update/:id` ×2, `test-featured-noauth/:id`, `test-featured/:id`, `test`, `simple-test`, `test-playlists`, `test-sync` | Debug leftovers. **Two are mounted BEFORE the auth middleware** — verified live: `PUT /api/admin/test-update/:id` answers without a password, and `test-featured-noauth/:id` **writes `songs.featured` unauthenticated** | **drop** — the two pre-auth routes ASAP, not waiting for Phase 2 **⚑ confirm** |

### `routes/playlists.js` → `/api/playlists` (public, no auth)

Full CRUD incl. add/remove songs — all 7 used by the site and admin. **keep** the API;
public write access is the same **⚑ confirm** deferral as the Playlists screen.

### `routes/youtube.js` → `/api/youtube`

| Endpoint | Decision |
|---|---|
| `GET/POST songs/:songId/videos`, `GET …/video/primary`, `GET songs/missing-videos`, `POST /search` (YouTube Data API) | **keep** |
| `PUT/DELETE /videos/:videoId`, `POST /extract-id` | unused — **drop** (Phase 2.2) |

### `routes/lyrics.js` → `/api/lyrics`

3 read-only endpoints; the frontend uses the `/api/admin` equivalents instead. **drop** the
route file, consolidating anything missing into admin (Phase 2.2).

### `routes/submissions.js` → `/api/submissions`

`submit` (public) + `admin` list/get/status/delete — **keep**. `GET /stats` unused — **drop**.

### `routes/analytics.js` → `/api/analytics` (public)

All 6 endpoints used by the Dashboard — **keep**. Note `vegan-themes` currently reports
`songs_with_themes: 0` (categorisation data absent or in a different column than the query
expects) — investigate in Session 0.2, fix in Phase 1.

### Unmounted / infrastructure

- `routes/admin_simple.js` (never mounted in `server.js`) — **drop**.
- `backend/test_bulk_simple.csv`, `backend/uploads/` residue — **drop**/gitignore (Phase 2.3).
- `utils/genreMapping.js` — parent-genre mapping used by admin + search. **keep**, but the same
  mapping is duplicated inline in `App.jsx` (`SongCard.getParentGenre`) — consolidate to one
  source (Phase 2.1).

## 4. Backend scripts (`backend/scripts/`, 39 files) — Phase 2.3

- **keep (documented location):** `importSpotifyDataEnhanced.js`, `syncSpotifyPlaylist.js` (until the Phase 1 pipeline replaces it), `auditDatabase.js`, `exportAllSongsData.js`, `runMigration.js` + `database/migrations/`.
- **drop/archive (~34):** one-off `test*`, `check*`, `debug*`, `diagnose*`, `fix*`, `add*`, `setup*`, `create*`, `migrate*`, `compare*`, `flag*`, `show*`, `simpleSyncSpotify.js`, `restartServer.js`, `youtubeApiServer.js` — all served their purpose; git history preserves them.

## 5. Cross-cutting observations (feed later sessions)

- **Data reality (live 2026-07-07):** 1,208 songs / 558 artists / 721 albums; years 1967–2025; 52 genres; lyrics links on only 10 songs; 0 submissions; vegan-theme analytics empty. The 1,208 vs ~650 gap is Session 0.2's first question (likely includes `removed_from_playlist` flags and manual additions — `data_source` column exists).
- **Security debt (Phase 4.1, two items sooner):** pre-auth admin test routes (above), admin password accepted in query strings, DDL-over-HTTP endpoints, unauthenticated public playlist mutation.
- **Schema sprawl:** base `schema.sql` + 6 add-on SQL files + HTTP DDL endpoints means the real schema exists only in the live DB — document it in Session 0.2 and adopt migration files in Phase 2.
- **`CLAUDE.md` architecture section** predates reality (lists only 1 route file, describes components that are actually inline) — updated this session.

## 6. Backlog candidates (recorded in `PROJECT_PLAN.md`)

- Public playlist creation/editing with real accounts (currently anonymous, unauthenticated).
- Song audio previews / embedded player (play buttons are "coming soon" alerts).
- Clickable stat tiles ("show all songs/artists").
- Analytics event tracking, custom visualisation builder, offline capability (PRD deferrals).
