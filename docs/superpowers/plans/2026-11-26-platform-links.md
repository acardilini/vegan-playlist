# Platform links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the curator chose native, inline execution). Steps use checkbox syntax.

**Goal:** Find Deezer links (exact, by ISRC) and Apple Music links (curator-confirmed) for live songs and show them as small "Listen on" buttons on the song page.

**Architecture:** One migration (`songs.isrc`, `song_platform_links`); one service with injected-fetch adapters and an in-memory paced job; admin routes, a Dashboard card, a Songs rail and a Links-panel confirm/reject; the public song read serves confirmed links only; the song page renders a text-button row.

**Tech Stack:** Node/Express, PostgreSQL, node:test, React/Vite (existing patterns).

**Spec:** `docs/superpowers/specs/2026-11-26-platform-links-design.md`

## Global Constraints
- Platforms `deezer | apple_music | tidal`; status `proposed | confirmed | rejected`; source `isrc | search`.
- Public reads serve **confirmed** rows only; every public song route keeps `status='included' AND published=true`.
- Nothing may log or rethrow a fetch error's message or a URL; errors are fixed strings with `.code`.
- Inserts are `ON CONFLICT DO NOTHING`: a confirmed or rejected row is never replaced by a run.
- Only data sent to third parties: a public ISRC or a public title + artist.
- No logos; text buttons only. Frontend styling uses tokens only.
- Test sentinel for new backend test files: `ZZZPLK` (songs titled `ZZZPLK ...`).
- Backend tests run serially: `npm test` in `backend/` (3 known `artistFacts` failures on this baseline are not ours).

## Review Focus
- A run never touches a confirmed or rejected row (Task 2 test).
- A `proposed` or `rejected` link never appears in any public read (Task 3 test).
- A song whose Spotify read fails or has no ISRC is skipped, not fatal, and the job carries on (Task 2 test).
- A second run while one is active is `BUSY`; a Deezer miss still lets Apple run (Task 2 tests).
- A strict Apple match never accepts a different base title; a version suffix may match, which is why Apple needs the curator's confirmation (Task 1 test).

---

### Task 1: Migration and adapters
**Files:** Create `backend/database/migrations/028_platform_links.sql`, `backend/services/platformLinks.js`, `backend/test/platformLinksAdapters.test.js`.
**Interfaces:** Produces (pure or injected `fetch`): `normTitle(s) -> string` (case, diacritics and punctuation folded; parentheticals and a trailing ` - ...` removed); `deezerByIsrc(isrc, {fetch}) -> {url} | null`; `appleSearch({title, artist}, {fetch}) -> {url, title, artist} | null` (strict: `normTitle` equal and the hit's artist contains the first 8 normalised characters of ours; first qualifying hit; the `uo=4` query param stripped); `spotifyIsrc(spotifyId, {fetch, getToken}) -> string | null`. Network or HTTP failure maps to `null` (a Deezer `error` body is a miss), except `spotifyIsrc` HTTP 429/5xx which throws an `Error` with `code: 'UPSTREAM'`.
- [ ] Step 1: failing tests with fake fetches: Deezer hit, and an `{error:{type:'DataException'}}` body as a miss; Apple accepts an identical title, accepts a version-suffix variant (documented: the curator confirms), rejects a different base title and a different artist; `spotifyIsrc` returns the ISRC, null when `external_ids` is absent, throws `UPSTREAM` on 429; no thrown error's message contains the URL.
- [ ] Step 2: run, expect FAIL (module missing).
- [ ] Step 3: write the idempotent migration (`ALTER TABLE songs ADD COLUMN IF NOT EXISTS isrc TEXT;` and `CREATE TABLE IF NOT EXISTS song_platform_links` with the CHECKs and PK from the spec) and the adapters; apply the migration to the dev DB.
- [ ] Step 4: run, expect PASS. Step 5: commit `feat(platform-links): migration and adapters`.

### Task 2: Run job, persistence, review actions
**Files:** Modify `backend/services/platformLinks.js`; Create `backend/test/platformLinksRun.test.js`.
**Interfaces:** Produces `startRun(db, {adapters, gaps, limit}) -> {runId}` (throws `BUSY` if one is active; `adapters` = `{spotifyIsrc, deezerByIsrc, appleSearch}`, injectable; `gaps` = ms between calls, default Deezer 120 and Apple 3200; `limit` optional, for tests); `getRun(runId) -> {state:'running'|'done'|'failed', total, done, found:{deezer, apple_proposed}, skipped}`; `listProposed(db, {limit, offset}) -> rows`; `reviewLink(db, songId, platform, {action:'confirm'|'reject'}) -> row` (`BAD_INPUT` for another action or a row that is not `proposed`, `NOT_FOUND` when none); `linksForSong(db, songId) -> rows` (admin, every status) and `publicLinks(db, songId) -> [{platform, url}]` (confirmed only, order apple_music, deezer, tidal).
- [ ] Step 1: failing tests with fake adapters and fixture songs `ZZZPLK ...` (fake `spotify_id`s): a Deezer hit saves `confirmed/isrc`; an Apple hit saves `proposed/search` with `match_title` and `match_artist`; the ISRC is stored on `songs.isrc`; a song with an existing `confirmed` or `rejected` row for a platform is untouched and that adapter is not called for it; a Spotify `UPSTREAM` error or a null ISRC skips that song and the run still finishes `done`; a Deezer miss still tries Apple; a second `startRun` while running throws `BUSY`; `reviewLink` confirm and reject transition, a second review is `BAD_INPUT`; `publicLinks` returns confirmed only, ordered.
- [ ] Step 2: run, FAIL. Step 3: implement (sequential per song; selects live songs with a `spotify_id` lacking a row for either platform; persists as it goes; per-song failures are counted, never logged with a message). Step 4: run, PASS. Step 5: commit `feat(platform-links): the paced run and the review actions`.

### Task 3: Routes, queue, public read
**Files:** Modify `backend/routes/admin.js`, `backend/services/curation.js` (queue `check-links` in `QUEUE_NAMES`, `queueWhere` and the counts), `backend/routes/spotify.js` (`GET /songs/:id` adds `platform_links`); Create `backend/test/platformLinksRoutes.test.js`.
**Interfaces:** Produces `POST /api/admin/platform-links/run` -> `{runId}` (409 on `BUSY`); `GET /api/admin/platform-links/runs/:runId`; `GET /api/admin/platform-links/song/:id` -> `{links}` (all statuses); `PUT /api/admin/platform-links/song/:id/:platform` body `{action}` -> `{link}`; queue `check-links` = included songs with a `proposed` row (workbench Prev/Next works unchanged); `platform_links` on the public song read.
- [ ] Step 1: failing tests: `check-links` lists a song with a proposed row and not one with only confirmed; its count agrees with its list; the public song read carries confirmed links only and never `proposed` or `rejected`; an unpublished song is still not served; the routes return 400/404/409 per the interfaces.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS, then the full serial suite. Step 5: commit `feat(platform-links): routes, the Check links queue and the public read`.

### Task 4: Song page row
**Files:** Create `frontend/src/utils/platformLinks.js` and `.test.js`; Modify `frontend/src/pages/SongDetailPage.jsx`, `frontend/src/styles/components.css`.
**Interfaces:** Produces `listenLinks({spotify_url, spotify_dormant, platform_links}) -> [{key, label, url}]` in the order Spotify, Apple Music, Deezer, Tidal; Spotify drops out when dormant or without a URL; unknown platforms and non-http(s) URLs are dropped; labels by `Map`.
- [ ] Step 1: failing node tests for ordering, dormant Spotify, unknown platform, bad URL, empty. Step 2: FAIL. Step 3: implement, then render a "Listen on" label and small text buttons in place of the large Spotify button; the artist's site, SoundCloud and lyrics link stay; the hero-actions condition includes the new row. Step 4: tests, lint, build, and a browser look through a throwaway mock harness outside the repo (port 5199, stop only your own PID) with a song that has all four, only Spotify, and none. Step 5: commit `feat(platform-links): a Listen on row on the song page`.

### Task 5: Admin UI
**Files:** Create `frontend/src/components/admin/PlatformLinksCard.jsx`; Modify `Dashboard.jsx`, `QueueRail.jsx`, `SongsArea.jsx`, `SongQueueList.jsx` (label), `LinksPanel.jsx` (proposed section), styles as needed.
- [ ] Step 1: the card: a **Find links** button (starts a run, polls the run every 2 s while running, shows done/total and the found counts, a plain message on busy or failure) and the count of links awaiting review, linking to `/admin/songs?queue=check-links`. Step 2: the rail entry `check-links` ("Check links"), registered in `SELECTABLE_QUEUES` and the Dashboard list. Step 3: in `LinksPanel`, each platform row: confirmed (name and Open), proposed (our title and artist beside `match_title` and `match_artist`, an Open link, **Confirm** and **Reject**), rejected hidden. Step 4: lint, build, node tests, a mock-harness look (card states, a proposed row); fix what it shows. Step 5: commit `feat(platform-links): admin card, the Check links rail and confirm/reject`.

### Task 6: Docs and verification
**Files:** Modify `docs/PROJECT_STATE.md`, `CLAUDE.md`, `docs/PRD.md` if it inventories the song page buttons.
- [ ] Update Current State (what, files, verified numbers, what was not seen, curator smoke steps including running **Find links** and confirming a few Apple matches), Next Tasks (Tidal after the curator registers; YouTube left out), Decision Log (Apple confirm-each; ISRC first; Odesli closed; no logos), Changelog; the CLAUDE.md architecture bullet. Run `npm test` (serial), frontend `node --test`, lint, build; confirm `lyrics_privacy.test.js`. Commit `docs: platform links`.
