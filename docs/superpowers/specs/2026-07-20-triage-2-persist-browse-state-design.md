# Triage item 2 — persist browse sort/filter state across navigation

_Design spec. 2026-07-20. Curator-approved at brainstorm._
_Backlog: [`CURATOR_TRIAGE_BACKLOG.md`](../../CURATOR_TRIAGE_BACKLOG.md) §"Filter & search"._

## Goal

Stop the homepage browse from resetting when the user navigates away and comes back.
Active filters, sort order, search text, and the current results page must survive
navigation — and be shareable/bookmarkable — by encoding browse state in the URL.

## Problem / root cause

All browse state lives in component `useState` that unmounts on navigation:

- `frontend/src/components/SearchAndFilter.jsx` holds `searchQuery` (string) and a ~15-key
  `filters` object (`genres`, `parent_genres`, `year_from`, `year_to`, `lengths`,
  `has_youtube`, `has_analysis`, `on_spotify`, `languages`, the five theme dimensions
  `themes`/`targets`/`actions`/`tactics`/`moral_frames`, `facet_groups`, `facet_subdims`,
  `sort_by`), seeded from `EMPTY_FILTERS`.
- `frontend/src/pages/HomePage.jsx` (`SearchSection`) holds `currentPage`.

Opening a song (`/song/:id`) unmounts `HomePage` → all state is lost → returning re-seeds
`EMPTY_FILTERS`. `HomePage` already reads `?q=` from the URL on mount (read-only), so there
is a partial precedent for URL-sourced state.

## Approach — URL query params (single source of truth)

Chosen over an app-level context / `sessionStorage` because the curator wants the state
**shareable and bookmarkable** (decision log, 2026-07-20). Enabling facts:

- `react-router-dom` v7 → `useSearchParams` available; `BrowserRouter`; browse is route `/`.
- `spotifyService.searchSongs` already serializes the param object to `URLSearchParams`
  (arrays → repeated keys), so the browse **URL query string ≈ the API query string** — a
  near 1:1 mapping.

**Mechanism: hydrate-on-mount, mirror-on-change.** The browse subtree unmounts on navigation
and remounts on return, so restoration needs no continuous two-way syncing (the usual source
of URL-state loops). On mount, read state from the URL; on change, write state → URL with
`replace` (so filter tweaks don't spam history and the live URL is always copy-able).

## Components

### 1. New pure module `frontend/src/utils/browseUrlState.js`

The isolated, unit-testable unit. No React imports.

- `readFilterState(searchParams) → { searchQuery, filters }`
  Parse a `URLSearchParams` into the existing `filters` shape. Arrays come from repeated
  keys (`getAll`); booleans from `'true'`; everything absent falls back to the `EMPTY_FILTERS`
  default. `sort_by` defaults to `'year'`.
- `applyFilterState(prevParams, { searchQuery, filters }) → URLSearchParams`
  Return a new `URLSearchParams` **cloned from `prevParams`** (preserving keys it doesn't own,
  e.g. `page`), then set/delete the q + `sort_by` + filter keys. **Omit defaults**: empty
  arrays, blank strings, `false` booleans, and `sort_by === 'year'` are removed, not written,
  so a clean browse is just `/`.

`EMPTY_FILTERS` moves into (or is imported by) this module so parse defaults and the component
seed share one definition.

### 2. `SearchAndFilter.jsx`

- Add `const [searchParams, setSearchParams] = useSearchParams();`
- Lazy-init from the URL: `useState(() => readFilterState(searchParams).filters)` and
  `useState(() => readFilterState(searchParams).searchQuery || initialQuery)`.
- In the existing debounced (300 ms) search effect, also mirror to the URL:
  `setSearchParams(prev => applyFilterState(prev, { searchQuery, filters }), { replace: true })`.
- **All existing mutation helpers stay unchanged** (`toggleInArray`, `onToggleParent`,
  `onToggleGroup`, `onToggleSubdim`, chips/`removeChip`, `clearAllFilters`, sort `<select>`).
  They still drive `setFilters`; the URL simply mirrors the result.

### 3. `HomePage.jsx` / `SearchSection` — page persistence

- `currentPage` stays owned by `SearchSection` but becomes URL-backed: seed from
  `+searchParams.get('page') || 1` on mount; on change write **only** the `page` key via the
  functional form `setSearchParams(prev => { const p = new URLSearchParams(prev); …; return p; })`.
  Disjoint from `SearchAndFilter`'s key set → the two writers never clobber each other.
- **Remove `SearchSection`'s `loadInitialSongs` mount-fetch.** With URL hydration it would
  flash unfiltered results before `SearchAndFilter`'s real (hydrated) fetch. `SearchAndFilter`'s
  own debounced effect already performs the initial search.
- The existing `onPageReset` (page → 1 when filters/query change) keeps working and simply
  removes `page` from the URL.
- HomePage's `?q=` → `initialSearchQuery` plumbing becomes vestigial (`SearchAndFilter` reads
  `q` from the URL itself); simplify but keep `initialQuery` as a harmless fallback so a
  `/?q=…` deep link still works if arrived at before hydration.

## URL contract

Keys: `q`, `sort_by`, `page`, and the filter keys listed above (arrays as repeated keys).
Defaults omitted. Example: `/?q=cows&genres=punk&themes=killing&sort_by=date_added&page=2`.
A clean browse is `/`.

## Edge cases

- **Two URL writers (filters vs page).** Safe because each uses the functional
  `setSearchParams(prev => …)` updater and touches a disjoint key set; `applyFilterState`
  clones `prev` so it preserves `page`, and the page writer preserves filter keys.
- **`parent_genres` is UI-derived** (selecting a parent adds its subgenres to `genres`).
  Persist `parent_genres` **explicitly** in the URL alongside `genres` and rehydrate both
  directly — no reconstruction from the async-loaded genre tree needed.
- **Rapid change then immediate song click.** The URL write shares the 300 ms debounce with
  the search; a <300 ms stale window is acceptable (the in-flight search is also mid-debounce).
- **Unknown/removed filter values in a shared URL** (e.g. a code later retired) parse into the
  arrays harmlessly; the backend ignores non-matching filters and the chips fall back to the
  raw value label (existing behaviour).

## Scope

- **In:** HomePage browse — `SearchAndFilter.jsx`, `HomePage.jsx` (`SearchSection`), new
  `utils/browseUrlState.js`.
- **Out:** `ArtistSearchAndFilter.jsx` (separate component + its own deferred hierarchy), the
  `/search` route (`SearchResults.jsx`), all admin. Scroll-position restoration is out (curator
  chose page-level restore, lands at top of results).

## Testing

Consistent with the project's frontend history (no test runner exists; Phase 3 / B2 / B3 were
all live-smoke verified — curator confirmed live-smoke-only for this task). `browseUrlState.js`
is a pure module, trivially unit-testable if a frontend runner is added later.

Live smoke (backend + frontend running; restart backend fresh — plain `node server.js`, no reload):
1. Apply several filters (a genre, a theme code, a length, an availability toggle) + change sort
   + go to page 2. Confirm the URL fills with the corresponding params.
2. Open a song, hit browser Back → filters, sort, search, and page all restored; results match.
3. Refresh the restored URL → same state renders from scratch.
4. Copy the URL into a new tab → same filtered/sorted/paged view (shareable).
5. "Clear all" → URL returns to `/`; results show the default unfiltered list.
6. A `/?q=term` deep link still shows the searched results.

## Out of scope / deferred

- Scroll-position restoration (page-level restore only).
- A frontend test runner (Vitest) — noted as a good future first test for `browseUrlState`.
- Applying the same URL-state pattern to the Artists browse and the `/search` page.
