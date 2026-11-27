# Check transcripts: confidence sort, filter and details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Songs admin **Check transcripts** rail shows each AI draft's confidence details, sorts best/worst first, filters by tier, and no longer hides UNINTELLIGIBLE drafts.

**Architecture:** `services/curation.js` (the only file allowed to name `song_audio_transcripts`) widens what counts as a draft, joins the newest usable transcript row to the queue list for that one queue, orders by tier then score in SQL, and adds the new fields to `draft_transcript`. A pure frontend helper formats badge/pills; `SongQueueList` and `DraftTranscript` render them.

**Tech Stack:** Node/Express, `pg`, `node:test` (backend serial: `cd backend && npm test`); React/Vite, frontend `node --test`, `npm run lint`, `npm run build`.

**Spec:** `docs/superpowers/specs/2026-11-26-check-transcripts-confidence-design.md` (read it first). Handoff: `docs/MAIN_PROJECT_LYRIC_V2_HANDOFF.md`.

## Global Constraints

- Branch `session-check-transcripts` (from `main`); not merged or pushed until the curator says "Merge". `git add` explicit paths only; commit with `git commit -F <file>`; trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Only `backend/services/curation.js` may name `song_audio_transcripts` (`lyrics_privacy.test.js` enforces it). No list response, public route or log may carry transcript text or `confidence_notes`; the list row carries only the six scalar fields below.
- No migration, no new table, no new route (the existing `GET /api/admin/curation/queue` gains two query params).
- Draft = row with `status IN ('OK','UNINTELLIGIBLE')` and non-blank `transcript`. Tier = `'UNINTELLIGIBLE'` when `status = 'UNINTELLIGIBLE'`, else `confidence` (`HIGH`/`MEDIUM`/`LOW`). Tier rank HIGH 3, MEDIUM 2, LOW 1, UNINTELLIGIBLE 0.
- Sort key for `best`: tier rank desc, then `COALESCE(confidence_score, midpoint)` desc (midpoints HIGH 90, MEDIUM 67, LOW 35, UNINTELLIGIBLE 10), then `s.id` asc; `worst` reverses the first two and keeps `s.id` asc. No `sort` = `s.id` asc as today. `sort` and `tier` are valid only for `check-transcripts` (else `BAD_QUEUE`).
- Language suggestions and `needs-lyrics` / `to-transcribe` queues stay as they are (OK-only suggestions).
- Backend test sentinel for the new file: `ZZZCKT` (song titles); fixture songs are never published; deleting a song cascades its transcript row.
- Use design tokens only for colour (green = `--accent-moss-60`, amber and red from existing tokens; check `.miss-chip.warn` and `--accent-ember-*` in `styles/admin.css` / `tokens/colors.css`).

## Review Focus

- A song with two transcript rows: the newest usable one drives tier and details (Task 1 test).
- Unscored HIGH drafts (the 91 older rows) sort above every scored LOW and UNINTELLIGIBLE draft in `best` (Task 1 test).
- Paging with a sort is stable: two pages of `limit 2` are disjoint and together equal the full sorted list (Task 1 test).
- Search text and sort/filter combine (`q` + `tier`) (Task 1 test).
- A blank-text UNINTELLIGIBLE row is not a draft (Task 1 test); a row with null score, clarity, accuracy and inaudible count renders without "null" or "undefined" text (Task 3 tests).

---

### Task 1: Queue list: drafts include UNINTELLIGIBLE, tier/sort/filter, row fields

**Files:**
- Modify: `backend/services/curation.js` (`HAS_DRAFT_SQL` ~L88, `listCurationQueue` ~L203, `mapQueueRow` ~L176, exports)
- Modify: `backend/routes/admin.js` (`GET /curation/queue`, ~L1786)
- Create: `backend/test/checkTranscripts.test.js` (sentinel `ZZZCKT`)

**Interfaces:**
- Produces: `listCurationQueue(db, { queue, q, limit, offset, pair, sort = null, tier = null })`; for `queue === 'check-transcripts'` each row has `transcript: { tier, confidence, confidence_score, estimated_word_accuracy_pct, audio_clarity, inaudible_segments }` (values from the newest usable transcript row, nulls kept). Exports `TRANSCRIPT_TIERS = ['HIGH','MEDIUM','LOW','UNINTELLIGIBLE']`.
- Errors: `sort` not in `['best','worst']`, `tier` not in `TRANSCRIPT_TIERS`, or either given for another queue -> the existing `BAD_QUEUE` code (route answers 400 `Unknown queue`).

- [ ] **Step 1: Write the failing tests** in `checkTranscripts.test.js` with helpers `mkSong(title)` (included, unpublished, `data_source 'manual'`) and `addTranscript(songId, { status='OK', confidence, score, accuracy=null, clarity=null, inaudible=null, notes=null, text, model='zzzckt-m', at='2026-11-02 10:00:00' })` inserting into `song_audio_transcripts` (columns `confidence_score`, `estimated_word_accuracy_pct`, `audio_clarity`, `inaudible_segments`, `confidence_notes`); fixtures: A HIGH 95, B HIGH unscored, C MEDIUM 70, D LOW 40, F UNINTELLIGIBLE score 10, all titled `ZZZCKT <letter>`; every list call passes `q: 'ZZZCKT'`. Tests: (a) `check-transcripts` includes F and its `row.transcript.tier === 'UNINTELLIGIBLE'`; a blank-text UNINTELLIGIBLE song is absent; (b) `sort:'best'` ids equal `[A,B,C,D,F]` (B above D proves unscored-HIGH placement) and `'worst'` equals `[F,D,C,B,A]`; no `sort` is ascending id; (c) `tier:'HIGH'` returns exactly `[A,B]`, `tier:'UNINTELLIGIBLE'` exactly `[F]`; (d) paging: `sort:'best', limit:2, offset:0` then `offset:2` then `offset:4` concatenate to `[A,B,C,D,F]` with no repeat; (e) two rows for one song (older HIGH model, newer LOW model `at '2026-11-03 10:00:00'`) -> the row shows tier `LOW`; (f) `sort:'sideways'`, `tier:'EXTREME'`, and `sort:'best'` with `queue:'needs-lyrics'` each reject with `code === 'BAD_QUEUE'`; (g) `JSON.stringify(rows)` contains neither the transcript text nor the `confidence_notes` text; (h) `queueCounts(pool)['check-transcripts']` equals the length of an unfiltered `listCurationQueue` for that queue (no `q`, no `limit`).
- [ ] **Step 2: Run** `cd backend && node --test test/checkTranscripts.test.js`; expect FAIL.
- [ ] **Step 3: Implement.** `HAS_DRAFT_SQL` accepts both statuses. In `listCurationQueue`, only for `check-transcripts`: `LEFT JOIN LATERAL` a subquery picking the newest usable row (`ORDER BY transcribed_at DESC NULLS LAST LIMIT 1`), select its six fields (tier computed in SQL, aliases such as `tr_tier`), add them to the `GROUP BY`, optional `AND <tier SQL> = $n` for `tier`, and the order clause per Global Constraints (`ORDER BY s.id` otherwise); `mapQueueRow` adds `transcript` when `tr_tier` is present. Validate `sort`/`tier` up front (throw the same `BAD_QUEUE` error as `pair`). Export `TRANSCRIPT_TIERS`. In the route, pass `sort: sort || null, tier: tier || null` from `req.query`.
- [ ] **Step 4: Run** the new file, then `node --test test/languageCapture.test.js` (its "only OK transcripts are offered" message should read "only OK and UNINTELLIGIBLE transcripts are offered"; update that message only, the `ERROR` assertion stays), then the whole backend `npm test` (serial); expect all green including `lyrics_privacy.test.js`.
- [ ] **Step 5: Commit** `feat(transcripts): include unintelligible drafts, sort and filter the Check transcripts queue`.

### Task 2: Workbench draft carries the confidence details

**Files:**
- Modify: `backend/services/curation.js` (`draftTranscript` ~L338)
- Modify: `backend/test/checkTranscripts.test.js`

**Interfaces:**
- Produces: `getWorkbench(...).draft_transcript` gains `status`, `tier`, `confidence_score`, `estimated_word_accuracy_pct`, `audio_clarity`, `inaudible_segments`, `confidence_notes` (existing fields unchanged; `confidence` stays the raw column). The draft now exists for `UNINTELLIGIBLE` rows too, newest row first.

- [ ] **Step 1: Write the failing tests:** (a) a song with a scored OK transcript -> every new field matches the row and `tier` equals `confidence`; (b) an UNINTELLIGIBLE song -> `draft_transcript.status === 'UNINTELLIGIBLE'` and `tier === 'UNINTELLIGIBLE'`; (c) an old-style row with all five new columns NULL -> those fields are `null` (not undefined) and the draft is still returned; (d) the UNINTELLIGIBLE row's `detected_languages` do not appear in `language_suggestions` (suggestions stay OK-only).
- [ ] **Step 2: Run** the file; expect FAIL.
- [ ] **Step 3: Implement** the widened query and the extra fields in `draftTranscript`; tier computed in JS from `status` and `confidence`.
- [ ] **Step 4: Run** the new file and the whole backend suite; expect green.
- [ ] **Step 5: Commit** `feat(transcripts): the draft carries confidence details`.

### Task 3: Pure display helper

**Files:**
- Create: `frontend/src/utils/transcriptConfidence.js`, `frontend/src/utils/transcriptConfidence.test.js`

**Interfaces:**
- Produces (all pure; lookups through `Map`): `badgeText({ tier, confidence_score }) -> string` (`'HIGH · 95/100'`; `'HIGH'` when the score is null/undefined; `'UNINTELLIGIBLE · 10/100'` likewise), `toneOf(tier) -> 'good' | 'mid' | 'low'` (HIGH good, MEDIUM mid, LOW and UNINTELLIGIBLE and anything unknown low), `clarityLabel(code) -> string | null` (`CLEAR` Clear, `MODERATE` Moderate, `MUDDY_OR_BURIED` Muddy / Buried, `EXTREME_UNINTELLIGIBLE` Extreme / Unintelligible; null/unknown -> null), `pillTexts({ audio_clarity, estimated_word_accuracy_pct, inaudible_segments }) -> string[]` in that order: clarity label, `~95% words`, `6 [inaudible]` (the last only when > 0; any null/undefined field is omitted), and the option lists `TIER_OPTIONS = [['', 'All'], ['HIGH','High'], ['MEDIUM','Medium'], ['LOW','Low'], ['UNINTELLIGIBLE','Unintelligible']]`, `SORT_OPTIONS = [['best','Highest confidence first'], ['worst','Lowest confidence first']]`.

- [ ] **Step 1: Write the failing tests** asserting every example above exactly, plus: `badgeText({tier:'HIGH'})` is `'HIGH'`; `pillTexts({})` is `[]`; `pillTexts({inaudible_segments:0})` is `[]`; `clarityLabel('constructor')` is `null`; `toneOf('constructor')` is `'low'`; no output string contains `null` or `undefined`.
- [ ] **Step 2: Run** `cd frontend && node --test src/utils/transcriptConfidence.test.js`; expect FAIL.
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run** the file, then every frontend test (`node --test $(git ls-files 'src/**/*.test.js') src/utils/transcriptConfidence.test.js` until the new files are tracked); expect pass.
- [ ] **Step 5: Commit** `feat(transcripts): confidence display helper`.

### Task 4: Rail controls, row tags and draft panel

**Files:**
- Modify: `frontend/src/components/admin/SongQueueList.jsx`, `frontend/src/components/admin/DraftTranscript.jsx`, `frontend/src/styles/admin.css` (rail tags and toolbar) and `frontend/src/styles/components.css` (next to `.wb-draft*`, ~L3231)

**Interfaces:**
- Consumes: Task 1 row `transcript` object and the route's `sort`/`tier` params; Task 2 `draft_transcript` fields; Task 3 helpers.
- Produces: CSS classes `tr-badge` with `tr-good` / `tr-mid` / `tr-low`, `tr-pill`, `tr-warn`, `tr-note` (names are the builder's if a clash exists).

- [ ] **Step 1: `SongQueueList.jsx`.** State `sort` (default `'best'`) and `tier` (default `''`), both reset with `page` when `queue` changes; for `queue === 'check-transcripts'` only, render two `select.input` controls in the toolbar (`aria-label="Sort by confidence"` using `SORT_OPTIONS`, `aria-label="Confidence tier"` using `TIER_OPTIONS`), each change sets page 0, and add `sort` and `tier` (when non-empty) to the request query and the `load` dependencies. Each row of that queue shows, after the title block, a badge (`badgeText`, class by `toneOf`) and one small `tr-pill` per `pillTexts` entry; nothing when `row.transcript` is absent.
- [ ] **Step 2: `DraftTranscript.jsx`.** Replace the plain `confidence` phrase in the meta line with the badge plus pills (same helpers), keep word count, languages, model and the Listen link; when `draft.confidence_notes` exists show it as a `tr-note` paragraph directly above the textarea; when `draft.status === 'UNINTELLIGIBLE'` show a `tr-warn` line above the notes ("The analysis could not make out most of this track. Check it against the audio before saving."). Save as lyrics stays enabled.
- [ ] **Step 3: CSS** for the new classes from existing tokens only (rail tags small like `.origin-tag`; badge a little heavier); no raw colours.
- [ ] **Step 4: Run** `npm run lint` (0 errors; the four existing warnings are expected) and `npm run build`; expect clean.
- [ ] **Step 5: Look at it in a browser** through a throwaway mock harness outside the repo (see the memory note on the admin mock harness: port 5199, alias `api/adminApi.js` to a mock `adminFetch` returning canned rows incl. an unscored one and an UNINTELLIGIBLE one; stub `window.confirm`; stop only your own PID): the two selects change the request query, badges and pills read right in all three tones, null fields leave no gaps or the word "null", the draft panel shows notes above the textarea and the warning for an UNINTELLIGIBLE draft. Fix what it shows.
- [ ] **Step 6: Commit** `feat(transcripts): confidence controls, tags and draft details in the admin`.

### Task 5: Docs and verification

**Files:**
- Modify: `docs/PROJECT_STATE.md`, `CLAUDE.md`

- [ ] **Step 1: `PROJECT_STATE.md`:** a Current State entry (what changed, files, verified counts, what was not seen, the curator smoke steps: open Songs > Check transcripts, the list shows badges and pills and defaults to Highest confidence first, switch to Lowest and to each tier, UNINTELLIGIBLE appears under All and under its own filter, open a HIGH draft and an UNINTELLIGIBLE one and read the note and warning, Prev/Next follows the sorted order, the Dashboard tile count rose by the UNINTELLIGIBLE drafts), a Next Tasks line, a Decision Log entry (tier-first ordering with midpoint placement for unscored rows; UNINTELLIGIBLE in All; UI default best-first, API default unchanged) and a Changelog entry.
- [ ] **Step 2: `CLAUDE.md`:** in the "Language + draft-transcript review" bullet, update the draft definition (OK or UNINTELLIGIBLE, newest row), the new `draft_transcript` fields and the queue's `sort` / `tier` params and tier-first order.
- [ ] **Step 3: Verify and record the real numbers:** backend `npm test` (serial), frontend `node --test` over every `*.test.js` under `src`, `npm run lint`, `npm run build`; confirm `lyrics_privacy.test.js` passed.
- [ ] **Step 4: Commit** `docs: check-transcripts confidence sort and filter`.
