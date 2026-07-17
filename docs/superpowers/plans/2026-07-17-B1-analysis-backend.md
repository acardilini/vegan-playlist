# B1 — Analysis Backend & Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the backend everything the B2–B4 frontend needs to display the real qualitative lyric analysis, and remove the mocked 5-array categorisation (UI-facing backend + DB columns).

**Architecture:** A new `services/analysis.js` owns the analysis constant, the vendored taxonomy codebook, and all read/aggregation/facet-filter query logic (unit-tested with `node:test`, following `services/curation.js` conventions). A new thin public router `routes/analysis.js` exposes `GET /api/analysis/song/:id` and `GET /api/analysis/facets`. The existing `spotify.js /search` gains analysis-facet filtering, `analytics.js` repoints its theme aggregation at the real table, `curation.getWorkbench` returns the full coding, and migration 007 drops the five provably-empty mock columns after all references are stripped.

**Tech Stack:** Node.js/Express, `pg` (PostgreSQL, shared `vegan_playlist` DB), `node:test`, plain-SQL migrations applied via `psql`.

## Global Constraints

- **Model:** analysis reads use `model_used = 'gemma4:latest'` **only**. One shared constant `DEFAULT_MODEL` in `services/analysis.js`; every `song_lyric_analysis` query filters by it.
- **Combine logic:** analysis facet filters are **AND** — every selected code (within a dimension and across dimensions) must match (JSONB `@>`).
- **Copyright guardrail:** public routes must **never** `SELECT song_lyrics.lyrics` or `.translation`. `test/lyrics_privacy.test.js` enforces this over the public-route file list; the new public router must be added to that list. Note `song_lyric_analysis` does **not** match the guard's `/song_lyrics/` regex (no trailing `s`), so reading it is allowed.
- **Dimension name mapping** (DB column → public/display name), applied in every read: `themes→themes`, `topics→targets`, `advocacy→actions`, `tactics→tactics`, `moral_frames→moral_frames`.
- **Tests:** `node:test`, run with `node --test` from `backend/`. New test file uses the **unique fixture sentinel `ZZZANL`** (existing files use ZZZTEST/ZZZCUR/ZZZVID/ZZZBK). Clean up all `ZZZANL%` rows in `after()`.
- **Migrations:** additive/DDL SQL files in `backend/database/migrations/`, applied manually via `psql` in order. `psql` on this machine: `/c/Program Files/PostgreSQL/17/bin/psql`. Connection env is in `backend/.env` (`DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`).
- **DB safety:** the only schema change is dropping five columns proven empty across all rows; the migration self-guards and aborts if any is non-empty.
- **Taxonomy is a 4-level hierarchy** (Dimension → Sub-dimension → Group → Code): each evidence code carries `sub_dimension` + `group`, and `taxonomy.hierarchy.<dim>` supplies the display label for every level (validated: every code's sub_dimension/group exists in `hierarchy`). `getSongAnalysis` enriches each returned code with `sub_dimension`/`sub_dimension_label`/`group`; `facetTree` returns the nested tree with **distinct-song** rollup counts (a song with sibling codes counts once per node). Code ids are unchanged from the pre-hierarchy codebook, so no re-coding. `taxonomy.json` was re-vendored on this branch (commit `70161d5`); Task 1's `analysis.js`/tests are unaffected.

## File Structure

- **Create** `backend/data/taxonomy.json` — vendored codebook (label/definition/facet-option source).
- **Create** `backend/services/analysis.js` — `DEFAULT_MODEL`, taxonomy loader + label/sub-dimension lookup + `hierarchy`, `getSongAnalysis`, `facetTree`, `facetFilterConditions`, `themeCounts`.
- **Create** `backend/routes/analysis.js` — public router: `GET /song/:id`, `GET /facets`.
- **Create** `backend/database/migrations/007_drop_mock_categorisation.sql` — self-guarding DROP COLUMN.
- **Create** `backend/test/analysis.test.js` — service unit tests (sentinel `ZZZANL`).
- **Modify** `backend/server.js` — mount `/api/analysis`.
- **Modify** `backend/services/curation.js` — import `DEFAULT_MODEL` from `analysis.js`; extend `getWorkbench` to return the full analysis object.
- **Modify** `backend/routes/spotify.js` — add analysis-facet filtering to `/search`; remove all five mock-array references.
- **Modify** `backend/routes/analytics.js` — repoint `vegan-themes` + `summary.songs_with_themes` + `filter-options` at `song_lyric_analysis`; remove mock-array filter params.
- **Modify** `backend/routes/admin.js` — remove all five mock-array references from the categorisation endpoints.
- **Modify** `backend/test/lyrics_privacy.test.js` — add `analysis.js` to `PUBLIC_ROUTES`.
- **Modify** `backend/test/curation.test.js` — add a workbench-analysis assertion.

---

### Task 1: Vendor the taxonomy codebook + loader

**Files:**
- Create: `backend/data/taxonomy.json` (copied verbatim from the analysis service)
- Create: `backend/services/analysis.js`
- Test: `backend/test/analysis.test.js`

**Interfaces:**
- Produces: `DEFAULT_MODEL` (string `'gemma4:latest'`); `taxonomy` (parsed object); `label(dimension, code)` → display label string (falls back to de-snake-cased code); `EVIDENCE_DIMS` (array `['themes','topics','advocacy','tactics','moral_frames']`).

- [ ] **Step 1: Copy the codebook into the repo**

Run (from repo root):
```bash
cp "C:/Users/Owner/.gemini/antigravity/scratch/vegan-playlist-analysis/data/taxonomy.json" "backend/data/taxonomy.json"
```
Expected: `backend/data/taxonomy.json` exists. Sanity check it parses and has the five dimension keys:
```bash
node -e "const t=require('./backend/data/taxonomy.json'); console.log(Object.keys(t).join(','))"
```
Expected output includes: `actions,targets,themes,tactics,moral_frames,lyrical_tones,target_audiences,perspectives,intensity_levels,clarity_levels,focus_amounts`.

- [ ] **Step 2: Write the failing test**

Create `backend/test/analysis.test.js`:
```javascript
const { test, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../database/db');
const analysis = require('../services/analysis');

// Unique fixture sentinel per test file: ZZZANL.

test('DEFAULT_MODEL is gemma4:latest', () => {
  assert.equal(analysis.DEFAULT_MODEL, 'gemma4:latest');
});

test('taxonomy exposes the five evidence dimensions with labels', () => {
  assert.ok(Array.isArray(analysis.taxonomy.themes));
  // topics column is displayed as "targets"; taxonomy stores it under "targets"
  assert.equal(analysis.label('themes', 'killing'), 'Killing');
  assert.equal(analysis.label('topics', 'slaughterhouses'), 'Slaughterhouses');
  assert.equal(analysis.label('advocacy', 'boycott'), 'Boycott');
  // unknown code falls back to de-snake-cased Title Case
  assert.equal(analysis.label('themes', 'some_new_code'), 'Some New Code');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/analysis.test.js` (from `backend/`)
Expected: FAIL — `Cannot find module '../services/analysis'`.

- [ ] **Step 4: Write minimal implementation**

Create `backend/services/analysis.js`:
```javascript
// Analysis-service reads over the shared song_lyric_analysis / taxonomy data.
// Display-only: this service never writes analysis and never touches song_lyrics.
// Functions take `db` (pool or client) first, mirroring services/curation.js.
const taxonomy = require('../data/taxonomy.json');

const DEFAULT_MODEL = 'gemma4:latest';
// DB column -> taxonomy group key. topics=targets, advocacy=actions.
const EVIDENCE_DIMS = ['themes', 'topics', 'advocacy', 'tactics', 'moral_frames'];
const DIM_TO_TAXONOMY = { themes: 'themes', topics: 'targets', advocacy: 'actions', tactics: 'tactics', moral_frames: 'moral_frames' };

function titleCase(code) {
  return String(code).split('_').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

// Build id->label maps once per taxonomy group.
const LABELS = {};
for (const [dim, group] of Object.entries(DIM_TO_TAXONOMY)) {
  const list = taxonomy[group] || [];
  LABELS[dim] = new Map(list.map(item => [item.id, item.label]));
}

function label(dimension, code) {
  const m = LABELS[dimension];
  return (m && m.get(code)) || titleCase(code);
}

module.exports = { DEFAULT_MODEL, EVIDENCE_DIMS, DIM_TO_TAXONOMY, taxonomy, label };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/analysis.test.js`
Expected: PASS (2 tests). (The `after()` hook is added in Task 3; a `pool` import with no `pool.end()` yet is fine — Node exits when the event loop drains. If the run hangs, proceed to Task 3 which adds `after(() => pool.end())`.)

- [ ] **Step 6: Commit**

```bash
git add backend/data/taxonomy.json backend/services/analysis.js backend/test/analysis.test.js
git commit -F - <<'EOF'
feat(B1): vendor taxonomy codebook + analysis service label lookup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: Share DEFAULT_MODEL — repoint curation.js

**Files:**
- Modify: `backend/services/curation.js:3` and `:36`

**Interfaces:**
- Consumes: `analysis.DEFAULT_MODEL` (Task 1).

- [ ] **Step 1: Repoint the constant**

In `backend/services/curation.js`, replace line 3:
```javascript
const DEFAULT_MODEL = 'gemma4:latest';
```
with:
```javascript
const { DEFAULT_MODEL } = require('./analysis');
```
Leave line 36 (`const MODEL_LITERAL = ...`) unchanged — it derives from `DEFAULT_MODEL`.

- [ ] **Step 2: Run the curation suite to verify no regression**

Run: `node --test test/curation.test.js`
Expected: PASS (same count as before the change — the `needs-analysis` queue and `getWorkbench` still use the identical model string).

- [ ] **Step 3: Commit**

```bash
git add backend/services/curation.js
git commit -F - <<'EOF'
refactor(B1): source DEFAULT_MODEL from services/analysis

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: `getSongAnalysis(db, songId)` — full coding read

**Files:**
- Modify: `backend/services/analysis.js`
- Test: `backend/test/analysis.test.js`

**Interfaces:**
- Produces: `getSongAnalysis(db, songId)` → `null` if the song has no `gemma4:latest` row, else an object:
  `{ perspective, intensity, clarity, focus_amount, lyrical_tone, target_audience, emotions: string[], explanation, themes: [{code,label,evidence,sub_dimension,sub_dimension_label,group}], targets: [...], actions: [...], tactics: [...], moral_frames: [...] }`.
  Each dimension array preserves DB order; `label`, `sub_dimension`, `sub_dimension_label`, `group` are
  added from the taxonomy (so the frontend can colour chips + build the inline mini-legend). `emotions`
  defaults to `[]`.
- Also produces (helpers added to `analysis.js`, exported): `SUBDIM` maps + `subDimensionLabel(dbCol, subId)`.

- [ ] **Step 1: Write the failing test**

Add to `backend/test/analysis.test.js` (before the existing `after` if present; add the `after` hook shown here if not yet added):
```javascript
// Helper: insert a coded song with the ZZZANL sentinel.
async function mkCodedSong() {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ('ZZZANL Coded', 'included', true, 'manual') RETURNING id`)).rows[0];
  await pool.query(
    `INSERT INTO song_lyric_analysis
      (song_id, model_used, perspective, intensity, clarity, focus_amount, lyrical_tone,
       target_audience, emotions, explanation, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, 'gemma4:latest', 'animal_pov', 'high_confrontational', 'highly_explicit',
       'central_focus', 'confrontational_militant', 'corporate_exploiters',
       ARRAY['outrage'], 'Test explanation.',
       $2::jsonb, $3::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [s.id,
     JSON.stringify([{ code: 'killing', evidence: 'ground beef' }]),
     JSON.stringify([{ code: 'cows', evidence: 'Run cows run' }])]);
  return s.id;
}

test('getSongAnalysis returns the full coding with display labels', async () => {
  const id = await mkCodedSong();
  const a = await analysis.getSongAnalysis(pool, id);
  assert.equal(a.perspective, 'animal_pov');
  assert.deepEqual(a.emotions, ['outrage']);
  assert.equal(a.themes[0].code, 'killing');
  assert.equal(a.themes[0].label, 'Killing');
  assert.equal(a.themes[0].evidence, 'ground beef');
  // enriched from the taxonomy hierarchy
  assert.equal(a.themes[0].sub_dimension, 'cruelty_suffering');
  assert.equal(a.themes[0].sub_dimension_label, 'Bodily Harm, Confinement & Suffering');
  assert.equal(a.themes[0].group, 'violence');
  // topics column surfaces as "targets"
  assert.equal(a.targets[0].code, 'cows');
  assert.equal(a.targets[0].label, 'Cows');
  assert.equal(a.targets[0].sub_dimension, 'farmed_domesticated');
  assert.deepEqual(a.actions, []);
});

test('getSongAnalysis returns null for an un-coded song', async () => {
  const s = (await pool.query(
    `INSERT INTO songs (title, status, published, data_source)
     VALUES ('ZZZANL Uncoded', 'included', true, 'manual') RETURNING id`)).rows[0];
  assert.equal(await analysis.getSongAnalysis(pool, s.id), null);
});

after(async () => {
  await pool.query(`DELETE FROM song_lyric_analysis WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZANL%')`);
  await pool.query(`DELETE FROM songs WHERE title LIKE 'ZZZANL%'`);
  await pool.end();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/analysis.test.js`
Expected: FAIL — `analysis.getSongAnalysis is not a function`.

- [ ] **Step 3: Implement `getSongAnalysis`**

Add to `backend/services/analysis.js` (before `module.exports`, and add it to the exports):
```javascript
// Per-DB-column code -> {sub_dimension, group} maps, and sub-dimension label lookup from `hierarchy`.
const SUBDIM = {};
for (const [dbCol, taxKey] of Object.entries(DIM_TO_TAXONOMY)) {
  SUBDIM[dbCol] = new Map((taxonomy[taxKey] || []).map(i => [i.id, { sub_dimension: i.sub_dimension, group: i.group }]));
}
function subDimensionLabel(dbCol, subId) {
  const h = taxonomy.hierarchy && taxonomy.hierarchy[DIM_TO_TAXONOMY[dbCol]];
  return (h && h.sub_dimensions[subId] && h.sub_dimensions[subId].label) || titleCase(subId || '');
}

function mapDim(dimension, arr) {
  return (Array.isArray(arr) ? arr : []).map(row => {
    const sd = SUBDIM[dimension].get(row.code) || {};
    return {
      code: row.code, label: label(dimension, row.code), evidence: row.evidence,
      sub_dimension: sd.sub_dimension || null,
      sub_dimension_label: sd.sub_dimension ? subDimensionLabel(dimension, sd.sub_dimension) : null,
      group: sd.group || null,
    };
  });
}

async function getSongAnalysis(db, songId) {
  const r = await db.query(
    `SELECT perspective, intensity, clarity, focus_amount, lyrical_tone, target_audience,
            emotions, explanation, themes, topics, advocacy, tactics, moral_frames
     FROM song_lyric_analysis WHERE song_id = $1 AND model_used = $2`,
    [songId, DEFAULT_MODEL]);
  if (r.rows.length === 0) return null;
  const a = r.rows[0];
  return {
    perspective: a.perspective, intensity: a.intensity, clarity: a.clarity,
    focus_amount: a.focus_amount, lyrical_tone: a.lyrical_tone, target_audience: a.target_audience,
    emotions: a.emotions || [], explanation: a.explanation,
    themes: mapDim('themes', a.themes),
    targets: mapDim('topics', a.topics),
    actions: mapDim('advocacy', a.advocacy),
    tactics: mapDim('tactics', a.tactics),
    moral_frames: mapDim('moral_frames', a.moral_frames),
  };
}
```
Update the `module.exports` line to include `getSongAnalysis`, `subDimensionLabel`, and `SUBDIM`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/analysis.test.js`
Expected: PASS (all analysis tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/analysis.js backend/test/analysis.test.js
git commit -F - <<'EOF'
feat(B1): getSongAnalysis full coding read with display labels

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: `facetTree(db)` — hierarchical facets with distinct-song counts

**Files:**
- Modify: `backend/services/analysis.js`
- Test: `backend/test/analysis.test.js`

**Interfaces:**
- Produces: `facetTree(db)` → object keyed by public dimension name (`themes`,`targets`,`actions`,`tactics`,`moral_frames`). Each value: `{ label, count, sub_dimensions: [{ id, label, count, groups: [{ id, label, count, codes: [{ code, label, count }] }] }] }`, ordered exactly as `taxonomy.hierarchy[<dim>]`. Every `count` is a **distinct live-song** count (`status='included' AND published=true`) — a song with two sibling codes counts once at the group/sub-dimension/dimension level. Empty nodes (0 live songs) are omitted: a code with count 0 is dropped, a group with no surviving codes is dropped, a sub-dimension with no surviving groups is dropped.
- Uses `PUBLIC_DIMS` (DB column → public name) and `SUBDIM` + `taxonomy.hierarchy` from Tasks 1/3.

- [ ] **Step 1: Write the failing test**

Add to `backend/test/analysis.test.js`:
```javascript
test('facetTree returns the hierarchy with distinct-song counts', async () => {
  await mkCodedSong(); // themes:[killing] (cruelty_suffering/violence), targets:[cows] (farmed_domesticated/mammals)
  const t = await analysis.facetTree(pool);
  assert.equal(t.themes.label, 'Core Sentiments & Themes');
  assert.ok(t.themes.count >= 1);
  const cruelty = t.themes.sub_dimensions.find(s => s.id === 'cruelty_suffering');
  assert.ok(cruelty && cruelty.count >= 1, 'cruelty_suffering sub-dim present');
  assert.equal(cruelty.label, 'Bodily Harm, Confinement & Suffering');
  const violence = cruelty.groups.find(g => g.id === 'violence');
  assert.ok(violence, 'violence group present');
  const killing = violence.codes.find(c => c.code === 'killing');
  assert.ok(killing && killing.count >= 1);
  assert.equal(killing.label, 'Killing');
  // empty nodes omitted
  assert.ok(t.themes.sub_dimensions.every(s => s.groups.length > 0));
  assert.ok(t.themes.sub_dimensions.every(s => s.groups.every(g => g.codes.length > 0)));
  // targets tree too
  const farmed = t.targets.sub_dimensions.find(s => s.id === 'farmed_domesticated');
  assert.ok(farmed.groups.find(g => g.id === 'mammals').codes.find(c => c.code === 'cows'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/analysis.test.js`
Expected: FAIL — `analysis.facetTree is not a function`.

- [ ] **Step 3: Implement `facetTree`**

Add to `backend/services/analysis.js` (the `PUBLIC_DIMS` map is defined here if not already):
```javascript
const PUBLIC_DIMS = { themes: 'themes', topics: 'targets', advocacy: 'actions', tactics: 'tactics', moral_frames: 'moral_frames' };

async function facetTree(db) {
  const out = {};
  for (const [col, pub] of Object.entries(PUBLIC_DIMS)) {
    // One query: distinct (song_id, code) pairs over live+coded songs for this dimension.
    // ${col} comes from the controlled PUBLIC_DIMS whitelist — never user input.
    const rows = (await db.query(
      `SELECT DISTINCT s.id AS song_id, elem->>'code' AS code
       FROM songs s
       JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = $1
       CROSS JOIN LATERAL jsonb_array_elements(sa.${col}) AS elem
       WHERE s.status = 'included' AND s.published = true`,
      [DEFAULT_MODEL])).rows;

    // Distinct-song sets at code / group / sub-dimension / dimension level.
    const codeSongs = new Map(), groupSongs = new Map(), subSongs = new Map(), dimSongs = new Set();
    const bump = (m, k, songId) => { let s = m.get(k); if (!s) { s = new Set(); m.set(k, s); } s.add(songId); };
    for (const { song_id, code } of rows) {
      const sd = SUBDIM[col].get(code);
      if (!sd) continue; // code absent from taxonomy — skip defensively
      bump(codeSongs, code, song_id);
      bump(groupSongs, `${sd.sub_dimension}/${sd.group}`, song_id);
      bump(subSongs, sd.sub_dimension, song_id);
      dimSongs.add(song_id);
    }

    const taxKey = DIM_TO_TAXONOMY[col];
    const codesOf = taxonomy[taxKey] || [];
    const h = taxonomy.hierarchy[taxKey];
    const subDimensions = [];
    for (const [subId, sub] of Object.entries(h.sub_dimensions)) {
      const groups = [];
      for (const [groupId, groupLabel] of Object.entries(sub.groups)) {
        const codes = codesOf
          .filter(i => i.sub_dimension === subId && i.group === groupId)
          .map(i => ({ code: i.id, label: i.label, count: (codeSongs.get(i.id) || new Set()).size }))
          .filter(c => c.count > 0);
        if (codes.length === 0) continue;
        groups.push({ id: groupId, label: groupLabel, count: (groupSongs.get(`${subId}/${groupId}`) || new Set()).size, codes });
      }
      if (groups.length === 0) continue;
      subDimensions.push({ id: subId, label: sub.label, count: (subSongs.get(subId) || new Set()).size, groups });
    }
    out[pub] = { label: h.label, count: dimSongs.size, sub_dimensions: subDimensions };
  }
  return out;
}
```
Add `facetTree` and `PUBLIC_DIMS` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/analysis.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/analysis.js backend/test/analysis.test.js
git commit -F - <<'EOF'
feat(B1): facetTree hierarchical facets with distinct-song rollup counts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5: `facetFilterConditions(selections, startIndex)` — AND filter SQL

**Files:**
- Modify: `backend/services/analysis.js`
- Test: `backend/test/analysis.test.js`

**Interfaces:**
- Produces: `facetFilterConditions(selections, startIndex)` where `selections` is `{ themes?: string[], targets?: string[], actions?: string[], tactics?: string[], moral_frames?: string[] }` and `startIndex` is the next positional-param number. Returns `{ clauses: string[], params: any[], needsJoin: boolean }`. Each selected code becomes one `sa.<col> @> $N::jsonb` clause with param `JSON.stringify([{code}])` (AND semantics — one clause per code). `needsJoin` is true if any code was selected (caller must JOIN `song_lyric_analysis sa ... AND sa.model_used=DEFAULT_MODEL`). Public dimension names map back to DB columns (`targets→topics`, `actions→advocacy`).

- [ ] **Step 1: Write the failing test**

Add to `backend/test/analysis.test.js`:
```javascript
test('facetFilterConditions builds AND clauses with mapped columns', () => {
  const { clauses, params, needsJoin } = analysis.facetFilterConditions(
    { themes: ['killing', 'suffering'], targets: ['cows'] }, 5);
  assert.equal(needsJoin, true);
  assert.equal(clauses.length, 3); // two themes + one target, all ANDed
  assert.ok(clauses.includes('sa.themes @> $5::jsonb'));
  assert.ok(clauses.includes('sa.themes @> $6::jsonb'));
  assert.ok(clauses.includes('sa.topics @> $7::jsonb')); // targets -> topics column
  assert.deepEqual(JSON.parse(params[0]), [{ code: 'killing' }]);
  assert.deepEqual(JSON.parse(params[2]), [{ code: 'cows' }]);
});

test('facetFilterConditions with no selections needs no join', () => {
  const r = analysis.facetFilterConditions({}, 1);
  assert.equal(r.needsJoin, false);
  assert.deepEqual(r.clauses, []);
  assert.deepEqual(r.params, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/analysis.test.js`
Expected: FAIL — `analysis.facetFilterConditions is not a function`.

- [ ] **Step 3: Implement `facetFilterConditions`**

Add to `backend/services/analysis.js`:
```javascript
const FACET_TO_COLUMN = { themes: 'themes', targets: 'topics', actions: 'advocacy', tactics: 'tactics', moral_frames: 'moral_frames' };

function facetFilterConditions(selections, startIndex) {
  const clauses = [], params = [];
  let idx = startIndex;
  for (const [facet, column] of Object.entries(FACET_TO_COLUMN)) {
    const raw = selections && selections[facet];
    if (!raw) continue;
    const codes = Array.isArray(raw) ? raw : [raw];
    for (const code of codes) {
      if (!code) continue;
      clauses.push(`sa.${column} @> $${idx}::jsonb`);
      params.push(JSON.stringify([{ code }]));
      idx++;
    }
  }
  return { clauses, params, needsJoin: clauses.length > 0 };
}
```
Add `facetFilterConditions` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/analysis.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/analysis.js backend/test/analysis.test.js
git commit -F - <<'EOF'
feat(B1): facetFilterConditions AND-logic facet SQL builder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 6: `themeCounts(db, limit)` — real theme aggregation for analytics

**Files:**
- Modify: `backend/services/analysis.js`
- Test: `backend/test/analysis.test.js`

**Interfaces:**
- Produces: `themeCounts(db, limit=15)` → `[{ theme, label, song_count }]` sorted desc, over live+coded songs, from the `themes` dimension. `theme` is the raw code (kept for backward-compatible response shape), `label` the display label. Replaces the mock `vegan-themes` aggregation.

- [ ] **Step 1: Write the failing test**

Add to `backend/test/analysis.test.js`:
```javascript
test('themeCounts aggregates real themes from song_lyric_analysis', async () => {
  await mkCodedSong(); // themes:[killing]
  const rows = await analysis.themeCounts(pool, 15);
  const killing = rows.find(r => r.theme === 'killing');
  assert.ok(killing && killing.song_count >= 1);
  assert.equal(killing.label, 'Killing');
  assert.ok(rows.length <= 15);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/analysis.test.js`
Expected: FAIL — `analysis.themeCounts is not a function`.

- [ ] **Step 3: Implement `themeCounts`**

Add to `backend/services/analysis.js`:
```javascript
async function themeCounts(db, limit = 15) {
  const r = await db.query(
    `SELECT elem->>'code' AS theme, COUNT(DISTINCT s.id)::int AS song_count
     FROM songs s
     JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = $1
     CROSS JOIN LATERAL jsonb_array_elements(sa.themes) AS elem
     WHERE s.status = 'included' AND s.published = true
     GROUP BY elem->>'code'
     ORDER BY song_count DESC
     LIMIT $2`,
    [DEFAULT_MODEL, limit]);
  return r.rows.map(row => ({ theme: row.theme, label: label('themes', row.theme), song_count: row.song_count }));
}
```
Add `themeCounts` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/analysis.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/analysis.js backend/test/analysis.test.js
git commit -F - <<'EOF'
feat(B1): themeCounts real theme aggregation for analytics

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 7: Public analysis router + mount + privacy guard

**Files:**
- Create: `backend/routes/analysis.js`
- Modify: `backend/server.js:22` (add mount after analytics)
- Modify: `backend/test/lyrics_privacy.test.js:8`

**Interfaces:**
- Consumes: `analysis.getSongAnalysis`, `analysis.facetTree` (Tasks 3–4).
- Produces HTTP: `GET /api/analysis/song/:id` → the analysis object or `404 {error}`; `GET /api/analysis/facets` → `facetTree` result (the hierarchical tree).

- [ ] **Step 1: Add the new public route to the privacy guardrail (failing test first)**

In `backend/test/lyrics_privacy.test.js` line 8, add `'analysis.js'` to the list:
```javascript
const PUBLIC_ROUTES = ['spotify.js', 'playlists.js', 'youtube.js', 'submissions.js', 'analytics.js', 'analysis.js'];
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `node --test test/lyrics_privacy.test.js`
Expected: FAIL — cannot read `routes/analysis.js` (ENOENT), because the file doesn't exist yet.

- [ ] **Step 3: Create the router**

Create `backend/routes/analysis.js`:
```javascript
const express = require('express');
const router = express.Router();
const pool = require('../database/db');
const analysis = require('../services/analysis');

// Public, read-only qualitative analysis surface. Reads only the song_lyric_analysis
// table — no access to the local-only full-lyrics table (see test/lyrics_privacy.test.js
// guard). NOTE: do not write the guarded table/column names in this file's text, even in
// comments — the guard greps raw source, so naming them here would false-trip it.

router.get('/facets', async (req, res) => {
  try {
    res.json(await analysis.facetTree(pool));
  } catch (e) {
    console.error('facets error:', e);
    res.status(500).json({ error: 'Failed to load facets' });
  }
});

router.get('/song/:id', async (req, res) => {
  try {
    const a = await analysis.getSongAnalysis(pool, parseInt(req.params.id));
    if (!a) return res.status(404).json({ error: 'No analysis for this song' });
    res.json(a);
  } catch (e) {
    console.error('song analysis error:', e);
    res.status(500).json({ error: 'Failed to load analysis' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount the router**

In `backend/server.js`, after line 22 (`app.use('/api/analytics', ...)`), add:
```javascript
app.use('/api/analysis', require('./routes/analysis'));
```

- [ ] **Step 5: Run the guard + full suite to verify pass**

Run: `node --test test/lyrics_privacy.test.js`
Expected: PASS (both guard tests — `analysis.js` references neither `song_lyrics` nor `translation`).

- [ ] **Step 6: Headless endpoint smoke**

Start a fresh backend, then curl both endpoints (replace with a known coded song id, e.g. 30 = "Cows with Guns"):
```bash
curl -s localhost:5000/api/analysis/facets | head -c 300
curl -s localhost:5000/api/analysis/song/30 | head -c 300
curl -s -o /dev/null -w "%{http_code}\n" localhost:5000/api/analysis/song/999999   # expect 404
```
Expected: facets returns a JSON object with `themes`/`targets` keys, each `{label, count, sub_dimensions:[…]}` (the hierarchical tree); song/30 returns the coding with `sub_dimension`/`sub_dimension_label` on each code; a non-existent id returns `404`.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/analysis.js backend/server.js backend/test/lyrics_privacy.test.js
git commit -F - <<'EOF'
feat(B1): public /api/analysis router (song + facets) with privacy guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 8: Extend `getWorkbench` with the full analysis object

**Files:**
- Modify: `backend/services/curation.js:184-202`
- Modify: `backend/test/curation.test.js`

**Interfaces:**
- Consumes: `analysis.getSongAnalysis` (Task 3).
- Produces: `getWorkbench(...)` return object gains `analysis` (the full coding object or `null`). The existing `analysed` boolean and `completeness.analysis` are unchanged.

- [ ] **Step 1: Write the failing test**

Add to `backend/test/curation.test.js` (uses the file's existing `ZZZCUR` sentinel + `pool`):
```javascript
test('getWorkbench includes the full analysis object when coded', async () => {
  const id = await mkSong({ title: 'ZZZCUR Analysed', status: 'included', published: true });
  await pool.query(
    `INSERT INTO song_lyric_analysis (song_id, model_used, perspective, emotions, themes, topics, advocacy, tactics, moral_frames)
     VALUES ($1, 'gemma4:latest', 'human_observer', ARRAY['hope'],
       $2::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
    [id, JSON.stringify([{ code: 'compassion', evidence: 'be kind' }])]);
  const wb = await curation.getWorkbench(pool, id);
  assert.equal(wb.analysed, true);
  assert.equal(wb.analysis.perspective, 'human_observer');
  assert.equal(wb.analysis.themes[0].label, 'Compassion');
});
```
Add `song_lyric_analysis` cleanup to this file's `after()` hook (line ~37 block):
```javascript
await pool.query(`DELETE FROM song_lyric_analysis WHERE song_id IN (SELECT id FROM songs WHERE title LIKE 'ZZZCUR%')`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/curation.test.js`
Expected: FAIL — `wb.analysis` is undefined.

- [ ] **Step 3: Implement**

In `backend/services/curation.js`, add the import near the top (after the existing `require('./analysis')` line from Task 2 — extend it):
```javascript
const { DEFAULT_MODEL, getSongAnalysis } = require('./analysis');
```
In `getWorkbench` (around line 185), after the `analysed` computation, fetch the full object and add it to the returned object (line ~200, alongside `processing, analysed,`):
```javascript
  const analysisObj = analysed ? await getSongAnalysis(db, id) : null;
```
Then in the `return { ... }` add:
```javascript
    processing, analysed, analysis: analysisObj,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/curation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/curation.js backend/test/curation.test.js
git commit -F - <<'EOF'
feat(B1): getWorkbench returns the full analysis object for the admin panel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 9: Wire analysis-facet filtering into `spotify.js /search`

**Files:**
- Modify: `backend/routes/spotify.js` (`/search` handler, ~lines 268–470)

**Interfaces:**
- Consumes: `analysis.facetFilterConditions` (Task 5).
- Produces: `/search` accepts `themes`, `targets`, `actions`, `tactics`, `moral_frames` query params (repeatable), AND-combined with all existing filters; selecting any joins `song_lyric_analysis` (restricting to coded songs).

- [ ] **Step 1: Import the service**

At the top of `backend/routes/spotify.js` (with the other requires), add:
```javascript
const analysis = require('../services/analysis');
```

- [ ] **Step 2: Read the facet params**

In the `/search` destructuring (the `const { ... } = req.query;` at ~line 271), add after `parent_genres,`:
```javascript
      themes: fThemes,
      targets: fTargets,
      actions: fActions,
      tactics: fTactics,
      moral_frames: fMoralFrames,
```

- [ ] **Step 3: Build and append the facet clauses**

Immediately **after** the `parent_genres` filter block (after line ~408, before the sort/pagination logic), insert:
```javascript
    // Analysis facet filters (AND logic; joins song_lyric_analysis when any is set)
    const facet = analysis.facetFilterConditions(
      { themes: fThemes, targets: fTargets, actions: fActions, tactics: fTactics, moral_frames: fMoralFrames },
      paramIndex);
    if (facet.needsJoin) {
      whereConditions.push(...facet.clauses);
      queryParams.push(...facet.params);
      paramIndex += facet.params.length;
    }
```

- [ ] **Step 4: Add the JOIN to the FROM clause**

The `/search` builds its SQL from `whereConditions` against `songs s ... song_artists ... artists a ... LEFT JOIN albums al`. Locate the `FROM songs s` line(s) in the count query and the results query within `/search` (search for `FROM songs s` inside the handler). To each, add — only when `facet.needsJoin` — the join:
```
JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = '${analysis.DEFAULT_MODEL}'
```
Implement by building a `const facetJoin = facet.needsJoin ? \`JOIN song_lyric_analysis sa ON sa.song_id = s.id AND sa.model_used = '${analysis.DEFAULT_MODEL}'\` : '';` right after Step 3's block, and interpolating `${facetJoin}` into both the count and results SQL immediately after their `JOIN artists a ON ...` line. (`DEFAULT_MODEL` is a controlled constant, not user input — safe to inline.) If `/search` uses `GROUP BY s.id`, the extra join does not change grouping.

- [ ] **Step 5: Headless smoke (no unit test — route has no supertest harness)**

Start a fresh backend. Verify AND narrowing and that an un-facet search is unchanged:
```bash
curl -s "localhost:5000/api/spotify/search?themes=killing&limit=5" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('killing songs:', (j.songs||j.results||[]).length)})"
curl -s "localhost:5000/api/spotify/search?themes=killing&targets=cows&limit=5" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('killing AND cows:', (j.songs||j.results||[]).length)})"
curl -s -o /dev/null -w "plain search %{http_code}\n" "localhost:5000/api/spotify/search?limit=5"
```
Expected: the two-facet count ≤ the one-facet count (AND narrows); plain search still `200`. (Inspect the JSON shape first with `curl ... | head -c 300` to confirm whether results live under `songs` or `results` and adjust the smoke accordingly.)

- [ ] **Step 6: Commit**

```bash
git add backend/routes/spotify.js
git commit -F - <<'EOF'
feat(B1): analysis-facet AND filtering in /search

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 10: Repoint analytics `vegan-themes`, `summary`, `filter-options` at real data

**Files:**
- Modify: `backend/routes/analytics.js` (lines ~191–210 vegan-themes, ~224/236 summary, ~252–262 filter-options, and the mock filter params at ~11–44 and ~89–121)

**Interfaces:**
- Consumes: `analysis.themeCounts` (Task 6).

- [ ] **Step 1: Import the service**

At the top of `backend/routes/analytics.js`, add:
```javascript
const analysis = require('../services/analysis');
```

- [ ] **Step 2: Repoint `vegan-themes`**

Replace the query block at lines ~191–205 (the `SELECT unnest(s.vegan_focus) as theme ...` through `res.json(result.rows);`) with:
```javascript
    const rows = await analysis.themeCounts(pool, 15);
    res.json(rows);
```
Delete the now-unused `whereClause`/`query`/`result` locals in that handler if they become dead. (The response shape stays `[{theme, song_count, ...}]`; `label` is now also present.)

- [ ] **Step 3: Repoint the `summary` theme count**

In `/summary` (line ~224), replace the 4th query string:
```javascript
`SELECT COUNT(*) as songs_with_vegan_focus FROM songs WHERE vegan_focus IS NOT NULL AND array_length(vegan_focus, 1) > 0 AND status = 'included' AND published = true`
```
with:
```javascript
`SELECT COUNT(DISTINCT sa.song_id) as songs_with_vegan_focus
 FROM song_lyric_analysis sa JOIN songs s ON s.id = sa.song_id
 WHERE sa.model_used = '${analysis.DEFAULT_MODEL}' AND s.status = 'included' AND s.published = true`
```
Leave the `songs_with_themes: parseInt(results[3].rows[0].songs_with_vegan_focus)` mapping as-is (the alias is unchanged).

- [ ] **Step 4: Repoint `filter-options` theme/style lists**

In `/filter-options` (lines ~252–262), replace the two mock queries (`unnest(vegan_focus)` and `unnest(advocacy_style)`) so the endpoint no longer references dropped columns. Simplest: drop those two queries and their response keys, since B3 will source facets from `/api/analysis/facets`. Change the `queries` array to keep only genres + parent_genres, and the response `options` to:
```javascript
    const options = {
      genres: results[0].rows.map(row => row.genre),
      parent_genres: results[1].rows.map(row => row.parent_genre),
    };
```

- [ ] **Step 5: Remove the mock filter params from the two chart endpoints**

In the two handlers at lines ~11–44 and ~89–121, delete the `vegan_focus`/`advocacy_style` destructured params and their `if (vegan_focus) {...}` / `if (advocacy_style) {...}` `whereConditions` blocks. These filters are no longer offered.

- [ ] **Step 6: Verify no mock columns remain in analytics.js**

Run:
```bash
grep -nE "vegan_focus|advocacy_style|animal_category|advocacy_issues|lyrical_explicitness" backend/routes/analytics.js
```
Expected: **no output**.

- [ ] **Step 7: Headless smoke**

Fresh backend:
```bash
curl -s localhost:5000/api/analytics/vegan-themes | head -c 300         # real themes now, non-empty
curl -s localhost:5000/api/analytics/summary | head -c 300              # songs_with_themes reflects 685
```
Expected: `vegan-themes` returns a non-empty array of real theme codes; `summary.songs_with_themes` ≈ 685.

- [ ] **Step 8: Commit**

```bash
git add backend/routes/analytics.js
git commit -F - <<'EOF'
feat(B1): repoint analytics themes at song_lyric_analysis; drop mock filters

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 11: Strip mock-array references from `spotify.js`

**Files:**
- Modify: `backend/routes/spotify.js` (lines ~273–277, ~311–348, ~454–458, ~500–504, ~525–560, ~631–635, ~731–760, ~1027–1031)

**Interfaces:** none new. Removes dead references to the five soon-dropped columns while keeping every endpoint's response shape valid.

- [ ] **Step 1: Remove the mock search filter params + blocks**

In `/search`: delete `vegan_focus, animal_category, advocacy_style, advocacy_issues, lyrical_explicitness,` from the destructuring (lines ~273–277) and delete the five `if (vegan_focus) {...}` … `if (lyrical_explicitness) {...}` blocks (lines ~310–348). The new `themes/targets/...` facet params (Task 9) replace them.

- [ ] **Step 2: Remove mock columns from the search results SELECT + echo**

Delete the `s.vegan_focus, s.animal_category, s.advocacy_style, s.advocacy_issues, s.lyrical_explicitness,` lines from the results SELECT (~454–458) and the corresponding `vegan_focus: ...` … `lyrical_explicitness: ...` keys from the `filtersApplied`/echo object (~500–504).

- [ ] **Step 3: Empty out the mock `categorization-options` endpoint**

The `/categorization-options` handler (~520–636) exists only to serve the mock arrays. Replace its five `UNNEST(...)` queries + response so it returns an empty object (keeps the route alive so any current caller gets `{}` rather than a 404; B3 removes the route):
```javascript
router.get('/categorization-options', async (req, res) => {
  // Mock categorisation removed (B1). Faceted analysis options now come from
  // GET /api/analysis/facets (B3). Kept as an empty response for backward compat.
  res.json({});
});
```
(Delete the old handler body entirely; match the exact existing route path/method when replacing.)

- [ ] **Step 4: Fix the similar-songs query**

In the similar-songs handler (~725–765) remove `vegan_focus`/`advocacy_style` from the `SELECT` (~731, ~745–746) and the `s.vegan_focus && cs.vegan_focus OR s.advocacy_style && cs.advocacy_style` similarity predicate (~759–760). Replace the similarity basis with genre so the endpoint still returns related songs:
```
WHERE s.id <> $1 AND s.status = 'included' AND s.published = true
  AND cs.genre IS NOT NULL AND s.genre = cs.genre
```
(Adjust to the handler's actual CTE alias `cs`/param; keep its existing LIMIT/ORDER. If genre-based similarity is awkward here, the minimal safe change is to drop the two mock predicates and keep the remaining criteria.)

- [ ] **Step 5: Remove mock columns from the artist-songs SELECT**

In the artist detail handler, delete `s.vegan_focus, s.animal_category, s.advocacy_style, s.advocacy_issues, s.lyrical_explicitness,` (~1027–1031).

- [ ] **Step 6: Verify none remain**

Run:
```bash
grep -nE "vegan_focus|advocacy_style|animal_category|advocacy_issues|lyrical_explicitness" backend/routes/spotify.js
```
Expected: **no output**.

- [ ] **Step 7: Headless smoke of the touched endpoints**

Fresh backend — confirm nothing 500s:
```bash
curl -s -o /dev/null -w "search %{http_code}\n" "localhost:5000/api/spotify/search?limit=3"
curl -s -o /dev/null -w "catopts %{http_code}\n" "localhost:5000/api/spotify/categorization-options"
curl -s -o /dev/null -w "artist %{http_code}\n" "localhost:5000/api/spotify/artist/1"
# similar-songs: use a known song id
curl -s -o /dev/null -w "similar %{http_code}\n" "localhost:5000/api/spotify/songs/30/similar"
```
Expected: all `200` (confirm the exact similar-songs path from the handler; adjust if different).

- [ ] **Step 8: Commit**

```bash
git add backend/routes/spotify.js
git commit -F - <<'EOF'
refactor(B1): remove mock categorisation arrays from spotify.js

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 12: Strip mock-array references from `admin.js`

**Files:**
- Modify: `backend/routes/admin.js` (lines ~133–137, ~223–233, ~325–326, ~429–433, ~476–582, ~719–743, ~854–890, ~1253–1293)

**Interfaces:** none new. Admin categorisation endpoints stop reading/writing the five columns; the admin categorisation UI (deleted in B2) will simply have nothing to submit.

- [ ] **Step 1: Manual-song create (~133–233)**

Remove `vegan_focus, animal_category, advocacy_style, advocacy_issues, lyrical_explicitness,` from the request destructuring (~133–137), from the INSERT column list (~223–224), and from the INSERT value list (~232–233). Renumber positional params if the INSERT used `$n` placeholders for them (remove the five and shift subsequent indices down), OR simpler: keep them out of both lists consistently.

- [ ] **Step 2: CSV export column list (~325–326)**

Remove `'vegan_focus', 'animal_category', 'advocacy_style', 'advocacy_issues', 'lyrical_explicitness',` from the exported-columns array.

- [ ] **Step 3: Admin `categorization-options` (~429–433)**

Remove the five `vegan_focus: \`SELECT DISTINCT UNNEST(...)\`` entries. If that leaves the query map empty, make the handler return `res.json({})` (mirror Task 11 Step 3).

- [ ] **Step 4: Song edit handlers (~476–582 and ~854–890)**

In both edit handlers, remove the five `if (vegan_focus !== undefined) { updateFields.push(...); values.push(...); }` blocks and the corresponding destructured params (~476–480, ~854–858).

- [ ] **Step 5: Bulk CSV import (~719–743)**

Remove the five `vegan_focus: parseArrayField(...)` mappings (~719–723) and the `vegan_focus = $2, ... lyrical_explicitness = $6,` SET clauses + their `updateData.*` values (~730–743). Renumber the remaining SET placeholders so they stay contiguous.

- [ ] **Step 6: Data-quality queries (~1253–1293)**

Remove the `has_vegan_focus` CASE expressions, the `s.vegan_focus` in `GROUP BY`, and the `vegan_focus`-based `ORDER BY` term from both queries. If a query's purpose was "songs missing categorisation", drop that sort criterion (categorisation no longer lives here).

- [ ] **Step 7: Verify none remain**

Run:
```bash
grep -nE "vegan_focus|advocacy_style|animal_category|advocacy_issues|lyrical_explicitness" backend/routes/admin.js
```
Expected: **no output**.

- [ ] **Step 8: Full backend suite (admin routes are covered indirectly; ensure services still green)**

Run: `node --test` (from `backend/`)
Expected: PASS (all suites). Then headless-smoke a couple of admin endpoints with the `X-Admin-Password` header to confirm no 500 (edit + categorization-options):
```bash
curl -s -o /dev/null -w "admin catopts %{http_code}\n" -H "X-Admin-Password: $ADMIN_PASSWORD" "localhost:5000/api/admin/categorization-options"
```
Expected: `200`.

- [ ] **Step 9: Commit**

```bash
git add backend/routes/admin.js
git commit -F - <<'EOF'
refactor(B1): remove mock categorisation arrays from admin.js

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 13: Migration 007 — drop the five mock columns (self-guarding)

**Files:**
- Create: `backend/database/migrations/007_drop_mock_categorisation.sql`

**Interfaces:** none. Schema change only; runs after all code references are gone (Tasks 10–12).

- [ ] **Step 1: Write the migration**

Create `backend/database/migrations/007_drop_mock_categorisation.sql`:
```sql
-- Migration 007 — Drop the mocked, always-empty categorisation arrays (Sub-project B1)
-- Spec: docs/superpowers/specs/2026-07-17-B-analysis-integration-design.md §4
-- These five TEXT[] columns were never populated (0 non-empty rows across the catalogue);
-- the real qualitative coding lives in song_lyric_analysis. Self-guards before dropping.

DO $$
DECLARE
  bad integer;
BEGIN
  SELECT COUNT(*) INTO bad FROM songs WHERE
       (vegan_focus         IS NOT NULL AND array_length(vegan_focus, 1)         > 0)
    OR (animal_category      IS NOT NULL AND array_length(animal_category, 1)      > 0)
    OR (advocacy_style       IS NOT NULL AND array_length(advocacy_style, 1)       > 0)
    OR (advocacy_issues      IS NOT NULL AND array_length(advocacy_issues, 1)      > 0)
    OR (lyrical_explicitness IS NOT NULL AND array_length(lyrical_explicitness, 1) > 0);
  IF bad > 0 THEN
    RAISE EXCEPTION 'Aborting 007: % song(s) have non-empty mock categorisation — investigate before dropping', bad;
  END IF;
END $$;

ALTER TABLE songs DROP COLUMN IF EXISTS vegan_focus;
ALTER TABLE songs DROP COLUMN IF EXISTS animal_category;
ALTER TABLE songs DROP COLUMN IF EXISTS advocacy_style;
ALTER TABLE songs DROP COLUMN IF EXISTS advocacy_issues;
ALTER TABLE songs DROP COLUMN IF EXISTS lyrical_explicitness;
```

- [ ] **Step 2: Apply the migration**

Run (from repo root; password from `backend/.env`):
```bash
PGPASSWORD="$(grep -E '^DB_PASSWORD=' backend/.env | cut -d= -f2-)" \
  "/c/Program Files/PostgreSQL/17/bin/psql" -h localhost -p 5432 -U postgres -d vegan_playlist \
  -f backend/database/migrations/007_drop_mock_categorisation.sql
```
Expected: `DO` then five `ALTER TABLE` lines, no EXCEPTION.

- [ ] **Step 3: Verify the columns are gone**

Run:
```bash
PGPASSWORD="$(grep -E '^DB_PASSWORD=' backend/.env | cut -d= -f2-)" \
  "/c/Program Files/PostgreSQL/17/bin/psql" -h localhost -p 5432 -U postgres -d vegan_playlist \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name='songs' AND column_name IN ('vegan_focus','animal_category','advocacy_style','advocacy_issues','lyrical_explicitness');"
```
Expected: `0 rows`.

- [ ] **Step 4: Commit**

```bash
git add backend/database/migrations/007_drop_mock_categorisation.sql
git commit -F - <<'EOF'
feat(B1): migration 007 — drop the five empty mock categorisation columns

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 14: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full backend test suite**

Run: `node --test` (from `backend/`)
Expected: all suites PASS, including `analysis.test.js`, `curation.test.js`, `lyrics_privacy.test.js`. Record the total count.

- [ ] **Step 2: No mock columns referenced anywhere in backend**

Run (from repo root):
```bash
grep -rnE "vegan_focus|advocacy_style|animal_category|advocacy_issues|lyrical_explicitness" backend/routes backend/services
```
Expected: **no output**. (Scripts under `backend/scripts/` are out of scope for B1 — the two documented read-only scripts may still mention them; note but do not fix here.)

- [ ] **Step 3: Non-ASCII scan on files touched by scripted edits**

Run:
```bash
grep -rnP "[^\x00-\x7F]" backend/services/analysis.js backend/routes/analysis.js backend/database/migrations/007_drop_mock_categorisation.sql
```
Expected: no unexpected mojibake (only intentional characters, if any).

- [ ] **Step 4: Live headless smoke of the full B1 surface**

Start a fresh backend and confirm: `/api/analysis/facets` (object with populated dims), `/api/analysis/song/30` (coding), `/api/analysis/song/999999` (404), `/api/spotify/search?themes=killing&targets=cows` (AND-narrowed, 200), `/api/analytics/vegan-themes` (real themes), `/api/admin/workbench/30` with the admin header (includes an `analysis` object). Confirm the earlier baseline queue counts (`/api/admin/curation/counts`) are unchanged from before B1.

- [ ] **Step 5: Confirm no stray test rows**

Run:
```bash
PGPASSWORD="$(grep -E '^DB_PASSWORD=' backend/.env | cut -d= -f2-)" \
  "/c/Program Files/PostgreSQL/17/bin/psql" -h localhost -p 5432 -U postgres -d vegan_playlist \
  -c "SELECT COUNT(*) FROM songs WHERE title LIKE 'ZZZANL%' OR title LIKE 'ZZZCUR%';"
```
Expected: `0` (test `after()` hooks cleaned up).

---

## Self-Review

**Spec coverage (against §4 backend items):**
- Vendor taxonomy.json + loader → Task 1 ✓
- Shared `DEFAULT_MODEL` → Tasks 1–2 ✓
- Song analysis read → Task 3, exposed Task 7 ✓
- `GET /api/analysis/facets` → Tasks 4, 7 ✓
- Extended browse/search facet filtering (AND) → Tasks 5, 9 ✓
- `vegan-themes` repoint → Tasks 6, 10 ✓
- `getWorkbench` full analysis → Task 8 ✓
- Migration 007 + mock-reference removal → Tasks 10–13 ✓
- Guardrail intact → Task 7 (adds analysis.js to the guard), Task 14 ✓

**Placeholder scan:** removal Tasks 11–12 give line anchors + the exact snippets to delete and, where a query's basis changes (similar-songs, data-quality sort), the replacement predicate — no "handle appropriately" left open. Route endpoints are smoke-verified (the repo has no supertest harness; this matches the A1–A4 convention of service unit tests + headless curl).

**Type consistency:** `facetFilterConditions` public facet names (`themes/targets/actions/tactics/moral_frames`) match the `/search` params (Task 9) and `facetTree` output keys (Task 4). `getSongAnalysis` dimension keys (`themes/targets/actions/tactics/moral_frames`) — each code carrying `code/label/evidence/sub_dimension/sub_dimension_label/group` — match what B2's `LyricalAnalysis` will consume. `PUBLIC_DIMS`/`SUBDIM`/`DIM_TO_TAXONOMY` are the single DB-column↔taxonomy mapping used by Tasks 3, 4, 5. `DEFAULT_MODEL` is defined once (Task 1) and imported by curation.js (Task 2), spotify.js (Task 9), analytics.js (Task 10).

**Ordering safety:** code references are removed (Tasks 10–12) **before** the columns are dropped (Task 13), so no endpoint queries a dropped column. `/categorization-options` is emptied, not deleted, so no current caller 404s before B2/B3.
