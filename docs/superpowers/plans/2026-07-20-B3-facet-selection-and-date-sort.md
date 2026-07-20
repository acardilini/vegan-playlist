# B3 Round 3 — Selectable Facet Groups + Date-Added Sort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make theme sub-dimensions & groups selectable (each an OR-term over its codes; individual codes stay exact; all terms AND), fix the theme-tree row alignment, and add a "Date added" sort — on the existing `session-B3-browse-search` branch, before merge.

**Architecture:** Backend adds taxonomy reverse maps + `facetSelectionClauses` (AND-of-terms: a code = one `@>`, a group/sub-dimension = an OR over its codes), consumed by the shared `buildWhere` so `/search` and `/browse-facets` both get it. `/search` gains a `date_added` sort case (`playlist_added_at DESC`). Frontend rewrites `ThemeFacetTree` into uniform checkbox rows at all three levels with ancestor-covers-descendants behaviour, and wires the new selection state + chips into `SearchAndFilter`.

**Tech Stack:** Node/Express + PostgreSQL (`pg`), `node:test`; React/Vite (no frontend unit-test runner — verify via `npm run build` + `npx eslint src/` + live smoke). Design tokens in `frontend/src/styles/`.

## Global Constraints

- Theme filter is an **AND of terms**: a selected code = exact term (`sa.<col> @> [{code}]`); a selected group or sub-dimension = OR-term over its codes (`(… @> a OR … @> b …)`); all terms AND together.
- Selecting an ancestor (group/sub-dimension) **clears** any of its descendant selections (so state holds only the top-most terms); descendants then render checked+disabled ("covered").
- Backend keeps `status='included' AND published=true`; never SELECT `song_lyrics`; analysis model `gemma4:latest`. `buildWhere` stays the single filter source for `/search` + `/browse-facets`; exclude-self is unchanged (the whole analysis group — codes+groups+subdims — is excluded when counting analysis rows).
- Date-added sort = `ORDER BY s.playlist_added_at DESC NULLS LAST, s.title ASC`.
- Design tokens only in CSS (no raw colours; sub-dimension hexes via inline style). No emoji. No horizontal overflow. Backend tests serial; DB-touching files use a sentinel; pure files touch no DB.
- Commit after each task; end messages with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01Wo1dRPzyss3anKUdqe5erz`

---

### Task 1: Backend — taxonomy reverse maps + `facetSelectionClauses`

**Files:**
- Modify: `backend/services/analysis.js`
- Modify: `backend/test/analysis.test.js`

**Interfaces:**
- Produces: `facetSelectionClauses(sel, startIndex)` where `sel = { codes:{themes,targets,actions,tactics,moral_frames}, groups:["<dimKey>:<groupId>"], subdims:["<dimKey>:<subId>"] }` → `{ clauses, params, needsJoin }`. A code term emits `sa.<col> @> $n::jsonb`; a group/sub-dim term emits `(sa.<col> @> $a OR sa.<col> @> $b …)`. `facetFilterConditions(codesObj, startIndex)` is kept as a thin wrapper (`facetSelectionClauses({ codes: codesObj }, startIndex)`) so its existing tests and any callers still work.
- Exports: add `facetSelectionClauses` (and reverse maps if useful) to `module.exports`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/test/analysis.test.js` (before the final `after` hook; these are pure — no DB — but the file already has a DB pool + sentinel, which is fine):

```js
test('facetSelectionClauses: a group is one OR-term over its codes', () => {
  const { clauses, params, needsJoin } = analysis.facetSelectionClauses(
    { groups: ['themes:violence'] }, 1);
  assert.equal(needsJoin, true);
  assert.equal(clauses.length, 1, 'one term = one clause');
  // violence group = killing, brutality, systemic_violence (3 codes) -> parenthesised OR
  assert.match(clauses[0], /^\(sa\.themes @> \$1::jsonb OR sa\.themes @> \$2::jsonb OR sa\.themes @> \$3::jsonb\)$/);
  assert.equal(params.length, 3);
  const codes = params.map(p => JSON.parse(p)[0].code).sort();
  assert.deepEqual(codes, ['brutality', 'killing', 'systemic_violence']);
});

test('facetSelectionClauses: a sub-dimension ORs all its codes in one term', () => {
  const { clauses, params } = analysis.facetSelectionClauses(
    { subdims: ['themes:cruelty_suffering'] }, 1);
  assert.equal(clauses.length, 1);
  assert.ok(clauses[0].startsWith('(') && clauses[0].includes(' OR '));
  assert.ok(params.length > 3, 'cruelty_suffering spans several codes');
});

test('facetSelectionClauses: codes AND with a group term, indices sequential', () => {
  const { clauses, params, needsJoin } = analysis.facetSelectionClauses(
    { codes: { targets: ['cows'] }, groups: ['themes:violence'] }, 5);
  assert.equal(needsJoin, true);
  assert.equal(clauses.length, 2, 'one code term + one group term');
  assert.ok(clauses.includes('sa.topics @> $5::jsonb'), 'code term first, at startIndex');
  assert.ok(clauses.some(c => c.startsWith('(sa.themes @> $6::jsonb OR')), 'group term continues numbering');
  assert.equal(params.length, 4); // cows + 3 violence codes
});

test('facetSelectionClauses: empty selection needs no join', () => {
  const r = analysis.facetSelectionClauses({}, 1);
  assert.equal(r.needsJoin, false);
  assert.deepEqual(r.clauses, []);
  assert.deepEqual(r.params, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/analysis.test.js`
Expected: FAIL — `analysis.facetSelectionClauses is not a function`.

- [ ] **Step 3: Implement**

In `backend/services/analysis.js`, after the `FACET_TO_COLUMN` declaration (line 150) and the existing `facetFilterConditions`, add the reverse maps + the new function, and convert `facetFilterConditions` to a wrapper:

```js
// Reverse maps (built once): per facet dimension, group id -> [code ids] and sub-dimension id -> [code ids].
const FACET_GROUP_CODES = {};
const FACET_SUBDIM_CODES = {};
for (const dimKey of Object.keys(FACET_TO_COLUMN)) {
  const list = taxonomy[dimKey] || [];
  const g = new Map(), s = new Map();
  for (const it of list) {
    if (it.group) { if (!g.has(it.group)) g.set(it.group, []); g.get(it.group).push(it.id); }
    if (it.sub_dimension) { if (!s.has(it.sub_dimension)) s.set(it.sub_dimension, []); s.get(it.sub_dimension).push(it.id); }
  }
  FACET_GROUP_CODES[dimKey] = g;
  FACET_SUBDIM_CODES[dimKey] = s;
}

function splitDimId(v) {
  const i = String(v).indexOf(':');
  return i < 0 ? [null, null] : [v.slice(0, i), v.slice(i + 1)];
}

// AND-of-terms builder. codes: exact terms; groups/subdims: OR-over-their-codes terms.
function facetSelectionClauses(sel, startIndex) {
  const clauses = [], params = [];
  let idx = startIndex;
  const asArr = (v) => v == null ? [] : (Array.isArray(v) ? v : [v]);
  const pushTerm = (column, codeList) => {
    const ors = [];
    for (const code of codeList) {
      if (!code) continue;
      ors.push(`sa.${column} @> $${idx}::jsonb`);
      params.push(JSON.stringify([{ code }]));
      idx++;
    }
    if (ors.length === 1) clauses.push(ors[0]);
    else if (ors.length > 1) clauses.push('(' + ors.join(' OR ') + ')');
  };

  // individual code terms (each exact, ANDed)
  for (const [dimKey, column] of Object.entries(FACET_TO_COLUMN)) {
    for (const code of asArr(sel.codes && sel.codes[dimKey])) pushTerm(column, [code]);
  }
  // group terms (each OR over its codes)
  for (const gv of asArr(sel.groups)) {
    const [dimKey, id] = splitDimId(gv);
    const column = FACET_TO_COLUMN[dimKey];
    const codes = column && FACET_GROUP_CODES[dimKey] && FACET_GROUP_CODES[dimKey].get(id);
    if (codes && codes.length) pushTerm(column, codes);
  }
  // sub-dimension terms (each OR over its codes)
  for (const sv of asArr(sel.subdims)) {
    const [dimKey, id] = splitDimId(sv);
    const column = FACET_TO_COLUMN[dimKey];
    const codes = column && FACET_SUBDIM_CODES[dimKey] && FACET_SUBDIM_CODES[dimKey].get(id);
    if (codes && codes.length) pushTerm(column, codes);
  }
  return { clauses, params, needsJoin: clauses.length > 0 };
}
```

Then replace the body of `facetFilterConditions` so it delegates (keeping its signature/behaviour):

```js
function facetFilterConditions(selections, startIndex) {
  return facetSelectionClauses({ codes: selections }, startIndex);
}
```

Add `facetSelectionClauses` to `module.exports`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test test/analysis.test.js`
Expected: PASS — new tests green AND the two pre-existing `facetFilterConditions` tests still pass (codes → single `@>` clauses).

- [ ] **Step 5: Full suite + commit**

Run: `cd backend && npm test` → all green.

```bash
git add backend/services/analysis.js backend/test/analysis.test.js
git commit -m "feat(B3): facetSelectionClauses — group/sub-dimension OR-terms ANDed with code terms"
```

---

### Task 2: Backend — wire groups/subdims into `buildWhere` + `date_added` sort

**Files:**
- Modify: `backend/services/browseFilters.js` (the `analysis` facet block in `buildWhere`)
- Modify: `backend/routes/spotify.js` (the `/search` `orderBy` switch)

**Interfaces:**
- Consumes: `analysis.facetSelectionClauses`.
- Produces: `/search` and `/browse-facets` accept `facet_groups`/`facet_subdims` (repeatable `"<dimKey>:<id>"`) alongside the existing per-dimension code params; `/search` accepts `sort_by=date_added`.

- [ ] **Step 1: Update the analysis block in `buildWhere`**

In `backend/services/browseFilters.js`, replace the `if (inc('analysis')) { … }` block with:

```js
  if (inc('analysis')) {
    const sel = {
      codes: {
        themes: filters.themes, targets: filters.targets, actions: filters.actions,
        tactics: filters.tactics, moral_frames: filters.moral_frames,
      },
      groups: filters.facet_groups,
      subdims: filters.facet_subdims,
    };
    const f = analysis.facetSelectionClauses(sel, idx);
    if (f.needsJoin) { where.push(...f.clauses); params.push(...f.params); idx += f.params.length; joins.analysis = true; }
  }
```

- [ ] **Step 2: Add the `date_added` sort case**

In `backend/routes/spotify.js`, in the `/search` `orderBy` switch, add before `default`:

```js
      case 'date_added':
        orderBy = 'ORDER BY s.playlist_added_at DESC NULLS LAST, s.title ASC';
        break;
```

- [ ] **Step 3: Live-verify group filtering + date sort**

```bash
cd backend && PORT=5057 node server.js > /tmp/r3.log 2>&1 & SRV=$!
sleep 2.5
s='http://localhost:5057/api/spotify/search'
tot(){ curl -s "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(process.argv[1],JSON.parse(d).pagination.total))" "$2"; }
tot "$s?themes=killing&limit=1" "code killing......"
tot "$s?facet_groups=themes:violence&limit=1" "group violence...."
tot "$s?facet_subdims=themes:cruelty_suffering&limit=1" "subdim cruelty...."
tot "$s?facet_groups=themes:violence&targets=cows&limit=1" "violence AND cows."
# group violence >= code killing (OR of killing/brutality/systemic_violence); subdim >= group
# date sort: first row's playlist_added_at should be the max
curl -s "$s?sort_by=date_added&limit=3" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d).songs;console.log('date_added top3 titles:',s.map(x=>x.title).join(' | '))})"
kill $SRV; echo killed
```

Expected: `code killing` ~358; `group violence` **≥** killing (OR of killing/brutality/systemic_violence); `subdim cruelty` **≥** group violence; `violence AND cows` **≤** both group-violence and the cows count (AND narrows); `date_added` returns 3 titles with no SQL error.

- [ ] **Step 4: Backend suite**

Run: `cd backend && npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add backend/services/browseFilters.js backend/routes/spotify.js
git commit -m "feat(B3): buildWhere consumes facet groups/subdims; /search date_added sort"
```

---

### Task 3: Frontend — `ThemeFacetTree` three-level checkbox rows (+ alignment fix)

**Files:**
- Modify (full rewrite): `frontend/src/components/ThemeFacetTree.jsx`
- Modify: `frontend/src/styles/components.css` (facet row indentation; remove dead label rules)

**Interfaces:**
- Consumes (props): `facets`, `selected` (code arrays per dim), `onToggle(dimKey, code, checked)`, `codedCount`, and NEW: `selectedGroups` (`["<dimKey>:<id>"]`), `selectedSubdims` (same), `onToggleGroup(dimKey, groupId, checked)`, `onToggleSubdim(dimKey, subId, checked)`.
- Produces: sub-dimension, group, and code are each a `.filter-option` checkbox row (uniform flex markup — this fixes the alignment bug). Ancestor-covers-descendants: a checked sub-dimension renders its groups+codes checked+disabled; a checked group renders its codes checked+disabled.

- [ ] **Step 1: Replace the component**

Replace `frontend/src/components/ThemeFacetTree.jsx` with:

```jsx
import { useState } from 'react';
import { subDimensionColor } from '../styles/subDimensionPalette';

const DIM_ORDER = ['themes', 'targets', 'actions', 'tactics', 'moral_frames'];
const keyOf = (dimKey, id) => `${dimKey}:${id}`;

// Hierarchical analysis facet tree. Every level below the dimension is a checkbox row.
// A code = exact term; a group/sub-dimension = OR-term over its codes; all AND together
// (logic lives in the backend). Selecting an ancestor covers (checked+disabled) its descendants.
function ThemeFacetTree({ facets, selected, onToggle, codedCount, selectedGroups = [], selectedSubdims = [], onToggleGroup, onToggleSubdim }) {
  const [open, setOpen] = useState(new Set(['themes']));
  const dims = DIM_ORDER.filter(k => facets && facets[k] && facets[k].sub_dimensions?.length);
  if (dims.length === 0) return null;

  const toggleOpen = (k) => { const n = new Set(open); n.has(k) ? n.delete(k) : n.add(k); setOpen(n); };
  const subSel = (dimKey, id) => selectedSubdims.includes(keyOf(dimKey, id));
  const grpSel = (dimKey, id) => selectedGroups.includes(keyOf(dimKey, id));
  const codeSel = (dimKey, code) => (selected[dimKey] || []).includes(code);

  return (
    <div className="filter-section theme-facet-tree">
      <h3 className="filter-title">Themes &amp; advocacy</h3>
      <p className="filter-note">
        Only songs with lyrics analysis ({codedCount}) are counted here. Pick a group or sub-dimension for any code inside it; picks narrow together.
      </p>

      <div className="filter-options scrollable">
        {dims.map((dimKey) => {
          const dim = facets[dimKey];
          const isOpen = open.has(dimKey);
          return (
            <div key={dimKey} className="facet-dim">
              <button type="button" className="facet-dim-header" aria-expanded={isOpen} onClick={() => toggleOpen(dimKey)}>
                <span>{isOpen ? '▼' : '▶'} {dim.label}</span>
                <span className="filter-count">({dim.count})</span>
              </button>

              {isOpen && dim.sub_dimensions.map((sub) => {
                const hue = subDimensionColor(sub.id);
                const subOn = subSel(dimKey, sub.id);
                const subZero = sub.count === 0 && !subOn;
                return (
                  <div key={sub.id} className="facet-sub" style={{ borderLeftColor: hue }}>
                    <label className={`filter-option facet-subdim ${subZero ? 'is-zero' : ''}`}>
                      <input type="checkbox" checked={subOn} disabled={subZero}
                        onChange={(e) => onToggleSubdim(dimKey, sub.id, e.target.checked)} />
                      <span className="filter-label">
                        <span><span className="facet-dot" style={{ background: hue }} />{sub.label}</span>
                        <span className="filter-count">({sub.count})</span>
                      </span>
                    </label>

                    {sub.groups.map((group) => {
                      const grpOn = grpSel(dimKey, group.id);
                      const grpChecked = grpOn || subOn;      // covered by its sub-dimension
                      const grpZero = group.count === 0 && !grpChecked;
                      return (
                        <div key={group.id} className="facet-group">
                          <label className={`filter-option facet-grouprow ${grpZero ? 'is-zero' : ''}`}>
                            <input type="checkbox" checked={grpChecked} disabled={subOn || grpZero}
                              onChange={(e) => onToggleGroup(dimKey, group.id, e.target.checked)} />
                            <span className="filter-label">
                              <span>{group.label}</span>
                              <span className="filter-count">({group.count})</span>
                            </span>
                          </label>

                          {group.codes.map((c) => {
                            const covered = subOn || grpOn;    // ancestor covers the code
                            const cChecked = codeSel(dimKey, c.code) || covered;
                            const cZero = c.count === 0 && !cChecked;
                            return (
                              <label key={c.code} className={`filter-option facet-code ${cZero ? 'is-zero' : ''}`}>
                                <input type="checkbox" checked={cChecked} disabled={covered || cZero}
                                  onChange={(e) => onToggle(dimKey, c.code, e.target.checked)} />
                                <span className="filter-label">
                                  <span><span className="facet-dot" style={{ background: hue }} />{c.label}</span>
                                  <span className="filter-count">({c.count})</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ThemeFacetTree;
```

- [ ] **Step 2: Facet row CSS (alignment fix)**

In `frontend/src/styles/components.css`, DELETE the two now-unused rules `.facet-sub-label { … }` and `.facet-group-label { … }`. Change `.facet-code { padding-left: var(--space-2); }` and add the sibling indentation rules so all three levels are uniform flex rows with increasing indent:

```css
.facet-subdim { font: var(--text-label); color: var(--text-primary); }
.facet-grouprow { padding-left: var(--space-3); }
.facet-code { padding-left: var(--space-5); }
```

(Keep `.facet-sub` border-left and `.facet-dot` as they are.)

- [ ] **Step 3: Verify**

Run: `cd frontend && npx eslint src/components/ThemeFacetTree.jsx` → 0 errors. `grep -nP "[^\x00-\x7F]" frontend/src/styles/components.css` → no new non-ASCII. (`npm run build` runs after wiring in Task 4.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ThemeFacetTree.jsx frontend/src/styles/components.css
git commit -m "feat(B3): selectable sub-dimension/group/code rows in ThemeFacetTree (+ alignment fix)"
```

---

### Task 4: Frontend — wire facet group/subdim selection + date sort into `SearchAndFilter`

**Files:**
- Modify: `frontend/src/components/SearchAndFilter.jsx`

**Interfaces:**
- Consumes: the new `ThemeFacetTree` props.
- Produces: `filters` gains `facet_groups`/`facet_subdims` arrays; they flow into `getBrowseFacets` + `searchSongs`; selecting an ancestor clears its descendant selections; chips for groups/sub-dimensions; `date_added` sort option.

- [ ] **Step 1: State + params + sort option**

In `frontend/src/components/SearchAndFilter.jsx`:
1. `EMPTY_FILTERS`: add `facet_groups: [], facet_subdims: [],` (keep `sort_by: 'year'`).
2. `buildSearchParams`: after the `DIM_KEYS.forEach(...)` line add:

```jsx
    if (filters.facet_groups.length) p.facet_groups = filters.facet_groups;
    if (filters.facet_subdims.length) p.facet_subdims = filters.facet_subdims;
```

3. Sort `<select>`: add `<option value="date_added">Date added</option>` after the Year option.

- [ ] **Step 2: Resolver helpers + ancestor-clearing handlers**

Add near the other mutation helpers (after `onToggleFacet`):

```jsx
  const findSub = (dimKey, subId) => (facets[dimKey]?.sub_dimensions || []).find(s => s.id === subId);
  const findGroup = (dimKey, groupId) => {
    for (const s of (facets[dimKey]?.sub_dimensions || [])) {
      const g = s.groups.find(x => x.id === groupId);
      if (g) return g;
    }
    return null;
  };

  const onToggleGroup = (dimKey, groupId, checked) => setFilters(prev => {
    const k = `${dimKey}:${groupId}`;
    const facet_groups = checked ? [...prev.facet_groups, k] : prev.facet_groups.filter(v => v !== k);
    let codes = prev[dimKey];
    if (checked) {
      const g = findGroup(dimKey, groupId);
      const ids = g ? g.codes.map(c => c.code) : [];
      codes = prev[dimKey].filter(c => !ids.includes(c)); // ancestor covers -> clear own codes
    }
    return { ...prev, facet_groups, [dimKey]: codes };
  });

  const onToggleSubdim = (dimKey, subId, checked) => setFilters(prev => {
    const k = `${dimKey}:${subId}`;
    const facet_subdims = checked ? [...prev.facet_subdims, k] : prev.facet_subdims.filter(v => v !== k);
    let facet_groups = prev.facet_groups, codes = prev[dimKey];
    if (checked) {
      const s = findSub(dimKey, subId);
      const gKeys = s ? s.groups.map(g => `${dimKey}:${g.id}`) : [];
      const cIds = s ? s.groups.flatMap(g => g.codes.map(c => c.code)) : [];
      facet_groups = prev.facet_groups.filter(v => !gKeys.includes(v));
      codes = prev[dimKey].filter(c => !cIds.includes(c));
    }
    return { ...prev, facet_subdims, facet_groups, [dimKey]: codes };
  });
```

- [ ] **Step 3: Chips for groups/sub-dimensions**

In the `chips` `useMemo`, add label maps and chip entries. After the existing `codeLabelMap` memo, add group/subdim label maps (or inline them in the chips memo):

```jsx
  const facetLabelMaps = useMemo(() => {
    const groups = {}, subdims = {};
    DIM_KEYS.forEach(dim => {
      groups[dim] = {}; subdims[dim] = {};
      (facets[dim]?.sub_dimensions || []).forEach(sub => {
        subdims[dim][sub.id] = sub.label;
        sub.groups.forEach(g => { groups[dim][g.id] = g.label; });
      });
    });
    return { groups, subdims };
  }, [facets]);
```

Inside the `chips` memo, before the `DIM_KEYS.forEach(...)` code-chip loop, add:

```jsx
    filters.facet_subdims.forEach(v => {
      const [dk, id] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
      list.push({ key: `subdim:${v}`, label: facetLabelMaps.subdims[dk]?.[id] || id });
    });
    filters.facet_groups.forEach(v => {
      const [dk, id] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
      list.push({ key: `group:${v}`, label: facetLabelMaps.groups[dk]?.[id] || id });
    });
```

Add `facetLabelMaps` to the `chips` memo dependency array.

- [ ] **Step 4: `removeChip` for groups/sub-dimensions**

In `removeChip`, before the `if (DIM_KEYS.includes(type))` line, add:

```jsx
    if (type === 'subdim') {
      const [dk, id] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
      return onToggleSubdim(dk, id, false);
    }
    if (type === 'group') {
      const [dk, id] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
      return onToggleGroup(dk, id, false);
    }
```

- [ ] **Step 5: Pass the new props to `ThemeFacetTree`**

Update the `<ThemeFacetTree ... />` usage (inside `filterGroups`) to add:

```jsx
              <ThemeFacetTree
                facets={facets}
                selected={filters}
                onToggle={onToggleFacet}
                codedCount={filterOptions.availability?.has_analysis || 0}
                selectedGroups={filters.facet_groups}
                selectedSubdims={filters.facet_subdims}
                onToggleGroup={onToggleGroup}
                onToggleSubdim={onToggleSubdim}
              />
```

- [ ] **Step 6: Verify**

Run: `cd frontend && npm run build && npx eslint src/` → build clean; 0 errors (pre-existing warnings OK).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/SearchAndFilter.jsx
git commit -m "feat(B3): wire facet group/subdim selection + chips + date-added sort into SearchAndFilter"
```

---

### Task 5: Full smoke + verification

**Files:** none.

- [ ] **Step 1: Backend suite** — `cd backend && npm test` → all green.
- [ ] **Step 2: Frontend** — `cd frontend && npm run build && npx eslint src/` → build clean, 0 errors.
- [ ] **Step 3: Live smoke** — fresh backend on :5000 + `npm run dev`; on the Browse page confirm:
  - Theme rows are all **left-aligned** at every level (Moral Frames closed AND expanded — the reported bug is gone).
  - Ticking a **group** (e.g. Violence) returns songs having ANY of its codes; its child code rows show checked+disabled; a **group chip** appears; ✕ removes it.
  - Ticking a **sub-dimension** covers its groups+codes (checked+disabled) and adds a sub-dimension chip.
  - A **group + a code in another dimension** ANDs (fewer results than either alone).
  - Dynamic exclude-self counts still update as you filter; zero-count rows grey out.
  - **Sort by → Date added** orders newest-added first (recent playlist additions on top).
  - Unfiltered counts unchanged (genre sum ~1,003; killing 358).
- [ ] **Step 4: Stop the smoke servers** (kill the specific PIDs — never `taskkill /F /IM node.exe`).

---

## Self-Review

**Spec coverage:** §1 selection model → Tasks 1,3,4; §2 backend AND-of-terms + wire format → Tasks 1,2; §3 alignment fix → Task 3 (uniform rows); §4 date sort → Tasks 2 (backend),4 (option). ✔

**Type consistency:** `facetSelectionClauses({codes,groups,subdims}, idx)` defined in Task 1, called in Task 2; wire params `facet_groups`/`facet_subdims` (values `"<dimKey>:<id>"`) produced in Task 4, parsed in Task 2's `buildWhere` and Task 1's builder; `ThemeFacetTree` new props (`selectedGroups`/`selectedSubdims`/`onToggleGroup`/`onToggleSubdim`) defined in Task 3, supplied in Task 4; chip keys `subdim:<dimKey>:<id>` / `group:<dimKey>:<id>` produced and parsed in Task 4. ✔

**Placeholder scan:** none — every step has concrete code/commands.
