# Triage item 4 — browse/search polish (bidirectional sort + sidebar scroll)

_Design spec. 2026-07-21. Curator-approved at brainstorm (recommendations 1–5 accepted)._
_Backlog: [`CURATOR_TRIAGE_BACKLOG.md`](../../CURATOR_TRIAGE_BACKLOG.md) §"Filter & search"._

## Goal

Two homepage-browse quality-of-life fixes: let each sort run in **both directions**, and let the
**filter sidebar scroll independently** so a tall filter stack is fully reachable.

## Problem / current behaviour

- **Sort is single-direction.** `GET /api/spotify/search` maps `sort_by` to a fixed-direction
  `ORDER BY` via an inline `switch` (`routes/spotify.js:292-317`): `title`→`ASC`, `artist`→
  `MIN(a.name) ASC`, `year`→`release_date DESC`, `date_added`→`COALESCE(...) DESC` (+ `s.title ASC`
  tiebreak). The frontend `<select>` (`SearchAndFilter.jsx:350-358`) offers Title / Artist / Year /
  Date added, one direction each. No `dir`/`order` param exists anywhere (verified by grep).
- **Sidebar can't scroll independently.** `.browse-sidebar` is `position: sticky; top: space-4`
  with **no `max-height`/`overflow`** (`components.css:2272-2274`), so when the filter stack is
  taller than the viewport its bottom is unreachable (it's pinned; page-scroll doesn't move it). The
  `.app-header` is **not** sticky/fixed, so the sidebar can bound its height to the viewport.

## Design

### 1. Bidirectional sort — `dir` param + a pure `buildOrderBy`

**Backend.** Add a pure `buildOrderBy(sortBy, dir)` to `services/browseFilters.js` (already imported
by `/search` as `browse`) and export it. It whitelists the four real sort fields and applies a
whitelisted direction:

```js
const SORT_COLUMNS = {
  title:      { expr: 's.title',                                    def: 'ASC',  nulls: '' },
  artist:     { expr: 'MIN(a.name)',                                def: 'ASC',  nulls: '' },
  year:       { expr: 'al.release_date',                            def: 'DESC', nulls: ' NULLS LAST' },
  date_added: { expr: 'COALESCE(s.playlist_added_at, s.date_added)', def: 'DESC', nulls: ' NULLS LAST' },
};
function buildOrderBy(sortBy, dir) {
  const col = SORT_COLUMNS[sortBy];
  if (!col) return 'ORDER BY s.popularity DESC, s.title ASC'; // fallback (e.g. legacy 'popularity')
  const d = dir === 'asc' ? 'ASC' : dir === 'desc' ? 'DESC' : col.def;
  const tiebreak = sortBy === 'title' ? '' : ', s.title ASC';
  return `ORDER BY ${col.expr} ${d}${col.nulls}${tiebreak}`;
}
```

`/search` replaces its inline `switch` with `const orderBy = browse.buildOrderBy(sort_by, req.query.dir);`.
This also **drops the dead `energy`/`danceability`/`valence` sort cases** (audio features are NULL and
the frontend never offers them) — anything unknown falls back to the popularity default. `dir` is
whitelisted to `asc`/`desc` (any other value → field default), so it is injection-safe.

**Frontend** (`SearchAndFilter.jsx`). Add `dir: ''` to `EMPTY_FILTERS` (`''` = the field's natural
default). Beside the Sort-by `<select>`, add a **direction toggle button**:

- The effective direction = `filters.dir || DEFAULT_DIR[sort_by]`, where
  `DEFAULT_DIR = { title:'asc', artist:'asc', year:'desc', date_added:'desc' }`.
- The button shows a **contextual label** for the effective direction and flips on click
  (`setScalar('dir', effective === 'asc' ? 'desc' : 'asc')`):
  - text fields (`title`/`artist`): `asc` → **"A–Z"**, `desc` → **"Z–A"**
  - date fields (`year`/`date_added`): `asc` → **"Oldest"**, `desc` → **"Newest"**
  - include a small arrow glyph (↑ asc / ↓ desc) and an `aria-label`/`title` spelling it out.
- **Changing the sort field resets `dir` to `''`** (so a new field shows its natural default, not a
  carried-over explicit direction) — handled where the `<select>`'s `onChange` sets `sort_by`.
- `buildSearchParams` sends `dir` only when non-empty.

**URL state** (`browseUrlState.js`). Add `dir` to `STRING_KEYS` so the direction persists across
navigation and is shareable/bookmarkable (consistent with item 2). Default (`''`) is omitted from the
URL.

### 2. Independent sidebar scroll

In `components.css`, extend the desktop `.browse-sidebar` rule so it scrolls internally within the
viewport instead of overflowing unreachably:

```css
.browse-sidebar {
  /* …existing… position: sticky; top: var(--space-4); */
  max-height: calc(100vh - var(--space-4) * 2);
  overflow-y: auto;
}
```

Keeps it sticky (stays visible) **and** independently scrollable. The mobile drawer rule
(`@media (max-width:900px)`) already sets `overflow-y:auto` on the fixed drawer — unchanged.

## Testing

- **Backend `node:test`** — new `test/browseFilters.test.js` for `buildOrderBy` (pure, no DB): each
  field's default; each field asc/desc; the title-no-tiebreak case; unknown field → popularity
  fallback; a bogus `dir` → field default. (No fixture sentinel needed — no DB rows.)
- **Live smoke** (backend restarted; frontend running):
  - Sort by Title, click the direction toggle → results reverse (Z–A) and the URL gains `dir=desc`;
    toggle back → `dir` drops and A–Z returns.
  - Sort by Year → toggle shows "Newest" default; flip → "Oldest" and results reorder.
  - Change the sort field → the toggle resets to the new field's natural default.
  - The direction survives a navigate-away/back and a shared URL (item-2 persistence).
  - The filter sidebar scrolls on its own (tall filter stack fully reachable) while pinned.

## Scope / out of scope

- **In:** `services/browseFilters.js` (+`buildOrderBy`), `routes/spotify.js` (`/search` ORDER BY),
  `SearchAndFilter.jsx` (toggle + `sort_by` reset), `browseUrlState.js` (`dir` key), `components.css`
  (sidebar), `test/browseFilters.test.js`.
- **Out:** the Artists browse (`ArtistSearchAndFilter` has its own separate sort — deferred, as in
  B3); the `/search` route's stray emoji `console.log`; any sort field beyond the existing four.
  Independent of the DB cleaning.
