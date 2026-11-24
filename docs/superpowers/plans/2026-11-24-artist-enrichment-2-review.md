# Artist Enrichment Piece 2 (Match and Facts Review) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the curator review the analysis project's staged artist proposals one artist at a time inside the artist workbench: approve or reject the MusicBrainz match, then accept or skip each proposed fact, with nothing applied without a click.

**Architecture:** A new service `services/artistEnrichment.js` READS `artist_enrichment_proposals` live (never writes it) and joins a new web-owned table `artist_enrichment_review` (match decision, finished flag). All writes go through the existing single writers (`bandCheck.saveIdentity`, `artistFacts.saveFacts` / `addMember` / `updateMember`). The queue count and list share one predicate table, like `services/artists.js`. The frontend adds an "Enrichment" rail group to `ArtistsArea` and an `EnrichmentPanel` to `ArtistWorkbench`.

**Tech Stack:** Node/Express + `pg`, `node:test` (backend, run `cd backend && npm test`), React/Vite (frontend; lint `cd frontend && npm run lint`, build `npm run build`, pure-util tests `node --test`).

**Spec:** `docs/superpowers/specs/2026-11-23-artist-enrichment-design.md` (Piece 2). Piece 1 (provenance, first release year) is merged. Piece 3 (artist merge) is NOT in this plan.

## Global Constraints

- The web app never writes `artist_enrichment_proposals`; the analysis project never writes `artists` / `artist_members`. No public route and no service other than `services/artistEnrichment.js` may reference `artist_enrichment_proposals` or `artist_enrichment_review` (test-enforced, like `leads`).
- `bandCheck.saveIdentity` stays the single writer of `artists.musicbrainz_id` / `bandcamp_url`; `artistFacts.saveFacts` / `addMember` / `updateMember` stay the only fact writers. Members are added with `vegan = false`, matched by `artistFacts.nameKey`; an accept never deletes a member and never touches `vegan`.
- Accepted facts are stored with the proposal's own source, which must be one of `artistFacts.SOURCE_NAMES` (`MusicBrainz`, `Wikidata`, `Bandcamp`, `Catalogue Albums`, `Gemini Web Search`, `Added by curator`). A proposed value whose source is null or not in that set is not offered (it could not be stored with provenance).
- Facts whose source is `MusicBrainz` or `Wikidata` are LOCKED until the match is approved or pre-trusted; `Bandcamp` and `Catalogue Albums` facts never depend on the match.
- Layer 4 fields (bio, vegan stance, evidence), website urls, Wikidata ids and Wikipedia extracts are not read or stored. Skip stores nothing.
- Public pages show no sources and nothing from these tables. Never log a fetch error message, token or URL (no network is used here).
- Backend test files each use a unique fixture sentinel (this plan: `ZZZENR`, in artist names); tests never touch real artists; pure cleanup uses `ILIKE '%ZZZENR%'`. Run the whole backend suite serial: `cd backend && npm test`.
- Styling uses the existing tokens and classes (`wb-panel`, `fact-proposal`, `miss-chip`, `btn`); no raw colours.
- Review order (settled): title-verified (`HIGH`) matches not yet decided first, then artists whose proposed id is shared with another artist's proposal or stored on another artist, then the rest by total song count descending, then name, then id.

## Review Focus

- A proposal row for an artist that has no proposal at all (new artist): panel and routes answer `has_proposal: false`, never 500.
- The analysis project changes the proposed id after a decision: the old approve/reject no longer applies (state returns to undecided).
- Approving a match whose id is already stored on another artist (a duplicate pair): `CONFLICT`, nothing written, no unique-index 500.
- A proposed value equal to the stored one, or a stored `USA` versus a proposed `United States`: equal is omitted; different is shown as a replace.
- Two clicks on Accept all (or Accept then Accept all): idempotent, no duplicate member, no error for rows already equal.
- A proposal with a null/unknown source or a malformed `proposed_members` entry: that row is dropped, the rest still work.

---

### Task 1: Review table, unique MusicBrainz index, and the identity-conflict mapping

**Files:**
- Create: `backend/database/migrations/025_artist_enrichment_review.sql`
- Modify: `backend/services/bandCheck/index.js` (the `musicbrainz` branch of `saveIdentity`, ~line 99)
- Test: `backend/test/enrichmentMigration.test.js` (sentinel `ZZZENM`)

**Interfaces:**
- Produces: table `artist_enrichment_review(artist_id INTEGER PK REFERENCES artists(id) ON DELETE CASCADE, match_decision TEXT CHECK IN ('approved','rejected'), matched_mbid UUID, finished_at TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)` with `CHECK ((match_decision IS NULL) = (matched_mbid IS NULL))`; a partial unique index `artists_musicbrainz_id_unique ON artists (musicbrainz_id) WHERE musicbrainz_id IS NOT NULL`. `saveIdentity(db, id, 'musicbrainz', uuid)` now throws `coded('CONFLICT', 'Another artist in the catalogue already has that MusicBrainz id')` when another artist holds the id (checked first by a SELECT, and a `23505` from the index also maps to the same CONFLICT).

- [ ] **Step 1: Write the failing tests** in `enrichmentMigration.test.js`: (a) the review table exists with the CHECK (inserting `match_decision='approved'` with a NULL `matched_mbid` rejects); (b) deleting an artist cascades its review row; (c) two artists named `ZZZENM A` / `ZZZENM B`: `saveIdentity(pool, a, 'musicbrainz', U)` resolves, then `saveIdentity(pool, b, 'musicbrainz', U)` rejects with `e.code === 'CONFLICT'`, and A still holds U; (d) saving the same id again on A succeeds (idempotent); (e) the id in upper case conflicts the same way. Cleanup deletes both artists by `ILIKE '%ZZZENM%'` before and after.
- [ ] **Step 2: Run** `cd backend && node --test test/enrichmentMigration.test.js`. Expected: FAIL (table missing).
- [ ] **Step 3: Write the migration.** Before `CREATE UNIQUE INDEX`, `DO $$` block that raises a clear exception listing duplicate ids if any already exist (none today). Use `IF NOT EXISTS` on both objects. Apply it to the dev DB with `psql` (the project's migration practice) and note in the final report that other environments need it.
- [ ] **Step 4: Implement the CONFLICT mapping** in `saveIdentity`'s musicbrainz branch: SELECT for another artist with the same id first (like the spotify branch), and wrap the UPDATE so a `23505` also becomes the CONFLICT.
- [ ] **Step 5: Run** the new test and `node --test test/bandCheckService.test.js`. Expected: PASS both.
- [ ] **Step 6: Commit** `git add backend/database/migrations/025_artist_enrichment_review.sql backend/services/bandCheck/index.js backend/test/enrichmentMigration.test.js` with message `feat(enrichment): review table, unique MusicBrainz index, identity CONFLICT`.

---

### Task 2: Read side - proposal view, queue counts and list

**Files:**
- Create: `backend/services/artistEnrichment.js`
- Test: `backend/test/enrichmentRead.test.js` (sentinel `ZZZENR`)

**Interfaces:**
- Consumes: `artistFacts.getFacts`, `artistFacts.nameKey`, `artistFacts.SOURCE_NAMES`; `coded` from `./bandCheck/errors`.
- Produces (all take `db` first):
  - `QUEUES = [{key:'enr-review',label:'To review'},{key:'enr-match',label:'Match to approve'},{key:'enr-dupes',label:'Possible duplicates'},{key:'enr-done',label:'Done'}]`
  - `counts(db) -> { 'enr-review': n, 'enr-match': n, 'enr-dupes': n, 'enr-done': n }`
  - `list(db, { queue, q = '', limit = 50, offset = 0 }) -> { total, rows }`; each row `{ id, name, songs, live_songs, enrichment: { method, confidence, shared: boolean } }`; unknown queue -> `coded('BAD_INPUT','Unknown queue')`; search is literal (`%`/`_` escaped) and shared by the count and list queries.
  - `getReview(db, artistId) -> Review`, where
    `Review = { has_proposal, artist_type, finished_at, match, fields, members, warnings }`:
    - `match = { state, proposed_mbid, stored_mbid, method, confidence, url, shared_with: [{id,name,songs}], catalogue: { songs, live_songs, first_year, last_year, albums: [{name,year}] } }` with `state` one of `'none' | 'pretrusted' | 'needs-approval' | 'approved' | 'rejected'`; `url = https://musicbrainz.org/artist/<id>` or null.
    - `fields = [{ field, label, current, proposed, source, confidence, link, locked }]` for `field` in `country`, `formed_year`, `disbanded_year`, `last_release_year`, `bandcamp_url`; equal values and rows with a null/unknown source (except `bandcamp_url`, whose source is always `Bandcamp`) are omitted; `bandcamp_url` compares by the normalised origin (`normalizeBandcampOrigin` from `./bandCheck/bandcamp` or wherever `saveIdentity` imports it from).
    - `members = [{ name, is_current, source, change: 'new'|'status', existing: null | {id,is_current,vegan}, locked }]`, same matching rule as `proposeFromMusicBrainz` (never a delete); malformed entries dropped.
    - `warnings = [{ field: 'last_release_year'|'disbanded_year'|'formed_year'|'members'|'match', text }]`.
  - `hasProposal` false -> `{ has_proposal:false }` only.

**Rules to implement exactly:**
- State: no proposed id -> `none`. Stored id equals proposed, or the review row has `match_decision='approved'` and `matched_mbid` equal to the proposed id -> `approved`. Review row `rejected` for the same proposed id -> `rejected`. A decision whose `matched_mbid` differs from the current proposed id is ignored (undecided). Otherwise `EXACT_ID` -> `pretrusted`, `HIGH` -> `needs-approval`.
- `locked = source in {MusicBrainz, Wikidata} && state not in {pretrusted, approved}` (applies to fields and members).
- `shared_with`: other artists whose proposal has the same proposed id, or who store that id.
- Queue base predicate (one `PREDICATE` table feeding both `counts` and `list`): proposal exists AND review `finished_at IS NULL` AND "has something to review" (any of: proposed id not equal stored; proposed country / formed / disbanded / last-release / bandcamp origin different from stored; a proposed member whose lower-cased name is not among the artist's members). The SQL comparison is an approximation of `getReview` (a queue artist may open to "nothing to review"); say so in a code comment. `enr-match` = base AND `mbid_confidence='HIGH'` AND an id proposed, not stored, and no matching decision. `enr-dupes` = base AND shared (above). `enr-done` = `finished_at IS NOT NULL`.
- Order for `enr-review` and `enr-match`: undecided HIGH match first, then shared-id, then total songs descending, then lower(name), id. `enr-dupes` and `enr-done`: songs descending, name, id.
- Warnings (strings name the numbers): proposed last release earlier than the catalogue's latest album year (`albums.release_date` year via songs of this artist); proposed disbanded year earlier than the proposed (or stored) last release year; proposed formed year later than the catalogue's earliest album year; `artist_type = 'Person'` with a non-empty member list; a `shared_with` entry.

- [ ] **Step 1: Write the failing tests** (fixtures: artists `ZZZENR One`..., songs/albums rows only where the catalogue-year warning needs them, a `artist_enrichment_proposals` row inserted by the test with explicit columns; cleanup deletes by artist name, the proposals and reviews cascade). Tests, by name:
  - `no proposal -> has_proposal false`
  - `equal values are omitted, different shown with current and proposed` (stored `USA` vs proposed `United States` is shown)
  - `unknown or null source drops that row but keeps the others`
  - `members: new, status change, and an identical member omitted; malformed entry dropped; vegan never in the result`
  - `state: EXACT_ID pretrusted, HIGH needs-approval, stored equal approved, decision for another id ignored, rejected`
  - `MusicBrainz and Wikidata rows are locked until approved; Bandcamp and Catalogue Albums rows never locked`
  - `shared id with another proposal and with a stored id both appear in shared_with and warn`
  - `warnings: last release before catalogue album year, disbanded before last release, formed after first catalogue release, Person with members`
  - `counts equal list totals for every queue` and `enr-review order: undecided HIGH, then shared, then songs desc`
  - `search is literal: a name containing % does not act as a wildcard`
  - `unknown queue is BAD_INPUT`
- [ ] **Step 2: Run** `node --test test/enrichmentRead.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `services/artistEnrichment.js`** with the exports above (pure helpers for the state, lock and warning rules kept as small exported functions so the tests can call them directly: `matchState(proposal, review, stored)`, `isLocked(source, state)`).
- [ ] **Step 4: Run** the test again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(enrichment): read side - proposal view, queues and warnings`.

---

### Task 3: Write side - match decision, accept, accept all, finish

**Files:**
- Modify: `backend/services/artistEnrichment.js`
- Test: `backend/test/enrichmentWrite.test.js` (sentinel `ZZZENW`)

**Interfaces:**
- Consumes: `getReview` (Task 2); `bandCheck.saveIdentity`; `artistFacts.saveFacts`, `addMember`, `updateMember`.
- Produces (all take `db` first, all re-read the proposal and stored values server-side; the client supplies only a decision, a field name or a member name):
  - `decideMatch(db, artistId, decision) -> Review` with `decision` in `'approve' | 'reject' | 'clear'`. `approve`: needs a proposed id (else `BAD_INPUT`); `saveIdentity(..., 'musicbrainz', id)` then upsert the review row (`approved`, `matched_mbid`); a CONFLICT from `saveIdentity` propagates and writes no review row. `reject`: upsert `rejected` for the proposed id; if the stored id already equals the proposed one -> `BAD_INPUT('That id is already saved; clear it under Links first')`. `clear`: set decision and `matched_mbid` NULL.
  - `acceptField(db, artistId, field) -> Review`: `field` must be one of the five field keys, else `BAD_INPUT`; the row must currently exist in `getReview(...).fields` (else `NOT_FOUND('Nothing proposed for that field')`) and not be locked (else `CONFLICT('Approve the match first')`). Years/country via `saveFacts(db, id, { [field]: proposed, [`${key}_source`]: source })` (key as in `ArtistFactsPanel.sourceKey`: `country_source`, `formed_source`, `disbanded_source`, `last_release_source`); `bandcamp_url` via `saveIdentity(..., 'bandcamp', proposedOrigin)`.
  - `acceptMember(db, artistId, name) -> Review`: finds the row by `nameKey`, refuses locked, `new` -> `addMember({ name, is_current, vegan:false, source })`, `status` -> `updateMember(db, id, existing.id, { is_current })`; an already-equal member is a no-op that succeeds.
  - `acceptAll(db, artistId) -> { applied: string[], skipped: [{ field, reason: 'locked' | 'warning' | 'failed', message? }], review }`: if `match.state === 'pretrusted'`, first approve the match (same as `decideMatch approve`; a CONFLICT is recorded as a skipped `match` entry and the locked rows then skip as `locked`); then accept every row that is not locked and has no warning of its own (rows and members with a warning are skipped with `reason:'warning'`); a failure on one row is recorded (`failed`, fixed message from `e.message` of our own coded errors only) and the loop continues. Re-running changes nothing.
  - `finish(db, artistId, finished: boolean) -> Review`: sets `finished_at = CURRENT_TIMESTAMP` or NULL on the review row (upsert); no proposal -> `NOT_FOUND`.

- [ ] **Step 1: Write the failing tests**, by name:
  - `approve writes musicbrainz_id through saveIdentity and records the decision for that id`
  - `approve of an id stored on another artist is CONFLICT and writes nothing (no identity change, no review row)`
  - `reject records the decision, writes nothing to artists, and locks MusicBrainz/Wikidata rows`
  - `a decision for an old id stops applying after the proposal's id changes`
  - `acceptField saves value and source; Skip (never calling anything) stores nothing`
  - `acceptField on a locked row is CONFLICT and writes nothing`
  - `acceptField with an unknown field name is BAD_INPUT; a field with no proposal is NOT_FOUND`
  - `bandcamp_url accept goes through saveIdentity and normalises to the origin`
  - `acceptMember adds with vegan=false and the proposal's source; a status change leaves vegan alone; an existing hand-entered member is never removed`
  - `acceptAll on a pretrusted artist approves the match and applies unlocked rows without warnings; warned rows come back skipped`
  - `acceptAll on a needs-approval artist applies only unlocked rows (Bandcamp, Catalogue Albums) and reports the rest locked`
  - `acceptAll twice is idempotent (second call applied = [])`
  - `finish sets and clears finished_at and moves the artist between enr-review and enr-done`
  - `none of these touch artist_enrichment_proposals (row count and updated_at unchanged)`
  - `no song_artists, songs or lyrics rows change` (count `song_artists` before and after).
- [ ] **Step 2: Run** `node --test test/enrichmentWrite.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the four functions. One-line approach: review-row upsert is a single `INSERT ... ON CONFLICT (artist_id) DO UPDATE`; `acceptAll` loops over the `getReview` rows, calling the same internal row-accept helpers as `acceptField` / `acceptMember` (no second code path).
- [ ] **Step 4: Run** `node --test test/enrichmentWrite.test.js test/enrichmentRead.test.js test/artistFacts.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(enrichment): match decision, accept, accept all, finish`.

---

### Task 4: Admin routes and the privacy test

**Files:**
- Modify: `backend/routes/admin.js` (after the artist facts routes, ~line 1583; require the service near line 19)
- Test: `backend/test/enrichmentRoutes.test.js` (sentinel `ZZZENT`)

**Interfaces:**
- Consumes: Tasks 2 and 3 exports; the existing `artistError` and `artistId` helpers (add `LOCKED` is NOT needed; locked is `CONFLICT` 409).
- Produces routes (all under the router's existing admin auth; static `/enrichment/...` paths declared before `/artists/:id`-style paths do not collide, but keep them together):
  - `GET /api/admin/enrichment/queues` -> `{ queues: [{key,label,count}] }`
  - `GET /api/admin/enrichment/queue?queue=&q=&limit=&offset=` -> `list(...)` (q capped to 100 chars like artists)
  - `GET /api/admin/artists/:id/enrichment` -> `getReview`
  - `PUT /api/admin/artists/:id/enrichment/match` body `{ decision }`
  - `POST /api/admin/artists/:id/enrichment/accept` body `{ field }` or `{ member }` (exactly one; both or neither -> 400)
  - `POST /api/admin/artists/:id/enrichment/accept-all`
  - `PUT /api/admin/artists/:id/enrichment/finish` body `{ finished: boolean }` (non-boolean -> 400)
  Errors map through `artistError` (CONFLICT 409, BAD_INPUT 400, NOT_FOUND 404).

- [ ] **Step 1: Write the failing tests** by running the router on a spare port the way `test/spotifyAuthRoutes.test.js` does (read it first and copy its harness): unauthenticated request -> 401 for each route; authed GET queues returns the four keys; GET review of a fixture artist; PUT match with a bad decision -> 400; accept with both `field` and `member` -> 400; accept on a locked row -> 409; finish with `"yes"` -> 400; unknown artist id -> 404.
- [ ] **Step 2: Add the privacy test** in the same file: for every file in `backend/routes/` except `admin.js`, and every file in `backend/services/` and `backend/utils/` except `services/artistEnrichment.js`, assert the source does not match `/artist_enrichment/` and does not require `artistEnrichment`. (`admin.js` may require the service; assert it does not name either table directly.)
- [ ] **Step 3: Run** `node --test test/enrichmentRoutes.test.js`. Expected: FAIL.
- [ ] **Step 4: Implement the seven routes** in `routes/admin.js` using the pattern of the facts routes.
- [ ] **Step 5: Run** the new test plus `node --test test/artists.test.js test/lyrics_privacy.test.js`. Expected: PASS. Then the full suite `cd backend && npm test`. Expected: all pass (681 before this plan plus the new ones).
- [ ] **Step 6: Commit** `feat(enrichment): admin routes and privacy test`.

---

### Task 5: Enrichment rail group and queue list

**Files:**
- Modify: `frontend/src/components/admin/ArtistsArea.jsx`, `frontend/src/components/admin/ArtistQueueList.jsx`
- Create: `frontend/src/utils/enrichmentText.js`, `frontend/src/utils/enrichmentText.test.js` (node:test, the project's pure-util pattern; read `utils/artistFactsText.js` and its test for the style)

**Interfaces:**
- Produces: `enrichmentText.js` exports `methodLabel(method) -> string` (`MB_SPOTIFY_URL` -> "Matched by your Spotify link", `WIKIDATA_P1902` -> "Matched through Wikidata", `MB_TITLE_VERIFIED` -> "Matched by title, needs your check", `EXISTING` -> "Already saved"; unknown -> "Unknown method"), `confidenceLabel(c)` (`EXACT_ID` -> "Exact", `HIGH` -> "High", else the raw text or ""), `fieldLabel(field)` (Country, Formed (year), Disbanded (year), Last release (year), Bandcamp link), `stateLabel(state)` for the five match states.
- Behaviour: `GROUPS` in `ArtistsArea.jsx` gains `['Enrichment', [['enr-review','To review'],['enr-match','Match to approve'],['enr-dupes','Possible duplicates'],['enr-done','Done']]]` placed after "Needs work"; counts come from the existing `/api/admin/artists/queues` merged with `/api/admin/enrichment/queues` (two fetches into one `counts` map). In `ArtistQueueList`, a queue key starting `enr-` fetches `/api/admin/enrichment/queue` instead of `/api/admin/artists`, and rows show chips from `r.enrichment` (the method label, "shared id" when `shared`) instead of the identity chips; navigation state (`from`, `ids`, `index`) is unchanged so Prev/Next walks the queue.

- [ ] **Step 1: Write the failing util tests** (every label above, unknown inputs, no throw on `undefined`).
- [ ] **Step 2: Run** `cd frontend && node --test src/utils/enrichmentText.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `enrichmentText.js`, then the `ArtistsArea` / `ArtistQueueList` changes.
- [ ] **Step 4: Run** the util test (PASS), `npm run lint` (0 errors; the 4 existing warnings are fine) and `npm run build`.
- [ ] **Step 5: Commit** `feat(enrichment): rail group and queue list`.

---

### Task 6: Workbench panel - match step and fact rows

**Files:**
- Create: `frontend/src/components/admin/EnrichmentPanel.jsx`
- Modify: `frontend/src/components/admin/ArtistWorkbench.jsx` (render `<EnrichmentPanel key={artist.id} artist={artist} onIdentitySaved={onIdentitySaved} onNavigateNext={...} />` in the side column ABOVE `ArtistFactsPanel`; main column unchanged)
- Modify: `frontend/src/components/admin/ArtistFactsPanel.jsx` only if it needs a `refreshKey` prop to reload after an accept (add the smallest prop, keyed on the panel's `key`)
- Modify: `frontend/src/styles/components.css` (only the few classes the panel needs, token colours only)

**Interfaces:**
- Consumes: the Task 4 routes through `api` from `./bandCheckApi` (same helper `ArtistFactsPanel` uses; it throws an Error whose message is the server's `message`); `enrichmentText.js`; `sourceLink` from `utils/factSources`.
- Behaviour: panel title "Proposed enrichment"; renders nothing when `has_proposal` is false or there is nothing to review and the artist is finished. **Match block**: state label, method and confidence, a "Check on MusicBrainz" link, the artist's own catalogue (songs, live songs, album names and years, Spotify / Bandcamp links), the `shared_with` list (each name links to `/admin/artist/<id>`) with the text "Another artist has this id; merging comes in a later update", and buttons by state: `pretrusted` -> "Approve match" (also covered by Accept all) ; `needs-approval` -> "Approve match" / "Reject match" / "Not sure" (Not sure just leaves it); `approved` or `rejected` -> a small "Undo decision" (calls `clear`). A CONFLICT error shows in the panel's error line. **Fact rows**: one row per `fields` / `members` entry showing current -> proposed, the source as a check-link (`sourceLink(source, artist)`), the confidence, any warnings for that field in the muted warning style, and Accept / Skip; Skip only hides the row locally (stores nothing, returns on reload); locked rows show "Approve the match first" and no Accept. After any accept or decision the panel reloads its review, calls `onIdentitySaved()` when identity may have changed (match approve, bandcamp accept), and the Facts panel reloads (via the key or `refreshKey`).

- [ ] **Step 1: Implement `EnrichmentPanel.jsx`** to the behaviour above (follow `ArtistFactsPanel`'s structure for `run`, error line and proposal rows).
- [ ] **Step 2: Wire** it into `ArtistWorkbench.jsx` and add the CSS classes.
- [ ] **Step 3: Verify** `npm run lint` (0 errors) and `npm run build`. The admin is login-gated: per the project's practice, review the panel in a throwaway Vite mock harness on :5199 (see memory note "Admin UI mock-harness review"; never type `ADMIN_PASSWORD`), driving a mocked response for each of the five match states and a locked row; report what was and was not seen.
- [ ] **Step 4: Commit** `feat(enrichment): workbench panel with match step and fact rows`.

---

### Task 7: Accept all, Done, next artist

**Files:**
- Modify: `frontend/src/components/admin/EnrichmentPanel.jsx`, `frontend/src/components/admin/ArtistWorkbench.jsx`

**Interfaces:**
- Consumes: Task 3 `accept-all` and `finish` routes. `ArtistWorkbench` already holds `navState` (`ids`, `index`, `from`); pass the panel an `onDone()` that goes to the next id in `navState.ids` when there is one (same call as the existing Next button), otherwise back to the queue list.
- Behaviour: a primary button **"Accept all shown, next artist"** visible when at least one row is unlocked and warning-free OR the match is pretrusted: it calls `accept-all`, then `finish` with `true`, then `onDone()`. If `accept-all` returns `skipped` entries (locked or warned), do NOT finish or navigate: show "N rows need your check" listing them, and leave the artist on screen. A separate **"Done with this artist"** button calls `finish` and `onDone()`; a finished artist shows "Reviewed" and a **"Reopen"** button (`finish false`).

- [ ] **Step 1: Implement** the three buttons and the skipped-rows message.
- [ ] **Step 2: Verify** lint, build, and the mock harness again for: a clean artist (Accept all then moves on), an artist with a warned row (stays, shows the count), a finished artist (Reopen).
- [ ] **Step 3: Commit** `feat(enrichment): accept all, done and reopen, next artist`.

---

### Task 8: Docs, live read-only check, whole-branch verification

**Files:**
- Modify: `docs/PROJECT_STATE.md` (Current State entry for piece 2: built, curator smoke steps in full, "restart the :5000 backend" and "apply migration 025 on any other environment"; Next Tasks; Changelog), `docs/PROJECT_PLAN.md` (if it lists the enrichment sessions), `CLAUDE.md` (a `services/artistEnrichment.js` bullet in the Backend Structure list, following the `artistFacts` bullet's style), `docs/PRD.md` only if its feature inventory lists admin artist features.

- [ ] **Step 1: Live read-only check** (a throwaway script in the scratchpad that loads dotenv by absolute path; it only SELECTs): `counts()` against the live DB, `getReview()` for one pretrusted artist, one HIGH artist and one of the four shared-id pairs (ids 208, 324, 3777, 32); confirm the counts are sane against the recon (803 proposals, 150 HIGH, 4 shared pairs) and that no write was made.
- [ ] **Step 2: Run** the full backend suite (`cd backend && npm test`), `cd frontend && node --test` over the utils, `npm run lint`, `npm run build`. Report exact counts.
- [ ] **Step 3: Update the docs** listed above. The curator smoke steps go in PROJECT_STATE AND in the final chat message: (1) restart :5000, apply migration 025; (2) Admin -> Artists -> Enrichment rail shows four counts; (3) open the first "Match to approve" artist: see the match block with your catalogue beside it, click the MusicBrainz link, Approve or Reject; (4) accept one fact, skip one, see the Facts panel update with the source; (5) a locked row before approval; (6) Accept all on an exact-match artist then confirm it moves on; (7) open a shared-id artist (e.g. Tenastelin, id 208) and see the notice; approving the second of a pair is refused; (8) Done / Reopen; (9) public artist page of an accepted artist shows only country / release range / members, no source.
- [ ] **Step 4: Commit** `docs: enrichment piece 2 state, plan, CLAUDE.md`. Do NOT merge; the curator says "Merge".
