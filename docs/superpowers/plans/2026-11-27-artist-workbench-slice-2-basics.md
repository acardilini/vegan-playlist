# Artist workbench slice 2: Basics and members Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the temporary Facts and Proposed-enrichment panels on the artist page with section **2 Basics** (a facts table with proposals, genres, and a members table with role, current/former, a curator-only vegan tick and an evidence hint link).

**Architecture:** Migration 030 adds `artist_members.role`; `artistFacts` (the single writer of facts and members) stores it and `musicbrainzFacts` parses a role from the MusicBrainz member relation; the enrichment reader adds a read-only `vegan_hints` list. The frontend gains a pure `basicsModel.js`, a `useArtistFacts` hook and three components (`BasicsSection`, `MembersTable`, `MusicBrainzFill`) built on the shared `useEnrichmentReview` hook from slice 1; `EnrichmentPanel` and `ArtistFactsPanel` are deleted.

**Tech Stack:** Node/Express + PostgreSQL (node:test), React 19 + Vite, `docs/ADMIN_UI.md` table classes.

**Spec:** `docs/superpowers/specs/2026-11-27-artist-workbench-redesign-design.md` (sections 5.2 "2 Basics", 5.5 "Migration 030" and "Reader", 5.6 slice 2). Slice 1 plan: `docs/superpowers/plans/2026-11-27-artist-workbench-slice-1-shell.md`.

## Global Constraints

- **Option A invariant:** the web app never writes `artist_enrichment_proposals`; only `services/artistEnrichment.js` may reference the proposals/review tables (test-enforced); never `SELECT *` there.
- **`artist_members.vegan` is curator-only.** Nothing the analysis staged ticks it; the staged evidence is only a link beside the tick. `acceptAll` and every accept write `vegan: false` for a new member and never change an existing member's `vegan` or `role`.
- Single writers: `artistFacts` (facts and members, including `role`), `artistMerge` (merge), `bandCheck.saveIdentity` (identity), `artists.update` (never identity).
- **Accept all shown stays fill-only** and never replaces a stored value.
- A MusicBrainz role only ever **fills an empty role**; it never overwrites one.
- Role is free text, optional, trimmed, max **80** characters; empty or whitespace stores `NULL`.
- Public reads are unchanged (`publicFacts` does not show the role).
- Frontend: tokens only (`--space-*`, `--text-*`), `docs/ADMIN_UI.md` classes (`.adm-list`, `.adm-head`, `.adm-row`, `.adm-col-*`, `.adm-pill`, `.adm-x`, `.adm-sub`, `.adm-actions`); pure logic in `frontend/src/utils/*.js` with `node --test`; backend tests use a unique sentinel per file and `--test-concurrency=1`.
- Commits: `git commit -F <file>` ending `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; `git add` explicit paths only (never `docs/MAIN_PROJECT_ARTIST_ENRICHMENT_HANDOFF.md`, `backend/docs/`, `docs/examples/`). Never `taskkill` all node; never type `ADMIN_PASSWORD`; never click a control that opens `window.confirm` in the browser review.
- Nothing merges to `main` before the curator says "Merge" after a smoke test.

## Review Focus

- A role over 80 characters, a non-string role or a whitespace-only role: rejected with `BAD_INPUT` / stored as `NULL` (Task 1).
- A MusicBrainz role must not overwrite a role the curator typed (Task 2).
- A staged `vegan_evidence_url` that is not http(s) (for example `javascript:`) or belongs to a member the analysis did not mark vegan must not become a hint; a hint never carries or sets the vegan flag (Task 3).
- Accept all shown must remain fill-only and must not touch members' vegan or role (Tasks 3 and 4).
- An artist with no staged proposal (about 120 of 921) must still show an editable Basics section with no hint links and no proposal rows (Tasks 3 and 8).
- Renaming a member to a name that already exists on the artist (case/diacritic-insensitive) shows the server's CONFLICT message on that row and keeps the old name (Task 8).

---

### Task 1: Migration 030 and the role in `artistFacts`

**Files:**
- Create: `backend/database/migrations/030_member_role.sql`
- Modify: `backend/services/artistFacts.js`, `backend/services/artistMerge.js` (the loser-members snapshot select)
- Test: `backend/test/artistFacts.test.js` (sentinel `ZZZAFA`), `backend/test/artistMerge.test.js`

**Interfaces:**
- Produces: `artist_members.role TEXT` (nullable). `MEMBER_COLS` becomes `'id, name, role, is_current, vegan, source'`, so `getFacts().members[i]`, `addMember`, `updateMember` rows all carry `role` (string or `null`). `addMember(db, artistId, { name, role, is_current, vegan, source })` and `updateMember(db, artistId, memberId, { name?, role?, is_current?, vegan? })` accept `role`.

- [ ] **Step 1: Write the failing tests** in `artistFacts.test.js`:
  - `'members: role is stored trimmed, empty clears it, over 80 characters or a non-string is BAD_INPUT'`: `addMember(pool, a, {name:'Ann', role:'  Vocals '})` → `m.role === 'Vocals'`; `updateMember(..., {role:'   '})` → `role === null`; `updateMember(..., {role:'x'.repeat(81)})` and `{role: 5}` reject `BAD_INPUT`; `{role:'x'.repeat(80)}` is accepted; `addMember` with no `role` gives `null`.
  - `'members: getFacts rows carry role'`: after adding a member with `role: 'Drums'`, `(await svc.getFacts(pool,a)).members[0].role === 'Drums'`.
  - Existing assertions that `deepEqual` a whole member row must be updated to include `role: null` only if they fail.
  In `artistMerge.test.js` add `'merge keeps a moving member's role'` (sentinel already in that file): loser has a member with `role: 'Bass'`, keeper does not; after `merge`, the keeper's member list has that member with role `Bass`; and `artist_merges.snapshot` members for the loser include `role`.
- [ ] **Step 2: Run to verify they fail.** `cd backend && node --test --test-concurrency=1 test/artistFacts.test.js test/artistMerge.test.js`. Expected: the new tests FAIL (no `role` column).
- [ ] **Step 3: Write `030_member_role.sql`** (header comment saying what and why, additive and idempotent): `ALTER TABLE artist_members ADD COLUMN IF NOT EXISTS role TEXT;`. Apply it to the dev database with a small node script run from the scratchpad that loads `backend/.env` by absolute path (see memory `scratchpad-script-dotenv-hazard`).
- [ ] **Step 4: Implement** in `artistFacts.js`: add `role` to `MEMBER_COLS`; `cleanRole(v): string|null` (`undefined`→caller skips, `null` or whitespace-only → `null`, non-string or trimmed length > 80 → `coded('BAD_INPUT', 'Role must be text, 80 characters at most')`); `addMember` inserts `role` (6th column); `updateMember` sets it when `patch.role !== undefined`. In `artistMerge.js` add `role` to the `loserMembers` select (line ~45) so the snapshot keeps it; moving members are `UPDATE`d so their role already follows.
- [ ] **Step 5: Run to verify they pass**, then the whole backend suite `cd backend && npm test -- --test-concurrency=1`. Expected: all pass.
- [ ] **Step 6: Commit.** `git add backend/database/migrations/030_member_role.sql backend/services/artistFacts.js backend/services/artistMerge.js backend/test/artistFacts.test.js backend/test/artistMerge.test.js`; message `feat(artists): member role (migration 030)`.

---

### Task 2: MusicBrainz role prefill

**Files:**
- Modify: `backend/services/bandCheck/musicbrainzFacts.js`, `backend/services/artistFacts.js` (`proposeFromMusicBrainz`)
- Test: `backend/test/musicbrainzFacts.test.js`, `backend/test/artistFacts.test.js`

**Interfaces:**
- Consumes: Task 1's `role` on stored members.
- Produces: `parseFacts().members[i]` = `{ name, is_current, role }` (`role` is a string or `null`). `proposeFromMusicBrainz(...).members[i]` = `{ name, is_current, role, change: 'new' | 'status' | 'role', existing: null | { id, is_current, vegan, role } }`. `change: 'role'` means the stored member's role is empty and MusicBrainz states one while the status is equal; if the status also differs the change stays `'status'` and still carries `role`.

- [ ] **Step 1: Write the failing tests.**
  `musicbrainzFacts.test.js`: `'parseFacts: member role from the relation attributes, status words dropped, null when none'`: attributes `['guitar','lead vocals']` → role `'guitar, lead vocals'`; `['original','guitar']` → `'guitar'`; `['founding']` or `[]` → `null`; the existing member test expectation gains `role: null` on each entry.
  `artistFacts.test.js`: `'propose members: a role fills an empty role only'`: stored member 'Ann' with no role and MB role 'Drums' → one entry `change: 'role'`, `role: 'Drums'`, `existing.role === null`; stored member 'Bob' with role 'Bass' and MB role 'Guitar' (same status) → not proposed at all; a new MB member carries its `role`; nothing is written.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** In `musicbrainzFacts.js` `parseMembers`: collect `role` from `r.attributes` after removing the status words `original`, `founding`, `additional`, `guest`, `minor`, `past`, `present`, `former`, `current` (case-insensitive) and the existing `NOT_A_MEMBER` ones; join the rest with `', '` and cap at 80 characters (truncate at a word boundary is not required: slice to 80); `null` when empty. When the same name appears twice keep the existing "current beats past" choice and its role. In `proposeFromMusicBrainz` carry `role` on every entry, add `role` to `existing`, and add the `'role'` change as specified.
- [ ] **Step 4: Run to verify they pass**, then the two files in full.
- [ ] **Step 5: Commit.** `git add backend/services/bandCheck/musicbrainzFacts.js backend/services/artistFacts.js backend/test/musicbrainzFacts.test.js backend/test/artistFacts.test.js`; message `feat(artists): MusicBrainz proposes a member role`.

---

### Task 3: Reader: `vegan_hints`

**Files:**
- Modify: `backend/services/artistEnrichment.js`
- Test: `backend/test/enrichmentRead.test.js` (sentinel `ZZZENR`)

**Interfaces:**
- Produces: `getReview(...)` with a proposal gains `vegan_hints: [{ name, url, confidence }]` where `confidence` is `'HIGH' | 'MEDIUM' | 'LOW' | null`. An entry exists only for a staged member whose `vegan === true` and whose `vegan_evidence_url` is an `http:` or `https:` URL (`new URL` parses, protocol checked), name from `cleanMembers` rules (non-empty, de-duplicated by `nameKey`). The list is independent of `members` (it covers members that are already stored and need no change). The no-proposal return `{ has_proposal: false, finished_at }` is unchanged (no hints). No `vegan` value is ever returned or written.

- [ ] **Step 1: Write the failing tests** in `enrichmentRead.test.js` (extend `mkProposal` members JSON per test):
  - `'vegan_hints: only a staged vegan member with an http(s) evidence link'`: members `[A (vegan true, url https://x.example/a, confidence HIGH), B (vegan true, url javascript:alert(1)), C (vegan false, url https://x.example/c), D (vegan true, no url), E (vegan true, url 'ftp://x.example/e')]` → `vegan_hints` deep-equals `[{name:'A', url:'https://x.example/a', confidence:'HIGH'}]`; an unknown confidence string such as `'MAYBE'` becomes `null`.
  - `'vegan_hints: present for a member that is already stored with no change proposed'`.
  - `'vegan_hints: no proposal has no hints and a hint never changes members'`: `has_proposal:false` result has no `vegan_hints` key; `members` rows still carry no `vegan` key.
  - The test that scans `artistEnrichment.js` for allowed columns stays green (no new column is read: `proposed_members` is already selected).
- [ ] **Step 2: Run to verify they fail.** `cd backend && node --test --test-concurrency=1 test/enrichmentRead.test.js`.
- [ ] **Step 3: Implement** `cleanHints(raw)` beside `cleanMembers` and return it from `getReview` as `vegan_hints`. Lookups of the confidence go through a `Set`/`Map`, not a plain object.
- [ ] **Step 4: Run to verify they pass**, then `enrichmentWrite.test.js` and `enrichmentRoutes.test.js` (the "only this service may reference the proposals" test) and the whole backend suite.
- [ ] **Step 5: Commit.** `git add backend/services/artistEnrichment.js backend/test/enrichmentRead.test.js`; message `feat(enrichment): staged vegan evidence links as hints (never a tick)`.

---

### Task 4: Pure Basics model

**Files:**
- Create: `frontend/src/utils/basicsModel.js`
- Test: `frontend/src/utils/basicsModel.test.js`

**Interfaces:**
- Consumes: `review` = the `getReview` result (`has_proposal`, `fields[{field,label,current,proposed,source,confidence,link,locked}]`, `members[{name,is_current,source,change,existing,locked}]`, `warnings[{field,text}]`, `vegan_hints`), `facts` = `GET .../facts` (`country, country_source, formed_year, formed_source, disbanded_year, disbanded_source, first_release_year, first_release_source, last_release_year, last_release_source, members[{id,name,role,is_current,vegan,source}]`), `skipped` = a `Set` of `field:<key>` and `member:<name>` strings (the same keys slice 1's `EnrichmentPanel` used).
- Produces (all pure, no DOM):
  - `memberKey(name): string` (NFD, strip combining marks, lowercase, collapse whitespace, trim; the same rule as backend `nameKey`).
  - `FACT_FIELDS`: `[{key:'country',label:'Country',year:false},{key:'formed_year',label:'Formed',year:true},{key:'disbanded_year',label:'Disbanded',year:true},{key:'first_release_year',label:'First release',year:true},{key:'last_release_year',label:'Last release',year:true}]`; `sourceKeyFor(key)` (`country_source`, `formed_source`, `disbanded_source`, `first_release_source`, `last_release_source`).
  - `factRows(facts, review, skipped): Row[]`, `Row = { key, label, year, readOnly, value: string, source: string|null, proposal: null | { proposed, source, confidence, link, locked }, warnings: string[] }`: the five facts in order, then, only when the review proposes `bandcamp_url` and it is not skipped, a row `{ key:'bandcamp_url', label:'Bandcamp link', readOnly:true, value: current||'', source:null, proposal }`. A skipped proposal is `null`. `warnings` = the texts of `review.warnings` whose `field` equals the row key.
  - `memberRows(facts, review, skipped): { stored: Stored[], proposed: Proposed[] }`. `Stored = { ...member, hint: null | {url, confidence}, change: null | { kind:'status'|'role', is_current, role, source, locked, name } }` (hint matched by `memberKey`; `change` from a review member row with `change` `'status'` that matches the stored member and is not skipped). `Proposed = { name, is_current, source, locked }` for review members with `change: 'new'` that are not skipped.
  - `canAcceptAll(review, skipped): boolean`: `skipped.size === 0` and the review has a proposal and (some field row is unlocked, has no warning of its own, has an empty stored value and, for `bandcamp_url`, the match state is `approved` or `pretrusted`; or some member row is unlocked, `change === 'new'`, with no `members` warning). This is slice 1's rule moved out of the component.
  - `basicsStatus(facts, review, skipped): { label, tone }`: pending = unskipped review field rows + unskipped review member rows (0 without a proposal). `pending > 0` → `{label:`${n} to review`, tone:'todo'}`; else if no stored fact value and no stored member → `{label:'not started', tone:'todo'}`; else `{label:'done', tone:'ok'}`.

- [ ] **Step 1: Write the failing tests** (`node:test`): `memberKey` ('José  Pérez' → 'jose perez'); `factRows` (order, stored value and source text, a proposal attached, a skipped proposal omitted, warnings routed by field, the Bandcamp row only when proposed and unskipped, `readOnly`); `memberRows` (hint matched case/diacritic-insensitively, a status change attached to the stored member, a new member in `proposed`, skipped ones removed, a stored member the review does not mention has `change: null`); `canAcceptAll` (true for an unlocked empty-valued field; false when locked, warned, value already stored, anything skipped, no proposal; Bandcamp row needs an approved/pretrusted match; a new unlocked member alone makes it true unless a `members` warning exists); `basicsStatus` (three cases + no proposal).
- [ ] **Step 2: Run to verify they fail.** `cd frontend && node --test src/utils/basicsModel.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `basicsModel.js` per the interface; lookups by `Map`, never a plain-object index by a data-supplied key.
- [ ] **Step 4: Run to verify they pass** and the whole frontend test run `node --test $(find src -name "*.test.js")`.
- [ ] **Step 5: Commit.** `git add frontend/src/utils/basicsModel.js frontend/src/utils/basicsModel.test.js`; message `feat(admin): pure Basics model (fact rows, member rows, accept-all rule, status)`.

---

### Task 5: Facts hook and the members table

**Files:**
- Create: `frontend/src/components/admin/useArtistFacts.js`, `frontend/src/components/admin/MembersTable.jsx`, `frontend/src/components/admin/MusicBrainzFill.jsx`
- Modify: `frontend/src/styles/admin.css`

**Interfaces:**
- Consumes: `basicsModel` (Task 4), `api` from `./bandCheckApi`, `AutoText` (`inline`) and `SaveTag` from `./SavedField`, `sourceLink` from `../../utils/factSources`.
- Produces:
  - `useArtistFacts(artist, refreshKey)` → `{ facts, error, setError, reload, saveFact(key, value), addMember(body), updateMember(id, patch), removeMember(id) }`. It GETs `/api/admin/artists/${artist.id}/facts` on mount and when `refreshKey` changes; every write goes to the existing `/facts` routes and replaces `facts` (members routes then `reload`). `saveFact(key, value)` returns `{ok, error?}` (the shape `AutoText` wants): empty text → `null`, a year field with digits → `Number`, otherwise the trimmed text; the server stamps the source. A failed write keeps the old value on screen. Responses for another artist or after unmount are dropped (seq guard + mounted ref).
  - `<MembersTable artist rows facts enr skipped onSkip />` where `rows = memberRows(...)`: an `.adm-list` with an `.adm-head` row (Name · Role · Current · Vegan · Source · blank). Stored row: name input, role input, Current checkbox, Vegan checkbox (`aria-label="<name> is vegan"`) followed by an "evidence ↗" link (`target=_blank`, `rel=noopener noreferrer`, tooltip with the confidence) when `hint`, source text (linked via `sourceLink`), `.adm-x` remove (`window.confirm` first). Name and role save on blur (only when changed) through `updateMember`; a rejected save shows the server message in an `.adm-sub` line on that row and restores the old text. A stored row with a `change` shows an `.adm-sub` line `Proposed: Former (MusicBrainz) [Accept] [Skip]` / `Proposed role: Drums ...` using `enr.acceptMember` and `onSkip(`member:${name}`)`; a locked change shows `Approve the match first` instead of Accept. Proposed (not yet stored) rows render at the end with a `proposed` `.adm-pill` and Accept / Skip. A final row has an Add-member name input, a role input and an **Add** button (disabled when the name is blank; Enter adds).
  - `<MusicBrainzFill artist facts reload onNeedIdentity />`: the live "Fill from MusicBrainz" read (button only when `artist.musicbrainz_id`, otherwise a line with a button calling `onNeedIdentity('musicbrainz')`), ported from `ArtistFactsPanel` (`GET .../facts/proposals`, per-row Accept / Skip, a field accept is `PUT .../facts` with the proposed value and `<field-prefix>_source: 'MusicBrainz'`, a `new` member accept is `POST .../facts/members` with `{name, is_current, role, source:'MusicBrainz'}`, a `status`/`role` accept is `PUT .../facts/members/:id` with `{is_current}` plus `role` only when the stored role is empty; never the vegan flag); restyled as `.adm-list` rows; calls `reload()` after each accept.

- [ ] **Step 1: Write `useArtistFacts.js`.**
- [ ] **Step 2: Write `MembersTable.jsx`** per the interface (admin classes only; add the few missing classes to `admin.css` in Step 4).
- [ ] **Step 3: Write `MusicBrainzFill.jsx`** (port, do not redesign).
- [ ] **Step 4: CSS** in `admin.css` (tokens only): `.aw-members` column widths using `.adm-col-choice` for the checkboxes and `.adm-col-label`-sized role input, `.aw-hint` (the evidence link, `0.75rem`, `--text-muted`), proposed-row tint via the pill only. No raw colours.
- [ ] **Step 5: Verify.** `cd frontend && npm run lint && npm run build` (0 errors; the 4 pre-existing warnings stay; the components are not mounted until Task 7 so the browser check is Task 8).
- [ ] **Step 6: Commit.** `git add frontend/src/components/admin/useArtistFacts.js frontend/src/components/admin/MembersTable.jsx frontend/src/components/admin/MusicBrainzFill.jsx frontend/src/styles/admin.css`; message `feat(admin): members table with role and evidence hint, facts hook`.

---

### Task 6: Basics section

**Files:**
- Create: `frontend/src/components/admin/BasicsSection.jsx`
- Modify: `frontend/src/components/admin/ArtistDetailsPanel.jsx` (remove the Genres field), `frontend/src/styles/admin.css`

**Interfaces:**
- Consumes: Tasks 4 and 5; `enr` from `useEnrichmentReview`; `save` (artist PUT) for genres.
- Produces: `<BasicsSection artist enr save refreshKey onIdentitySaved onChanged onNeedIdentity />`: an `.aw-section` (id `aw-sec-basics`, header `2 · Basics` with an `.adm-pill` from `basicsStatus`), body top to bottom:
  1. The facts `.adm-list` from `factRows`: `.adm-col-label` label, the value input (`AutoText inline`, committing through `saveFact`; the Bandcamp row has no input, just the proposed/current text), then the source as small linked text (`sourceLink` for MusicBrainz/Bandcamp). Under a row with a `proposal`, an `.adm-sub` line `Proposed: <value> · <source link> · <confidence>` with **Accept** (`enr.acceptField(f)`, using the original review field row; `identity` handling is the hook's) and **Skip**, or `Approve the match first` when `locked`; each row `warnings` as `.enr-warn` lines. The review's `members` warnings appear above the members table.
  2. A **Genres** row: `AutoText inline` comma-separated, saved through `save({ genres: [...] })` exactly as the old Details panel did.
  3. `<MembersTable>` and `<MusicBrainzFill>`.
  4. The Accept-all area (moved from `EnrichmentPanel`): `Just accepted: ...` (`acceptedSummary`), `n rows need your check: ...` (`skipLabel` rules), and **Accept all shown** when `canAcceptAll(enr.review, skipped)`; it POSTs `${enr.base}/accept-all` with body `{}` inside `enr.act`, calls `onChanged`, `onIdentitySaved` when `match` or `bandcamp_url` was applied, and, when nothing was skipped by the server, `enr.finishCall(true)` (slice 1's behaviour, unchanged). It never touches Story or members' vegan/role.
  Local state: `skipped` (a `Set`, view-only: Skip stores nothing), `accepted`, `needCheck`, a `mounted` ref. `enr.error` with `errorScope === 'rows'` shows at the top. With no proposal (`enr.review` loaded and `has_proposal === false`) the section still renders the stored facts, Genres and members, with no proposal lines.

- [ ] **Step 1: Write `BasicsSection.jsx`**, moving `skipLabel` and the Accept-all logic out of `EnrichmentPanel.jsx` unchanged.
- [ ] **Step 2: Remove Genres from `ArtistDetailsPanel.jsx`** (the file keeps bio, notes and the no-notes box until slice 3).
- [ ] **Step 3: CSS** for `.aw-fact-source` and `.aw-basics` spacing in `admin.css` only if the existing `adm-*` classes do not cover it.
- [ ] **Step 4: Verify.** `cd frontend && npm run lint && npm run build && node --test $(find src -name "*.test.js")`.
- [ ] **Step 5: Commit.** `git add frontend/src/components/admin/BasicsSection.jsx frontend/src/components/admin/ArtistDetailsPanel.jsx frontend/src/styles/admin.css`; message `feat(admin): Basics section (facts table, genres, members, accept all)`.

---

### Task 7: Wire into the workbench and delete the old panels

**Files:**
- Modify: `frontend/src/components/admin/ArtistWorkbench.jsx`
- Delete: `frontend/src/components/admin/EnrichmentPanel.jsx`, `frontend/src/components/admin/ArtistFactsPanel.jsx`

**Interfaces:**
- Consumes: `BasicsSection` (Task 6). The Details tab becomes: `IdentitySection`, `BasicsSection`, then the temporary `ArtistDetailsPanel` stack (bio, notes, no-notes box) under the existing "Story is being rebuilt; the panel below stays until then" note, then the footer. `factsKey` is passed to `BasicsSection` as `refreshKey`; `onNeedIdentity` is the existing `needIdentity`.

- [ ] **Step 1: Edit `ArtistWorkbench.jsx`**: replace the `EnrichmentPanel` and `ArtistFactsPanel` mounts with `<BasicsSection artist={artist} enr={enr} save={save} refreshKey={factsKey} onIdentitySaved={identitySaved} onChanged={factsChanged} onNeedIdentity={needIdentity} />`; update the `aw-todo` note to `Story is being rebuilt; the panel below stays until then.`; drop the now-unused imports.
- [ ] **Step 2: `git rm`** the two panel files; confirm nothing imports them (`grep -rn "EnrichmentPanel\|ArtistFactsPanel" frontend/src`).
- [ ] **Step 3: Verify.** `cd frontend && npm run lint && npm run build && node --test $(find src -name "*.test.js")`, then `cd ../backend && npm test -- --test-concurrency=1`. Expected: 0 lint errors, build clean, all tests pass.
- [ ] **Step 4: Commit.** `git add frontend/src/components/admin/ArtistWorkbench.jsx` plus the two `git rm`; message `feat(admin): Basics replaces the Facts and Proposed-enrichment panels`.

---

### Task 8: Browser verification, docs, hand-off

**Files:**
- Create (scratchpad, outside the repo): a throwaway mock harness (copy the slice 1 harness method: own `harness.config.mjs`, port **5199** `strictPort`, aliases to `frontend/node_modules`, `fs.allow` the repo, `main.jsx` importing the global CSS in `App.jsx` order and mounting `ArtistWorkbench` in a `MemoryRouter`, `mockAdmin.js` replacing `adminApi.js`).
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `CLAUDE.md`.

- [ ] **Step 1: Extend the mock** with `GET/PUT .../facts`, `POST/PUT/DELETE .../facts/members`, `GET .../facts/proposals`, and an enrichment review that includes `vegan_hints`; scenarios `rich` (proposals for country and years, a new member, a status change, two hints, a warning on `last_release_year`), `none` (no proposal), `locked` (match needs approval so rows are locked), `clean`.
- [ ] **Step 2: Drive it in a real browser** (claude-in-chrome) at about 1100px and in a 390px-wide wrapper and confirm: the facts table shows stored values with their source; typing a year and blurring saves (mock call logged); a proposal line shows value, source and confidence with Accept/Skip, a locked row says to approve the match first, a skipped row disappears and **Accept all shown** vanishes once anything is skipped; a warning line sits under its row; Genres saves a split list; the members table shows role, Current and Vegan checkboxes, the "evidence ↗" link only on hinted members and ticking Vegan sends only `{vegan:true}`; a rename to a duplicate shows the CONFLICT message on the row and restores the name; Add member works with name only and with a role; a proposed new member shows Accept/Skip; **Fill from MusicBrainz** lists proposals incl. a role; with `none` the section is editable with no proposal lines and no hints; the section status pill reads `n to review` / `not started` / `done`; no horizontal overflow; admin classes everywhere (no unstyled inputs or buttons). Never click anything that opens `window.confirm` (the member ✕).
- [ ] **Step 3: Fix anything found** (reproduce in the harness, change, re-check, re-run lint, build, frontend and backend tests, commit).
- [ ] **Step 4: Docs.** `docs/PROJECT_STATE.md` (Current State entry and Changelog line, CRLF-safe script, built on `session-artist-workbench-basics`, NOT merged, the curator smoke steps below); `CLAUDE.md` (the `artistFacts` bullet: `role`, migration 030, the `'role'` change, `vegan_hints` in the `artistEnrichment` bullet, the frontend Structure line: `BasicsSection`, `MembersTable`, `MusicBrainzFill`, `useArtistFacts`, `basicsModel.js`; `EnrichmentPanel` and `ArtistFactsPanel` are gone); `docs/PROJECT_PLAN.md` (mark slice 2). Commit `docs: artist workbench slice 2`.
- [ ] **Step 5: Push the branch** (`git push -u origin session-artist-workbench-basics`), do **not** merge, and post the curator smoke steps in full in chat:
  1. Check the :5000 process tree, restart the backend (migration 030 is already applied to the dev database) and `cd frontend && npm run dev`; sign in yourself.
  2. Open an artist with staged proposals: section **2 Basics** lists Country, Formed, Disbanded, First release, Last release with their sources; a proposal shows under its row with Accept / Skip; a locked row says to approve the match first.
  3. Edit a year and tab away: it saves; Genres saves.
  4. Accept one proposal, Skip another (it just hides), and use **Accept all shown** on an artist where it is offered.
  5. Members: tick Vegan on one member, set a role, untick Current, add a member by name, rename one to an existing name (the row should say it already exists), remove one.
  6. An artist whose proposal has vegan evidence: the "evidence ↗" link opens the staged source; nothing is ticked for you.
  7. **Fill from MusicBrainz** on an artist with a MusicBrainz link: proposals appear (with a role where MusicBrainz states one) and Accept adds them.
  8. An artist with no staged proposal: Basics is fully editable with no proposal lines; Mark artist done still works.

---

## Self-review notes

- Spec coverage for slice 2: facts table with sources, proposals, warnings, lock and Accept/Skip/Accept-all (Tasks 4, 6), Genres row (6), members table with role, status, vegan tick, evidence hint, source, remove, proposed rows, Add (5), migration 030 and `artistFacts` role (1), MusicBrainz role prefill (2), `vegan_hints` (3), old panels retired (7), harness and smoke (8). Story, migration 031, `accept-story` and the Catalogue table are slices 3 and 4 and are intentionally absent; the bio/notes panel stays.
- Type consistency: `role` is `string | null` everywhere; `change` is `'new' | 'status' | 'role'` (backend propose) while the staged review keeps `'new' | 'status'`; `memberRows`'s `change.kind` reuses those words; skip keys are `field:<key>` / `member:<name>` as in slice 1.
- Calls I made (to correct if wrong): (1) hints only for members the analysis staged as vegan with an http(s) link, because a link under a non-vegan member would read as a claim; (2) the live "Fill from MusicBrainz" read stays, since it is the only source of a role and the only enrichment for artists without a staged proposal; (3) the staged Bandcamp-link proposal stays as a read-only extra row in Basics until Story/Catalogue slices move identity proposals into section 1; (4) Accept all shown keeps slice 1's auto-finish when nothing is left over.
- Left to the builder: exact column widths, microcopy, keyboard order inside the members row, loading and error states.
