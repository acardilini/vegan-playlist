# Triage item 3 — featured-songs redesign

_Design spec. 2026-07-21. Curator-approved at brainstorm._
_Backlog: [`CURATOR_TRIAGE_BACKLOG.md`](../../CURATOR_TRIAGE_BACKLOG.md) §"Featured songs"._

## Goal

Give the curator real control over the homepage "Featured songs" and remove two card
inconsistencies. Restore a "set featured" control (deleted in the Phase-4 admin rebuild),
make the fill deterministic instead of random-from-the-whole-catalogue, and drop the
inconsistent card date.

## Problem / current behaviour

- `GET /api/spotify/songs/featured` returns songs with `songs.featured = true` (currently ~2),
  ordered by `playlist_added_at DESC`, then **fills the remaining slots up to 4 with `ORDER BY
  RANDOM()`** included+published songs — hence "two always show, the rest look random."
- The `featured` column + a backend writer (legacy `PUT /api/admin/update-song/:id`) still work,
  but **no admin UI sets it** — the Phase-4 rebuild deleted the old Manage Songs featured toggle
  and nothing replaced it (no `featured` reference in `frontend/src/components/admin/`).
- `SongCard` shows a mood chip only when `custom_mood` exists (~654/1,332 live songs) and an
  added-date only when `playlist_added_at` exists (absent for the ~534 Apr-2026 batch + manual
  songs) — both look inconsistent across cards.

## Decisions (curator)

1. **Featured model = curated pins with a recency fill, and random cycling of a large pin set.**
   - **≥ 4 pinned:** show a **random 4 of the pinned set, reshuffled on each page load** (a cycle
     through the curated set — random *within the curated pins* is wanted; random from the whole
     catalogue was the problem).
   - **< 4 pinned:** show all pins, then **fill the remaining slots with the most-recently-added**
     included+published songs (deterministic — `COALESCE(playlist_added_at, date_added) DESC`).
   - Max 4 total (unchanged).
2. **Restore a "set featured" toggle** in the admin **workbench top bar**, beside Publish.
3. **Mood chip: keep as-is** — shows only when `custom_mood` exists (documented, no code change).
4. **Card date: drop it** — remove the added-date line from `SongCard` entirely (uniform across all
   card surfaces).

## Design

### Backend

**1. `GET /api/spotify/songs/featured` — deterministic fill + pin cycling.**
- Pinned query becomes: `… WHERE s.featured = true AND s.status='included' AND s.published=true
  ORDER BY RANDOM() LIMIT $limit`. With > 4 pins this returns a random 4 each load (the cycle);
  with ≤ 4 pins it returns all of them (random order among them, harmless).
- Fill query (only when the pinned result has < `limit` rows) changes `ORDER BY RANDOM()` →
  `ORDER BY COALESCE(s.playlist_added_at, s.date_added) DESC NULLS LAST` (most-recently-added),
  still excluding the already-selected ids and any `featured=true` rows. `limit` stays capped at 4.
- Remove the stray `DEBUG` `console.log`s in this handler. Leave the dead audio-feature columns
  (`energy`/`danceability`/`valence`/`tempo`) in the SELECT — out of scope.

**2. Restore the set-featured control (backend).**
- Add `POST /api/admin/songs/:id/feature` and `POST /api/admin/songs/:id/unfeature`, mirroring the
  existing `publish`/`unpublish` lifecycle routes, each backed by a new pure-ish service function
  `curation.setFeatured(db, id, boolean)` (`UPDATE songs SET featured=$2, updated_at=now() WHERE
  id=$1 RETURNING id, featured`; 404 when no row). Featuring is allowed on any song; the display
  query already gates on `included AND published`, so only published pins actually surface.
- Add a **backend `node:test`** for `setFeatured` (own sentinel prefix, e.g. `ZZZFEAT`, per the
  per-file-sentinel rule) — sets true/false, asserts the column and a 404 on a missing id.
- Leave the legacy `PUT /update-song/:id` featured path untouched (dead now, out of scope).

**3. Workbench payload.** Add `featured` to the `GET /api/admin/workbench/:id` SELECT so the toggle
reflects current state.

### Frontend

**4. Workbench top bar — "Featured" toggle.** In `WorkbenchTopBar`, add a toggle button beside
Publish that reflects `wb.featured` and calls the workbench's `doAction('feature')` /
`doAction('unfeature')` (same `POST /api/admin/songs/:id/:path` path the other lifecycle buttons
use). Copy notes that only published songs appear in the homepage Featured section.

**5. `SongCard` — drop the date.** Remove the `song.playlist_added_at && <span className="song-added">…`
block and the now-unused `formatPlaylistAddDate` helper. **Mood chip unchanged.** `SongCard` is
shared, so the date drops from homepage/browse/artist cards uniformly. (Leave the `.song-added` CSS
rule — harmless dead style; note it for a later sweep.)

## Testing

- Backend `node:test` for `curation.setFeatured` (green; part of the suite).
- Live smoke (backend restarted fresh; frontend running):
  - Workbench: toggle Featured on a published song → reflected on reload; it appears **leading** in
    the homepage Featured section.
  - Pin ≥ 5 published songs → the homepage Featured shows a random 4 that **reshuffles across
    reloads** (the cycle); all four are always from the pinned set.
  - Pin < 4 → pins lead, remaining slots are the **most-recently-added** songs and are **stable**
    across reloads (no random churn).
  - Cards show **no date**; the mood chip still shows only where a mood exists.

## Scope / out of scope

- **In:** `routes/spotify.js` (featured handler), `routes/admin.js` (+ `feature`/`unfeature`,
  workbench payload), `services/curation.js` (`setFeatured` + test), `WorkbenchTopBar`, `SongCard`.
- **Out:** a dedicated "manage featured / reorder" admin view (YAGNI — per-song toggle is enough);
  the mood chip; removing the legacy `update-song` route or the dead audio-feature columns; the
  dead `.song-added` CSS. Independent of the in-progress DB cleaning (uses `songs.featured`, not
  `song_lyric_analysis`).
