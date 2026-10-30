# Bandcamp lyrics fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the curator fetch lyrics from a band's Bandcamp pages for a whole artist (progress, then a review list) or a single song, save them only on an explicit Save, and tuck the long lyric-site button row behind a "More sites" toggle.

**Architecture:** A new backend service `services/bandcampLyrics.js` reuses the Band check Bandcamp adapter (one new method, `fetchTrack`) and `keyOf` title matching. A run is an in-memory job (started by POST, progress read by polling GET, results held until Save). Save re-checks the song has no real lyrics, then calls the existing `curation.saveLyrics`. The frontend adds a panel in the artist workbench and a button in the song Lyrics panel, sharing one hook.

**Tech Stack:** Node/Express, PostgreSQL via `pg`, `node:test` (backend); React/Vite (frontend, no test runner: verify with lint + build + a real browser look).

**Spec:** `docs/superpowers/specs/2026-10-30-bandcamp-lyrics-fetch-design.md`

## Global Constraints

- Lyrics are local only: never returned by a public route, never committed, never logged. Fetched lyrics exist only in the admin run response and `song_lyrics`.
- Nothing is written to the database until the curator presses Save on a row; a song with real lyrics is never overwritten (real = what `HAS_LYRICS_SQL` says: non-blank text and `junk_kind IS NULL`).
- Bandcamp: `*.bandcamp.com` only, redirects stay on the band's own subdomain, requests spaced about 250-400 ms, 40-release cap inherited from the existing adapter. One run at a time (`BUSY`).
- Errors are fixed strings with a `.code`; nothing logs or rethrows a fetch error's message, URL or cause.
- No paid service, no new frontend dependency, no schema change.
- Admin code fetches via `adminFetch` (relative `/api/...`); styling uses design tokens and existing admin classes.
- Each backend `node:test` file uses its own fixture sentinel; this plan's is `ZZZBCL`. Run backend tests serially (`node --test --test-concurrency=1`).
- Stage files by explicit path (never `git add backend` or `.`); commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Use `git commit -F <file>`, not here-strings.

## Review Focus

- A song whose title matches a Bandcamp track by a *different band* (label/compilation page): skipped and listed as credited elsewhere, never offered for Save. (Task 2, Task 3)
- Two Bandcamp tracks with the same normalised title: song listed "more than one match", nothing offered. (Task 2)
- Lyrics pasted by hand between fetch and Save: Save refuses, existing lyrics untouched. (Task 3)
- Artist has no Bandcamp link, or a non-`bandcamp.com` link: a plain message, no request made. (Task 3)
- A second run started while one is going, or a poll for an unknown/expired run id: `BUSY` / `NOT_FOUND`, not a crash. (Task 3)

---

### Task 1: Adapter method `fetchTrack`

**Files:**
- Modify: `backend/services/bandCheck/bandcamp.js` (add the method inside `createBandcampAdapter`, export unchanged otherwise)
- Test: `backend/test/bandCheckBandcamp.test.js` (append)

**Interfaces:**
- Consumes: the file's existing `getPage`, `readLd`, `normalizeBandcampOrigin`, `coded`.
- Produces: `adapter.fetchTrack(url: string) -> Promise<{ title: string|null, artist: string|null, lyrics: string|null }>`. Throws coded `NOT_FOUND` when `url` is not an `https/http *.bandcamp.com` URL (no request made); `UNREADABLE` when the page has no JSON-LD; `UPSTREAM`/`RATE_LIMITED` as `getPage` does. `lyrics` is the trimmed `recordingOf.lyrics.text`, or `null` when absent or blank. `artist` is `byArtist.name` (falling back to `inAlbum.byArtist.name`), `title` is `name`.

- [ ] **Step 1: Write the failing tests** in the existing file, reusing its `adapterFor`, `ld`, `ORIGIN` helpers:
  - `fetchTrack returns title, credited artist and lyrics from the track page JSON-LD` (page with `name:'Prism Warden'`, `byArtist:{name:'Bloodmouth'}`, `recordingOf:{lyrics:{text:'  line one\nline two  '}}` -> `{ title:'Prism Warden', artist:'Bloodmouth', lyrics:'line one\nline two' }`).
  - `fetchTrack gives lyrics null when the page has none or only whitespace`.
  - `fetchTrack refuses a non-bandcamp URL without making a request` (`urls.length === 0`, rejects with `code === 'NOT_FOUND'`).
  - `fetchTrack fails UNREADABLE when the page has no JSON-LD`.
- [ ] **Step 2: Run to verify they fail**: `cd backend && node --test test/bandCheckBandcamp.test.js` -> the four new tests FAIL (`a.fetchTrack is not a function`).
- [ ] **Step 3: Implement `fetchTrack`** in `bandcamp.js`: validate with `normalizeBandcampOrigin`, call `getPage(url)` (so the redirect rules apply), parse with `readLd`, shape the result as above, add it to the returned adapter object.
- [ ] **Step 4: Run to verify they pass**: same command, all tests in the file PASS.
- [ ] **Step 5: Commit** `feat(bandcamp-lyrics): adapter fetchTrack` (the two files).

---

### Task 2: Pure matching

**Files:**
- Create: `backend/services/bandcampLyrics/match.js`
- Test: `backend/test/bandcampLyricsMatch.test.js`

**Interfaces:**
- Consumes: `keyOf` from `../bandCheck/merge`.
- Produces:
  - `creditMatches(credited: string|null, names: string[]) -> boolean`: normalise (lower-case, strip accents and non-letters/digits via `keyOf`-style folding); true when `credited` is null/blank (page names no one: no evidence against) or equals/contains/is contained by any of `names`.
  - `matchSongs(songs: {id:number,title:string,artists:string[]}[], tracks: {title:string,url:string}[]) -> { matched: {songId:number,url:string}[], ambiguous: number[], unmatched: number[] }`: group tracks by `keyOf(title)`; a song matches when exactly one track has its key; two or more tracks with the key -> the song id goes to `ambiguous`; none -> `unmatched`. Titles whose key is empty never match. (Credit checking happens later, on the fetched page; see Task 3.)

- [ ] **Step 1: Write the failing tests**:
  - `matchSongs matches by normalised title ignoring case, accents, punctuation and "(Remastered)"-style parentheticals`.
  - `matchSongs puts a song with two same-title Bandcamp tracks in ambiguous and offers no match`.
  - `matchSongs puts a song with no Bandcamp title in unmatched; ignores Bandcamp tracks that match no song`.
  - `matchSongs never matches an empty-key title`.
  - `creditMatches accepts equal, contained and containing names, and a null credit`; `creditMatches rejects an unrelated band` (e.g. credited `'Other Band'` vs `['Bloodmouth']` -> false).
- [ ] **Step 2: Run to verify they fail**: `node --test test/bandcampLyricsMatch.test.js` -> FAIL (module not found).
- [ ] **Step 3: Implement** both functions in `match.js`.
- [ ] **Step 4: Run to verify they pass**: all PASS.
- [ ] **Step 5: Commit** `feat(bandcamp-lyrics): pure title matching and credit check`.

---

### Task 3: Service - eligibility, runs, save

**Files:**
- Create: `backend/services/bandcampLyrics/index.js`
- Modify: `backend/services/curation.js` (export `HAS_LYRICS_SQL` in `module.exports`)
- Test: `backend/test/bandcampLyricsService.test.js` (sentinel `ZZZBCL`; copy the `mkArtist`/`mkSong`/`clean` pattern from `test/bandCheckService.test.js`)

**Interfaces:**
- Consumes: `normalizeBandcampOrigin` (`../bandCheck/bandcamp`), adapter `{ fetchCatalogue(originInput), fetchTrack(url) }` (injected, so tests pass a fake), `coded` (`../bandCheck/errors`), `matchSongs`/`creditMatches` (Task 2), `curation.saveLyrics`, `curation.HAS_LYRICS_SQL`.
- Produces (all take `db` first; `adapter` is injected as an option, default `createBandcampAdapter({ fetch: defaultFetch })`):
  - `startArtistRun(db, artistId, { adapter }) -> Promise<{ runId: string }>`
  - `startSongRun(db, songId, { adapter }) -> Promise<{ runId: string }>`
  - `getRun(runId) -> { status: 'running'|'done'|'failed', done: number, total: number, results?: Result[], truncated?: boolean, error?: { code: string, message: string } }`; throws coded `NOT_FOUND` for an unknown or expired run. Runs expire 30 minutes after finishing.
  - `saveFetched(db, runId, songId) -> Promise<{ saved: true }>`
  - `Result` = `{ songId, title, status: 'found'|'no-lyrics'|'not-found'|'ambiguous'|'other-artist', lyrics?: string, url?: string, note?: string }`. `found` carries `lyrics` and the Bandcamp song-page `url`. `note` carries the spec's wording: `'Bandcamp credits a different artist'`, `'more than one match'`, `'not found (catalogue was cut short)'` when the catalogue was truncated, `'not found on Bandcamp'` otherwise.
  - `_resetForTests()` clears runs and the busy flag.
  - Error codes: `NO_IDENTITY` (artist has no usable `*.bandcamp.com` link; message tells the curator to add one in the Links panel), `BUSY`, `NOT_FOUND`, `CONFLICT` (Save when the song now has real lyrics, or the result is not `found`), `BAD_INPUT`.

Behaviour to implement (decisions are the spec's; the implementer writes the body):
- Eligible songs for an artist: via `song_artists`, `status <> 'rejected'`, `NOT HAS_LYRICS_SQL`. Each carries its artist names (all of the song's artists) for the credit check.
- Artist run: `adapter.fetchCatalogue(artist.bandcamp_url)` once, `matchSongs`, then `fetchTrack` for each matched song only; `done/total` counts those fetches. A fetched page whose credited artist fails `creditMatches` -> `other-artist`; null lyrics -> `no-lyrics`. A source error mid-run fails the run with the coded error (no partial offer). Catalogue `truncated` sets the flag and the not-found wording.
- Song run: if `songs.bandcamp_url` is a `*.bandcamp.com/track/...` URL, `fetchTrack` it directly (total 1); otherwise use the song's first artist with a usable Bandcamp link and run the artist flow restricted to this one song; no usable link -> `NO_IDENTITY`. The song must itself be eligible (else `CONFLICT`).
- One run at a time across the process: a second start while one is `running` throws `BUSY`. The flag clears on done or failed.
- `saveFetched`: look up the run's `found` result for `songId` (else `NOT_FOUND`/`CONFLICT`), re-check `NOT HAS_LYRICS_SQL` against the DB (else `CONFLICT` with the message `'This song now has lyrics - nothing was changed'`), then `curation.saveLyrics(db, songId, { lyrics, source_url: url, lyrics_source: 'Bandcamp' })`. Never log lyrics.

- [ ] **Step 1: Write the failing tests** with a fake adapter (`fetchCatalogue` returns `{ releases:[{tracks:[{title,url}]}], truncated }`, `fetchTrack(url)` looks up a map). Use `getRun` polling via a helper that awaits until `status !== 'running'`:
  - `artist run finds lyrics for matched eligible songs only` (one song with lyrics already, one rejected, one eligible: only the eligible one is fetched; assert the fake saw exactly its URL).
  - `run reports no-lyrics, not-found, ambiguous and other-artist with the spec's notes`.
  - `truncated catalogue words unmatched songs as "not found (catalogue was cut short)"`.
  - `a junk-flagged song is eligible` (insert `song_lyrics` with `junk_kind='error'`).
  - `artist without a Bandcamp link throws NO_IDENTITY and makes no request`; same for a non-bandcamp.com link.
  - `a second start while running throws BUSY` (fake `fetchCatalogue` blocked on a deferred promise); after finishing, a new start works.
  - `getRun on an unknown id throws NOT_FOUND`.
  - `saveFetched writes lyrics, source_url and lyrics_source "Bandcamp" and marks lyrics_status found`.
  - `saveFetched refuses with CONFLICT when real lyrics were added after the fetch, and leaves them unchanged`.
  - `song run uses the song's own track URL directly (one fetchTrack, no fetchCatalogue)`; `song run falls back to the artist's link`.
  - `source errors fail the run with the coded error and no results`.
- [ ] **Step 2: Run to verify they fail**: `cd backend && node --test --test-concurrency=1 test/bandcampLyricsService.test.js` -> FAIL (module not found).
- [ ] **Step 3: Implement** `services/bandcampLyrics/index.js` and the `HAS_LYRICS_SQL` export.
- [ ] **Step 4: Run to verify they pass**: all PASS; then the full suite `node --test --test-concurrency=1` still passes (the baseline was 426/426 before this work).
- [ ] **Step 5: Commit** `feat(bandcamp-lyrics): runs, eligibility and guarded save`.

---

### Task 4: Admin routes

**Files:**
- Modify: `backend/routes/admin.js` (new banner section after "Band check", before "Playlist cross-check")

**Interfaces:**
- Consumes: Task 3 service; `bandAdapters.bandcamp` is the existing shared adapter instance (pass it as `adapter`); the file's `bandId(req)` parser pattern.
- Produces (all behind the existing admin-password middleware):
  - `POST /api/admin/bandcamp-lyrics/artist/:id` -> `{ runId }`
  - `POST /api/admin/bandcamp-lyrics/song/:id` -> `{ runId }`
  - `GET /api/admin/bandcamp-lyrics/runs/:runId` -> the `getRun` object
  - `POST /api/admin/bandcamp-lyrics/runs/:runId/save` with body `{ songId }` -> `{ success: true }`
  - Error mapping: `NOT_FOUND 404, BAD_INPUT 400, CONFLICT 409, BUSY 409, NO_IDENTITY 409, RATE_LIMITED 429, UPSTREAM 502, UNREADABLE 502`; other errors log only `e.code` and answer 500. Responses carrying lyrics must not be cached (`Cache-Control: no-store` on the GET).

- [ ] **Step 1: Add the four routes** in one new banner-commented section using a `bandcampLyricsError(res, e, label)` helper shaped like `bandCheckError`.
- [ ] **Step 2: Verify** with the server running (run from the repo, not a scratch script in `backend/`, to avoid the nodemon restart hazard): `GET /api/admin/bandcamp-lyrics/runs/nope` without the password header -> 401; with the header (read `ADMIN_PASSWORD` from `backend/.env` inside the command, never print it) -> 404 JSON `{"error":"NOT_FOUND",...}`; `POST .../save` with an empty body -> 400 or 404, never 500. Expected: no stack traces, no 500s.
- [ ] **Step 3: Commit** `feat(bandcamp-lyrics): admin routes`.

---

### Task 5: Frontend - shared hook and artist panel

**Files:**
- Create: `frontend/src/components/admin/useBandcampLyricsRun.js`
- Create: `frontend/src/components/admin/BandcampLyricsPanel.jsx`
- Modify: `frontend/src/components/admin/ArtistWorkbench.jsx` (render the panel in `wb-col-main`, after `CatalogueReview`)
- Modify: `frontend/src/styles/admin.css` (small additions only, token-based)

**Interfaces:**
- Consumes: `api` from `./bandCheckApi` (throws `Error` with the server's `message`); Task 4 routes.
- Produces:
  - `useBandcampLyricsRun() -> { start(kind: 'artist'|'song', id: number): Promise<void>, state: { phase: 'idle'|'running'|'done'|'error', done: number, total: number, results: Result[], truncated: boolean, message: string, runId: string|null }, save(songId: number): Promise<{ ok: boolean, message?: string }>, reset(): void }`. `start` POSTs then polls the run route every 1.5 s until done/failed, cancels polling on unmount, and keeps `savedIds` so saved rows show "Saved".
  - `BandcampLyricsPanel({ artistId, hasBandcamp: boolean, onSaved?: () => void })`.
  - Panel behaviour: a "Fetch lyrics from Bandcamp" button (disabled with the text "Add a Bandcamp link in the Links panel first" when `!hasBandcamp`); while running, a progress bar/text "Reading 7 of 23 songs"; when done, the full list: one row per result with the song title; `found` rows show the lyrics in a scrollable read-only `<pre>` with a Save button (row then reads "Saved"), other statuses show their `note` in muted text and no Save; a "Skip" is simply not pressing Save; a line when `truncated`. Errors show the server's message.

- [ ] **Step 1: Implement the hook, panel and CSS**; wire the panel into `ArtistWorkbench` passing `hasBandcamp={!!artist.bandcamp_url}`.
- [ ] **Step 2: Verify static checks**: `cd frontend && npm run lint` -> 0 errors (the 5-6 existing warnings are fine); `npm run build` -> clean.
- [ ] **Step 3: Verify in a real browser** (admin is behind the password login; per the project's mock-harness practice, use a throwaway Vite mock harness outside the repo that stubs the four routes, and never type `ADMIN_PASSWORD`): button disabled without a link; progress text advances; a `found` row shows lyrics and Save flips it to "Saved"; a not-found row shows its note. After editing any `.jsx` the dev server may serve a stale transform: touch the file and reload before judging.
- [ ] **Step 4: Commit** `feat(bandcamp-lyrics): artist workbench panel`.

---

### Task 6: Frontend - song Lyrics panel button and "More sites" toggle

**Files:**
- Modify: `frontend/src/components/admin/LyricsPanel.jsx`

**Interfaces:**
- Consumes: `useBandcampLyricsRun` (Task 5), `reload` and `wb` already passed to `LyricsPanel`.
- Produces: no new exports.

Behaviour:
- Above the existing search row, a primary button "Fetch from Bandcamp" (shown only when the song has no real lyrics: `!hasLyrics`). It calls `start('song', wb.id)`; progress text while running; on `done` the single result is shown inline in the same style as Task 5 (lyrics preview + Save, or the note). Save calls `save(wb.id)` then `reload()`. Errors (e.g. no Bandcamp link) show the server's message, and the search row below remains the fallback.
- The search row keeps "Search the web for lyrics" visible. "Listed lyric sites only", the "or one site:" label, the per-site buttons and the YouTube button move into a block shown only after pressing a "More sites" toggle button (`aria-expanded`), collapsed by default, state local to the panel. Opening any site still calls `markTried(...)` exactly as today.

- [ ] **Step 1: Implement** the toggle and the Bandcamp button.
- [ ] **Step 2: Verify static checks**: `npm run lint` -> 0 errors; `npm run build` -> clean.
- [ ] **Step 3: Verify in the mock harness**: the Lyrics panel loads with only "Fetch from Bandcamp" and "Search the web for lyrics" plus a "More sites" button; clicking it reveals the rest; a site button still marks its avenue tried; the Bandcamp button is absent on a song that already has lyrics; Save refreshes the panel with the lyrics in the box.
- [ ] **Step 4: Commit** `feat(bandcamp-lyrics): song Lyrics panel button, collapse the site list`.

---

### Task 7: Real-data check and docs

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md` (End-Session Guide), `CLAUDE.md` (add the service to the Backend structure list and the new component to Frontend)

- [ ] **Step 1: Live read-only check** against real Bandcamp with the real service (a scratchpad script that loads `backend/.env` by absolute path and does not write the DB): pick an artist with a confirmed Bandcamp link and eligible songs; run the artist flow via an in-process call with a stubbed `saveFetched` never called; confirm progress counts, some `found` results, correct `not-found` notes, and that no DB row changed (`song_lyrics` count before/after equal).
- [ ] **Step 2: Full verification**: `cd backend && node --test --test-concurrency=1` all pass; `cd ../frontend && npm run lint && npm run build` clean.
- [ ] **Step 3: Update the docs** per the End-Session Guide: state, Next Tasks (artist facts is next, then Leads, then the skills), decision log entries for the in-memory run and the junk-is-eligible rule, CLAUDE.md architecture lines.
- [ ] **Step 4: Curator smoke checklist** written into `PROJECT_STATE.md`: open an artist with a Bandcamp link and songs without lyrics -> Fetch lyrics from Bandcamp -> watch progress -> save one row, see it under the song's Lyrics panel with source Bandcamp; open a song without lyrics -> Fetch from Bandcamp; confirm "More sites" collapses the site buttons.
- [ ] **Step 5: Commit** `docs: Bandcamp lyrics fetch built, state and plan updated`, then push.
