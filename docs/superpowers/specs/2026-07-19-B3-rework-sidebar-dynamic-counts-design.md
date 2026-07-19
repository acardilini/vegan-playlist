# B3 Rework — Sidebar Layout + Dynamic (Cross-Filtered) Counts — Design

_Date: 2026-07-19 · Sub-project B (Analysis Integration), B3 rework._
_Extends: [`2026-07-19-B3-browse-search-design.md`](./2026-07-19-B3-browse-search-design.md)._
_Trigger: curator smoke-test feedback on the B3 branch (`session-B3-browse-search`, unmerged)._

## Context

The B3 browse/search overhaul was implemented and smoke-tested by the curator. Confirmed working
and kept unchanged: the effective-genre fix (counts now cover ~1,003 songs), the thematic facet
tree, the new filters (length / availability / analysis / language), the removable chips, and the
year-range sizing fix. Two pieces of feedback require a rework, done on the **same branch** before
merge:

1. **Layout** — the two-column drop-down filter panel "breaks up the page too much." Chosen
   replacement (via visual companion): a **left sidebar**.
2. **Counts are static** — the curator wants **dynamic, cross-filtered counts**: picking a filter
   should update the other groups' counts to reflect the current subset ("choose death metal → the
   theme counts reflect death-metal songs, and vice versa"). Chosen semantics: **exclude-self**.

## Design

### 1. Left-sidebar layout

Replace the drop-down `.filters-panel` with a persistent **left rail** beside the results:

```
[ Search…                                            ] [ Sort ▾ ]
┌ Filters ───────┐  ┌ Results ────────────────────────────────┐
│ ▾ Genre        │  │ [✕ death metal] [✕ killing]  Clear all   │
│ ▸ Themes & adv │  │ [▦][▦][▦]                                 │
│ ▸ Year range   │  │ [▦][▦][▦]                                 │
│ ▸ Song length  │  │ [▦][▦][▦]                                 │
│ ▸ Available on │  │                                          │
│ ▸ Analysis     │  │                                          │
│ ▸ Language     │  └──────────────────────────────────────────┘
└────────────────┘
```

- Same seven groups, each a **collapsible section** in the rail (Genre + Themes expandable trees;
  the rest compact). Sections keep their existing components (`GenreFilterTree`, `ThemeFacetTree`,
  and the compact length/availability/analysis/language controls).
- The **chips row moves above the results grid** (out of the sidebar), still removable, still
  visible whenever filters are active.
- **Responsive:** below a breakpoint (~900px) the rail collapses behind a **"Filters" button** that
  opens it as a **slide-in drawer** (overlay); results take the full width. The rail must never
  cause horizontal overflow (design-system rule).
- **Page structure:** the Browse route renders a **full-width search bar (+ sort) on top**, then a
  two-column grid **`filter-sidebar | results`**. The **page owns the grid**; the filter rail is its
  own concern (the current `SearchAndFilter` is split so the search bar sits on top and the filter
  groups render in the rail — component boundary finalised in the plan, but the page, not the
  component, places results beside the rail). This is a change to the Browse **page**, not just
  `SearchAndFilter`.
- Tokens only; no emoji; keep keyboard access + `aria` on the drawer toggle.

### 2. Dynamic exclude-self counts

Every **counted** filter group recomputes its counts from the current selection, applying all
**other** groups' filters but **not its own**:

- Groups with counts (excludable): **genre**, **analysis tree** (all five dimensions treated as one
  group), **length**, **available-on** (on-Spotify + has-YouTube), **analysis toggle** (has-analysis),
  **language**.
- Always-applied constraints (never a counted facet, applied to every group's count): the **text
  search** `q` and the **year range**. Year shows static full-catalogue min/max bounds (a range
  input, not a count list).
- **Granularity = per group.** The whole Themes/advocacy tree is one group: its own code selections
  are excluded when counting any of its codes (so the tree stays widenable), but genre/length/etc.
  selections DO constrain its counts, and its selections DO constrain genre/length/etc. This matches
  the curator's genre↔themes example without per-dimension complexity.
- **Zero/empty handling:** a non-selected option whose exclude-self count is 0 renders **greyed and
  disabled** (visible, not selectable); empty tree branches (sub-dimension/group/parent with no
  non-zero descendants) collapse away, as `facetTree` already does for unfiltered zero nodes. A
  **currently-selected** option always renders (even if it would show 0).

#### Behaviour example (picked: genre = death metal)

| Group | Counts reflect |
|---|---|
| Genre (own group) | everything **except** genre filters → other genres still show counts, addable |
| Themes, Length, Available, Analysis, Language | the death-metal subset |
| Year bounds | static full-catalogue min/max |

### 3. Backend

- **New endpoint `GET /api/spotify/browse-facets`** accepting the same query params as `/search`
  (`q`, `genres`, `themes/targets/actions/tactics/moral_frames`, `lengths`, `has_youtube`,
  `has_analysis`, `on_spotify`, `languages`, `year_from`, `year_to`). It returns every group's
  **exclude-self** counts in one call:
  ```
  { genre_tree, facets, length_buckets, availability, languages, year_range }
  ```
  (`genre_tree` shape as B3's `/filter-options`; `facets` shape as `/api/analysis/facets`;
  `length_buckets`/`availability`/`languages` as B3's `/filter-options`; `year_range` = static
  full-catalogue bounds.)
- **Shared filter-clause builder (the key refactor).** Extract the `/search` WHERE-building into a
  reusable function that returns clauses **tagged by group** (text · genre · analysis · length ·
  available · analysis_toggle · language · year), plus the effective-genre join flag. `/search` uses
  the union of all groups. `browse-facets` computes each group's counts over
  **union(all groups) − (target group)**. This keeps `/search` filtering and the facet counts from
  ever drifting apart (they share one clause source).
- **`analysis.facetTree` gains an optional constraint** (an extra WHERE + params, or a pre-filtered
  song-id set) so the analysis tree can be counted over the non-analysis-filtered subset. Its
  existing no-arg behaviour (unfiltered) is preserved for `/api/analysis/facets`.
- All queries keep `status='included' AND published=true` and the read-only / no-`song_lyrics` /
  `model_used='gemma4:latest'` invariants. Effective genre stays query-time (no stored writes).
- **Performance:** ~6 filtered aggregations per call over 1,332 live songs, batched with
  `Promise.all` — cheap. Called on each filter change (debounced) from the frontend.

### 4. Frontend

- The sidebar fetches counts from `browse-facets` on mount (no filters = the unfiltered counts) and
  on every filter change (debounced, alongside the existing `/search` call). A **stale-response
  guard** (a request token, as used in the admin workbench) ensures the latest response wins when
  several fire in quick succession.
- `GenreFilterTree` / `ThemeFacetTree` / the compact controls consume the refreshed counts; add
  greyed-disabled rendering for zero-count non-selected options.
- `spotifyService.getBrowseFacets(filters)` replaces the browse page's separate
  `getFilterOptions()` + `getFacets()` calls. `/filter-options` is then no longer consumed by the
  frontend — leave it in place (flag for later removal); `/api/analysis/facets` stays (standalone
  public endpoint).
- Selecting a filter still triggers the existing `/search`; results and counts refresh together.

### 5. Sort options — drop "Popularity"

Remove **Popularity** from the "Sort by" dropdown (popularity is already display-suppressed
site-wide; the curator does not want it as a sort). Remaining options: **Title · Artist · Year**.
The default sort becomes **Year (newest first)** (`sort_by='year'`, which the backend already maps to
`release_date DESC NULLS LAST, title ASC`). The frontend's default `sort_by` state changes from
`'popularity'` to `'year'`; the backend still accepts `popularity` (harmless, no longer sent). This
is a small change folded into the sidebar frontend work.

## Out of scope (YAGNI)

- Per-analysis-dimension exclude-self (the whole tree is one group).
- Dynamic year **bounds** (kept static full-catalogue min/max).
- Removing `/filter-options` (left in place; unused-by-frontend flagged for a later cleanup).
- Any change to filter semantics (OR within group, AND across), chips, effective-genre logic, or the
  facet-tree structure/colours — all reused from B3 unchanged.

## Verification

- Backend `node --test` green, including tests for the shared clause builder (per-group tagging;
  union-minus-group), `browse-facets` exclude-self counts (a selection in group A changes group B's
  counts but not group A's own siblings), and `facetTree` with a constraint.
- Frontend `npm run build` + `npx eslint src/` clean.
- Live smoke: sidebar layout (desktop rail + mobile drawer, no horizontal overflow); pick death
  metal → theme/length/language counts drop to the subset while other genres stay addable; pick a
  theme → genre counts reflect it; zero-count options greyed; chips above results; results and counts
  stay in sync; unfiltered counts equal the pre-rework numbers (genre sum ~1,003, has_analysis 640,
  English 32, …).
