# Triage 1a + 1b — Two-Tier Analysis Read + Scalar Browse Filters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the five code dimensions from `gemma4:key_focus_pipeline` and the seven scalar
metadata components from `gemini-3.5-flash-lite`, and turn those seven components into
browse filters plus a proper song-page attributes card.

**Architecture:** `services/analysis.js`'s single `DEFAULT_MODEL` becomes `CODE_MODEL` +
`SCALAR_MODEL` (no alias — every consumer states its tier). A new pure module
`services/metadataCodebook.js` owns `data/master_metadata_codebook.json`: component list, DB
columns, labels/definitions, the suppressed-code set, and the WHERE-clause builder for scalar
filters. `analysis.scalarFacets` supplies exclude-self counts; the sidebar renders them as seven
collapsed checkbox groups whose state rides the existing URL/sessionStorage browse-state
machinery.

**Tech Stack:** Node/Express, PostgreSQL (`pg`), `node:test` (`npm test` in `backend/`),
React 18 + Vite, react-router v7 `useSearchParams`.

**Spec:** [`../specs/2026-07-22-triage-1a-1b-analysis-tiers-and-scalar-filters-design.md`](../specs/2026-07-22-triage-1a-1b-analysis-tiers-and-scalar-filters-design.md)

## Global Constraints

- **Never SELECT `song_lyrics.lyrics` or `.translation` from a public route.** This work touches
  only `song_lyric_analysis`; do not add lyric columns to any query.
- **Read-only against `song_lyric_analysis`.** No INSERT/UPDATE/DELETE, no migration, no cleanup
  of the dead `gemini-flash-deductive` rows. The table is the curator's.
- **Model strings live in exactly two constants** — `analysis.CODE_MODEL` /
  `analysis.SCALAR_MODEL`. No literal `'gemma4:...'` or `'gemini-...'` anywhere else, tests
  included.
- **SQL identifiers never come from user input.** Column names come from the
  `metadataCodebook.COMPONENTS` whitelist; values are always parameterised.
- **Suppressed codes** (hidden from display *and* filters): `THEMATIC_ABSENCE`,
  `ABSENCE_OF_FOCUS`, `INSUFFICIENT_DATA`, `UNSPECIFIED`.
- **Brand voice:** no emoji in UI copy. The codebook's `short_tag` fields (which contain emoji)
  are never used — only `label` and `definition`.
- **Component headings** (short, exactly these): Perspective · Tone · Intensity · Clarity ·
  Focus · Audience · Emotions.
- **Backend tests run from `backend/`:** `npm test` (`node --test --test-concurrency=1`).
  New DB-touching fixtures use a unique sentinel prefix — this file's is **`ZZZMCB`**
  (existing: ZZZANL, ZZZCUR, ZZZDUP, ZZZTEST, ZZZVID).
- **`song_lyric_analysis` PK is `(song_id, model_used)`** — verified; per-tier LEFT JOINs are
  guaranteed at most one row.
- **Working branch:** `session-triage-1a1b-analysis-tiers` (already created; the spec is
  committed there as `15b3c4d`).

---

### Task 1: `metadataCodebook.js` — the pure codebook unit

**Files:**
- Create: `backend/services/metadataCodebook.js`
- Test: `backend/test/metadataCodebook.test.js`

**Interfaces:**
- Consumes: `backend/data/master_metadata_codebook.json` (already committed).
- Produces:
  - `COMPONENTS: Array<{ key, column, heading, multi }>` (ordered)
  - `COMPONENT_KEYS: string[]`
  - `SUPPRESSED: Set<string>`, `isSuppressed(code): boolean`
  - `codeLabel(key, code): string|null`, `codeDefinition(key, code): string`
  - `optionsFor(key): Array<{ code, label }>` (suppressed removed, codebook order)
  - `cleanSelection(key, values): string[]`
  - `scalarSelectionClauses(sel, startIndex, alias = 'sca'): { clauses, params, needsJoin, nextIndex }`

- [ ] **Step 1: Write the failing test**

Create `backend/test/metadataCodebook.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const cb = require('../services/metadataCodebook');

// Pure-function tests — no DB, no sentinel.

test('COMPONENTS lists the seven components in order with short headings', () => {
  assert.deepEqual(cb.COMPONENT_KEYS, [
    'perspective', 'lyrical_tone', 'intensity', 'clarity',
    'focus_amount', 'target_audience', 'emotions',
  ]);
  assert.deepEqual(cb.COMPONENTS.map(c => c.heading), [
    'Perspective', 'Tone', 'Intensity', 'Clarity', 'Focus', 'Audience', 'Emotions',
  ]);
  // emotions is the only multi-valued component; column === key for all seven
  assert.deepEqual(cb.COMPONENTS.filter(c => c.multi).map(c => c.key), ['emotions']);
  assert.ok(cb.COMPONENTS.every(c => c.column === c.key));
});

test('codeLabel and codeDefinition resolve from the codebook', () => {
  assert.equal(cb.codeLabel('perspective', 'MORAL_ACCUSER_JUDGE'), 'Moral Accuser');
  assert.equal(cb.codeLabel('emotions', 'MORAL_OUTRAGE'), 'Moral Outrage');
  assert.ok(cb.codeDefinition('perspective', 'MORAL_ACCUSER_JUDGE').length > 0);
});

test('unknown codes fall back to Title Case, null stays null', () => {
  assert.equal(cb.codeLabel('perspective', 'SOME_NEW_CODE'), 'Some New Code');
  assert.equal(cb.codeLabel('perspective', null), null);
  assert.equal(cb.codeDefinition('perspective', 'SOME_NEW_CODE'), '');
});

test('labels never carry the codebook emoji short_tag', () => {
  for (const c of cb.COMPONENTS) {
    for (const o of cb.optionsFor(c.key)) {
      assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(o.label),
        `${c.key}/${o.code} label must be emoji-free`);
    }
  }
});

test('optionsFor omits the four suppressed absence codes', () => {
  const codes = (key) => cb.optionsFor(key).map(o => o.code);
  assert.ok(!codes('clarity').includes('THEMATIC_ABSENCE'));
  assert.ok(!codes('focus_amount').includes('ABSENCE_OF_FOCUS'));
  assert.ok(!codes('focus_amount').includes('INSUFFICIENT_DATA'));
  assert.ok(!codes('target_audience').includes('UNSPECIFIED'));
  // and keeps the real ones
  assert.ok(codes('focus_amount').includes('CENTRAL_THESIS'));
  assert.equal(cb.optionsFor('focus_amount').length, 4); // 6 codes - 2 suppressed
});

test('cleanSelection strips unknown and suppressed codes', () => {
  assert.deepEqual(
    cb.cleanSelection('focus_amount', ['CENTRAL_THESIS', 'ABSENCE_OF_FOCUS', 'NOT_A_CODE']),
    ['CENTRAL_THESIS']);
  assert.deepEqual(cb.cleanSelection('perspective', 'MORAL_ACCUSER_JUDGE'), ['MORAL_ACCUSER_JUDGE']);
  assert.deepEqual(cb.cleanSelection('perspective', undefined), []);
});

test('scalarSelectionClauses: single-valued component uses = ANY, one param array', () => {
  const r = cb.scalarSelectionClauses(
    { perspective: ['MORAL_ACCUSER_JUDGE', 'SYSTEMIC_SOCIAL_CRITIC'] }, 1);
  assert.equal(r.needsJoin, true);
  assert.deepEqual(r.clauses, ['sca.perspective = ANY($1::text[])']);
  assert.deepEqual(r.params, [['MORAL_ACCUSER_JUDGE', 'SYSTEMIC_SOCIAL_CRITIC']]);
  assert.equal(r.nextIndex, 2);
});

test('scalarSelectionClauses: emotions uses array overlap', () => {
  const r = cb.scalarSelectionClauses({ emotions: ['MORAL_OUTRAGE'] }, 3);
  assert.deepEqual(r.clauses, ['sca.emotions && $3::text[]']);
  assert.equal(r.nextIndex, 4);
});

test('scalarSelectionClauses: components AND together in COMPONENTS order', () => {
  const r = cb.scalarSelectionClauses(
    { emotions: ['MORAL_OUTRAGE'], perspective: ['MORAL_ACCUSER_JUDGE'] }, 1);
  assert.equal(r.clauses.length, 2);
  assert.equal(r.clauses[0], 'sca.perspective = ANY($1::text[])', 'perspective first');
  assert.equal(r.clauses[1], 'sca.emotions && $2::text[]');
});

test('scalarSelectionClauses: a selection of only suppressed codes needs no join', () => {
  const r = cb.scalarSelectionClauses({ focus_amount: ['ABSENCE_OF_FOCUS'] }, 1);
  assert.equal(r.needsJoin, false);
  assert.deepEqual(r.clauses, []);
  assert.deepEqual(r.params, []);
  assert.equal(r.nextIndex, 1);
});

test('scalarSelectionClauses: empty selection needs no join', () => {
  const r = cb.scalarSelectionClauses({}, 1);
  assert.equal(r.needsJoin, false);
  assert.deepEqual(r.clauses, []);
});

test('scalarSelectionClauses: alias is configurable', () => {
  const r = cb.scalarSelectionClauses({ clarity: ['SYSTEMIC_COMMODIFICATION_CRITIQUE'] }, 1, 'x');
  assert.deepEqual(r.clauses, ['x.clarity = ANY($1::text[])']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm test -- test/metadataCodebook.test.js`
Expected: FAIL — `Cannot find module '../services/metadataCodebook'`.

- [ ] **Step 3: Write the implementation**

Create `backend/services/metadataCodebook.js`:

```js
// Codebook service over the curator's master_metadata_codebook.json — the seven scalar
// metadata components of the lyric analysis (perspective … emotions).
// Pure: no DB access, no writes. Mirrors how services/analysis.js owns taxonomy.json.
const codebook = require('../data/master_metadata_codebook.json');

// Absence codes: coding artifacts meaning "nothing found", not findings.
// Hidden from display AND from filters (spec 2026-07-22, curator decision 6).
const SUPPRESSED = new Set([
  'THEMATIC_ABSENCE',   // clarity
  'ABSENCE_OF_FOCUS',   // focus_amount
  'INSUFFICIENT_DATA',  // focus_amount
  'UNSPECIFIED',        // target_audience
]);

// Ordered component list. `column` is the song_lyric_analysis column and doubles as the
// SQL identifier whitelist — user input never reaches an identifier. `heading` is the short
// UI label (not the codebook's long component_name). `multi` = TEXT[] column.
const COMPONENTS = [
  { key: 'perspective',     column: 'perspective',     heading: 'Perspective', multi: false },
  { key: 'lyrical_tone',    column: 'lyrical_tone',    heading: 'Tone',        multi: false },
  { key: 'intensity',       column: 'intensity',       heading: 'Intensity',   multi: false },
  { key: 'clarity',         column: 'clarity',         heading: 'Clarity',     multi: false },
  { key: 'focus_amount',    column: 'focus_amount',    heading: 'Focus',       multi: false },
  { key: 'target_audience', column: 'target_audience', heading: 'Audience',    multi: false },
  { key: 'emotions',        column: 'emotions',        heading: 'Emotions',    multi: true  },
];

const COMPONENT_KEYS = COMPONENTS.map(c => c.key);

function titleCase(code) {
  return String(code).toLowerCase().split('_')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

// key -> Map(code -> codebook entry), built once.
const CODES = {};
for (const c of COMPONENTS) {
  CODES[c.key] = new Map((((codebook[c.key] || {}).codes) || []).map(i => [i.code, i]));
}

function isSuppressed(code) {
  return SUPPRESSED.has(code);
}

// Display label. The codebook's emoji short_tag is deliberately never used (brand voice).
function codeLabel(key, code) {
  if (!code) return null;
  const e = CODES[key] && CODES[key].get(code);
  return (e && e.label) || titleCase(code);
}

function codeDefinition(key, code) {
  const e = CODES[key] && CODES[key].get(code);
  return (e && e.definition) || '';
}

// Filterable options for one component, in codebook order, suppressed codes removed.
function optionsFor(key) {
  return (((codebook[key] || {}).codes) || [])
    .filter(i => !SUPPRESSED.has(i.code))
    .map(i => ({ code: i.code, label: i.label }));
}

// Incoming selection -> known, non-suppressed codes only (a hand-crafted URL can't
// select a suppressed or invented code).
function cleanSelection(key, values) {
  const known = CODES[key];
  if (!known) return [];
  const arr = values == null ? [] : (Array.isArray(values) ? values : [values]);
  return arr.filter(v => v && !SUPPRESSED.has(v) && known.has(v));
}

// One clause per selected component: OR within a component (= ANY / && overlap),
// ANDed across components by the caller's WHERE accumulation.
// `alias` is the scalar-tier join alias in the caller's query.
function scalarSelectionClauses(sel, startIndex, alias = 'sca') {
  const clauses = [], params = [];
  let idx = startIndex;
  for (const c of COMPONENTS) {
    const codes = cleanSelection(c.key, sel[c.key]);
    if (codes.length === 0) continue;
    clauses.push(c.multi
      ? `${alias}.${c.column} && $${idx}::text[]`
      : `${alias}.${c.column} = ANY($${idx}::text[])`);
    params.push(codes);
    idx++;
  }
  return { clauses, params, needsJoin: clauses.length > 0, nextIndex: idx };
}

module.exports = {
  COMPONENTS, COMPONENT_KEYS, SUPPRESSED,
  isSuppressed, codeLabel, codeDefinition, optionsFor, cleanSelection,
  scalarSelectionClauses,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test -- test/metadataCodebook.test.js`
Expected: PASS, 11/11.

- [ ] **Step 5: Commit**

```bash
git add backend/services/metadataCodebook.js backend/test/metadataCodebook.test.js
git commit -m "feat(triage-1a1b): metadataCodebook service — labels, suppression, scalar clauses"
```

---

### Task 2: Split the model constant across the backend

**Files:**
- Modify: `backend/services/analysis.js` (lines 6, 44–53, 68–94, 111, 114, 217, 223, 227)
- Modify: `backend/services/browseFilters.js:39,66`
- Modify: `backend/routes/spotify.js:283-285,429,438,461,482`
- Modify: `backend/routes/analytics.js:144`
- Modify: `backend/services/curation.js:41,67,197`
- Test: `backend/test/analysis.test.js`, `backend/test/curation.test.js`,
  `backend/test/browseFilters.test.js`

**Interfaces:**
- Consumes: `metadataCodebook` (Task 1) — `COMPONENTS`, `codeLabel`, `codeDefinition`,
  `isSuppressed`.
- Produces:
  - `analysis.CODE_MODEL = 'gemma4:key_focus_pipeline'`
  - `analysis.SCALAR_MODEL = 'gemini-3.5-flash-lite'`
  - `analysis.ANY_TIER_SQL` — `"'gemma4:key_focus_pipeline', 'gemini-3.5-flash-lite'"`, for
    inlining into `model_used IN (…)`
  - `analysis.getSongAnalysis(db, songId)` — unchanged shape, but `attributes` entries are now
    `{ label, value, definition }`, `emotions` is an array of **labels**, and the result is
    non-null when *either* tier has a row.
  - `analysis.DEFAULT_MODEL` **no longer exists**.

- [ ] **Step 1: Update the existing tests to the new constants (they must fail first)**

In `backend/test/analysis.test.js`:

Replace the first test (lines 8–10) with:

```js
test('the two analysis tiers are the code and scalar models', () => {
  assert.equal(analysis.CODE_MODEL, 'gemma4:key_focus_pipeline');
  assert.equal(analysis.SCALAR_MODEL, 'gemini-3.5-flash-lite');
  assert.equal(analysis.DEFAULT_MODEL, undefined, 'DEFAULT_MODEL is removed, not aliased');
  assert.equal(analysis.ANY_TIER_SQL,
    `'gemma4:key_focus_pipeline', 'gemini-3.5-flash-lite'`);
});
```

Replace the `mkCodedSong` helper (lines 22–39) with three helpers — code-tier row, scalar-tier
row, or both. **Every INSERT references the constants, never a literal.**

```js
// Helpers: insert songs with the ZZZANL sentinel, coded in one or both tiers.
async function mkSong(title) {
  return (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ($1, 'included', true, 'manual') RETURNING id`, [title])).rows[0].id;
}

async function addCodeTier(songId) {
  await pool.query(
    `INSERT INTO song_lyric_analysis
       (song_id, model_used, explanation, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, $2, 'Test explanation.', $3::jsonb, $4::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [songId, analysis.CODE_MODEL,
     JSON.stringify([{ code: 'killing', evidence: 'ground beef' }]),
     JSON.stringify([{ code: 'cows', evidence: 'Run cows run' }])]);
}

async function addScalarTier(songId) {
  await pool.query(
    `INSERT INTO song_lyric_analysis
       (song_id, model_used, perspective, lyrical_tone, intensity, clarity, focus_amount,
        target_audience, emotions, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, $2, 'MORAL_ACCUSER_JUDGE', 'CONDESCENDING_SNARK_AND_SATIRE',
             'MORAL_OUTRAGE_AND_CONDEMNATION', 'SYSTEMIC_COMMODIFICATION_CRITIQUE',
             'CENTRAL_THESIS', 'HYPOCRITES_AND_SELF_DECEIVERS',
             ARRAY['MORAL_OUTRAGE','SARDONIC_MOCKERY'],
             '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [songId, analysis.SCALAR_MODEL]);
}

async function mkCodedSong() {
  const id = await mkSong('ZZZANL Coded');
  await addCodeTier(id);
  await addScalarTier(id);
  return id;
}
```

Replace the scalar-attributes test (lines 67–78) with:

```js
test('getSongAnalysis resolves scalar attributes to codebook labels with definitions', async () => {
  const id = await mkCodedSong();
  const a = await analysis.getSongAnalysis(pool, id);
  const byLabel = Object.fromEntries(a.attributes.map(x => [x.label, x.value]));
  assert.equal(byLabel['Perspective'], 'Moral Accuser');
  assert.equal(byLabel['Tone'], 'Satirical & Sarcastic');
  assert.equal(byLabel['Focus'], 'Central Thesis');
  assert.equal(byLabel['Audience'], 'Hypocritical Animal Lovers');
  assert.ok(a.attributes.every(x => x.value), 'no null/empty attributes leak in');
  const persp = a.attributes.find(x => x.label === 'Perspective');
  assert.ok(persp.definition.length > 0, 'definition carried for the tooltip');
  // emotions arrive as display labels, not raw codes
  assert.deepEqual(a.emotions, ['Moral Outrage', 'Sardonic Mockery']);
});
```

In the "full coding" test (lines 41–58), change line 44 from `assert.equal(a.perspective,
'animal_pov');` to:

```js
  assert.equal(a.perspective, 'MORAL_ACCUSER_JUDGE'); // raw code still exposed
```

and delete the `assert.deepEqual(a.emotions, ['outrage']);` line (covered by the attributes
test above).

Add the four coverage cases after the "returns null" test (line 85):

```js
test('getSongAnalysis returns chips only when just the code tier exists', async () => {
  const id = await mkSong('ZZZANL CodeOnly');
  await addCodeTier(id);
  const a = await analysis.getSongAnalysis(pool, id);
  assert.equal(a.themes[0].code, 'killing');
  assert.deepEqual(a.attributes, [], 'no scalar row -> no attributes');
  assert.deepEqual(a.emotions, []);
  assert.equal(a.explanation, 'Test explanation.');
});

test('getSongAnalysis returns attributes only when just the scalar tier exists', async () => {
  const id = await mkSong('ZZZANL ScalarOnly');
  await addScalarTier(id);
  const a = await analysis.getSongAnalysis(pool, id);
  assert.ok(a, 'scalar-only song still has an analysis');
  assert.deepEqual(a.themes, [], 'no code row -> no chips');
  assert.equal(a.explanation, null, 'explanation lives in the code tier only');
  assert.equal(a.attributes.length, 6, 'all six single-valued components present');
});

test('getSongAnalysis drops suppressed scalar values', async () => {
  const id = await mkSong('ZZZANL Suppressed');
  await pool.query(
    `INSERT INTO song_lyric_analysis
       (song_id, model_used, perspective, focus_amount, target_audience, emotions,
        themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, $2, 'MORAL_ACCUSER_JUDGE', 'ABSENCE_OF_FOCUS', 'UNSPECIFIED', ARRAY[]::text[],
             '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [id, analysis.SCALAR_MODEL]);
  const a = await analysis.getSongAnalysis(pool, id);
  const labels = a.attributes.map(x => x.label);
  assert.ok(labels.includes('Perspective'));
  assert.ok(!labels.includes('Focus'), 'ABSENCE_OF_FOCUS suppressed');
  assert.ok(!labels.includes('Audience'), 'UNSPECIFIED suppressed');
});
```

Finally, in this file replace **every remaining** `'gemma4:latest'` literal in the two
`facetTree` tests (lines 143, 150, 174) with the parameter `analysis.CODE_MODEL` — i.e. change
`VALUES ($1, 'gemma4:latest', $2::jsonb, …)` to `VALUES ($1, $3, $2::jsonb, …)` and append
`analysis.CODE_MODEL` to that query's parameter array.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test -- test/analysis.test.js`
Expected: FAIL — `CODE_MODEL` is `undefined`; attribute labels don't match.

- [ ] **Step 3: Rewrite `analysis.js`**

Replace line 6 (`const DEFAULT_MODEL = 'gemma4:latest';`) with:

```js
// Two display tiers. The code dimensions (+ explanation/evidence) come from the refined
// key-focus coding; the seven scalar metadata components come from the newer, enum-clean
// pass. No song is guaranteed to be in both — getSongAnalysis returns whatever exists.
const CODE_MODEL = 'gemma4:key_focus_pipeline';
const SCALAR_MODEL = 'gemini-3.5-flash-lite';

const sqlQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
// For inlining into `model_used IN (…)` — "has analysis in either tier".
const ANY_TIER_SQL = [CODE_MODEL, SCALAR_MODEL].map(sqlQuote).join(', ');
```

Add to the requires at the top (after line 4):

```js
const codebook = require('./metadataCodebook');
```

Delete `scalarLabel` entirely (lines 44–53) — `taxonomy.json`'s scalar lists are dead. Leave
`taxonomy.json` itself untouched.

Replace `getSongAnalysis` (lines 68–94) with:

```js
async function getSongAnalysis(db, songId) {
  // One row per (song_id, model_used) — PK-guaranteed, so both LEFT JOINs are 1:1.
  const r = await db.query(
    `SELECT c.themes, c.topics, c.advocacy, c.tactics, c.moral_frames, c.explanation,
            f.perspective, f.lyrical_tone, f.intensity, f.clarity, f.focus_amount,
            f.target_audience, f.emotions,
            (c.song_id IS NOT NULL) AS has_code,
            (f.song_id IS NOT NULL) AS has_scalar
     FROM (SELECT $1::int AS song_id) x
     LEFT JOIN song_lyric_analysis c ON c.song_id = x.song_id AND c.model_used = $2
     LEFT JOIN song_lyric_analysis f ON f.song_id = x.song_id AND f.model_used = $3`,
    [songId, CODE_MODEL, SCALAR_MODEL]);
  const a = r.rows[0];
  if (!a || (!a.has_code && !a.has_scalar)) return null;

  // Compact attributes card: the six single-valued components, suppressed/null dropped.
  const attributes = [];
  for (const c of codebook.COMPONENTS) {
    if (c.multi) continue;
    const v = a[c.column];
    if (!v || codebook.isSuppressed(v)) continue;
    attributes.push({
      label: c.heading,
      value: codebook.codeLabel(c.key, v),
      definition: codebook.codeDefinition(c.key, v),
    });
  }
  const emotions = (a.emotions || [])
    .filter(e => e && !codebook.isSuppressed(e))
    .map(e => codebook.codeLabel('emotions', e));

  return {
    perspective: a.perspective, intensity: a.intensity, clarity: a.clarity,
    focus_amount: a.focus_amount, lyrical_tone: a.lyrical_tone,
    target_audience: a.target_audience,
    emotions, explanation: a.explanation,
    themes: mapDim('themes', a.themes),
    targets: mapDim('topics', a.topics),
    actions: mapDim('advocacy', a.advocacy),
    tactics: mapDim('tactics', a.tactics),
    moral_frames: mapDim('moral_frames', a.moral_frames),
    attributes,
  };
}
```

In `facetTree` (line 114) and `themeCounts` (line 223), replace `DEFAULT_MODEL` with
`CODE_MODEL`.

Replace the export line (227) with:

```js
module.exports = { CODE_MODEL, SCALAR_MODEL, ANY_TIER_SQL, EVIDENCE_DIMS, DIM_TO_TAXONOMY,
  taxonomy, label, getSongAnalysis, subDimensionLabel, SUBDIM, PUBLIC_DIMS, facetTree,
  facetFilterConditions, facetSelectionClauses, themeCounts };
```

- [ ] **Step 4: Update the four consumer files**

`backend/services/browseFilters.js` line 39 (`has_analysis` → either tier):

```js
  if (inc('analysis_toggle') && filters.has_analysis === 'true') {
    where.push(`EXISTS (SELECT 1 FROM song_lyric_analysis la
                        WHERE la.song_id = s.id AND la.model_used IN (${analysis.ANY_TIER_SQL}))`);
  }
```

`backend/services/browseFilters.js` line 66 (code-tier join):

```js
  if (joins.analysis) s += ` JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = '${analysis.CODE_MODEL}'`;
```

`backend/routes/spotify.js` lines 283–285:

```js
    const facetJoin = bw.joins.analysis
      ? `JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = '${analysis.CODE_MODEL}'`
      : '';
```

`backend/routes/spotify.js` line 429 + 438 (`/filter-options` availability — either tier, and
the query no longer takes a parameter):

```js
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = songs.id AND la.model_used IN (${analysis.ANY_TIER_SQL})))::int AS has_analysis
```

```js
      pool.query(availabilityQuery),
```

`backend/routes/spotify.js` lines 461 + 482 — delete `const MODEL = analysis.DEFAULT_MODEL;`
and change `toggleSql`:

```js
    const toggleSql = `SELECT
        COUNT(DISTINCT s.id) FILTER (WHERE EXISTS (SELECT 1 FROM song_lyric_analysis la WHERE la.song_id = s.id AND la.model_used IN (${analysis.ANY_TIER_SQL})))::int AS has_analysis
      FROM songs s${browse.joinSql(bwT.joins)} ${whereSql(bwT)}`;
```

`backend/routes/analytics.js` line 144:

```js
       WHERE sa.model_used = '${analysis.CODE_MODEL}' AND s.status = 'included' AND s.published = true`
```

`backend/services/curation.js` line 3, 41, 67, 197 — the admin "has analysis" signals become
either-tier:

```js
const { CODE_MODEL, SCALAR_MODEL, ANY_TIER_SQL, getSongAnalysis } = require('./analysis');
```

```js
const ANY_TIER_LITERAL = ANY_TIER_SQL; // controlled constants, safe to inline
```

```js
              AND NOT EXISTS (SELECT 1 FROM song_lyric_analysis sa
                              WHERE sa.song_id=s.id AND sa.model_used IN (${ANY_TIER_LITERAL}))`;
```

```js
  const analysed = (await db.query(
    `SELECT 1 FROM song_lyric_analysis WHERE song_id=$1 AND model_used IN (${ANY_TIER_LITERAL})`,
    [id])).rows.length > 0;
```

Delete the now-unused `MODEL_LITERAL` const. Note `curation.js` also re-exports
`DEFAULT_MODEL` at line 348 — replace it with `CODE_MODEL, SCALAR_MODEL` in that export list.

- [ ] **Step 5: Update the other two test files**

`backend/test/curation.test.js` — line 40 is the file's only model literal:

```js
     VALUES ($1, 'gemma4:latest', 'human_observer', ARRAY['hope'],
```

Change that INSERT to bind the model as a parameter (`$N`, appended to the existing parameter
array) with the value `require('../services/analysis').CODE_MODEL`. Then add:

```js
test('hasAnalysis is true from a scalar-only row (either tier counts)', async () => {
  const analysis = require('../services/analysis');
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ('ZZZCUR ScalarOnly', 'included', true, 'manual') RETURNING id`)).rows[0];
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, perspective,
       themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, $2, 'MORAL_ACCUSER_JUDGE', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [s.id, analysis.SCALAR_MODEL]);
  const wb = await curation.getWorkbench(pool, s.id);
  assert.ok(wb.analysis, 'workbench shows the scalar-only analysis');
});
```

`backend/test/browseFilters.test.js` — line 13's `joins` deepEqual gains the new flag:

```js
  assert.deepEqual(r.joins, { albums: false, artists: false, effectiveGenre: false, analysis: false, scalarAnalysis: false });
```

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: PASS — all files green (was 90; expect ~101 with Task 1's 11).

- [ ] **Step 7: Verify no stray model literals remain**

Run: `cd backend && grep -rn "gemma4:\|gemini-3" --include=*.js services routes test scripts`
Expected: matches **only** in `services/analysis.js` lines defining `CODE_MODEL`/`SCALAR_MODEL`
and in `test/analysis.test.js`'s tier assertion. Any other hit is a bug — fix it.

- [ ] **Step 8: Commit**

```bash
git add backend/services backend/routes backend/test
git commit -m "feat(triage-1a1b): split CODE_MODEL/SCALAR_MODEL; two-tier getSongAnalysis"
```

---

### Task 3: Scalar filters in `/search`

**Files:**
- Modify: `backend/services/browseFilters.js:10-58,61-68`
- Modify: `backend/routes/spotify.js:282-285`
- Test: `backend/test/browseFilters.test.js`

**Interfaces:**
- Consumes: `metadataCodebook.scalarSelectionClauses` (Task 1), `analysis.SCALAR_MODEL` (Task 2).
- Produces: `buildWhere` accepts the seven filter keys (`perspective`, `lyrical_tone`,
  `intensity`, `clarity`, `focus_amount`, `target_audience`, `emotions`), sets
  `joins.scalarAnalysis`, and supports `exclude: 'scalar:<key>'`; `joinSql` emits the
  scalar-tier join under alias **`sca`**.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/browseFilters.test.js`:

```js
test('buildWhere scalar components set the scalar join and one clause each', () => {
  const r = b.buildWhere({ perspective: ['MORAL_ACCUSER_JUDGE'], emotions: ['MORAL_OUTRAGE'] });
  assert.ok(r.joins.scalarAnalysis);
  assert.ok(!r.joins.analysis, 'code-tier join not needed for scalar filters');
  assert.ok(r.where.includes('sca.perspective = ANY($1::text[])'));
  assert.ok(r.where.includes('sca.emotions && $2::text[]'));
  assert.equal(r.nextIndex, 3);
});

test('buildWhere excludes one scalar component but keeps its siblings', () => {
  const r = b.buildWhere(
    { perspective: ['MORAL_ACCUSER_JUDGE'], clarity: ['SYSTEMIC_COMMODIFICATION_CRITIQUE'] },
    { exclude: 'scalar:perspective' });
  assert.ok(!r.where.some(c => c.includes('sca.perspective')), 'own group excluded');
  assert.ok(r.where.some(c => c.includes('sca.clarity')), 'sibling kept');
  assert.ok(r.joins.scalarAnalysis);
});

test('buildWhere scalar params continue the shared index sequence', () => {
  const r = b.buildWhere({ q: 'x', perspective: ['MORAL_ACCUSER_JUDGE'] });
  assert.ok(r.where[0].includes('$1'), 'q takes $1');
  assert.ok(r.where.some(c => c.includes('sca.perspective = ANY($2::text[])')));
  assert.equal(r.nextIndex, 3);
});

test('joinSql emits the scalar-tier join under a distinct alias', () => {
  const s = b.joinSql({ analysis: true, scalarAnalysis: true });
  assert.ok(s.includes('song_lyric_analysis sa '), 'code tier keeps alias sa');
  assert.ok(s.includes('song_lyric_analysis sca '), 'scalar tier uses alias sca');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test -- test/browseFilters.test.js`
Expected: FAIL — `r.joins.scalarAnalysis` is `undefined`, no `sca.` clauses.

- [ ] **Step 3: Implement in `browseFilters.js`**

Add the require at the top (after line 6):

```js
const codebook = require('./metadataCodebook');
```

Line 14 — add the flag:

```js
  const joins = { albums: false, artists: false, effectiveGenre: false, analysis: false, scalarAnalysis: false };
```

After the `inc('analysis')` block (line 55), add:

```js
  // Scalar metadata components — one exclude-self group per component, so an open
  // sidebar group stays widenable. OR within a component, AND across (spec 2026-07-22).
  const scalarSel = {};
  for (const c of codebook.COMPONENTS) {
    if (inc(`scalar:${c.key}`)) scalarSel[c.key] = filters[c.key];
  }
  const sc = codebook.scalarSelectionClauses(scalarSel, idx);
  if (sc.needsJoin) {
    where.push(...sc.clauses);
    params.push(...sc.params);
    idx = sc.nextIndex;
    joins.scalarAnalysis = true;
  }
```

In `joinSql` (line 66), add after the analysis join:

```js
  if (joins.scalarAnalysis) s += ` JOIN song_lyric_analysis sca ON sca.song_id = s.id AND sca.model_used = '${analysis.SCALAR_MODEL}'`;
```

- [ ] **Step 4: Wire `/search`'s FROM clause**

`backend/routes/spotify.js` lines 283–285 — `/search` builds its join inline (it doesn't use
`joinSql`), so add the scalar join beside the code join:

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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS, all files green.

- [ ] **Step 6: Verify the endpoint against real data**

Start a scratch backend on port 5001 (never edit files under `backend/` for scratch scripts —
nodemon restarts mid-test):

```bash
cd backend && PORT=5001 node server.js &
curl -s "http://localhost:5001/api/spotify/search?perspective=MORAL_ACCUSER_JUDGE&limit=1" | head -c 400
curl -s "http://localhost:5001/api/spotify/search?perspective=MORAL_ACCUSER_JUDGE&perspective=SYSTEMIC_SOCIAL_CRITIC&limit=1" | head -c 200
curl -s "http://localhost:5001/api/spotify/search?emotions=MORAL_OUTRAGE&limit=1" | head -c 200
```

Expected: all three return `200` with a non-zero `pagination.total`; the two-perspective total
is **greater than** the single-perspective total (OR within a component). Stop the backend
afterwards by killing **that PID only** — never `taskkill /F /IM node.exe`.

- [ ] **Step 7: Commit**

```bash
git add backend/services/browseFilters.js backend/routes/spotify.js backend/test/browseFilters.test.js
git commit -m "feat(triage-1a1b): scalar-component filters in /search (OR within, AND across)"
```

---

### Task 4: `scalarFacets` + `scalar_facets` on `/browse-facets`

**Files:**
- Modify: `backend/services/analysis.js` (add `scalarFacets` after `facetTree`, export it)
- Modify: `backend/routes/spotify.js` (the `/browse-facets` handler, ~lines 456–520)
- Test: `backend/test/analysis.test.js`

**Interfaces:**
- Consumes: `metadataCodebook.COMPONENTS`/`optionsFor`, `analysis.SCALAR_MODEL`,
  `browseFilters.buildWhere`/`joinSql` with `exclude: 'scalar:<key>'` (Task 3).
- Produces: `analysis.scalarFacets(db, constraints)` →
  `{ [key]: { key, heading, multi, options: [{ code, label, count }] } }`, and a
  `scalar_facets` block in the `/browse-facets` JSON response.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/analysis.test.js` (before the `after` hook):

```js
test('scalarFacets counts distinct live songs per code, in codebook order', async () => {
  const id = await mkSong('ZZZANL Facet');
  await addScalarTier(id); // perspective MORAL_ACCUSER_JUDGE, emotions [MORAL_OUTRAGE, SARDONIC_MOCKERY]
  const f = await analysis.scalarFacets(pool, {});
  assert.equal(f.perspective.heading, 'Perspective');
  assert.equal(f.emotions.multi, true);
  const persp = f.perspective.options.find(o => o.code === 'MORAL_ACCUSER_JUDGE');
  assert.ok(persp && persp.count >= 1);
  const emo = f.emotions.options.find(o => o.code === 'SARDONIC_MOCKERY');
  assert.ok(emo && emo.count >= 1, 'array column is unnested for counting');
  // zero-count options are kept so the group shape is stable
  assert.ok(f.perspective.options.length > 1);
  // suppressed codes never appear as options
  assert.ok(!f.focus_amount.options.some(o => o.code === 'ABSENCE_OF_FOCUS'));
});

test('scalarFacets applies a per-component constraint', async () => {
  const id = await mkSong('ZZZANL FacetConstrained');
  await addScalarTier(id);
  await pool.query(`UPDATE songs SET language = 'ZZZ-NoSuchLang' WHERE id = $1`, [id]);
  const constrained = await analysis.scalarFacets(pool, {
    perspective: { joinSql: '', where: [`s.language = $1`], params: ['ZZZ-NoSuchLang'] },
  });
  const only = constrained.perspective.options.find(o => o.code === 'MORAL_ACCUSER_JUDGE');
  assert.equal(only.count, 1, 'only the constrained song counts');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm test -- test/analysis.test.js`
Expected: FAIL — `analysis.scalarFacets is not a function`.

- [ ] **Step 3: Implement `scalarFacets` in `analysis.js`**

Add after `facetTree` (line 148), mirroring its constraint contract:

```js
// Per-component option counts for the sidebar. `constraints` is keyed by component:
// { [componentKey]: { joinSql, where: string[], params: any[] } } — each built with that
// component excluded, so a group's own selection never shrinks its own options.
// Lives here (not in metadataCodebook) so that module stays DB-free.
async function scalarFacets(db, constraints = {}) {
  const out = {};
  for (const c of codebook.COMPONENTS) {
    const cn = constraints[c.key] || {};
    const cParams = cn.params || [];
    const extraJoin = cn.joinSql || '';
    const extraWhere = (cn.where && cn.where.length) ? ' AND ' + cn.where.join(' AND ') : '';
    const modelIdx = cParams.length + 1;
    // c.column comes from the COMPONENTS whitelist — never user input.
    const inner = c.multi
      ? `SELECT DISTINCT s.id AS song_id, e.code AS code
         FROM songs s${extraJoin}
         JOIN song_lyric_analysis scf ON scf.song_id = s.id AND scf.model_used = $${modelIdx}
         CROSS JOIN LATERAL unnest(scf.${c.column}) AS e(code)
         WHERE s.status = 'included' AND s.published = true${extraWhere}`
      : `SELECT DISTINCT s.id AS song_id, scf.${c.column} AS code
         FROM songs s${extraJoin}
         JOIN song_lyric_analysis scf ON scf.song_id = s.id AND scf.model_used = $${modelIdx}
         WHERE s.status = 'included' AND s.published = true${extraWhere}`;
    const rows = (await db.query(
      `SELECT code, COUNT(DISTINCT song_id)::int AS count FROM (${inner}) t
       WHERE code IS NOT NULL GROUP BY code`,
      [...cParams, SCALAR_MODEL])).rows;
    const counts = new Map(rows.map(r => [r.code, r.count]));
    out[c.key] = {
      key: c.key,
      heading: c.heading,
      multi: c.multi,
      options: codebook.optionsFor(c.key).map(o => ({ ...o, count: counts.get(o.code) || 0 })),
    };
  }
  return out;
}
```

Add `scalarFacets` to the `module.exports` list.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test -- test/analysis.test.js`
Expected: PASS.

- [ ] **Step 5: Wire it into `/browse-facets`**

In `backend/routes/spotify.js`, inside the `/browse-facets` handler, add after the `bwAn`
constraint block (~line 491):

```js
    // One exclude-self constraint per scalar component.
    const scalarConstraints = {};
    for (const c of codebook.COMPONENTS) {
      const bwS = browse.buildWhere(f, { exclude: `scalar:${c.key}`, startIndex: 1 });
      scalarConstraints[c.key] = {
        joinSql: browse.joinSql(bwS.joins), where: bwS.where, params: bwS.params,
      };
    }
```

Add `analysis.scalarFacets(pool, scalarConstraints)` to the `Promise.all` array and destructure
it as `scalar_facets`:

```js
    const [gR, lR, aR, tR, langR, facets, yR, scalar_facets] = await Promise.all([
      pool.query(genreSql, bwG.params),
      pool.query(lengthSql, bwL.params),
      pool.query(availSql, bwA.params),
      pool.query(toggleSql, bwT.params),
      pool.query(langSql, bwLang.params),
      analysis.facetTree(pool, constraint),
      pool.query(yearSql),
      analysis.scalarFacets(pool, scalarConstraints),
    ]);
```

Add `scalar_facets,` to the `res.json({ … })` payload (after `facets,`).

Add the require at the top of `routes/spotify.js`, beside the other service requires:

```js
const codebook = require('../services/metadataCodebook');
```

- [ ] **Step 6: Verify the endpoint against real data**

```bash
cd backend && PORT=5001 node server.js &
curl -s "http://localhost:5001/api/spotify/browse-facets" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(Object.keys(j.scalar_facets));console.log(j.scalar_facets.perspective.options.slice(0,3));console.log('has_analysis',j.availability.has_analysis);})"
curl -s "http://localhost:5001/api/spotify/browse-facets?emotions=MORAL_OUTRAGE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const e=j.scalar_facets.emotions.options.find(o=>o.code==='SARDONIC_MOCKERY');const p=j.scalar_facets.perspective.options[0];console.log('emotions sibling (exclude-self, unchanged):',e.count,'perspective (narrowed):',p.count);})"
```

Expected: seven keys; `has_analysis` ≈ **665** (was 640); no suppressed codes in any options
list; in the second call the **emotions** counts are unchanged from the first (its own group is
excluded) while **perspective** counts drop. Kill that PID only.

- [ ] **Step 7: Commit**

```bash
git add backend/services/analysis.js backend/routes/spotify.js backend/test/analysis.test.js
git commit -m "feat(triage-1a1b): scalarFacets exclude-self counts on /browse-facets"
```

---

### Task 5: Sidebar filter groups + URL state + chips

**Files:**
- Create: `frontend/src/components/ScalarFacetGroups.jsx`
- Modify: `frontend/src/utils/browseUrlState.js:4-19`
- Modify: `frontend/src/components/SearchAndFilter.jsx` (imports, state, params, chips, render)
- Modify: `frontend/src/styles/components.css` (one new rule after `.filter-title`, line 861)

**Interfaces:**
- Consumes: `scalar_facets` from `GET /api/spotify/browse-facets` (Task 4) —
  `{ [key]: { key, heading, multi, options: [{ code, label, count }] } }`.
- Produces: `SCALAR_KEYS` (exported from `browseUrlState.js`) — the seven filter keys, used by
  `SearchAndFilter` for params, chips and clearing.

There is no frontend test runner (consistent with Phase 3 / B2 / B3) — this task is verified by
live smoke in Step 6.

- [ ] **Step 1: Add the seven keys to the browse URL state**

In `frontend/src/utils/browseUrlState.js`, add the exported key list above `EMPTY_FILTERS`:

```js
// The seven scalar analysis components (song_lyric_analysis columns) — filterable since
// triage 1b. Same URL/sessionStorage treatment as every other array filter.
export const SCALAR_KEYS = [
  'perspective', 'lyrical_tone', 'intensity', 'clarity',
  'focus_amount', 'target_audience', 'emotions',
];
```

Add them to `EMPTY_FILTERS` (after the `facet_groups`/`facet_subdims` line):

```js
  perspective: [], lyrical_tone: [], intensity: [], clarity: [],
  focus_amount: [], target_audience: [], emotions: [],
```

And to `ARRAY_KEYS`:

```js
const ARRAY_KEYS = [
  'genres', 'parent_genres', 'lengths', 'languages',
  'themes', 'targets', 'actions', 'tactics', 'moral_frames',
  'facet_groups', 'facet_subdims',
  ...SCALAR_KEYS,
];
```

No other change is needed: `readFilterState`, `applyFilterState`, `hasBrowseParams` and the
sessionStorage layer all iterate `ARRAY_KEYS`.

- [ ] **Step 2: Create the sidebar group component**

Create `frontend/src/components/ScalarFacetGroups.jsx`:

```jsx
import { useState } from 'react';

// Flat, collapsed-by-default checkbox groups for the seven scalar analysis components.
// Options, labels and counts all come from the API (`scalar_facets`) — the codebook lives
// in the backend only. Selecting several codes in one group widens (OR); selecting across
// groups narrows (AND).
function ScalarFacetGroups({ groups, selected, onToggle }) {
  const [open, setOpen] = useState({});
  const keys = Object.keys(groups || {});
  if (keys.length === 0) return null;

  return (
    <>
      {keys.map(key => {
        const g = groups[key];
        const sel = selected[key] || [];
        const isOpen = !!open[key];
        return (
          <div key={key} className="filter-section">
            <button
              type="button"
              className="filter-title filter-title-toggle"
              aria-expanded={isOpen}
              onClick={() => setOpen(o => ({ ...o, [key]: !o[key] }))}
            >
              <span>{g.heading}{sel.length > 0 && <span className="filter-badge">{sel.length}</span>}</span>
              <span aria-hidden="true">{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && (
              <div className="filter-options">
                {g.options.map(o => {
                  const isSel = sel.includes(o.code);
                  const zero = o.count === 0 && !isSel;
                  return (
                    <label key={o.code} className={`filter-option ${zero ? 'is-zero' : ''}`}>
                      <input
                        type="checkbox"
                        checked={isSel}
                        disabled={zero}
                        onChange={(e) => onToggle(key, o.code, e.target.checked)}
                      />
                      <span className="filter-label">
                        {o.label}<span className="filter-count">({o.count})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export default ScalarFacetGroups;
```

- [ ] **Step 3: Add the button styling**

In `frontend/src/styles/components.css`, immediately after the `.filter-title` rule (line 861):

```css
/* Collapsible group header. A <button> defaults to text-align:center — the B3 theme-tree
   misalignment bug — so the left alignment here is deliberate, not decorative. */
.filter-title-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  background: none;
  border: 0;
  color: inherit;
  font: var(--text-label);
  text-align: left;
  cursor: pointer;
}
```

- [ ] **Step 4: Wire `SearchAndFilter.jsx`**

Import (line 4–7 block):

```jsx
import { readBrowseState, applyFilterState, writeStoredBrowseState, EMPTY_FILTERS, SCALAR_KEYS } from '../utils/browseUrlState';
import ScalarFacetGroups from './ScalarFacetGroups';
```

State (after line 16's `facets`):

```jsx
  const [scalarFacets, setScalarFacets] = useState({});
```

`buildSearchParams` — add before `return p;` (line 53):

```jsx
    SCALAR_KEYS.forEach(k => { if (filters[k].length) p[k] = filters[k]; });
```

Facets effect (after `setFacets(data.facets || {});`, line 92):

```jsx
      setScalarFacets(data.scalar_facets || {});
```

Chips — add a label map beside `facetLabelMaps` (line 198):

```jsx
  const scalarLabelMap = useMemo(() => {
    const m = {};
    SCALAR_KEYS.forEach(k => {
      m[k] = {};
      (scalarFacets[k]?.options || []).forEach(o => { m[k][o.code] = o.label; });
    });
    return m;
  }, [scalarFacets]);
```

Add to the `chips` memo, immediately before `return list;` (line 228):

```jsx
    SCALAR_KEYS.forEach(k => filters[k].forEach(code =>
      list.push({ key: `${k}:${code}`, label: scalarLabelMap[k]?.[code] || code })));
```

…and add `scalarLabelMap` to that memo's dependency array.

`removeChip` — add before the final `DIM_KEYS` line (line 251):

```jsx
    if (SCALAR_KEYS.includes(type)) return toggleInArray(type, value, false);
```

Render — add directly after the `<ThemeFacetTree … />` block (line 275):

```jsx
      <ScalarFacetGroups
        groups={scalarFacets}
        selected={filters}
        onToggle={(key, code, checked) => toggleInArray(key, code, checked)}
      />
```

`clearAllFilters` needs no change — it resets to `EMPTY_FILTERS`, which now carries the keys.

- [ ] **Step 5: Build and lint**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 6: Live smoke**

Start backend (`cd backend && npm run dev`) and frontend (`cd frontend && npm run dev`), open
the homepage, and confirm:

1. Seven new collapsed groups appear under the Themes tree: Perspective, Tone, Intensity,
   Clarity, Focus, Audience, Emotions.
2. Expanding one shows options with counts; no emoji; no "Absence of focus", "Insufficient
   data", "Thematic absence" or "Unspecified" options anywhere.
3. Ticking two options in **one** group increases the result count vs one (OR); ticking one in
   a **second** group decreases it (AND).
4. Each tick adds a removable chip; removing the chip unticks the box.
5. The URL gains e.g. `?perspective=MORAL_ACCUSER_JUDGE`; reloading restores the selection;
   clicking the site title (a param-less `/`) also restores it; "Clear all" empties everything.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ScalarFacetGroups.jsx frontend/src/components/SearchAndFilter.jsx frontend/src/utils/browseUrlState.js frontend/src/styles/components.css
git commit -m "feat(triage-1a1b): seven scalar filter groups in the browse sidebar"
```

---

### Task 6: Song-page attributes card

**Files:**
- Modify: `frontend/src/components/LyricalAnalysis.jsx:44-58`

**Interfaces:**
- Consumes: `analysis.attributes` (`{ label, value, definition }`) and `analysis.emotions`
  (array of display labels) from Task 2.

- [ ] **Step 1: Render definitions as tooltips and stop re-casing emotions**

Replace lines 44–58 of `frontend/src/components/LyricalAnalysis.jsx` with:

```jsx
      {(attributes.length > 0 || emotions.length > 0) && (
        <div className="la-attributes">
          {attributes.map(a => (
            <div key={a.label} className="la-attr" title={a.definition || undefined}>
              <span className="la-attr-label">{a.label}</span>
              <span className="la-attr-value">{a.value}</span>
            </div>
          ))}
          {emotions.length > 0 && (
            <div className="la-attr la-attr-emotions">
              <span className="la-attr-label">Emotions</span>
              <span className="la-attr-value">{emotions.join(', ')}</span>
            </div>
          )}
        </div>
      )}
```

The backend already resolves emotion codes to labels, so the previous `emotions.map(titleCase)`
would double-transform them. `titleCase` stays in the file — `legendFor` still uses it.

- [ ] **Step 2: Build and lint**

Run: `cd frontend && npm run lint && npm run build`
Expected: no errors, no unused-variable warning for `titleCase`.

- [ ] **Step 3: Live smoke on three songs**

With both servers running, find one song of each kind (SQL below is read-only) and open
`/song/<id>`:

```sql
-- both tiers (expect chips + a 6–7 row attributes card)
SELECT s.id FROM songs s
  JOIN song_lyric_analysis c ON c.song_id=s.id AND c.model_used='gemma4:key_focus_pipeline'
  JOIN song_lyric_analysis f ON f.song_id=s.id AND f.model_used='gemini-3.5-flash-lite'
 WHERE s.status='included' AND s.published=true LIMIT 1;
-- scalar only (expect attributes card, no chips, no "Show evidence")
SELECT s.id FROM songs s
  JOIN song_lyric_analysis f ON f.song_id=s.id AND f.model_used='gemini-3.5-flash-lite'
  LEFT JOIN song_lyric_analysis c ON c.song_id=s.id AND c.model_used='gemma4:key_focus_pipeline'
 WHERE s.status='included' AND s.published=true AND c.song_id IS NULL LIMIT 1;
-- code only (expect chips, no attributes card)
SELECT s.id FROM songs s
  JOIN song_lyric_analysis c ON c.song_id=s.id AND c.model_used='gemma4:key_focus_pipeline'
  LEFT JOIN song_lyric_analysis f ON f.song_id=s.id AND f.model_used='gemini-3.5-flash-lite'
 WHERE s.status='included' AND s.published=true AND f.song_id IS NULL LIMIT 1;
```

Confirm: an **Audience** row is present on the both-tiers song; hovering a row shows the
codebook definition; values read as labels ("Moral Accuser"), not raw codes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/LyricalAnalysis.jsx
git commit -m "feat(triage-1a1b): song-page attributes — Audience row, labels, definition tooltips"
```

---

### Task 7: Whole-branch verification + docs

**Files:**
- Modify: `docs/PROJECT_STATE.md` (Current State, Next Tasks, Decision Log, Changelog)
- Modify: `docs/PROJECT_PLAN.md` (the reprioritised triage list — mark 1a/1b done)
- Modify: `docs/CURATOR_TRIAGE_BACKLOG.md` (items 1a/1b resolved)
- Modify: `CLAUDE.md` (the `services/` bullet — name `metadataCodebook.js` and the two tiers)

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test`
Expected: PASS, all files green. Record the count for the changelog.

- [ ] **Step 2: Frontend build + lint**

Run: `cd frontend && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 3: Admin regression check**

With both servers running, open `/admin`: the **needs-analysis** queue count and the workbench
**Analysis** panel must both still render (they moved to either-tier). Open one song from that
queue and confirm the panel matches the public page.

- [ ] **Step 4: Confirm the lyrics-privacy guard still holds**

Run: `cd backend && npm test -- test/lyrics_privacy.test.js`
Expected: PASS — no public route selects `song_lyrics.lyrics`/`.translation`.

- [ ] **Step 5: Update the docs**

In `docs/PROJECT_STATE.md`: move triage 1a/1b to done in Current State, refresh **Next Tasks**
(next up: triage 5 — lyric highlights + multi-language), add a Decision Log entry dated
2026-07-22 recording the two-tier split, the either-tier rule, OR-within/AND-across, the four
suppressed codes, and the 47%-empty-`emotions` observation, and append a Changelog entry with
the test counts from Step 1.

In `docs/PROJECT_PLAN.md`, mark item (1) of the reprioritised triage list ☑ and note that 1b
shipped with it.

In `docs/CURATOR_TRIAGE_BACKLOG.md`, mark the `key_focus_pipeline` and "filter by lyrical
analysis" entries resolved, pointing at the 2026-07-22 spec.

In `CLAUDE.md`, update the backend `services/` bullet to name `metadataCodebook.js` and state
that analysis reads two tiers.

- [ ] **Step 6: Commit and push**

```bash
git add docs CLAUDE.md
git commit -m "docs(triage-1a1b): record the two-tier analysis read + scalar filters"
git push -u origin session-triage-1a1b-analysis-tiers
```

---

## Notes for the implementer

- **Stale backend:** the launcher runs plain `node server.js` (no reload). Restart the backend
  before any smoke test, and verify a new route exists via `router.stack` if in doubt.
- **Never run `taskkill /F /IM node.exe`** — it kills every node process on the machine. Kill
  the specific PID you started.
- **Scratch scripts go in the scratchpad directory with absolute `require` paths** into
  `backend/node_modules` — a temp file under `backend/` restarts nodemon mid-test.
- **PowerShell:** use `git commit -F <file>` for multi-line messages; long here-strings fail to
  parse. Never do a whole-file read/replace/write in PS 5.1 (it double-encodes BOM-less UTF-8).
- **The 4 code-only and 48 scalar-only live songs are expected**, not a bug to fix.
