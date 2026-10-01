# Triage 6 — About analysis explainer, AI disclosure, editable page copy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/about` into a three-tab section — the existing About page, a narrative explainer of how the analysis is produced (with an AI disclosure), and a complete reference glossary of every code the site uses — with the About and explainer copy living in curator-editable Markdown files.

**Architecture:** Two new backend reads. `GET /api/content/:slug` serves curator-authored Markdown from `backend/data/*.md` through a hard-coded whitelist. `GET /api/analysis/codebook` serves the whole reference catalogue plus a coverage block in one response, built by a new `services/referenceCodebook.js` that *composes* the existing codebook services rather than re-reading their JSON. On the frontend, `AboutPage` becomes a tab shell over three routes; two of them are Markdown pages rendered by a shared `<MarkdownPage>` with a build-time bundled fallback; the third renders the catalogue with the same `FilterSection` collapsible the browse sidebar uses.

**Tech Stack:** Node/Express + `pg` (backend, CommonJS, `node:test`), React 19 + react-router 7 + Vite 7 (frontend, ESM, `node --test` for pure modules), plus one new dependency pair: `react-markdown` + `remark-gfm`.

**Spec:** [`docs/superpowers/specs/2026-08-04-triage-6-about-analysis-explainer-design.md`](../specs/2026-08-04-triage-6-about-analysis-explainer-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Read-only.** Nothing in this plan writes to `song_lyric_analysis`, `song_embeddings`, `song_coordinates` or any curatorial column. If you find yourself writing an `UPDATE` or `INSERT` outside a test fixture, stop.
- **Publish gate.** Every public read filters `WHERE s.status = 'included' AND s.published = true`. No exceptions — a static asset bypassing this gate is exactly the bug that got `vector_space.json` deleted.
- **Latest pass only.** Any query touching `song_lyric_analysis` joins through the exported `analysis.LATEST_ANALYSIS` fragment. Never write a fourth latest-analysis join pattern, and never hard-code a model string.
- **Suppressed codes stay suppressed.** `THEMATIC_ABSENCE`, `ABSENCE_OF_FOCUS`, `INSUFFICIENT_DATA`, `UNSPECIFIED` must not appear in any payload or on any page. `metadataCodebook.optionsFor()` already filters them — use it rather than reading the JSON directly.
- **Design tokens only.** New CSS uses `--bg-*` / `--text-*` / `--accent-*` / `--space-*` / `--radius-*` / `--text-*` variables. Never a raw colour or a raw pixel spacing value.
- **Relative API URLs.** New frontend code fetches `/api/...` through the Vite proxy. Never hardcode `http://localhost:5000` — that is known Phase 5 deployment debt and we are not adding to it.
- **The `[]`-deps + ref hazard.** A `useEffect` with `[]` deps that reads a ref is unreliable on any component with a loading early-return: the element does not exist on the only render the effect sees. This bit `/explore` twice. `AnalysisReference` has a loading gate, so if you need a DOM element (e.g. to scroll to a `#fragment`), hold it in state via a callback ref so its arrival is a dependency.
- **Backend test sentinel.** Each backend test file uses a fixture prefix unique to that file. This plan uses **`ZZZREF`** (`referenceCodebook.test.js`). Shared prefixes race under concurrent runs.
- **Backend tests hit the live dev DB.** They are not hermetic. Any fixture row you insert, you delete in an `after()` hook.
- **Do not run `taskkill /F /IM node.exe`.** It kills every Node process on the machine, including the curator's servers. Target a specific PID found via `netstat -ano`.
- **Never `SELECT` from `song_lyrics`.** It is local-only for copyright reasons and `test/lyrics_privacy.test.js` enforces it.

---

## File Structure

**Backend (CommonJS)**

| File | Responsibility |
|---|---|
| `backend/services/acousticCodebook.js` *(modify)* | + two additive getters exposing `derivation_source` and per-code `threshold` |
| `backend/services/referenceCodebook.js` *(create)* | Composes taxonomy + both codebook services into the reference catalogue; owns the count and coverage queries |
| `backend/routes/analysis.js` *(modify)* | + `GET /codebook` |
| `backend/routes/content.js` *(create)* | `GET /:slug` over a whitelist of Markdown files |
| `backend/server.js` *(modify)* | mounts `/api/content` |
| `backend/data/about.md` *(create)* | Curator-editable About copy |
| `backend/data/analysis.md` *(create)* | Curator-editable explainer + AI disclosure |
| `backend/test/referenceCodebook.test.js` *(create)* | Catalogue shape, suppression, counts, coverage, publish gate |
| `backend/test/content.test.js` *(create)* | Whitelist, 404s, traversal, prototype keys |

**Frontend (ESM)**

| File | Responsibility |
|---|---|
| `frontend/src/utils/contentTokens.js` *(create)* | Pure `{{token}}` substitution + token-value builder |
| `frontend/src/utils/contentTokens.test.js` *(create)* | Its tests |
| `frontend/src/utils/browseUrlState.js` *(modify)* | + `termHref(key, code)` — it already owns the browse param vocabulary |
| `frontend/src/utils/browseUrlState.test.js` *(create)* | `termHref` round-trips through `readFilterState` |
| `frontend/src/components/MarkdownPage.jsx` *(create)* | Fetch + fallback + token substitution + render |
| `frontend/src/pages/AboutPage.jsx` *(modify)* | Becomes the tab shell |
| `frontend/src/pages/about/AboutOverview.jsx` *(create)* | `about.md` + the three stat badges |
| `frontend/src/pages/about/AnalysisExplainer.jsx` *(create)* | `analysis.md` + coverage tokens |
| `frontend/src/pages/about/AnalysisReference.jsx` *(create)* | The glossary |
| `frontend/src/pages/about/useCodebook.js` *(create)* | Shared, module-cached fetch of `/api/analysis/codebook` |
| `frontend/src/App.jsx` *(modify)* | Nested `/about` routes |
| `frontend/src/styles/components.css` *(modify)* | `.about-tabs`, `.markdown-body`, `.reference-*` |

---

## Task 1: Acoustic getters + the reference catalogue shape (no DB)

**Files:**
- Modify: `backend/services/acousticCodebook.js`
- Create: `backend/services/referenceCodebook.js`
- Test: `backend/test/referenceCodebook.test.js`

**Interfaces:**
- Consumes: `analysis.taxonomy`, `analysis.DIM_TO_TAXONOMY`, `metadataCodebook.COMPONENTS`/`optionsFor`/`componentDescription`/`codeDefinition`, `acousticCodebook.COMPONENTS`/`TEMPO`/`optionsFor`/`componentName`/`componentDescription`/`codeDefinition`
- Produces:
  - `acousticCodebook.derivationSource(key) -> string` (`''` if absent)
  - `acousticCodebook.codeThreshold(key, code) -> string` (`''` if absent)
  - `referenceCodebook.catalogue() -> { thematic: Dimension[], metadata: Component[], acoustic: AcousticDimension[] }` with every `count` set to `0`. Shapes exactly as in the spec §5.2. `thematic[].key` is the **public** dimension name (`themes`, `targets`, `actions`, `tactics`, `moral_frames`).

- [ ] **Step 1: Write the failing test**

Create `backend/test/referenceCodebook.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const ref = require('../services/referenceCodebook');
const acb = require('../services/acousticCodebook');
const taxonomy = require('../data/taxonomy.json');

// Unique fixture sentinel per test file: ZZZREF.

test('acousticCodebook exposes derivation source and per-code thresholds', () => {
  assert.match(acb.derivationSource('sonic_energy'), /Librosa/);
  assert.match(acb.derivationSource('tempo_bpm'), /Librosa/);
  assert.equal(acb.derivationSource('not_a_dimension'), '');
  assert.match(acb.codeThreshold('sonic_energy', 'EXPLOSIVE_HIGH_INTENSITY'), /RMS/);
  assert.equal(acb.codeThreshold('sonic_energy', 'NOT_A_CODE'), '');
});

test('catalogue lists all five thematic dimensions with descriptions', () => {
  const c = ref.catalogue();
  assert.deepEqual(c.thematic.map(d => d.key),
    ['themes', 'targets', 'actions', 'tactics', 'moral_frames']);
  for (const d of c.thematic) {
    assert.ok(d.label, `${d.key} has a label`);
    assert.ok(d.description.length > 20, `${d.key} has a description`);
    assert.ok(d.sub_dimensions.length > 0, `${d.key} has sub-dimensions`);
  }
});

test('catalogue keeps every taxonomy term, including ones no song carries', () => {
  const c = ref.catalogue();
  // A term ID is unique WITHIN its dimension, not globally: the five dimensions are five
  // independent columns, and the curator deliberately uses e.g. `boycott` as both an Action
  // and a Tactic, `apathy` as both a Theme and a Subject. Nine IDs are shared this way, so
  // a global Set would collapse 141 terms into 132. Count per dimension — which also catches
  // a duplicate placement inside one dimension, something a global check cannot see.
  // (The taxonomy key and the public dimension key coincide for all five.)
  for (const d of c.thematic) {
    const codes = [];
    for (const sd of d.sub_dimensions) {
      for (const g of sd.groups) {
        for (const t of g.terms) {
          assert.ok(t.definition.length > 0, `${d.key}/${t.code} has a definition`);
          assert.equal(t.count, 0, 'catalogue() is count-free');
          codes.push(t.code);
        }
      }
    }
    assert.equal(codes.length, taxonomy[d.key].length,
      `${d.key}: every taxonomy term appears, none dropped for being unused`);
    assert.equal(new Set(codes).size, codes.length,
      `${d.key}: no term is placed in two groups`);
  }
});

test('catalogue lists the seven metadata components and hides the four absence codes', () => {
  const c = ref.catalogue();
  assert.deepEqual(c.metadata.map(m => m.key), [
    'perspective', 'lyrical_tone', 'intensity', 'clarity',
    'focus_amount', 'target_audience', 'emotions',
  ]);
  assert.equal(c.metadata.find(m => m.key === 'target_audience').heading, 'Speaking to');
  const codes = c.metadata.flatMap(m => m.codes.map(x => x.code));
  for (const hidden of ['THEMATIC_ABSENCE', 'ABSENCE_OF_FOCUS', 'INSUFFICIENT_DATA', 'UNSPECIFIED']) {
    assert.ok(!codes.includes(hidden), `${hidden} must not be served`);
  }
  for (const m of c.metadata) {
    assert.ok(m.description.length > 20, `${m.key} has a description`);
    assert.ok(m.codes.every(x => x.definition.length > 0), `${m.key} codes are defined`);
  }
});

test('catalogue lists six acoustic dimensions, each with a derivation source', () => {
  const c = ref.catalogue();
  assert.deepEqual(c.acoustic.map(a => a.key), [
    'sonic_energy', 'emotional_mood', 'rhythmic_style',
    'acoustic_type', 'vocal_delivery', 'tempo_bpm',
  ]);
  for (const a of c.acoustic) {
    assert.ok(a.derivation_source.length > 0, `${a.key} names its derivation`);
    assert.ok(a.description.length > 20, `${a.key} has a description`);
  }
  const energy = c.acoustic.find(a => a.key === 'sonic_energy');
  assert.ok(energy.codes.every(x => x.threshold.length > 0), 'every energy code shows its threshold');
  // tempo is an integer, not an enum — it carries no codes.
  assert.deepEqual(c.acoustic.find(a => a.key === 'tempo_bpm').codes, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `npm test -- test/referenceCodebook.test.js`
Expected: FAIL — `Cannot find module '../services/referenceCodebook'`.

- [ ] **Step 3: Add the two acoustic getters**

In `backend/services/acousticCodebook.js`, add after `codeDefinition` (around line 57) and extend `module.exports`:

```js
// The Librosa measurement a dimension is derived from. Shown on the About Reference page,
// which is the only surface that discloses how the sound dimensions are produced.
function derivationSource(key) {
  return (codebook[key] && codebook[key].derivation_source) || '';
}

// The numeric cut-off that puts a song in this code (e.g. "Librosa RMS > 0.12").
function codeThreshold(key, code) {
  const e = CODES[key] && CODES[key].get(code);
  return (e && e.threshold) || '';
}
```

```js
module.exports = {
  COMPONENTS, COMPONENT_KEYS, TEMPO,
  componentName, componentDescription, codeLabel, codeDefinition, optionsFor, cleanSelection,
  acousticSelectionClauses, derivationSource, codeThreshold,
};
```

**Note:** keep the existing export list intact — add the two names to it rather than replacing the object wholesale. Read the file first and match what is already there.

- [ ] **Step 4: Write `referenceCodebook.catalogue()`**

Create `backend/services/referenceCodebook.js`:

```js
// The About → Reference page's data source: the complete vocabulary the site uses, with
// definitions and live song counts.
//
// This module COMPOSES the existing owners — it never re-reads their JSON. metadataCodebook
// and acousticCodebook stay the single owners of their files, which is what keeps label
// rules and code suppression in one place.
//
// Why this exists rather than reusing analysis.facetTree: facetTree keeps only codes whose
// count is greater than zero and carries no per-term definition. That is right for a filter
// sidebar, where an option matching nothing is noise, and exactly wrong for a glossary —
// where the gap between the taxonomy's size and the coded corpus is itself information.
const analysis = require('./analysis');
const metadata = require('./metadataCodebook');
const acoustic = require('./acousticCodebook');
// Read directly for one field only: the codebook's long `component_name` ("Narrative
// Perspective"), which is distinct from the short UI heading ("Perspective") and for which
// metadataCodebook exposes no getter. Nothing else here reads a JSON file — everything else
// goes through the owning service.
const metadataJson = require('../data/master_metadata_codebook.json');

const taxonomy = analysis.taxonomy;

function componentName(key) {
  return (metadataJson[key] && metadataJson[key].component_name) || '';
}

// DB column -> public dimension name, in the order the page renders them. Mirrors
// analysis.PUBLIC_DIMS; kept local so the render order is explicit here.
const DIMENSIONS = [
  { column: 'themes', key: 'themes' },
  { column: 'topics', key: 'targets' },
  { column: 'advocacy', key: 'actions' },
  { column: 'tactics', key: 'tactics' },
  { column: 'moral_frames', key: 'moral_frames' },
];

// The full vocabulary with every count at 0. Pure — no DB. withCounts() fills the counts in.
function catalogue() {
  return {
    thematic: DIMENSIONS.map(({ column, key }) => {
      const taxKey = analysis.DIM_TO_TAXONOMY[column];
      const h = taxonomy.hierarchy[taxKey];
      const terms = taxonomy[taxKey] || [];
      return {
        key,
        label: h.label,
        description: h.description || '',
        count: 0,
        sub_dimensions: Object.entries(h.sub_dimensions).map(([subId, sub]) => ({
          id: subId,
          label: sub.label,
          count: 0,
          groups: Object.entries(sub.groups).map(([groupId, groupLabel]) => ({
            id: groupId,
            label: groupLabel,
            count: 0,
            // Zero-count terms are KEPT. See the module comment.
            terms: terms
              .filter(t => t.sub_dimension === subId && t.group === groupId)
              .map(t => ({ code: t.id, label: t.label, definition: t.definition || '', count: 0 })),
          })),
        })),
      };
    }),

    metadata: metadata.COMPONENTS.map(c => ({
      key: c.key,
      heading: c.heading,
      name: componentName(c.key),
      description: metadata.componentDescription(c.key),
      // optionsFor() already drops the four suppressed absence codes.
      codes: metadata.optionsFor(c.key).map(o => ({
        code: o.code,
        label: o.label,
        definition: metadata.codeDefinition(c.key, o.code),
        count: 0,
      })),
    })),

    acoustic: [...acoustic.COMPONENTS, acoustic.TEMPO].map(c => ({
      key: c.key,
      heading: c.heading,
      name: acoustic.componentName(c.key),
      description: acoustic.componentDescription(c.key),
      derivation_source: acoustic.derivationSource(c.key),
      // tempo_bpm is an integer range, so it has no codes — an empty array, not a missing key.
      codes: (c.key === acoustic.TEMPO.key ? [] : acoustic.optionsFor(c.key)).map(o => ({
        code: o.code,
        label: o.label,
        definition: acoustic.codeDefinition(c.key, o.code),
        threshold: acoustic.codeThreshold(c.key, o.code),
        count: 0,
      })),
    })),
  };
}

module.exports = { catalogue, DIMENSIONS };
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `backend/`: `npm test -- test/referenceCodebook.test.js`
Expected: PASS, 5 tests.

If the "every taxonomy term appears exactly once" assertion fails, the cause is almost certainly a term whose `sub_dimension`/`group` pair is absent from `hierarchy` — print the missing codes and report it rather than loosening the assertion. A term that cannot be placed in the hierarchy is a real data problem worth surfacing.

- [ ] **Step 6: Run the whole backend suite**

Run from `backend/`: `npm test`
Expected: all existing tests still pass (165 before this task) plus the 5 new ones.

- [ ] **Step 7: Commit**

```bash
git add backend/services/acousticCodebook.js backend/services/referenceCodebook.js backend/test/referenceCodebook.test.js
git commit -m "feat(about): reference catalogue shape over the existing codebooks"
```

---

## Task 2: Counts and coverage

**Files:**
- Modify: `backend/services/referenceCodebook.js`
- Test: `backend/test/referenceCodebook.test.js` (append)

**Interfaces:**
- Consumes: `analysis.LATEST_ANALYSIS` (already exported), `catalogue()` from Task 1
- Produces:
  - `referenceCodebook.coverage(db) -> { live_songs, artists, analysed_songs, mapped_songs, latest_pass_models: [{model, songs}], latest_pass_at }`
  - `referenceCodebook.payload(db) -> { thematic, metadata, acoustic, coverage }` — the catalogue with real counts plus the coverage block

- [ ] **Step 1: Write the failing test**

Append to `backend/test/referenceCodebook.test.js`:

```js
const { after } = require('node:test');
const pool = require('../database/db');

after(async () => { await pool.end(); });

test('payload fills real counts and keeps zero-count terms', async () => {
  const p = await ref.payload(pool);
  const allTerms = p.thematic.flatMap(d =>
    d.sub_dimensions.flatMap(sd => sd.groups.flatMap(g => g.terms)));

  assert.ok(allTerms.some(t => t.count > 0), 'some terms are in use');
  assert.ok(allTerms.some(t => t.count === 0), 'zero-count terms survive into the payload');
  assert.ok(allTerms.every(t => Number.isInteger(t.count)), 'counts are integers, not strings');

  // A dimension's count is the number of distinct songs carrying any of its terms, so it is
  // at least as large as its biggest term and no larger than the sum of them.
  for (const d of p.thematic) {
    const terms = d.sub_dimensions.flatMap(sd => sd.groups.flatMap(g => g.terms));
    const max = Math.max(0, ...terms.map(t => t.count));
    const sum = terms.reduce((n, t) => n + t.count, 0);
    assert.ok(d.count >= max, `${d.key}: dimension count >= largest term`);
    assert.ok(d.count <= sum, `${d.key}: dimension count <= sum of terms`);
  }
});

test('a term count matches a direct query for that code', async () => {
  const p = await ref.payload(pool);
  const term = p.thematic
    .find(d => d.key === 'targets')
    .sub_dimensions.flatMap(sd => sd.groups.flatMap(g => g.terms))
    .find(t => t.count > 0);
  assert.ok(term, 'targets has at least one coded term');

  const direct = (await pool.query(
    `SELECT COUNT(DISTINCT s.id)::int AS n
       FROM songs s
       JOIN ${analysisModule.LATEST_ANALYSIS} sa ON sa.song_id = s.id
       CROSS JOIN LATERAL jsonb_array_elements(sa.topics) AS elem
      WHERE s.status = 'included' AND s.published = true
        AND elem->>'code' = $1`, [term.code])).rows[0].n;
  assert.equal(term.count, direct, `${term.code} count matches a direct query`);
});

test('an unpublished song raises no count (the publish gate holds)', async () => {
  // ZZZREF fixture: an unpublished song carrying a known code, which must stay invisible.
  const code = 'factory_farming';
  const before = await termCount(code);

  const songId = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ('ZZZREF publish gate', 'included', false, 'manual') RETURNING id`)).rows[0].id;
  try {
    await pool.query(
      `INSERT INTO song_lyric_analysis (song_id, topics, model_used, analyzed_at)
       VALUES ($1, $2::jsonb, 'ZZZREF-model', NOW())`,
      [songId, JSON.stringify([{ code }])]);
    assert.equal(await termCount(code), before, 'unpublished song did not raise the count');

    await pool.query('UPDATE songs SET published = true WHERE id = $1', [songId]);
    assert.equal(await termCount(code), before + 1, 'publishing it does raise the count');
  } finally {
    await pool.query('DELETE FROM song_lyric_analysis WHERE song_id = $1', [songId]);
    await pool.query('DELETE FROM songs WHERE id = $1', [songId]);
  }

  async function termCount(c) {
    const p = await ref.payload(pool);
    return p.thematic.find(d => d.key === 'targets')
      .sub_dimensions.flatMap(sd => sd.groups.flatMap(g => g.terms))
      .find(t => t.code === c).count;
  }
});

test('coverage reports live, analysed and mapped songs plus the latest-pass models', async () => {
  const c = (await ref.payload(pool)).coverage;
  assert.ok(c.live_songs > 1000, 'live songs looks like the real catalogue');
  assert.ok(c.artists > 100, 'artists counted');
  assert.ok(c.analysed_songs > 0 && c.analysed_songs <= c.live_songs);
  assert.ok(c.mapped_songs > 0 && c.mapped_songs <= c.live_songs);
  assert.ok(Array.isArray(c.latest_pass_models) && c.latest_pass_models.length > 0);
  assert.ok(c.latest_pass_models.every(m => m.model && Number.isInteger(m.songs)));
  // Ordered by song count, descending — the page renders them in this order.
  const counts = c.latest_pass_models.map(m => m.songs);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  // Every analysed song has exactly one latest pass.
  assert.equal(counts.reduce((a, b) => a + b, 0), c.analysed_songs);
  assert.ok(!Number.isNaN(Date.parse(c.latest_pass_at)), 'latest_pass_at parses as a date');
});
```

Add at the top of the file, beside the existing requires:

```js
const analysisModule = require('../services/analysis');
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `npm test -- test/referenceCodebook.test.js`
Expected: FAIL — `ref.payload is not a function`.

- [ ] **Step 3: Implement counts and coverage**

Append to `backend/services/referenceCodebook.js`, before `module.exports`:

```js
const PUBLISHED = `s.status = 'included' AND s.published = true`;

// (song_id, code) pairs for one thematic dimension's latest pass. `column` comes from the
// DIMENSIONS whitelist — never user input.
async function thematicPairs(db, column) {
  return (await db.query(
    `SELECT DISTINCT s.id AS song_id, elem->>'code' AS code
       FROM songs s
       JOIN ${analysis.LATEST_ANALYSIS} sa ON sa.song_id = s.id
       CROSS JOIN LATERAL jsonb_array_elements(sa.${column}) AS elem
      WHERE ${PUBLISHED}`)).rows;
}

// (song_id, code) pairs for one scalar column. `multi` columns are TEXT[]; the rest are TEXT.
async function scalarPairs(db, column, multi) {
  const sql = multi
    ? `SELECT DISTINCT s.id AS song_id, e.code AS code
         FROM songs s
         JOIN ${analysis.LATEST_ANALYSIS} sa ON sa.song_id = s.id
         CROSS JOIN LATERAL unnest(sa.${column}) AS e(code)
        WHERE ${PUBLISHED}`
    : `SELECT DISTINCT s.id AS song_id, sa.${column} AS code
         FROM songs s
         JOIN ${analysis.LATEST_ANALYSIS} sa ON sa.song_id = s.id
        WHERE ${PUBLISHED} AND sa.${column} IS NOT NULL`;
  return (await db.query(sql)).rows;
}

// Distinct-song counts keyed by code, from (song_id, code) rows.
function countByCode(rows) {
  const m = new Map();
  for (const { song_id, code } of rows) {
    if (!code) continue;
    let s = m.get(code);
    if (!s) { s = new Set(); m.set(code, s); }
    s.add(song_id);
  }
  return m;
}

async function coverage(db) {
  const one = async (sql) => (await db.query(sql)).rows[0].n;

  const live_songs = await one(
    `SELECT COUNT(*)::int AS n FROM songs s WHERE ${PUBLISHED}`);
  const artists = await one(
    `SELECT COUNT(DISTINCT ar.id)::int AS n
       FROM artists ar
       JOIN song_artists sa ON sa.artist_id = ar.id
       JOIN songs s ON s.id = sa.song_id
      WHERE ${PUBLISHED}`);
  const analysed_songs = await one(
    `SELECT COUNT(DISTINCT s.id)::int AS n
       FROM songs s JOIN song_lyric_analysis a ON a.song_id = s.id
      WHERE ${PUBLISHED}`);
  const mapped_songs = await one(
    `SELECT COUNT(DISTINCT s.id)::int AS n
       FROM songs s JOIN song_coordinates c ON c.song_id = s.id
      WHERE ${PUBLISHED}`);

  // Which model produced each live song's LATEST pass. Deliberately computed rather than
  // written into the copy: a hand-typed model name goes stale silently, which is exactly
  // what dating the disclosure was meant to prevent.
  const models = (await db.query(
    `SELECT la.model_used AS model, COUNT(*)::int AS songs, MAX(la.analyzed_at) AS latest
       FROM songs s
       JOIN ${analysis.LATEST_ANALYSIS} la ON la.song_id = s.id
      WHERE ${PUBLISHED}
      GROUP BY la.model_used
      ORDER BY songs DESC, model ASC`)).rows;

  const latest = models.reduce(
    (max, m) => (m.latest && (!max || m.latest > max) ? m.latest : max), null);

  return {
    live_songs, artists, analysed_songs, mapped_songs,
    latest_pass_models: models.map(m => ({ model: m.model, songs: m.songs })),
    latest_pass_at: latest ? new Date(latest).toISOString() : null,
  };
}

// The catalogue with real counts, plus the coverage block. One call serves the whole page.
async function payload(db) {
  const out = catalogue();

  for (const { column, key } of DIMENSIONS) {
    const rows = await thematicPairs(db, column);
    const byCode = countByCode(rows);
    const dim = out.thematic.find(d => d.key === key);
    const dimSongs = new Set();
    for (const sd of dim.sub_dimensions) {
      const subSongs = new Set();
      for (const g of sd.groups) {
        const groupSongs = new Set();
        for (const t of g.terms) {
          const songs = byCode.get(t.code);
          t.count = songs ? songs.size : 0;
          if (songs) for (const id of songs) { groupSongs.add(id); subSongs.add(id); dimSongs.add(id); }
        }
        g.count = groupSongs.size;
      }
      sd.count = subSongs.size;
    }
    dim.count = dimSongs.size;
  }

  for (const c of metadata.COMPONENTS) {
    const byCode = countByCode(await scalarPairs(db, c.column, c.multi));
    for (const code of out.metadata.find(m => m.key === c.key).codes) {
      code.count = (byCode.get(code.code) || new Set()).size;
    }
  }

  for (const c of acoustic.COMPONENTS) {
    const byCode = countByCode(await scalarPairs(db, c.column, false));
    for (const code of out.acoustic.find(a => a.key === c.key).codes) {
      code.count = (byCode.get(code.code) || new Set()).size;
    }
  }

  out.coverage = await coverage(db);
  return out;
}
```

Update the export line:

```js
module.exports = { catalogue, payload, coverage, DIMENSIONS };
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `backend/`: `npm test -- test/referenceCodebook.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Sanity-check the numbers against the spec**

Run from `backend/`:

```bash
node -e "require('dotenv').config();const p=require('./database/db');require('./services/referenceCodebook').payload(p).then(r=>{console.log(r.coverage);return p.end()})"
```

Expected, per spec §7 (values move with the data — flag a *large* divergence, don't fail on a small one): `live_songs` ≈ 1333, `artists` ≈ 635, `analysed_songs` ≈ 693, `mapped_songs` ≈ 640, `latest_pass_models` dominated by `gemini-3.5-flash-lite`.

- [ ] **Step 6: Run the whole backend suite and commit**

```bash
npm test
git add backend/services/referenceCodebook.js backend/test/referenceCodebook.test.js
git commit -m "feat(about): live counts and coverage for the reference catalogue"
```

---

## Task 3: `GET /api/analysis/codebook`

**Files:**
- Modify: `backend/routes/analysis.js`
- Test: `backend/test/referenceCodebook.test.js` (append)

**Interfaces:**
- Consumes: `referenceCodebook.payload(db)`
- Produces: `GET /api/analysis/codebook` → the §5.2 payload

- [ ] **Step 1: Write the failing test**

Append to `backend/test/referenceCodebook.test.js`:

```js
const express = require('express');

// Mount the real router on an ephemeral port rather than assuming a server is running —
// the curator's :5000 may be serving older code, and we must not disturb it.
async function withServer(fn) {
  const app = express();
  app.use('/api/analysis', require('../routes/analysis'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(r => server.close(r));
  }
}

test('GET /api/analysis/codebook serves the whole reference payload', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/analysis/codebook`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.thematic.length, 5);
    assert.equal(body.metadata.length, 7);
    assert.equal(body.acoustic.length, 6);
    assert.ok(body.coverage.live_songs > 1000);
    const codes = body.metadata.flatMap(m => m.codes.map(c => c.code));
    assert.ok(!codes.includes('UNSPECIFIED'), 'suppressed codes never reach the wire');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `npm test -- test/referenceCodebook.test.js`
Expected: FAIL — status 404, because the route does not exist.

- [ ] **Step 3: Add the route**

In `backend/routes/analysis.js`, add `const referenceCodebook = require('../services/referenceCodebook');` to the requires at the top, and add this route after the existing `/facets` route:

```js
// The About → Reference page in one response: the complete vocabulary with definitions and
// live counts, plus the coverage block the explainer's honesty section renders. Unlike
// /facets this keeps zero-count terms — a term no song carries is information on a glossary.
router.get('/codebook', async (req, res) => {
  try {
    res.json(await referenceCodebook.payload(pool));
  } catch (e) {
    console.error('codebook error:', e);
    res.status(500).json({ error: 'Failed to load the codebook' });
  }
});
```

**Order matters:** this must come before any `/:id`-shaped route in the same router, or `codebook` would be parsed as an id. `analysis.js` has `/song/:id` and `/songs/:id/similar`, both prefixed, so there is no collision today — but put `/codebook` next to `/facets` at the top regardless.

- [ ] **Step 4: Run the test to verify it passes**

Run from `backend/`: `npm test -- test/referenceCodebook.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the whole backend suite and commit**

```bash
npm test
git add backend/routes/analysis.js backend/test/referenceCodebook.test.js
git commit -m "feat(about): GET /api/analysis/codebook"
```

---

## Task 4: The content route and the two Markdown files

**Files:**
- Create: `backend/routes/content.js`
- Create: `backend/data/about.md`
- Create: `backend/data/analysis.md`
- Modify: `backend/server.js`
- Test: `backend/test/content.test.js`

**Interfaces:**
- Produces: `GET /api/content/:slug` → `{ slug, markdown }`; 404 for anything not in the whitelist

- [ ] **Step 1: Write the failing test**

Create `backend/test/content.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');

// No DB and no fixtures — this router only reads two files off disk.

async function withServer(fn) {
  const app = express();
  app.use('/api/content', require('../routes/content'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(r => server.close(r));
  }
}

test('each whitelisted page serves its markdown', async () => {
  await withServer(async (base) => {
    for (const slug of ['about', 'analysis']) {
      const res = await fetch(`${base}/api/content/${slug}`);
      assert.equal(res.status, 200, `${slug} is served`);
      const body = await res.json();
      assert.equal(body.slug, slug);
      assert.ok(body.markdown.length > 200, `${slug} has real content`);
      assert.ok(body.markdown.includes('##'), `${slug} is markdown with headings`);
    }
  });
});

test('an unknown page 404s', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/content/nope`);
    assert.equal(res.status, 404);
  });
});

test('a traversal slug reads nothing', async () => {
  await withServer(async (base) => {
    for (const slug of ['..%2F..%2F.env', '%2Fetc%2Fpasswd', 'about.md']) {
      const res = await fetch(`${base}/api/content/${slug}`);
      assert.equal(res.status, 404, `${slug} must not resolve`);
    }
  });
});

test('an inherited Object property is not a page', async () => {
  // A plain-object lookup would return Object's constructor here — truthy, and then used as
  // a filename. The whitelist must be a Map (or a hasOwnProperty check) for this to 404.
  await withServer(async (base) => {
    for (const slug of ['constructor', 'toString', '__proto__']) {
      const res = await fetch(`${base}/api/content/${slug}`);
      assert.equal(res.status, 404, `${slug} must not resolve`);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `npm test -- test/content.test.js`
Expected: FAIL — `Cannot find module '../routes/content'`.

- [ ] **Step 3: Write the route**

Create `backend/routes/content.js`:

```js
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const router = express.Router();

// Curator-editable page copy. The curator writes prose in backend/data/*.md and a browser
// refresh picks it up — no rebuild, no deploy.
//
// The slug is looked up in this Map and mapped to a filename; the request string never
// reaches path.join. Traversal is therefore impossible by construction rather than by
// sanitising, and a Map (not a plain object) means an inherited key like `constructor`
// cannot resolve to a truthy value.
const PAGES = new Map([
  ['about', 'about.md'],
  ['analysis', 'analysis.md'],
]);

router.get('/:slug', async (req, res) => {
  const file = PAGES.get(req.params.slug);
  if (!file) return res.status(404).json({ error: 'Unknown content page' });
  try {
    const markdown = await fs.readFile(path.join(__dirname, '..', 'data', file), 'utf8');
    res.json({ slug: req.params.slug, markdown });
  } catch (e) {
    console.error('content read error:', e);
    res.status(500).json({ error: 'Failed to load content' });
  }
});

module.exports = router;
```

Mount it in `backend/server.js`, beside the other routers:

```js
app.use('/api/content', require('./routes/content'));
```

- [ ] **Step 4: Write `backend/data/about.md`**

This is today's About page copy, unchanged in substance, with the two figures as tokens. The `#` heading is deliberately absent — the tab shell owns the page's single `<h1>`.

```markdown
7 years of curating music that speaks to animals, the environment, and compassionate living.

## Our mission

The Vegan Playlist is a searchable database of songs with vegan, animal-rights,
animal-liberation, care, and appreciation themes. We believe music can shift how people
think about the treatment of animals.

Right now it holds **{{songs}} songs** by **{{artists}} artists**.

## What we include

- Songs that directly advocate for animal rights and liberation
- Songs that promote plant-based living and veganism
- Songs addressing environmental issues tied to animal agriculture
- Songs of compassion and empathy for animals
- Songs that critique animal exploitation

## Our approach

Every song is described along several dimensions, so you can find music by what it says
and how it says it:

- **Advocacy style:** direct, educational, subtle, or storytelling
- **Animal focus:** all animals, a domain such as factory farming, or specific species
- **Themes:** animal rights, health, ethics
- **Musical genre:** rock, hip-hop, punk, electronic, and more

For how those descriptions are actually produced — and where AI is involved — see
[How the analysis works](/about/analysis).

## Get involved

Know a song with vegan, animal-rights/liberation, or animal-appreciation themes we're
missing? Suggest it — together we can build the most complete collection of animal
advocacy music.
```

- [ ] **Step 5: Write `backend/data/analysis.md`**

A complete first draft. The curator will rewrite the voice; the *structure* and the claims
are what this plan is responsible for. **Do not soften the "currently unchecked" wording** —
it is the curator's own phrasing and the point of the page.

```markdown
Every song here is described in three ways: by what its lyrics say, by how its recording
sounds, and by where it sits relative to every other song. This page explains how each of
those is produced, and says plainly which parts involve AI.

## The codebooks are human work

Before anything could be coded, there had to be something to code it *with*. The taxonomy
behind this site — the themes, the subjects, the kinds of advocacy, the moral framings —
was designed, tested and revised over multiple rounds until it described this music rather
than music in general. That is the part with a person's judgement in it, and everything
below depends on it.

You can read the whole vocabulary, definition by definition, on the
[Reference](/about/reference) page.

## Reading the lyrics

A large language model reads each song's lyrics and applies that codebook: it picks the
thematic codes that fit, and makes a set of judgements about how the song speaks — its
narrative perspective, its tone, how direct it is, who it seems to be addressing.

Each song shows its **most recent** coding pass. When the codebook improves and the songs
are coded again, what a song carries can change.

## Measuring the sound

Six further dimensions come from the recording itself rather than from the words: its
energy, its harmonic mood, its rhythm, its instrumentation, its vocal delivery, and its
tempo. These are measured by audio-analysis software, not judged — each one is a number
taken from the waveform and compared against a threshold. The [Reference](/about/reference)
page lists what is measured for each dimension and exactly where the thresholds fall.

## Placing songs next to each other

Each song's lyrics are also turned into an *embedding* — a long list of numbers that puts
songs saying similar things near one another. The [Explore map](/explore) is a flattened
picture of that space; the "You might also like" suggestions on a song page read from it
directly.

There are two of those, and they measure different things. One compares what songs *say*;
the other compares what they *sound like*. A song can be a close match on one and nowhere
near on the other, which is usually the interesting case.

## Where the rest of the information comes from

Genre, album and release data come from Spotify. Moods, languages and the highlighted
lyrics on a song page are entered by hand.

## Where AI is used

Plainly, so there is no guessing:

- **The codebooks — human.** Designed and revised by a person over multiple rounds.
- **The per-song lyric coding — AI.** A language model applies the codebook to each song.
- **The sound dimensions — measured.** Signal analysis of the audio; no model judgement.
- **The song positions and similarity — AI.** An embedding model, projected down to two
  dimensions for the map.
- **Curation — human.** Which songs are here at all, and whether a song belongs, is always
  a person's decision.

As of {{codingDate}}, each song's most recent coding pass came from {{codingModels}}.

## What this doesn't tell you

**Not every song has been analysed.** {{analysed}} of {{songs}} songs currently carry a
coding pass ({{analysedPct}}), and {{mapped}} appear on the Explore map. The rest are in
the collection and searchable, but have no codes yet.

**The per-song coding is machine-generated and currently unchecked.** The codebooks were
built and refined by hand, but no one has gone through song by song to confirm that the
model applied them correctly. Human checking — and human coding — may follow.

**The codes describe what a song says, not whether it is any good.** Nothing here is a
rating.
```

- [ ] **Step 6: Run the test to verify it passes**

Run from `backend/`: `npm test -- test/content.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 7: Run the whole backend suite and commit**

```bash
npm test
git add backend/routes/content.js backend/server.js backend/data/about.md backend/data/analysis.md backend/test/content.test.js
git commit -m "feat(about): serve curator-editable page copy from backend/data"
```

---

## Task 5: Token substitution (pure frontend module)

**Files:**
- Create: `frontend/src/utils/contentTokens.js`
- Test: `frontend/src/utils/contentTokens.test.js`

**Interfaces:**
- Produces:
  - `substituteTokens(markdown: string, values: object) -> string`
  - `tokenValues(coverage: object) -> { songs, artists, analysed, analysedPct, mapped, codingModels, codingDate }`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/utils/contentTokens.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { substituteTokens, tokenValues } from './contentTokens.js';

const COVERAGE = {
  live_songs: 1333,
  artists: 635,
  analysed_songs: 693,
  mapped_songs: 640,
  latest_pass_models: [
    { model: 'gemini-3.5-flash-lite', songs: 692 },
    { model: 'gemma4:deep_pipeline', songs: 1 },
  ],
  latest_pass_at: '2026-07-26T02:00:52.446Z',
};

test('known tokens substitute', () => {
  assert.equal(substituteTokens('We hold {{songs}} songs.', { songs: '1,333' }),
    'We hold 1,333 songs.');
});

test('an unknown token is left exactly as written, so a typo is visible', () => {
  assert.equal(substituteTokens('{{sngs}} songs', { songs: '1,333' }), '{{sngs}} songs');
});

test('a token inside inline code or a fenced block is left alone', () => {
  assert.equal(substituteTokens('Write `{{songs}}` to get {{songs}}.', { songs: '1,333' }),
    'Write `{{songs}}` to get 1,333.');
  assert.equal(
    substituteTokens('```\n{{songs}}\n```\n{{songs}}', { songs: '1,333' }),
    '```\n{{songs}}\n```\n1,333');
});

test('empty or missing markdown yields an empty string', () => {
  assert.equal(substituteTokens('', { songs: '1' }), '');
  assert.equal(substituteTokens(null, { songs: '1' }), '');
  assert.equal(substituteTokens(undefined, {}), '');
});

test('tokenValues formats every documented token', () => {
  const v = tokenValues(COVERAGE);
  assert.equal(v.songs, '1,333');
  assert.equal(v.artists, '635');
  assert.equal(v.analysed, '693');
  assert.equal(v.analysedPct, '52%');
  assert.equal(v.mapped, '640');
  assert.equal(v.codingModels, 'gemini-3.5-flash-lite and gemma4:deep_pipeline');
  assert.equal(v.codingDate, 'July 2026');
});

test('one model reads as one name, three read as a list', () => {
  const one = tokenValues({ ...COVERAGE, latest_pass_models: [{ model: 'a', songs: 5 }] });
  assert.equal(one.codingModels, 'a');
  const three = tokenValues({
    ...COVERAGE,
    latest_pass_models: [{ model: 'a', songs: 5 }, { model: 'b', songs: 3 }, { model: 'c', songs: 1 }],
  });
  assert.equal(three.codingModels, 'a, b and c');
});

test('tokenValues survives a missing or empty coverage block', () => {
  const v = tokenValues(null);
  assert.equal(v.songs, '—');
  assert.equal(v.codingModels, '—');
  assert.equal(v.codingDate, '—');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `frontend/`: `node --test src/utils/contentTokens.test.js`
Expected: FAIL — cannot find module `./contentTokens.js`.

- [ ] **Step 3: Write the module**

Create `frontend/src/utils/contentTokens.js`:

```js
// Substitute {{token}} placeholders in curator-authored Markdown. Pure: no DOM, no React,
// so `node --test` exercises it directly.
//
// An unknown token is left EXACTLY as written rather than replaced with an empty string, so
// a typo in the .md file shows up on the page instead of silently vanishing.

// One capture group, so String.split() interleaves the code chunks at odd indices.
const CODE_RE = /(```[\s\S]*?```|`[^`\n]*`)/g;
const TOKEN_RE = /\{\{(\w+)\}\}/g;

export function substituteTokens(markdown, values) {
  if (!markdown) return '';
  const vals = values || {};
  return markdown
    .split(CODE_RE)
    .map((chunk, i) => (
      // Odd indices are the captured code spans/blocks — the .md file documents its own
      // token names inside backticks, so those must survive verbatim.
      i % 2 === 1
        ? chunk
        : chunk.replace(TOKEN_RE, (whole, name) =>
          (Object.prototype.hasOwnProperty.call(vals, name) ? String(vals[name]) : whole))
    ))
    .join('');
}

// Explicit locale so the grouping separator is deterministic in tests and identical for
// every visitor, rather than following whatever the browser happens to be set to.
const LOCALE = 'en-GB';
const MISSING = '—';

const num = (n) => (Number.isFinite(n) ? n.toLocaleString(LOCALE) : MISSING);

// "a", "a and b", "a, b and c" — the disclosure line reads as a sentence.
function list(names) {
  if (names.length === 0) return MISSING;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function tokenValues(coverage) {
  const c = coverage || {};
  const models = Array.isArray(c.latest_pass_models) ? c.latest_pass_models : [];
  const pct = (Number.isFinite(c.analysed_songs) && c.live_songs)
    ? `${Math.round((c.analysed_songs / c.live_songs) * 100)}%`
    : MISSING;
  const when = c.latest_pass_at ? new Date(c.latest_pass_at) : null;

  return {
    songs: num(c.live_songs),
    artists: num(c.artists),
    analysed: num(c.analysed_songs),
    analysedPct: pct,
    mapped: num(c.mapped_songs),
    codingModels: list(models.map(m => m.model)),
    codingDate: (when && !Number.isNaN(when.getTime()))
      ? when.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })
      : MISSING,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `frontend/`: `node --test src/utils/contentTokens.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add `termHref` and its test**

Append to `frontend/src/utils/browseUrlState.js`:

```js
// Link from a Reference-page term to a browse filtered to it. This module already owns the
// browse param vocabulary, so the link format lives here rather than being reinvented on the
// About page — readFilterState below parses exactly these keys back.
export function termHref(key, code) {
  return `/?${new URLSearchParams([[key, code]]).toString()}`;
}
```

Create `frontend/src/utils/browseUrlState.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFilterState, termHref } from './browseUrlState.js';

// Every key the Reference page can link on: the five thematic dimensions, the seven scalar
// components and the five acoustic ones.
const KEYS = [
  'themes', 'targets', 'actions', 'tactics', 'moral_frames',
  'perspective', 'lyrical_tone', 'intensity', 'clarity', 'focus_amount',
  'target_audience', 'emotions',
  'sonic_energy', 'emotional_mood', 'rhythmic_style', 'acoustic_type', 'vocal_delivery',
];

test('termHref round-trips through readFilterState for every linkable key', () => {
  for (const key of KEYS) {
    const href = termHref(key, 'SOME_CODE');
    const { filters } = readFilterState(new URLSearchParams(href.split('?')[1]));
    assert.deepEqual(filters[key], ['SOME_CODE'], `${key} round-trips`);
  }
});

test('termHref escapes a code containing URL-significant characters', () => {
  const href = termHref('targets', 'a&b=c');
  const { filters } = readFilterState(new URLSearchParams(href.split('?')[1]));
  assert.deepEqual(filters.targets, ['a&b=c']);
});
```

- [ ] **Step 6: Run both frontend test files**

Run from `frontend/`: `node --test src/utils/`
Expected: PASS, 9 tests total.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add frontend/src/utils/contentTokens.js frontend/src/utils/contentTokens.test.js frontend/src/utils/browseUrlState.js frontend/src/utils/browseUrlState.test.js
git commit -m "feat(about): token substitution and reference term links"
```

---

## Task 6: `react-markdown` and the shared `<MarkdownPage>`

**Files:**
- Modify: `frontend/package.json` (via `npm install`)
- Create: `frontend/src/components/MarkdownPage.jsx`

**Interfaces:**
- Consumes: `substituteTokens` from Task 5
- Produces: `<MarkdownPage slug={string} fallback={string} tokens={object} />`

- [ ] **Step 1: Install the dependency**

Run from `frontend/`:

```bash
npm install react-markdown remark-gfm
```

**Only these two.** Do **not** add `rehype-raw` or any raw-HTML plugin: `react-markdown`
escapes HTML by default and that default is load-bearing here, because the Markdown arrives
over HTTP from a file on disk.

- [ ] **Step 2: Write the component**

Create `frontend/src/components/MarkdownPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { substituteTokens } from '../utils/contentTokens';

// Renders one curator-editable Markdown page.
//
// The API copy wins, so an edit to backend/data/*.md is live on the next browser refresh
// with no rebuild. `fallback` is the SAME file, imported at build time with Vite's ?raw, and
// is used only when the fetch fails. It is therefore a build-time snapshot and is SUPPOSED
// to go stale after an edit — it exists for an unreachable API, not for freshness. Do not
// "fix" that by copying the file at build time or by refetching it.
//
// Relative URL so it goes through the Vite proxy — never hardcode localhost:5000.
function MarkdownPage({ slug, fallback, tokens = {} }) {
  const [markdown, setMarkdown] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/content/${slug}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(body => { if (!cancelled) setMarkdown(body.markdown); })
      // No error UI: a visitor should never see the site's own plumbing. The bundled copy is
      // real content, so falling back to it is a complete answer, not a degraded one.
      .catch(() => { if (!cancelled) setMarkdown(fallback); });
    return () => { cancelled = true; };
  }, [slug, fallback]);

  // The fetch is local and fast; a spinner would flash rather than inform.
  if (markdown === null) return null;

  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {substituteTokens(markdown, tokens)}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownPage;
```

- [ ] **Step 3: Verify the build still passes**

Run from `frontend/`: `npm run build`
Expected: build succeeds. The bundle grows by roughly 100–150KB raw — that is expected and acceptable for a Markdown renderer.

- [ ] **Step 4: Lint and commit**

```bash
npm run lint
git add frontend/package.json frontend/package-lock.json frontend/src/components/MarkdownPage.jsx
git commit -m "feat(about): shared MarkdownPage with a bundled fallback"
```

---

## Task 7: The `/about` tab shell, the overview, and the explainer

**Files:**
- Modify: `frontend/src/pages/AboutPage.jsx`
- Create: `frontend/src/pages/about/AboutOverview.jsx`
- Create: `frontend/src/pages/about/AnalysisExplainer.jsx`
- Create: `frontend/src/pages/about/useCodebook.js`
- Modify: `frontend/src/App.jsx:51`

**Interfaces:**
- Consumes: `<MarkdownPage>` (Task 6), `tokenValues` (Task 5), `GET /api/analysis/codebook` (Task 3), `GET /api/content/:slug` (Task 4)
- Produces: `useCodebook() -> { data, loading, error }` — module-cached, so switching between the Reference and explainer tabs does not refetch

- [ ] **Step 1: Write the shared codebook hook**

Create `frontend/src/pages/about/useCodebook.js`:

```js
import { useEffect, useState } from 'react';

// One request serves both the Reference glossary and the explainer's coverage figures.
// Cached at module scope so moving between the two tabs does not refetch ~35KB of catalogue
// that cannot have changed within a visit. Relative URL — never hardcode localhost:5000.
let cached = null;

export function useCodebook() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!cached) {
      cached = fetch('/api/analysis/codebook')
        .then(res => (res.ok ? res.json() : Promise.reject(new Error('Failed to load the codebook'))))
        // A failed request must not be cached as a permanent failure — drop it so the next
        // mount retries.
        .catch(err => { cached = null; throw err; });
    }
    cached
      .then(body => { if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  return { data, loading: !data && !error, error };
}
```

- [ ] **Step 2: Write the tab shell**

Replace `frontend/src/pages/AboutPage.jsx` entirely:

```jsx
import { NavLink, Outlet } from 'react-router-dom';

// Three ways into the same subject: what the collection is, how its descriptions are
// produced, and the full vocabulary those descriptions use. Tabs are real routes so each is
// linkable. Mirrors ExplorePage.
//
// The shell owns the page's single <h1> — the three tab bodies must not add another (the
// .md files start at ##).
function AboutPage() {
  const tab = ({ isActive }) => `about-tab ${isActive ? 'active' : ''}`;

  return (
    <div className="page-container about-page">
      <header className="about-head">
        <h1>About The Vegan Playlist</h1>
        <nav className="about-tabs" aria-label="About sections">
          <NavLink to="/about" end className={tab}>About</NavLink>
          <NavLink to="/about/analysis" className={tab}>How the analysis works</NavLink>
          <NavLink to="/about/reference" className={tab}>Reference</NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

export default AboutPage;
```

- [ ] **Step 3: Write the overview**

Create `frontend/src/pages/about/AboutOverview.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import MarkdownPage from '../../components/MarkdownPage';
import { spotifyService } from '../../api/spotifyService';
// The bundled fallback reads the SAME file the API serves — one file in git, so a copied
// fallback cannot drift. Verified 2026-08-04: Vite resolves this in both dev and build with
// no vite.config.js change.
import fallback from '../../../../backend/data/about.md?raw';

function AboutOverview() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    spotifyService.getStats()
      .then(setStats)
      .catch((err) => console.error('Error loading stats:', err));
  }, []);

  // About shows exact counts (curator request) — the home hero keeps rounded ones.
  const exact = (v) => (v ? v.toLocaleString() : '…');

  return (
    <div className="about-container">
      <MarkdownPage
        slug="about"
        fallback={fallback}
        tokens={{ songs: exact(stats?.songs), artists: exact(stats?.artists) }}
      />

      <div>
        <Link to="/submit" className="btn btn-secondary">Submit a song</Link>
      </div>

      <div className="about-stats">
        <div className="stat-badge">
          <span className="stat-value">{exact(stats?.songs)}</span>
          <span className="stat-label">Songs curated</span>
        </div>
        <div className="stat-badge">
          <span className="stat-value">2017</span>
          <span className="stat-label">Playlist started</span>
        </div>
        <div className="stat-badge">
          <span className="stat-value">{exact(stats?.artists)}</span>
          <span className="stat-label">Artists featured</span>
        </div>
      </div>
    </div>
  );
}

export default AboutOverview;
```

- [ ] **Step 4: Write the explainer**

Create `frontend/src/pages/about/AnalysisExplainer.jsx`:

```jsx
import MarkdownPage from '../../components/MarkdownPage';
import { tokenValues } from '../../utils/contentTokens';
import { useCodebook } from './useCodebook';
import fallback from '../../../../backend/data/analysis.md?raw';

function AnalysisExplainer() {
  const { data } = useCodebook();
  // Before coverage arrives the tokens render as em-dashes rather than as raw {{braces}}.
  return (
    <div className="about-container">
      <MarkdownPage slug="analysis" fallback={fallback} tokens={tokenValues(data?.coverage)} />
    </div>
  );
}

export default AnalysisExplainer;
```

- [ ] **Step 5: Nest the routes**

In `frontend/src/App.jsx`, replace the single About route (line 51) with:

```jsx
<Route path="/about" element={<AboutPage />}>
  <Route index element={<AboutOverview />} />
  <Route path="analysis" element={<AnalysisExplainer />} />
</Route>
```

and add the two imports beside the existing page imports:

```jsx
import AboutOverview from './pages/about/AboutOverview';
import AnalysisExplainer from './pages/about/AnalysisExplainer';
```

**The Reference tab is deliberately not wired here.** Task 8 creates the component *and*
adds its route in one commit — no placeholder stub. Until then the third tab renders the
shell with an empty outlet, which is the correct intermediate state for a half-built
section: nothing dead is committed.

- [ ] **Step 6: Verify by hand**

Start the backend and frontend if they are not already running (check first — the curator may
have them up; `netstat -ano | grep ":5000"` and `":5173"`).

Visit `http://localhost:5173/about` and confirm:
- the `<h1>` and three tabs render, with **About** marked active
- the body matches today's page in substance, with real numbers where `{{songs}}` and `{{artists}}` were
- `/about/analysis` renders the explainer with real coverage figures — **no literal `{{` on the page**
- both tabs are directly linkable (paste the URL into a fresh tab)

- [ ] **Step 7: Lint, build, commit**

```bash
npm run lint
npm run build
git add frontend/src/App.jsx frontend/src/pages/AboutPage.jsx frontend/src/pages/about/
git commit -m "feat(about): tab shell with the overview and analysis explainer"
```

---

## Task 8: The Reference glossary

**Files:**
- Create: `frontend/src/pages/about/AnalysisReference.jsx`
- Modify: `frontend/src/App.jsx` (add the `reference` child route + its import)

**Interfaces:**
- Consumes: `useCodebook()` (Task 7), `termHref` (Task 5), `FilterSection` (`frontend/src/components/FilterSection.jsx`)

- [ ] **Step 1: Read the primitive you are about to reuse**

Read `frontend/src/components/FilterSection.jsx` in full. It takes
`{ title, count = 0, note, defaultOpen = false, children }`, renders a toggle button with
`aria-expanded`, and nests. Use it as-is — do not fork it or add props.

- [ ] **Step 2: Write the page**

Create `frontend/src/pages/about/AnalysisReference.jsx`:

```jsx
import { Link } from 'react-router-dom';
import FilterSection from '../../components/FilterSection';
import { termHref } from '../../utils/browseUrlState';
import { useCodebook } from './useCodebook';

// One term: its label, its definition, and how many songs currently carry it. The count links
// through to a browse filtered to exactly that code — a zero-count term renders the count as
// plain text, because a link to an empty result set is a dead end.
function Term({ filterKey, code, label, definition, count }) {
  return (
    <li className="reference-term">
      <span className="reference-term-label">{label}</span>
      {count > 0 ? (
        <Link className="reference-term-count" to={termHref(filterKey, code)}>
          {count.toLocaleString()} songs
        </Link>
      ) : (
        <span className="reference-term-count is-empty">0 songs</span>
      )}
      <p className="reference-term-def">{definition}</p>
    </li>
  );
}

function ThematicDimension({ dimension }) {
  return (
    <FilterSection title={dimension.label} count={dimension.count}>
      <p className="reference-dimension-desc">{dimension.description}</p>
      {dimension.sub_dimensions.map(sub => (
        <FilterSection key={sub.id} title={sub.label} count={sub.count}>
          {sub.groups.map(group => (
            <div key={group.id} className="reference-group">
              <h4 className="reference-group-title">{group.label}</h4>
              <ul className="reference-terms">
                {group.terms.map(t => (
                  <Term key={t.code} filterKey={dimension.key} {...t} />
                ))}
              </ul>
            </div>
          ))}
        </FilterSection>
      ))}
    </FilterSection>
  );
}

function CodedComponent({ component, extra }) {
  return (
    <FilterSection title={component.heading} count={component.codes.length}>
      <p className="reference-dimension-desc">{component.description}</p>
      {extra}
      <ul className="reference-terms">
        {component.codes.map(c => (
          <li key={c.code} className="reference-term">
            <span className="reference-term-label">{c.label}</span>
            {c.count > 0 ? (
              <Link className="reference-term-count" to={termHref(component.key, c.code)}>
                {c.count.toLocaleString()} songs
              </Link>
            ) : (
              <span className="reference-term-count is-empty">0 songs</span>
            )}
            <p className="reference-term-def">{c.definition}</p>
            {c.threshold && <p className="reference-threshold">{c.threshold}</p>}
          </li>
        ))}
      </ul>
    </FilterSection>
  );
}

function AnalysisReference() {
  const { data, error } = useCodebook();

  if (error) return <div className="about-container"><p>{error}</p></div>;
  if (!data) return <div className="about-container" />;

  return (
    <div className="about-container reference-page">
      <p className="reference-intro">
        Every word the site uses to describe a song, with its definition and how many songs
        currently carry it. Terms no song carries yet are listed too — the vocabulary is
        larger than the part of the collection that has been coded. How these are produced is
        on <Link to="/about/analysis">How the analysis works</Link>.
      </p>

      <nav className="reference-jump" aria-label="Jump to a section">
        <a href="#themes">Themes</a>
        <a href="#lyric-metadata">Lyric metadata</a>
        <a href="#sound">Sound</a>
      </nav>

      <section id="themes" className="reference-family">
        <h2>Themes</h2>
        {data.thematic.map(d => <ThematicDimension key={d.key} dimension={d} />)}
      </section>

      <section id="lyric-metadata" className="reference-family">
        <h2>Lyric metadata</h2>
        {data.metadata.map(m => <CodedComponent key={m.key} component={m} />)}
      </section>

      <section id="sound" className="reference-family">
        <h2>Sound</h2>
        {data.acoustic.map(a => (
          <CodedComponent
            key={a.key}
            component={a}
            extra={a.derivation_source && (
              <p className="reference-derivation">Measured from: {a.derivation_source}</p>
            )}
          />
        ))}
      </section>
    </div>
  );
}

export default AnalysisReference;
```

**Note on tempo:** `tempo_bpm` arrives with an empty `codes` array, so its `FilterSection`
renders its description and derivation source and nothing else. That is correct — it is a
number, not a set of codes. Do not special-case it out of the list.

**Note on the loading gate:** this component early-returns while `data` is null. If you later
add an effect that reads a DOM ref (e.g. to scroll to a `#fragment`), it **must** hold the
element in state via a callback ref — a `[]`-deps effect reading a ref does not work behind a
loading gate, and this exact bug hit `/explore` twice.

- [ ] **Step 3: Wire the route**

In `frontend/src/App.jsx`, add the import beside the other two About page imports and the
child route inside the existing `/about` route element:

```jsx
import AnalysisReference from './pages/about/AnalysisReference';
```

```jsx
<Route path="reference" element={<AnalysisReference />} />
```

- [ ] **Step 4: Verify by hand**

Visit `http://localhost:5173/about/reference` and confirm:
- three families render, each dimension collapsed, opening on click
- a term with songs shows a link; clicking it lands on `/` with results for that code
- at least one term shows `0 songs` as plain text, not a link
- a Sound dimension shows "Measured from: …" and its codes show thresholds
- Tempo renders its description with no code list

- [ ] **Step 5: Lint, build, commit**

```bash
npm run lint
npm run build
git add frontend/src/pages/about/AnalysisReference.jsx frontend/src/App.jsx
git commit -m "feat(about): the reference glossary"
```

---

## Task 9: Styling

**Files:**
- Modify: `frontend/src/styles/components.css`

- [ ] **Step 1: Confirm the container width finding before changing anything**

The spec queued a check for the `margin: 0 auto` no-stretch bug that Batch B found on
`.explore-page`. **It was already checked while writing this plan and both containers are
fine** — `.page-container` carries `width: 100%` at `components.css:1415` and
`.about-container` at `:2182` (with a comment citing the 3.2 Decision Log).

Confirm it rather than trusting this plan: open `/about` at a 390px viewport and check that
the page does not scroll horizontally and the content fills the column. **If it looks
correct, change nothing** — do not add a redundant `width: 100%`.

- [ ] **Step 2: Add the styles**

Append to `frontend/src/styles/components.css`. Tokens only — no raw colours, no raw pixel
spacing.

```css
/* --- About: tab shell ------------------------------------------------------------- */
/* Mirrors .explore-head / .explore-tabs. .page-container already carries width: 100%,
   so this needs no no-stretch guard of its own (see the 2026-08-04 Watch-outs). */
.about-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-5);
  flex-wrap: wrap;
  margin-bottom: var(--space-5);
}

.about-tabs {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.about-tab {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  text-decoration: none;
  font: var(--text-label);
}

.about-tab:hover { color: var(--text-primary); }

.about-tab.active {
  background: var(--bg-surface);
  color: var(--text-primary);
}

/* --- Rendered Markdown ------------------------------------------------------------ */
/* Curator-authored prose. Element selectors are scoped to .markdown-body because the
   author writes plain Markdown and cannot add classes. */
.markdown-body h2 {
  margin-top: var(--space-6);
  margin-bottom: var(--space-3);
}

.markdown-body h2:first-child { margin-top: 0; }

.markdown-body p,
.markdown-body ul,
.markdown-body ol {
  margin-bottom: var(--space-4);
  color: var(--text-secondary);
}

.markdown-body ul,
.markdown-body ol {
  padding-left: var(--space-5);
}

.markdown-body li { margin-bottom: var(--space-2); }

.markdown-body strong { color: var(--text-primary); }

.markdown-body a { color: var(--accent-ember-60); }

/* --- About: reference glossary ---------------------------------------------------- */
.reference-intro,
.reference-dimension-desc,
.reference-term-def {
  color: var(--text-secondary);
}

.reference-jump {
  display: flex;
  gap: var(--space-4);
  position: sticky;
  top: 0;
  z-index: 1;
  padding: var(--space-3) 0;
  background: var(--bg-canvas);
  border-bottom: 1px solid var(--border-hairline);
}

.reference-jump a {
  color: var(--text-secondary);
  text-decoration: none;
  font: var(--text-label);
}

.reference-jump a:hover { color: var(--text-primary); }

.reference-family { margin-top: var(--space-6); }

.reference-family > h2 { margin-bottom: var(--space-3); }

.reference-group { margin-bottom: var(--space-4); }

.reference-group-title {
  font: var(--text-label);
  color: var(--text-muted);
  margin-bottom: var(--space-2);
}

.reference-terms {
  list-style: none;
  padding: 0;
  margin: 0;
}

.reference-term {
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-hairline);
}

.reference-term-label {
  color: var(--text-primary);
  font-weight: 600;
  margin-right: var(--space-2);
}

.reference-term-count {
  color: var(--accent-ember-60);
  font: var(--text-label);
  text-decoration: none;
}

.reference-term-count.is-empty { color: var(--text-muted); }

.reference-term-def { margin: var(--space-1) 0 0; }

.reference-derivation,
.reference-threshold {
  font-family: var(--font-mono);
  font-size: 0.85em;
  color: var(--text-muted);
  margin: var(--space-1) 0 0;
}
```

- [ ] **Step 3: Check every token you used actually exists**

Run from `frontend/src`:

```bash
grep -oE '\-\-(bg|text|accent|space|radius|border|font)-[a-z0-9-]+' styles/components.css \
  | sort -u > /tmp/used.txt
grep -ohE '^\s*(--[a-z0-9-]+):' styles/tokens/*.css styles/base.css App.css \
  | tr -d ' :' | sort -u > /tmp/defined.txt
comm -23 /tmp/used.txt /tmp/defined.txt
```

Any name printed is used but never defined. `--font-mono` is written with a `monospace`
fallback above precisely because it may not exist; **every other** undefined name you find in
the block you just added must be replaced with one that does exist. Do not define new tokens.

- [ ] **Step 4: Check both themes and a narrow viewport**

Visit `/about`, `/about/analysis` and `/about/reference`. Confirm in **both** light and dark:
- the active tab is distinguishable from the inactive ones
- the sticky jump bar does not sit transparently over scrolling text
- at 390px width nothing scrolls sideways and the tabs wrap rather than overflow

- [ ] **Step 5: Lint, build, commit**

```bash
npm run lint
npm run build
git add frontend/src/styles/components.css
git commit -m "style(about): tab shell, markdown prose and reference glossary"
```

---

## Task 10: Smoke test and documentation

**Files:**
- Create: scratchpad smoke script (not committed)
- Modify: `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `docs/CURATOR_TRIAGE_BACKLOG.md`, `CLAUDE.md`

- [ ] **Step 1: Write the smoke script**

Write it to the **scratchpad**, not to `backend/` — a script inside `backend/` restarts the
curator's nodemon mid-run. Use absolute `require` paths.

Cover, with Puppeteer against the running dev servers:

1. `/about` renders the `<h1>`, three tabs, and the About tab active
2. `/about/analysis` and `/about/reference` are each directly linkable in a fresh page load
3. no page contains a literal `{{` (proves every token substituted)
4. the explainer's coverage sentence contains digits, not em-dashes
5. the reference lists at least one `0 songs` term rendered as text, not a link
6. clicking a non-zero term count lands on `/` with a filter param and a non-empty result grid
7. a Sound dimension shows a threshold string containing `Librosa`
8. no suppressed code (`UNSPECIFIED` etc.) appears anywhere in the reference DOM
9. with the API blocked (`page.setRequestInterception` on `/api/content/*`), both Markdown
   pages still render real prose from the bundled fallback
10. at a 390px viewport, `document.documentElement.scrollWidth <= window.innerWidth` on all
    three tabs

- [ ] **Step 2: Run it and fix what it finds**

Before assuming a failure is in the app, check whether it is in the check — the Batch B smoke
had two failures that were both flaws in the script. Diagnose before changing either.

- [ ] **Step 3: Run every gate**

```bash
cd backend && npm test
cd ../frontend && node --test src/utils/ && node --test src/components/explore/ && npm run lint && npm run build
```

Expected: backend 165 + 14 new = **179**; frontend 27 existing + 9 new = **36** module tests;
lint 0 errors; build clean. **Report the real numbers, not these predictions** — if they
differ, say so.

- [ ] **Step 4: Update the docs**

- `docs/PROJECT_STATE.md` — advance the current session, refresh "Next Tasks" (the two carried
  follow-ups: the Year-range control's two bugs; the container sweep, now **narrowed** because
  `.page-container` and `.about-container` were checked and are fine), add Decision Log entries
  for the four decisions taken here (the new endpoint rather than bending `/facets`; the
  computed model line; `react-markdown` as a deliberate exception to the no-dependency habit;
  the Map-not-object whitelist), append a Changelog entry.
- `docs/PROJECT_PLAN.md` — mark triage 6 ☑.
- `docs/CURATOR_TRIAGE_BACKLOG.md` — mark the two "About / transparency" items resolved with
  the spec and plan links.
- `CLAUDE.md` — add `services/referenceCodebook.js` to the backend section, `routes/content.js`
  and the two `.md` files, and the `/about` tab structure to the frontend section. Note that
  `backend/data/*.md` is curator-editable copy served live.

- [ ] **Step 5: Write the curator smoke checklist**

Create `docs/TRIAGE_6_CURATOR_SMOKE.md` covering what only a person can judge: does the
explainer read as honest rather than defensive; is the AI disclosure specific enough; is the
Reference page navigable at 141 terms or overwhelming; is the human/machine distinction clear.
Include the file paths of `about.md` and `analysis.md` and the exact token list, since the
point of this session is that the curator edits them.

**Do not include a "restart the backend" step** unless you have checked how `:5000` is
running — it is usually nodemon, which restarts itself.

- [ ] **Step 6: Commit and push**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: close out triage 6 — About analysis explainer and reference"
git push -u origin session-triage-6-about-analysis
```

- [ ] **Step 7: Hand to the curator**

Report: what shipped, the real test numbers, what the smoke found, and the two open questions
the curator owns — the `custom_mood` / genre provenance claim in `analysis.md` §"Where the rest
of the information comes from", and whether the drafted prose says what they want it to say.
**Hold the branch for their smoke before merging.**

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: §4.1 routing → T7; §4.2 content
pipeline → T4 (backend) + T6/T7 (frontend); §4.3 reference pipeline → T1/T2; §5.1 → T4; §5.2 →
T3; §5.3 tokens → T5; §6.1 `about.md` → T4 step 4; §6.2 `analysis.md` → T4 step 5; §7 coverage
figures → T2 step 5; §8 reference page → T8; §9 testing → T1–T5 and T10; §10 out-of-scope is
respected (no editing UI, no new taxonomy content, no writes, Year-range untouched, sweep
narrowed to the two containers); §11 watch-outs → the `react-markdown`-only constraint in T6
step 1, the stale-fallback comment in T6 step 2, and the `LATEST_ANALYSIS` reuse in T2.

**One spec claim corrected here.** §10 queued a check of `.about-container` / `.page-container`
for the no-stretch bug. Both already carry `width: 100%`, so T9 step 1 verifies and changes
nothing rather than "fixing" what is not broken.

**Placeholder scan.** No TBDs. Every code step carries real code. The Task 7 placeholder
`AnalysisReference` is explicitly temporary with its replacement named.

**Type consistency.** `catalogue()` / `payload()` / `coverage()` are used under those names
throughout. `termHref(key, code)` matches between T5 and T8. `tokenValues(coverage)` takes the
coverage block, not the whole payload — T7 passes `data?.coverage`, matching T5's test.
`derivationSource` / `codeThreshold` are named identically in T1's test, implementation, export
list and T8's consumer. The public thematic dimension keys (`themes`, `targets`, `actions`,
`tactics`, `moral_frames`) match `browseUrlState`'s array keys, which is what makes `termHref`
round-trip.
