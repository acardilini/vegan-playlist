# B3 Round 4 — Theme-Tree Restyle + Date-Sort Fallback — Design

_Date: 2026-07-20 · Sub-project B, B3 fourth round._
_Extends: [`2026-07-20-B3-facet-selection-and-date-sort-design.md`](./2026-07-20-B3-facet-selection-and-date-sort-design.md)._
_Trigger: curator smoke — theme rows still looked mis-aligned (likely stale HMR; the round-3 markup is
already uniform flex rows), text too small, and the four taxonomy levels not visually distinct; plus the
curator confirmed the date-sort NULL fallback._

## Decisions (from brainstorm + visual companion)

1. **Theme tree restyle = "Option A · colour-forward"** (curator pick). Same tree/behaviour; restyle only:
   - **Bigger text** throughout (up from `--text-meta`/`--text-body-sm` to ~`--text-body-sm`/`--text-body`).
   - **Clear per-level hierarchy** so Dimension → Sub-dimension → Group → Code read distinctly, genre-box
     style:
     - **Dimension:** bold, largest, with the ▶/▼ expand caret (as now, a header row).
     - **Sub-dimension:** checkbox row; label in its **sub-dimension palette colour** + colour dot; the
       nesting rail under it takes the sub-dimension colour.
     - **Group:** checkbox row; **small-caps, muted** label.
     - **Code:** checkbox row; colour dot + normal label.
   - **Nested left rails + increasing indent per level** (like the genre box's `subgenres-container`
     border-left) instead of flat padding, so nesting is obvious.
   - All rows are uniform left-aligned `.filter-option` flex rows (removes any residual centring).
2. **Date-added sort falls back to import date.** `date_added` sort becomes
   `ORDER BY COALESCE(s.playlist_added_at, s.date_added) DESC NULLS LAST, s.title ASC` — Spotify
   playlist-added date first, else the DB `date_added` (import), so the ~534-song April-2026 batch (no
   playlist date) sorts by when it entered the collection rather than to the bottom.

## Design

### Frontend — `ThemeFacetTree` restyle (presentation only)

- Keep the component's props, selection logic, ancestor-covers-descendants, zero-count greying, and
  counts exactly as round 3 shipped. **No behaviour change.**
- Markup: wrap each level's children in a nested rail container (a `<div>` per level with a
  `border-left`), mirroring the genre box, rather than per-row left padding. The sub-dimension rail's
  `border-left-color` is set inline to `subDimensionColor(sub.id)`.
- Per-level classes drive the type scale/colour: dimension header, `.facet-subdim` (coloured, semibold),
  `.facet-grouprow` (small-caps muted), `.facet-code` (normal + dot). Counts stay right-aligned via the
  existing `.filter-label` `space-between`.
- CSS uses design tokens for sizing/weight/colour; sub-dimension hues remain inline `style` (the
  sanctioned data-encoding). No emoji. No new horizontal overflow (rails add left indent only; the
  scrollable container already clips).

### Backend — date-sort fallback

- One line in the `/search` `orderBy` switch (`case 'date_added'`) → the `COALESCE(...)` above. Both
  columns exist on `songs`; `date_added` is populated for all rows, so the COALESCE is never fully null
  except where both are (none). Keep `NULLS LAST` defensively.

## Out of scope (YAGNI)

- No change to facet logic, counts, chips, genre/other filters, or the sidebar layout.
- No taxonomy/data change.

## Verification

- Backend `node --test` green (no new logic to unit-test; the sort is verified live).
- Frontend `npm run build` + `npx eslint src/` clean.
- Live smoke on a **freshly restarted** dev server (not HMR): theme rows left-aligned at every level;
  the four levels visually distinct (dimension bold/large; sub-dimension coloured; group small-caps
  muted; code dotted); text noticeably larger; nesting rails visible; selection/counts/chips unchanged;
  `Date added` sort surfaces the recent April-2026 batch near the top (by import date) rather than at the
  bottom.
