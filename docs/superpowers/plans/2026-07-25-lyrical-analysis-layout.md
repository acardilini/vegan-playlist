# Lyrical-Analysis Layout Rework — Implementation Plan

> **POST-BUILD CORRECTION (commit `e25d300`):** the summary source in this plan is wrong. The "In short"
> summary comes from `song_lyric_analysis.**lyric_summary**` (populated for 668/672 live songs), NOT
> `explanation` (empty everywhere). Every `explanation` in the code listings below (SELECT, `hasContent`,
> the return field, and the test fixtures/assertions) became `lyric_summary` (column) / `summary` (the API
> field the JSX reads). See the spec's "Correction" note. The rest of the plan executed as written.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the song-page Lyrical Analysis section (Option C layout + clearer naming + evidence next to codes) and switch the whole analysis surface to read each song's newest coding pass instead of two fixed model constants.

**Architecture:** All analysis reads (song page, browse facets, `/search` filters, theme counts, admin queue) select each song's single newest `song_lyric_analysis` row (`MAX(analyzed_at)`) via one shared SQL fragment `LATEST_ANALYSIS`, replacing the retired `CODE_MODEL`/`SCALAR_MODEL`/`ANY_TIER_SQL` constants. The song page gains codebook gating on thematic codes so it shows exactly what the filters show. The React `LyricalAnalysis` component is rewritten to Option C.

**Tech Stack:** Node.js/Express, PostgreSQL (`pg`), `node:test`; React (Vite), plain CSS with design tokens.

## Global Constraints

- **Read-only:** no new DB columns, no migrations, no writes to `song_lyric_analysis` or `song_lyrics`. This is display-side only.
- **Model selection:** the ONLY model-selection logic is `MAX(analyzed_at)` via `LATEST_ANALYSIS`. After this work no hard-coded model string (`gemma4:*`, `gemini-*`) may remain in application code. Assumes each pass is written as one complete row per song (curator contract).
- **Codebook gating:** the song page shows only thematic codes present in `taxonomy.json` and only scalar values valid in the codebook — matching the browse filters exactly.
- **Naming:** metadata `Audience` → **"Speaking to"** (in `services/metadataCodebook.js`); thematic `Targets` → **"Subjects"** (in `data/taxonomy.json` `hierarchy.targets.label` AND the frontend dimension heading). The thematic **section** title stays **"What it's about."**
- **Backend tests:** `node:test`, run with `cd backend && npm test`. Reuse this file's unique fixture sentinel **`ZZZANL`**; every fixture title starts with it (per-file sentinel convention).
- **Frontend:** no test runner — verify by live smoke (per Phase 3 / B2 / B3 precedent).
- **Commits:** end every commit message with:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016XcM2FMysSw3tTcH8a1RTe
  ```
  On Windows/PowerShell use `git commit -F <scratchpad msg file>` (avoid here-string parse issues). Run git from the repo root.

---

## File Structure

**Backend**
- `backend/services/analysis.js` — add `LATEST_ANALYSIS`, `hasAnalysisExists`, `hasCodesExists`; rewrite `getSongAnalysis`, `facetTree`, `scalarFacets`, `themeCounts` to use `LATEST_ANALYSIS`; gate `mapDim`; remove `CODE_MODEL`/`SCALAR_MODEL`/`ANY_TIER_SQL` (Task 5). **[Owner: analysis read]**
- `backend/services/browseFilters.js` — `joinSql` analysis/scalar joins + `has_analysis` EXISTS use the new helpers.
- `backend/routes/spotify.js` — `/search` facet joins, `/filter-options` availability, `/browse-facets` toggle counts.
- `backend/routes/analytics.js` — `/summary` `songs_with_themes`.
- `backend/services/curation.js` — drop retired constants; `needs-analysis` queue uses `hasAnalysisExists`.
- `backend/data/taxonomy.json` — `hierarchy.targets.label` → "Subjects".
- `backend/services/metadataCodebook.js` — `target_audience` heading → "Speaking to".
- Tests: `backend/test/analysis.test.js` (rewrite fixtures + semantics), `backend/test/curation.test.js` (constant refs), `backend/test/browseFilters.test.js` (join string assert).

**Frontend**
- `frontend/src/components/LyricalAnalysis.jsx` — Option C rewrite.
- `frontend/src/styles/components.css` — `.la-*` restyle (two-column sub-sections, summary strip, per-dimension quote block; retire the old bottom-evidence styles).

---

## Task 1: `analysis.js` reads each song's latest pass, everywhere

**Files:**
- Modify: `backend/services/analysis.js`
- Test: `backend/test/analysis.test.js`

**Interfaces:**
- Produces: `LATEST_ANALYSIS` (string — a parenthesised subquery, one row per song), `hasAnalysisExists(alias)` and `hasCodesExists(alias)` (functions → SQL boolean expression strings). `getSongAnalysis(db, songId)` return shape is UNCHANGED (`{ perspective, intensity, clarity, focus_amount, lyrical_tone, target_audience, emotions[], explanation, themes[], targets[], actions[], tactics[], moral_frames[], attributes[], dimension_descriptions }`), but now sourced from the newest row and with thematic codes codebook-gated. `facetTree`, `scalarFacets`, `themeCounts` keep their signatures.
- Consumes: existing `codebook` + `taxonomy` helpers already in the file.

- [ ] **Step 1: Add the shared fragment + helpers.** In `backend/services/analysis.js`, immediately after the `SCALAR_MODEL` line (currently line 11) add:

```js
// Exactly one row per song: the newest pass (MAX analyzed_at). Drop-in replacement for
// `song_lyric_analysis` in any JOIN — join on song_id, no model filter. model_used DESC is a
// deterministic tiebreak when two passes share an analyzed_at. This is the ONLY place model
// selection happens; the site always shows a song's latest coding.
const LATEST_ANALYSIS = `(SELECT DISTINCT ON (song_id) *
   FROM song_lyric_analysis
   ORDER BY song_id, analyzed_at DESC NULLS LAST, model_used DESC)`;

// "Has any analysis at all" — any row exists (a latest row therefore exists).
const hasAnalysisExists = (alias) =>
  `EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = ${alias}.id)`;

// "The latest pass carries at least one thematic code" (for the theme-tree caption count).
const hasCodesExists = (alias) =>
  `EXISTS (SELECT 1 FROM ${LATEST_ANALYSIS} la WHERE la.song_id = ${alias}.id AND (
     jsonb_array_length(COALESCE(la.themes,'[]'::jsonb)) > 0
     OR jsonb_array_length(COALESCE(la.topics,'[]'::jsonb)) > 0
     OR jsonb_array_length(COALESCE(la.advocacy,'[]'::jsonb)) > 0
     OR jsonb_array_length(COALESCE(la.tactics,'[]'::jsonb)) > 0
     OR jsonb_array_length(COALESCE(la.moral_frames,'[]'::jsonb)) > 0))`;
```

- [ ] **Step 2: Codebook-gate `mapDim`.** Replace the current `mapDim` (lines ~54-65) with:

```js
// Only codebook-known codes reach the page — the same gate facetTree/filters use, so the
// song page and the browse filters never disagree. Drops unknowns, typos and blank codes.
function mapDim(dimension, arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter(row => row && row.code && SUBDIM[dimension].has(row.code))
    .map(row => {
      const sd = SUBDIM[dimension].get(row.code) || {};
      return {
        code: row.code, label: label(dimension, row.code), evidence: row.evidence,
        definition: (DEFS[dimension].get(row.code)) || '',
        sub_dimension: sd.sub_dimension || null,
        sub_dimension_label: sd.sub_dimension ? subDimensionLabel(dimension, sd.sub_dimension) : null,
        group: sd.group || null,
      };
    });
}
```

- [ ] **Step 3: Rewrite `getSongAnalysis` to read the latest row.** Replace the whole function body (lines ~67-119) with:

```js
async function getSongAnalysis(db, songId) {
  const r = await db.query(
    `SELECT sla.themes, sla.topics, sla.advocacy, sla.tactics, sla.moral_frames, sla.explanation,
            sla.perspective, sla.lyrical_tone, sla.intensity, sla.clarity, sla.focus_amount,
            sla.target_audience, sla.emotions
     FROM ${LATEST_ANALYSIS} sla
     WHERE sla.song_id = $1`,
    [songId]);
  const a = r.rows[0];
  if (!a) return null;

  // Compact attributes card: the six single-valued components. cleanSelection drops null,
  // suppressed and off-codebook values — the same gate the filters use, so the page can only
  // ever show a value you could also filter by.
  const attributes = [];
  for (const c of codebook.COMPONENTS) {
    if (c.multi) continue;
    const [v] = codebook.cleanSelection(c.key, a[c.column]);
    if (!v) continue;
    attributes.push({
      label: c.heading,
      value: codebook.codeLabel(c.key, v),
      definition: codebook.codeDefinition(c.key, v),
      component_description: codebook.componentDescription(c.key),
    });
  }
  const emotions = codebook.cleanSelection('emotions', a.emotions)
    .map(e => codebook.codeLabel('emotions', e));

  const dims = {
    themes: mapDim('themes', a.themes),
    targets: mapDim('topics', a.topics),
    actions: mapDim('advocacy', a.advocacy),
    tactics: mapDim('tactics', a.tactics),
    moral_frames: mapDim('moral_frames', a.moral_frames),
  };

  // Nothing displayable (e.g. a lyrics-less pass with empty codes and empty scalars) -> null,
  // so the route 404s and the page shows no empty "Lyrical analysis" heading.
  const hasContent = attributes.length > 0 || emotions.length > 0 ||
    Object.values(dims).some(d => d.length > 0) || !!(a.explanation && a.explanation.trim());
  if (!hasContent) return null;

  return {
    perspective: a.perspective, intensity: a.intensity, clarity: a.clarity,
    focus_amount: a.focus_amount, lyrical_tone: a.lyrical_tone,
    target_audience: a.target_audience,
    emotions, explanation: a.explanation,
    ...dims,
    attributes,
    dimension_descriptions: DIM_DESCRIPTIONS,
  };
}
```

- [ ] **Step 4: Point `facetTree` at `LATEST_ANALYSIS`.** In `facetTree` (the per-dimension query, lines ~144-150): change the join and drop the model param. Replace:

```js
    const rows = (await db.query(
      `SELECT DISTINCT s.id AS song_id, elem->>'code' AS code
       FROM songs s${extraJoin}
       JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = $1
       CROSS JOIN LATERAL jsonb_array_elements(sa.${col}) AS elem
       WHERE s.status = 'included' AND s.published = true${extraWhere}`,
      [CODE_MODEL, ...extraParams])).rows;
```
with:
```js
    const rows = (await db.query(
      `SELECT DISTINCT s.id AS song_id, elem->>'code' AS code
       FROM songs s${extraJoin}
       JOIN ${LATEST_ANALYSIS} sa ON sa.song_id = s.id
       CROSS JOIN LATERAL jsonb_array_elements(sa.${col}) AS elem
       WHERE s.status = 'included' AND s.published = true${extraWhere}`,
      [...extraParams])).rows;
```
Also update the doc comment above `facetTree` (currently "prepends CODE_MODEL as $1 … constraint params start at $2") to: `// Parameter base: constraint.where/params must be built with startIndex: 1 — this function no longer prepends a model param.`

- [ ] **Step 5: Point `scalarFacets` at `LATEST_ANALYSIS`.** In `scalarFacets` (lines ~200-215): remove `modelIdx`, change both join branches, drop the appended model param. Replace the `const modelIdx …` line and the `inner` assignment with:

```js
    const inner = c.multi
      ? `SELECT DISTINCT s.id AS song_id, e.code AS code
         FROM songs s${extraJoin}
         JOIN ${LATEST_ANALYSIS} scf ON scf.song_id = s.id
         CROSS JOIN LATERAL unnest(scf.${c.column}) AS e(code)
         WHERE s.status = 'included' AND s.published = true${extraWhere}`
      : `SELECT DISTINCT s.id AS song_id, scf.${c.column} AS code
         FROM songs s${extraJoin}
         JOIN ${LATEST_ANALYSIS} scf ON scf.song_id = s.id
         WHERE s.status = 'included' AND s.published = true${extraWhere}`;
    const rows = (await db.query(
      `SELECT code, COUNT(DISTINCT song_id)::int AS count FROM (${inner}) t
       WHERE code IS NOT NULL GROUP BY code`,
      [...cParams])).rows;
```
Update the doc comment above `scalarFacets` (currently "appends SCALAR_MODEL at $(cParams.length + 1)") to: `// Parameter base: each constraint's where/params is built with startIndex: 1; no model param is appended.`

- [ ] **Step 6: Point `themeCounts` at `LATEST_ANALYSIS`.** Replace its query (lines ~292-301) with:

```js
  const r = await db.query(
    `SELECT elem->>'code' AS theme, COUNT(DISTINCT s.id)::int AS song_count
     FROM songs s
     JOIN ${LATEST_ANALYSIS} sa ON sa.song_id = s.id
     CROSS JOIN LATERAL jsonb_array_elements(sa.themes) AS elem
     WHERE s.status = 'included' AND s.published = true
     GROUP BY elem->>'code'
     ORDER BY song_count DESC
     LIMIT $1`,
    [limit]);
```

- [ ] **Step 7: Export the new names.** In the `module.exports` (line ~305), add `LATEST_ANALYSIS, hasAnalysisExists, hasCodesExists` (keep `CODE_MODEL, SCALAR_MODEL, ANY_TIER_SQL` for now — removed in Task 5).

- [ ] **Step 8: Rewrite the test fixtures for the single-latest-row model.** In `backend/test/analysis.test.js`, replace the fixture helpers (lines ~26-61: `mkSong`, `addCodeTier`, `addScalarTier`, `mkCodedSong`) with:

```js
const MODEL = 'gemini-3.5-flash-lite'; // any string; single row per fixture song

async function mkSong(title) {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ($1, 'included', true, 'manual') RETURNING id`, [title])).rows[0].id;
}

// Insert ONE analysis row (the new "complete pass" model). Fields default to empty.
async function addAnalysis(songId, fields = {}, { model = MODEL, analyzedAt = '2026-07-25 10:00:00' } = {}) {
  const f = {
    explanation: null, themes: '[]', topics: '[]', advocacy: '[]', tactics: '[]', moral_frames: '[]',
    perspective: null, lyrical_tone: null, intensity: null, clarity: null, focus_amount: null,
    target_audience: null, emotions: null, ...fields,
  };
  await pool.query(
    `INSERT INTO song_lyric_analysis
       (song_id, model_used, analyzed_at, explanation, themes, topics, advocacy, tactics, moral_frames,
        perspective, lyrical_tone, intensity, clarity, focus_amount, target_audience, emotions)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16::text[])`,
    [songId, model, analyzedAt, f.explanation, f.themes, f.topics, f.advocacy, f.tactics, f.moral_frames,
     f.perspective, f.lyrical_tone, f.intensity, f.clarity, f.focus_amount, f.target_audience, f.emotions]);
}

const CODED = {
  explanation: 'Test explanation.',
  themes: JSON.stringify([{ code: 'killing', evidence: 'ground beef' }]),
  topics: JSON.stringify([{ code: 'cows', evidence: 'Run cows run' }]),
  perspective: 'MORAL_ACCUSER_JUDGE', lyrical_tone: 'CONDESCENDING_SNARK_AND_SATIRE',
  intensity: 'MORAL_OUTRAGE_AND_CONDEMNATION', clarity: 'SYSTEMIC_COMMODIFICATION_CRITIQUE',
  focus_amount: 'CENTRAL_THESIS', target_audience: 'HYPOCRITES_AND_SELF_DECEIVERS',
  emotions: ['MORAL_OUTRAGE', 'SARDONIC_MOCKERY'],
};

async function mkCodedSong() {
  const id = await mkSong('ZZZANL Coded');
  await addAnalysis(id, CODED);
  return id;
}
```

- [ ] **Step 9: Update the semantics-affected tests.** In the same file:
  - Test `getSongAnalysis returns chips only when just the code tier exists` (line ~110): rename to `... when the latest row has only thematic codes` and replace its body's `await addCodeTier(id);` with:
    ```js
    await addAnalysis(id, { themes: CODED.themes, topics: CODED.topics, explanation: 'Test explanation.' });
    ```
    (assertions unchanged — `attributes` empty, `emotions` empty, `explanation` = 'Test explanation.').
  - Test `getSongAnalysis returns attributes only when just the scalar tier exists` (line ~120): rename to `... when the latest row has only scalars`, replace `await addScalarTier(id);` with:
    ```js
    await addAnalysis(id, {
      perspective: CODED.perspective, lyrical_tone: CODED.lyrical_tone, intensity: CODED.intensity,
      clarity: CODED.clarity, focus_amount: CODED.focus_amount, target_audience: CODED.target_audience,
      emotions: CODED.emotions,
    });
    ```
    Change `assert.equal(a.explanation, null, ...)` to `assert.ok(!a.explanation, 'no explanation on a scalar-only pass');`.
  - Tests `drops suppressed scalar values` (~130) and `drops off-codebook scalar values` (~148): change `[id, analysis.SCALAR_MODEL]` to `[id, MODEL]` in both inserts.
  - Tests `facetTree rolls up two codes…` (~217) and `facetTree accepts a constraint…` (~262): change `analysis.CODE_MODEL` to `MODEL` in the inline inserts (three occurrences).
  - `themeCounts aggregates…` (~208) and `facetTree returns the hierarchy…` (~168): no change (they call `mkCodedSong`).

- [ ] **Step 10: Run the analysis tests.** Run: `cd backend && npm test -- test/analysis.test.js` (or `node --test test/analysis.test.js`).
Expected: all pass. If `facetTree` tests fail on counts, confirm the fixture `analyzed_at` is set so the fixture row is each song's latest.

- [ ] **Step 11: Commit.**
```bash
git add backend/services/analysis.js backend/test/analysis.test.js
git commit -F <scratchpad-msg>   # "refactor(analysis): read each song's latest pass; codebook-gate thematic codes"
```

---

## Task 2: Route browse/search/analytics reads through the latest pass

**Files:**
- Modify: `backend/services/browseFilters.js`, `backend/routes/spotify.js`, `backend/routes/analytics.js`
- Test: `backend/test/browseFilters.test.js`

**Interfaces:**
- Consumes: `analysis.LATEST_ANALYSIS`, `analysis.hasAnalysisExists`, `analysis.hasCodesExists` (Task 1).
- Produces: no new exports; behaviour change only (facet/filter/count queries follow the latest pass).

- [ ] **Step 1: `browseFilters.js` — has-analysis EXISTS.** Replace lines ~39-42:
```js
  if (inc('analysis_toggle') && filters.has_analysis === 'true') {
    where.push(`EXISTS (SELECT 1 FROM song_lyric_analysis la
                        WHERE la.song_id = s.id AND la.model_used IN (${analysis.ANY_TIER_SQL}))`);
  }
```
with:
```js
  if (inc('analysis_toggle') && filters.has_analysis === 'true') {
    where.push(analysis.hasAnalysisExists('s'));
  }
```

- [ ] **Step 2: `browseFilters.js` — `joinSql` joins.** Replace lines ~82-83:
```js
  if (joins.analysis) s += ` JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = '${analysis.CODE_MODEL}'`;
  if (joins.scalarAnalysis) s += ` JOIN song_lyric_analysis sca ON sca.song_id = s.id AND sca.model_used = '${analysis.SCALAR_MODEL}'`;
```
with:
```js
  if (joins.analysis) s += ` JOIN ${analysis.LATEST_ANALYSIS} sa ON sa.song_id = s.id`;
  if (joins.scalarAnalysis) s += ` JOIN ${analysis.LATEST_ANALYSIS} sca ON sca.song_id = s.id`;
```

- [ ] **Step 3: `spotify.js` `/search` facet joins.** Replace lines ~285-292:
```js
    const facetJoin = [
      bw.joins.analysis
        ? `JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = '${analysis.CODE_MODEL}'`
        : '',
      bw.joins.scalarAnalysis
        ? `JOIN song_lyric_analysis sca ON sca.song_id = s.id AND sca.model_used = '${analysis.SCALAR_MODEL}'`
        : '',
    ].filter(Boolean).join(' ');
```
with:
```js
    const facetJoin = [
      bw.joins.analysis ? `JOIN ${analysis.LATEST_ANALYSIS} sa ON sa.song_id = s.id` : '',
      bw.joins.scalarAnalysis ? `JOIN ${analysis.LATEST_ANALYSIS} sca ON sca.song_id = s.id` : '',
    ].filter(Boolean).join(' ');
```

- [ ] **Step 4: `spotify.js` `/filter-options` availability.** Replace line ~411:
```js
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = songs.id AND la.model_used IN (${analysis.ANY_TIER_SQL})))::int AS has_analysis
```
with (note the alias is `songs` here, not `s`):
```js
        COUNT(*) FILTER (WHERE ${analysis.hasAnalysisExists('songs')})::int AS has_analysis
```

- [ ] **Step 5: `spotify.js` `/browse-facets` toggle counts.** Replace lines ~462-465:
```js
    const toggleSql = `SELECT
        COUNT(DISTINCT s.id) FILTER (WHERE EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = s.id AND la.model_used IN (${analysis.ANY_TIER_SQL})))::int AS has_analysis,
        COUNT(DISTINCT s.id) FILTER (WHERE EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = s.id AND la.model_used = '${analysis.CODE_MODEL}'))::int AS coded_count
      FROM songs s${browse.joinSql(bwT.joins)} ${whereSql(bwT)}`;
```
with:
```js
    const toggleSql = `SELECT
        COUNT(DISTINCT s.id) FILTER (WHERE ${analysis.hasAnalysisExists('s')})::int AS has_analysis,
        COUNT(DISTINCT s.id) FILTER (WHERE ${analysis.hasCodesExists('s')})::int AS coded_count
      FROM songs s${browse.joinSql(bwT.joins)} ${whereSql(bwT)}`;
```

- [ ] **Step 6: `spotify.js` `/browse-facets` facetTree constraint startIndex.** The `facetTree` constraint no longer reserves `$1` for a model param. Change line ~473 from `startIndex: 2` to `startIndex: 1`:
```js
    const bwAn = browse.buildWhere(f, { exclude: 'analysis', startIndex: 1 });
```
(Leave the scalar constraints loop at `startIndex: 1` — unchanged.)

- [ ] **Step 7: `analytics.js` `/summary` songs_with_themes.** Replace the fourth query (lines ~142-144):
```js
      `SELECT COUNT(DISTINCT sa.song_id) as songs_with_themes
       FROM song_lyric_analysis sa JOIN songs s ON s.id = sa.song_id
       WHERE sa.model_used = '${analysis.CODE_MODEL}' AND s.status = 'included' AND s.published = true`
```
with:
```js
      `SELECT COUNT(*) as songs_with_themes FROM songs s
       WHERE s.status = 'included' AND s.published = true AND ${analysis.hasCodesExists('s')}`
```

- [ ] **Step 8: Add a join-string unit test.** Append to `backend/test/browseFilters.test.js`:
```js
test('joinSql routes analysis joins through the latest-pass subquery, not a model constant', () => {
  const sql = browse.joinSql({ analysis: true, scalarAnalysis: true });
  assert.ok(sql.includes('DISTINCT ON (song_id)'), 'uses the LATEST_ANALYSIS subquery');
  assert.ok(!/model_used\s*=/.test(sql), 'no hard-coded model filter remains');
});
```
(If the file lacks `browse`/`assert`/`test` imports, mirror the imports already at the top of `browseFilters.test.js`.)

- [ ] **Step 9: Run backend tests.** Run: `cd backend && npm test`. Expected: all pass.

- [ ] **Step 10: Commit.**
```bash
git add backend/services/browseFilters.js backend/routes/spotify.js backend/routes/analytics.js backend/test/browseFilters.test.js
git commit -F <scratchpad-msg>   # "refactor(browse): route facets/filters/counts through the latest analysis pass"
```

---

## Task 3: Migrate `curation.js` and retire the model constants

**Files:**
- Modify: `backend/services/curation.js`, `backend/services/analysis.js`
- Test: `backend/test/curation.test.js`, `backend/test/analysis.test.js`

**Interfaces:**
- Consumes: `analysis.hasAnalysisExists`.
- Produces: `analysis.js` no longer exports `CODE_MODEL`/`SCALAR_MODEL`/`ANY_TIER_SQL`; they are deleted.

- [ ] **Step 1: `curation.js` imports.** Replace line 3:
```js
const { CODE_MODEL, SCALAR_MODEL, ANY_TIER_SQL, getSongAnalysis } = require('./analysis');
```
with:
```js
const { hasAnalysisExists, getSongAnalysis } = require('./analysis');
```

- [ ] **Step 2: `curation.js` remove the literal + fix the queue.** Delete line ~41 (`const ANY_TIER_LITERAL = ANY_TIER_SQL; …`). In `queueWhere`, replace the `needs-analysis` `NOT EXISTS` (lines ~66-67):
```js
              AND NOT EXISTS (SELECT 1 FROM song_lyric_analysis sla
                              WHERE sla.song_id=s.id AND sla.model_used IN (${ANY_TIER_LITERAL}))`;
```
with:
```js
              AND NOT ${hasAnalysisExists('s')}`;
```

- [ ] **Step 3: `curation.js` exports.** In `module.exports` (line ~378) remove `CODE_MODEL, SCALAR_MODEL,` from the exported list.

- [ ] **Step 4: `curation.test.js` fixtures.** Replace the destructure at line ~37 (`const { CODE_MODEL, SCALAR_MODEL } = require('../services/analysis');`) with `const MODEL = 'gemini-3.5-flash-lite';` and, in that file, change `CODE_MODEL`→`MODEL`, `SCALAR_MODEL`→`MODEL`, and `analysis.SCALAR_MODEL`→`MODEL` (lines ~43, ~48, ~64). Each of those fixtures inserts a single analysis row per song, so one model literal is correct.

- [ ] **Step 5: Delete the constants from `analysis.js`.** Remove the `sqlQuote`, `ANY_TIER_SQL`, `CODE_MODEL`, `SCALAR_MODEL` declarations (lines ~10-15) — but keep the two-line explanatory comment reduced to: `// The site shows each song's latest analysis pass (see LATEST_ANALYSIS below).` Remove `CODE_MODEL, SCALAR_MODEL, ANY_TIER_SQL,` from `module.exports`.

- [ ] **Step 6: Update the constants test.** In `backend/test/analysis.test.js`, replace the first test (lines ~8-14) with:
```js
test('model selection is by latest pass, not a fixed constant', () => {
  assert.equal(analysis.CODE_MODEL, undefined, 'CODE_MODEL removed');
  assert.equal(analysis.SCALAR_MODEL, undefined, 'SCALAR_MODEL removed');
  assert.equal(analysis.ANY_TIER_SQL, undefined, 'ANY_TIER_SQL removed');
  assert.ok(analysis.LATEST_ANALYSIS.includes('DISTINCT ON (song_id)'), 'LATEST_ANALYSIS picks one row per song');
  assert.ok(analysis.hasAnalysisExists('s').includes('EXISTS'));
});
```

- [ ] **Step 7: Grep for stragglers.** Run: `cd backend && grep -rn "CODE_MODEL\|SCALAR_MODEL\|ANY_TIER_SQL\|ANY_TIER_LITERAL" --include=*.js .` Expected: **no matches**. Fix any that remain.

- [ ] **Step 8: Run all backend tests.** Run: `cd backend && npm test`. Expected: all pass.

- [ ] **Step 9: Commit.**
```bash
git add backend/services/curation.js backend/services/analysis.js backend/test/curation.test.js backend/test/analysis.test.js
git commit -F <scratchpad-msg>   # "refactor(analysis): remove the fixed model constants; single latest-pass source"
```

---

## Task 4: Rename — "Audience" → "Speaking to", "Targets" → "Subjects"

**Files:**
- Modify: `backend/services/metadataCodebook.js`, `backend/data/taxonomy.json`, `frontend/src/components/LyricalAnalysis.jsx`
- Test: `backend/test/analysis.test.js`

**Interfaces:**
- Produces: `getSongAnalysis` attribute for `target_audience` now has `label: 'Speaking to'`; `facetTree`/`getSongAnalysis` dimension label for targets is "Subjects".

- [ ] **Step 1: Metadata heading.** In `backend/services/metadataCodebook.js` line ~24, change `heading: 'Audience'` to `heading: 'Speaking to'`.

- [ ] **Step 2: Taxonomy label.** In `backend/data/taxonomy.json`, under `hierarchy.targets`, change `"label": "Targets & Species"` to `"label": "Subjects"`. (Leave `hierarchy.targets.description` unchanged — it's the About-page copy.)

- [ ] **Step 3: Update the attribute-label test.** In `backend/test/analysis.test.js`, in `getSongAnalysis resolves scalar attributes…` (~88), change `assert.equal(byLabel['Audience'], 'Hypocritical Animal Lovers');` to `assert.equal(byLabel['Speaking to'], 'Hypocritical Animal Lovers');`. In `drops suppressed scalar values` (~130), change `assert.ok(!labels.includes('Audience'), ...)` to `assert.ok(!labels.includes('Speaking to'), ...)`.

- [ ] **Step 4: Frontend dimension heading.** In `frontend/src/components/LyricalAnalysis.jsx`, in the `DIMENSIONS` constant change `['targets', 'Targets']` to `['targets', 'Subjects']`. (The full component is rewritten in Task 5 — this line survives into that rewrite; make the rename there if Task 5 is done first.)

- [ ] **Step 5: Run backend tests.** Run: `cd backend && npm test`. Expected: all pass.

- [ ] **Step 6: Commit.**
```bash
git add backend/services/metadataCodebook.js backend/data/taxonomy.json backend/test/analysis.test.js frontend/src/components/LyricalAnalysis.jsx
git commit -F <scratchpad-msg>   # "feat(analysis): rename Audience->Speaking to, Targets->Subjects"
```

---

## Task 5: Rewrite `LyricalAnalysis.jsx` to Option C

**Files:**
- Modify (replace): `frontend/src/components/LyricalAnalysis.jsx`

**Interfaces:**
- Consumes: the `analysis` prop from `spotifyService.getAnalysis` (shape from Task 1). `subDimensionColor`, `InfoTip` (existing imports).
- Produces: the rendered Option C section.

- [ ] **Step 1: Replace the component.** Overwrite `frontend/src/components/LyricalAnalysis.jsx` with:

```jsx
import { useState } from 'react';
import { subDimensionColor } from '../styles/subDimensionPalette';
import InfoTip from './InfoTip';

// Right-hand "What it's about" dimensions: [data key, display heading].
const DIMENSIONS = [
  ['themes', 'Themes'],
  ['targets', 'Subjects'],
  ['actions', 'Actions'],
  ['tactics', 'Tactics'],
  ['moral_frames', 'Moral frames'],
];

function LyricalAnalysis({ analysis }) {
  const [showQuotes, setShowQuotes] = useState(false);
  if (!analysis) return null;

  const attributes = analysis.attributes || [];
  const emotions = analysis.emotions || [];
  const summary = (analysis.explanation || '').trim();
  const dims = DIMENSIONS
    .map(([key, heading]) => [key, heading, analysis[key] || []])
    .filter(([, , codes]) => codes.length > 0);

  const hasStyle = attributes.length > 0 || emotions.length > 0;
  const hasThemes = dims.length > 0;
  if (!hasStyle && !hasThemes && !summary) return null;

  const hasQuotes = dims.some(([, , codes]) => codes.some(c => c.evidence));

  return (
    <div className="lyrical-analysis">
      {summary && (
        <p className="la-summary">
          <span className="la-summary-label">In short</span>
          {summary}
        </p>
      )}

      <div className="la-sections">
        {hasStyle && (
          <section className="la-section">
            <h3 className="la-section-title">Style &amp; tone</h3>
            <p className="la-section-desc">The voice, mood and intensity of the lyrics.</p>
            <div className="la-attributes">
              {attributes.map(a => (
                <div key={a.label} className="la-attr">
                  <span className="la-attr-label">{a.label}</span>
                  <InfoTip text={a.definition}>
                    <span className="la-attr-value">{a.value}</span>
                  </InfoTip>
                </div>
              ))}
              {emotions.length > 0 && (
                <div className="la-attr la-attr-emotions">
                  <span className="la-attr-label">Emotions</span>
                  <span className="la-attr-value">{emotions.join('; ')}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {hasThemes && (
          <section className="la-section">
            <div className="la-section-head">
              <h3 className="la-section-title">What it&rsquo;s about</h3>
              {hasQuotes && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm la-quotes-toggle"
                  aria-expanded={showQuotes}
                  onClick={() => setShowQuotes(v => !v)}
                >
                  {showQuotes ? 'Hide quotes' : 'Show quotes'}
                </button>
              )}
            </div>
            <p className="la-section-desc">The ideas, subjects and calls to action in the lyrics.</p>

            {dims.map(([key, heading, codes]) => {
              const quoted = codes.filter(c => c.evidence);
              return (
                <div key={key} className="la-dimension">
                  <h4 className="la-dim-heading">{heading}</h4>
                  <div className="la-chips">
                    {codes.map((c, i) => (
                      <InfoTip key={`${c.code}-${i}`} text={c.definition}>
                        <span className="la-chip" style={{ borderColor: subDimensionColor(c.sub_dimension) }}>
                          <span className="la-chip-dot" style={{ backgroundColor: subDimensionColor(c.sub_dimension) }} />
                          {c.label}
                        </span>
                      </InfoTip>
                    ))}
                  </div>
                  {showQuotes && quoted.length > 0 && (
                    <ul className="la-quotes">
                      {quoted.map((c, i) => (
                        <li key={`${c.code}-${i}`}>
                          <span className="la-quote-tag">{c.label}</span>
                          <span className="la-quote-text">&ldquo;{c.evidence}&rdquo;</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}

export default LyricalAnalysis;
```

- [ ] **Step 2: Lint.** Run: `cd frontend && npm run lint`. Expected: 0 errors.

- [ ] **Step 3: Commit.**
```bash
git add frontend/src/components/LyricalAnalysis.jsx
git commit -F <scratchpad-msg>   # "feat(song-page): Option C lyrical-analysis layout (summary + two sections + per-code quotes)"
```

---

## Task 6: Restyle `.la-*` for the two-section Option C layout

**Files:**
- Modify: `frontend/src/styles/components.css` (the `.lyrical-analysis` block, lines ~2214-2257, plus the `.la-attr-value` InfoTip reset near ~2374)

**Interfaces:**
- Consumes: the class names emitted by Task 5 (`la-summary`, `la-summary-label`, `la-sections`, `la-section`, `la-section-head`, `la-section-title`, `la-section-desc`, `la-quotes-toggle`, `la-quotes`, `la-quote-tag`, `la-quote-text`, plus existing `la-attributes`/`la-attr*`/`la-dimension`/`la-dim-heading`/`la-chips`/`la-chip`/`la-chip-dot`).

- [ ] **Step 1: Replace the block.** Replace the CSS from `.lyrical-analysis {` through `.la-evidence-quote { … }` (lines ~2214-2257) with:

```css
.lyrical-analysis { display: flex; flex-direction: column; gap: var(--space-4); }

/* Top summary — shown only when the latest pass carries explanation prose. */
.la-summary {
  margin: 0; padding: var(--space-3) var(--space-4);
  background: var(--bg-surface-raised); border-left: 3px solid var(--accent-ember);
  border-radius: var(--radius-sm); color: var(--text-primary); line-height: 1.5;
}
.la-summary-label {
  display: block; font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-muted); margin-bottom: 4px;
}

/* Two labelled sub-sections, side by side; stack on narrow screens. */
.la-sections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
@media (max-width: 720px) { .la-sections { grid-template-columns: 1fr; } }
.la-section { display: flex; flex-direction: column; gap: var(--space-2); }
.la-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
.la-section-title { margin: 0; color: var(--text-primary); }
.la-section-desc { margin: 0 0 var(--space-2); font-size: 0.85rem; color: var(--text-muted); }
.la-quotes-toggle { align-self: baseline; flex: none; }

.la-attributes {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-2) var(--space-4);
  padding: var(--space-3); background: var(--bg-surface-raised); border-radius: var(--radius-sm);
}
.la-attr { display: flex; flex-direction: column; gap: 2px; }
.la-attr-emotions { grid-column: 1 / -1; }
.la-attr-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
.la-attr-value { color: var(--text-primary); }

.la-dimension { display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-2); }
.la-dim-heading { margin: 0; font-size: 0.8rem; letter-spacing: 0.03em; text-transform: uppercase; color: var(--text-muted); }
.la-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.la-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border: 1px solid var(--border-hairline); border-left-width: 3px;
  border-radius: 999px; background: var(--bg-surface-raised); color: var(--text-primary);
}
.la-chip-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }

/* Per-code quotes, revealed under each dimension by the section "Show quotes" toggle. */
.la-quotes { list-style: none; margin: var(--space-1) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.la-quotes li { display: flex; flex-direction: column; gap: 2px; padding-left: var(--space-2); border-left: 2px solid var(--border-hairline); }
.la-quote-tag { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--accent-ember); }
.la-quote-text { color: var(--text-secondary); font-style: italic; }
```

Notes: if `--radius-sm` or `--accent-ember` are not defined tokens, substitute the nearest existing token (grep `--radius`/`--accent` in `src/styles/tokens/`). Do **not** introduce raw colors.

- [ ] **Step 2: Confirm no dangling old classes.** Run: `cd frontend && grep -rn "la-evidence" src/`. Expected: **no matches** (Task 5 removed them from the JSX; this step removed them from CSS). Remove any that remain.

- [ ] **Step 3: Build.** Run: `cd frontend && npm run build`. Expected: clean build.

- [ ] **Step 4: Commit.**
```bash
git add frontend/src/styles/components.css
git commit -F <scratchpad-msg>   # "style(song-page): two-section lyrical-analysis layout + per-code quote blocks"
```

---

## Task 7: Live smoke test

**Files:** none (verification only).

- [ ] **Step 1: Start backend + frontend.** Follow the launcher (restart backend fresh — it runs plain `node server.js`, no reload; per the stale-server hazard). Backend on :5000, frontend on Vite.

- [ ] **Step 2: Song page — a coded song.** Open a song known to have the latest coding (e.g. one of the 638 with themes). Verify: two side-by-side sections "Style & tone" (with **"Speaking to"** row) and "What it's about" (with **"Subjects"** dimension); chips render; **no summary strip** if `explanation` is empty; "Show quotes" toggles per-code quotes under each dimension; no blank/typo chips.

- [ ] **Step 3: Song page — a song with a summary** (only if any exist yet). If the curator's summary pass has landed, confirm the "In short" strip appears; otherwise confirm it is absent (expected today).

- [ ] **Step 4: Browse sidebar.** Confirm the thematic facet group shows **"Subjects"** and the metadata facet shows **"Speaking to"**; the "Has analysis" toggle still filters; facet counts render; a theme filter still narrows results (page and counts agree).

- [ ] **Step 5: Reflow.** Narrow the viewport < 720px: the two sections stack to one column.

- [ ] **Step 6: Report the smoke result** (pass/fail per step) to the user. Do not mark complete on any failure — debug via systematic-debugging.

---

## Self-Review (completed while writing)

- **Spec coverage:** §1 dynamic latest source → Tasks 1-3 (whole surface: song page, facets, filters, counts, admin queue). §2 codebook gating → Task 1 Step 2. §3 Option C layout (conditional summary, two sections, per-section quote toggle) → Tasks 5-6. §4 naming → Task 4. §5 evidence-by-code → Task 5 (per-dimension `la-quotes`). §6 non-goals honoured (no migration/pipeline change; browse behaviour otherwise intact).
- **Placeholder scan:** none — every step carries concrete code or an exact command. The two "substitute nearest token" notes (Task 6) name the grep to resolve them.
- **Type/name consistency:** `LATEST_ANALYSIS`, `hasAnalysisExists(alias)`, `hasCodesExists(alias)` used identically in Tasks 1-3; CSS class names in Task 6 match the JSX emitted in Task 5; the `MODEL` test literal replaces the removed constants consistently in Tasks 1/3.
- **Ordering:** constants stay exported until every consumer is migrated (removed in Task 3); the frontend rename line (Task 4 Step 4) is reconciled with the Task 5 full rewrite (whichever runs second keeps "Subjects").
