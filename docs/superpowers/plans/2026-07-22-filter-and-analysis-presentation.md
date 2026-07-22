# Filter Sidebar + Analysis Presentation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every browse-sidebar section a uniform collapsible group with a plain-language
description, replace the sluggish native tooltips with real ones, and stop the song page running so
far down the screen.

**Architecture:** One new `FilterSection` primitive absorbs the four different header patterns the
sidebar currently uses (including `ScalarFacetGroups`' bespoke toggle) and supports nesting, so the
five theme dimensions and seven metadata components become the same visual unit. One new `InfoTip`
replaces the native `title` attribute. Description text is served by the API — component text from
the codebook, dimension text newly added to `taxonomy.json` — so no vocabulary is hardcoded in a
component.

**Tech Stack:** React 18 + Vite (no frontend test runner), Node/Express, PostgreSQL, `node:test`.

**Spec:** [`../specs/2026-07-22-filter-and-analysis-presentation-design.md`](../specs/2026-07-22-filter-and-analysis-presentation-design.md)

## Global Constraints

- **Branch:** build on a **fresh branch off `main`**, created only after BOTH
  `session-triage-4-browse-polish` and `session-triage-1a1b-analysis-tiers` have merged. This plan
  assumes both are in `main`; if `frontend/src/components/ScalarFacetGroups.jsx` does not exist, stop
  — the prerequisite merge has not happened.
- **Do NOT touch `.browse-sidebar`'s scroll rules.** The independent-scroll fix
  (`max-height: calc(100vh - var(--space-4) * 2); overflow-y: auto`) arrives with triage 4. Adding or
  editing it here re-creates a conflict that was just resolved.
- **This is presentation only.** No change to filter semantics, facet counts, URL/sessionStorage
  state, or which songs match. If a change would alter what `/search` returns, it is out of scope.
- **No emoji in UI copy.** The codebook's `short_tag` fields contain emoji and must never be read.
- **Styling uses design-system tokens** (`--space-*`, `--text-*`, `--border-*`, `--bg-*`,
  `--text-primary/secondary`), never raw colours. The one raw dimension permitted is the 700px
  layout breakpoint.
- **Keyboard accessible:** every section header and every tooltip trigger must be reachable by Tab
  and operable by Enter/Space; tooltips dismiss on Escape.
- **A `<button>` defaults to `text-align: center`** — every button styled as a heading must set
  `text-align: left`. This shipped as a real bug once (B3 theme tree).
- **Backend tests:** `cd backend && npm test` (`node --test --test-concurrency=1`), whole suite green
  before each commit. `analysis.test.js` fixtures use the `ZZZANL` sentinel prefix.
- **Frontend gates:** `cd frontend && npm run lint && npm run build`, both clean before each commit.
- **`taxonomy.json` and `master_metadata_codebook.json` are the curator's artifacts.** Task 1 adds
  five `description` keys to `taxonomy.json` with the exact approved wording below; nothing else in
  either file may change.

---

### Task 1: Serve the description text

**Files:**
- Modify: `backend/data/taxonomy.json` (add one `description` key to each of the five
  `hierarchy.<dim>` objects)
- Modify: `backend/services/metadataCodebook.js` (add `componentDescription`)
- Modify: `backend/services/analysis.js` (`facetTree`, `scalarFacets`, `getSongAnalysis`)
- Test: `backend/test/metadataCodebook.test.js`, `backend/test/analysis.test.js`

**Interfaces:**
- Consumes: `metadataCodebook.COMPONENTS`, `analysis.taxonomy`.
- Produces:
  - `metadataCodebook.componentDescription(key): string`
  - `facetTree` dimension objects gain `description: string`
  - `scalarFacets` component objects gain `description: string`
  - `getSongAnalysis` attributes entries gain `component_description: string`, and the returned
    object gains `dimension_descriptions: { themes, targets, actions, tactics, moral_frames }`

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/metadataCodebook.test.js`:

```js
test('componentDescription returns the codebook one-liner, empty for unknown', () => {
  assert.match(cb.componentDescription('perspective'), /narrative voice/i);
  assert.equal(cb.componentDescription('not_a_component'), '');
});
```

Append to `backend/test/analysis.test.js` (before the `after` hook):

```js
test('facetTree carries a description for every dimension', async () => {
  await mkCodedSong();
  const t = await analysis.facetTree(pool);
  for (const dim of ['themes', 'targets', 'actions', 'tactics', 'moral_frames']) {
    if (!t[dim]) continue; // dimension absent from this dataset — nothing to describe
    assert.equal(typeof t[dim].description, 'string');
    assert.ok(t[dim].description.length > 20, `${dim} has a real description`);
  }
});

test('scalarFacets carries a description for every component', async () => {
  const f = await analysis.scalarFacets(pool, {});
  for (const key of Object.keys(f)) {
    assert.ok(f[key].description.length > 20, `${key} has a real description`);
  }
});

test('getSongAnalysis exposes component and dimension descriptions for tooltips', async () => {
  const id = await mkCodedSong();
  const a = await analysis.getSongAnalysis(pool, id);
  const persp = a.attributes.find(x => x.label === 'Perspective');
  assert.ok(persp.component_description.length > 20, 'component description for the label tooltip');
  assert.notEqual(persp.component_description, persp.definition, 'component text differs from the code definition');
  assert.equal(typeof a.dimension_descriptions.themes, 'string');
  assert.ok(a.dimension_descriptions.moral_frames.length > 20);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test`
Expected: FAIL — `cb.componentDescription is not a function`; `description` undefined.

- [ ] **Step 3: Add the five dimension descriptions to `taxonomy.json`**

In `backend/data/taxonomy.json`, each of the five `hierarchy.<dim>` objects currently has `label` and
`sub_dimensions`. Add a `description` key to each, immediately after `label`, with **exactly** this
approved wording:

| `hierarchy` key | `description` value |
|---|---|
| `themes` | `What the song is about at its core — the harm it describes, the indifference it names, and the hope or defiance it reaches for.` |
| `targets` | `Who or what the song is about: particular animals, the industries that use them, and the systems and roles that keep it running.` |
| `actions` | `What the song calls for or depicts being done — from direct intervention and rescue to public advocacy and personal practice.` |
| `tactics` | `How that action is carried out: confrontation and rescue, protest and organising, cultural critique and consumer pressure.` |
| `moral_frames` | `The moral reasoning the song argues from — rights and justice, compassion and duty, systemic critique, or environmental stewardship.` |

The em dashes are intentional. Edit per-hunk with the Edit tool — do NOT rewrite the whole file with
a script (PowerShell 5.1 double-encodes BOM-less UTF-8 and would mojibake the file). Afterwards run
`node -e "require('./backend/data/taxonomy.json')"` to confirm it still parses, and
`grep -nP '[^\x00-\x7F]' backend/data/taxonomy.json | head` to confirm no mojibake was introduced.

- [ ] **Step 4: Add `componentDescription` to `metadataCodebook.js`**

```js
// The codebook's one-line description of a whole component (not of an individual code).
function componentDescription(key) {
  return (codebook[key] && codebook[key].description) || '';
}
```

Add `componentDescription` to `module.exports`.

- [ ] **Step 5: Surface the descriptions in `analysis.js`**

In `facetTree`, the per-dimension result currently reads:

```js
    out[pub] = { label: h.label, count: dimSongs.size, sub_dimensions: subDimensions };
```

Change it to:

```js
    out[pub] = { label: h.label, description: h.description || '', count: dimSongs.size, sub_dimensions: subDimensions };
```

In `scalarFacets`, the per-component result currently reads:

```js
    out[c.key] = {
      key: c.key,
      heading: c.heading,
      multi: c.multi,
      options: codebook.optionsFor(c.key).map(o => ({ ...o, count: counts.get(o.code) || 0 })),
    };
```

Add the description:

```js
    out[c.key] = {
      key: c.key,
      heading: c.heading,
      multi: c.multi,
      description: codebook.componentDescription(c.key),
      options: codebook.optionsFor(c.key).map(o => ({ ...o, count: counts.get(o.code) || 0 })),
    };
```

In `getSongAnalysis`, the attributes push currently reads:

```js
    attributes.push({
      label: c.heading,
      value: codebook.codeLabel(c.key, v),
      definition: codebook.codeDefinition(c.key, v),
    });
```

Add the component description (`definition` stays the *code's* definition — the two are different
tooltips):

```js
    attributes.push({
      label: c.heading,
      value: codebook.codeLabel(c.key, v),
      definition: codebook.codeDefinition(c.key, v),
      component_description: codebook.componentDescription(c.key),
    });
```

And add a dimension-description map to the returned object, beside `attributes`. Build it once at
module scope, next to `PUBLIC_DIMS`:

```js
// Public dimension name -> the curator's one-line description (taxonomy.json hierarchy).
const DIM_DESCRIPTIONS = Object.fromEntries(
  Object.entries(PUBLIC_DIMS).map(([col, pub]) => {
    const h = (taxonomy.hierarchy || {})[DIM_TO_TAXONOMY[col]] || {};
    return [pub, h.description || ''];
  })
);
```

then in the `return { … }` of `getSongAnalysis`, after `attributes,`:

```js
    dimension_descriptions: DIM_DESCRIPTIONS,
```

**Ordering note:** `PUBLIC_DIMS` is declared *after* `getSongAnalysis` in the current file. Place
`DIM_DESCRIPTIONS` immediately after the `PUBLIC_DIMS` declaration — `const` is hoisted to the
module scope and `getSongAnalysis` only reads it at call time, so this is safe.

Export `DIM_DESCRIPTIONS` is **not** required — nothing outside this module needs it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS, whole suite green (4 new tests).

- [ ] **Step 7: Commit**

```bash
git add backend/data/taxonomy.json backend/services/metadataCodebook.js backend/services/analysis.js backend/test
git commit -m "feat(presentation): serve component + dimension descriptions from the API"
```

---

### Task 2: The `FilterSection` primitive

**Files:**
- Create: `frontend/src/components/FilterSection.jsx`
- Modify: `frontend/src/components/ScalarFacetGroups.jsx` (drop its bespoke toggle, use the primitive)
- Modify: `frontend/src/styles/components.css` (add `.filter-section-body` + nested-section rules)

**Interfaces:**
- Consumes: `scalar_facets[key].description` from Task 1.
- Produces: `<FilterSection title count description defaultOpen>{children}</FilterSection>` — `title`
  is a string, `count` a number (badge hidden when 0), `description` an optional string rendered as
  `.filter-note` inside the body, `defaultOpen` a boolean (default `false`).

There is no frontend test runner in this project; this task is verified by lint, build and a live
look.

- [ ] **Step 1: Create the primitive**

`frontend/src/components/FilterSection.jsx`:

```jsx
import { useState } from 'react';

// One collapsible sidebar section. Every filter group uses this so the whole panel behaves
// identically: a header button that toggles, a selected-count badge, and an optional
// description that appears with the body on expand. Nests — a FilterSection inside another
// one's children is how the theme dimensions and metadata components are grouped.
function FilterSection({ title, count = 0, description, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="filter-section">
      <button
        type="button"
        className="filter-title filter-title-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span>{title}{count > 0 && <span className="filter-badge">{count}</span>}</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="filter-section-body">
          {description && <p className="filter-note">{description}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

export default FilterSection;
```

- [ ] **Step 2: Add the CSS**

In `frontend/src/styles/components.css`, immediately after the existing `.filter-title-toggle` rule:

```css
.filter-section-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

/* A nested section (a dimension inside Themes & advocacy, a component inside Lyric
   metadata) reads one step quieter than its parent. */
.filter-section .filter-section-body .filter-section > .filter-title-toggle {
  font: var(--text-body-sm, var(--text-label));
  color: var(--text-secondary);
}

.filter-section-body .filter-note {
  margin: 0 0 var(--space-1);
}
```

- [ ] **Step 3: Rewrite `ScalarFacetGroups.jsx` on the primitive**

Replace the whole file with:

```jsx
import FilterSection from './FilterSection';

// The seven scalar analysis components as collapsible checkbox groups. Options, labels,
// counts and the description all come from the API (`scalar_facets`) — the codebook lives
// in the backend only. Selecting several codes in one group widens (OR); selecting across
// groups narrows (AND).
function ScalarFacetGroups({ groups, selected, onToggle }) {
  const keys = Object.keys(groups || {});
  if (keys.length === 0) return null;

  return (
    <>
      {keys.map(key => {
        const g = groups[key];
        const sel = selected[key] || [];
        return (
          <FilterSection key={key} title={g.heading} count={sel.length} description={g.description}>
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
          </FilterSection>
        );
      })}
    </>
  );
}

export default ScalarFacetGroups;
```

- [ ] **Step 4: Lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors; build clean.

- [ ] **Step 5: Look at it**

Start the dev server, open the homepage, and confirm the seven metadata groups still expand and
collapse, now each showing its description sentence when open (e.g. Perspective → "The narrative
voice or speaker identity through which the song is delivered."), and that a group with selections
shows its count badge while collapsed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/FilterSection.jsx frontend/src/components/ScalarFacetGroups.jsx frontend/src/styles/components.css
git commit -m "feat(presentation): FilterSection primitive; scalar groups adopt it"
```

---

### Task 3: Uniform sidebar

**Files:**
- Modify: `frontend/src/components/GenreFilterTree.jsx:22-24,87-89`
- Modify: `frontend/src/components/ThemeFacetTree.jsx` (header + per-dimension headers)
- Modify: `frontend/src/components/SearchAndFilter.jsx` (the four inline sections + the two umbrellas)

**Interfaces:**
- Consumes: `FilterSection` (Task 2); `facets[dim].description` from Task 1.
- Produces: no new exports. `ThemeFacetTree` and `GenreFilterTree` no longer render their own
  `.filter-section` wrapper or `<h3>` — their caller wraps them.

- [ ] **Step 1: Make `GenreFilterTree` header-less**

In `frontend/src/components/GenreFilterTree.jsx`, replace the opening of the returned JSX:

```jsx
    <div className="filter-section hierarchical-genre-filter">
      <h3 className="filter-title">Genre</h3>

      <div className="filter-search">
```

with:

```jsx
    <div className="hierarchical-genre-filter">
      <div className="filter-search">
```

Leave everything else — including the closing `</div>` and the `uncovered_count` note — exactly as
it is.

- [ ] **Step 2: Make `ThemeFacetTree` header-less and give each dimension a nested section**

In `frontend/src/components/ThemeFacetTree.jsx`:

Add the import at the top:

```jsx
import FilterSection from './FilterSection';
```

Delete the `open`/`toggleOpen` state — `FilterSection` owns that now. Remove these two lines:

```jsx
  const [open, setOpen] = useState(new Set(['themes']));
```
```jsx
  const toggleOpen = (k) => { const n = new Set(open); n.has(k) ? n.delete(k) : n.add(k); setOpen(n); };
```

…and drop the now-unused `useState` import (change `import { useState } from 'react';` to nothing —
delete the line; the file has no other hook).

Replace the outer wrapper and the per-dimension header. The block that currently reads:

```jsx
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
```

becomes:

Note the `scrollable` class is dropped from the options wrapper: with every dimension now collapsible
it would create a 200px-tall scroll area *inside* an already-scrolling sidebar. The sidebar's own
scroll (from triage 4) handles the length.

```jsx
    <div className="theme-facet-tree">
      <div className="filter-options">
        {dims.map((dimKey) => {
          const dim = facets[dimKey];
          return (
            <FilterSection
              key={dimKey}
              title={`${dim.label} (${dim.count})`}
              description={dim.description}
            >
              {dim.sub_dimensions.map((sub) => {
```

and the matching close — the block that currently reads:

```jsx
              })}
            </div>
          );
        })}
      </div>
    </div>
```

becomes:

```jsx
              })}
            </FilterSection>
          );
        })}
      </div>
    </div>
```

`codedCount` is no longer used inside this component (its note moves to the caller in Step 3), so
remove it from the destructured props.

- [ ] **Step 3: Wrap everything in `SearchAndFilter.jsx`**

Add the import beside the other component imports:

```jsx
import FilterSection from './FilterSection';
```

Replace the entire `filterGroups` JSX — from `const filterGroups = (` to its closing `);` — with:

```jsx
  const filterGroups = (
    <div className="sidebar-groups">
      <FilterSection title="Genre & style" count={filters.parent_genres.length + filters.genres.length} defaultOpen
        description="Browse by musical genre. Picking a parent selects everything inside it.">
        <GenreFilterTree
          tree={filterOptions.genre_tree}
          selectedGenres={filters.genres}
          selectedParents={filters.parent_genres}
          onToggleGenre={onToggleGenre}
          onToggleParent={onToggleParent}
        />
      </FilterSection>

      <FilterSection
        title="Themes & advocacy"
        count={DIM_KEYS.reduce((n, k) => n + filters[k].length, 0) + filters.facet_groups.length + filters.facet_subdims.length}
        description={`What the lyrics are about, coded from the analysis. Only songs with lyrics analysis (${filterOptions.availability?.coded_count || 0}) are counted here. Pick a group or sub-dimension for any code inside it; picks narrow together.`}
      >
        <ThemeFacetTree
          facets={facets}
          selected={filters}
          onToggle={onToggleFacet}
          selectedGroups={filters.facet_groups}
          selectedSubdims={filters.facet_subdims}
          onToggleGroup={onToggleGroup}
          onToggleSubdim={onToggleSubdim}
        />
      </FilterSection>

      <FilterSection
        title="Lyric metadata"
        count={SCALAR_KEYS.reduce((n, k) => n + filters[k].length, 0)}
        description="How the song speaks: its voice, tone, intensity and emotional register."
      >
        <ScalarFacetGroups
          groups={scalarFacets}
          selected={filters}
          onToggle={(key, code, checked) => toggleInArray(key, code, checked)}
        />
      </FilterSection>

      <FilterSection title="Year range" count={(filters.year_from || filters.year_to) ? 1 : 0}
        description="Filter by the release year of the song's album.">
        <div className="range-inputs">
          <input type="number" placeholder={yr.min_year ? `From ${yr.min_year}` : 'From'}
            value={filters.year_from} onChange={(e) => setScalar('year_from', e.target.value)}
            min={yr.min_year} max={yr.max_year} />
          <span>to</span>
          <input type="number" placeholder={yr.max_year ? `To ${yr.max_year}` : 'To'}
            value={filters.year_to} onChange={(e) => setScalar('year_to', e.target.value)}
            min={yr.min_year} max={yr.max_year} />
        </div>
      </FilterSection>

      <FilterSection title="Song length" count={filters.lengths.length}
        description="Short is under 2 minutes, long is over 4.">
        <div className="filter-options">
          {(filterOptions.length_buckets || []).map(b => {
            const selected = filters.lengths.includes(b.value);
            const zero = b.count === 0 && !selected;
            return (
              <label key={b.value} className={`filter-option ${zero ? 'is-zero' : ''}`}>
                <input type="checkbox" checked={selected} disabled={zero}
                  onChange={(e) => toggleInArray('lengths', b.value, e.target.checked)} />
                <span className="filter-label">{b.label}<span className="filter-count">({b.count})</span></span>
              </label>
            );
          })}
        </div>
      </FilterSection>

      <FilterSection title="Available on" count={(filters.on_spotify ? 1 : 0) + (filters.has_youtube ? 1 : 0)}
        description="Where you can listen to the song.">
        <div className="filter-options">
          <label className={`filter-option ${(filterOptions.availability?.on_spotify || 0) === 0 && !filters.on_spotify ? 'is-zero' : ''}`}>
            <input type="checkbox" checked={filters.on_spotify}
              disabled={(filterOptions.availability?.on_spotify || 0) === 0 && !filters.on_spotify}
              onChange={() => toggleBool('on_spotify')} />
            <span className="filter-label">On Spotify<span className="filter-count">({filterOptions.availability?.on_spotify || 0})</span></span>
          </label>
          <label className={`filter-option ${(filterOptions.availability?.has_youtube || 0) === 0 && !filters.has_youtube ? 'is-zero' : ''}`}>
            <input type="checkbox" checked={filters.has_youtube}
              disabled={(filterOptions.availability?.has_youtube || 0) === 0 && !filters.has_youtube}
              onChange={() => toggleBool('has_youtube')} />
            <span className="filter-label">Has YouTube<span className="filter-count">({filterOptions.availability?.has_youtube || 0})</span></span>
          </label>
        </div>
      </FilterSection>

      <FilterSection title="Analysis" count={filters.has_analysis ? 1 : 0}
        description="Not every song has been through the lyric analysis yet.">
        <div className="filter-options">
          <label className={`filter-option ${(filterOptions.availability?.has_analysis || 0) === 0 && !filters.has_analysis ? 'is-zero' : ''}`}>
            <input type="checkbox" checked={filters.has_analysis}
              disabled={(filterOptions.availability?.has_analysis || 0) === 0 && !filters.has_analysis}
              onChange={() => toggleBool('has_analysis')} />
            <span className="filter-label">Has lyrics analysis<span className="filter-count">({filterOptions.availability?.has_analysis || 0})</span></span>
          </label>
        </div>
      </FilterSection>

      {(filterOptions.languages?.length > 0) && (
        <FilterSection title="Language" count={filters.languages.length}
          description="The language the song is sung in.">
          <div className="filter-options">
            {filterOptions.languages.map(l => {
              const selected = filters.languages.includes(l.value);
              const zero = l.count === 0 && !selected;
              return (
                <label key={l.value} className={`filter-option ${zero ? 'is-zero' : ''}`}>
                  <input type="checkbox" checked={selected} disabled={zero}
                    onChange={(e) => toggleInArray('languages', l.value, e.target.checked)} />
                  <span className="filter-label">{l.value}<span className="filter-count">({l.count})</span></span>
                </label>
              );
            })}
          </div>
        </FilterSection>
      )}
    </div>
  );
```

- [ ] **Step 4: Lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors (in particular, no unused-variable warning for `useState` in `ThemeFacetTree`);
build clean.

- [ ] **Step 5: Live check**

With the dev server running, confirm on the homepage:
- Eight top-level sections, all collapsible, only **Genre & style** open on load.
- Themes & advocacy expands to five dimension sections, each with its own description; expanding one
  shows the sub-dimension → group → code tree exactly as before, colours and rails intact.
- Lyric metadata expands to the seven component sections.
- Selecting filters in a collapsed section shows a count badge on its header.
- Selection behaviour is unchanged: tick a code, results narrow, a chip appears, removing the chip
  unticks it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/GenreFilterTree.jsx frontend/src/components/ThemeFacetTree.jsx frontend/src/components/SearchAndFilter.jsx
git commit -m "feat(presentation): every sidebar section is a uniform collapsible FilterSection"
```

---

### Task 4: `InfoTip` and the song-page tooltips

**Files:**
- Create: `frontend/src/components/InfoTip.jsx`
- Modify: `frontend/src/components/LyricalAnalysis.jsx`
- Modify: `frontend/src/styles/components.css`

**Interfaces:**
- Consumes: `attributes[].definition`, `attributes[].component_description`,
  `analysis.dimension_descriptions` (Task 1); each chip's existing `definition`.
- Produces: `<InfoTip text label icon>{children}</InfoTip>` — `text` is the tooltip body (renders
  nothing when empty), `label` is the accessible name used when `icon` is true, `icon` renders the
  small "i" button instead of wrapping `children`.

**Deviation from the spec, deliberate:** the spec said the bubble sits above the trigger and flips
below when short of room. Flipping needs runtime measurement; this renders **below** the trigger
always, which cannot collide with the top of the viewport. Simpler, no measurement, same usefulness.

- [ ] **Step 1: Create the component**

`frontend/src/components/InfoTip.jsx`:

```jsx
import { useState, useRef, useEffect, useId } from 'react';

// Hover/focus tooltip. Replaces the native `title` attribute, which waits about a second
// before appearing and cannot be styled. Either wraps its trigger (default) or renders a
// small "i" button (icon). Shows fast on hover, immediately on keyboard focus.
const SHOW_DELAY_MS = 120;

function InfoTip({ text, label, icon = false, children }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const id = useId();

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!text) return icon ? null : children;

  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span
      className="infotip"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={() => setOpen(true)}
      onBlur={hide}
      onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}
    >
      {icon ? (
        <button type="button" className="infotip-icon" aria-label={label}
          aria-describedby={open ? id : undefined}>i</button>
      ) : (
        <span className="infotip-trigger" tabIndex={0} aria-describedby={open ? id : undefined}>
          {children}
        </span>
      )}
      {open && <span role="tooltip" id={id} className="infotip-bubble">{text}</span>}
    </span>
  );
}

export default InfoTip;
```

- [ ] **Step 2: Add the CSS**

Append to `frontend/src/styles/components.css`:

```css
.infotip { position: relative; display: inline-flex; align-items: center; gap: 4px; }
.infotip-trigger { cursor: help; }

.infotip-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.05rem; height: 1.05rem; padding: 0;
  border: 1px solid var(--border-hairline); border-radius: 50%;
  background: none; color: var(--text-secondary);
  font-size: 0.7rem; font-style: italic; line-height: 1; cursor: help;
}
.infotip-icon:hover, .infotip-icon:focus-visible { color: var(--text-primary); }

.infotip-bubble {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 30;
  width: max-content; max-width: 28rem;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-surface-raised);
  border: 1px solid var(--border-hairline); border-radius: var(--radius-sm);
  color: var(--text-secondary); font-size: 0.85rem; line-height: 1.4;
  text-align: left; white-space: normal; pointer-events: none;
}
```

- [ ] **Step 3: Use it in `LyricalAnalysis.jsx`**

Add the import at the top:

```jsx
import InfoTip from './InfoTip';
```

Read the dimension descriptions alongside the other fields (beside `const attributes = …`):

```jsx
  const dimDescriptions = analysis.dimension_descriptions || {};
```

Replace the attributes card block (the `attributes.map` and the emotions row) with:

```jsx
          {attributes.map(a => (
            <div key={a.label} className="la-attr">
              <span className="la-attr-label">
                {a.label}
                <InfoTip icon text={a.component_description} label={`About ${a.label}`} />
              </span>
              <InfoTip text={a.definition}>
                <span className="la-attr-value">{a.value}</span>
              </InfoTip>
            </div>
          ))}
```

Replace the dimension heading (currently `<h4 className="la-dim-heading">{heading}</h4>`) with:

```jsx
            <h4 className="la-dim-heading">
              {heading}
              <InfoTip icon text={dimDescriptions[key]} label={`About ${heading}`} />
            </h4>
```

Replace each chip — the `<span className="la-chip" … title={c.definition || undefined}>…</span>` — so
the chip is wrapped rather than carrying a native `title`:

```jsx
              {codes.map((c, i) => (
                <InfoTip key={`${c.code}-${i}`} text={c.definition}>
                  <span
                    className="la-chip"
                    style={{ borderColor: subDimensionColor(c.sub_dimension) }}
                  >
                    <span className="la-chip-dot" style={{ backgroundColor: subDimensionColor(c.sub_dimension) }} />
                    {c.label}
                  </span>
                </InfoTip>
              ))}
```

Note the `key` moves to `InfoTip` (the outermost element of the map) and the `title` attribute is
gone.

- [ ] **Step 4: Lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors; build clean.

- [ ] **Step 5: Live check, including keyboard**

Open a song page with analysis (one that has both chips and an attributes card) and confirm:
- Hovering an attribute value shows its code definition in well under a second.
- Hovering a theme chip shows that code's definition.
- The small "i" beside each attribute label shows the component description ("The narrative voice or
  speaker identity…"), and the "i" beside each dimension heading shows the dimension description.
- Tab reaches the "i" buttons and the wrapped triggers; the tooltip appears on focus and Escape
  dismisses it.
- No emoji anywhere, and the bubble text is readable against the page background.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/InfoTip.jsx frontend/src/components/LyricalAnalysis.jsx frontend/src/styles/components.css
git commit -m "feat(presentation): InfoTip replaces native title tooltips on the song page"
```

---

### Task 5: Song-page layout

**Files:**
- Modify: `frontend/src/components/LyricalAnalysis.jsx` (emotions separator; wrap the dimension blocks)
- Modify: `frontend/src/styles/components.css`

**Interfaces:**
- Consumes: `FilterSection`/`InfoTip` untouched; this is layout only.
- Produces: a `.la-dimensions` wrapper element around the five dimension blocks.

- [ ] **Step 1: Emotions on one line, semicolon-separated**

In `frontend/src/components/LyricalAnalysis.jsx`, the emotions row currently reads:

```jsx
          {emotions.length > 0 && (
            <div className="la-attr la-attr-emotions">
              <span className="la-attr-label">Emotions</span>
              <span className="la-attr-value">{emotions.join(', ')}</span>
            </div>
          )}
```

Change the join to a semicolon:

```jsx
          {emotions.length > 0 && (
            <div className="la-attr la-attr-emotions">
              <span className="la-attr-label">Emotions</span>
              <span className="la-attr-value">{emotions.join('; ')}</span>
            </div>
          )}
```

- [ ] **Step 2: Wrap the five dimension blocks**

The `dims.map(…)` call currently sits as a direct child of `.lyrical-analysis`. This is a
wrapper-only edit — the body of the map is not touched.

Insert one line immediately **before** the line that reads:

```jsx
      {dims.map(([key, heading, codes]) => {
```

namely:

```jsx
      <div className="la-dimensions">
```

and insert its closing tag immediately **after** the line that closes that map, which reads:

```jsx
      })}
```

(the one directly preceding the `{hasEvidence && (` block), namely:

```jsx
      </div>
```

Re-indent the wrapped block by two spaces if your editor does not do it automatically. Confirm with
`npm run build` that the JSX still parses — an unbalanced tag fails the build immediately.

- [ ] **Step 3: Add the CSS**

In `frontend/src/styles/components.css`, after the existing `.la-attr` rule, add:

```css
/* Emotions can carry three values; give the row the full grid width so it reads on one
   line instead of wrapping inside a 160px column. */
.la-attr-emotions { grid-column: 1 / -1; }

/* Five dimension blocks stacked one-per-row made the page very long. */
.la-dimensions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: start;
}

@media (max-width: 700px) {
  .la-dimensions { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors; build clean.

- [ ] **Step 5: Live check at two widths**

On a song page with several coded dimensions:
- Desktop: the five dimension blocks sit two per row; the attributes card and the evidence block
  still span the full width.
- Emotions render on one line as `Moral Outrage; Sardonic Mockery`.
- Narrow the window below 700px: the blocks stack to one column and nothing overflows horizontally.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/LyricalAnalysis.jsx frontend/src/styles/components.css
git commit -m "feat(presentation): emotions on one line; dimension blocks two-up"
```

---

### Task 6: Verification and docs

**Files:**
- Modify: `docs/PROJECT_STATE.md` (Current session, Next Tasks, Decision Log, Changelog)
- Modify: `docs/PROJECT_PLAN.md` (the triage list — record this batch)
- Modify: `CLAUDE.md` (the `src/components/` bullet — name `FilterSection` and `InfoTip`)

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test`
Expected: PASS, whole suite green. Record the count.

- [ ] **Step 2: Frontend gates**

Run: `cd frontend && npm run lint && npm run build`
Expected: 0 errors, clean build.

- [ ] **Step 3: Encoding check**

Run: `grep -nP 'â€|Ã¢' backend/data/taxonomy.json frontend/src/components/*.jsx frontend/src/styles/components.css`
Expected: no output. The five dimension descriptions contain em dashes, so a mojibake regression
would surface here.

- [ ] **Step 4: Whole-sidebar regression pass**

With both servers running, confirm the filters still *work*, not just look right: apply a genre, a
theme code, a metadata component and a language together; check the result count changes sensibly,
each shows a chip, removing a chip unticks its box, "Clear all" empties everything, and a reload
restores the full selection from the URL.

- [ ] **Step 5: Update the docs**

In `docs/PROJECT_STATE.md`: set the current session, add a Decision Log entry dated 2026-07-22
recording the `FilterSection`/`InfoTip` primitives, the two sidebar umbrellas, the default-open
choice (Genre only), the five curator-approved dimension descriptions now living in `taxonomy.json`,
and the deliberate below-only tooltip positioning; append a Changelog entry with the test counts.

In `docs/PROJECT_PLAN.md`, record this batch in the curator-triage list.

In `CLAUDE.md`, add `FilterSection` and `InfoTip` to the `src/components/` description as the shared
sidebar/tooltip primitives, and update the component count.

- [ ] **Step 6: Commit and push**

```bash
git add docs CLAUDE.md
git commit -m "docs(presentation): record the sidebar and tooltip rework"
git push -u origin <branch-name>
```

---

## Notes for the implementer

- **Prerequisite check first:** if `frontend/src/components/ScalarFacetGroups.jsx` is missing, the
  two pending branches have not merged — stop and say so.
- **Never run `taskkill /F /IM node.exe`** — it kills every node process on the machine. Kill only
  the PID you started.
- A backend may already be running on port 5000; do not restart or kill it. For a scratch backend use
  port 5001.
- Scratch scripts go in the system temp scratch directory with absolute `require` paths into
  `backend/node_modules` — a temp file under `backend/` restarts nodemon.
- **PowerShell:** use `git commit -F <file>` for multi-line messages, and never do a whole-file
  read/replace/write on a file containing non-ASCII (PS 5.1 double-encodes BOM-less UTF-8). Use the
  Edit tool per hunk.
