# Playlist cross-check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste a Spotify playlist link in the admin Songs area, see each track classified against the whole catalogue (Already have it / Possible duplicate / New), choose Import or Reject per track (optionally attaching lyrics), and apply in one action.

**Architecture:** A new service `services/playlistCrosscheck.js` (Spotify read injected, like `spotifyPush` / `bandCheck`) classifies and applies; two routes in `routes/admin.js`; one new admin view under Songs. Import goes through `staging.insertCandidates` (new `allowTitleDuplicates` option); Reject uses the I2 trick (insert pending under a unique note, flip only those rows to `rejected`); lyrics go through `curation.saveLyrics`.

**Tech Stack:** Node/Express, PostgreSQL via `pg` pool, `node:test`; React + Vite frontend (no frontend test runner; pure utils are node-tested, UI by lint + build + real-browser mock-harness check).

**Spec:** `docs/superpowers/specs/2026-10-29-playlist-crosscheck-design.md`

## Global Constraints

- Never touch, re-status or overwrite an existing catalogue song: apply only flips rows it created in the same call (`status='pending' AND status_notes=<this call's note> AND spotify_id = ANY(<this call's ids>)`).
- Nothing is applied that was not explicitly chosen: no pre-ticked rows; "Possible duplicate" rows also default to no choice.
- The client sends only Spotify ids (and pasted lyrics keyed by id); titles, artists and albums always come from the server's own Spotify read.
- Apply cap: 100 chosen tracks in total (`importIds.length + rejectIds.length`); an id in both lists is `BAD_INPUT`; one apply at a time (`BUSY`).
- Apply is best-effort per song, not one transaction: a lyrics failure never undoes an insert and is reported per song; every skipped row is reported with a reason.
- Import note: `added via playlist cross-check (<playlist name>)`; reject note: `rejected via playlist cross-check (<playlist name>)`; queue origin value `crosscheck`, label **"From playlist cross-check"**.
- Lyrics are local only: no API read may return `song_lyrics` text; never commit lyrics.
- Errors carry fixed strings + `.code`; nothing may log or rethrow a Spotify error's message, URL or token (log `e.code || 'error'` only).
- Local files / tracks without a Spotify id are ignored, with a count shown.
- Styling uses design tokens only (`--bg-*`/`--text-*`/`--accent-*`/`--space-*`); no explanatory copy beyond usage help; the list stays compact until a row's **Add lyrics** is opened.
- Tests: each backend test file gets its own fixture sentinel (below); run backend tests serially (`node --test --test-concurrency=1`); no `taskkill`; do not type `ADMIN_PASSWORD`; add explicit paths to `git add` (never `git add backend`).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; write them to a scratchpad file and use `git commit -F`.

## Review Focus

- Playlist link pasted with a `?si=` query string, as `spotify:playlist:ID`, or as a bare id; anything else → plain "not a Spotify playlist link" (Task 2 test).
- A non-Latin or punctuation-only title (normalises to empty) must never be classified Possible duplicate of an unrelated song (Task 2 test).
- The same Spotify track listed twice on the playlist appears once and applies once (Task 2 + 3 tests).
- A track whose catalogue twin is already `rejected` or `pending` shows as Already have it with that status and is not choosable; apply skips it with a reason (Task 2 + 3 tests).
- Apply given an id that is not on the playlist, or a lyrics entry for an id not chosen, saves nothing for it and reports it (Task 3 test).
- Whitespace-only lyrics are ignored; very large lyrics (> 100,000 chars) are `BAD_INPUT` (Task 3 test).
- Empty playlist, private/missing playlist, and Spotify rate limiting give distinct plain errors, never a 500 (Task 2 + 4).

---

### Task 1: Shared plumbing - force-insert option, origin tag, retry options

**Files:**
- Modify: `backend/services/staging.js` (`insertCandidates`, ~L98)
- Modify: `backend/utils/playlistSync.js` (`fetchPlaylistTracks`, ~L47)
- Modify: `backend/services/curation.js` (origin CASE, ~L160-165)
- Modify: `frontend/src/components/admin/SongQueueList.jsx:6` (label)
- Test: `backend/test/playlistCrosscheckStaging.test.js` (sentinel `ZZZXCHKS`)

**Interfaces:**
- Produces: `staging.insertCandidates(db, tracks, { note, allowTitleDuplicates = false })` - when true, the title|artist dedupe (both `existingTA` and `seenTA`) is bypassed; Spotify-id dedupe (`existingIds`, `seenIds`) still applies.
- Produces: `fetchPlaylistTracks(spotifyApi, playlistId, retryOpts = {})` - passes `retryOpts` to `withRetry` (default behaviour unchanged).
- Produces: queue rows with `origin === 'crosscheck'` when `status_notes LIKE 'added via playlist cross-check%'`.

- [ ] **Step 1: Write failing tests** in `playlistCrosscheckStaging.test.js` (copy the `after` cleanup / fixture style of `bandCheckStaging.test.js`; cleanup deletes `song_lyrics`, `song_artists`, `songs`, `artists`, `albums` rows by the `ZZZXCHKS` sentinel):
  - `insertCandidates skips a title|artist twin by default and adds it with allowTitleDuplicates` - seed a live-style song (title `ZZZXCHKS Twin`, artist `ZZZXCHKS Band`, spotify_id `ZZZXCHKS_a`) via a first `insertCandidates`; a second track (id `ZZZXCHKS_b`, same title/artist) → default `{added:0, skippedExisting:1}`; with `{allowTitleDuplicates:true}` → `{added:1}`.
  - `allowTitleDuplicates still skips a Spotify id that is already known` - re-insert id `ZZZXCHKS_a` with the flag → `{added:0, skippedExisting:1}`.
  - `a song whose note starts "added via playlist cross-check" has origin crosscheck in the To be processed queue` - mirror `bandCheckStaging.test.js:50-55` (note `added via playlist cross-check (ZZZXCHKS list)`).
- [ ] **Step 2: Run** `cd backend && node --test test/playlistCrosscheckStaging.test.js` → expect the three tests FAIL.
- [ ] **Step 3: Implement** the three plumbing changes: the `allowTitleDuplicates` flag in `insertCandidates`; the `retryOpts` pass-through in `fetchPlaylistTracks`; a new `WHEN s.status_notes LIKE 'added via playlist cross-check%' THEN 'crosscheck'` branch in the origin CASE placed beside the band-check branch; and `crosscheck: 'From playlist cross-check'` in `ORIGIN_LABELS`.
- [ ] **Step 4: Run** the new test file → PASS; then `node --test --test-concurrency=1 test/bandCheckStaging.test.js test/staging.test.js` → still PASS.
- [ ] **Step 5: Commit** (`git add` the five files above by path) - `feat(crosscheck): force-insert option, crosscheck origin tag, retry opts`.

---

### Task 2: Classify and compare (service, read-only)

**Files:**
- Create: `backend/services/playlistCrosscheck.js`
- Test: `backend/test/playlistCrosscheckCompare.test.js` (sentinel `ZZZXCHKC`)

**Interfaces:**
- Consumes: `staging.normalizeName`; `fetchPlaylistTracks`, `getSpotifyClient`, `withRetry` from `utils/playlistSync`.
- Produces (all exported):
  - `parsePlaylistId(input: string) -> string` - accepts `https://open.spotify.com/playlist/<22>` (with or without `?si=…`, or an `/intl-xx/` prefix), `spotify:playlist:<22>`, or a bare 22-char id; otherwise throws coded `BAD_INPUT` with message `Not a Spotify playlist link`.
  - `classifyTracks(songs, tracks) -> Array<{ track, state: 'new'|'duplicate'|'have', match: null | { id, title, artists, status, live } }>` - pure. `songs` rows: `{ id, title, spotify_id, status, published, artists, first_artist }`. Order: Spotify id match → `have`; else title + first-artist key (`normalizeName(title)|normalizeName(firstArtist)`; **a key whose title part is empty never matches**) → `duplicate` (prefer a live match if several); else `new`. Duplicate playlist entries with the same `spotify_id` are collapsed to the first.
  - `compare(db, { input, fetchPlaylist = defaultFetchPlaylist, fresh = false, now = Date.now }) -> { playlist: { id, name, url }, ignored: number, counts: { new, duplicate, have }, tracks: Array<{ spotify_id, title, artists: string, album: string|null, url, state, match }> }`.
  - `defaultFetchPlaylist(playlistId) -> { name, tracks, ignored }` - uses `getSpotifyClient()`, `spotifyApi.getPlaylist(id, { fields: 'name,tracks(total)' })` for name and total, and `fetchPlaylistTracks(api, id, { maxWaitS: 30, maxRetries: 3 })`; `ignored = total - tracks.length`. Maps Spotify failures to coded errors with fixed messages: status 404/403 → `NOT_READABLE` ("Couldn't read that playlist - is it public?"); `RATE_LIMITED` passes through; anything else → `UPSTREAM` ("Couldn't reach Spotify"). Never include the original error's message.
  - 60-second per-playlist cache of the fetch result (`fresh` bypasses but re-writes), as `spotifyPush.readTracks` does.
  - `_resetForTests()` clears cache and the apply lock.

- [ ] **Step 1: Write failing tests** (Spotify injected via `fetchPlaylist`; fixtures use `ZZZXCHKC` titles/ids; cleanup by sentinel):
  - `parsePlaylistId` accepts the three forms incl. the curator's `...4RvN6XwfV6cQ0eZV7PF215?si=SK8GMSiDQk6ToA17PYM8pg` → `4RvN6XwfV6cQ0eZV7PF215`; rejects `https://open.spotify.com/track/<id>`, `""`, `"hello"` with `code === 'BAD_INPUT'`.
  - `classifyTracks`: id match → `have` with `match.status`; same title+first artist, different id → `duplicate` with `match.id`; unrelated → `new`; a rejected twin (by id) is `have` with `match.status === 'rejected'`, `match.live === false`.
  - `classifyTracks`: a title that normalises to empty (`'日本語'`, `'!!!'`) with a catalogue song of another empty-normalising title is `new`, not `duplicate`.
  - `classifyTracks`: the same `spotify_id` twice in `tracks` yields one entry.
  - `compare` returns `counts`, `ignored` passed through from the injected fetch, `album` as the album name, and `url` `https://open.spotify.com/track/<id>`; a second call within 60 s does not call `fetchPlaylist` again (counting stub), `fresh:true` does.
  - `compare` on an empty playlist (`tracks: []`) returns zero counts and no tracks.
- [ ] **Step 2: Run** `node --test test/playlistCrosscheckCompare.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** the module per the Interfaces above. The catalogue read is one query over all songs (all statuses) shaped like `spotifyPush.loadSongs` (id, title, spotify_id, status, published, `string_agg` artists, first artist by lowest `song_artists.id`).
- [ ] **Step 4: Run** the test file → PASS.
- [ ] **Step 5: Commit** - `feat(crosscheck): classify and compare a playlist against the catalogue`.

---

### Task 3: Apply (import / reject / lyrics)

**Files:**
- Modify: `backend/services/playlistCrosscheck.js`
- Test: `backend/test/playlistCrosscheckApply.test.js` (sentinel `ZZZXCHKA`)

**Interfaces:**
- Consumes: Task 2's `compare`-side read (`readPlaylist` internal, same cache), `classifyTracks`, `loadCatalogue`; `staging.insertCandidates(…, { note, allowTitleDuplicates: true })`; `curation.saveLyrics(db, songId, { lyrics })` (mirror what `LyricsPanel.jsx` sends for a pasted-lyrics save, including `lyrics_status` if it sets one).
- Produces: `apply(db, { input, importIds, rejectIds, lyrics, fetchPlaylist }) -> { imported: number, rejected: number, lyricsSaved: number, skipped: Array<{ spotify_id, reason: 'not_on_playlist'|'already_have' }>, lyricsFailed: Array<string> }` where `lyrics` is `{ [spotify_id]: string }` (optional) and `importIds`/`rejectIds` are arrays of Spotify ids (each optional, default `[]`).
  - Validation (`BAD_INPUT`): both lists arrays of non-empty strings; total 1-100; no id in both; `lyrics` an object whose values are strings of at most 100,000 chars.
  - `BUSY` (module-level lock) if another apply is running; the lock is released in `finally`.
  - Flow: re-read playlist (cache allowed), re-classify against the live catalogue; chosen ids not on the playlist → skipped `not_on_playlist`; chosen ids whose current state is `have` → skipped `already_have`. Import group inserted with the import note; reject group inserted with the reject note then flipped with `UPDATE songs SET status='rejected', published=false, published_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE status='pending' AND status_notes=$reject_note AND spotify_id = ANY($ids)` (exactly the I2 guard). Lyrics: for each id actually created by this call (look up `songs.id` by `spotify_id` + this call's note) with non-blank trimmed lyrics, call `saveLyrics`; a throw is caught and pushed to `lyricsFailed`; lyrics for skipped or unchosen ids are ignored.

- [ ] **Step 1: Write failing tests** (stub `fetchPlaylist`; seed catalogue rows through `insertCandidates`; cleanup deletes `song_lyrics` first):
  - `apply imports a New track as pending with the crosscheck note, and rejects another as rejected` - assert statuses and `status_notes` prefixes; `{imported:1, rejected:1}`.
  - `apply imports a Possible duplicate when chosen (second song, same title and artist)`; assert 2 songs now share the normalised title and the original row is untouched (same id, status, `updated_at`).
  - `apply skips a track that is already in the catalogue (incl. a rejected one) and reports already_have`; the existing row's status is unchanged.
  - `apply skips an id that is not on the playlist and reports not_on_playlist`.
  - `apply saves pasted lyrics for both an imported and a rejected song; blank/whitespace lyrics are ignored; lyrics for an unchosen id are ignored` - read back with a direct `SELECT lyrics FROM song_lyrics` (test only).
  - `apply keeps the import when saveLyrics throws and lists the id in lyricsFailed` - inject by passing a lyrics string that makes `saveLyrics` throw is brittle; instead give `apply` an optional `saveLyricsFn = curation.saveLyrics` parameter and stub it to throw.
  - `apply rejects bad input`: id in both lists, 0 ids, 101 ids, lyrics > 100,000 chars, non-array → `BAD_INPUT`.
  - `apply refuses a second concurrent call with BUSY` - start one with a `fetchPlaylist` that awaits a manually resolved promise; the second call rejects `BUSY`; after release a third succeeds.
  - `the same Spotify id listed twice on the playlist is applied once`.
- [ ] **Step 2: Run** `node --test test/playlistCrosscheckApply.test.js` → FAIL.
- [ ] **Step 3: Implement** `apply` as specified, in `playlistCrosscheck.js`.
- [ ] **Step 4: Run** the apply and compare test files → PASS; run the whole backend suite serially: `cd backend && node --test --test-concurrency=1` → all PASS (baseline before this work: 400/400).
- [ ] **Step 5: Commit** - `feat(crosscheck): apply import, reject and lyrics`.

---

### Task 4: Routes

**Files:**
- Modify: `backend/routes/admin.js` (new banner section after Band check, ~L1524; add `const playlistCrosscheck = require('../services/playlistCrosscheck');` with the other service requires)

**Interfaces:**
- Produces: `GET /api/admin/playlist-crosscheck?url=<link>&fresh=1` → `compare` result as JSON (`url` truncated to 300 chars); `POST /api/admin/playlist-crosscheck/apply` body `{ url, importIds, rejectIds, lyrics }` → `{ success: true, ...apply result }`.
- Error map via a `crosscheckError(res, e, label)` helper in the style of `bandCheckError`: `BAD_INPUT` 400, `NOT_READABLE` 404, `BUSY` 409, `RATE_LIMITED` 429, `UPSTREAM` 502, otherwise log `e.code || 'error'` only and 500. Body `{ error: e.code, message: e.message }`. Both routes are covered by the existing router-level admin-password check (do not add a second one).

- [ ] **Step 1: Implement** the two routes and helper.
- [ ] **Step 2: Verify load and shape:** `cd backend && node -e "require('./routes/admin')"` exits 0 (loads against the dev DB config); then with the dev backend running, call `GET /api/admin/playlist-crosscheck?url=hello` **without** an admin header → 401, and ask the curator to confirm the 400 case in the browser (never type the admin password).
- [ ] **Step 3: Commit** - `feat(crosscheck): admin routes`.

---

### Task 5: Admin view

**Files:**
- Create: `frontend/src/components/admin/PlaylistCrosscheck.jsx` (view: link box, summary, bulk buttons, Apply, result)
- Create: `frontend/src/components/admin/CrosscheckRow.jsx` (one compact row + its lyrics space)
- Modify: `frontend/src/components/admin/SongsArea.jsx` (add `'crosscheck'` to `SELECTABLE_QUEUES`; render `<PlaylistCrosscheck />` when active)
- Modify: `frontend/src/components/admin/QueueRail.jsx` (second entry in the Spotify group: `['crosscheck', 'Playlist cross-check', false, true]`, same no-count slot as `spotify`)
- Modify: `frontend/src/styles/components.css` (compact row, state chips, choice buttons; tokens only)

**Interfaces:**
- Consumes: `adminFetch` (`../../api/adminApi`); `GET /api/admin/playlist-crosscheck`, `POST …/apply`; `anywhereUrl`, `allSitesUrl`, `LYRIC_SITES`, `siteUrl` from `utils/lyricsSearchUrls` (song shape `{ title, artist }`).
- State kept in `PlaylistCrosscheck`: `url`, `data`, `choices` (`{ [spotify_id]: 'import'|'reject' }`), `lyrics` (`{ [spotify_id]: string }`), `result`, `error`, `busy`. The view keeps the pasted link in the `?url=` search param so Back restores it (as Band check keeps `bq`/`bp`).

Behaviour (the spec's UI requirements, one line each):
- One text box + **Compare** button; plain error line from the API's `message` on failure.
- Summary line: `N new · N possible duplicates · N already have · N ignored (no Spotify id)`.
- Row = title, artists, album, **Play** link (opens `row.url`), state chip (for `have`: the match's status, `live` when live), and for `new`/`duplicate` rows two toggle buttons **Import** / **Reject** (`aria-pressed`, mutually exclusive, clicking the active one clears it). `duplicate` rows also show "Looks like: <match title> - <match artists>". `have` rows have no choice controls.
- **Add lyrics** is a small ghost button on `new`/`duplicate` rows; clicking opens an inline space containing a "Search all lyric sites" link (`allSitesUrl`), a "Search the web" link (`anywhereUrl`), per-site links, and a textarea; clicking again closes it; a small "lyrics added" mark shows on the row when the textarea has non-blank text. Closed rows stay one line.
- Header buttons **Import all new** / **Reject all new** act on `state === 'new'` rows only (never duplicates) and overwrite those rows' choices.
- **Apply (N)** disabled when N = 0 or N > 100 (with a plain "100 at a time" line); on success show `Imported X · Rejected Y · Lyrics saved Z` plus any skipped/lyricsFailed rows, then re-run the compare with `fresh=1` so applied rows turn into Already have it; clear `choices`/`lyrics`.
- Phone width: rows stack (title block above the controls); no horizontal scroll.

- [ ] **Step 1: Implement** the two components, the rail/area wiring and CSS.
- [ ] **Step 2: Verify static:** `cd frontend && npm run lint` (0 errors; the 5-6 pre-existing warnings are fine) and `npm run build` clean.
- [ ] **Step 3: Verify in a real browser** via the throwaway Vite mock-harness on :5199 (per the "Admin UI mock-harness review" memory; harness lives outside the repo; never type `ADMIN_PASSWORD`): mock compare payload with one of each state; check compact rows, Add lyrics open/close, Import/Reject toggles, bulk buttons, Apply disabled at 0 and >100, phone width. Touch the edited files and reload before judging (Vite stale-transform hazard).
- [ ] **Step 4: Commit** (explicit paths) - `feat(crosscheck): Songs > Playlist cross-check view`.

---

### Task 6: Live check, docs, merge prep

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `CLAUDE.md` (architecture bullet for `services/playlistCrosscheck.js`; origin tag note), `docs/PRD.md` feature inventory if it lists admin tools

- [ ] **Step 1: Live read-only check** with a scratchpad script (load `backend/.env` via absolute dotenv path - see the scratchpad-dotenv memory; run from the scratchpad, not `backend/`): call `compare` on `4RvN6XwfV6cQ0eZV7PF215` against the dev DB and print `counts`, `ignored` and three sample rows per state. **Do not call `apply` against real data.** Sanity-check that known live songs show as Already have it.
- [ ] **Step 2: Full verification:** backend suite serial all PASS; frontend lint 0 errors; build clean.
- [ ] **Step 3: Update docs** per the End-Session guide: new top entry in `PROJECT_STATE.md` Current State (built, curator smoke checklist: paste the playlist link, check the three groups, import one + reject one + one possible duplicate with lyrics, see the import in To be processed tagged "From playlist cross-check", the rejected one under All songs as rejected, re-paste and see them as Already have it), Decision Log lines (Reject = rejected row; Possible duplicates allow Import via `allowTitleDuplicates`; apply best-effort per song), Changelog entry; mark the session in `PROJECT_PLAN.md`; CLAUDE.md bullet.
- [ ] **Step 4: Commit** docs (explicit paths) and stop for the curator's smoke before merging to `main`.
