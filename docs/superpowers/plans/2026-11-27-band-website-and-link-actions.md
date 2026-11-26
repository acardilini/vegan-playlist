# Band website and link actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** a Website row per artist in the song Links panel, plus Add-to-playlist and Search-Bandcamp shown only when useful, and the one-off data move.
**Architecture:** `spotifyPush.isOnPlaylist` + a read route; `LinksPanel` rows and conditions; a guarded one-off data script.
**Tech Stack:** Express, node:test, React.
**Spec:** docs/superpowers/specs/2026-11-27-band-website-and-link-actions-design.md

## Global Constraints
- `isOnPlaylist` is read-only and never logs or rethrows a token, URL or fetch message (errors are fixed strings/codes). Tests inject `fetchTracks` and never touch the network; sentinel `ZZZOPL`.
- Only `artists.update` writes `artists.website_url`. Admin routes stay behind the existing password auth.

## Review Focus
- A song not on the playlist, with no Spotify id, dormant, or when the read fails: the button still shows (fail open); a song on the playlist shows the muted text instead.
- Search Bandcamp hidden once a Bandcamp URL exists and back when cleared.
- The data move never overwrites an existing artist website and never touches song 54.

### Task 1: Backend `isOnPlaylist` and route
**Files:** modify `backend/services/spotifyPush.js`, `backend/routes/admin.js`, `backend/test/spotifyPush.test.js` (or a new `spotifyOnPlaylist.test.js`).
**Interfaces:** Produces `isOnPlaylist(pool, songId, { playlistId, fetchTracks, now } = {}) -> { onPlaylist: boolean }` using the cached read; route `GET /api/admin/spotify/on-playlist/:songId` -> `{ success: true, onPlaylist }`, 502 with a fixed message on failure, 400 on a bad id.
- [ ] Tests first (RED): on the injected playlist -> true; not on it -> false; song without a Spotify id -> false and no read; a second call within the cache window does not re-read; a failing `fetchTracks` rejects.
- [ ] Implement, run `node --test`, then the full serial `npm test`. Commit `feat(links): on-playlist check`.

### Task 2: Links panel
**Files:** modify `frontend/src/components/admin/LinksPanel.jsx`, `frontend/src/styles/admin.css` if needed.
- [ ] Relabel "Bandcamp / website" to "Bandcamp"; add a Website row per `wb.artists` (inline AutoText -> `PUT /api/admin/artists/:id {website_url}` then `reload()`; Open link); fetch `on-playlist` on mount/song change for live songs with a Spotify id that are not dormant, show the button unless `onPlaylist === true` (muted "On the Spotify playlist" instead; set after a successful push); show Search Bandcamp only without a Bandcamp URL.
- [ ] Lint, build, frontend tests; mock-page check (one artist, two artists, on/off playlist, with/without Bandcamp). Commit `feat(links): band website row and conditional actions`.

### Task 3: Data move and docs
**Files:** a one-off script in the scratchpad (not committed), `docs/PROJECT_STATE.md`, `CLAUDE.md`, `docs/ADMIN_UI.md` if a class is added.
- [ ] Move songs 3, 4, 329 as in the spec (guarded `WHERE website_url IS NULL`), record the original values in PROJECT_STATE, leave song 54; verify by query.
- [ ] Docs. Commit `docs: band website and link actions`.
