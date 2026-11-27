# Enrichment smoke fixes + artist merge (piece 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix what the curator's piece-2 smoke found (Accept all jumps away, no manual/suggested MusicBrainz link, hard-to-find Clear) and build the artist merge so duplicates like The Instigators / Instigators can be resolved.

**Architecture:** Two small frontend fixes on the existing `EnrichmentPanel` / `IdentifyPanel` (no new endpoints), then `services/artistMerge.js` (`preview` read-only, `merge` one transaction with a snapshot row), two admin routes, and an `ArtistMergePanel` in the workbench reached from the shared-id notice and a "Merge into another artist" section. The layout redesign of the artist admin is a separate, later brainstorm (not in this plan).

**Tech Stack:** Node/Express, `pg`, `node:test` (backend serial: `cd backend && npm test`); React/Vite, frontend `node --test` over `src` tests, `npm run lint`, `npm run build`.

**Spec:** `docs/superpowers/specs/2026-11-23-artist-enrichment-design.md` (Piece 3 for the merge; piece 2 for the panel). Curator smoke feedback of 2026-11-24 (in `docs/PROJECT_STATE.md` after Task 7) is the authority for Tasks 1-2.

## Global Constraints

- YAGNI; every change is weighed against the 650-song dataset: **merge is the only code that moves `song_artists`.**
- `bandCheck.saveIdentity` stays the single writer of `artists.spotify_id` / `bandcamp_url` / `musicbrainz_id`; merge carries identity only by calling it.
- `artistFacts` stays the single writer of fact columns on the normal path; merge copies a blank keeper field from the loser inside its own transaction (the only other writer, spec Piece 3).
- Only `services/artistEnrichment.js` may reference `artist_enrichment_proposals` / `artist_enrichment_review` (test-enforced in `test/enrichmentRoutes.test.js`); merge relies on the loser's `ON DELETE CASCADE` for those rows and does not read them.
- No public route may read `artist_merges` (add the same kind of test as `leads`).
- Merge is never automatic, never bulk: one explicit click per pair, after a preview.
- Backend test sentinel unique per file: `ZZZAMG` (merge service), `ZZZAMR` (merge routes). Fixtures use `randomUUID()` for MusicBrainz ids (unique index) and unique 22-char Spotify ids.
- Commit message trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; `git add` explicit paths only; commit with `git commit -F <file>`.
- Work on branch `session-enrichment-review` (not merged, not pushed; the curator says "Merge").
- Apply migration 026 to the dev DB and restart :5000 (check how it was launched first) before browser checks.

## Review Focus

- Merging an artist with itself, a missing artist, or the same pair twice (second call must be `NOT_FOUND`, not a crash).
- A song both artists are on: it must end with the keeper once, in the same artist order position, not duplicated or dropped.
- A song whose artists are [loser, X]: after the merge it must still list the keeper before X (order = `song_artists.id`).
- Both artists carry a different MusicBrainz / Spotify / Bandcamp value: the keeper's wins, the loser's is in the snapshot and in the preview's `conflicts`.
- The loser has an identity the keeper lacks: it must reach the keeper, even though the loser's unique id is still held until the loser is deleted.
- A preview that goes stale (a song added to the loser, a field edited) between preview and merge must abort with `CONFLICT`, writing nothing.
- A failure half-way (e.g. the identity step) must roll back everything, including the snapshot row.
- Pasting a MusicBrainz **URL** (not just the bare id) in Links, with trailing slash, `/edit`, uppercase.

---

### Task 1: Accept all stays on the page and shows what was accepted

**Files:**
- Modify: `frontend/src/utils/enrichmentText.js`, `frontend/src/utils/enrichmentText.test.js`
- Modify: `frontend/src/components/admin/EnrichmentPanel.jsx`

**Interfaces:**
- Produces: `acceptedSummary(applied: string[]) -> string[]` in `enrichmentText.js`: `'match'` -> `'MusicBrainz match approved'`, `'bandcamp_url'` -> `fieldLabel('bandcamp_url')`, any other plain key -> `fieldLabel(key)`, `'member:<name>'` -> `'Member: <name>'`. Order kept.
- Consumes: `fieldLabel`, the server's `acceptAll` result `{applied: string[], skipped: [...], review}` (unchanged).

- [ ] **Step 1: Write the failing test** in `enrichmentText.test.js`: `acceptedSummary(['match','country','member:Tab','bandcamp_url'])` deep-equals `['MusicBrainz match approved', fieldLabel('country'), 'Member: Tab', fieldLabel('bandcamp_url')]`; `acceptedSummary([])` is `[]`.
- [ ] **Step 2: Run** `cd frontend && node --test src/utils/enrichmentText.test.js`; expect FAIL (not exported).
- [ ] **Step 3: Implement `acceptedSummary`** in `enrichmentText.js` (a `member:` prefix check, then `match`, else `fieldLabel`).
- [ ] **Step 4: Rework `acceptAll` in `EnrichmentPanel.jsx`.** The artist is still finished when nothing was skipped (`finishCall(true)`), but the panel **never calls `onDone`** from Accept all. Keep `const [accepted, setAccepted] = useState([])` (labels from `acceptedSummary(res.applied)`) set on each Accept all, cleared by `Reopen` and by the next `act` that is not an Accept all. Rename the button to **Accept all shown**. In the finished branch (`review.finished_at`), render, under "Reviewed" and Reopen: when `accepted.length`, the line `Just accepted: <labels joined by ", ">` (a `div` with `role="status"`), and a **Next artist →** button calling `onDone()` (the workbench's `goNext`; with no queue it returns to the list). In the unfinished branch (something was skipped), show the same `Just accepted` line above the `needCheck` line. `Done with this artist` keeps moving to the next artist (its label says so). Facts and Links already refresh through `onChanged` / `onIdentitySaved`.
- [ ] **Step 5: Run** `node --test` for the whole frontend (`cd frontend && node --test $(git ls-files 'src/**/*.test.js')`) and `npm run lint`; expect pass, 0 errors.
- [ ] **Step 6: Commit** `fix(enrichment): Accept all stays on the page and lists what it accepted`.

### Task 2: Links panel: paste a MusicBrainz id, suggested id, a clear Clear

**Files:**
- Create: `frontend/src/utils/musicbrainzId.js`, `frontend/src/utils/musicbrainzId.test.js`
- Modify: `frontend/src/components/admin/IdentifyPanel.jsx`, `frontend/src/components/admin/EnrichmentPanel.jsx` (one hint line)

**Interfaces:**
- Produces: `parseMusicBrainzId(text: string) -> string | null` (pure): returns the lower-cased UUID from a bare id or from a `musicbrainz.org/artist/<uuid>` URL (any scheme, trailing slash, `/edit`, `?query`, `#hash`, surrounding spaces); `null` for anything else (a `/release/<uuid>` URL is `null`).
- Consumes: `GET /api/admin/artists/:id/enrichment` (existing; `{has_proposal:false}` or `{has_proposal:true, match:{proposed_mbid, method, confidence, url, ...}}`); `PUT /api/admin/band-check/bands/:id/identity` `{source:'musicbrainz', value: uuid|null}` (existing, already validates the UUID and refuses a taken one with a 409 `CONFLICT` message).

- [ ] **Step 1: Write the failing tests** in `musicbrainzId.test.js`: bare id, upper-case id, `https://musicbrainz.org/artist/<uuid>`, `.../artist/<uuid>/`, `.../artist/<uuid>/edit`, `...?x=1`, padded with spaces -> the lower-case uuid; `''`, `'hello'`, a release URL, a UUID with a wrong length -> `null`.
- [ ] **Step 2: Run** `node --test src/utils/musicbrainzId.test.js`; expect FAIL.
- [ ] **Step 3: Implement `parseMusicBrainzId`** (one anchored regex for the bare id, one for the artist URL).
- [ ] **Step 4: `IdentifyPanel.jsx`.** For the MusicBrainz row: (a) below the search results, a paste form like Bandcamp's (`Or paste a MusicBrainz link or id:`, input `aria-label="MusicBrainz link or id"`, **Use** button disabled until `parseMusicBrainzId` gives a value) that calls `save(parsed, 'musicbrainz')`; an unparseable entry shows `That is not a MusicBrainz artist link or id` in the panel's error line; (b) when the MusicBrainz row opens, fetch the enrichment review once (`api(`/api/admin/artists/${artistId}/enrichment`)`, errors ignored) and, when `has_proposal` and `match.proposed_mbid` differs from the saved id, show it first in the list as `Proposed by the enrichment` with `methodLabel`/`confidenceLabel` as the detail and the `match.url` open link, with the same Choose button (a stale response is dropped like `search` does); (c) the **Clear** button on a saved MusicBrainz or Bandcamp row becomes `btn btn-ghost btn-sm` (same weight as Change) and asks `window.confirm('Clear the saved <Source> link?')` first. Clearing already calls `onSaved`, which re-reads the artist and the enrichment panel.
- [ ] **Step 5: `EnrichmentPanel.jsx`.** In the `otherStored` line append ` - change or clear it under Links`.
- [ ] **Step 6: Run** the whole frontend `node --test`, `npm run lint`, `npm run build`; expect pass.
- [ ] **Step 7: Commit** `feat(links): paste a MusicBrainz link, suggest the proposed id, clearer Clear`.

### Task 3: Migration 026 and `artistMerge.preview`

**Files:**
- Create: `backend/database/migrations/026_artist_merges.sql`, `backend/services/artistMerge.js`, `backend/test/artistMergePreview.test.js` (sentinel `ZZZAMG`)

**Interfaces:**
- Produces: table `artist_merges(id SERIAL PK, loser_id INTEGER NOT NULL, keeper_id INTEGER NOT NULL, loser_snapshot JSONB NOT NULL, merged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`; **no foreign keys** (the loser is deleted; the keeper may later be merged away). `preview(db, keeperId, loserId) -> { keeper: Side, loser: Side, songs: { moving, shared }, members: { moving, skipped }, leads: n, fills: string[], conflicts: [{field, keeper, loser}], identity: { carried: string[], kept: string[] }, hash: string }` where `Side = { id, name, songs, live_songs }`, `songs.moving` = loser songs the keeper is not on, `songs.shared` = songs both are on, `members.moving/skipped` by `artistFacts.nameKey`, `fills` = blank keeper fields the loser would fill, `conflicts` = fields both have with different values (keeper wins), `identity.carried` = source names (`spotify|bandcamp|musicbrainz`) the keeper lacks and the loser has, `identity.kept` = both have different values (keeper wins), `hash` = hex sha1 of a stable JSON of both artist rows' columns (excluding `updated_at`), the loser's `song_artists` ids, the loser's member ids and the lead ids pointing at the loser. Throws `coded('BAD_INPUT')` for the same id or a non-integer, `coded('NOT_FOUND')` for a missing artist.
- Compared fields (keeper blank = null or empty string, or empty array for `genres`): `bio`, `vegan_advocacy_notes`, `website_url`, `genres`, `country` (with `country_source`), `formed_year` (`formed_source`), `disbanded_year` (`disbanded_source`), `first_release_year` (`first_release_source`), `last_release_year` (`last_release_source`), `thread_claims`. `discography_review_notes` is concatenated, so it is neither a fill nor a conflict. Flags `discography_reviewed`, `no_advocacy_notes_needed`, `manual_override`, `manual_data`, `images`, `followers`, `popularity` are the keeper's, untouched, and not listed.
- Export `FIELDS` (the list above) and `preview` now; Task 4 adds `merge`.

- [ ] **Step 1: Write the migration** (`CREATE TABLE IF NOT EXISTS artist_merges ...`). Apply it to the dev DB with psql; re-running must be a no-op.
- [ ] **Step 2: Write failing tests** (`artistMergePreview.test.js`, a `mk(name, {mb, spotify, ...})` helper with per-test unique ids, a `song(artistIds[])` helper creating a `songs` row with the minimum columns the schema requires plus ordered `song_artists`, cleanup by `name LIKE 'ZZZAMG%'` and the songs the test made): same id and missing artist throw the right codes; a pair where the loser has 2 songs, one shared with the keeper, reports `songs {moving:1, shared:1}`; members `Tab` on both and `Semi` on the loser only (matched case/diacritic-insensitively) report `members {moving:1, skipped:1}`; a keeper with no bio and a loser with one lists `bio` in `fills`; both with a different `country` list it in `conflicts` with both values; a loser `musicbrainz_id` with a blank keeper puts `musicbrainz` in `identity.carried`; differing Spotify ids put `spotify` in `identity.kept`; the hash is identical on two calls and changes after the loser gains a song.
- [ ] **Step 3: Run** `cd backend && node --test test/artistMergePreview.test.js`; expect FAIL (module missing).
- [ ] **Step 4: Implement `preview`** in `services/artistMerge.js` using one read per side (artist row, `live_songs` via the same published/included filter the other artist reads use) and `artistFacts.nameKey`. Share a `load(db, keeperId, loserId)` that Task 4's `merge` reuses.
- [ ] **Step 5: Run** the new test; expect PASS. Then `npm test` (serial) for the whole backend; expect all green.
- [ ] **Step 6: Commit** `feat(merge): artist_merges table and merge preview`.

### Task 4: `artistMerge.merge`

**Files:**
- Modify: `backend/services/artistMerge.js`
- Create: `backend/test/artistMerge.test.js` (sentinel `ZZZAMG2`, its own fixtures; the other file's cleanup must not match it)

**Interfaces:**
- Consumes: `preview`'s `load`, `artistFacts.nameKey`, `bandCheck.saveIdentity(db, artistId, source, value)` (accepts any object with `query`, so a transaction client works).
- Produces: `merge(pool, keeperId, loserId, hash) -> { merged: true, keeper: { id }, moved: { songs, members, leads } }`. Rejects `coded('CONFLICT', 'These artists changed since the preview; open it again')` when `hash` differs from a fresh `preview` computed inside the transaction after `SELECT ... FOR UPDATE` on both artist rows (lower id first, to avoid deadlock). `hash` missing -> `BAD_INPUT`.

- [ ] **Step 1: Write failing tests**: (a) songs: loser [L, X] song and keeper [K] song and a shared [K, L] song; after merge the first song's artists are [K, X] **in that order** (read `song_artists` by `id`), the shared song has K once, no row references the loser, the keeper's `live_songs` equals the sum minus the shared one; (b) members: loser-only member moves with its `vegan` and `source`, the duplicate-name member is dropped, keeper's members untouched; (c) fields: blank keeper `bio` is filled from the loser together with `country` + `country_source`; a differing `country` keeps the keeper's; `discography_review_notes` become `<keeper notes>\n\nMerged from <loser name> (<YYYY-MM-DD>): <loser notes>` (only when the loser has notes); (d) `leads.artist_id` pointing at the loser now points at the keeper; (e) identity: a loser `musicbrainz_id` and `bandcamp_url` reach a blank keeper; differing ones leave the keeper's; the loser's Spotify id goes to the keeper only when the keeper has none; (f) the snapshot row exists with `loser_id`, `keeper_id` and `loser_snapshot` carrying the loser's artist row, its `song_artists` rows (`id`, `song_id`), members and lead ids; (g) the loser row is gone and a second `merge` of the same pair rejects `NOT_FOUND`; (h) a stale hash (loser gained a song after the preview) rejects `CONFLICT` and leaves both artists, the songs and `artist_merges` unchanged; (i) a forced failure (stub `bandCheck.saveIdentity` through the module's injected dependency, see Step 3) rolls back everything including the snapshot; (j) itself and missing ids reject `BAD_INPUT` / `NOT_FOUND`.
- [ ] **Step 2: Run** `node --test test/artistMerge.test.js`; expect FAIL.
- [ ] **Step 3: Implement `merge`** in one `BEGIN`/`COMMIT` on a `pool.connect()` client in this order: lock + recompute preview and compare the hash; insert the `artist_merges` snapshot row; `UPDATE song_artists SET artist_id = keeper WHERE artist_id = loser AND song_id NOT IN (SELECT song_id FROM song_artists WHERE artist_id = keeper)` (an UPDATE, so each row keeps its `id` and the artist order of a song is preserved); move non-duplicate members by `UPDATE ... WHERE id = ANY($ids)`; repoint `leads`; fill blank keeper fields in one `UPDATE` (each `*_source` travels with its value); append the review-notes line; remember the loser's identity values; `DELETE FROM artists WHERE id = loser` (cascades remaining `song_artists`, members, proposals and review rows, and frees the unique ids); then for each carried identity call `saveIdentity(client, keeper, source, value)`; commit. On any error `ROLLBACK`, rethrow the coded error unchanged and never log the artists' text. Take `saveIdentity` as an overridable dependency (`module.exports._deps`) only so Step 1(i) can inject a failure.
- [ ] **Step 4: Run** the new file and then the whole backend `npm test`; expect all green.
- [ ] **Step 5: Commit** `feat(merge): merge one artist into another in one transaction with a snapshot`.

### Task 5: Merge routes and privacy test

**Files:**
- Modify: `backend/routes/admin.js` (after the enrichment routes, before the next banner)
- Create: `backend/test/artistMergeRoutes.test.js` (sentinel `ZZZAMR`; follow `enrichmentRoutes.test.js` for the server/auth harness)

**Interfaces:**
- Produces: `GET /api/admin/artists/:id/merge-preview?keeper=<id>` -> `preview(keeper, :id)` JSON (`:id` is the artist that would disappear); `POST /api/admin/artists/:id/merge` body `{ keeper: number, hash: string }` -> `merge` result. Errors through `artistError` (NOT_FOUND 404, BAD_INPUT 400, CONFLICT 409). Both need `X-Admin-Password` (401 without).

- [ ] **Step 1: Write failing tests**: 401 without the header on both; preview returns the shape for a real pair; a `keeper` that is missing or not a positive integer is 400; merge with the preview's hash returns `merged: true` and the loser then 404s on `GET /api/admin/artists/:id`; a stale hash is 409; the public `GET /api/spotify/artists/:id` of the loser is 404 afterwards; a source scan asserts no file under `routes/` other than `admin.js` and no service other than `artistMerge.js` references `artist_merges`.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement the two routes** (validate `keeper` and `hash` types before calling the service).
- [ ] **Step 4: Run** the file and the whole backend `npm test`; expect all green.
- [ ] **Step 5: Commit** `feat(merge): admin routes for merge preview and merge`.

### Task 6: Merge panel in the workbench

**Files:**
- Create: `frontend/src/components/admin/ArtistMergePanel.jsx`, `frontend/src/utils/mergeText.js`, `frontend/src/utils/mergeText.test.js`
- Modify: `frontend/src/components/admin/ArtistWorkbench.jsx`, `frontend/src/components/admin/EnrichmentPanel.jsx`, `frontend/src/styles/admin.css` (reuse existing `wb-panel`, `band-*` and `enr-*` classes; add only what is missing)

**Interfaces:**
- Produces: `mergeText.js` exports `defaultKeeper(a, b) -> 'a'|'b'` (more `songs`; tie: more `live_songs`; tie: the lower id) and `previewLines(preview) -> string[]` (plain sentences: `N songs move to <keeper>`, `N songs are on both and stay once`, `N members move, N skipped as already listed`, `Filled from <loser>: <field labels>`, `Kept as on <keeper> (<loser> differs): <field labels>`, `MusicBrainz / Bandcamp / Spotify link carried over` or `kept`, `<loser> is removed. This cannot be undone from the screen; a snapshot of it is saved`).
- Consumes: the Task 5 routes, `GET /api/admin/artists?q=` (rows have `id`, `name`, `songs`, `live_songs`), `fieldLabel`.
- `ArtistMergePanel({ artist, initialOther, onMerged })`: collapsed `Merge into another artist` section at the bottom of the side column; search box (debounced like `ArtistQueueList`) lists other artists by name; choosing one (or `initialOther` id from the URL) loads both artists' counts, picks `defaultKeeper`, shows the keeper/loser line with a **Swap** button, fetches the preview for the current direction and renders `previewLines`; **Merge** asks `window.confirm` naming both artists, POSTs `{keeper, hash}` to `/api/admin/artists/<loser>/merge`, then navigates to `/admin/artist/<keeper>` (replace). A 409 shows the server message and offers a fresh preview.

- [ ] **Step 1: Write failing tests** for `defaultKeeper` (songs, live tie, id tie) and `previewLines` (a moving/shared/skipped case, a fills + conflicts case, a carried-identity case).
- [ ] **Step 2: Run** `node --test src/utils/mergeText.test.js`; expect FAIL.
- [ ] **Step 3: Implement `mergeText.js`.**
- [ ] **Step 4: Implement `ArtistMergePanel.jsx`** as specified; every request through `adminFetch`; a sequence guard drops stale responses; never merges without a preview of the exact direction shown.
- [ ] **Step 5: Wire it in.** `ArtistWorkbench.jsx` renders the panel last in the side column, reading `new URLSearchParams(location.search).get('mergeWith')` as `initialOther` (open when present). `EnrichmentPanel.jsx`: in the shared-id notice replace `; merging comes in a later update` with a `Merge...` link per partner to `/admin/artist/${artist.id}?mergeWith=${s.id}`.
- [ ] **Step 6: Run** the whole frontend `node --test`, `npm run lint`, `npm run build`; expect pass, 0 errors.
- [ ] **Step 7: Commit** `feat(merge): merge panel in the artist workbench`.

### Task 7: Docs and smoke list

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `CLAUDE.md`, `docs/PRD.md` (feature inventory)

- [ ] **Step 1:** In `PROJECT_STATE.md` add: the curator's 2026-11-24 smoke results (steps 1-4, 6, 8-11 working; the five findings) and what changed; piece 3 built (not yet smoked); the decision log entries below; remove "merging comes in a later update" from deferred limits; Next Tasks: smoke, "Merge", then the **artist admin layout redesign** (brainstorm first: the Catalogue panel is about 12,000px tall and pushes Details / Links / Proposed enrichment / Facts to the bottom of a single-column layout under 900px; the side column is a 1fr track beside it above that).
- [ ] **Step 2:** `CLAUDE.md`: a `services/artistMerge.js` bullet (invariants: UPDATE keeps `song_artists.id` so song order holds; hash-guarded; snapshot in `artist_merges`; identity via `saveIdentity` after the loser is deleted; the review/proposal rows follow the cascade and are not read) and the `parseMusicBrainzId` / Accept-all-stays notes where `EnrichmentPanel` and `IdentifyPanel` are described.
- [ ] **Step 3:** `PROJECT_PLAN.md` and `PRD.md` inventory lines.
- [ ] **Step 4: Verify** backend `npm test` count, frontend `node --test` count, lint, build; put the real numbers in `PROJECT_STATE.md`.
- [ ] **Step 5: Commit** `docs: enrichment smoke fixes and artist merge`.

## Decisions to record (Task 7)

1. Accept all never navigates; **Next artist →** is explicit. Done with this artist still moves on.
2. A duplicate is resolved by merge only; there is no "mark as duplicate" state.
3. Merge: keeper = the row with more songs by default, swappable; keeper's values win; the loser's differing values are listed in the preview and its full row is in `artist_merges.loser_snapshot`.
4. Known limit: the loser's Spotify artist id disappears with its row, so a future Spotify import of a song credited to that Spotify artist would create it again; the snapshot records the id for that case.
5. The loser's `artist_enrichment_review` / proposal rows are deleted by cascade, not snapshotted (only `artistEnrichment.js` may touch those tables).
