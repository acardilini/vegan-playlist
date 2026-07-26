# Acoustic Dimensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the six acoustic dimensions on the public song page inside "Style & tone", make five of them filterable in the browse sidebar with a BPM range, and rename two song-page headings.

**Architecture:** A new pure `services/acousticCodebook.js` mirrors the existing `services/metadataCodebook.js` over `data/acoustic_codebook.json`. `getSongAnalysis` returns an `acoustic` array in the exact cell shape the frontend already renders for `attributes`. Filtering reuses the existing `sca` latest-analysis join — the acoustic columns live on the same row as the scalar metadata components, so **no new SQL join is added anywhere**.

**Tech Stack:** Node/Express + `pg` (backend), `node:test` (backend tests, run with `--test-concurrency=1`), React 19 + Vite + react-router v7 (frontend). No frontend test runner — frontend verification is lint + build + live smoke, consistent with Phase 3 / B2 / B3.

**Spec:** [`docs/superpowers/specs/2026-07-26-acoustic-dimensions-design.md`](../specs/2026-07-26-acoustic-dimensions-design.md)

## Global Constraints

- **Read-only feature.** No migrations, no writes to `song_lyric_analysis`, no pipeline changes.
- **Never SELECT `song_lyrics`** from any API route (copyright; local-only table).
- **Display is ungated, selections are gated.** Song-page acoustic values render whatever the pipeline emits (title-cased if off-codebook). Filter selections pass through `cleanSelection`, so an invented code cannot be selected. This is the opposite of the lyrical rule and is deliberate — spec §4.3.
- **The emoji `short_tag` and the `threshold` strings in `acoustic_codebook.json` are never used.**
- **Exact copy strings** (do not paraphrase):
  - Song-page headings: `Lyric highlights`, `Song analysis`
  - Style & tone group headings: `In the lyrics`, `In the sound`
  - Style & tone description: `The voice and mood of the lyrics, and how the recording sounds.`
  - Acoustic row labels, in order: `Energy`, `Mood`, `Rhythm`, `Instruments`, `Vocals`, `Tempo`
  - Sidebar group title: `Sound`; nested tempo group title: `Tempo`
  - Sidebar analysis checkbox: `Has song analysis`
- **CSS uses design tokens only** (`--bg-*`, `--text-*`, `--accent-*`, `--space-*`, `--radius-*`, `--border-hairline`) — never raw colors.
- **Backend test files each use a unique fixture sentinel.** `analysis.test.js` already uses `ZZZANL`; reuse it there. Pure-function test files use no DB and no sentinel.
- **The data is currently degenerate** — every song carries the same value in all six columns. Tests must therefore assert on *fixture* rows with deliberately varied values, never on live-data composition.

---

## File Structure

**Created:**
- `backend/services/acousticCodebook.js` — pure codebook service over `data/acoustic_codebook.json`: component list, labels, definitions, filter options, selection cleaning, SQL clause building.
- `backend/test/acousticCodebook.test.js` — pure unit tests for the above.

**Modified:**
- `backend/services/analysis.js` — `getSongAnalysis` returns `acoustic` cells; new `acousticFacets` and `tempoRange`.
- `backend/services/browseFilters.js` — acoustic component clauses + tempo bounds in `buildWhere`.
- `backend/routes/spotify.js` — `/browse-facets` returns `acoustic_facets` + `tempo_range`. (`/search` needs **no** change: it passes `req.query` straight to `buildWhere`.)
- `backend/test/analysis.test.js` — acoustic fixture columns + tests.
- `backend/test/browseFilters.test.js` — acoustic clause tests.
- `frontend/src/pages/SongDetailPage.jsx` — two heading renames.
- `frontend/src/components/LyricalAnalysis.jsx` — the two labelled groups.
- `frontend/src/components/ScalarFacetGroups.jsx` — comment only (it is already generic).
- `frontend/src/components/SearchAndFilter.jsx` — Sound sidebar group, chips, params, checkbox rename.
- `frontend/src/utils/browseUrlState.js` — `ACOUSTIC_KEYS` + tempo string keys.
- `frontend/src/styles/components.css` — `.la-group` / `.la-group-title`.

---

### Task 1: The acoustic codebook service

**Files:**
- Create: `backend/services/acousticCodebook.js`
- Create: `backend/test/acousticCodebook.test.js`
- Read for reference: `backend/services/metadataCodebook.js`, `backend/data/acoustic_codebook.json`

**Interfaces:**
- Consumes: `backend/data/acoustic_codebook.json` (already committed).
- Produces (relied on by Tasks 2, 5, 6):
  - `COMPONENTS: Array<{ key, column, heading }>` — five enum dimensions, in display order
  - `COMPONENT_KEYS: string[]`
  - `TEMPO: { key: 'tempo_bpm', column: 'tempo_bpm', heading: 'Tempo' }`
  - `componentName(key) -> string`, `componentDescription(key) -> string`
  - `codeLabel(key, code) -> string|null` (title-cases unknown codes; `null` in → `null` out)
  - `codeDefinition(key, code) -> string` (`''` when unknown)
  - `optionsFor(key) -> Array<{ code, label }>` in codebook order
  - `cleanSelection(key, values) -> string[]` (drops unknown; accepts a scalar or an array)
  - `acousticSelectionClauses(sel, startIndex, alias = 'sca') -> { clauses, params, needsJoin, nextIndex }`

- [ ] **Step 1: Write the failing test**

Create `backend/test/acousticCodebook.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const acb = require('../services/acousticCodebook');

// Pure-function tests — no DB, no sentinel.

test('COMPONENTS lists the five enum dimensions in order with short headings', () => {
  assert.deepEqual(acb.COMPONENT_KEYS, [
    'sonic_energy', 'emotional_mood', 'rhythmic_style', 'acoustic_type', 'vocal_delivery',
  ]);
  assert.deepEqual(acb.COMPONENTS.map(c => c.heading), [
    'Energy', 'Mood', 'Rhythm', 'Instruments', 'Vocals',
  ]);
  assert.ok(acb.COMPONENTS.every(c => c.column === c.key));
  // tempo is an integer range, not an enum component
  assert.ok(!acb.COMPONENT_KEYS.includes('tempo_bpm'));
  assert.equal(acb.TEMPO.column, 'tempo_bpm');
  assert.equal(acb.TEMPO.heading, 'Tempo');
});

test('codeLabel, codeDefinition and component text resolve from the acoustic codebook', () => {
  assert.equal(acb.codeLabel('sonic_energy', 'MODERATE_BALANCED'), 'Moderate & Balanced');
  assert.equal(acb.codeLabel('vocal_delivery', 'SPOKEN_WORD_RAP'), 'Spoken Word & Rap');
  assert.ok(acb.codeDefinition('rhythmic_style', 'DRIVING_STEADY_PULSE').length > 0);
  assert.equal(acb.componentName('sonic_energy'), 'Sonic Energy & Intensity');
  assert.ok(acb.componentDescription('emotional_mood').length > 20);
  assert.ok(acb.componentDescription('tempo_bpm').length > 20, 'tempo has component text too');
});

test('unknown codes title-case rather than vanish (acoustic display is ungated)', () => {
  assert.equal(acb.codeLabel('sonic_energy', 'SOME_NEW_CODE'), 'Some New Code');
  assert.equal(acb.codeLabel('sonic_energy', null), null);
  assert.equal(acb.codeDefinition('sonic_energy', 'SOME_NEW_CODE'), '');
});

test('labels never carry the codebook emoji short_tag', () => {
  for (const c of acb.COMPONENTS) {
    for (const o of acb.optionsFor(c.key)) {
      assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(o.label),
        `${c.key}/${o.code} label must be emoji-free`);
    }
  }
});

test('optionsFor returns every code in codebook order', () => {
  assert.deepEqual(acb.optionsFor('acoustic_type').map(o => o.code),
    ['UNPLUGGED_ACOUSTIC', 'HYBRID_SEMI_ACOUSTIC', 'ELECTRIC_AMPLIFIED']);
  assert.equal(acb.optionsFor('acoustic_type')[0].label, 'Unplugged Acoustic');
});

test('cleanSelection keeps known codes and drops invented ones (filters ARE gated)', () => {
  assert.deepEqual(acb.cleanSelection('vocal_delivery', ['SPOKEN_WORD_RAP', 'NOT_A_CODE']),
    ['SPOKEN_WORD_RAP']);
  assert.deepEqual(acb.cleanSelection('vocal_delivery', 'SPOKEN_WORD_RAP'), ['SPOKEN_WORD_RAP']);
  assert.deepEqual(acb.cleanSelection('vocal_delivery', null), []);
  assert.deepEqual(acb.cleanSelection('no_such_component', ['X']), []);
});

test('acousticSelectionClauses: OR within a component, one param array per component', () => {
  const r = acb.acousticSelectionClauses({
    sonic_energy: ['MODERATE_BALANCED', 'DRIVING_ENERGETIC'],
    vocal_delivery: ['SPOKEN_WORD_RAP'],
  }, 3);
  assert.equal(r.needsJoin, true);
  assert.deepEqual(r.clauses, [
    'sca.sonic_energy = ANY($3::text[])',
    'sca.vocal_delivery = ANY($4::text[])',
  ]);
  assert.deepEqual(r.params, [['MODERATE_BALANCED', 'DRIVING_ENERGETIC'], ['SPOKEN_WORD_RAP']]);
  assert.equal(r.nextIndex, 5);
});

test('acousticSelectionClauses: empty and all-invalid selections need no join', () => {
  assert.equal(acb.acousticSelectionClauses({}, 1).needsJoin, false);
  const bogus = acb.acousticSelectionClauses({ sonic_energy: ['NOPE'] }, 1);
  assert.equal(bogus.needsJoin, false);
  assert.deepEqual(bogus.clauses, []);
  assert.equal(bogus.nextIndex, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test test/acousticCodebook.test.js`
Expected: FAIL — `Cannot find module '../services/acousticCodebook'`

- [ ] **Step 3: Write the implementation**

Create `backend/services/acousticCodebook.js`:

```js
// Codebook service over the curator's acoustic_codebook.json — the six acoustic dimensions
// derived from the audio (sonic_energy … tempo_bpm).
// Pure: no DB access, no writes. Mirrors services/metadataCodebook.js.
const codebook = require('../data/acoustic_codebook.json');

// Ordered component list. `column` is the song_lyric_analysis column and doubles as the
// SQL identifier whitelist — user input never reaches an identifier. `heading` is the short
// UI label (not the codebook's long component_name, which wraps in a grid cell).
// tempo_bpm is NOT here: it is an integer, not an enum, and filters as a range (see TEMPO).
const COMPONENTS = [
  { key: 'sonic_energy',   column: 'sonic_energy',   heading: 'Energy' },
  { key: 'emotional_mood', column: 'emotional_mood', heading: 'Mood' },
  { key: 'rhythmic_style', column: 'rhythmic_style', heading: 'Rhythm' },
  { key: 'acoustic_type',  column: 'acoustic_type',  heading: 'Instruments' },
  { key: 'vocal_delivery', column: 'vocal_delivery', heading: 'Vocals' },
];

const TEMPO = { key: 'tempo_bpm', column: 'tempo_bpm', heading: 'Tempo' };

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

// The codebook's long name for a whole component, e.g. "Sonic Energy & Intensity".
function componentName(key) {
  return (codebook[key] && codebook[key].component_name) || '';
}

function componentDescription(key) {
  return (codebook[key] && codebook[key].description) || '';
}

// Display label. Unknown codes title-case rather than vanish: acoustic display is ungated
// (spec 2026-07-26 §4.3) — the page shows whatever the pipeline emitted.
// The codebook's emoji short_tag is deliberately never used (brand voice).
function codeLabel(key, code) {
  if (!code) return null;
  const e = CODES[key] && CODES[key].get(code);
  return (e && e.label) || titleCase(code);
}

function codeDefinition(key, code) {
  const e = CODES[key] && CODES[key].get(code);
  return (e && e.definition) || '';
}

// Filterable options for one component, in codebook order. No suppressed codes exist here.
function optionsFor(key) {
  return (((codebook[key] || {}).codes) || []).map(i => ({ code: i.code, label: i.label }));
}

// Incoming selection -> known codes only. Filters ARE gated even though display is not, so a
// hand-crafted URL cannot select an invented code.
function cleanSelection(key, values) {
  const known = CODES[key];
  if (!known) return [];
  const arr = values == null ? [] : (Array.isArray(values) ? values : [values]);
  return arr.filter(v => v && known.has(v));
}

// One clause per selected component: OR within a component (= ANY), ANDed across by the
// caller's WHERE accumulation. Every acoustic enum column is single-valued — there is no
// multi/array case. `alias` is the latest-analysis join alias in the caller's query.
function acousticSelectionClauses(sel, startIndex, alias = 'sca') {
  const clauses = [], params = [];
  let idx = startIndex;
  for (const c of COMPONENTS) {
    const codes = cleanSelection(c.key, sel[c.key]);
    if (codes.length === 0) continue;
    clauses.push(`${alias}.${c.column} = ANY($${idx}::text[])`);
    params.push(codes);
    idx++;
  }
  return { clauses, params, needsJoin: clauses.length > 0, nextIndex: idx };
}

module.exports = {
  COMPONENTS, COMPONENT_KEYS, TEMPO,
  componentName, componentDescription, codeLabel, codeDefinition,
  optionsFor, cleanSelection, acousticSelectionClauses,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test test/acousticCodebook.test.js`
Expected: PASS — 7 tests, 0 fail

- [ ] **Step 5: Commit**

```bash
git add backend/services/acousticCodebook.js backend/test/acousticCodebook.test.js
git commit -m "feat(acoustic): pure codebook service over acoustic_codebook.json"
```

---

### Task 2: `getSongAnalysis` returns acoustic cells

**Files:**
- Modify: `backend/services/analysis.js` (require block at top; `getSongAnalysis` ~lines 84-136)
- Modify: `backend/test/analysis.test.js` (the `addAnalysis` helper ~lines 36-49; new tests before the `after` hook)

**Interfaces:**
- Consumes: `acousticCodebook.COMPONENTS`, `.TEMPO`, `.codeLabel`, `.codeDefinition`, `.componentName`, `.componentDescription` (Task 1).
- Produces (relied on by Task 4): `getSongAnalysis` returns an extra key
  `acoustic: Array<{ label: string, value: string, definition: string }>` — the same cell
  shape as the existing `attributes`, so the frontend renders it with the same loop. Empty
  array when the latest pass has no acoustic columns set.

- [ ] **Step 1: Extend the test fixture helper**

In `backend/test/analysis.test.js`, replace the whole `addAnalysis` function with this version (it adds the six acoustic columns, all defaulting to null):

```js
// Insert ONE analysis row (the new "complete pass" model). Fields default to empty.
async function addAnalysis(songId, fields = {}, { model = MODEL, analyzedAt = '2026-07-25 10:00:00' } = {}) {
  const f = {
    lyric_summary: null, themes: '[]', topics: '[]', advocacy: '[]', tactics: '[]', moral_frames: '[]',
    perspective: null, lyrical_tone: null, intensity: null, clarity: null, focus_amount: null,
    target_audience: null, emotions: [],
    sonic_energy: null, emotional_mood: null, rhythmic_style: null,
    acoustic_type: null, vocal_delivery: null, tempo_bpm: null, ...fields,
  };
  await pool.query(
    `INSERT INTO song_lyric_analysis
       (song_id, model_used, analyzed_at, lyric_summary, themes, topics, advocacy, tactics, moral_frames,
        perspective, lyrical_tone, intensity, clarity, focus_amount, target_audience, emotions,
        sonic_energy, emotional_mood, rhythmic_style, acoustic_type, vocal_delivery, tempo_bpm)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16::text[],
             $17,$18,$19,$20,$21,$22)`,
    [songId, model, analyzedAt, f.lyric_summary, f.themes, f.topics, f.advocacy, f.tactics, f.moral_frames,
     f.perspective, f.lyrical_tone, f.intensity, f.clarity, f.focus_amount, f.target_audience, f.emotions,
     f.sonic_energy, f.emotional_mood, f.rhythmic_style, f.acoustic_type, f.vocal_delivery, f.tempo_bpm]);
}
```

- [ ] **Step 2: Write the failing tests**

In `backend/test/analysis.test.js`, add this constant immediately after the existing `CODED`
constant (around line 59). Every value differs from the live data's single value, so these
tests cannot pass by accident:

```js
// Deliberately varied acoustic values — the live data currently carries one identical value
// per dimension, so fixtures must differ from it for these assertions to mean anything.
const ACOUSTIC = {
  sonic_energy: 'EXPLOSIVE_HIGH_INTENSITY', emotional_mood: 'SOMBER_MELANCHOLIC',
  rhythmic_style: 'HIGH_DANCEABLE_RHYTHM', acoustic_type: 'UNPLUGGED_ACOUSTIC',
  vocal_delivery: 'SPOKEN_WORD_RAP', tempo_bpm: 142,
};
```

Then add these three tests just before the final `after(...)` hook:

```js
test('getSongAnalysis returns the six acoustic cells, tempo formatted as BPM', async () => {
  const id = await mkSong('ZZZANL Acoustic');
  await addAnalysis(id, ACOUSTIC);
  const a = await analysis.getSongAnalysis(pool, id);
  assert.deepEqual(a.acoustic.map(x => x.label),
    ['Energy', 'Mood', 'Rhythm', 'Instruments', 'Vocals', 'Tempo']);
  const byLabel = Object.fromEntries(a.acoustic.map(x => [x.label, x.value]));
  assert.equal(byLabel['Energy'], 'Explosive & Heavy');
  assert.equal(byLabel['Vocals'], 'Spoken Word & Rap');
  assert.equal(byLabel['Tempo'], '142 BPM');
  const energy = a.acoustic.find(x => x.label === 'Energy');
  assert.ok(energy.definition.startsWith('Sonic Energy & Intensity — '),
    'the component name leads the tooltip so it stays out of the cell');
  assert.ok(energy.definition.length > 'Sonic Energy & Intensity — '.length,
    'the code definition follows it');
});

test('an acoustic-only pass still yields an analysis (no lyric coding needed)', async () => {
  const id = await mkSong('ZZZANL AcousticOnly');
  await addAnalysis(id, { sonic_energy: 'SOFT_CALM_ACOUSTIC' });
  const a = await analysis.getSongAnalysis(pool, id);
  assert.ok(a, 'sound data alone counts as content');
  assert.equal(a.acoustic.length, 1, 'null acoustic columns are skipped');
  assert.equal(a.acoustic[0].value, 'Soft & Calm');
  assert.deepEqual(a.attributes, []);
  assert.deepEqual(a.themes, []);
});

test('acoustic display is ungated: an off-codebook value title-cases instead of vanishing', async () => {
  const id = await mkSong('ZZZANL AcousticUnknown');
  await addAnalysis(id, { sonic_energy: 'BRAND_NEW_CODE' });
  const a = await analysis.getSongAnalysis(pool, id);
  assert.equal(a.acoustic.length, 1);
  assert.equal(a.acoustic[0].value, 'Brand New Code');
  // No code definition exists for an unknown code, so the tooltip falls back to the
  // component's own description rather than showing "Name — " with nothing after it.
  assert.ok(!a.acoustic[0].definition.includes('—'), 'no dangling "Name — " prefix');
  assert.ok(a.acoustic[0].definition.length > 20, 'component description stands alone');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && node --test test/analysis.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'map')` on `a.acoustic`

- [ ] **Step 4: Implement**

In `backend/services/analysis.js`, add the require next to the existing codebook require
(line 5):

```js
const codebook = require('./metadataCodebook');
const acoustic = require('./acousticCodebook');
```

In `getSongAnalysis`, extend the SELECT column list (currently ends `sla.emotions`):

```js
    `SELECT sla.themes, sla.topics, sla.advocacy, sla.tactics, sla.moral_frames, sla.lyric_summary,
            sla.perspective, sla.lyrical_tone, sla.intensity, sla.clarity, sla.focus_amount,
            sla.target_audience, sla.emotions,
            sla.sonic_energy, sla.emotional_mood, sla.rhythmic_style,
            sla.acoustic_type, sla.vocal_delivery, sla.tempo_bpm
     FROM ${LATEST_ANALYSIS} sla
     WHERE sla.song_id = $1`,
```

Immediately after the `emotions` mapping (the `const emotions = …` block) and before
`const dims = {`, insert:

```js
  // Acoustic dimensions, derived from the audio. UNGATED by design (spec 2026-07-26 §4.3):
  // whatever the pipeline emits is shown, title-cased when off-codebook. The tooltip carries
  // "<Component name> — <definition>" so the long name stays out of the narrow grid cell.
  const acousticCells = [];
  for (const c of acoustic.COMPONENTS) {
    const v = a[c.column];
    if (!v) continue;
    const def = acoustic.codeDefinition(c.key, v);
    acousticCells.push({
      label: c.heading,
      value: acoustic.codeLabel(c.key, v),
      definition: def
        ? `${acoustic.componentName(c.key)} — ${def}`
        : acoustic.componentDescription(c.key),
    });
  }
  if (a.tempo_bpm != null) {
    acousticCells.push({
      label: acoustic.TEMPO.heading,
      value: `${a.tempo_bpm} BPM`,
      definition: acoustic.componentDescription(acoustic.TEMPO.key),
    });
  }
```

Extend `hasContent` to count acoustic data:

```js
  const hasContent = attributes.length > 0 || emotions.length > 0 || acousticCells.length > 0 ||
    Object.values(dims).some(d => d.length > 0) || !!(a.lyric_summary && a.lyric_summary.trim());
```

Add the key to the return object, after `attributes`:

```js
    attributes,
    acoustic: acousticCells,
    dimension_descriptions: DIM_DESCRIPTIONS,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && node --test test/analysis.test.js`
Expected: PASS — all tests in the file, including the three new ones

- [ ] **Step 6: Commit**

```bash
git add backend/services/analysis.js backend/test/analysis.test.js
git commit -m "feat(acoustic): getSongAnalysis returns acoustic cells from the latest pass"
```

---

### Task 3: The three copy renames

**Files:**
- Modify: `frontend/src/pages/SongDetailPage.jsx:192` and `:212`
- Modify: `frontend/src/components/SearchAndFilter.jsx` (the "Analysis" FilterSection's checkbox label, ~line 376)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks. This task is independent of the acoustic work and can be reviewed on its own.

- [ ] **Step 1: Rename the song-page headings**

In `frontend/src/pages/SongDetailPage.jsx`, change:

```jsx
          <h2>Key lyrics</h2>
```

to:

```jsx
          <h2>Lyric highlights</h2>
```

and change:

```jsx
          <h2>Lyrical analysis</h2>
```

to:

```jsx
          <h2>Song analysis</h2>
```

- [ ] **Step 2: Rename the sidebar analysis checkbox**

In `frontend/src/components/SearchAndFilter.jsx`, inside the `<FilterSection title="Analysis" …>` block, change:

```jsx
            <span className="filter-label">Has lyrics analysis<span className="filter-count">({filterOptions.availability?.has_analysis || 0})</span></span>
```

to:

```jsx
            <span className="filter-label">Has song analysis<span className="filter-count">({filterOptions.availability?.has_analysis || 0})</span></span>
```

Leave the removable-chip label (`{ key: 'has_analysis:', label: 'Has analysis' }`) unchanged — it is already neutral.

- [ ] **Step 3: Verify nothing else was renamed**

Run (from the repo root): `git grep -n "Key lyrics\|Key Lyrics\|Lyrical analysis" -- frontend/src`

Expected: exactly three remaining hits, all outside the public song page — `components/admin/LyricsPanel.jsx` ("Key lyrics (public highlights)"), `components/SongSubmissionForm.jsx` ("Key lyrics"), `components/SubmissionsManager.jsx` ("Key Lyrics:"). These are curator/submitter surfaces and stay as they are. A CSS comment in `styles/components.css` also mentions "Lyrical analysis (B2)" — leave it; it names the code block, not UI copy.

- [ ] **Step 4: Lint**

Run: `cd frontend && npm run lint`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SongDetailPage.jsx frontend/src/components/SearchAndFilter.jsx
git commit -m "feat(song-page): rename Key lyrics to Lyric highlights, Lyrical analysis to Song analysis"
```

---

### Task 4: Two labelled groups inside Style & tone

**Files:**
- Modify: `frontend/src/components/LyricalAnalysis.jsx` (the `hasStyle` computation ~line 25, and the Style & tone `<section>` ~lines 41-62)
- Modify: `frontend/src/styles/components.css` (the lyrical-analysis block, after `.la-attr-value` ~line 2244)

**Interfaces:**
- Consumes: `analysis.acoustic` — `Array<{ label, value, definition }>` from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Split the style section into two groups**

In `frontend/src/components/LyricalAnalysis.jsx`, after the existing `const summary = …` line, add:

```jsx
  const acoustic = analysis.acoustic || [];
```

Replace the `hasStyle` line:

```jsx
  const hasStyle = attributes.length > 0 || emotions.length > 0;
```

with:

```jsx
  const hasLyricStyle = attributes.length > 0 || emotions.length > 0;
  const hasSound = acoustic.length > 0;
  const hasStyle = hasLyricStyle || hasSound;
```

Then replace the entire Style & tone `<section>` block — from `{hasStyle && (` down to its
closing `)}` immediately before `{hasThemes && (` — with:

```jsx
        {hasStyle && (
          <section className="la-section">
            <h3 className="la-section-title">Style &amp; tone</h3>
            <p className="la-section-desc">The voice and mood of the lyrics, and how the recording sounds.</p>

            {hasLyricStyle && (
              <div className="la-group">
                <h4 className="la-group-title">In the lyrics</h4>
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
              </div>
            )}

            {hasSound && (
              <div className="la-group">
                <h4 className="la-group-title">In the sound</h4>
                <div className="la-attributes">
                  {acoustic.map(a => (
                    <div key={a.label} className="la-attr">
                      <span className="la-attr-label">{a.label}</span>
                      <InfoTip text={a.definition}>
                        <span className="la-attr-value">{a.value}</span>
                      </InfoTip>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
```

Each group keeps its heading even when it is the only one present, so the reader always knows
which half they are looking at.

- [ ] **Step 2: Add the group styles**

In `frontend/src/styles/components.css`, immediately after the `.la-attr-value` rule
(`.la-attr-value { color: var(--text-primary); }`), add:

```css
/* Style & tone splits into "In the lyrics" / "In the sound"; the rule only appears
   between two groups, so a single-group section shows no stray divider. */
.la-group { display: flex; flex-direction: column; gap: var(--space-1); }
.la-group + .la-group {
  margin-top: var(--space-3); padding-top: var(--space-3);
  border-top: 1px solid var(--border-hairline);
}
.la-group-title {
  margin: 0; font-size: 0.8rem; letter-spacing: 0.03em;
  text-transform: uppercase; color: var(--text-muted);
}
```

- [ ] **Step 3: Lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 lint errors; build completes with no errors

- [ ] **Step 4: Verify against a real song**

Start the backend (`cd backend && npm run dev`) and frontend (`cd frontend && npm run dev`),
then open a song that has analysis — e.g. `http://localhost:5173/song/4691`.

Expected: the section is headed **Song analysis**; inside **Style & tone** there are two
labelled groups separated by a hairline rule; the sound group shows six cells
(Energy / Mood / Rhythm / Instruments / Vocals / Tempo) with the current uniform values
(Moderate & Balanced, Balanced & Neutral, Driving Rhythm, Electric & Amplified,
Melodic Singing, 120 BPM); hovering a sound value shows a tooltip beginning with the
component name.

Do **not** kill node processes globally (`taskkill /F /IM node.exe` kills unrelated node
processes system-wide) — stop only the dev servers you started.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/LyricalAnalysis.jsx frontend/src/styles/components.css
git commit -m "feat(song-page): show acoustic dimensions as an In the sound group under Style & tone"
```

---

### Task 5: Acoustic clauses and tempo bounds in `buildWhere`

**Files:**
- Modify: `backend/services/browseFilters.js` (require block ~line 7; the `joins` initialiser ~line 15; after the scalar block ~line 70)
- Modify: `backend/test/browseFilters.test.js` (append tests)

**Interfaces:**
- Consumes: `acousticCodebook.COMPONENTS`, `.acousticSelectionClauses` (Task 1).
- Produces (relied on by Task 6): `buildWhere` accepts the five acoustic component keys plus
  `tempo_from` / `tempo_to`, honours `exclude: 'acoustic:<key>'`, and sets
  `joins.scalarAnalysis` (never a new join flag).

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/browseFilters.test.js`:

```js
test('buildWhere acoustic components reuse the sca join, OR within a component', () => {
  const r = b.buildWhere({
    sonic_energy: ['EXPLOSIVE_HIGH_INTENSITY', 'DRIVING_ENERGETIC'],
    vocal_delivery: 'SPOKEN_WORD_RAP',
  });
  assert.ok(r.joins.scalarAnalysis, 'acoustic filters ride the existing scalar join');
  assert.ok(!r.joins.analysis, 'no second analysis join is added');
  assert.ok(r.where.includes('sca.sonic_energy = ANY($1::text[])'));
  assert.ok(r.where.includes('sca.vocal_delivery = ANY($2::text[])'));
  assert.deepEqual(r.params[0], ['EXPLOSIVE_HIGH_INTENSITY', 'DRIVING_ENERGETIC']);
  assert.deepEqual(r.params[1], ['SPOKEN_WORD_RAP']);
});

test('buildWhere drops invented acoustic codes rather than querying for them', () => {
  const r = b.buildWhere({ sonic_energy: ['NOT_A_REAL_CODE'] });
  assert.deepEqual(r.where, []);
  assert.equal(r.joins.scalarAnalysis, false);
});

test('buildWhere tempo bounds are integers on the sca row and always applied', () => {
  const r = b.buildWhere({ tempo_from: '100', tempo_to: '140' },
    { exclude: 'acoustic:sonic_energy' });
  assert.ok(r.joins.scalarAnalysis);
  assert.deepEqual(r.where, ['sca.tempo_bpm >= $1', 'sca.tempo_bpm <= $2']);
  assert.deepEqual(r.params, [100, 140], 'parsed as integers, not strings');
  assert.equal(r.nextIndex, 3);
});

test('buildWhere exclude omits one acoustic component but keeps its siblings', () => {
  const r = b.buildWhere(
    { sonic_energy: ['DRIVING_ENERGETIC'], vocal_delivery: ['SPOKEN_WORD_RAP'] },
    { exclude: 'acoustic:sonic_energy' });
  assert.ok(!r.where.some(c => c.includes('sonic_energy')), 'own group excluded');
  assert.ok(r.where.some(c => c.includes('vocal_delivery')), 'sibling kept');
});

test('buildWhere numbers acoustic params after the scalar ones', () => {
  const r = b.buildWhere({
    perspective: ['MORAL_ACCUSER_JUDGE'],
    sonic_energy: ['DRIVING_ENERGETIC'],
  });
  assert.ok(r.where.includes('sca.perspective = ANY($1::text[])'));
  assert.ok(r.where.includes('sca.sonic_energy = ANY($2::text[])'));
  assert.equal(r.nextIndex, 3);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/browseFilters.test.js`
Expected: FAIL — the acoustic assertions fail because `r.where` is `[]`

- [ ] **Step 3: Implement**

In `backend/services/browseFilters.js`, add the require after the existing codebook require:

```js
const codebook = require('./metadataCodebook');
const acousticCodebook = require('./acousticCodebook');
```

Add a comment above the `joins` initialiser inside `buildWhere` so the shared alias is not a
surprise later:

```js
  // scalarAnalysis === the `sca` LATEST_ANALYSIS join. Shared by the scalar metadata
  // components AND the acoustic dimensions — they are columns on the same row.
  const joins = { albums: false, artists: false, effectiveGenre: false, analysis: false, scalarAnalysis: false };
```

Immediately after the existing scalar block (the one ending `joins.scalarAnalysis = true; }`)
and before `return { where, params, nextIndex: idx, joins };`, insert:

```js
  // Acoustic dimensions — same latest-analysis row as the scalar components, so they reuse
  // the `sca` join and add none of their own. OR within a component, AND across.
  const acousticSel = {};
  for (const c of acousticCodebook.COMPONENTS) {
    if (inc(`acoustic:${c.key}`)) acousticSel[c.key] = filters[c.key];
  }
  const ac = acousticCodebook.acousticSelectionClauses(acousticSel, idx);
  if (ac.needsJoin) {
    where.push(...ac.clauses);
    params.push(...ac.params);
    idx = ac.nextIndex;
    joins.scalarAnalysis = true;
  }

  // Tempo is a range, not an enum: always applied (it has no facet counts of its own to
  // protect), exactly like year_from/year_to.
  if (filters.tempo_from) {
    where.push(`sca.tempo_bpm >= $${idx}`); params.push(parseInt(filters.tempo_from, 10));
    idx++; joins.scalarAnalysis = true;
  }
  if (filters.tempo_to) {
    where.push(`sca.tempo_bpm <= $${idx}`); params.push(parseInt(filters.tempo_to, 10));
    idx++; joins.scalarAnalysis = true;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/browseFilters.test.js`
Expected: PASS — all tests in the file, including the five new ones. The pre-existing
`buildWhere with no filters is empty` test must still pass unchanged (no new `joins` key).

- [ ] **Step 5: Commit**

```bash
git add backend/services/browseFilters.js backend/test/browseFilters.test.js
git commit -m "feat(acoustic): filter clauses and tempo bounds in buildWhere, reusing the sca join"
```

---

### Task 6: `acousticFacets`, `tempoRange`, and the `/browse-facets` payload

**Files:**
- Modify: `backend/services/analysis.js` (add two functions after `scalarFacets` ~line 241; extend `module.exports` ~line 320)
- Modify: `backend/routes/spotify.js` (require block; `/browse-facets` handler, lines ~434-515)
- Modify: `backend/test/analysis.test.js` (append tests before the `after` hook)

**Interfaces:**
- Consumes: `acousticCodebook` (Task 1), `buildWhere`'s `acoustic:<key>` exclude tags (Task 5),
  the `ACOUSTIC` fixture constant and extended `addAnalysis` helper (Task 2).
- Produces (relied on by Task 7): `GET /api/spotify/browse-facets` returns
  - `acoustic_facets: { [key]: { key, heading, description, options: [{ code, label, count }] } }`
  - `tempo_range: { min_bpm: number|null, max_bpm: number|null }`

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/analysis.test.js`, before the final `after(...)` hook:

```js
test('acousticFacets counts distinct live songs per code, in codebook order', async () => {
  const id = await mkSong('ZZZANL AcFacet');
  await addAnalysis(id, ACOUSTIC);
  const f = await analysis.acousticFacets(pool, {});
  assert.equal(f.sonic_energy.heading, 'Energy');
  assert.deepEqual(f.acoustic_type.options.map(o => o.code),
    ['UNPLUGGED_ACOUSTIC', 'HYBRID_SEMI_ACOUSTIC', 'ELECTRIC_AMPLIFIED']);
  const opt = f.vocal_delivery.options.find(o => o.code === 'SPOKEN_WORD_RAP');
  assert.ok(opt && opt.count >= 1, 'the fixture song is counted');
  assert.ok(f.sonic_energy.description.length > 20, 'component description carried');
  assert.ok(!('tempo_bpm' in f), 'tempo is a range, not a facet group');
  // zero-count options are kept so the group shape is stable
  assert.ok(f.rhythmic_style.options.length === 3);
});

test('acousticFacets applies a per-component constraint', async () => {
  const id = await mkSong('ZZZANL AcFacetConstrained');
  await addAnalysis(id, ACOUSTIC);
  await pool.query(`UPDATE songs SET language = ARRAY['ZZZ-NoSuchLang'] WHERE id = $1`, [id]);
  const c = await analysis.acousticFacets(pool, {
    vocal_delivery: { joinSql: '', where: [`s.language && $1::text[]`], params: [['ZZZ-NoSuchLang']] },
  });
  const only = c.vocal_delivery.options.find(o => o.code === 'SPOKEN_WORD_RAP');
  assert.equal(only.count, 1, 'only the constrained song counts');
});

test('tempoRange reports the live BPM bounds from the latest pass', async () => {
  const id = await mkSong('ZZZANL Tempo');
  await addAnalysis(id, { tempo_bpm: 300 }); // above any real value, so the max is deterministic
  const r = await analysis.tempoRange(pool);
  assert.equal(r.max_bpm, 300);
  assert.ok(r.min_bpm !== null && r.min_bpm <= 300);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && node --test test/analysis.test.js`
Expected: FAIL — `analysis.acousticFacets is not a function`

- [ ] **Step 3: Implement the two service functions**

In `backend/services/analysis.js`, add immediately after the `scalarFacets` function:

```js
// Per-component option counts for the sidebar's Sound group. Mirrors scalarFacets: each
// component's constraint is built with that component excluded, so an open group's own
// selection never shrinks its own options. Tempo is absent by design — a range has no
// options to count; the route serves tempoRange() instead.
// Parameter base: each constraint's where/params is built with startIndex: 1.
async function acousticFacets(db, constraints = {}) {
  const out = {};
  for (const c of acoustic.COMPONENTS) {
    const cn = constraints[c.key] || {};
    const cParams = cn.params || [];
    const extraJoin = cn.joinSql || '';
    const extraWhere = (cn.where && cn.where.length) ? ' AND ' + cn.where.join(' AND ') : '';
    // c.column comes from the COMPONENTS whitelist — never user input.
    const rows = (await db.query(
      `SELECT code, COUNT(DISTINCT song_id)::int AS count FROM (
         SELECT DISTINCT s.id AS song_id, acf.${c.column} AS code
         FROM songs s${extraJoin}
         JOIN ${LATEST_ANALYSIS} acf ON acf.song_id = s.id
         WHERE s.status = 'included' AND s.published = true${extraWhere}
       ) t WHERE code IS NOT NULL GROUP BY code`,
      [...cParams])).rows;
    const counts = new Map(rows.map(r => [r.code, r.count]));
    out[c.key] = {
      key: c.key,
      heading: c.heading,
      description: acoustic.componentDescription(c.key),
      options: acoustic.optionsFor(c.key).map(o => ({ ...o, count: counts.get(o.code) || 0 })),
    };
  }
  return out;
}

// Min/max BPM over live+published songs' latest pass — feeds the range input placeholders,
// the same role year_range plays for the Year inputs.
async function tempoRange(db) {
  const r = await db.query(
    `SELECT MIN(la.tempo_bpm)::int AS min_bpm, MAX(la.tempo_bpm)::int AS max_bpm
     FROM songs s JOIN ${LATEST_ANALYSIS} la ON la.song_id = s.id
     WHERE s.status = 'included' AND s.published = true`);
  return r.rows[0] || { min_bpm: null, max_bpm: null };
}
```

Add both to `module.exports` alongside `scalarFacets`:

```js
  scalarFacets, acousticFacets, tempoRange, facetFilterConditions, facetSelectionClauses, themeCounts };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test test/analysis.test.js`
Expected: PASS — all tests in the file

- [ ] **Step 5: Wire the route**

In `backend/routes/spotify.js`, add the require next to the existing metadata codebook require:

```js
const acousticCodebook = require('../services/acousticCodebook');
```

Inside the `/browse-facets` handler, immediately after the scalar constraint loop
(`for (const c of codebook.COMPONENTS) { … }`), add:

```js
    // One exclude-self constraint per acoustic component.
    const acousticConstraints = {};
    for (const c of acousticCodebook.COMPONENTS) {
      const bwAc = browse.buildWhere(f, { exclude: `acoustic:${c.key}`, startIndex: 1 });
      acousticConstraints[c.key] = {
        joinSql: browse.joinSql(bwAc.joins), where: bwAc.where, params: bwAc.params,
      };
    }
```

Extend the `Promise.all` destructuring and array:

```js
    const [gR, lR, aR, tR, langR, facets, yR, scalar_facets, acoustic_facets, tempo_range] =
      await Promise.all([
        pool.query(genreSql, bwG.params),
        pool.query(lengthSql, bwL.params),
        pool.query(availSql, bwA.params),
        pool.query(toggleSql, bwT.params),
        pool.query(langSql, bwLang.params),
        analysis.facetTree(pool, constraint),
        pool.query(yearSql),
        analysis.scalarFacets(pool, scalarConstraints),
        analysis.acousticFacets(pool, acousticConstraints),
        analysis.tempoRange(pool),
      ]);
```

Add the two keys to the JSON response, after `scalar_facets`:

```js
      scalar_facets,
      acoustic_facets,
      tempo_range,
```

`/search` needs no change — it passes `req.query` straight into `buildWhere`, so the acoustic
params flow through automatically.

- [ ] **Step 6: Smoke the endpoints against the live DB**

Start the backend on a spare port so a running dev server is untouched:

```bash
cd backend && PORT=5001 node server.js
```

(PowerShell equivalent: `$env:PORT='5001'; node server.js` — PowerShell has no inline
env-var prefix.)

In another shell:

```bash
curl -s "http://localhost:5001/api/spotify/browse-facets" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(Object.keys(j.acoustic_facets));console.log(j.acoustic_facets.sonic_energy.options);console.log(j.tempo_range);})"
```

Expected: the five component keys; `sonic_energy` options showing `MODERATE_BALANCED` with a
count around 692 and the other three at 0; `tempo_range` `{ min_bpm: 120, max_bpm: 120 }`.

```bash
curl -s "http://localhost:5001/api/spotify/search?sonic_energy=MODERATE_BALANCED&limit=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).pagination))"
curl -s "http://localhost:5001/api/spotify/search?tempo_from=200&limit=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).pagination))"
```

Expected: the first returns a total around 692; the second returns total 0 (no song is above
200 BPM). Then stop **only** that backend process — never `taskkill /F /IM node.exe`.

- [ ] **Step 7: Commit**

```bash
git add backend/services/analysis.js backend/routes/spotify.js backend/test/analysis.test.js
git commit -m "feat(acoustic): acousticFacets + tempoRange on /browse-facets"
```

---

### Task 7: The Sound sidebar group

**Files:**
- Modify: `frontend/src/utils/browseUrlState.js`
- Modify: `frontend/src/components/SearchAndFilter.jsx`
- Modify: `frontend/src/components/ScalarFacetGroups.jsx` (comment only)

**Interfaces:**
- Consumes: `acoustic_facets` and `tempo_range` from `/browse-facets` (Task 6); the acoustic
  and tempo query params accepted by `/search` (Task 5).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the URL/state keys**

In `frontend/src/utils/browseUrlState.js`, add after the `SCALAR_KEYS` export:

```js
// The five acoustic dimensions (song_lyric_analysis columns) derived from the audio —
// filterable since 2026-07-26. tempo_bpm is a range (tempo_from/tempo_to), not an array.
export const ACOUSTIC_KEYS = [
  'sonic_energy', 'emotional_mood', 'rhythmic_style', 'acoustic_type', 'vocal_delivery',
];
```

In `EMPTY_FILTERS`, add after the scalar component defaults:

```js
  sonic_energy: [], emotional_mood: [], rhythmic_style: [], acoustic_type: [], vocal_delivery: [],
  tempo_from: '', tempo_to: '',
```

Extend the two key lists:

```js
const ARRAY_KEYS = [
  'genres', 'parent_genres', 'lengths', 'languages',
  'themes', 'targets', 'actions', 'tactics', 'moral_frames',
  'facet_groups', 'facet_subdims',
  ...SCALAR_KEYS,
  ...ACOUSTIC_KEYS,
];
const STRING_KEYS = ['year_from', 'year_to', 'dir', 'tempo_from', 'tempo_to'];
```

No other change is needed — `readFilterState`, `applyFilterState`, `BROWSE_KEYS` and the
sessionStorage layer all derive from these lists.

- [ ] **Step 2: Thread the new state through SearchAndFilter**

In `frontend/src/components/SearchAndFilter.jsx`:

Extend the import:

```jsx
import { readBrowseState, applyFilterState, writeStoredBrowseState, EMPTY_FILTERS, SCALAR_KEYS, ACOUSTIC_KEYS } from '../utils/browseUrlState';
```

Add the facet state beside `scalarFacets`:

```jsx
  const [acousticFacets, setAcousticFacets] = useState({});
```

In `buildSearchParams`, after the `SCALAR_KEYS.forEach(...)` line:

```jsx
    ACOUSTIC_KEYS.forEach(k => { if (filters[k].length) p[k] = filters[k]; });
    if (filters.tempo_from) p.tempo_from = filters.tempo_from;
    if (filters.tempo_to) p.tempo_to = filters.tempo_to;
```

In the browse-facets effect, extend the `setFilterOptions` object and add the new setter:

```jsx
      setFilterOptions({
        genre_tree: data.genre_tree, year_range: data.year_range,
        languages: data.languages, length_buckets: data.length_buckets,
        availability: data.availability, tempo_range: data.tempo_range,
      });
      setFacets(data.facets || {});
      setScalarFacets(data.scalar_facets || {});
      setAcousticFacets(data.acoustic_facets || {});
```

Add a label map beside `scalarLabelMap`:

```jsx
  const acousticLabelMap = useMemo(() => {
    const m = {};
    ACOUSTIC_KEYS.forEach(k => {
      m[k] = {};
      (acousticFacets[k]?.options || []).forEach(o => { m[k][o.code] = o.label; });
    });
    return m;
  }, [acousticFacets]);
```

- [ ] **Step 3: Add the chips**

In the `chips` `useMemo`, after the `SCALAR_KEYS.forEach(...)` line:

```jsx
    ACOUSTIC_KEYS.forEach(k => filters[k].forEach(code =>
      list.push({ key: `${k}:${code}`, label: acousticLabelMap[k]?.[code] || code })));
    if (filters.tempo_from || filters.tempo_to) {
      list.push({ key: 'tempo:', label: `${filters.tempo_from || '…'}–${filters.tempo_to || '…'} BPM` });
    }
```

Add `acousticLabelMap` to that `useMemo`'s dependency array:

```jsx
  }, [searchQuery, filters, filterOptions, lengthLabelMap, codeLabelMap, facetLabelMaps, scalarLabelMap, acousticLabelMap]);
```

In `removeChip`, add the tempo case beside the year one and the acoustic case beside the
scalar one:

```jsx
    if (type === 'tempo') return setFilters(prev => ({ ...prev, tempo_from: '', tempo_to: '' }));
```

```jsx
    if (SCALAR_KEYS.includes(type)) return toggleInArray(type, value, false);
    if (ACOUSTIC_KEYS.includes(type)) return toggleInArray(type, value, false);
```

- [ ] **Step 4: Add the Sound sidebar group**

Beside `const yr = filterOptions.year_range || {};` add:

```jsx
  const tr = filterOptions.tempo_range || {};
```

Insert this immediately after the closing `</FilterSection>` of the "Lyric metadata" group and
before the "Year range" group:

```jsx
      <FilterSection
        title="Sound"
        count={ACOUSTIC_KEYS.reduce((n, k) => n + filters[k].length, 0) + ((filters.tempo_from || filters.tempo_to) ? 1 : 0)}
      >
        <ScalarFacetGroups
          groups={acousticFacets}
          selected={filters}
          onToggle={(key, code, checked) => toggleInArray(key, code, checked)}
        />
        <FilterSection title="Tempo" count={(filters.tempo_from || filters.tempo_to) ? 1 : 0}>
          <div className="range-inputs">
            <input type="number" placeholder={tr.min_bpm ? `From ${tr.min_bpm}` : 'From'}
              value={filters.tempo_from} onChange={(e) => setScalar('tempo_from', e.target.value)}
              min={tr.min_bpm} max={tr.max_bpm} />
            <span>to</span>
            <input type="number" placeholder={tr.max_bpm ? `To ${tr.max_bpm}` : 'To'}
              value={filters.tempo_to} onChange={(e) => setScalar('tempo_to', e.target.value)}
              min={tr.min_bpm} max={tr.max_bpm} />
          </div>
        </FilterSection>
      </FilterSection>
```

Nesting Tempo as its own `FilterSection` makes it read as a sixth dimension alongside the five
checkbox groups. **No `note` prop** — the curator has twice cut explanatory sidebar copy, and
the group titles carry the meaning.

- [ ] **Step 5: Widen the ScalarFacetGroups comment**

In `frontend/src/components/ScalarFacetGroups.jsx`, replace the top comment with:

```jsx
// A set of analysis components rendered as collapsible checkbox groups. Used for both the
// seven lyric-metadata components (`scalar_facets`) and the five acoustic dimensions
// (`acoustic_facets`). Options, labels, counts and the description all come from the API —
// the codebooks live in the backend only. Selecting several codes in one group widens (OR);
// selecting across groups narrows (AND).
```

- [ ] **Step 6: Lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 lint errors; build completes with no errors

- [ ] **Step 7: Verify in the browser**

With backend and frontend dev servers running, open `http://localhost:5173/`.

Expected:
1. A **Sound** group sits between "Lyric metadata" and "Year range"; expanding it shows five
   checkbox groups (Energy, Mood, Rhythm, Instruments, Vocals) plus a nested **Tempo** group.
2. In each group exactly one option has a non-zero count (~692) and the rest show (0) and are
   disabled — the correct rendering of today's uniform data.
3. Ticking "Moderate & Balanced" narrows the results, adds a removable chip, and writes
   `?sonic_energy=MODERATE_BALANCED` to the URL. Reloading keeps it applied. Removing the chip
   restores the full list.
4. Entering `From 200` in Tempo returns 0 results and adds a `…–200 BPM`-style chip; clearing
   it via the chip restores the list.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/utils/browseUrlState.js frontend/src/components/SearchAndFilter.jsx frontend/src/components/ScalarFacetGroups.jsx
git commit -m "feat(browse): Sound filter group for the acoustic dimensions + BPM range"
```

---

### Task 8: Whole-feature verification

**Files:** none modified (verification only, plus doc updates).

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: a verified, documented feature ready for the curator's smoke.

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test`
Expected: every test passes. The suite was 131 tests before this work; expect 131 + the new
ones (7 in `acousticCodebook.test.js`, 6 added across `analysis.test.js`, 5 in
`browseFilters.test.js`). Report the actual number — do not assert a number you have not seen.

- [ ] **Step 2: Frontend lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 lint errors, build completes

- [ ] **Step 3: End-to-end smoke**

With both dev servers running:

1. Song page (`/song/<an analysed song id>`): heading reads **Song analysis**; the key-lyrics
   section (if the song has highlights) reads **Lyric highlights**; Style & tone shows both
   labelled groups with a rule between them; the six sound cells render; tooltips work.
2. A song with **no** analysis renders no Song analysis section at all (unchanged behaviour).
3. Browse: the Sound group filters as described in Task 7 Step 7; combining a Sound selection
   with a Lyric metadata selection narrows further (AND across groups).
4. "Clear all" empties every chip including the acoustic ones and the tempo range.

Stop only the dev servers you started.

- [ ] **Step 4: Update the project docs**

- `docs/PROJECT_STATE.md` — advance the current session, refresh Next Tasks (B4 remains next),
  add a Decision Log entry dated 2026-07-26 covering: the acoustic columns' zero-variance data
  and the curator's decision to ship as-is; the ungated-display / gated-selection asymmetry;
  the reuse of the `sca` join; and the three renames. Append a Changelog entry.
- `docs/PROJECT_PLAN.md` — record the session.
- `CLAUDE.md` — extend the `services/analysis.js` bullet to mention `acousticCodebook.js` and
  the acoustic dimensions, and the frontend bullet to mention the Sound filter group.
- `docs/PRD.md` §11 — add the acoustic dimensions to the as-built feature inventory.

- [ ] **Step 5: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs(acoustic): record the acoustic dimensions session"
```

---

## Notes for the implementer

- **Never run `taskkill /F /IM node.exe`** — it kills every node process on the machine,
  including unrelated ones. Stop specific PIDs only.
- **Never put temporary scripts in `backend/`** — nodemon restarts the dev server mid-run.
  Use the session scratchpad with absolute `require` paths.
- The backend dev launcher may be running plain `node server.js` (no reload). Restart it
  before smoking any route change.
- After any scripted file rewrite, check for mojibake: `grep -nP '[^\x00-\x7F]' <file>`.
  The spec and this plan contain intentional non-ASCII (em dashes, `&`), so compare against
  what you expect rather than assuming any hit is a bug.
