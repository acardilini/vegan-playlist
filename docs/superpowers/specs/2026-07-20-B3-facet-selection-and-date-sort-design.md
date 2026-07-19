# B3 Round 3 — Selectable Facet Groups + Date-Added Sort — Design

_Date: 2026-07-20 · Sub-project B (Analysis Integration), B3 third round._
_Extends: [`2026-07-19-B3-rework-sidebar-dynamic-counts-design.md`](./2026-07-19-B3-rework-sidebar-dynamic-counts-design.md)._
_Trigger: curator smoke-test feedback on the reworked sidebar (branch `session-B3-browse-search`, unmerged)._

## Context

The reworked browse sidebar + dynamic exclude-self counts passed the curator's smoke (layout, dynamic
counts, chips all good). Three follow-ups remain, done on the **same branch** before merge:

1. **Theme tree formatting bug** — some rows in Themes & advocacy look centre-aligned (Moral Frames
   closed, and some rows when a dimension is expanded) instead of left-aligned.
2. **Selectable sub-dimensions & groups** — the curator wants to filter by a whole group or
   sub-dimension, not only individual codes.
3. **"Sort by: Date added"** — a new sort option.

## Decisions (from brainstorm)

- **Theme filter logic stays AND for individual codes** (curator kept the current narrowing behaviour;
  they explicitly rejected making the whole dimension OR).
- **A group or sub-dimension is a single OR-term.** Curator's choice: selecting a group/sub-dimension
  matches songs having **any** code inside it; a single code is an exact term; **all selected terms AND
  together** across the tree. So the analysis filter is a conjunction (AND) of terms, where each term is
  either one code or "any code in this group/sub-dimension."
- **Date-added sort uses `songs.playlist_added_at`** (when the song was added to the Spotify playlist —
  the real curation timeline, 2017→2025), newest first. Not `date_added`/`created_at` (DB import time).

## Design

### 1. Theme facet selection model (three selectable levels)

The tree keeps its shape (Dimension → Sub-dimension → Group → Code) but **every level below the
dimension becomes a checkbox row** (uniform `.filter-option` markup — this also fixes the alignment
bug, which comes from today's mixed block `<div>` labels vs flex code rows):

- **Code** checkbox → exact term (song has this code).
- **Group** checkbox → OR-term (song has any code in the group).
- **Sub-dimension** checkbox → OR-term (song has any code in the sub-dimension).
- **Dimension** stays an expand/collapse header (not a filter term — matches "keep it manageable").

**Ancestor-covers-descendants UX:** when a group or sub-dimension checkbox is checked, its descendant
checkboxes render **checked + disabled** (visually "covered", conveying the curator's "auto-select the
themes they contain") — they cannot be toggled individually until the ancestor is unchecked. Checking a
sub-dimension covers its groups and their codes; checking a group covers its codes. This makes the
group/sub-dimension the single active OR-term while still showing the user what it includes.

**Semantics recap (AND of terms):**

| You tick | Term |
|---|---|
| code `killing` | has `killing` |
| group `violence` | has ANY of {killing, brutality, systemic_violence} |
| sub-dimension `cruelty_suffering` | has ANY code in that sub-dimension |
| `violence` group + `confinement` group | (any violence) **AND** (any confinement) |
| `violence` group + `cows` (a target code) | (any violence) **AND** (cows) |

**Counts** shown per row are the existing distinct-song rollups already in `facetTree`
(`dimension.count` / `sub_dimension.count` / `group.count` / `code.count`), refreshed by the dynamic
exclude-self endpoint. Zero-count non-selected rows grey/disable as elsewhere.

**Chips:** one chip per selected term — a code chip (label = code label, as now), a group chip
(label = group label), a sub-dimension chip (label = sub-dimension label). Each chip's ✕ clears that
term.

### 2. Backend — AND-of-terms filter

- **`analysis.js` gains reverse maps** (built once from the taxonomy, like the existing `SUBDIM`):
  for each dimension, `group id → [code ids]` and `sub-dimension id → [code ids]` (plus the DB column).
- **`facetFilterConditions` (or a sibling) accepts three inputs** per dimension: individual codes (each
  an exact term), selected group ids, selected sub-dimension ids. It emits, per term, a clause:
  - code term: `sa.<col> @> $n::jsonb` (`[{code}]`) — unchanged form.
  - group/sub-dim term: `(sa.<col> @> $a OR sa.<col> @> $b OR …)` over that term's codes.
  All terms AND together (joined by `AND`), preserving the current `needsJoin`/param-index contract so
  `buildWhere` and the exclude-self counts keep working unchanged.
- **Wire format:** existing per-dimension code params (`themes`/`targets`/`actions`/`tactics`/
  `moral_frames`) stay (individual AND terms). Add two new repeatable params carrying the dimension so
  the backend resolves column + codes via the taxonomy: **`facet_groups`** and **`facet_subdims`**, each
  value `"<dimKey>:<id>"` (e.g. `facet_groups=themes:violence`). `buildWhere` passes all three into the
  facet clause builder; `/search` and `/browse-facets` both get it for free (they share `buildWhere`).
- Exclude-self is unchanged: the whole analysis group (codes + groups + sub-dims) is excluded when
  counting analysis rows, applied for genre/length/etc.

### 3. Alignment fix

Folded into §1: replacing the block `.facet-sub-label` / `.facet-group-label` `<div>`s with uniform
checkbox rows (flex `.filter-option` with left-aligned label + right-aligned count) removes the
block-vs-flex inconsistency that renders some rows centred. Indentation per level via left padding.
Verify the specific Moral Frames (closed) and expanded-row cases are left-aligned after.

### 4. Sort by "Date added"

- **Frontend:** add `<option value="date_added">Date added</option>` to the Sort dropdown (alongside
  Title/Artist/Year; Year stays the default from the prior round).
- **Backend `/search`:** add a `date_added` case to the `orderBy` switch →
  `ORDER BY s.playlist_added_at DESC NULLS LAST, s.title ASC` (newest additions first). The column is
  populated for all live songs.

## Out of scope (YAGNI)

- OR across a whole dimension (curator kept AND for codes).
- Changing genre/length/other filters' behaviour.
- Removing the now-unused `getFilterOptions`/`getFacets` service methods (still deferred).

## Verification

- Backend `node --test` green, incl. tests for: the taxonomy reverse maps (group/sub-dim → codes); the
  AND-of-terms clause builder (a code term = one `@>`; a group term = an OR over its codes; multiple
  terms ANDed; param indices correct); and the `date_added` sort ordering.
- Frontend `npm run build` + `npx eslint src/` clean.
- Live smoke: ticking a group returns songs having any of its codes; group + a code in another
  dimension ANDs; ancestor-checked descendants show checked+disabled; chips for group/sub-dim/code add
  and remove; dynamic exclude-self counts still update; theme rows are left-aligned (Moral Frames fixed);
  "Date added" sorts newest-added first; unfiltered counts unchanged (genre sum ~1,003, killing 358).
