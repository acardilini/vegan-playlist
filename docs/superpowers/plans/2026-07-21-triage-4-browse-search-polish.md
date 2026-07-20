# Triage 4 — browse/search polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bidirectional sort (a whitelisted `dir` param + a pure `buildOrderBy`, with a frontend direction toggle that persists in the URL) and make the filter sidebar scroll independently.

**Architecture:** Backend sort logic moves from an inline `switch` in `/search` into a pure, testable `browseFilters.buildOrderBy(sortBy, dir)`. The frontend adds a direction toggle beside the Sort-by select; `dir` rides item 2's URL-state model. The sidebar gets a bounded height + internal scroll via CSS.

**Tech Stack:** Node/Express, PostgreSQL, `node:test`; React/Vite (live-smoke verified).

## Global Constraints

- Restart the backend fresh before smoke (plain `node server.js`, no reload). Temp scripts from the scratchpad.
- `dir` is whitelisted to `asc`/`desc` (anything else → the field's default direction) — never interpolate raw `dir` into SQL.
- Keep backend/frontend sort defaults in sync: `title`/`artist` → asc, `year`/`date_added` → desc.
- Frontend has no test runner — `buildOrderBy` is backend (has `node:test`); the frontend is live-smoke verified. Commit with `git commit -F <scratchpad-file>`. Branch: `session-triage-4-browse-polish` (spec committed there).

---

### Task 1: `buildOrderBy` helper + `/search` wiring (TDD)

**Files:**
- Create: `backend/test/browseFilters.test.js`
- Modify: `backend/services/browseFilters.js` (add `buildOrderBy`, export it)
- Modify: `backend/routes/spotify.js:291-317` (replace the inline switch)

**Interfaces:**
- Produces: `browse.buildOrderBy(sortBy: string, dir?: string) → string` (an `ORDER BY …` clause).

- [ ] **Step 1: Write the failing test**

Create `backend/test/browseFilters.test.js` (pure — no DB, no fixtures):

```js
const { test } = require('node:test');
const assert = require('node:assert');
const browse = require('../services/browseFilters');

test('buildOrderBy: field defaults', () => {
  assert.equal(browse.buildOrderBy('title'), 'ORDER BY s.title ASC');
  assert.equal(browse.buildOrderBy('artist'), 'ORDER BY MIN(a.name) ASC, s.title ASC');
  assert.equal(browse.buildOrderBy('year'), 'ORDER BY al.release_date DESC NULLS LAST, s.title ASC');
  assert.equal(browse.buildOrderBy('date_added'),
    'ORDER BY COALESCE(s.playlist_added_at, s.date_added) DESC NULLS LAST, s.title ASC');
});

test('buildOrderBy: explicit direction flips the primary column', () => {
  assert.equal(browse.buildOrderBy('title', 'desc'), 'ORDER BY s.title DESC');
  assert.equal(browse.buildOrderBy('year', 'asc'), 'ORDER BY al.release_date ASC NULLS LAST, s.title ASC');
  assert.equal(browse.buildOrderBy('date_added', 'asc'),
    'ORDER BY COALESCE(s.playlist_added_at, s.date_added) ASC NULLS LAST, s.title ASC');
});

test('buildOrderBy: unknown field falls back to popularity; bogus dir → field default', () => {
  assert.equal(browse.buildOrderBy('popularity'), 'ORDER BY s.popularity DESC, s.title ASC');
  assert.equal(browse.buildOrderBy('nonsense'), 'ORDER BY s.popularity DESC, s.title ASC');
  assert.equal(browse.buildOrderBy('title', 'sideways'), 'ORDER BY s.title ASC');
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd backend && npx node --test test/browseFilters.test.js`
Expected: FAIL — `browse.buildOrderBy is not a function`.

- [ ] **Step 3: Implement `buildOrderBy` + export**

In `backend/services/browseFilters.js`, add above `module.exports`:

```js
const SORT_COLUMNS = {
  title:      { expr: 's.title',                                    def: 'ASC',  nulls: '' },
  artist:     { expr: 'MIN(a.name)',                                def: 'ASC',  nulls: '' },
  year:       { expr: 'al.release_date',                            def: 'DESC', nulls: ' NULLS LAST' },
  date_added: { expr: 'COALESCE(s.playlist_added_at, s.date_added)', def: 'DESC', nulls: ' NULLS LAST' },
};

// Pure ORDER BY builder. `dir` is whitelisted to asc/desc; anything else uses the
// field default. Unknown fields fall back to the popularity default.
function buildOrderBy(sortBy, dir) {
  const col = SORT_COLUMNS[sortBy];
  if (!col) return 'ORDER BY s.popularity DESC, s.title ASC';
  const d = dir === 'asc' ? 'ASC' : dir === 'desc' ? 'DESC' : col.def;
  const tiebreak = sortBy === 'title' ? '' : ', s.title ASC';
  return `ORDER BY ${col.expr} ${d}${col.nulls}${tiebreak}`;
}
```

Update the export line to add `buildOrderBy`:

```js
module.exports = { buildWhere, joinSql, buildOrderBy };
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `cd backend && npx node --test test/browseFilters.test.js`
Expected: PASS (3 tests). If the process hangs (a transitive DB pool opened at require-time), it means a dependency connects on load — in that case add `const pool = require('../database/db'); test.after(() => pool.end());`, but first confirm it's needed.

- [ ] **Step 5: Wire `/search` to use it**

In `backend/routes/spotify.js`, replace the whole sort block (the `let orderBy = 'ORDER BY s.popularity DESC, s.title';` line through the closing `}` of the `switch (sort_by) { … }`, ~lines 291-317) with:

```js
    // Sorting (whitelisted field + direction; see services/browseFilters.buildOrderBy)
    const orderBy = browse.buildOrderBy(sort_by, req.query.dir);
```

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all pass (89 prior + 3 new = 92).

- [ ] **Step 7: Commit**

```bash
git add backend/services/browseFilters.js backend/routes/spotify.js backend/test/browseFilters.test.js
git commit -F <scratchpad-msg>   # "feat(triage-4): pure buildOrderBy + bidirectional dir in /search"
```

---

### Task 2: Frontend direction toggle + URL `dir` key

**Files:**
- Modify: `frontend/src/utils/browseUrlState.js` (`EMPTY_FILTERS`, `STRING_KEYS`)
- Modify: `frontend/src/components/SearchAndFilter.jsx` (constants, toggle, `buildSearchParams`, select reset)
- Modify: `frontend/src/styles/components.css` (toggle style)

**Interfaces:**
- Consumes: `browse.buildOrderBy` honoring `dir` (Task 1).

- [ ] **Step 1: Persist `dir` in URL state**

In `browseUrlState.js`, add `dir: ''` to `EMPTY_FILTERS` (next to `sort_by: 'year'`):

```js
  facet_groups: [], facet_subdims: [],
  sort_by: 'year', dir: '',
};
```

Add `'dir'` to `STRING_KEYS`:

```js
const STRING_KEYS = ['year_from', 'year_to', 'dir'];
```

(Defaults are already omitted from the URL, so `dir=''` won't appear.)

- [ ] **Step 2: Add sort-direction constants**

In `SearchAndFilter.jsx`, near the top (after `DIM_KEYS`):

```js
const DEFAULT_DIR = { title: 'asc', artist: 'asc', year: 'desc', date_added: 'desc' };
const DIR_LABELS = {
  title:      { asc: 'A–Z', desc: 'Z–A' },
  artist:     { asc: 'A–Z', desc: 'Z–A' },
  year:       { asc: 'Oldest', desc: 'Newest' },
  date_added: { asc: 'Oldest', desc: 'Newest' },
};
```

- [ ] **Step 3: Send `dir` in the API params**

In `buildSearchParams` (after the `sort_by` line, ~line 49), add:

```js
    if (filters.dir) p.dir = filters.dir;
```

- [ ] **Step 4: Render the toggle + reset on field change**

Replace the `sort-container` block (~lines 350-358) with:

```jsx
          <div className="sort-container">
            <label>Sort by:</label>
            <select value={filters.sort_by}
              onChange={(e) => setFilters(prev => ({ ...prev, sort_by: e.target.value, dir: '' }))}>
              <option value="title">Title</option>
              <option value="artist">Artist</option>
              <option value="year">Year</option>
              <option value="date_added">Date added</option>
            </select>
            {(() => {
              const eff = filters.dir || DEFAULT_DIR[filters.sort_by] || 'asc';
              const label = (DIR_LABELS[filters.sort_by] || {})[eff] || (eff === 'asc' ? 'Asc' : 'Desc');
              return (
                <button type="button" className="sort-dir-toggle"
                  onClick={() => setScalar('dir', eff === 'asc' ? 'desc' : 'asc')}
                  title={`Sorted ${label} — click to reverse`}
                  aria-label={`Sort direction: ${label}. Click to reverse.`}>
                  {label} <span aria-hidden="true">{eff === 'asc' ? '↑' : '↓'}</span>
                </button>
              );
            })()}
          </div>
```

- [ ] **Step 5: Style the toggle**

In `components.css`, near the `.sort-container` rule (search for `.sort-container`), add:

```css
.sort-dir-toggle {
  background: var(--bg-surface); color: var(--text-primary);
  border: 1px solid var(--border-hairline); border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-3); cursor: pointer; white-space: nowrap;
  font: inherit;
}
.sort-dir-toggle:hover { border-color: var(--accent-ember); }
```

(If `.sort-container` isn't in `components.css`, add these rules anyway — they're self-contained.)

- [ ] **Step 6: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/browseUrlState.js frontend/src/components/SearchAndFilter.jsx frontend/src/styles/components.css
git commit -F <scratchpad-msg>   # "feat(triage-4): sort direction toggle + dir persisted in URL"
```

---

### Task 3: Independent sidebar scroll

**Files:**
- Modify: `frontend/src/styles/components.css:2272-2274` (`.browse-sidebar`)

- [ ] **Step 1: Bound the sidebar height + internal scroll**

In the desktop `.browse-sidebar` rule (the one with `position: sticky; top: var(--space-4);`), add two declarations:

```css
.browse-sidebar { display: flex; flex-direction: column; gap: var(--space-5);
  background: var(--bg-surface); border: 1px solid var(--border-hairline);
  border-radius: var(--radius-md); padding: var(--space-4); position: sticky; top: var(--space-4);
  max-height: calc(100vh - var(--space-4) * 2); overflow-y: auto; }
```

(Do NOT touch the `@media (max-width: 900px)` `.browse-sidebar` drawer rule — it already sets its own `overflow-y: auto`.)

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/styles/components.css
git commit -F <scratchpad-msg>   # "fix(triage-4): browse sidebar scrolls independently"
```

---

### Task 4: Live smoke

**Files:** none. Backend restarted fresh; frontend running.

- [ ] **Step 1: Bidirectional sort via API**

Run (backend on :5000 or a temp :5001):
```
curl -s "http://localhost:5000/api/spotify/search?limit=3&sort_by=title&dir=asc" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('asc',JSON.parse(d).songs.map(s=>s.title)))"
curl -s "http://localhost:5000/api/spotify/search?limit=3&sort_by=title&dir=desc" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('desc',JSON.parse(d).songs.map(s=>s.title)))"
```
Expected: the two title lists are reverse-ordered (A-first vs Z-first).

- [ ] **Step 2: Frontend toggle + URL (headless)**

Drive the homepage: Sort by Title → click the direction toggle → the result order reverses and the URL gains `dir=desc`; toggle again → `dir` drops. Change the field to Year → the toggle resets to "Newest" (no `dir` in URL). Assert via a puppeteer script (selectors: `.sort-container select`, `.sort-dir-toggle`, `.song-card`).

- [ ] **Step 3: Sidebar scroll (headless)**

On the homepage, assert `getComputedStyle('.browse-sidebar').overflowY === 'auto'` and that its `scrollHeight`/`clientHeight` allow independent scroll (or simply that `clientHeight <= round(viewport)`).

- [ ] **Step 4: Persistence** — the chosen direction survives a song → Back and a fresh load of the shared URL (item-2 model). Record the smoke result.

---

### Task 5: Docs + finish

**Files:** `docs/PROJECT_STATE.md`, `docs/PROJECT_PLAN.md`, `docs/CURATOR_TRIAGE_BACKLOG.md`

- [ ] **Step 1: PROJECT_STATE.md** — Decision Log entry (2026-07-21): bidirectional sort via `dir` + pure `buildOrderBy` (dead audio-feature sorts dropped), toggle with contextual labels + field-change reset, `dir` in the URL model; sidebar bounded-height internal scroll. Advance Current/Next session, Changelog, reprioritised-order (item 4 done).
- [ ] **Step 2: CURATOR_TRIAGE_BACKLOG.md** — move the "sidebar won't scroll" and "bidirectional sort" bullets to ✅ Resolved.
- [ ] **Step 3: PROJECT_PLAN.md** — mark item 4 done.
- [ ] **Step 4: Commit docs**, then invoke `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:** bidirectional sort (`buildOrderBy` + `/search`) → Task 1; frontend toggle + `dir` URL persistence → Task 2; sidebar scroll → Task 3; backend test → Task 1; drop dead audio-feature sorts → Task 1 Step 5 (switch removed). ✓

**Placeholder scan:** No TBD/TODO; every code step shows the exact edit; `<scratchpad-msg>` is the executor's commit-message file. ✓

**Type consistency:** `buildOrderBy(sortBy, dir)` returns a string, consumed in `/search` and asserted in the test with those exact expected strings. Frontend `DEFAULT_DIR`/`DIR_LABELS` keys match the four `<option>` values and the backend `SORT_COLUMNS` keys; `filters.dir` added to `EMPTY_FILTERS` + `STRING_KEYS` + `buildSearchParams`, all consistent. ✓
