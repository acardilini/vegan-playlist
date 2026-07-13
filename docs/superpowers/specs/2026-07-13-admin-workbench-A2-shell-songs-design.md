# Admin Workbench — A2: Nav Shell + Songs Area — Design

**Date:** 2026-07-13
**Sub-project:** A2 (frontend) of Phase 4 Admin Rebuild.
**Parent spec:** [`2026-07-12-admin-workbench-design.md`](./2026-07-12-admin-workbench-design.md) — this refines §5 (10 tabs → 5 job-areas) and the frontend half of §6 for the **Songs** area.
**Consumes:** A1's live admin API (`GET /api/admin/curation/counts`, `GET /api/admin/curation/queue?queue=…&q=&limit=&offset=`, `GET /api/admin/workbench/:id`) plus the existing `staging` intake and manual-song create paths. All admin fetches go through `adminFetch` (`src/api/adminApi.js`).

---

## 1. Goal & scope

Replace the current 10-tab `AdminInterface` with the parent spec's **5 job-areas**, and build the **Songs** area (queue rail + list + Add-a-song) against A1's real endpoints. The Workbench that songs open into is **A3** — A2 ships it as a stub. Artists / Playlists / Data quality are re-parented untouched.

**In scope:** the nav shell (routing + login gate + sidebar), the Songs area, a functional Add-a-song, the Workbench stub route.
**Out of scope (later sub-projects):** the real Workbench (A3), the Dashboard contents (A4), analysis display (B), submissions moderation (C).

---

## 2. Decisions (this session)

1. **Navigation model — real nested routes** (not internal tab state). Each area is a bookmarkable URL; browser back/forward works; sets up A3's prev/next and deep-linkable song pages. The app already uses React Router, so `/admin` becomes a layout route with children.
2. **Shell layout — Option B: left sidebar + queue rail.** A slim left **sidebar** lists the 5 areas; inside Songs a second **queue-rail** column lists the queues; then the song list. (Chosen over a top-bar + rail via visual mockup.)
3. **Add-a-song — functional in A2, as a modal.** Reuses backend that already exists; makes the curator's #1 anti-stagnation job work from day one of the new admin.
4. **Replace the old shell outright now** (no legacy coexistence). The new 5-area shell is the sole `/admin`. **Accepted tradeoff:** per-song *editing* (lyrics paste, include/reject, publish, attach-Spotify — today in `StagingQueue`) is **not** in the new shell until the A3 Workbench lands; intake (Add-a-song) keeps working throughout. → **A3 must be the next session after A2** so the editing gap is short.
5. **Styling — Phase-3 brand tokens on the new surfaces** (shell + Songs area); re-parented panels keep their legacy look until their own pass.

---

## 3. Routing & components

`AdminInterface` (or a new `AdminLayout`) becomes a thin shell: the existing client-side login gate wraps the layout; authenticated, it renders the sidebar + `<Outlet>`.

Route tree (nested under the existing `/admin` route in `App.jsx`):

| Route | Renders | A2 status |
|---|---|---|
| `/admin` (index) | Dashboard | **stub** placeholder (built in A4) |
| `/admin/songs` | `SongsArea` | **the A2 deliverable** |
| `/admin/artists` | `ArtistsManager` | re-parented, untouched |
| `/admin/playlists` | `ManagePlaylistsTab` | re-parented, untouched |
| `/admin/data-quality` | `DuplicateManager` | re-parented, untouched |
| `/admin/song/:id` | `WorkbenchStub` | **stub** (title + "Workbench arrives in A3") |

New components (each one clear purpose, fetch via `adminFetch`):

- **`AdminLayout.jsx`** — login gate + sidebar (5 areas, active-route highlight, "Log out") + `<Outlet>`.
- **`SongsArea.jsx`** — orchestrates the Songs page: holds selected-queue + search + page state (reflected in the URL query), renders `QueueRail` + `SongQueueList` + the Add-a-song trigger/modal.
- **`QueueRail.jsx`** — reads `/curation/counts`; renders queues grouped **Capture · Needs work · Parked · Publish** with live counts; Inbox & Needs-analysis rendered **dimmed/disabled** (reserved for C/B). Selecting a queue updates `SongsArea` state.
- **`SongQueueList.jsx`** — reads `/curation/queue?queue=…&q=&limit=&offset=`; renders rows + pagination + search box.
- **`AddSongPanel.jsx`** — the modal (two modes, below).
- **`WorkbenchStub.jsx`** — minimal placeholder page for `/admin/song/:id`.

Login/auth is unchanged in substance (client-side compare to `VITE_ADMIN_PASSWORD`; real auth is Phase 5). It moves from `AdminInterface`'s body to the layout wrapper so every admin route is gated.

---

## 4. Songs area behaviour

**Queue rail**
- Source of counts: `GET /curation/counts`. A1 returns `to-process`, `awaiting-community`, `remind-later`, `needs-lyrics`, `needs-cover`, `needs-video`, `needs-analysis`, `to-finalise`, `inbox` — but **not** `live`. Since the Live count is the rail's headline number, A2 adds a `live` key to `queueCounts` (reuses the existing `queueWhere('live')` clause; covered by extending the existing `queueCounts` test). This is one of A2's two small backend touches — see §5 for the other (`quickCapture`).
- Grouping & labels:
  - **Capture:** Inbox *(dimmed)* · To be processed (`to-process`)
  - **Needs work:** Needs lyrics · Needs cover · Needs video · Needs analysis *(dimmed)*
  - **Parked:** Awaiting community (`awaiting-community`) · Remind me later (`remind-later`)
  - **Publish:** To finalise (`to-finalise`) · Live / All (`live`/`all`)
- The last slot is **Live** (`queue=live` = `status='included' AND published=true`) — the "done / on the site" bucket, and the count the curator most wants to see. (`all` is available from the same list endpoint for a browse-everything view but is **not** a distinct A2 rail slot.)
- Default selected queue on landing: **To be processed**.
- Selected queue is reflected in the URL (`/admin/songs?queue=needs-lyrics`) so it is linkable/bookmarkable.

**Song list**
- Source: `GET /curation/queue?queue=<key>&q=<search>&limit=<n>&offset=<n>`.
- Row: cover thumbnail (striped placeholder when `has_art=false`) · title · artist(s) · status badge (pending/included/live styling) · missing-item chips from the row's `missing[]` (e.g. "no lyrics", "no cover", "no video", "no play link").
- **Pagination — Prev/Next, no total-pages count.** A1's `listCurationQueue` returns `total = rows.length` (the *page* size, not the full match count), so the UI must **not** treat `total` as a grand total. Instead: request `limit=PAGE_SIZE` (~50); show **Next** when a full page came back, **Prev** when `offset>0`. This needs no A1 change and is enough for a work queue the curator drains top-down.
- **Search within queue:** text box → the endpoint's `q` param (title/artist ILIKE); debounced; resets to page 1 (offset 0).
- Row click → navigate to `/admin/song/:id` (the stub in A2; the Workbench in A3).
- Empty state per queue ("Nothing here right now").

---

## 5. Add a song (modal)

Opened from a "+ Add a song" button in the Songs area. Two modes in one modal; the modal **stays open and clears after each successful add** so the curator can add several in a row, and it **refreshes the rail counts** on success.

- **Quick add** — title + artist → creates a `pending` manual song. **Backend note:** the legacy `POST /api/admin/manual-songs` defaults `songs.status` to `'included'` (migration 001's column default), which would drop a fresh capture into *To finalise*, not *To be processed*. So A2 adds a small, unit-tested `curation.quickCapture(db, { title, artist })` service + `POST /api/admin/curation/quick-capture` route that inserts a `pending`, `data_source='manual'` song + artist link (mirroring the existing `curation.test.js` `mkSong` helper). Minimal fields; the rest is filled later in the Workbench.
- **From Spotify** — paste one or many Spotify URLs → the existing `POST /api/admin/staging/candidates` endpoint (what today's "Add candidates" calls); returns `{ added, skippedExisting, invalid }`, all as `pending`. No change needed.

**Backend touches in A2 (two, both small and unit-tested):** the `live` key in `queueCounts` (§4) and `curation.quickCapture` + its route (above). Everything else is frontend against A1 as-is.

---

## 6. Deletions & re-parenting

- **New shell is the sole `/admin`.** The old 10-tab nav in `AdminInterface` is replaced.
- **Re-parented, untouched:** `ArtistsManager` → Artists · `ManagePlaylistsTab` → Playlists · `DuplicateManager` → Data quality.
- **Unmounted in A2 (no longer routed); files left in place for A3/A4 to delete after a data-parity check:** `StagingQueue`, `ManageSongsTab`, `LyricsLookupManager`, `YouTubeVideoManager`, `DataDashboard`, `SubmissionsManager`, `BulkCategorizationWorkflow`. Rationale for leaving the files: the parent spec assigns their deletion to A3 (workbench parity) and A4/B/C; unmounting now is enough to replace the shell without prematurely deleting code A3 may reference for parity.
- **`CategorizationFields`** stays (still used by the unmounted forms and owned by B).

---

## 7. Verification

Interaction smoke (headless or manual), against the live backend + Vite dev server:

1. Unauthenticated `/admin` shows the login gate; correct password reveals the shell; wrong password rejected.
2. Each area route renders: `/admin` (Dashboard stub), `/admin/songs`, `/admin/artists`, `/admin/playlists`, `/admin/data-quality`.
3. Rail counts equal `/curation/counts` (including the new `live` key); Inbox & Needs-analysis are visibly disabled.
4. Selecting each active queue loads rows matching that queue; `?queue=` in the URL selects it on load.
5. Search filters the list; pagination pages through a large queue (e.g. Needs video ~700).
6. A **quick-add** creates a pending song (appears in To-be-processed); a **Spotify paste** reports added/skipped — both test rows cleaned up afterward; rail counts refresh.
7. Row click lands on `/admin/song/:id` stub.
8. `npm run build` clean; `eslint src/` no new errors.

---

## 8. Follow-on

- **A3 — the real Workbench** at `/admin/song/:id` (all §4 panels of the parent spec, autosave-on-blur, prev/next, completeness checklist, reject-confirm, quick-search links, highlights picker), consuming A1's `GET/PUT /workbench/*` + video endpoints and the `staging` lifecycle. Deletes `StagingQueue`, `LyricsLookupManager`, `YouTubeVideoManager`, `ManageSongsTab` after a parity check. **Should immediately follow A2** (closes the editing gap from decision #4).
- **A4 — Dashboard contents** (queue counts + Add-a-song entry + recent activity) replacing the stub; deletes `DataDashboard`.
