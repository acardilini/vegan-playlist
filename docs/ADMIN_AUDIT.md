# Admin Consolidation Audit — 2026-07-08 (pre-Session 2.2)

> **Status: fully executed.** §1 + §4 backend items shipped in Session 2.2 (2026-07-08) —
> deletions, catch-up migrations, six-domain grouping, and the submissions→pending bridge
> (`POST /api/admin/submissions/:id/add-to-pending`). §3's UI work shipped in Session 2.2b
> (2026-07-09) — sync + mismatch live in Staging → Add candidates, one shared
> `CategorizationFields` form, Submissions "Approve & add to pending", `AdminInterface`
> decomposed with the shared `adminFetch` helper (relative `/api` + password header).

_Compiled by cross-referencing every route definition in `backend/routes/admin.js` against
every fetch call in the frontend (`AdminInterface.jsx` + the 9 admin tab components +
`BulkEditModal`). Supersedes the admin sections of `FEATURE_INVENTORY.md` (Session 0.1) where
they differ — Sessions 1.2–1.4 added new admin surface (import-only sync, publish/unpublish,
6 staging endpoints, the Staging tab) that the Phase 0 inventory predates. Curator decisions
below were confirmed 2026-07-08. Audit only — no code changed._

---

## 1. Backend — `routes/admin.js`: 47 route definitions, ~2,900 lines

**28 keep / 17 delete / 2 convert to migrations.** Roughly one route in three is dead code.

### Delete (17) — called by nothing

| Group | Routes (line) | Why dead |
|---|---|---|
| Debug leftovers | `GET /test` (29), `PUT /test-update/:id` (34), `PUT /test-featured/:id` (40), `GET /simple-test` (73), `GET /test-playlists` (1167), `GET /test-sync` (2512) | Development scaffolding, all behind auth, no callers |
| Playlist endpoints | `GET /admin-playlists` (78), `GET /playlists` (119 **and** 1172), `DELETE /playlists/:id` (160 **and** 1210) | **All 5 dead** — the Manage Playlists tab uses the public `/api/playlists` API, not these. Two are literal duplicate definitions in the same file; Express only ever dispatches to the first |
| Sync-era reports | `GET /removed-songs` (2153), `GET /removed-songs-simple` (2474), `GET /playlist-discrepancies` (2377) | Report on `removed_from_playlist`, which nothing has written since the 1.2 import-only sync rebuild — they can never show data again |
| Misc unused | `GET /manual-songs` (259), `POST /categorize-songs` (864), `POST /setup-playlist-sync` (2213) | Manual songs are listed via `all-songs`; the UI categorises per-song; the DDL never had a UI |

Also delete: **`routes/admin_simple.js`** (360 lines, never mounted in `server.js`).

### Convert to migration files, then delete (2)

- `POST /setup-lyrics` (1804) — wired to a button in Lyrics Manager
- `POST /setup-discography-tracking` (2517) — wired to a button in Manage Artists

Both are one-off DDL that already ran against the live DB. Session 2.2: verify the schema
objects exist, record the DDL as catch-up migration files in
`backend/database/migrations/` (documentation of applied state), delete the routes **and
their UI buttons**.

### Keep (28) — the real admin API

| Domain | Routes |
|---|---|
| Songs / curation | `all-songs`, `update-song/:id`, `manual-songs` POST/PUT/DELETE, `categorization-options`, `songs/:id/categorize`, `bulk-upload`, `songs/:id` DELETE |
| Staging / lifecycle (1.2b–1.4) | `staging`, `staging/candidates`, `songs/:id/` `include`·`reject`·`publish`·`unpublish`·`play-link`·`attach-spotify` |
| Sync (import-only, 1.2) | `sync-spotify-playlist`, `spotify-playlist-mismatch` (no UI caller but the documented curator tool for the 149-songs task — surface in Staging, see §3) |
| Enrichment | `save-youtube-video`, `save-lyrics-link`, `songs-missing-lyrics`, `completion-stats` |
| Artists | `all-artists`, `artists/:id` PUT, `artists-stats` |
| Data quality | `duplicate-songs`, `spotify-validation` |

Grouping: 2.2 should order `admin.js` into these six sections (or split into per-domain
modules mounted under one auth middleware) so the file reads as its domains.

## 2. Frontend — 10 tabs, functional overlap

Structural debt (for 2.1/2.2b): Manage Songs + Manage Playlists are ~1,500 lines inline in
the ~2,300-line `AdminInterface.jsx`; every component duplicates `API_BASE` + password-header
boilerplate; most hardcode `http://localhost:5000` although the Vite proxy makes relative
`/api` work (BulkEditModal already proves it). Deployment (Phase 4) needs the relative form.

Functional overlap found:

1. **Song intake exists three ways**: manual-song form (Manage Songs), Add candidates
   (Staging, Spotify URLs → pending), and the Sync button (**Duplicate Manager**, default
   playlist diff → pending). The last two already share `utils/playlistSync.js` — the
   duplication is UI-only.
2. **Categorisation UI exists twice**: the per-song modal in Manage Songs and the Bulk
   Categorization tab call the same two endpoints with two independent form implementations.
3. **YouTube attach exists twice**: Manage Songs' edit flow and the YouTube Videos tab both
   save via `save-youtube-video` with separate UIs.
4. **Lifecycle actions are scattered**: include/reject/publish in Staging; `featured` in
   Manage Songs; delete in Duplicate Manager (any song) *and* Manage Songs (manual only).
5. **Submissions is a dead end**: approving a community submission only updates the
   submission row — no pending song is created (0 submissions exist today).

## 3. Curator decisions (2026-07-08)

1. **Sync moves to Staging.** Add candidates gains a "Sync from playlist" action
   (default = the real playlist) and surfaces the `spotify-playlist-mismatch` report.
   Duplicate Manager becomes a pure data-quality tab (duplicates + Spotify validation).
2. **One shared categorisation form, both entry points kept.** Extract a single
   categorisation form component used by the Manage Songs modal and the one-at-a-time
   workflow. No curator workflow disappears.
3. **Build the submissions → staging bridge in 2.2.** Approving a submission gains an
   "add to pending queue" step reusing the staging candidate-intake service.

## 4. Target shape

- **Backend:** `admin.js` ~2,900 → ~1,800 lines; 28 routes in six named domains; zero dead
  routes; zero DDL-over-HTTP; `admin_simple.js` gone. Also execute the Phase 0 inventory's
  other backend drops (dead `spotify.js` debug routes + `GET /artists`, unused `youtube.js`
  PUT/DELETE/extract-id, the unused `lyrics.js` route file, `submissions.js` `GET /stats`,
  `analytics.js` `GET /audio-features`).
- **Tabs 10 → 9, cleanly bounded:** Staging = all intake + lifecycle (candidates, sync,
  mismatch, include/reject/publish); Duplicate Manager = data quality only; Manage Songs and
  Bulk Categorization share one categorisation form; Submissions approve feeds the pending
  queue. (AdminInterface decomposition itself is Session 2.2b, after the public-page
  decomposition establishes the folder structure in 2.1.)

Session split agreed: **2.2 = backend consolidation** (prune, migrations, grouping, bridge
endpoint), **2.2b = admin UI consolidation** (sync → Staging, shared categorisation form,
approve-to-pending button, AdminInterface decomposition + shared fetch helper with relative
URLs).
