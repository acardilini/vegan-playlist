# Reddit thread skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasted Reddit-thread text becomes an overview (new vs already have) and, once approved, new bands in Leads, new songs in To be processed and vegan claims in a new admin-only notes field.

**Architecture:** A project skill makes Claude extract mentions into JSON; a checked-in script (`backend/scripts/importThread.js`, dry-run by default, direct DB via `database/db.js`) feeds it to `services/threadImport.js`, whose `plan` is read-only and whose `apply` re-plans at write time. Claims live in a nullable `thread_claims` text column on `artists` and `leads`, appended as dated lines through one shared helper.

**Tech Stack:** Node/Express, PostgreSQL (`pg`), `node:test`, React (one small admin edit).

**Spec:** `docs/superpowers/specs/2026-11-05-reddit-thread-skill-design.md`

## Global Constraints

- Nothing unconfirmed reaches a public route; `thread_claims` is in no public route file and no queue predicate (`services/artists.js` PREDICATE untouched).
- Claims never go in `vegan_advocacy_notes`; `artist_members` and its vegan marks are never touched.
- No Reddit usernames stored; a claim quote is at most 200 characters.
- Script is dry-run unless `--apply`; never the admin password or an HTTP call.
- Existing songs/artists are never edited except by appending to `thread_claims`.
- New lead: `origin: 'reddit'`, `url` = thread URL (<=500), `song` = songs joined by `"; "` cut to 255, `note` = genre if given. New song status note: `added via reddit thread (<thread url>)`; origin tag `redditthread`, label **"From Reddit thread"**.
- Tests: `node:test`, `--test-concurrency=1`, one unique fixture sentinel per file (`ZZZTCL`, `ZZZTHR`), cleaned before and after; tests never touch real rows. Edit files per hunk with the Edit tool (no scripted whole-file rewrites); run `grep -nP '[^\x00-\x7F]'` on any file written by script.
- Git: explicit `git add` paths only (`backend/docs/` and `docs/examples/` stay untracked); commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; write messages to a scratchpad file and use `git commit -F`.

## Review Focus

- Re-running the same JSON adds nothing (no second lead, song or claim line) - pinned in Task 3.
- A band named in another case, with diacritics, punctuation or a leading "The" matches the existing artist/lead - Task 2.
- The same band twice in one paste is one item (songs and claims unioned) - Task 2.
- Malformed JSON (missing artist, unknown status, non-array fields, no thread url) is rejected before any write - Task 2.
- Over-long input is cut, not rejected or broken: quote > 200 chars, songs joined > 255 chars, and a quote containing newlines stays on one claim line - Tasks 2 and 3.
- One item failing does not stop the others (best effort, reported) - Task 3.
- A dismissed lead is never written to; a lead already promoted still takes claims on its artist - Task 3.

## File structure

- Create `backend/database/migrations/019_thread_claims.sql` - the two columns.
- Create `backend/services/threadClaims.js` - claim-line format + the one append helper (used by import and by Promote).
- Create `backend/services/threadImport.js` - `validate`, `plan`, `apply`, `formatOverview`.
- Create `backend/scripts/importThread.js` - CLI around the service.
- Create `.claude/skills/reddit-thread-import/SKILL.md` - the skill.
- Modify `backend/services/artists.js` (get + update whitelist), `backend/services/leads.js` (COLS, promote), `backend/services/curation.js` (origin CASE), `frontend/src/components/admin/{ArtistWorkbench,LeadsArea,SongQueueList}.jsx`.
- Tests: `backend/test/threadClaims.test.js` (ZZZTCL), `backend/test/threadImport.test.js` (ZZZTHR).

---

### Task 1: Claims storage, helper, artist/lead plumbing

**Files:**
- Create: `backend/database/migrations/019_thread_claims.sql`, `backend/services/threadClaims.js`, `backend/test/threadClaims.test.js`
- Modify: `backend/services/artists.js` (`get` SELECT, `update` whitelist loop at the `['bio', ...]` line), `backend/services/leads.js` (`COLS`, `promoteLead`)

**Interfaces:**
- Produces (`services/threadClaims.js`):
  - `STATUS_LABELS` = `{vegan:'vegan', vegetarian:'vegetarian', formerly_vegan:'formerly vegan', not_vegan:'not vegan', unsure:'unsure'}`
  - `claimLine({ url, person, status, quote, dispute }, now = new Date()) -> string`: `Reddit <YYYY-MM-DD> · <url> · <person or "whole band">: <status label> - "<quote>"` plus ` · disputed: <dispute>` when `dispute` is non-empty; the quote is whitespace-collapsed (newlines -> one space) and cut to 200 characters; the quote part is omitted when empty.
  - `bodyOf(line) -> string`: the line without its leading `Reddit YYYY-MM-DD · ` (a line without that prefix returns trimmed unchanged).
  - `appendClaimLines(client, table, id, lines) -> Promise<number>`: `table` must be `'artists'` or `'leads'` (else throws); locks the row `FOR UPDATE`, appends (newline-joined, never replacing) only lines whose `bodyOf` is not already among the stored lines' `bodyOf`s (and not duplicated within `lines`), sets `updated_at` for artists only; returns the count appended; unknown id returns 0. Must be called with a `pg` client inside a transaction or a pool (a pool is fine for a single statement path).
- Migration 019 adds `artists.thread_claims TEXT` and `leads.thread_claims TEXT`, `ADD COLUMN IF NOT EXISTS`.
- `artists.get` returns `thread_claims`; `artists.update` accepts `thread_claims` (text or null, same rule as `bio`).
- `leads` rows (via `COLS`) include `thread_claims`; `promoteLead` appends the lead's claim lines to the artist inside its existing transaction (once; the already-promoted early return adds nothing).

- [ ] **Step 1: Write the failing tests** in `backend/test/threadClaims.test.js` (sentinel `ZZZTCL`, same clean/after pattern as `leads.test.js`): 
  - `claimLine` with `now = new Date('2026-11-05T10:00:00Z')` equals `Reddit 2026-11-05 · https://r/x · Joe Duplantier: vegan - "short quote"`; a `dispute` adds ` · disputed: later retracted`; empty person gives `whole band`; empty quote omits the ` - "..."` part; a 300-char quote with a newline in it yields a one-line result whose quote is exactly 200 chars.
  - `bodyOf(claimLine(...))` has no date prefix; `bodyOf('plain')` is `'plain'`.
  - `appendClaimLines(pool, 'artists', id, [a, b])` returns 2 and stores `a\nb`; the same call again returns 0 and changes nothing; the same body with a different date is not appended; a line already in the field from before is kept untouched (existing text preserved); `appendClaimLines(pool, 'songs', id, [a])` rejects; an unknown id returns 0.
  - `artists.update(pool, id, { thread_claims: 'x' })` then `artists.get` returns `'x'`; `{ thread_claims: '  ' }` stores null; a non-string rejects with code `BAD_INPUT`.
  - `leads.promoteLead` copies a lead's `thread_claims` onto the new artist's `thread_claims` (appending after any existing text), and a second promote adds nothing more.
  - Admin-only: no file in `routes/` other than `admin.js` contains `thread_claims`, and `artists.js`'s `PREDICATE`/queue SQL does not mention it (read the source text, like the leads public-route test).
- [ ] **Step 2: Run to verify failure:** `cd backend && node --test test/threadClaims.test.js` - Expected: FAIL (module/column missing).
- [ ] **Step 3: Write migration 019 and apply it to the local DB** (`node -e` with the `database/db.js` pool reading the file, from `backend/`; or psql). Verify with `SELECT thread_claims FROM leads LIMIT 1` not erroring.
- [ ] **Step 4: Implement `services/threadClaims.js` and the `artists.js` / `leads.js` edits** as specified in Interfaces. In `leads.js` add `thread_claims` to `COLS`; in `promoteLead` call `appendClaimLines(client, 'artists', artistId, lead.thread_claims ? lead.thread_claims.split('\n') : [])` before the lead update (the `lead` row read there already uses `COLS`).
- [ ] **Step 5: Run to verify pass:** `node --test test/threadClaims.test.js test/leads.test.js test/artists.test.js` - Expected: all PASS (existing leads/artists tests unchanged).
- [ ] **Step 6: Commit** `feat(claims): admin-only thread_claims on artists and leads` (add the five files by explicit path).

---

### Task 2: Validate and plan (read-only)

**Files:**
- Create: `backend/services/threadImport.js`, `backend/test/threadImport.test.js`

**Interfaces:**
- Consumes: `leads.leadKey`, `bandCheck/merge.keyOf`, `threadClaims.{claimLine, bodyOf, STATUS_LABELS}`.
- Produces:
  - `validate(extracted) -> { thread: {url, title}, mentions: [{ n, artist, key, songs: string[], genre: string|null, claims: [{person, status, quote, dispute}] }] }`. Throws `coded('BAD_INPUT', ...)` (from `bandCheck/errors`) when: not an object; `thread.url` missing/not http(s); `mentions` not an array; a mention's `artist` blank/not a string; `songs`/`claims` present but not arrays; a claim `status` not in `STATUS_LABELS`. Blank song titles are dropped. Repeats of the same `leadKey` are merged into one mention (songs unioned by `keyOf`, claims unioned by identical person+status+quote), keeping the first spelling of the name. `n` is assigned 1..N in first-appearance order after merging, so the same JSON always gives the same numbers.
  - `async plan(db, extracted, { now = new Date() } = {}) -> { thread, items, totals }`. Each item: `{ n, artist, kind: 'existing_artist'|'existing_lead'|'new_lead', artistId?, leadId?, leadStatus?, noSongsYet?: boolean, genre, songs: [{ title, state: 'have'|'new'|'listed', haveStatus? }], claims: [{ line, fresh: boolean }], defaultSkip: boolean, skipReason: string|null }`. Rules: artist match (by `leadKey` against `artists.name`) wins over lead match (against `leads.name_key`); `existing_artist` songs are `have` (any status, matched by `keyOf` among that artist's songs; `haveStatus` = the song's status) or `new`; `existing_lead` and `new_lead` songs are `listed`; `claims[].line` = `claimLine({url: thread.url, ...claim}, now)` and `fresh` is false when its `bodyOf` is already in the target's stored `thread_claims` (artist or lead; a new lead has none; a dismissed lead's claims are all `fresh:false`); `noSongsYet` is true for an existing artist with zero songs of any status; `defaultSkip` is true only for `new_lead` with no songs, at least one claim, and every claim status in `not_vegan`/`unsure` (`skipReason: 'nothing to follow up'`). `totals` counts items by kind plus `newSongs`, `freshClaims`.

- [ ] **Step 1: Write failing tests** in `backend/test/threadImport.test.js` (sentinel `ZZZTHR`; fixtures: an artist `ZZZTHR Known` with a live song `ZZZTHR Held` and a pending song, an artist `ZZZTHR Empty` with no songs, leads `ZZZTHR Lead` (new) and `ZZZTHR Gone` (dismissed); cleanup deletes songs, `song_artists`, leads and artists by `ILIKE '%ZZZTHR%'` in dependency order). Assertions:
  - `validate` rejects each malformed case listed above with code `BAD_INPUT` (table-driven), and returns normalised output otherwise.
  - Merge: two mentions `"The ZZZTHR Merge!"` and `"zzzthr merge"` give one mention named by the first spelling, songs unioned (`"Song A"`, `"song a"` once), claims unioned; numbering is 1..N.
  - `plan`: `zzzthr KNOWN` (other case) -> `existing_artist` with the artist id; a named `ZZZTHR Held` -> `have` with `haveStatus 'included'`, a pending one -> `have` `'pending'`, an unheld title -> `new`; `ZZZTHR Empty` -> `noSongsYet`; `The ZZZTHR Lead` -> `existing_lead` with `leadStatus`; `ZZZTHR Gone` -> `existing_lead`, `leadStatus 'dismissed'`, all claims `fresh:false`; an unknown `ZZZTHR Fresh` -> `new_lead` with songs `listed`.
  - `defaultSkip`: unknown band, no songs, one `not_vegan` claim -> true with the reason; same with a `vegan` claim -> false; same with a song -> false; an existing artist with only `unsure` claims -> false.
  - `fresh`: a claim whose body is already stored in the artist's `thread_claims` is `fresh:false`; a different person is `fresh:true`.
  - `plan` writes nothing: row counts of `songs`, `artists`, `leads` are equal before and after.
- [ ] **Step 2: Run to verify failure:** `node --test test/threadImport.test.js` - Expected: FAIL (module missing).
- [ ] **Step 3: Implement `validate` and `plan`** in `services/threadImport.js` per Interfaces. Load artist/lead keys with one `SELECT` each (as `leads.artistsByKey` does - do not export it; reuse `leadKey` and query directly); load the matched artist's songs with one query per matched artist.
- [ ] **Step 4: Run to verify pass:** same command - Expected: PASS.
- [ ] **Step 5: Commit** `feat(thread-import): validate and plan a thread extraction (read-only)`.

---

### Task 3: Apply, origin tag, queue label

**Files:**
- Modify: `backend/services/threadImport.js` (add `apply`), `backend/services/curation.js:163` (origin CASE), `frontend/src/components/admin/SongQueueList.jsx:6` (`ORIGIN_LABELS`), `backend/test/threadImport.test.js`

**Interfaces:**
- Consumes: Task 2's `validate`/`plan`; `leads.addLead`; `staging.insertManualCandidate(db, {title, artistId, note})`; `threadClaims.appendClaimLines`.
- Produces: `async apply(db, extracted, { skip = [], include = [], now = new Date() } = {}) -> { results: [{ n, artist, skipped?: string, lead?: 'added'|'duplicate', songsAdded: number, songsHeld: number, claimsAdded: number, error?: string }] }`. It calls `plan` itself, then for each item: skipped if `skip` has its `n`, or it is `defaultSkip` and `include` lacks its `n` (result `skipped` = reason or `'skipped by you'`). Otherwise, in one transaction per item (a failure rolls back that item only, is recorded as `error: <fixed string 'could not write this item'>` and the loop continues; never put an error message or the pasted text in `error`): `existing_artist` -> insert each `new` song via `insertManualCandidate` with note `added via reddit thread (<url>)` (count `songsAdded`; `songsHeld` = songs already held) and append fresh claim lines to the artist; `existing_lead` (not dismissed) -> append fresh claim lines to the lead; dismissed -> no write; `new_lead` -> `addLead` with `origin:'reddit'`, `url`, `song` (songs joined `"; "`, cut to 255), `note` = genre or null, then append claim lines to the new lead (if `addLead` reports a duplicate lead because of a race, append to that lead instead; a duplicate artist, to that artist).
- `curation.js` origin CASE gains `WHEN s.status_notes LIKE 'added via reddit thread%' THEN 'redditthread'` beside the band-check/cross-check lines; `ORIGIN_LABELS` gains `redditthread: 'From Reddit thread'`.

- [ ] **Step 1: Write failing tests** (same file, same fixtures plus a `ZZZTHR` thread URL):
  - Apply on a fixture with a known artist (one held, one new song, one claim), an unknown band (song, claim, genre), an existing lead (claim) and a dismissed lead (claim): results show `songsAdded 1` / `songsHeld 1`; the new song exists as `status 'pending'`, `data_source 'manual'`, `status_notes` starting `added via reddit thread (`; the new lead exists with `origin 'reddit'`, the thread url, `song`, `note` = genre, and `thread_claims` holding the claim line; the existing lead and the artist gain their claim; the dismissed lead's `thread_claims` is unchanged.
  - Idempotence: running the same `apply` again changes no row counts and `claimsAdded` is 0 everywhere.
  - Skip/include: `skip:[n]` writes nothing for that item; a `defaultSkip` item is not written unless `include` has its `n`.
  - Long input: 12 songs of 40 chars each on an unknown band give a lead `song` of at most 255 chars; a 500-char quote lands as a 200-char quote on one line; a quote with `\n` produces one claim line.
  - Best effort: when `insertManualCandidate` is made to throw for one item (wrap `db` with a `connect` that throws for that item's artist, as `leads.test.js` does for its rollback test), that item's result has `error` set and the other items are still written.
  - Claims on an artist never touch `vegan_advocacy_notes` or `artist_members` and no `songs` row is edited (compare before/after for the fixture artist).
  - The song appears in the curation pending queue read with `origin 'redditthread'` (use the same read the origin tests in `curation.test.js` use).
- [ ] **Step 2: Run to verify failure.** Expected: FAIL (`apply` not a function).
- [ ] **Step 3: Implement `apply`, the `curation.js` CASE line and the label** per Interfaces.
- [ ] **Step 4: Run to verify pass:** `node --test test/threadImport.test.js test/curation.test.js` - Expected: PASS.
- [ ] **Step 5: Commit** `feat(thread-import): apply approved items; "From Reddit thread" origin`.

---

### Task 4: Overview text and CLI script

**Files:**
- Modify: `backend/services/threadImport.js` (add `formatOverview`), `backend/test/threadImport.test.js`
- Create: `backend/scripts/importThread.js`; modify `backend/scripts/README.md` (one entry)

**Interfaces:**
- Produces: `formatOverview(planResult) -> string` - plain text: a header line (thread title/url), a totals line (`N bands: A already artists, L already leads, W new leads · S new songs · C new claim lines`), then one block per item: `#<n> <artist> - <label>` where label is `already an artist` (add ` (no songs yet)` when `noSongsYet`), `already a lead (<status>)`, or `NEW lead`; an indented line per song (`have it (<status>)`, `NEW song`, or `named`), an indented line per claim (`new: <line>` or `already noted`), and `[skipped by default: <reason>]` on `defaultSkip` items.
- Script usage: `node scripts/importThread.js --file <abs path to json> [--apply] [--skip 4,9] [--include 12]`. Dry-run prints `formatOverview(plan(...))` and the line `Dry run - nothing written. Re-run with --apply to write.`; `--apply` runs `apply` and prints one line per result (`#n artist: lead <x>, songs +a (held h), claims +c` / `skipped: ...` / `ERROR: ...`). Exits non-zero with a one-line message on unreadable file or `BAD_INPUT`; always closes the pool.

- [ ] **Step 1: Write failing test** for `formatOverview` on a hand-built plan object (one of each kind): assert exact lines for the totals line and each label above, and that a skipped item shows the bracketed reason.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `formatOverview` and the script** per Interfaces; parse `--skip`/`--include` as comma-separated integers.
- [ ] **Step 4: Verify:** run the test; then dry-run the script on a small throwaway JSON in the scratchpad against the real local DB (read-only; use an unlikely band name) and confirm the output and that row counts did not change. Do not `--apply` against real data.
- [ ] **Step 5: Commit** `feat(thread-import): overview text and importThread script`.

---

### Task 5: Claims in the admin UI

**Files:**
- Modify: `frontend/src/components/admin/ArtistWorkbench.jsx` (Notes section, ~line 88), `frontend/src/components/admin/LeadsArea.jsx` (lead row, ~line 108)

**Interfaces:**
- Consumes: `artist.thread_claims` (from `GET /api/admin/artists/:id`), `l.thread_claims` (from the leads list), the existing `save({ ... })` and `AutoText` in the workbench.

- [ ] **Step 1: Artist workbench.** In the Notes panel add `<AutoText label="Claims from threads (admin only)" initial={artist.thread_claims} multiline rows={4} onSave={(v) => save({ thread_claims: v })} />` under the Catalogue review notes field.
- [ ] **Step 2: Leads tab.** Under the song/link line, when `l.thread_claims` is non-empty, render it read-only as a small block (`className="band-meta"`, `style={{ whiteSpace: 'pre-wrap' }}`) preceded by the label `Claims:`.
- [ ] **Step 3: Verify:** `cd frontend && npm run lint && npm run build` - Expected: 0 errors, build clean. Then load `/admin` pages via the throwaway mock-harness method in memory (never type ADMIN_PASSWORD) or, if that is not practical, state plainly that the UI was not browser-checked.
- [ ] **Step 4: Commit** `feat(admin): show thread claims on artists and leads`.

---

### Task 6: The skill, docs, full verification

**Files:**
- Create: `.claude/skills/reddit-thread-import/SKILL.md`
- Modify: `docs/PROJECT_STATE.md` (Current State entry, Next Tasks, Decision Log, Changelog), `docs/PROJECT_PLAN.md` (mark piece 4; Backlog: artist-facts proposer deferred), `CLAUDE.md` (add `services/threadImport.js` + `threadClaims.js` to the Backend Structure list), `backend/scripts/README.md` if not done

**Interfaces:**
- SKILL.md has frontmatter `name: reddit-thread-import` and a `description` that triggers on "paste a Reddit thread", "extract bands from this thread", "thread import". Body steps, in order: (1) ask for the thread URL if not given; (2) extract mentions into the JSON shape in the spec, ignoring ads/usernames/votes/jokes/self-promotion/off-topic, merging repeats, never recording commenter usernames, quotes <= 200 chars, one `claims` entry per person per status with `disputed`/`dispute` set when the thread disputes it; (3) write the JSON to the session scratchpad (absolute path) and run `node scripts/importThread.js --file <path>` from `backend/` (dry run); (4) show the overview and ask for approval by number ("go", "go except 4, 9", "include 12"); (5) on approval run again with `--apply` and `--skip`/`--include`; (6) report the result lines; never run `--apply` without approval, never write to the DB any other way, never use the admin password, never `taskkill` node.

- [ ] **Step 1: Write SKILL.md** per Interfaces (keep it under ~80 lines; include the JSON shape and the five `status` values verbatim).
- [ ] **Step 2: Full verification:** `cd backend && npm test` (serial) - Expected: all PASS, count reported; `cd frontend && npm run lint && npm run build` - 0 errors.
- [ ] **Step 3: Docs per the End-Session Guide:** update PROJECT_STATE.md (new top Current State entry with what was built, the migration to apply elsewhere, the curator smoke steps from the spec written out in full, NEXT), PROJECT_PLAN.md, CLAUDE.md as listed; add a Decision Log line (claims in their own field, not `vegan_advocacy_notes`; artist-facts proposer dropped).
- [ ] **Step 4: Commit and push** `feat: Reddit thread skill (piece 4)` plus docs, then ask the curator to run the smoke on the real example thread (a live dry-run on pasted text is the first real test of the extraction step).
