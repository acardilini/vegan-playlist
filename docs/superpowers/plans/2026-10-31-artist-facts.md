# Artist facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Facts panel in the artist workbench (Fill from MusicBrainz, field-by-field accept, manual edit, members with a vegan mark) and a public artist page that shows only accepted facts, hiding every empty element.

**Architecture:** Stored facts live on `artists` (country, formed/disbanded/last-release year, each with a source label, plus a nullable Active override) and a new `artist_members` table. A new `services/artistFacts.js` owns reads, writes, the pure Active/summary logic and the MusicBrainz *proposal* diff; proposals are never stored. The MusicBrainz adapter gains `fetchFacts`. Admin routes sit under `/api/admin/artists/:id/facts*`; the public `GET /api/spotify/artists/:id` gains a `facts` block.

**Tech Stack:** Node/Express, PostgreSQL (`pg`), `node:test` run serially, React/Vite (no frontend test runner; pure utils are `node --test`-ed like `contentTokens.test.js`).

**Spec:** `docs/superpowers/specs/2026-10-31-artist-facts-design.md` (read its "Settled after the builder check" section; those rulings bind this plan).

## Global Constraints

- No LLM, no paid service, no new frontend dependency. Country names via `Intl.DisplayNames` (no package).
- MusicBrainz stays paced ~1.1 s per request through the existing adapter chain; errors are coded fixed strings (`errors.js`); nothing logs a URL, fetch error message or token.
- Fill never writes identity (`bandCheck.saveIdentity` stays the only writer of `musicbrainz_id`) and never writes to the database at all: only Accept / manual edit writes.
- Every public element hides when empty; only stored (= accepted) facts are public.
- Source labels exactly `MusicBrainz` and `Added by curator`.
- Migration is additive and idempotent (`IF NOT EXISTS`), numbered `016`, applied to the local DB with psql before tests that need it. No song row changes.
- Each new backend test file gets its own fixture sentinel (`ZZZAFA` service, `ZZZAFM` musicbrainz parse needs none, `ZZZAFR` routes if any). Frontend styling uses tokens, existing `wb-panel` / `band-chip` classes.
- Commit with explicit `git add <paths>`; message via `git commit -F`; end messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push.

## Review Focus

1. A re-fill must never delete a member or change a member's vegan mark (match by name ignoring case and diacritics; a manual member MusicBrainz lacks survives).
2. A MusicBrainz entry with no country, no begin date, no members or no qualifying releases proposes nothing for that field (no `undefined`, "Unknown" or empty rows).
3. Last-release rule: Live / Compilation / Remix / Demo release groups never count; a band whose only recent release is a live album is Inactive.
4. Override precedence: curator override beats a disbanded year and an old last release; clearing it returns to automatic.
5. The public artist response and page expose no unaccepted data and render nothing (no empty labels, stray separators or an empty summary line) for an artist with no facts.

---

### Task 1: Migration and stored facts service

**Files:**
- Create: `backend/database/migrations/016_artist_facts.sql`
- Create: `backend/services/artistFacts.js`
- Test: `backend/test/artistFacts.test.js` (sentinel `ZZZAFA`)

**Interfaces:**
- Produces (`services/artistFacts.js`):
  - `activeStatus({ lastReleaseYear, disbandedYear, override }, now = new Date()) -> { active: boolean|null, label: string|null }` — pure. Rules: override true/false wins (label `Active`/`Inactive`, with `, last release YYYY` appended, e.g. `Active, last release 2024`, when a last release year exists); else `disbandedYear` set -> Inactive; else last release year within 3 years of `now`'s year -> Active, older -> Inactive; no information -> `{ active: null, label: null }`.
  - `getFacts(db, artistId) -> { country, country_source, formed_year, formed_source, disbanded_year, disbanded_source, last_release_year, last_release_source, active_override, active: {active,label}, members: [{id, name, is_current, vegan, source}] }` (throws `coded('NOT_FOUND','Artist not found')`).
  - `saveFacts(db, artistId, patch) -> getFacts` — patch keys `country`, `formed_year`, `disbanded_year`, `last_release_year` (each a value or `null` to clear) with optional sibling `<key>_source` (`MusicBrainz` | `Added by curator`, default `Added by curator`; clearing nulls the source), and `active_override` (`true|false|null`). Validates years are integers 1900..(current year + 1) and country is a trimmed string <= 100 chars, else `coded('BAD_INPUT', ...)`.
  - `addMember(db, artistId, { name, is_current, vegan, source }) -> member`, `updateMember(db, artistId, memberId, { name?, is_current?, vegan? }) -> member`, `removeMember(db, artistId, memberId) -> { removed: true }`. Name required, <= 255; a member of another artist is `NOT_FOUND`; a name that matches an existing member (case/diacritic-insensitive) on the same artist is `CONFLICT`.
  - `nameKey(name) -> string` — lowercase, NFD-stripped diacritics, collapsed whitespace (exported; Task 3 reuses it).

- [ ] **Step 1: Write failing tests** in `backend/test/artistFacts.test.js` (fixture helper creating artists named `ZZZAFA ...`, cleanup of `artist_members` then `artists` by the sentinel, `after(pool.end)`): `activeStatus` table (override wins over disbanded and stale release; disbanded -> Inactive; release 2 years ago -> Active; 5 years ago -> Inactive; nothing -> `{active:null,label:null}`; labels `Active, last release 2024`, `Inactive, last release 2012`, `Active` alone for override with no release year); `saveFacts` round-trips a value with default source `Added by curator` and keeps `MusicBrainz` when given; `null` clears value and source; year 1850 and 3000 and `'abc'` are `BAD_INPUT`; `addMember` / duplicate name (`José` vs `jose`) `CONFLICT`; `updateMember` toggles `vegan` and `is_current`; `removeMember`; a member id belonging to another artist is `NOT_FOUND`.
- [ ] **Step 2: Run** `cd backend && node --test --test-concurrency=1 test/artistFacts.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Write the migration** `016_artist_facts.sql`: `ALTER TABLE artists ADD COLUMN IF NOT EXISTS` for `country TEXT, country_source TEXT, formed_year INTEGER, formed_source TEXT, disbanded_year INTEGER, disbanded_source TEXT, last_release_year INTEGER, last_release_source TEXT, active_override BOOLEAN`; `CREATE TABLE IF NOT EXISTS artist_members (id SERIAL PRIMARY KEY, artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE, name TEXT NOT NULL, is_current BOOLEAN NOT NULL DEFAULT true, vegan BOOLEAN NOT NULL DEFAULT false, source TEXT NOT NULL DEFAULT 'Added by curator', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)` and `CREATE INDEX IF NOT EXISTS artist_members_artist_idx ON artist_members(artist_id)`. Apply it with psql against the local DB (read `backend/.env` for the `DB_*` values; do not print them).
- [ ] **Step 4: Implement `services/artistFacts.js`** to the Interfaces above. Uniqueness of member names is enforced in code with `nameKey`, not in SQL.
- [ ] **Step 5: Run the test file again.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(artist-facts): migration 016 and stored facts service`.

---

### Task 2: MusicBrainz fetchFacts

**Files:**
- Modify: `backend/services/bandCheck/musicbrainz.js` (add `fetchFacts`, export it from the adapter object)
- Create: `backend/services/bandCheck/musicbrainzFacts.js` (pure parsing)
- Test: `backend/test/musicbrainzFacts.test.js` (no DB; injected `fetch`)

**Interfaces:**
- Consumes: the adapter's paced `get(path)` and `UUID` check.
- Produces:
  - `parseFacts(artistJson, releaseGroups) -> { name, country, formed_year, disbanded_year, last_release_year, members: [{ name, is_current }] }` (pure, in `musicbrainzFacts.js`). `country` is an English name from `artistJson.country` (ISO-3166 alpha-2) via `new Intl.DisplayNames(['en'], { type: 'region' })`, or `null` (unknown code, `XW`/`XE`-style codes and absent -> `null`). `formed_year` = year of `life-span.begin` when present, else `null`. `disbanded_year` = year of `life-span.end` only when `life-span.ended === true`. `last_release_year` = max year of `first-release-date` over release groups whose `primary-type` is Album, EP or Single and whose `secondary-types` contain none of Live, Compilation, Remix, Demo; `null` if none. `members`: relations of `type === 'member of band'` with `direction === 'backward'`, name from `relation.artist.name`, `is_current = !relation.ended && !relation['end']`; live/touring excluded when the relation `attributes` contain `live` or `touring`; de-duplicated by name keeping a current entry over a past one.
  - `adapter.fetchFacts(mbid) -> parseFacts(...)` result. Reads `/artist/{mbid}?inc=artist-rels&fmt=json` once and `/release-group?artist={mbid}&type=album|ep|single&limit=100&offset=N&fmt=json` paged (max 5 pages, stop when a page is short). Non-UUID `mbid` throws `coded('NOT_FOUND')`.

- [ ] **Step 1: Write failing tests**: `parseFacts` with a fixture artist (country `DE`, life-span begin `2009-03`, no end) -> `country 'Germany'`, `formed_year 2009`, `disbanded_year null`; `ended:true` with end `2016-05-01` -> `2016`; `ended:false` with an end date present -> `null`; no `country`/no begin -> `null`s; release groups [Album 2019, Album+Live 2024, Single 2021 with `Remix`, EP 2022] -> `2022`; only live/compilation -> `null`; members: current/past, live-attribute relation skipped, duplicate name keeps current. `fetchFacts` with an injected `fetch`/`sleep`/`now` issues the artist call then the release-group call(s) paced by `gapMs`, and a 503 maps to a coded error whose message is a fixed string (no URL in it).
- [ ] **Step 2: Run** `node --test --test-concurrency=1 test/musicbrainzFacts.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `musicbrainzFacts.js` and `fetchFacts` per Interfaces.
- [ ] **Step 4: Run it plus `test/bandCheckMusicbrainz*.test.js`** (existing adapter tests). Expected: PASS.
- [ ] **Step 5: Commit** `feat(artist-facts): MusicBrainz fetchFacts`.

---

### Task 3: Proposals (Fill from MusicBrainz)

**Files:**
- Modify: `backend/services/artistFacts.js` (add `proposeFromMusicBrainz`)
- Test: `backend/test/artistFacts.test.js` (append; same sentinel)

**Interfaces:**
- Consumes: `getFacts`, `nameKey`, and `adapters.musicbrainz.fetchFacts` (injected).
- Produces: `proposeFromMusicBrainz(db, artistId, { adapters }) -> { musicbrainz: { name }, fields: [{ field, current, proposed, source: 'MusicBrainz' }], members: [{ name, is_current, change: 'new'|'status', existing: { id, is_current, vegan } | null }] }`.
  - Throws `coded('NO_IDENTITY', 'Set a MusicBrainz link under Links first')` when the artist has no `musicbrainz_id`.
  - `fields` covers `country`, `formed_year`, `disbanded_year`, `last_release_year`; a field is listed only when MusicBrainz has a value **and** it differs from the stored value (equal or absent -> not listed). `current` is the stored value or `null`.
  - `members`: for each MusicBrainz member, match stored members by `nameKey`; no match -> `change:'new'`; match whose `is_current` differs -> `change:'status'`; identical -> omitted. Stored members absent from MusicBrainz are never mentioned. Nothing is written.

- [ ] **Step 1: Write failing tests** with a stub adapter `{ musicbrainz: { fetchFacts: async () => ... } }`: no MusicBrainz id -> `NO_IDENTITY`; fresh artist gets all four fields listed with `current: null`; an equal stored value is omitted; a hand-typed differing value is listed with both `current` and `proposed` (and nothing is written: re-read `getFacts` unchanged); MusicBrainz with no country/begin/members/qualifying releases lists none of them (Review Focus 2); members: `José` stored (vegan) and MusicBrainz proposes `jose` current-matching -> omitted; stored current, MusicBrainz past -> `change:'status'` with `existing.vegan === true`; unseen name -> `'new'`; a stored manual member absent from MusicBrainz still present in `getFacts` after calling propose (Review Focus 1).
- [ ] **Step 2: Run the file.** Expected: FAIL (function missing).
- [ ] **Step 3: Implement `proposeFromMusicBrainz`.**
- [ ] **Step 4: Run the file.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(artist-facts): proposals from MusicBrainz`.

---

### Task 4: Routes and the public facts block

**Files:**
- Modify: `backend/routes/admin.js` (Artists area section), `backend/routes/spotify.js` (`GET /artists/:id`)
- Modify: `backend/services/artistFacts.js` (add `publicFacts`)
- Test: `backend/test/artistFacts.test.js` (append `publicFacts` tests)

**Interfaces:**
- Produces:
  - `publicFacts(db, artistId) -> { country, formed_year, active_label, members: [{ name, is_current, vegan }] } | null`: only non-empty parts present; `null` when nothing at all (so the page can skip every element); `active_label` from `activeStatus` (null omitted); members ordered current first then name; no source labels, ids or overrides in it.
  - Admin (all behind the existing `X-Admin-Password` router; fixed-string coded errors mapped like the Artists routes: NOT_FOUND 404, BAD_INPUT 400, CONFLICT 409, NO_IDENTITY 409, RATE_LIMITED 429, UPSTREAM/UNREADABLE 502): `GET /api/admin/artists/:id/facts` -> `getFacts`; `PUT /api/admin/artists/:id/facts` -> `saveFacts(body)`; `GET /api/admin/artists/:id/facts/proposals` -> `proposeFromMusicBrainz` with the shared `bandAdapters`; `POST /api/admin/artists/:id/facts/members`, `PUT .../members/:memberId`, `DELETE .../members/:memberId`. Non-numeric ids are 400.
  - Public: `GET /api/spotify/artists/:id` response gains `facts: publicFacts(...)` (the key is present, possibly `null`); no other change.

- [ ] **Step 1: Write failing tests** for `publicFacts`: empty artist -> `null`; only a country -> `{country:'X'}` with no other keys; formed + stale release -> `active_label 'Inactive, last release 2012'`; members sorted current-first; the object has no `*_source`, `id` or `active_override` keys; a live-album-only recent release leaves the band Inactive via `last_release_year` rules (Review Focus 3, using stored values).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `publicFacts` and the routes** (follow the surrounding route style in the Artists section; reuse `bandAdapters`; the proposals route is a GET that performs network reads and never writes).
- [ ] **Step 4: Run the full backend suite**, then start a spare backend instance on a free port (never touch :5000) and check with curl: unauthenticated -> 401, bad id -> 400, unknown artist -> 404, an unauthenticated public `GET /api/spotify/artists/<live id>` includes `facts` (null or object) and no source/override keys. Stop the instance by PID.
- [ ] **Step 5: Commit** `feat(artist-facts): admin routes and public facts block`.

---

### Task 5: Facts panel in the artist workbench

**Files:**
- Create: `frontend/src/components/admin/ArtistFactsPanel.jsx`
- Modify: `frontend/src/components/admin/ArtistWorkbench.jsx` (render the panel in the side column under Links), `frontend/src/styles/admin.css`

**Interfaces:**
- Consumes: Task 4 admin routes through `adminFetch`; `artist.musicbrainz_id` from the workbench artist; `onNeedIdentity('musicbrainz')` (the same callback the Catalogue panel gets) when there is no link.
- Produces: `<ArtistFactsPanel artist={...} onNeedIdentity={...} />`, self-contained (loads and saves its own facts).

- [ ] **Step 1: Build the panel.** Sections in one `wb-panel` titled Facts:
  - **Stored facts**: country, formed, disbanded, last release (year), each an editable field (existing `SavedField`/`AutoText` pattern where it fits, otherwise a small input + Save) with a small source caption (`MusicBrainz` / `Added by curator`); clearing is allowed. An **Active** line showing the automatic label with a three-way control `Automatic · Active · Not active` writing `active_override` (`null` for Automatic).
  - **Members**: a list with name, a current/past toggle, a **vegan** toggle rendered as a circled **V** chip, and remove; an Add member input.
  - **Fill from MusicBrainz** button (disabled while loading). With no MusicBrainz link it is replaced by the note "Set a MusicBrainz link under Links to fill facts" plus a button calling `onNeedIdentity('musicbrainz')`. On success it shows "Read MusicBrainz artist: <name>" and the proposal rows: for each field a row `current -> proposed` (or just `proposed` when none) with **Accept** (PUT `{ field, <field>_source: 'MusicBrainz' }`) and **Skip** (local only, nothing stored); for each member a row (`new` / `now past` / `now current`) with **Accept** (POST member with source `MusicBrainz`, or PUT `is_current` for `status`; never touches `vegan`) and **Skip**. Accepted rows leave the proposal list; "nothing new" when the list is empty; errors show the server's fixed message.
- [ ] **Step 2: Wire into `ArtistWorkbench`** and add the few CSS classes (tokens only, reuse `band-chip`; the V chip styled with `--accent-moss-*` like `.lyr-ok`).
- [ ] **Step 3: Verify.** `cd frontend && npm run lint && npm run build` (0 errors). Then check the panel in headless Chrome through a throwaway mock harness outside the repo (stub `adminFetch`; see how the previous Catalogue harness in the scratchpad did it): stored facts render with sources; a proposal Accept sends the expected PUT; Skip sends nothing; Automatic/Active/Not active send `active_override` `null/true/false`; no-link state shows the note. Do not type `ADMIN_PASSWORD`.
- [ ] **Step 4: Commit** `feat(artist-facts): Facts panel in the artist workbench`.

---

### Task 6: Public artist page

**Files:**
- Create: `frontend/src/utils/artistFactsText.js`, `frontend/src/utils/artistFactsText.test.js`
- Modify: `frontend/src/components/ArtistDetailPage.jsx`, `frontend/src/styles/components.css` (or the stylesheet the page already uses)

**Interfaces:**
- Produces (pure, DOM-free): `summaryLine(facts) -> string|null` joining, with ` · `, only the parts that exist: `country`, `Formed <year>` , `active_label`; `null` when none or when `facts` is null/undefined. `memberList(facts) -> [{ name, vegan }]` (empty array when none).

- [ ] **Step 1: Write failing `node --test` tests** (run as `node --test src/utils/artistFactsText.test.js` from `frontend/`): all three parts -> `Germany · Formed 2009 · Active, last release 2024`; country only -> `Germany`; formed only -> `Formed 2009`; label only; `null`/`{}` -> `null`; no stray separators or `undefined` text in any combination; `memberList(null)` -> `[]`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement the util.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Render on the page.** In `ArtistDetailPage.jsx`, show `summaryLine(artist.facts)` as one muted line under the artist name only when non-null; after the Biography section add a **Members** line (a plain `<section className="detail-section">` with the names comma-separated, a small green circled **V** after each vegan member, a screen-reader label `vegan`) only when `memberList` is non-empty. Past members are shown after current ones, marked "(former)". Nothing renders for an artist with no facts (Review Focus 5).
- [ ] **Step 6: Verify.** Lint and build clean; open the public artist page in headless Chrome against a mock `facts` (full, partial, null) and screenshot: full shows the summary line and Members line with V marks; partial hides the missing parts with no stray `·`; null shows neither.
- [ ] **Step 7: Commit** `feat(artist-facts): facts on the public artist page`.

---

### Task 7: Real-data check and docs

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `CLAUDE.md`, `docs/PRD.md` (feature inventory line if it lists artist page content)

- [ ] **Step 1: Live read-only check** with a scratchpad script that loads `backend/.env` by absolute path: pick 3 artists with a confirmed `musicbrainz_id`, call `proposeFromMusicBrainz` with the real adapter, print only counts and field names (never members' names or MusicBrainz URLs), and confirm `artists` facts columns and `artist_members` row counts are unchanged afterwards.
- [ ] **Step 2: Full verification**: `cd backend && node --test --test-concurrency=1` all pass; `cd ../frontend && npm run lint && npm run build` clean.
- [ ] **Step 3: Update docs** per the End-Session Guide: state (what changed, the rulings from the design's "Settled" section, migration 016 must be applied on any other environment, restart the backend), Changelog entry, `CLAUDE.md` architecture lines (`services/artistFacts.js`, `musicbrainzFacts.js`, the facts routes, the panel, the public `facts` block), and the curator smoke checklist: open an artist with a MusicBrainz link -> Fill -> Accept a few, Skip one -> type a country by hand -> toggle a member vegan -> set Active override -> open the public artist page (summary line + Members line with V) -> clear everything and confirm the page hides it all -> re-Fill and confirm hand-typed values show current beside proposed.
- [ ] **Step 4: Commit** `docs: artist facts built, state updated` (do not push; the branch stays for the curator's smoke).
