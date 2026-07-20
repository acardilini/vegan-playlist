# Triage 2 — persist browse state in the URL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the homepage browse's filters, sort, search text, and results page survive navigation and be shareable, by encoding browse state in the URL query string.

**Architecture:** URL query params are the single source of truth (react-router v7 `useSearchParams`). A new pure module `browseUrlState.js` serializes/deserializes the `filters` shape. `SearchAndFilter` hydrates from the URL on mount and mirrors state → URL on change (`replace`); `SearchSection` persists the page number via a disjoint `page` key. The browse subtree unmounts on navigation and remounts on return, so restoration needs no continuous two-way syncing.

**Tech Stack:** React 18, react-router-dom v7, Vite. No frontend test runner (live-smoke verification, per project pattern).

## Global Constraints

- **Frontend has no test runner** — do NOT add Vitest/Jest (curator-confirmed live-smoke-only). The pure module is verified with a throwaway Node script; integration is verified by live browser smoke.
- Scope is **HomePage browse only**: `SearchAndFilter.jsx`, `HomePage.jsx`, new `utils/browseUrlState.js`. Do NOT touch `ArtistSearchAndFilter.jsx`, `SearchResults.jsx`, or any admin component.
- Preserve all existing filter behaviour and mutation helpers — this task changes *where state lives*, not *how filters work*.
- Restart the backend fresh before smoke (launcher runs plain `node server.js`, no reload). Run temp scripts from the scratchpad, not `backend/`.
- Commit messages end with the required co-author + session trailer. Use `git commit -F <scratchpad-file>` (PowerShell here-string hazard). Branch: `session-triage-2-browse-state` (spec already committed there).

---

### Task 1: Pure `browseUrlState` module

**Files:**
- Create: `frontend/src/utils/browseUrlState.js`
- Verify: `<scratchpad>/verify_browseurl.mjs` (throwaway)

**Interfaces:**
- Produces:
  - `EMPTY_FILTERS` — the default filters object (moved here from `SearchAndFilter.jsx`).
  - `readFilterState(searchParams: URLSearchParams) → { searchQuery: string, filters: object }`
  - `applyFilterState(prevParams: URLSearchParams, { searchQuery, filters }) → URLSearchParams`

- [ ] **Step 1: Write the module**

Create `frontend/src/utils/browseUrlState.js`:

```js
// Serialize/deserialize homepage browse state to/from the URL query string.
// Pure (no React). The URL is the single source of truth for browse state.

export const EMPTY_FILTERS = {
  genres: [], parent_genres: [],
  year_from: '', year_to: '',
  lengths: [],
  has_youtube: false, has_analysis: false, on_spotify: false,
  languages: [],
  themes: [], targets: [], actions: [], tactics: [], moral_frames: [],
  facet_groups: [], facet_subdims: [],
  sort_by: 'year',
};

const ARRAY_KEYS = [
  'genres', 'parent_genres', 'lengths', 'languages',
  'themes', 'targets', 'actions', 'tactics', 'moral_frames',
  'facet_groups', 'facet_subdims',
];
const STRING_KEYS = ['year_from', 'year_to'];
const BOOL_KEYS = ['has_youtube', 'has_analysis', 'on_spotify'];
const DEFAULT_SORT = 'year';

// URL -> { searchQuery, filters }. Absent keys fall back to EMPTY_FILTERS defaults.
export function readFilterState(searchParams) {
  const filters = structuredClone(EMPTY_FILTERS);
  for (const k of ARRAY_KEYS) {
    const v = searchParams.getAll(k);
    if (v.length) filters[k] = v;
  }
  for (const k of STRING_KEYS) {
    const v = searchParams.get(k);
    if (v) filters[k] = v;
  }
  for (const k of BOOL_KEYS) {
    if (searchParams.get(k) === 'true') filters[k] = true;
  }
  const sb = searchParams.get('sort_by');
  if (sb) filters.sort_by = sb;
  return { searchQuery: searchParams.get('q') || '', filters };
}

// { searchQuery, filters } -> URLSearchParams, cloned from prev so non-owned keys
// (e.g. page) are preserved. Defaults are omitted, not written.
export function applyFilterState(prevParams, { searchQuery, filters }) {
  const p = new URLSearchParams(prevParams);
  p.delete('q');
  if (searchQuery) p.set('q', searchQuery);
  for (const k of ARRAY_KEYS) {
    p.delete(k);
    (filters[k] || []).forEach(v => p.append(k, v));
  }
  for (const k of STRING_KEYS) {
    p.delete(k);
    if (filters[k]) p.set(k, filters[k]);
  }
  for (const k of BOOL_KEYS) {
    p.delete(k);
    if (filters[k]) p.set(k, 'true');
  }
  p.delete('sort_by');
  if (filters.sort_by && filters.sort_by !== DEFAULT_SORT) p.set('sort_by', filters.sort_by);
  return p;
}
```

- [ ] **Step 2: Write a throwaway round-trip check**

Create `<scratchpad>/verify_browseurl.mjs` (adjust the import path to the repo):

```js
import assert from 'node:assert';
import { EMPTY_FILTERS, readFilterState, applyFilterState }
  from 'file:///C:/Users/Owner/Documents/AI Applications/vegan-playlist/frontend/src/utils/browseUrlState.js';

// 1. Empty state -> empty URL (all defaults omitted)
const empty = applyFilterState(new URLSearchParams(), { searchQuery: '', filters: EMPTY_FILTERS });
assert.equal(empty.toString(), '', 'clean browse serializes to empty query');

// 2. Round-trip a populated state
const filters = structuredClone(EMPTY_FILTERS);
filters.genres = ['punk', 'metal'];
filters.parent_genres = ['rock'];
filters.themes = ['killing'];
filters.has_analysis = true;
filters.year_from = '1990';
filters.sort_by = 'date_added';
const url = applyFilterState(new URLSearchParams(), { searchQuery: 'cows', filters });
const back = readFilterState(url);
assert.equal(back.searchQuery, 'cows');
assert.deepEqual(back.filters.genres, ['punk', 'metal']);
assert.deepEqual(back.filters.parent_genres, ['rock']);
assert.deepEqual(back.filters.themes, ['killing']);
assert.equal(back.filters.has_analysis, true);
assert.equal(back.filters.year_from, '1990');
assert.equal(back.filters.sort_by, 'date_added');

// 3. default sort omitted; unrelated key (page) preserved
const withPage = new URLSearchParams('page=3');
const applied = applyFilterState(withPage, { searchQuery: '', filters: EMPTY_FILTERS });
assert.equal(applied.get('page'), '3', 'page preserved');
assert.equal(applied.get('sort_by'), null, 'default sort omitted');

console.log('browseUrlState round-trip OK');
```

- [ ] **Step 3: Run the check — verify it passes**

Run: `node "<scratchpad>/verify_browseurl.mjs"`
Expected: `browseUrlState round-trip OK` (no assertion errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/browseUrlState.js
git commit -F <scratchpad-msg>   # "feat(triage-2): browseUrlState serialize/deserialize helper"
```

---

### Task 2: Hydrate + mirror in `SearchAndFilter`

**Files:**
- Modify: `frontend/src/components/SearchAndFilter.jsx`

**Interfaces:**
- Consumes: `readFilterState`, `applyFilterState`, `EMPTY_FILTERS` from Task 1; `useSearchParams` from `react-router-dom`.
- Produces: browse filter/query/sort state mirrored to the URL; unchanged `onResults`/`onLoading`/`onError`/`onPageReset` contract with the parent.

- [ ] **Step 1: Replace the local `EMPTY_FILTERS` and imports**

At the top of `SearchAndFilter.jsx`, remove the local `EMPTY_FILTERS` constant (lines ~9–18) and add imports:

```js
import { useSearchParams } from 'react-router-dom';
import { readFilterState, applyFilterState, EMPTY_FILTERS } from '../utils/browseUrlState';
```

(`DIM_KEYS` stays.)

- [ ] **Step 2: Seed state from the URL**

Replace the `searchQuery` / `filters` state declarations (lines ~21–22):

```js
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => readFilterState(searchParams).searchQuery || initialQuery);
  const [filters, setFilters] = useState(() => readFilterState(searchParams).filters);
```

Keep the existing `initialQuery` sync effect (it handles same-route nav-search `?q=` changes, which don't remount HomePage):

```js
  useEffect(() => {
    if (initialQuery && initialQuery !== searchQuery) setSearchQuery(initialQuery);
  }, [initialQuery]);
```

- [ ] **Step 3: Mirror state → URL (debounced, replace)**

Add a new effect after the existing debounced search effect (after line ~68):

```js
  // Mirror browse state into the URL (single source of truth for restore + sharing).
  // Functional updater + applyFilterState clone => the page writer's `page` key is preserved.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchParams(prev => applyFilterState(prev, { searchQuery, filters }), { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, filters, setSearchParams]);
```

Leave `buildSearchParams`, `performSearch`, the search effect, the facets effect, the `onPageReset` effect, and every mutation helper unchanged.

- [ ] **Step 4: Verify (deferred to Task 4 live smoke)**

No unit test (React component, no runner). Behaviour is exercised end-to-end in Task 4. Sanity now: `cd frontend && npm run build` succeeds (no import/syntax errors).
Run: `cd frontend && npm run build`
Expected: build completes without errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SearchAndFilter.jsx
git commit -F <scratchpad-msg>   # "feat(triage-2): SearchAndFilter hydrates + mirrors browse state to URL"
```

---

### Task 3: Persist the results page in `HomePage`

**Files:**
- Modify: `frontend/src/pages/HomePage.jsx`

**Interfaces:**
- Consumes: `useSearchParams`.
- Produces: `?page=` persistence; disjoint from Task 2's keys.

- [ ] **Step 1: Import `useSearchParams`**

In `HomePage.jsx`, extend the router import (line 2):

```js
import { useLocation, useSearchParams } from 'react-router-dom';
```

- [ ] **Step 2: URL-back the page state and add a page writer**

In `SearchSection`, replace `const [currentPage, setCurrentPage] = useState(1);` (line ~125) with:

```js
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentPage, setCurrentPage] = useState(() => parseInt(searchParams.get('page'), 10) || 1);

  const changePage = useCallback((page) => {
    setCurrentPage(page);
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (page > 1) p.set('page', String(page)); else p.delete('page');
      return p;
    }, { replace: true });
  }, [setSearchParams]);
```

- [ ] **Step 3: Remove the redundant initial fetch**

Delete the entire `loadInitialSongs` `useEffect` block (lines ~127–151) — `SearchAndFilter`'s own debounced effect performs the initial (URL-hydrated) search; keeping this one would flash unfiltered results. Leave the `loading`/`hasSearched` initial `useState` values as-is (`true`), so "Loading songs…" shows until the first real search resolves.

- [ ] **Step 4: Route page changes through `changePage`**

- In the `<SearchAndFilter>` props, change `onPageReset={() => setCurrentPage(1)}` to `onPageReset={() => changePage(1)}` (so a filter-driven reset also clears `?page=`).
- In `<PaginationControls>`, change `onPageChange={setCurrentPage}` to `onPageChange={changePage}`.

- [ ] **Step 5: Verify build**

Run: `cd frontend && npm run build`
Expected: build completes without errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/HomePage.jsx
git commit -F <scratchpad-msg>   # "feat(triage-2): persist browse results page in the URL"
```

---

### Task 4: Live smoke

**Files:** none. Backend + frontend running (`cd backend && npm run dev`; `cd frontend && npm run dev`; restart backend fresh first).

**Interfaces:** consumes Tasks 1–3.

- [ ] **Step 1: Build a filtered state**

On `/`, apply: one genre, one theme code, one length bucket, an availability toggle; change Sort by to "Date added"; go to page 2.
Expected: the URL fills, e.g. `/?genres=…&themes=…&lengths=…&has_youtube=true&sort_by=date_added&page=2`; results + chips reflect the filters.

- [ ] **Step 2: Navigate away and back**

Click a song → on the song page, click browser Back.
Expected: browse returns with every filter, the sort, the search text, and page 2 restored; the results grid matches.

- [ ] **Step 3: Refresh + share**

Refresh the restored URL → same state renders from a cold load. Copy the URL into a new tab → same filtered/sorted/paged view.
Expected: PASS both.

- [ ] **Step 4: Reset paths**

Click "Clear all" → URL returns to `/`, default unfiltered list shows. Change a filter while on page 2 → `?page=` drops (reset to page 1).
Expected: PASS both.

- [ ] **Step 5: Deep-link query**

Visit `/?q=cows` directly (nav search box or typed URL).
Expected: shows results for "cows" with the search box populated.

- [ ] **Step 6: Record the smoke result** for the End-Session notes.

---

### Task 5: Update project docs (End-Session)

**Files:**
- Modify: `docs/PROJECT_STATE.md` (Current State, Next Tasks, Decision Log, Changelog)
- Modify: `docs/PROJECT_PLAN.md` (mark the triage-2 session state)
- Modify: `docs/CURATOR_TRIAGE_BACKLOG.md` (move "persist sort & filter state" to Resolved)

**Interfaces:** consumes the Task 4 smoke result.

- [ ] **Step 1: PROJECT_STATE.md** — Decision Log entry (2026-07-20): browse state persisted via URL query params (`useSearchParams`), hydrate-on-mount + mirror-on-change with `replace`; pure `browseUrlState` helper; page persisted via a disjoint writer; `SearchSection`'s redundant initial fetch removed; live-smoke-only (no frontend runner); scope HomePage browse only. Advance Current/Next session + add a Changelog line.

- [ ] **Step 2: CURATOR_TRIAGE_BACKLOG.md** — move "Persist sort & filter state across navigation" into ✅ Resolved with a one-line note on the URL-param approach.

- [ ] **Step 3: PROJECT_PLAN.md** — mark triage item 2 done; note item 4 (bidirectional sort) will extend the same URL-state model.

- [ ] **Step 4: Commit the docs**

```bash
git add docs/PROJECT_STATE.md docs/PROJECT_PLAN.md docs/CURATOR_TRIAGE_BACKLOG.md
git commit -F <scratchpad-msg>   # "docs(triage-2): record browse-state URL persistence"
```

---

## Self-Review

**Spec coverage:**
- URL as single source of truth → Task 1 (helper) + Task 2 (wiring). ✓
- Hydrate-on-mount + mirror-on-change (`replace`) → Task 2 Steps 2–3. ✓
- `readFilterState` / `applyFilterState`, defaults omitted, `prev` clone preserves `page` → Task 1 Step 1 + verified Step 2–3. ✓
- Page persistence via disjoint `page` writer → Task 3 Steps 2, 4. ✓
- Remove redundant initial fetch → Task 3 Step 3. ✓
- `parent_genres` persisted explicitly → in `ARRAY_KEYS` (Task 1). ✓
- Existing mutation helpers unchanged → Task 2 Step 3 note. ✓
- Scope (HomePage only; Artists/`/search`/admin untouched) → Global Constraints. ✓
- Live-smoke-only, no runner → Global Constraints + Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows the exact edit. `<scratchpad>` / `<scratchpad-msg>` are explicit path placeholders the executor fills with the session scratchpad dir. ✓

**Type consistency:** `readFilterState` returns `{ searchQuery, filters }` and is consumed that way in Task 2 Step 2. `applyFilterState(prev, { searchQuery, filters })` signature matches its call in Task 2 Step 3. `changePage(page:number)` used consistently in Task 3 Steps 2/4. `EMPTY_FILTERS` exported from Task 1 and imported in Task 2. ✓
