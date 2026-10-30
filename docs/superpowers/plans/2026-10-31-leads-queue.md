# Leads queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A top-level admin "Leads" tab where the curator captures a band in seconds (name + Enter), is reminded by a count, and later promotes a lead into an artist workbench; duplicates and dismissed bands are handled.

**Architecture:** A new `leads` table and `services/leads.js` (capture, list with live "already an artist" match, status changes, Promote in one transaction). Admin routes under `/api/admin/leads*`. A new `Leads` page at `/admin/leads`, a nav entry whose label carries the To-look-into count, and one Dashboard tile.

**Tech Stack:** Node/Express, PostgreSQL (`pg`), `node:test` run serially, React/Vite (no frontend test runner; verify by lint, build and headless Chrome through a throwaway mock harness).

**Spec:** `docs/superpowers/specs/2026-10-31-leads-queue-design.md` (read its "Settled after the builder check" section; those rulings bind this plan).

## Global Constraints

- Free and local: no external call, no LLM, no new frontend dependency. Admin routes use the existing `X-Admin-Password` router and `adminFetch`/`api` helpers.
- Migration `017_leads.sql` is additive and idempotent; it creates only the `leads` table (no change to `artists`, `songs` or any existing table). Apply it to the local DB with the scratchpad `migrate.js` pattern (psql is not on PATH; load `backend/.env` by absolute path; never print credentials).
- A lead is never returned by any public route. Names, notes and songs are plain text shown as text; the link must be http(s).
- Limits: name 255, note 1000, song 255, link 500, `origin` <= 30 characters (default `manual`). Errors are coded with fixed messages (`coded` from `services/bandCheck/errors`); nothing logs a note or link.
- Name key: lowercase, diacritics folded (NFD), a leading `the ` dropped, every non-alphanumeric run turned into one space, trimmed; an empty key is `BAD_INPUT`.
- Test sentinel for new backend test files: `ZZZLEA` (names start `ZZZLEA`). Clean `leads` rows by that prefix, then artists by that prefix.
- Frontend uses design tokens and existing admin classes (`wb-panel`, `band-chip`, `queue-empty`, `admin-message`); no raw colours.
- Commit with explicit `git add <paths>`; message via `git commit -F` ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push. Work on branch `session-leads-queue`.

## Review Focus

1. Duplicate capture: the same band in a different case/diacritics/punctuation/"The" form never makes a second lead; a dismissed or Checked lead blocks a re-add and says so; an existing artist is reported, not duplicated.
2. Promote never creates a second artist for a band that already exists, is atomic (a failure leaves no half-promoted lead), never overwrites the artist's Notes, and adds its Notes line only once.
3. Deleting a promoted artist later leaves the lead intact (`artist_id` goes null) and the lead can still be restored.
4. A lead (and its note/link/song text) is invisible to every public route and never counts toward song or artist totals.
5. Quick capture stays quick: Enter adds, the box clears and keeps focus, the optional row is optional, and an empty or whitespace-only name never creates a row.

---

### Task 1: Migration and capture service

**Files:**
- Create: `backend/database/migrations/017_leads.sql`
- Create: `backend/services/leads.js`
- Test: `backend/test/leads.test.js` (sentinel `ZZZLEA`)

**Interfaces:**
- Produces (`services/leads.js`):
  - `leadKey(name) -> string` — the name key above (exported).
  - `addLead(db, { name, note, song, url, origin }) -> { status: 'added', lead } | { status: 'duplicate', kind: 'lead', lead } | { status: 'duplicate', kind: 'artist', artist: { id, name } }`. Validates and trims (BAD_INPUT: empty key, over-length, `url` not http(s), `origin` empty or > 30). Duplicate order: an existing lead with the same key in **any** status is reported first (`kind: 'lead'`, with its `status` and `dismissed_at` if dismissed), else an existing artist with the same key (`kind: 'artist'`); nothing is inserted on a duplicate. Artist matching loads `artists.id, name` and compares keys in JS.
  - `listLeads(db, { status = 'new' } = {}) -> { leads: [...], counts: { new, checked, dismissed } }`; `status` is one of `new | checked | dismissed | all`, else BAD_INPUT. Each lead: `{ id, name, note, song, url, origin, status, created_at, dismissed_at, artist_id, artist_match: { id, name } | null }` where `artist_match` is computed live (key match against `artists.name`, or the lead's own `artist_id` row when set). Newest first.
  - `updateLead(db, id, patch) -> lead` — patch keys `note`, `song`, `url` (same validation; `null`/empty clears), `status` (`new|checked|dismissed`; setting `dismissed` stamps `dismissed_at`, any other status clears it). `NOT_FOUND` for an unknown id.
  - `deleteLead(db, id) -> { removed: true }` (`NOT_FOUND` when absent).
  - Status values stored: `new`, `checked`, `dismissed`.

- [ ] **Step 1: Write failing tests** (`leads.test.js`; helper `mkArtist(name)` inserting `data_source='manual'`; cleanup deletes `leads` where `name LIKE 'ZZZLEA%'`, then artists): `leadKey` table (`'  The  ZZZLEA Bånd! '` and `'zzzlea band'` equal; `'The'` alone and `'***'` give an empty key); `addLead` adds with defaults (`status 'new'`, `origin 'manual'`) and trims; whitespace-only name, over-length name/note, `url: 'ftp://x'` and a 31-character origin are `BAD_INPUT`; the same band in another case/diacritics/"The"/punctuation form is `duplicate kind 'lead'` and inserts nothing (Review Focus 1); a **dismissed** lead and a **checked** lead each block a re-add and the result carries the lead's status; a name matching an existing artist is `duplicate kind 'artist'` with its id and inserts nothing; `listLeads` default returns only `new`, `counts` cover all three statuses, newest first, and a lead whose name matches an artist has `artist_match` set live (create the artist after the lead); `updateLead` sets note/song/url, clears with `null`, moves status and stamps/clears `dismissed_at`, unknown id is `NOT_FOUND`; `deleteLead` removes.
- [ ] **Step 2: Run** `cd backend && node --test --test-concurrency=1 test/leads.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Write the migration:** `CREATE TABLE IF NOT EXISTS leads (id SERIAL PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL, note TEXT, song TEXT, url TEXT, origin TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','checked','dismissed')), dismissed_at TIMESTAMP, artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)` plus `CREATE INDEX IF NOT EXISTS leads_name_key_idx ON leads(name_key)` and `leads_status_idx ON leads(status)`. Apply it to the local DB and confirm the table exists.
- [ ] **Step 4: Implement `services/leads.js`** to the Interfaces above (store `name_key` on insert).
- [ ] **Step 5: Run the test file.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(leads): migration 017 and capture service`.

---

### Task 2: Promote

**Files:**
- Modify: `backend/services/leads.js` (add `promoteLead`)
- Test: `backend/test/leads.test.js` (append; same sentinel)

**Interfaces:**
- Consumes: `leadKey`, the `leads` table.
- Produces: `promoteLead(db, id, { now = new Date() } = {}) -> { artistId, created: boolean, lead }`. In one transaction (`db.connect()` client, `BEGIN/COMMIT/ROLLBACK`, always released): lock the lead row (`FOR UPDATE`; `NOT_FOUND` if absent); if the lead already has `artist_id` set and that artist exists, return `{ artistId, created: false }` with **no** Notes change; otherwise find an artist whose `leadKey(name)` equals the lead's key (load `id, name, discography_review_notes`) or insert `artists (name, data_source) VALUES ($1,'manual')`; append one line to that artist's `discography_review_notes` (separated from existing text by a newline, never replacing it): `Lead (YYYY-MM-DD): <note> · song: <song> · <url>` with only the parts present (just `Lead (YYYY-MM-DD)` when the lead has none); set the lead `status='checked'`, `artist_id`, `dismissed_at=NULL`.

- [ ] **Step 1: Write failing tests:** promoting a lead with no matching artist creates a `manual` artist with the lead's name, appends the line (exact text with date `2026-10-31` via `now`), marks the lead checked with `artist_id` (`created: true`); promoting when a same-key artist already exists (different case/"The") uses it, creates no second artist (count artists by key stays 1) and **appends** to existing Notes without removing the existing text (Review Focus 2); a second `promoteLead` of the same lead returns `created: false` and does not add a second Notes line; a lead with no note/song/url appends just the dated stub; a failure inside the transaction rolls back (stub `db.connect` returning a client whose Notes `UPDATE` throws: no artist row created, lead still `new`) ; deleting the promoted artist leaves the lead with `artist_id NULL` and `restore` via `updateLead({status:'new'})` works (Review Focus 3); unknown id is `NOT_FOUND`.
- [ ] **Step 2: Run the file.** Expected: FAIL (`promoteLead` missing).
- [ ] **Step 3: Implement `promoteLead`** per Interfaces.
- [ ] **Step 4: Run the file.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(leads): promote a lead into an artist`.

---

### Task 3: Admin routes

**Files:**
- Modify: `backend/routes/admin.js` (new "Leads" section after the Artists facts routes)
- Test: `backend/test/leads.test.js` (route-level checks are done by curl in Step 3; add a service test that proves leads are absent from public data, below)

**Interfaces:**
- Produces (all behind the router's `X-Admin-Password`, fixed-string coded errors mapped like the Artists routes: BAD_INPUT 400, NOT_FOUND 404, otherwise a logged-code 500):
  - `GET /api/admin/leads?status=new|checked|dismissed|all` -> `listLeads`
  - `POST /api/admin/leads` body `{ name, note?, song?, url? }` -> `addLead` with `origin: 'manual'` (status 201 for `added`, 200 for `duplicate`; the body is the service result)
  - `PUT /api/admin/leads/:id` -> `updateLead`
  - `POST /api/admin/leads/:id/promote` -> `promoteLead`
  - `DELETE /api/admin/leads/:id` -> `deleteLead`
  Non-numeric ids are `NOT_FOUND` (the existing `artistId` helper pattern).

- [ ] **Step 1: Add a test** that creates a lead and asserts public reads do not see it: the public song/artist totals query used by `GET /api/spotify/stats` (find the route and mirror its SQL) is unchanged by adding a lead, and no `leads` table is referenced in `backend/routes/spotify.js`, `analytics.js`, `analysis.js`, `submissions.js`, `playlists.js`, `youtube.js`, `content.js` (a `grep`-style assertion reading those files) (Review Focus 4). Run: expected PASS once routes exist; the grep half passes immediately.
- [ ] **Step 2: Implement the five routes.**
- [ ] **Step 3: Verify on a spare port** (never :5000): start the server with `PORT=5077`, curl unauthenticated -> 401; authed `GET /api/admin/leads` -> 200 with `counts`; `POST` with `{}` -> 400; `POST` a lead -> 201, the same name again -> 200 `duplicate`; `DELETE` it -> 200; then stop the instance (find the PID by port with PowerShell `Get-NetTCPConnection`; never kill all node). Run the full backend suite. Expected: all pass.
- [ ] **Step 4: Commit** `feat(leads): admin routes`.

---

### Task 4: Leads tab

**Files:**
- Create: `frontend/src/components/admin/LeadsArea.jsx`
- Modify: `frontend/src/components/admin/AdminLayout.jsx` (nav entry and count), `frontend/src/App.jsx` (route `leads`), `frontend/src/styles/admin.css`

**Interfaces:**
- Consumes: Task 3 routes via `api` from `./bandCheckApi` (throws `Error(message)`).
- Produces: `<LeadsArea />` at `/admin/leads`; AdminLayout nav entry `['/admin/leads', 'Leads', false]` placed after `Artists`, whose label shows the To-look-into count, e.g. `Leads (3)` (just `Leads` at zero or before it loads), fetched once after login from `GET /api/admin/leads?status=new` (counts only used) and refreshed whenever `window` receives a `leads-changed` event; `LeadsArea` dispatches `leads-changed` after every add/update/promote/delete.

- [ ] **Step 1: Build `LeadsArea`:**
  - **Capture** at the top: a name input (autofocus), a note input and a **More** toggle revealing song and link inputs; Enter in any field submits; only the name is required; on `added` the fields clear and the name input regains focus; whitespace-only name does nothing; on `duplicate` show the specific message ("Already a lead (To look into)", "Already a lead, Checked", "Already a lead, dismissed on <date>" with a **Restore** button, "Already an artist" with an **Open** link to `/admin/artist/<id>`) and keep the typed text.
  - **Filter chips** To look into / Checked / Dismissed with counts (default To look into).
  - **Rows:** name, note, song, link (`target="_blank" rel="noopener noreferrer"`, http(s) only), date added, a badge **already an artist** (with an Open link) when `artist_match` is set. Actions: **Promote** (calls promote then navigates to `/admin/artist/<artistId>` with `useNavigate`), **Mark checked**, **Dismiss**, **Restore** (on Checked/Dismissed rows), an inline note edit (blur saves via `PUT`), **Delete** (a second click confirms: first click turns the button into "Confirm delete").
  - Empty state per filter; errors shown with `admin-message error`.
- [ ] **Step 2: Wire the route, nav entry and count** in `App.jsx` / `AdminLayout.jsx`; the nav entry must stay visible inside the workbenches (it is part of the layout, so it already is).
- [ ] **Step 3: Verify.** `cd frontend && npm run lint && npm run build` (0 errors). Then check in headless Chrome through a throwaway mock harness outside the repo (copy the pattern in the scratchpad `harness2`: a stubbed `adminFetch` and a `main.jsx` mounting `LeadsArea` inside a `MemoryRouter`, driven with timed steps and `--dump-dom`/`--screenshot`; do not type `ADMIN_PASSWORD`): Enter adds and clears; duplicate message shows; filters switch; Promote posts and navigates; the optional row hides until **More**.
- [ ] **Step 4: Commit** `feat(leads): Leads tab in the admin menu`.

---

### Task 5: Dashboard tile

**Files:**
- Modify: `frontend/src/components/admin/Dashboard.jsx`

- [ ] **Step 1:** Add one tile in the existing `dash-tile` style linking to `/admin/leads`, number = the To-look-into count from `GET /api/admin/leads?status=new` (`counts.new`), label "Leads to look into"; `0` when none; it fetches on mount alongside the other counts and tolerates a failed request (shows `-`).
- [ ] **Step 2: Verify:** lint and build clean; check the tile renders in headless Chrome through a harness (stub `adminFetch` for the Dashboard's calls) or, if the Dashboard's other calls make that heavy, read the rendered DOM from a spare-port full stack run with the real backend (read-only) instead.
- [ ] **Step 3: Commit** `feat(leads): Dashboard tile`.

---

### Task 6: Real-data check and docs

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `CLAUDE.md`, `docs/PRD.md`

- [ ] **Step 1: Live read-only check** with a scratchpad script (load `backend/.env` by absolute path): count `artists` and `leads` before and after calling `listLeads` and `addLead` on a name that matches a real existing artist (expect `duplicate kind 'artist'`, nothing inserted), printing only counts.
- [ ] **Step 2: Full verification:** `cd backend && node --test --test-concurrency=1` all pass; `cd ../frontend && npm run lint && npm run build` clean.
- [ ] **Step 3: Update the docs** per the End-Session Guide: state (what changed, the design's "Settled" rulings, migration 017 must be applied on any other environment, restart the backend), a Changelog entry, `CLAUDE.md` architecture lines (`services/leads.js`, the routes, the tab, the live artist match, Promote's transaction and Notes line), the `PRD.md` feature line, and the curator smoke checklist: restart the backend; open Leads from inside an artist workbench via the menu; type a band and press Enter (it clears and keeps focus); add a duplicate in another case and see the message; add a note and a link via More; Dismiss one and try to re-add it; Promote one (it opens the new artist's workbench with the dated line in Catalogue review notes); Promote a lead for a band that is already an artist (it opens that artist, no second one); check the Leads count in the menu and the Dashboard tile.
- [ ] **Step 4: Commit** `docs: leads queue built, state updated` (do not push; the branch stays for the curator's smoke).
