# Sample source edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The curator can add, change and clear a source name on a quoted audio sample from the workbench Audio panel, and the site shows it.

**Architecture:** A web-owned table `song_sample_sources` holds the curator's source per (song, sample type, timestamp). `services/audioAnalysis.js` overlays it when it builds sample items (so the public song page, the timeline and the admin panel all see it); `curation.setSampleSource` is the only writer; `AudioPanel.jsx` gets the inline editor. The analysis-owned `song_audio_analysis` is never written.

**Tech Stack:** Node/Express, PostgreSQL (`pg`), `node:test`, React (Vite).

**Spec:** `docs/superpowers/specs/2026-11-23-sample-source-edit-design.md`

## Global Constraints

- Never write `song_audio_analysis` (analysis project owns it). New table is web-owned.
- Table `song_sample_sources`: `song_id` (FK songs ON DELETE CASCADE), `sample_type`, `timestamp` (TEXT exactly as the analysis wrote it), `source` (TEXT, trimmed, 1-200 chars), `updated_at`; PK (`song_id`, `sample_type`, `timestamp`). Migration `023_song_sample_sources.sql`.
- A saved source is served as `source` with `confirmed: true`, on songs whose samples are approved (`songs.show_audio_samples IS TRUE`, gate unchanged).
- The public block must never carry `suggested` or `orphans`. The analysis' non-HIGH guess is admin-only.
- Route `PUT /api/admin/workbench/:id/sample-source`, body `{type, timestamp, source}`, returns the reassembled workbench (like `setAudioSamples`). Plain-text source, no link field. Match on the raw timestamp string.
- Test sentinel `ZZZSMS` (one test file: `backend/test/sampleSources.test.js`). Frontend styling uses design tokens only; reuse `wb-audio-*` classes.
- Work on branch `session-sample-source` from `main`. Git: `git add` explicit paths only (never `git add backend` or `docs` wholesale: `backend/docs/` and `docs/examples/` are deliberately untracked). Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; long messages via `git commit -F <file in the scratchpad>`.

## Review Focus

- Two samples of the same type with different timestamps: saving one must not name the other.
- A saved source on a song whose samples are not approved must not reach the public block.
- Whitespace-only source means clear; a 201-character source is rejected.
- A timestamp that does not match any sample exactly (for example an en dash vs a hyphen) is rejected on save, but an orphaned saved source can still be cleared.
- After the analysis project re-runs and moves a timestamp, the old saved source shows as an orphan to the curator (never silently lost, never public).
- A source containing `<script>` text renders as text (React escapes; no `dangerouslySetInnerHTML`).

---

### Task 1: Table and overlay in `audioAnalysis`

**Files:**
- Create: `backend/database/migrations/023_song_sample_sources.sql`
- Modify: `backend/services/audioAnalysis.js` (`buildSamples`, `buildBlock`, `getSongAudio`, `getAdminAudio`, exports)
- Test: `backend/test/sampleSources.test.js` (new)

**Interfaces:**
- Produces: `audioAnalysis.loadSampleSources(db, songId) -> Promise<Map<string, string>>` keyed `` `${type}|${timestamp}` ``.
- Produces: sample items (public and admin) gain `confirmed: boolean`; **admin only** items gain `suggested: string|null` (the analysis' `speaker_or_source` when it is not what the item's `source` shows) and the admin `samples` gains `orphans: [{type, timestamp, source}]`.
- Consumes: existing `buildSamples(row)` / `buildBlock(row, {withSamples})`; change them to `buildSamples(row, { sources, admin })` / `buildBlock(row, { withSamples, sources, admin })`.

- [ ] **Step 1: Branch and migration.** `git checkout -b session-sample-source` (carries the uncommitted spec/plan docs). Write `023_song_sample_sources.sql` (idempotent `CREATE TABLE IF NOT EXISTS`, PK and FK as in Global Constraints, a header comment saying web-owned and why). Apply it to the dev database (psql, or a scratchpad node script that loads dotenv by absolute path from `backend/.env`); verify with `\d song_sample_sources`.
- [ ] **Step 2: Write the failing tests** in `sampleSources.test.js` (helpers `mkSong`, `mkAudio` copied in shape from `audioAnalysis.test.js`, `after` deleting `songs` titled `ZZZSMS%` then `pool.end()`). Fixture details: A `ADVOCATE_SPEECH_CLIP` `0:44-1:19` quoted, `speaker_or_source: 'ZZZSMS Maybe', identification_confidence: 'MEDIUM'`; B `ADVOCATE_SPEECH_CLIP` `3:00-3:20` quoted, null source, `UNIDENTIFIED`; C `ANIMAL_SLAUGHTER_SFX` `2:00-2:20`, no quote, `speaker_or_source: 'ZZZSMS Doc', HIGH`; `audio_samples: ['ADVOCATE_SPEECH_CLIP','ANIMAL_SLAUGHTER_SFX']`; song approved (`show = true`). Tests:
  - `without a saved source behaves as before`: public A `source === null`, `confirmed === false`; public C `source === 'ZZZSMS Doc'`; admin A `suggested === 'ZZZSMS Maybe'`; admin C `suggested === null`.
  - `a saved source wins, per sample`: insert rows for A (`'ZZZSMS Speaker'`) and C (`'ZZZSMS Override'`); public A `source === 'ZZZSMS Speaker'` and `confirmed === true`; public B `source === null`; public C `source === 'ZZZSMS Override'`.
  - `the public block never carries the guess or orphans`: `JSON.stringify(publicBlock.samples)` contains neither `suggested`, `orphans` nor `ZZZSMS Maybe`.
  - `an unapproved song serves no samples even with a saved source`: same fixture with `show: null`; `getSongAudio(...).samples === null`.
  - `a saved source matching no sample is an orphan, admin only`: row `9:00-9:10`; `getAdminAudio(...).samples.orphans` deep-equals `[{type:'ADVOCATE_SPEECH_CLIP', timestamp:'9:00-9:10', source:'ZZZSMS Gone'}]`; public block has no orphans.
- [ ] **Step 3: Run** `cd backend && node --test test/sampleSources.test.js` — expect FAIL (`confirmed` undefined / table missing before Step 1 applied).
- [ ] **Step 4: Implement** `loadSampleSources` (one query on `song_sample_sources` for the song), thread `sources`/`admin` through `buildSamples` and `buildBlock`; `getSongAudio` passes `admin:false`, `getAdminAudio` passes `admin:true`; both load the map. Rule per item: key `` `${d.type}|${d.timestamp}` `` in the map → `source` = the saved text, `confirmed: true`; else existing HIGH rule, `confirmed: false`. Admin only: `suggested` = `d.speaker_or_source || null` when the item's final `source` is null (else null); `orphans` = map entries matching no detail item. Export `loadSampleSources`.
- [ ] **Step 5: Run** the new file and `node --test test/audioAnalysis.test.js test/audioAdmin.test.js test/audioTimeline.test.js` — all PASS (no regression in existing sample shape).
- [ ] **Step 6: Commit** the migration, `audioAnalysis.js`, the test, and the two spec docs plus this plan plus `docs/PROJECT_STATE.md` (explicit paths).

### Task 2: Writer and route

**Files:**
- Modify: `backend/services/curation.js` (add `setSampleSource`, export it near `setAudioSamples` at ~L553/L732)
- Modify: `backend/routes/admin.js` (one line after L1956)
- Test: `backend/test/sampleSources.test.js`

**Interfaces:**
- Consumes: `audioAnalysis.getAdminAudio(db, id)` (items carry `type`, `timestamp`), `assertSong`, `getWorkbench`.
- Produces: `curation.setSampleSource(db, id, { type, timestamp, source } = {}) -> workbench`; errors `NOT_FOUND`, `BAD_INPUT` (existing `panelSave` maps them to 404/400).

- [ ] **Step 1: Write the failing tests** (same file, calling `curation.setSampleSource(pool, id, ...)`):
  - `saves, replaces and clears`: save A `'  ZZZSMS Speaker  '` → returned `audio.samples.items` for A has `source === 'ZZZSMS Speaker'` (trimmed), `confirmed === true`; save again `'ZZZSMS Other'` replaces (one row in the table); save `'   '` clears → A `source === null`, row gone.
  - `rejects bad input`: missing `type`, missing `timestamp`, non-string `source`, a 201-character source, and a `(type, timestamp)` that is in no sample (including an en-dash version `'0:44–1:19'`) each reject with `code === 'BAD_INPUT'`; unknown song id rejects `NOT_FOUND`; nothing is written in any of these cases.
  - `an orphan can be cleared`: insert an orphan row directly, then `setSampleSource(pool, id, {type, timestamp:'9:00-9:10', source:''})` succeeds and the row is gone.
  - `the other sample of the same type is untouched`: after saving A, B's `source === null`.
- [ ] **Step 2: Run** — expect FAIL (`setSampleSource is not a function`).
- [ ] **Step 3: Implement** `setSampleSource`. Rules: `assertSong`; `type`/`timestamp` non-empty strings and `source` a string, else `BAD_INPUT`; trimmed empty `source` deletes the row (no sample check, so orphans can be cleared); a non-empty source needs length <= 200 and the pair to exist in `getAdminAudio(db, id).samples.items`, else `BAD_INPUT`; upsert with `ON CONFLICT (song_id, sample_type, timestamp) DO UPDATE SET source, updated_at = CURRENT_TIMESTAMP`; return `getWorkbench(db, id)`. Add `router.put('/workbench/:id/sample-source', panelSave(curation.setSampleSource));`.
- [ ] **Step 4: Run** `node --test test/sampleSources.test.js` — PASS. Then run the whole backend suite serially: `cd backend && node --test --test-concurrency=1` — expect all pass (record the count).
- [ ] **Step 5: Route check.** Memory hazard: first check how the :5000 backend was launched (process tree) before claiming it needs a restart. Verify unauthenticated `PUT /api/admin/workbench/1/sample-source` answers 401 on a restarted instance. Do not kill every node process; target the specific PID.
- [ ] **Step 6: Commit** `curation.js`, `admin.js`, the test.

### Task 3: Audio panel editor

**Files:**
- Modify: `frontend/src/components/admin/AudioPanel.jsx` (`SampleList`, its call site at ~L140)
- Modify: `frontend/src/styles/components.css` (next to the existing `wb-audio-*` rules)

**Interfaces:**
- Consumes: `savePanel('sample-source', { type, timestamp, source }) -> Promise<{ok, error}>` (same helper `SampleDecision` uses); items with `source`, `confirmed`, `suggested`, `transcript`, `timestamp`; `samples.orphans`.

- [ ] **Step 1: Implement** `SampleList({ samples, savePanel })` and a small `SourceEditor` in the same file: for an item with both `transcript` and `timestamp`, below the quote show the current `— source` (or "Unidentified source") and an **Add source** / **Edit source** button that opens an inline text input (maxLength 200, label `Source of this sample`), **Save**, **Clear** (when `confirmed`), **Cancel**; show a saved/error tag with the existing `SaveTag` pattern; when `suggested` is set and the item is not `confirmed`, show a muted `AI guessed: <name>` line (admin only). Under the list, if `samples.orphans` is non-empty, a muted note `Saved sources that no longer match a sample:` listing type, timestamp, source and a Clear button each (sends `source: ''`). No `dangerouslySetInnerHTML`.
- [ ] **Step 2: Lint and build:** `cd frontend && npm run lint` (0 errors; 4 pre-existing warnings) and `npm run build` (clean).
- [ ] **Step 3: Visual check** through a throwaway Vite mock harness on :5199 (admin is login-gated; never type `ADMIN_PASSWORD`): a quoted unidentified sample, one with an AI guess, one confirmed, an orphan list; check the editor opens, Save/Clear call the mocked endpoint, and the layout holds at phone width. Delete the harness afterwards (keep it out of the repo; run from the scratchpad).
- [ ] **Step 4: Commit** the two frontend files.

### Task 4: End-of-session checks and docs

- [ ] **Step 1: Smoke the flow on real data (read-only first).** With the backend running: open a song with an unidentified quoted sample in the workbench; confirm the panel offers Add source and, where the analysis guessed, the hint. Ask the curator to do the write steps (they own the data): save a source, open the public song page (the sample must show `— <source>`; a song whose samples are not approved must not), clear it, and check it returns to Unidentified.
- [ ] **Step 2: Update docs:** `docs/PROJECT_STATE.md` (Current State entry, Changelog entry, remove "not built" wording on the sample item), `docs/PROJECT_PLAN.md` if it lists the item, and `CLAUDE.md`'s `audioAnalysis` paragraph (one sentence: curator-saved sources overlay samples; table `song_sample_sources`; admin-only `suggested`/`orphans`; migration 023 must be applied on other environments).
- [ ] **Step 3: Commit and push** the branch; **wait for the curator's "Merge"** before merging to `main`.
