# Lyrics inside the Catalogue review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the curator fetch Bandcamp lyrics for a band's new and held catalogue songs from inside the Catalogue panel, read or paste them per row, and have them saved on Apply (new songs) or a row Save (held songs); remove the separate "Lyrics from Bandcamp" artist panel.

**Architecture:** The server derives each song's Bandcamp URL from the Band check's cached merged catalogue (the client never supplies a URL). A new catalogue-keyed run in `services/bandcampLyrics` reuses the existing in-memory run machinery and `fetchTrack`. `bandCheck.addSelected` takes already-resolved lyrics by song key and saves them best-effort onto the rows that call created. The Catalogue panel gains the fetch button, a chip + collapsible text per row, and a paste box.

**Tech Stack:** Node/Express, PostgreSQL via `pg`, `node:test` (backend); React/Vite (frontend, no test runner: lint + build + headless-Chrome look).

**Spec:** `docs/superpowers/specs/2026-10-30-catalogue-lyrics-review-design.md` (builds on `2026-10-30-bandcamp-lyrics-fetch-design.md`; work continues on branch `session-bandcamp-lyrics`).

## Global Constraints

- Lyrics are local only: never returned by a public route, never committed, never logged; fetched lyrics exist only in an admin run's memory until saved.
- Nothing is saved before the curator acts (Apply for new songs, the row's Save for held songs); real lyrics (`curation.HAS_LYRICS_SQL`) are never overwritten.
- The client never supplies a URL to fetch; the server finds Bandcamp URLs itself. Bandcamp: `*.bandcamp.com` only, ~300 ms between requests, one run at a time (`BUSY`), fixed-string errors (no fetch error message/URL logged or returned).
- Fetching lyrics must not change which songs Apply adds or rejects; the reject-flip safety (only rows this call created) and the 100-key cap stay intact.
- No paid service, no new frontend dependency, no schema change. Admin code uses `adminFetch`/`api` and design tokens.
- Source labels: fetched text `Bandcamp`; pasted text `Added by curator`.
- Backend tests run serially (`node --test --test-concurrency=1`); each new test file has its own fixture sentinel (this plan: `ZZZCLR`). Baseline before this plan: 455/455.
- Stage files by explicit path; commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; use `git commit -F <file>`.

## Review Focus

- A lyric chosen for a song whose insert was skipped as already existing is NOT saved onto that existing song. (Task 3)
- Rejected songs keep their lyrics, and the lyrics step never alters the processed/rejected/skipped counts. (Task 3)
- A lyrics save failing for one song does not fail Apply or undo the other songs; it is reported. (Task 3)
- A held song that gains real lyrics between fetch and Save is refused (`CONFLICT`), existing text untouched. (Task 2)
- Pasted text survives a catalogue Refresh for songs still listed; fetch fails cleanly with a message when Bandcamp is not set or unreadable and Apply still works. (Task 5)

---

### Task 1: Expose the merged catalogue for lyrics

**Files:**
- Modify: `backend/services/bandCheck/index.js` (add and export `catalogueForLyrics`)
- Test: `backend/test/bandCheckService.test.js` (append; it already has fake-adapter helpers and sentinel `ZZZBANDSVC`)

**Interfaces:**
- Produces: `catalogueForLyrics(db, artistId, { adapters, fresh = false, now = Date.now }) -> Promise<{ artist: { id, name }, songs: Song[] }>` where `Song = { key: string, title: string, state: 'new'|'in_catalogue', match: { song_id, status, published, matched_by } | null, bandcampUrl: string|null }`. It reuses `loadArtist` + `loadMerged` (so the 5-minute cache applies), throws the same coded errors as `checkBand` (`NO_IDENTITY` etc.), and `bandcampUrl` is the merged song's `sources.bandcamp.url` or null.

- [ ] **Step 1: Write the failing test** `catalogueForLyrics returns keys, state, match and the Bandcamp URL for each song`: fake Bandcamp adapter with two releases (one song also in the DB as a pending song of the artist, one new), assert both songs appear with the right `state`, `match.song_id` on the held one, and `bandcampUrl` equal to the fake track URL; a song only on another source has `bandcampUrl === null`.
- [ ] **Step 2: Run to verify it fails**: `cd backend && node --test test/bandCheckService.test.js` -> the new test FAILS (`catalogueForLyrics is not a function`).
- [ ] **Step 3: Implement** the function in `index.js` and add it to `module.exports`.
- [ ] **Step 4: Run to verify it passes**: same command, whole file PASS.
- [ ] **Step 5: Commit** `feat(catalogue-lyrics): bandCheck.catalogueForLyrics`.

---

### Task 2: Catalogue run and guarded saves in `bandcampLyrics`

**Files:**
- Modify: `backend/services/bandcampLyrics/index.js`
- Test: `backend/test/bandcampCatalogueLyrics.test.js` (new, sentinel `ZZZCLR`; copy the `mkArtist`/`mkSong`/`clean`/`fake`/`finish` helper pattern from `test/bandcampLyricsService.test.js`)

**Interfaces:**
- Consumes: `bandCheck.catalogueForLyrics` (Task 1; injected via an option so tests pass a fake: `catalogue: (db, artistId) => Promise<{artist, songs}>`), adapter `{ fetchTrack(url) }`, existing `classify`/`readTrack`/`newRun`/`finishRun`/`guardStart`/`getRun`, `curation.saveLyrics`, `curation.HAS_LYRICS_SQL`.
- Produces:
  - `startCatalogueRun(db, artistId, { catalogue, adapter, sleep, gapMs }) -> Promise<{ runId }>`. Targets: every song with `state === 'new'`, plus every `in_catalogue` song whose `match.status !== 'rejected'` and which has NO real lyrics (query `song_id = ANY(...) AND NOT HAS_LYRICS_SQL`). A target with `bandcampUrl` null gets `status: 'not-on-bandcamp'`, `note: 'not listed on Bandcamp'` and no request. Others: `readTrack` against `bandcampUrl` (credit check names = the catalogue artist's name). `total` counts the songs that need a request.
  - Run result row: `{ key, title, state: 'new'|'held', songId?: number, status: 'found'|'no-lyrics'|'other-artist'|'not-on-bandcamp', lyrics?: string, url?: string, note?: string, saved?: true }` (`songId` only for held). `getRun` serves them as before.
  - `resolveForApply(runId, keys: string[], pasted: Record<string,string>) -> Map<string, { text: string, source: 'Bandcamp'|'Added by curator', url: string|null }>`: for each key a non-blank pasted text wins (source `Added by curator`, url null); else the run's `found` row (`Bandcamp`, its url); keys with neither are omitted. An unknown/expired run id simply contributes nothing (pasted still resolves). Never throws on a missing run.
  - `saveHeldLyrics(db, artistId, songId, { runId, key, text }) -> Promise<{ saved: true }>`: guard that `songId` is a song of `artistId` (`song_artists`), else `NOT_FOUND`; if `text` (non-blank) use it as `Added by curator`, else use the run's `found` row for `key` (`NOT_FOUND` if absent, `CONFLICT` if already saved); re-check `NOT HAS_LYRICS_SQL` (else `CONFLICT`, message `'This song now has lyrics - nothing was changed'`); claim the row in-flight before any await as `saveFetched` does; save via `curation.saveLyrics(db, songId, { lyrics, source_url, lyrics_source })`; mark the row `saved` and drop its `lyrics`.

- [ ] **Step 1: Write the failing tests** (fake `catalogue` and adapter, no network):
  - `catalogue run fetches new songs and held songs without lyrics, skips held songs that already have lyrics and rejected ones` (assert exactly which URLs the fake adapter saw).
  - `a song not listed on Bandcamp gets not-on-bandcamp and makes no request`.
  - `a different-artist credit is other-artist and carries no lyrics`.
  - `resolveForApply prefers pasted text over fetched, labels sources, omits keys with nothing`; `resolveForApply with an unknown run id still resolves pasted text`.
  - `saveHeldLyrics saves fetched lyrics with source Bandcamp and url` / `saves pasted text with source "Added by curator"`.
  - `saveHeldLyrics refuses with CONFLICT when real lyrics appeared after the fetch (existing text untouched)`.
  - `saveHeldLyrics refuses a song that belongs to another artist (NOT_FOUND)`.
  - `two parallel saveHeldLyrics for one row save once`.
- [ ] **Step 2: Run to verify they fail**: `node --test --test-concurrency=1 test/bandcampCatalogueLyrics.test.js` -> FAIL (functions undefined).
- [ ] **Step 3: Implement** the three functions in `index.js` reusing the existing helpers (extend the run row to carry `key`/`state`/`songId`; existing artist/song runs keep their current row shape). Add them to `module.exports`.
- [ ] **Step 4: Run to verify they pass**, then the existing `test/bandcampLyricsService.test.js` still passes.
- [ ] **Step 5: Commit** `feat(catalogue-lyrics): catalogue run, resolveForApply, saveHeldLyrics`.

---

### Task 3: Apply saves the chosen lyrics

**Files:**
- Modify: `backend/services/bandCheck/index.js` (`addSelected` + its inner `insertPicked`)
- Test: `backend/test/bandCheckLyricsApply.test.js` (new, sentinel `ZZZCLA`; pattern from `test/bandCheckService.test.js` incl. its fake adapters and `_resetForTests`)

**Interfaces:**
- Consumes: `curation.saveLyrics`, `curation.HAS_LYRICS_SQL`.
- Produces: `addSelected(db, artistId, keys, { adapters, rejectKeys, lyrics })` gains `lyrics?: Map<string, { text: string, source: string, url: string|null }>` (already resolved; keyed by song key). After the inserts and the reject-flip, for each key in `keys` and `rejectKeys` that has an entry AND whose song this call actually created (not one counted in `skippedExisting`), save with `curation.saveLyrics(db, songId, { lyrics: text, source_url: url ?? undefined, lyrics_source: source })` unless the song already has real lyrics. The song id is mapped back to its key: a Spotify-mapped song by its `mapped.spotify_id`, a manual one by the id `staging.insertManualCandidate` returns. A failure saving one song's lyrics is caught, never thrown, and its title goes into the result. The return value gains `lyricsSaved: number` and `lyricsFailed: string[]` (titles); existing fields are unchanged.

- [ ] **Step 1: Write the failing tests**:
  - `apply saves lyrics for a processed Spotify-mapped song and a processed manual (Bandcamp-only) song` (assert `song_lyrics` text, `songs.lyrics_source`, `lyricsSaved === 2`).
  - `apply saves lyrics for a rejected song and the song is still rejected` (status `rejected`, `published=false`, lyrics present).
  - `apply does NOT put lyrics on a song that already existed (skippedExisting)`: choose a key whose title matches an existing catalogue song; assert that song has no lyrics row afterwards.
  - `a failure saving one song's lyrics does not fail apply`: stub `curation.saveLyrics` to throw for one title (restore after); assert the other song's lyrics saved, `lyricsFailed` lists the title, `added` counts unchanged.
  - `apply without lyrics behaves exactly as before` (existing `bandCheckService` tests still pass).
- [ ] **Step 2: Run to verify they fail**: `node --test --test-concurrency=1 test/bandCheckLyricsApply.test.js` -> FAIL.
- [ ] **Step 3: Implement**: have `insertPicked` also return `idByKey` (key -> created song id) for the rows it created; after the reject-flip, run the best-effort lyrics loop described above.
- [ ] **Step 4: Run to verify they pass**, then the full backend suite (`node --test --test-concurrency=1`) is green.
- [ ] **Step 5: Commit** `feat(catalogue-lyrics): apply saves chosen lyrics best-effort`.

---

### Task 4: Admin routes

**Files:**
- Modify: `backend/routes/admin.js` (Band check section and the Bandcamp lyrics section)

**Interfaces:**
- Consumes: Tasks 2 and 3; `bandAdapters` (`.bandcamp` adapter), `bandCheck.catalogueForLyrics`, `bandcampLyrics.resolveForApply/startCatalogueRun/saveHeldLyrics`, the existing `bandcampLyricsError` and `bandId`.
- Produces (all behind the admin password):
  - `POST /api/admin/bandcamp-lyrics/catalogue/:id` -> `{ runId }` (polled with the existing `GET /api/admin/bandcamp-lyrics/runs/:runId`); `NO_IDENTITY`/`UPSTREAM` etc. map through `bandcampLyricsError`.
  - `POST /api/admin/bandcamp-lyrics/catalogue/:id/save` body `{ songId: number, key?: string, runId?: string, text?: string }` -> `{ success: true }`; `songId` must be a positive integer (`400 BAD_INPUT` otherwise).
  - `POST /api/admin/band-check/bands/:id/add` accepts optional `lyricsRunId: string` and `pastedLyrics: Record<string,string>` besides `keys`/`rejectKeys`; the route calls `resolveForApply(lyricsRunId, [...keys, ...rejectKeys], pastedLyrics)` and passes the Map as `lyrics`. `pastedLyrics` must be a plain object of strings (else `400`); the response gains `lyricsSaved` and `lyricsFailed` via the spread already there.

- [ ] **Step 1: Add the routes** (no new service logic here).
- [ ] **Step 2: Verify** on a separate instance (`PORT=5098 node server.js` from `backend/`; never touch the curator's :5000 process; stop yours by PID afterwards): without the password header -> 401; with it (read `ADMIN_PASSWORD` from `backend/.env` inside the command, never print it): `POST .../catalogue/abc` -> 404/400 JSON, `POST .../catalogue/1/save` with `{}` -> 400, `POST .../band-check/bands/1/add` with `pastedLyrics: "x"` -> 400. Expected: no 500s, no stack traces.
- [ ] **Step 3: Commit** `feat(catalogue-lyrics): admin routes`.

---

### Task 5: Catalogue panel UI, and remove the old panel

**Files:**
- Create: `frontend/src/components/admin/BandcampLyricsResults.jsx` (move `FetchedLyricsList` and `RunProgress` here unchanged, so the song Lyrics panel keeps using them)
- Modify: `frontend/src/components/admin/LyricsPanel.jsx` (import from the new file), `frontend/src/components/admin/CatalogueReview.jsx`, `frontend/src/components/admin/ArtistWorkbench.jsx` (remove the old panel), `frontend/src/components/admin/useBandcampLyricsRun.js` (add a `'catalogue'` kind; `save` for catalogue rows posts to the catalogue save route), `frontend/src/styles/admin.css` (small, token-based)
- Delete: `frontend/src/components/admin/BandcampLyricsPanel.jsx`

**Interfaces:**
- Consumes: Task 4 routes; `useBandcampLyricsRun` (`start`, `state.results`, `save`).
- Produces (UI behaviour, design option A):
  - In the Catalogue toolbar a **Fetch lyrics** button (`start('catalogue', artistId)`), disabled while running and, when `!identity.bandcamp`, replaced by the note "Set a Bandcamp link under Links to fetch lyrics"; `RunProgress` under the toolbar; an error shows the server message and does not affect Apply.
  - For each new song row and each held song row (not `rejected`), once a run has finished, a small chip: `lyrics found` (moss border, class `lyr-ok`) or `no lyrics found`, and a button: **Read** (found; toggles a `pre.bcl-lyrics` under the row) / **Add lyrics** (not found; toggles a `textarea` under the row). A pasted text turns the chip into `lyrics pasted` and overrides the fetched text. Rows with no result yet (no run, or the run predates a Refresh) show nothing extra.
  - **New songs:** pasted text is kept in component state keyed by song key (`pasted: Map`), survives Refresh for keys still listed, and is dropped only for keys that vanished. Apply sends `lyricsRunId` (the finished run's id) and `pastedLyrics` (object from the Map) with `keys`/`rejectKeys`; the result message appends `, lyrics saved for N` and, when `lyricsFailed.length`, `, lyrics not saved for: <titles>`.
  - **Held songs:** the expanded row shows **Save lyrics** (fetched or pasted) posting to the catalogue save route with `songId`, `key`, `runId` or `text`; the row then reads `Saved` and the chip updates; a `CONFLICT` message shows on the row.
  - The artist workbench no longer renders the "Lyrics from Bandcamp" panel.

- [ ] **Step 1: Implement** the move, the hook change and the Catalogue panel changes.
- [ ] **Step 2: Verify static checks**: `cd frontend && npm run lint` -> 0 errors (the 5 existing warnings are fine); `npm run build` -> clean.
- [ ] **Step 3: Verify in a real browser** with a throwaway Vite mock harness outside the repo (stub `adminFetch`; never type `ADMIN_PASSWORD`; the Chrome extension may not be connected, so drive headless Chrome with auto-click hooks as before): chips appear after the fetch finishes; Read opens lyrics; Add lyrics opens the paste box and typing turns the chip to "lyrics pasted"; a held row's Save lyrics flips to Saved; Apply's request carries `lyricsRunId` and `pastedLyrics`; Refresh keeps pasted text; no old panel at the bottom; the song Lyrics panel's Fetch button still works. After editing any `.jsx` the dev server may serve a stale transform: touch the file and reload before judging.
- [ ] **Step 4: Commit** `feat(catalogue-lyrics): lyrics in the Catalogue panel, remove the artist panel`.

---

### Task 6: Real-data check and docs

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `CLAUDE.md` (architecture lines for `catalogueForLyrics`, the catalogue run, `addSelected`'s lyrics, and the removed panel)

- [ ] **Step 1: Live read-only check** with a scratchpad script that loads `backend/.env` by absolute path (`quiet: true` is fine): for a real artist with a confirmed Bandcamp link, call `catalogueForLyrics` then `startCatalogueRun` with real adapters and print only counts and statuses (never lyric text or URLs); confirm new songs listed on Bandcamp are fetched, others read `not-on-bandcamp`, and `song_lyrics` row count and total length are unchanged before/after.
- [ ] **Step 2: Full verification**: `cd backend && node --test --test-concurrency=1` all pass (baseline 455 plus the new tests); `cd ../frontend && npm run lint && npm run build` clean.
- [ ] **Step 3: Update the docs** per the End-Session Guide (state: what changed and the new smoke checklist; the old `startArtistRun` service function and its route are now unused by the UI and are noted as a deferred cleanup).
- [ ] **Step 4: Curator smoke checklist** in `PROJECT_STATE.md`: open an artist's Catalogue with new songs on Bandcamp -> Fetch lyrics -> progress -> chips; Read a found one, paste into a not-found one, tick Process/Reject, Apply, then open the processed song to see its lyrics and source; on a held song press Save lyrics; confirm the old bottom panel is gone and the song page's Fetch from Bandcamp still works.
- [ ] **Step 5: Commit** `docs: catalogue lyrics review built, state updated` (do not push; the branch stays for the curator's smoke).
