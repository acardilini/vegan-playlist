# Audio switch (Step B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the website and admin from the old audio data to `song_audio_analysis`, add The Sound section, the curator-gated samples, the new Sound filters and the Needs sample approval queue, and remove every old audio connection.

**Architecture:** A pure codebook service (`acousticCodebook.js`, rewritten over the new JSON) plus one DB service (`audioAnalysis.js`) that owns "a song's audio row" (`LATEST_AUDIO`), the public block, facets, mood and the samples gate. Everything else (browse filters, routes, admin, explore, reference) consumes those two. Old acoustic code is deleted, not kept beside the new.

**Tech Stack:** Node/Express, PostgreSQL (`pg`), `node:test` (serial), React/Vite, esbuild (headless render checks).

**Spec:** `docs/superpowers/specs/2026-11-22-audio-switch-design.md` (read it first; this plan only adds names, signatures and tests).

## Global Constraints

- The web app only READS `song_audio_analysis`; never write it. The one new writable thing is `songs.show_audio_samples BOOLEAN NULL` (NULL = not reviewed = hidden, TRUE = show, FALSE = hidden after review).
- Public reads keep `status='included' AND published=true`. Hidden or unreviewed sample data (details, types, filter membership, reference counts) must never leave the server for a public route.
- A song's audio row = its `audio_status='OK'` row with the latest `analyzed_at` (`ORDER BY analyzed_at DESC NULLS LAST, model_used DESC`). A newer non-OK row never hides an older OK row.
- Codes are stored UPPER_SNAKE; labels from the codebook. Display ungated (unknown code title-cases); filter selections gated by `cleanSelection`. Codes with `hidden_in_ui` (`NONE`) never display, filter or count.
- Site labels: Mood, Intensity, **Production** (override of codebook name "Sound"), Dynamics, Vocals, Rhythm, Instruments, Audio samples, Tempo.
- Backend tests: `cd backend && node --test --test-concurrency=1`; every new test file uses its own fixture sentinel (`ZZZAUD`, `ZZZAAD`) and cleans up after itself. Frontend node tests: `cd frontend && node --test`. Never run `taskkill /IM node.exe`; stop spare-port servers by PID.
- Use `git add` with explicit paths; commit via `git commit -F <scratchpad file>`; messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Edit files per hunk (Edit tool), never whole-file PowerShell rewrites.
- No new dependency. Migrations are additive and idempotent.

## Review Focus

1. A song with samples that is unreviewed (NULL) or hidden (FALSE): no sample data in `getSongAudio`, no `audio_samples` count in facets, not matched by the `audio_samples` filter, not counted on the Reference page. (Tasks 2, 3, 9)
2. A song whose only audio rows are UNAVAILABLE / TOO_LONG / ERROR, or whose newest row is an ERROR beside an older OK row: no Sound section, no mood badge, absent from sound filters / counts; OK older row still used when a newer non-OK row exists. (Task 2)
3. A song with audio but no usable lyric analysis: the song page still shows The Sound (the analysis route must not 404). (Task 4)
4. Hand-edited URLs: old keys (`sonic_energy`...) ignored, invented codes dropped, `tempo_from=NaN` ignored, all still 200. (Task 3)
5. Sparse rows: one mood, zero instruments (a cappella), `audio_samples = {NONE}`, `UNMETERED` / null tempo: rows omitted or tempo hidden, no empty labels or "undefined". (Tasks 2, 7)

---

### Task 1: Rewrite the codebook service over the new JSON

**Files:**
- Modify (rewrite): `backend/services/acousticCodebook.js`
- Modify (rewrite): `backend/test/acousticCodebook.test.js`

**Interfaces:**
- Produces (pure, no DB):
  - `DIMENSIONS: Array<{key, column, heading, multi, name, description}>` in page order: `musical_mood` (Mood, multi), `sonic_intensity` (Intensity), `production_texture` (Production), `dynamic_arc` (Dynamics), `vocal_style` (Vocals, multi), `rhythmic_feel` (Rhythm), `instrumentation` (Instruments, multi). `column === key`. `name`/`description` come from the codebook.
  - `SAMPLES = {key:'audio_samples', column:'audio_samples', heading:'Audio samples', multi:true, name, description}`; `TEMPO = {key:'tempo_bpm', column:'tempo_bpm', heading:'Tempo'}`.
  - `FILTER_KEYS: string[]` (the seven dimension keys then `audio_samples`); `SINGLE_KEYS: string[]` (the three non-multi dimension keys: `sonic_intensity`, `production_texture`, `dynamic_arc`).
  - `codeLabel(key, code)`, `codeDefinition(key, code)` (the code's `listener_description`), `aiDefinition(key, code)` (its `ai_definition`), `componentName(key)`, `componentDescription(key)`, `optionsFor(key): {code,label}[]` (codebook order, `hidden_in_ui` omitted), `cleanSelection(key, values): string[]`.
  - `selectionClauses(sel, startIndex, alias='sau'): {clauses, params, needsJoin, nextIndex}` — multi: `${alias}.${col} && $n::text[]`; single: `${alias}.${col} = ANY($n::text[])`; `audio_samples`: `(${alias}.audio_samples && $n::text[] AND s.show_audio_samples IS TRUE)`.
  - `objectiveMetrics(): Array<{key,label,description,source}>` for `tempo_bpm`, `musical_key`, `loudness_lufs` (labels Tempo / Key / Loudness; text from `objective_metrics`).
- Removed: `COMPONENTS`, `COMPONENT_KEYS`, `acousticSelectionClauses`, `derivationSource`, `codeThreshold`.

- [ ] **Step 1: Write the failing tests** replacing the old file's cases: dimension order and headings (Production override; `name` still the codebook's "Sound"); `optionsFor('musical_mood')` has 9 codes, `optionsFor('audio_samples')` has 5 (no `NONE`); `codeLabel('musical_mood','FEROCIOUS_AGGRESSIVE') === 'Aggressive'`; unknown code `'SOME_NEW_CODE'` → `'Some New Code'`; `cleanSelection('audio_samples',['NONE','NATURE_ANIMAL_SOUNDSCAPE','x'])` → `['NATURE_ANIMAL_SOUNDSCAPE']`; `selectionClauses` for mood+intensity gives `sau.musical_mood && $1::text[]` and `sau.sonic_intensity = ANY($2::text[])` with `nextIndex` 3, and the samples clause contains `s.show_audio_samples IS TRUE`; selection of an unknown key or an old key (`sonic_energy`) yields no clause; `objectiveMetrics()` has 3 entries.
- [ ] **Step 2: Run** `node --test test/acousticCodebook.test.js` — expect FAIL (old module shape).
- [ ] **Step 3: Rewrite `acousticCodebook.js`** to the interface above, reading `codebook.dimensions[key]`; build `CODES[key]` as `Map(code -> entry)` once; the heading override lives in one `HEADINGS` constant.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** (`backend/services/acousticCodebook.js`, `backend/test/acousticCodebook.test.js`, `backend/data/acoustic_codebook.json`) — "feat(audio): codebook service over the new acoustic codebook". Other modules still fail until their tasks; that is expected on the branch.

### Task 2: `audioAnalysis` service, migration 021 and its tests

**Files:**
- Create: `backend/database/migrations/021_show_audio_samples.sql` (`ALTER TABLE songs ADD COLUMN IF NOT EXISTS show_audio_samples BOOLEAN;` — apply to the dev DB with psql/the pool)
- Create: `backend/services/audioAnalysis.js`
- Create: `backend/test/audioAnalysis.test.js` (sentinel `ZZZAUD`)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `LATEST_AUDIO: string` — drop-in subselect for JOINs: `(SELECT DISTINCT ON (song_id) * FROM song_audio_analysis WHERE audio_status = 'OK' ORDER BY song_id, analyzed_at DESC NULLS LAST, model_used DESC)`.
  - `audioColumnSql(column: string, songExpr = 's.id'): string` — scalar subquery for one column of the latest OK row (column must be one of a whitelist: the dimension columns, `tempo_bpm`, `musical_key`).
  - `MOOD_SUBQUERY(songExpr = 's.id')` = `(audioColumnSql('musical_mood', songExpr))[1]` as the first mood code; `attachMood(rows): rows` maps each row's `mood_code` to `mood` (codebook label or `null`) and deletes `mood_code`.
  - `getSongAudio(db, songId): Promise<null | {summary, rows: Array<{key,label,description,values:Array<{code,label,definition}>}>, tempo_bpm: number|null, key: string|null, samples: null | {types: Array<{code,label}>, items: Array<{type,label,timestamp,description,transcript,source}>}}>` — `rows` in `DIMENSIONS` order, empty arrays omitted; `tempo_bpm` null when null or `tempo_stability === 'UNMETERED'`; `key` is `musical_key`; `samples` non-null only when the song's `show_audio_samples IS TRUE` and the row has non-NONE samples; `null` when no OK row.
  - `getAdminAudio(db, songId)`: same shape but samples always present when they exist, plus `{status, model, analyzed_at, loudness_lufs, tempo_stability, show_audio_samples}`; `null` when the song has no audio row at all (`status` = the latest row's `audio_status`).
  - `audioFacets(db, constraints = {}): Promise<{[key]: {key, heading, multi, description, options: Array<{code,label,count}>}}>` — `constraints[key] = {joinSql, where, params}` as in the old `acousticFacets`; keys `FILTER_KEYS`; `audio_samples` counts only songs with `show_audio_samples IS TRUE`; the live gate applies.
  - `tempoRange(db): Promise<{min_bpm, max_bpm}>`; `coverage(db): Promise<{analysed, pct?, models: Array<{model, songs}>, latest: string|null}>` (live songs with an OK row).
  - `SAMPLES_PENDING_SQL(alias = 's')`: `${alias}.show_audio_samples IS NULL AND EXISTS (OK row with audio_samples non-empty and not exactly {NONE})` for the admin queue.

- [ ] **Step 1: Write failing tests** (create fixture songs + rows under `ZZZAUD`, clean up in `after`): `getSongAudio` returns null with only an ERROR row; uses the OK row when a newer ERROR row exists; rows are ordered and omit empty arrays (a cappella song: no Instruments row); `tempo_bpm` null for UNMETERED; samples null for NULL and FALSE, present for TRUE with labelled items; `audioFacets` mood counts equal a direct count; `audio_samples` facet counts only approved songs; exclude-self constraint widens a count; `attachMood` maps `FEROCIOUS_AGGRESSIVE` to `Aggressive` and a missing code to `null`; `getAdminAudio` returns samples for an unreviewed song.
- [ ] **Step 2: Run** `node --test --test-concurrency=1 test/audioAnalysis.test.js` — expect FAIL (module missing).
- [ ] **Step 3: Apply migration 021 and implement `audioAnalysis.js`** to the interface; build facet counts with the `countByCode` pattern from `services/analysis.js` (unnest for multi columns); the `samples` text for items prefers `description`, includes `transcript_excerpt` as `transcript` and `speaker_or_source` as `source` (only when non-null).
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** (migration, service, test) — "feat(audio): audioAnalysis service, samples gate column".

### Task 3: Browse filters, facets and the search/facet routes

**Files:**
- Modify: `backend/services/browseFilters.js` (replace the acoustic block and the tempo clauses with an audio block; `joins.audio`; `joinSql` adds `JOIN ${audio.LATEST_AUDIO} sau ON sau.song_id = s.id`)
- Modify: `backend/services/analysis.js` (delete `acousticFacets`, `tempoRange`, the `acoustic` require and export entries)
- Modify: `backend/routes/spotify.js` (`/search` facetJoin adds the audio join; `/browse-facets`: `audio_facets` from `audioAnalysis.audioFacets(pool, audioConstraints)` with one exclude-self constraint per `FILTER_KEYS` built as `browse.buildWhere(f, {exclude: 'audio:' + key, startIndex: 1})`, `tempo_range` from `audioAnalysis.tempoRange`; response keys `audio_facets` and `tempo_range`, `acoustic_facets` removed)
- Modify: `backend/test/browseFilters.test.js`, `backend/test/analysis.test.js` (acoustic cases removed/replaced)

**Interfaces:**
- `buildWhere(filters, {exclude})` reads the new keys from `FILTER_KEYS` (group id `audio:<key>`) via `selectionClauses`, and `tempo_from` / `tempo_to` on `sau.tempo_bpm` (only when `parseInt` is finite).

- [ ] **Step 1: Write failing tests** in `browseFilters.test.js`: `musical_mood=[X]` yields one `sau.musical_mood && ` clause and `joins.audio`; `exclude: 'audio:musical_mood'` drops it; old key `sonic_energy` and invented code produce no clause; `tempo_from='NaN'` produces none; `audio_samples` clause contains the `show_audio_samples` gate.
- [ ] **Step 2: Run** `node --test test/browseFilters.test.js` — FAIL.
- [ ] **Step 3: Implement** the edits above; remove `scalarAnalysis` use for tempo.
- [ ] **Step 4: Run** `node --test --test-concurrency=1 test/browseFilters.test.js test/analysis.test.js test/audioAnalysis.test.js` — PASS (analysis.test.js song-analysis cases for acoustic cells are rewritten in Task 4).
- [ ] **Step 5: Commit** — "feat(audio): browse filters and facets read the new audio rows".

### Task 4: Song analysis API block, public field cleanup, card mood

**Files:**
- Modify: `backend/services/analysis.js` (`getSongAnalysis` drops the six acoustic columns and `acousticCells`, adds `audio: await audioAnalysis.getSongAudio(db, songId)`; returns null only when neither lyric content nor `audio`)
- Modify: `backend/routes/spotify.js` (remove `s.energy, s.danceability, s.valence, s.acousticness, s.instrumentalness, s.liveness, s.speechiness, s.tempo, s.loudness, s.key, s.mode, s.time_signature, s.custom_mood` from the song, search and both featured selects; add `${audioAnalysis.MOOD_SUBQUERY()} AS mood_code` and pass the rows through `audioAnalysis.attachMood`; inspect the `AVG(s.energy...)` stats query near line 860 and delete it with its route if nothing in `frontend/src` reads it)
- Modify: `backend/routes/playlists.js` (same field removal and mood)
- Modify: `backend/test/analysis.test.js`

**Interfaces:** `GET /api/analysis/song/:id` → lyric fields plus `audio` (null or the `getSongAudio` shape); card lists carry `mood` (label or null).

- [ ] **Step 1: Write failing tests:** `getSongAnalysis` for a song with only an OK audio row returns an object whose `audio` is set and lyric arrays are empty (not null); with neither it returns null; `acoustic` key is absent.
- [ ] **Step 2: Run** `node --test --test-concurrency=1 test/analysis.test.js` — FAIL.
- [ ] **Step 3: Implement** the edits. Keep `hasContent` accurate (`audio` counts).
- [ ] **Step 4: Run** the analysis tests — PASS. Then a spare-port check (port 5055, stop by PID afterwards): `/api/analysis/song/:id` for a song with samples hidden has `samples: null`; `/api/spotify/search?limit=2` rows have `mood` and none of the retired field names.
- [ ] **Step 5: Commit** — "feat(audio): song audio block, card mood, retire Spotify-era audio fields from public reads".

### Task 5: Admin backend — Audio panel data, samples approval, queue, legacy writers

**Files:**
- Modify: `backend/services/curation.js` (`getWorkbench` adds `audio: await audioAnalysis.getAdminAudio(db, id)`; new `setAudioSamples(db, id, {show}): Promise<{show_audio_samples: boolean|null}>` accepting `true`, `false` or `null`, anything else `BAD_INPUT`, unknown song `NOT_FOUND`; `QUEUE_NAMES` + `queueWhere` gain `needs-sample-approval` = `s.status='included' AND ${SAMPLES_PENDING_SQL('s')}`)
- Modify: `backend/routes/admin.js` (`router.put('/workbench/:id/audio-samples', panelSave(curation.setAudioSamples))`; remove `energy, danceability, valence, acousticness, instrumentalness, liveness, speechiness, tempo, loudness, custom_mood` from the legacy create/update writers at the lines found by `grep -n "energy\|custom_mood" routes/admin.js`)
- Create: `backend/test/audioAdmin.test.js` (sentinel `ZZZAAD`)

**Interfaces:** consumes `getAdminAudio`, `SAMPLES_PENDING_SQL`; produces the route and the queue name `needs-sample-approval`.

- [ ] **Step 1: Write failing tests:** `setAudioSamples` true/false/null round-trips and rejects `'yes'`; a song with samples and NULL appears in `listCurationQueue({queue:'needs-sample-approval'})`, leaves after `true` or `false`, returns after `null`; a song with only `{NONE}` never appears; `getWorkbench(...).audio` carries samples regardless of the gate.
- [ ] **Step 2: Run** `node --test --test-concurrency=1 test/audioAdmin.test.js` — FAIL.
- [ ] **Step 3: Implement** the edits; remove (not hide) the legacy fields.
- [ ] **Step 4: Run** the new test plus `test/curation*.test.js` — PASS. Spare-port check: the new route answers 401 without the password.
- [ ] **Step 5: Commit** — "feat(admin): audio samples approval, Needs sample approval queue, retire legacy audio writers".

### Task 6: Admin frontend — Audio panel, rail, tile

**Files:**
- Create: `frontend/src/components/admin/AudioPanel.jsx`
- Modify: `frontend/src/components/admin/Workbench.jsx` (mount `<AudioPanel wb={wb} savePanel={savePanel} />` after `DetailsPanel`), `QueueRail.jsx` and `SongsArea.jsx` (`SELECTABLE_QUEUES`) and `Dashboard.jsx` (tile) and `SongQueueList.jsx` (`QUEUE_LABELS['needs-sample-approval'] = 'Needs sample approval'`), `frontend/src/styles/admin.css`

**Interfaces:** `AudioPanel({wb, savePanel})` reads `wb.audio` (the `getAdminAudio` shape or null); control = three radio-style buttons Show / Hide / Not reviewed calling `savePanel('audio-samples', {show: true|false|null})`; shows the status line, summary, code rows (labels), tempo / key / loudness, and the full sample list (type, timestamp, description, transcript) regardless of the gate; when `wb.audio` is null it says "No audio analysis for this song" and shows no control.

- [ ] **Step 1: Implement** the component and wiring, reusing the `wb-genre-opt*` / panel CSS vocabulary and tokens only (no raw colours).
- [ ] **Step 2: Verify:** `cd frontend && npm run lint` (0 errors) and `npm run build` (clean).
- [ ] **Step 3: Headless render check** (the esbuild pattern used for the genre options: bundle entry with `define: {'import.meta.env': '{}'}`, render `AudioPanel` with real-shaped data for: samples unreviewed, approved, none, and no audio) — expect the four states to render the expected controls and text.
- [ ] **Step 4: Commit** — "feat(admin): Audio panel and Needs sample approval queue".

### Task 7: Public frontend — filters, The Sound, mood badge

**Files:**
- Create: `frontend/src/components/TheSound.jsx`, `frontend/src/utils/soundLayout.js` (pure) and `frontend/src/utils/soundLayout.test.js`
- Modify: `frontend/src/utils/browseUrlState.js` (+ `.test.js`): replace the five acoustic keys with `AUDIO_KEYS = ['musical_mood','sonic_intensity','production_texture','vocal_style','rhythmic_feel','instrumentation','dynamic_arc','audio_samples']` (array params, defaults `[]`), keep `tempo_from/tempo_to`
- Modify: `frontend/src/components/SearchAndFilter.jsx` (Sound group from `audio_facets`, label maps, active-filter chips, Tempo section reads `tempo_range`), `ScalarFacetGroups.jsx` (comment text only), `LyricalAnalysis.jsx` (remove the "In the sound" group; render `<TheSound audio={analysis.audio} />` as its own `la-section` after "What it's about"; the early `return null` must also check `analysis.audio`), `MoodBadge.jsx` (use `song.mood`, no label map), `AnalysisReference.jsx` jump-link target unchanged
- Delete: `frontend/src/utils/audioFeatures.js`
- Modify: `frontend/src/styles/components.css` (The Sound section classes, fold)

**Interfaces:**
- `soundLayout.js`: `splitColumns(audio): {left: Row[], right: Row[]}` — left = Mood, Intensity, Production, Dynamics; right = Vocals, Rhythm, Instruments, then a synthesised `{key:'tempo_key', label:'Tempo · Key', text:'107 BPM · F major'}` row when tempo or key exists; rows with no values are dropped. `sampleHeading(samples): string` → `"Samples heard (4)"` with the type labels (`"Advocate Speech"`).
- `TheSound({audio})`: null when `audio` is null; summary block labelled "Sound summary"; two columns from `splitColumns`; a native `<details>` "Samples heard (N)" only when `audio.samples` is non-null, each item showing label, timestamp, description, transcript (italic, only when present) and source (only when present); tempo and key have a tooltip "estimated by software".

- [ ] **Step 1: Write failing node tests:** `soundLayout.test.js` (column split with full data; a cappella song drops Instruments; tempo null leaves only the key; neither → no tempo row; `sampleHeading` counts items) and the updated `browseUrlState.test.js` (new keys round-trip; old `sonic_energy` param is ignored on parse).
- [ ] **Step 2: Run** `cd frontend && node --test` — FAIL.
- [ ] **Step 3: Implement** all edits; delete `audioFeatures.js`.
- [ ] **Step 4: Run** `node --test`, `npm run lint`, `npm run build` — all clean.
- [ ] **Step 5: Headless render** `TheSound` (full data with samples shown; no samples; sparse) via the esbuild pattern and read the output text — expect the summary, both columns, the fold only when samples exist.
- [ ] **Step 6: Commit** — "feat(site): The Sound section, new Sound filters, audio mood badge".

### Task 8: Similar sound and Explore colours

**Files:**
- Modify: `backend/services/explore.js` (`SIMILARITY` sound entry → `{key:'sound', label:'Similar sound', column:'audio_hybrid_embedding', dims: 574, metric:'cosine'}`; delete `zEuclideanSql` and its branch; `cosineSql` adds `array_length(<col>,1) = ${entry.dims}` to the target and candidates when `entry.dims` is set; `mapRows` replaces the six `sla.<old acoustic>` selects with `LEFT JOIN ${audio.LATEST_AUDIO} sau ON sau.song_id = s.id` and selects `sau.sonic_intensity, sau.production_texture, sau.dynamic_arc`; `COLOUR_DIMENSIONS` replaces the five `acoustic.COMPONENTS` entries with `acoustic.SINGLE_KEYS.map(key => ({key, label: heading, source: 'acoustic'}))`; the `acoustic` branches in `labelFor`/`legendFor` use `optionsFor`/`codeLabel` unchanged)
- Modify: `frontend/src/components/explore/exploreUrlState.js` (`DEFAULT_COLOUR = 'sonic_intensity'`) and `exploreUrlState.test.js` (replace `sonic_energy` / `emotional_mood` fixtures), `backend/test/explore.test.js`

- [ ] **Step 1: Write failing tests:** the registry's `sound` entry is cosine over `audio_hybrid_embedding` with `dims` 574 and generates SQL containing `array_length`; the colour menu keys are `sonic_intensity`, `production_texture`, `dynamic_arc`, `focus_amount`, `genre` and the four theme dimensions; `legendFor` for `sonic_intensity` lists codes in codebook order with labels; frontend `deriveColour` falls back to `sonic_intensity`.
- [ ] **Step 2: Run** `node --test --test-concurrency=1 test/explore.test.js` and `cd frontend && node --test` — FAIL.
- [ ] **Step 3: Implement** the edits.
- [ ] **Step 4: Run** both — PASS. Spare-port check: `/api/analysis/explore/points` returns spaces and legends for the new colour keys; `/api/analysis/songs/:id/similar` returns a `sound` tab for a song that has a hybrid embedding.
- [ ] **Step 5: Commit** — "feat(explore): similar sound and colours read the new audio data".

### Task 9: Reference page, coverage, tokens and About copy

**Files:**
- Modify: `backend/services/referenceCodebook.js` (`catalogue().acoustic` built from `acoustic.DIMENSIONS` + `SAMPLES`, each `{key, heading, name, description, codes: [{code, label, definition: aiDefinition, listener: codeDefinition, count: 0}]}` plus `objective: objectiveMetrics()`; `payload` fills counts from `audioAnalysis.audioFacets(db, {})` options (samples counts therefore gated); `coverage` gains `audio: await audioAnalysis.coverage(db)`)
- Modify: `frontend/src/pages/about/AnalysisReference.jsx` (render the new `acoustic` shape: no `derivation_source`, no `threshold`; render `objective` as a short "Measured by software" list; count links use the new filter keys via `termHref`; samples link only when count > 0), `frontend/src/utils/browseUrlState.js` (`termHref` knows the audio keys), `frontend/src/utils/contentTokens.js` (+ test): tokens `audioAnalysed`, `audioAnalysedPct`, `audioModels`, `audioDate` from `coverage.audio`
- Modify: `backend/data/analysis.md` per the approved appendix of the spec (replace "Measuring the sound", the Sound-space and similarity sentences, the genre/mood paragraphs, the Sound bullet; adjust the Holistic sentence to "positioned using both the lyric reading and the audio reading" after checking what the Holistic space uses; add the two "doesn't tell you" paragraphs)
- Modify: `backend/test/referenceCodebook.test.js`

- [ ] **Step 1: Write failing tests:** `catalogue().acoustic` has 8 entries (7 dimensions + samples), no `NONE`, no `threshold`; `payload` mood counts equal `audioFacets` counts; the samples count excludes unapproved songs (fixture under `ZZZAUD`-style sentinel in this file's own sentinel); `coverage.audio.analysed` is a number; `tokenValues` returns the four new tokens and `—` when absent (frontend test).
- [ ] **Step 2: Run** `node --test --test-concurrency=1 test/referenceCodebook.test.js` and `cd frontend && node --test` — FAIL.
- [ ] **Step 3: Implement** the edits. Keep the curator's prose voice; do not invent facts (Holistic sentence: verify against `song_coordinates` usage in `explore.js` before wording).
- [ ] **Step 4: Run** both suites, `npm run lint`, `npm run build` — PASS. Check `GET /api/content/analysis` on a spare-port instance returns the new copy with tokens unreplaced (the frontend substitutes them).
- [ ] **Step 5: Commit** — "feat(about): reference and explainer describe the new audio analysis".

### Task 10: Legacy-name guard, docs, full verification

**Files:**
- Create: `backend/test/legacyAudio.test.js` (pure file scan, no DB, no sentinel)
- Modify: `CLAUDE.md`, `docs/PROJECT_STATE.md` (Changelog + Decision Log + Next Tasks), `docs/PROJECT_PLAN.md`, `docs/PRD.md` only if its feature inventory names the old Sound filters

- [ ] **Step 1: Write the guard test:** recursively read `backend/routes`, `backend/services`, `backend/utils` and `frontend/src` (`.js`, `.jsx`); fail listing file and line if any retired identifier appears: `sonic_energy`, `emotional_mood`, `rhythmic_style`, `acoustic_type`, `vocal_delivery`, `acoustic_facets`, `acousticFacets`, `s.energy`, `s.danceability`, `s.valence`, `custom_mood`, `audioFeatures`, `acousticSelectionClauses`. Allow-list: the guard file itself.
- [ ] **Step 2: Run** it — expect FAIL until stray references are removed; fix each (comments included) until PASS.
- [ ] **Step 3: Full verification:** `cd backend && node --test --test-concurrency=1` (all pass), `cd frontend && node --test && npm run lint && npm run build`; spare-port live checks: a hidden-sample song's `/api/analysis/song/:id` has `samples: null`; `/browse-facets` carries `audio_facets` with no `audio_samples` count above the approved total; a request with `sonic_energy=X&tempo_from=NaN&musical_mood=BOGUS` returns 200; a grep of the JSON of `/search`, `/songs/featured` and a song response shows no retired field names. Stop the spare server by PID.
- [ ] **Step 4: Docs:** CLAUDE.md (Architecture: rewrite the `acousticCodebook` and `explore` notes, add `audioAnalysis`, migration 021, the samples gate, the legacy guard); PROJECT_STATE (changelog entry, Decision Log: samples gate default hidden, mood badge, Similar sound moved into B, Explore colour swap; Next Tasks: Step C, Step D broken-link queue); PROJECT_PLAN (mark Step B built, Step C/D next).
- [ ] **Step 5: Commit and push** `session-audio-switch` (explicit paths), then write the smoke steps in chat (restart the :5000 backend, apply migration 021, approve samples on a song, check The Sound on a song with and without samples, filters, mood badge, About pages).
