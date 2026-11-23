# Artist enrichment, piece 1: provenance and published-work range - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Artist facts carry more provenance sources with admin check-links, the Active/Inactive indicator is removed, and a new first-release year gives the public artist page a "Released 1996-2024" range of published work.

**Architecture:** `artistFacts.js` changes in place (allow-list, new `first_release_year` fact, `activeStatus` removed); the MusicBrainz parse and the existing "Fill from MusicBrainz" proposal also propose the first release; a tiny pure frontend helper builds a check-link from a source name and the artist's stored ids; `ArtistFactsPanel.jsx` and `summaryLine` follow. One small migration. Pieces 2 (match and facts review) and 3 (artist merge) are separate plans.

**Tech Stack:** Node/Express, PostgreSQL, `node:test`, React (Vite), plain-ESM frontend utils tested with `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-23-artist-enrichment-design.md` (section "Piece 1", as amended by the curator on 2026-11-23: no Active/Inactive, a range of published work instead)

## Global Constraints

- `SOURCES` becomes exactly: `MusicBrainz`, `Wikidata`, `Bandcamp`, `Catalogue Albums`, `Gemini Web Search`, `Added by curator` (exact, case-sensitive). Existing stored values stay valid.
- **No Active/Inactive indicator anywhere.** `activeStatus`, `facts.active`, the public `active_label` and the Active override buttons are removed. The `artists.active_override` column stays in the database, unused (no destructive migration; drop later if wanted). Extra keys in a `saveFacts` patch (including `active_override`) are ignored.
- Migration `024_artist_first_release.sql`: `ALTER TABLE artists ADD COLUMN IF NOT EXISTS first_release_year INTEGER, ADD COLUMN IF NOT EXISTS first_release_source TEXT;` Additive, no backfill.
- `first_release_year` is validated like the other years (whole number 1900 to next year), source from `SOURCES` (default `Added by curator`), `null` clears the year and its source. No cross-check against last release on save.
- MusicBrainz: first release = the earliest `first-release-date` year among Album/EP/Single release groups excluding secondary types Live/Compilation/Remix/Demo (the same filter `lastReleaseYear` uses); null when none.
- Public `artist.facts` (via `publicFacts`) carries `country`, `formed_year`, `first_release_year`, `last_release_year`, `members` (each only when present); no sources, ids or override. `disbanded_year` stays stored and admin-only (not public).
- Public summary line `summaryLine(facts)`: parts in order `country`, `Formed <y>`, then the range: both years -> `Released <first>–<last>` (en dash U+2013); both equal -> `Released <y>`; only last -> `Last release <y>`; only first -> `First release <y>`; if first > last treat only last as known. Parts join with ` · ` (middle dot). Nothing prints for an absent part.
- Check-links in admin only: `MusicBrainz` -> `https://musicbrainz.org/artist/<musicbrainz_id>` (only a UUID id); `Bandcamp` -> the artist's `bandcamp_url` (only when it starts with `http://` or `https://`); other sources -> no link. Links open in a new tab with `rel="noopener noreferrer"`.
- Test sentinel for fixture artists: reuse `artistFacts.test.js`'s existing one. Frontend tests: `node --test src/utils/*.test.js`.
- Work on branch `session-enrichment-provenance` from `main`. `git add` explicit paths only (`backend/docs/` and `docs/examples/` stay untracked). Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; write them to a scratchpad file and use `git commit -F`.

## Review Focus

- Songs-of-one-year bands: first and last release equal prints `Released 1999`, not `1999-1999`.
- Only one of the two years known prints `Last release` / `First release`, never a dangling dash.
- A stored first year later than the last year does not print a backwards range.
- A near-miss source string (`musicbrainz`, `MusicBrainz ` with a space) is rejected, not accepted.
- Clearing a fact (`null`) also clears its source, including the new first-release source.
- A `bandcamp_url` that is not http(s) (for example `javascript:...`) or a `musicbrainz_id` that is not a UUID produces no link.
- The public payload no longer has `active_label`, and `publicFacts` is `null` for an artist with nothing stored.

---

### Task 1: Migration, `SOURCES`, first-release fact, Active removed

**Files:**
- Create: `backend/database/migrations/024_artist_first_release.sql`
- Modify: `backend/services/artistFacts.js` (`SOURCES` L6, `YEAR_FIELDS` L8, `activeStatus` L12-20, `COLS` L22-23, `getFacts` L26-35, `saveFacts` L65-68, `proposeFromMusicBrainz` L129, `publicFacts` L146-154, exports L156; header comment L1-2)
- Test: `backend/test/artistFacts.test.js`

**Interfaces:**
- Produces: `SOURCE_NAMES` (frozen array of the six strings, exported); `getFacts(db, id)` returns the stored columns including `first_release_year`, `first_release_source` and `members`, and **no** `active` / `active_override`; `saveFacts` accepts `first_release_year` (+ optional `first_release_source`); `publicFacts` per Global Constraints.
- Removes: `activeStatus` and its export.

- [ ] **Step 1: Branch and migration.** `git checkout -b session-enrichment-provenance`. Write `024_artist_first_release.sql` as in Global Constraints (header comment: why). Apply it to the dev database (scratchpad node script that loads dotenv by absolute path from `backend/.env`, as for migration 023) and confirm the two columns exist.
- [ ] **Step 2: Write the failing tests** in `artistFacts.test.js`:
  - Delete the four `activeStatus` tests; delete the `active_override` assertions in the save/clear test (L41-44) and the `active_label` / override expectations in the two `publicFacts` tests (L129, L135-142), rewriting them for the new payload: after saving `formed_year: 1999, first_release_year: 1994, last_release_year: 2012, last_release_source: 'MusicBrainz'` and two members, `publicFacts` deep-equals `{ formed_year: 1999, first_release_year: 1994, last_release_year: 2012, members: [...] }` (same member shape as today); an artist with nothing stored returns `null`; no key named `active_label`.
  - New `saveFacts stores the first release with its source and clears both`: save `first_release_year: 1996, first_release_source: 'Bandcamp'` -> both stored; save `first_release_year: null` -> `first_release_year === null` and `first_release_source === null`; `first_release_year: 1850` and `2999` reject `BAD_INPUT`.
  - New `saveFacts and addMember accept every named source`: for each name in `svc.SOURCE_NAMES` (length 6) save `country: 'Germany', country_source: name` and `addMember(pool, id, { name: 'ZZZAFA M-' + i, source: name })`.
  - New `unknown or near-miss sources are rejected`: `country_source` of `'musicbrainz'`, `'MusicBrainz '`, `'Spotify'`, `''` and `first_release_source: 'Spotify'` each reject `BAD_INPUT`, leaving the stored values unchanged; `addMember` with `source: 'musicbrainz'` rejects.
  - New `getFacts has no Active fields`: `'active' in facts` and `'active_override' in facts` are both false; passing `active_override: true` to `saveFacts` changes nothing and does not throw.
- [ ] **Step 3: Run** `cd backend && node --test test/artistFacts.test.js` — Expected: FAIL (missing column writes, `SOURCE_NAMES` undefined, `active` still present).
- [ ] **Step 4: Implement** in `artistFacts.js` per the Interfaces block and Global Constraints (add `first_release_year` to `YEAR_FIELDS` and `COLS`, add `first_release_year` to the `proposeFromMusicBrainz` field loop, drop `active_override` from `COLS` and `saveFacts`, delete `activeStatus`, rewrite `publicFacts`, update the header comment).
- [ ] **Step 5: Run** `node --test test/artistFacts.test.js` — Expected: PASS.
- [ ] **Step 6: Commit** the migration, `artistFacts.js` and its test.

### Task 2: MusicBrainz proposes the first release

**Files:**
- Modify: `backend/services/bandCheck/musicbrainzFacts.js` (add `firstReleaseYear`, call it in `parseFacts`)
- Test: `backend/test/musicbrainzFacts.test.js`, `backend/test/artistFacts.test.js` (the stub's default facts and the proposal test)

**Interfaces:**
- Produces: `parseFacts(artist, groups)` now also returns `first_release_year: number|null`; `fetchFacts` results therefore carry it, and `proposeFromMusicBrainz` lists a `first_release_year` row (`{ field, current, proposed, source: 'MusicBrainz' }`) when it differs from stored.

- [ ] **Step 1: Write the failing tests:** in `musicbrainzFacts.test.js`, with the file's existing `rg(type, date, secondary)` helper: the earliest of several qualifying groups wins (`['Album','1996'], ['EP','1994'], ['Single','2010']` -> 1994); a group excluded by type or secondary type (a `Live` 1990 album, a `Compilation`) is ignored (-> next earliest); no qualifying group or an empty date -> `null`; the existing fixture expectations (`L13`, `L22`, `L54`, `L77`) gain the new field. In `artistFacts.test.js` extend the stub's default object with `first_release_year: null` and add `first_release_year: 1994` to the proposal test's input, expecting the extra `['first_release_year', null, 1994, 'MusicBrainz']` row in the existing order (country, formed, disbanded, first, last — adjust the order of the expected list to the `YEAR_FIELDS` order the implementation uses and keep the test deterministic).
- [ ] **Step 2: Run** `node --test test/musicbrainzFacts.test.js test/artistFacts.test.js` — Expected: FAIL (`first_release_year` undefined).
- [ ] **Step 3: Implement** `firstReleaseYear(groups)` beside `lastReleaseYear` (same filter; minimum instead of maximum) and add it to `parseFacts`.
- [ ] **Step 4: Run** both files — Expected: PASS.
- [ ] **Step 5: Commit** the three files.

### Task 3: Public range line, admin panel, check-links

**Files:**
- Modify: `frontend/src/utils/artistFactsText.js` (`summaryLine`), `frontend/src/utils/artistFactsText.test.js`
- Create: `frontend/src/utils/factSources.js`, `frontend/src/utils/factSources.test.js`
- Modify: `frontend/src/components/admin/ArtistFactsPanel.jsx`

**Interfaces:**
- Produces: `summaryLine(facts)` per Global Constraints (input keys `country`, `formed_year`, `first_release_year`, `last_release_year`); `sourceLink(source: string, artist: { musicbrainz_id?: string|null, bandcamp_url?: string|null }) -> string|null`.
- Consumes: the `artist` prop `ArtistFactsPanel` already receives (it already reads `artist.musicbrainz_id`). The builder checks that the admin artist payload also carries `bandcamp_url` (the artists table has the column) and only if not adds it to the existing `services/artists.js` read.

- [ ] **Step 1: Write the failing tests.** `artistFactsText.test.js`: replace the `active_label` expectations: `{country:'Germany', formed_year:2009, first_release_year:1996, last_release_year:2024}` -> `'Germany · Formed 2009 · Released 1996–2024'`; equal years -> `'Released 1999'`; only last -> `'Last release 2024'`; only first -> `'First release 1996'`; first 2030 and last 2010 -> `'Last release 2010'`; `{country:'Germany'}` -> `'Germany'`; nothing -> `null`; a `formed_year: undefined, ...: null` input never prints `undefined` or `null`. `factSources.test.js`: MusicBrainz with a UUID id -> the musicbrainz.org url; missing or `'not-a-uuid'` id -> `null`; Bandcamp with `https://band.bandcamp.com` -> that url, with `'javascript:alert(1)'`, `'band.bandcamp.com'` or missing -> `null`; `Wikidata`, `Catalogue Albums`, `Gemini Web Search`, `Added by curator`, `undefined` -> `null`.
- [ ] **Step 2: Run** `cd frontend && node --test src/utils/artistFactsText.test.js src/utils/factSources.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `summaryLine` and `sourceLink` per Global Constraints (UUID regex case-insensitive; Bandcamp must match `^https?://`).
- [ ] **Step 4: Update `ArtistFactsPanel.jsx`:** add `{ key: 'first_release_year', label: 'First release (year)', year: true }` to `FIELDS` before Last release; delete the Active block (`setOverride`, `override`, the `fact-active` / `fact-seg` markup); add a `FactSource({ source, artist })` component that renders the source as an `<a target="_blank" rel="noopener noreferrer">` when `sourceLink` returns a url, plain text otherwise, and use it for the field source (L73) and the member source (L98), keeping the `band-meta fact-source` classes. Remove the now-unused CSS only if nothing else uses it (`fact-active`, `fact-seg`: grep first).
- [ ] **Step 5: Verify:** `node --test src/utils/*.test.js` (all pass; record the count), `npm run lint` (0 errors; 4 pre-existing warnings), `npm run build` (clean).
- [ ] **Step 6: Commit** the frontend files (and `services/artists.js` only if Step 4's check required it).

### Task 4: Whole-piece check and docs

- [ ] **Step 1: Full backend suite**, serial: `cd backend && node --test --test-concurrency=1` — Expected: all pass (record N/N; baseline before this piece is 681).
- [ ] **Step 2: Read-only data check** (scratchpad script, dotenv by absolute path): how many artists have a non-null `active_override`, a stored `disbanded_year`, or any stored fact (so the curator knows what the removal and new field touch). Report the numbers; change nothing.
- [ ] **Step 3: Docs.** `docs/PROJECT_STATE.md` (Current State entry with the smoke steps below, Changelog entry, mark piece 1 built, and a **note for the analysis project**: stage `proposed_first_release_year` with `first_release_source` and confidence, using the same release-group filter as last release); `CLAUDE.md`'s `services/artistFacts.js` paragraph (sources list; `first_release_year`; Active removed and `active_override` dormant; check-links admin-only; `summaryLine` range wording; migration 024 must be applied elsewhere); 
- [ ] **Step 4: Smoke steps for the curator (write them in chat, not just a pointer):** (1) Open an artist with stored facts -> Facts panel: the Active line and buttons are gone; a MusicBrainz source is a link that opens the right MusicBrainz page in a new tab; Bandcamp likewise; "Added by curator" is plain text. (2) Type a First release year and a Last release year: the public artist page line reads `... · Released 1996–2024`; same year -> `Released 1999`; clear First -> `Last release 2024`. (3) On an artist with a MusicBrainz link press Fill from MusicBrainz: a First release row can appear beside Last release. (4) The public page shows no source or link, and no Active text. (5) Type a first year later than the last year: the public line shows only the last release.
- [ ] **Step 5: Commit and push the branch; wait for the curator's "Merge".**
