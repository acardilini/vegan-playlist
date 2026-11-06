# Explorer upgrade, Round 2 (labels, year scrubber, neighbour lines, guided walk) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add floating cluster labels, a year scrubber with play, neighbour lines from the selected song, and a "Next similar / Back" guided walk to the Explore map (2D and 3D).

**Architecture:** The server clusters each space's 2D and 3D coordinates (deterministic k-means) and names each region by what is over-represented there, serving `labels2d` / `labels3d` in the existing single map payload. Everything else is client-side on data the page already holds: nearest-neighbour and year logic are small pure modules; `ExploreMap.jsx` draws labels and lines on the existing canvas and hosts a new year strip and walk buttons.

**Tech Stack:** Node/Express + PostgreSQL (`node:test`), React + Vite, plain 2D canvas, `node --test` for pure frontend modules. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-explorer-3d-design.md` (Round 2 section, plus its "Round 2 revisions" block added with this plan). Round 1 is merged to `main`.

## Global Constraints

- No charting/3D dependency; hand-rolled canvas only. Read-only: nothing writes to `song_coordinates`, embeddings or any analysis table.
- Existing Explore URLs (`space`, `colour`, `codes`, `q`, `song`, `view`, `dim`, `cam`) behave exactly as today. New params are optional, absent = today's behaviour: `yr=<year>`, `labels=0`, `lines=0`.
- Public map gate unchanged (`status='included' AND published=true` plus `ELIGIBLE`); still **one** payload response; payload growth from labels stays under 10KB.
- Labels are automatic only (no curator editing). A label is named by what is **over-represented** in its region (lift), never by the plain most common value.
- Styling uses site tokens only (`--bg-*`, `--text-*`, `--accent-*`, `--space-*`, `--border-hairline`, `--radius-*`, `--font-body`); the dark theme only.
- `prefers-reduced-motion`: camera and view moves snap; nothing new may animate when it is set (the year **Play** is a user-started stepped sweep, allowed).
- Pure logic lives in DOM-free modules covered by `node --test`; give the new backend test file no DB fixtures it does not need (the region tests are pure).
- Dev conventions: backend tests `cd backend && node --test test/<file>`; frontend pure tests `cd frontend && node --test src/components/explore/*.test.js` (a directory argument fails on this Node); lint `cd frontend && npm run lint` (0 errors; 5 warnings exist already); build `cd frontend && npm run build`. Stage explicit paths only (never `git add backend`); commit messages via `git commit -F <scratchpad file>` ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `taskkill /IM node.exe`. Do not create temp scripts inside `backend/`.
- Branch: `session-explorer-round2` (already created from `main`).

## Review Focus

1. Labelling with too little data: fewer songs than `k`, a space where all points coincide, a region with no distinctive term, two regions that would get the same text: no crash, no NaN centre, no empty-string label, no duplicate text on the map. (Tasks 1, 2)
2. Every label must be distinctive: a code every song carries, or the catalogue's top genre in every region, must never become the label; results identical on every payload build. (Task 1)
3. A stale or hand-edited `yr` (`2020-2021`, `abc`, below the earliest year, above the latest, a float) falls back to "all years"; songs with no release year are never lost; **Play** stops at the end and on unmount, leaving no timer running. (Tasks 5, 7)
4. Walk and lines with awkward state: selected song missing coordinates in this space, clicking another dot mid-walk restarts the walk, Back at the start does nothing, a song is never revisited, Escape/clear resets. (Tasks 4, 8)
5. Performance and old links: neighbours recomputed only when the selection or space/dim changes (not per camera frame); labels computed once on the server; a pre-Round-2 shared link looks exactly as before except for the new labels. (Tasks 6, 8)

---

### Task 1: Region labelling (pure backend module)

**Files:**
- Create: `backend/services/exploreRegions.js`
- Test: `backend/test/exploreRegions.test.js` (pure; no database)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `kmeans(points: number[][], k: number, maxIter = 50) -> { assignments: number[], centres: number[][] }`. Deterministic with no random source: the first centre is the point nearest the overall mean (lowest index on ties), each further centre is the point farthest from its nearest chosen centre (lowest index on ties); then Lloyd iterations until assignments stop changing or `maxIter`. `k` is capped at the number of points; no points gives empty arrays; an emptied cluster keeps its previous centre; coincident points never produce NaN.
  - `buildRegionLabels(items: { point: number[], terms: string[], genre: string|null }[], opts: { k = 12, minRegion = 15, labelOf(term: string): string, genreLabelOf(genre: string): string }) -> { label: string, centre: number[], count: number }[]`. `terms` are already-unique term keys per item; `centre` is the cluster centre rounded to 4 decimals; result sorted by `count` descending then by cluster index.
  - Exported tuning constants: `MIN_TERM_COUNT = 5`, `MIN_TERM_SHARE = 0.2`, `MIN_TERM_LIFT = 1.6`, `MIN_GENRE_COUNT = 6`, `MIN_GENRE_SHARE = 0.3`, `MIN_GENRE_LIFT = 1.4`.

- [ ] **Step 1: Write the failing tests** in `backend/test/exploreRegions.test.js` (names and assertions):
  - `kmeans separates two obvious blobs and is deterministic`: 20 points near (0,0) and 20 near (50,50), `k=2` -> every point of a blob shares one assignment, the two blobs differ, two runs deep-equal.
  - `kmeans copes with degenerate input`: `[]` -> empty arrays; 3 points with `k=10` -> 3 centres; 30 identical points with `k=4` -> no NaN in any centre, every assignment a valid index.
  - `a region is named by its over-represented term, not the global most common`: two blobs of 30 items; every item carries term `themes:a` (global share 100%); blob 1 also carries `themes:x` on 27 items, blob 2 carries `themes:y` on 27 -> exactly two labels, one `X-label`, one `Y-label` (via `labelOf`), never the `a` label.
  - `a label may add the over-represented parent genre`: blob 1 items have genre `hardcore` (27 of 30) while the other blob is `metal` -> label text is `<term label> · Hardcore` (genre label via `genreLabelOf`); a region with a distinctive genre but no distinctive term is labelled with the genre alone.
  - `regions below minRegion and regions with nothing distinctive get no label`: a 10-item blob gets none; a blob whose terms mirror the global mix gets none.
  - `two regions that would read the same keep only the larger`: two blobs both dominated by `themes:x` (blob sizes 40 and 25) -> one label, centre in the larger blob.
  - `labels are identical across runs`: run twice, deep-equal.

- [ ] **Step 2: Run to verify they fail.** Run: `cd backend && node --test test/exploreRegions.test.js`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `kmeans` and `buildRegionLabels` in `backend/services/exploreRegions.js`.** Naming rule per region with `count >= minRegion`: for each term, `c` = items in the region carrying it, `share = c / count`, `lift = share / (catalogueCount / items.length)`; a term is eligible when `c >= MIN_TERM_COUNT`, `share >= MIN_TERM_SHARE`, `lift >= MIN_TERM_LIFT`; pick the highest `c * ln(lift)` (ties: larger `c`, then alphabetical key). Genre uses the same rule with the `MIN_GENRE_*` constants. Label = term label and genre label joined by ` · `, omitting a missing part; no part means no label. After naming, if two regions have identical label text keep the one with the larger count (ties: lower cluster index) and drop the rest.

- [ ] **Step 4: Run to verify they pass.** Run: `cd backend && node --test test/exploreRegions.test.js`. Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** `backend/services/exploreRegions.js backend/test/exploreRegions.test.js` as `feat(explore): region labelling (k-means + lift naming)`.

### Task 2: Serve labels in the map payload

**Files:**
- Modify: `backend/services/explore.js` (`mapPayload`, exports)
- Test: `backend/test/explore.test.js` (existing file, sentinel `ZZZEXP`)

**Interfaces:**
- Consumes: `buildRegionLabels` (Task 1); in `explore.js`: `THEME_DIMENSIONS`, `getParentGenre`, the normalised 3D clouds already built in `mapPayload`, `analysis.SUBDIM` (the codebook gate), `analysis.label(col, code)`.
- Produces: each entry of `payload.spaces` gains `labels2d` and `labels3d` (`[]` when the space has no 3D data): arrays of `{ label, centre, count }`; `centre` has 2 numbers (raw 2D units, the same units as `songs[i].coords[space]`) or 3 numbers (the normalised units of `songs[i].coords3[space]`). Also exported from `explore.js`: `labelItems(rows, space, dim, cloud3d)`.

- [ ] **Step 1: Write the failing tests** in `backend/test/explore.test.js`:
  - `mapPayload serves labels2d and labels3d per space`: for every space, `labels2d` is an array; each entry has a non-empty string `label`, a finite 2-number `centre`, an integer `count >= 15`; `labels3d` entries have a 3-number `centre` with every value in [-1, 1] when `has3d`, and `labels3d` is `[]` when not.
  - `labels are stable between payload builds`: two `mapPayload` calls deep-equal in every space's labels.
  - `labelItems keeps only mapped songs and codebook-known terms`: rows built in the test (no DB) with one row missing its 2D coordinates, one carrying an unknown code and a known one -> the missing row is absent, the unknown code is absent from `terms`, the known one is present as `themes:<code>`, and a `genre` of `other` or null becomes `genre: null`.

- [ ] **Step 2: Run to verify they fail.** Run: `cd backend && node --test test/explore.test.js`. Expected: the three new tests FAIL, the rest pass.

- [ ] **Step 3: Implement `labelItems` and wire `mapPayload`.** Terms are keyed `<column>:<code>` for the four theme columns (`themes`, `topics`, `advocacy`, `moral_frames`), using the same codebook gate as `themeSubCounts`; `labelOf` strips the key and calls `analysis.label(column, code)`; `genreLabelOf` is `titleCase`. 2D items use `r[space.column]`; 3D items use the normalised cloud for that space so centres are in the units the client draws. Compute per space in `mapPayload` once.

- [ ] **Step 4: Run to verify they pass.** Run: `cd backend && node --test test/explore.test.js`. Expected: PASS. Then run the live payload and read the labels: `curl` the endpoint with the dev backend up and print each space's `labels2d` and `labels3d` text and counts. They must read as plausible, distinctive names (not one phrase repeated); if the thresholds give nothing or noise, retune the exported constants in Task 1 and say so in the commit message. Check the payload size grew by under 10KB.

- [ ] **Step 5: Commit** `backend/services/explore.js backend/test/explore.test.js` (plus `backend/services/exploreRegions.js` if retuned) as `feat(explore): serve cluster labels per space and dimension`.

### Task 3: Label placement (pure frontend)

**Files:**
- Create: `frontend/src/components/explore/mapLabels.js`
- Test: `frontend/src/components/explore/mapLabels.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `truncateLabel(text: string, max = 34) -> string` (ends with `…` when cut, never exceeds `max` characters).
  - `placeLabels(items: { text: string, x: number, y: number, count: number }[], measure(text): number, bounds: { w: number, h: number }, opts = { height: 16, gap: 6 }) -> (item & { box: { x0, y0, x1, y1 } })[]`. Greedy: items in descending `count` (ties: input order); a label is centred on `(x, y)`; it is dropped when its centre is outside `bounds`, when `x` or `y` is not finite, or when its box (text width + `gap` each side, `height` tall) overlaps one already placed. Deterministic.

- [ ] **Step 1: Write the failing tests:**
  - `truncateLabel leaves short text and cuts long text with an ellipsis within max`.
  - `placeLabels keeps the larger region when two labels collide` (two items 10px apart, counts 40 and 20 -> only the 40 survives).
  - `placeLabels keeps both when they do not overlap`.
  - `placeLabels drops labels centred off the plot and non-finite positions`.
  - `placeLabels is deterministic and ignores input order for priority` (same result for shuffled input with distinct counts).

- [ ] **Step 2: Run to verify they fail.** Run: `cd frontend && node --test src/components/explore/mapLabels.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement both functions in `mapLabels.js`** (plain ESM, `.js` import extensions if any).

- [ ] **Step 4: Run to verify they pass.** Run: `cd frontend && node --test src/components/explore/mapLabels.test.js`. Expected: PASS.

- [ ] **Step 5: Commit** `frontend/src/components/explore/mapLabels.js frontend/src/components/explore/mapLabels.test.js` as `feat(explore): label placement`.

### Task 4: Neighbours, walk and centring helpers (pure frontend)

**Files:**
- Create: `frontend/src/components/explore/neighbours.js`, `frontend/src/components/explore/walk.js`
- Modify: `frontend/src/components/explore/mapGeometry.js`, `frontend/src/components/explore/camera3d.js`
- Test: `frontend/src/components/explore/neighbours.test.js`, `frontend/src/components/explore/walk.test.js`; extend `mapGeometry.test.js`, `camera3d.test.js`

**Interfaces:**
- Consumes: song shape from the payload (`{ id, coords: {space: [x,y]}, coords3: {space: [x,y,z]} }`).
- Produces:
  - `nearestSongs(songs, targetId, space, dim: '2d'|'3d', k: number, exclude: Set<number> = new Set()) -> { id: number, dist: number }[]`: nearest first by Euclidean distance in the map's own coordinates (`coords[space]` first two components for 2D, `coords3[space]` for 3D); the target and `exclude` never appear; songs missing coordinates are skipped; a target with no coordinates returns `[]`; ties break on lower id.
  - `walkBase(path: number[], selectedId: number|null) -> number[]`: `path` when its last element is `selectedId`, else `[selectedId]`, else `[]` for no selection.
  - `walkNext(songs, space, dim, path, selectedId) -> { path: number[], id: number } | null`: nearest song not already in the base path (appended); `null` with nothing selected, no coordinates, or none left.
  - `walkBack(path, selectedId) -> { path: number[], id: number } | null`: pops the base path; `null` when the base has one or no element.
  - In `mapGeometry.js`: `outsideCore(point: {x,y}, size, margin = 0.2) -> boolean` (true when the point is within `margin` of any edge of the plot or outside it) and `viewCentredOn(view, point, size) -> view` (translates so the screen `point` lands at the plot centre, clamped by `clampView`). Also `projectPoint(coord: [x,y], extents, size, view) -> {x,y}`, extracted from `layout` so a raw coordinate (a label centre) projects exactly as a dot does; `layout` must call it.
  - In `camera3d.js`: `panCentredOn(cam, point: {x,y}, size) -> cam`: adjusts `panX/panY` so the screen `point` lands at the plot centre, then `clampCamera(cam, size)`.

- [ ] **Step 1: Write the failing tests:**
  - `neighbours.test.js`: `nearestSongs returns the k nearest, nearest first`; `excludes the target and the exclude set`; `skips songs with no coordinates in that space and returns [] for a target without any`; `uses coords3 in 3d and coords in 2d` (a pair that is near in one and far in the other); `breaks ties on lower id`; `k larger than the catalogue returns everything else`.
  - `walk.test.js`: `walkBase restarts when the selection is not the end of the path`; `walkNext starts from the selected song and appends the nearest unvisited`; `never revisits a song across a long walk` (walk 20 steps over a 30-song fixture, ids all distinct); `walkNext is null when nothing is selected or nothing is left`; `walkBack retraces and is null at the start`.
  - `mapGeometry.test.js`: `projectPoint matches layout for the same coordinate` (compare with `layout` output at fit and at a zoomed view); `outsideCore flags edge and outside points`; `viewCentredOn puts the point at the centre unless the clamp stops it`.
  - `camera3d.test.js`: `panCentredOn moves a projected point to the plot centre` (project, centre, re-project: within 0.5px); `panCentredOn keeps the pan inside the clamp`.

- [ ] **Step 2: Run to verify they fail.** Run: `cd frontend && node --test src/components/explore/*.test.js`. Expected: the new tests FAIL (modules or exports missing), existing 78 pass.

- [ ] **Step 3: Implement** the two new modules and the three helpers; refactor `layout` to use `projectPoint` with no behaviour change.

- [ ] **Step 4: Run to verify they pass.** Run: `cd frontend && node --test src/components/explore/*.test.js`. Expected: all pass, 0 failures.

- [ ] **Step 5: Commit** the new and changed files as `feat(explore): neighbour, walk and centring helpers`.

### Task 5: Year and toggle URL state (pure frontend)

**Files:**
- Modify: `frontend/src/components/explore/exploreUrlState.js`
- Test: `frontend/src/components/explore/exploreUrlState.test.js`

**Interfaces:**
- Consumes: song shape (`year: number|null`).
- Produces:
  - `yearBounds(songs) -> { min: number, max: number, missing: number } | null`: integer years only; `missing` counts songs with no valid year; `null` when no song has a year.
  - `deriveYear(params, bounds) -> number|null`: the `yr` param as a whole integer with `bounds.min <= yr < bounds.max`; everything else (absent, junk, a range like `2020-2021`, a float, below min, at or above max, no bounds) is `null` meaning "all years".
  - `formatYear(year, bounds) -> string`: `''` for `null` or at/above max, else the integer string.
  - `yearState(song, year) -> 'in' | 'out' | 'unknown'`: with `year === null` every song is `'in'` (including songs with no year); with a cutoff, a song released up to and including it is `'in'`, later is `'out'`, no year is `'unknown'`.
  - `deriveFlag(params, key) -> boolean`: true unless the param is exactly `'0'`.

- [ ] **Step 1: Write the failing tests** (in `exploreUrlState.test.js`): `yearBounds ignores songs without a year and counts them`; `yearBounds is null when nobody has a year`; `deriveYear accepts a year inside the range`; `deriveYear falls back to null for every invalid value` (loop over `abc`, `2020-2021`, `2020.5`, `1800`, `3000`, the max year itself, empty); `formatYear writes nothing at the end of the range`; `yearState: no cutoff shows everything; a cutoff splits in/out/unknown`; `deriveFlag is on unless 0`.

- [ ] **Step 2: Run to verify they fail.** Run: `cd frontend && node --test src/components/explore/exploreUrlState.test.js`. Expected: new tests FAIL.

- [ ] **Step 3: Implement the five functions** in `exploreUrlState.js`.

- [ ] **Step 4: Run to verify they pass.** Run: `cd frontend && node --test src/components/explore/*.test.js`. Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** `frontend/src/components/explore/exploreUrlState.js frontend/src/components/explore/exploreUrlState.test.js` as `feat(explore): year and toggle URL state`.

### Task 6: Draw labels and neighbour lines; Labels and Lines toggles

**Files:**
- Modify: `frontend/src/components/explore/ExploreMap.jsx`, `frontend/src/components/explore/MapToolbar.jsx`, `frontend/src/styles/components.css`

**Interfaces:**
- Consumes: `spaces[i].labels2d/labels3d` (Task 2); `placeLabels`, `truncateLabel` (Task 3); `nearestSongs`, `projectPoint` (Task 4); `deriveFlag` (Task 5); existing `projectCloud`, `dotAlpha`, `layout`.
- Produces: `MapToolbar` gains props `labels: boolean`, `onLabels(boolean)`, `lines: boolean`, `onLines(boolean)`: two toggle buttons (`Labels`, `Lines`) in the first pill after `2D | 3D`, using the existing `.explore-maptool` look and `aria-pressed`. URL: `labels=0` and `lines=0` when off, deleted when on (default on).

- [ ] **Step 1: Toggles.** Read both flags with `deriveFlag(params, 'labels')` / `'lines'`; write with `setParam(key, on ? null : '0')`; pass through `MapToolbar`; the 3D camera pill is unchanged.

- [ ] **Step 2: Neighbour lines.** Compute `neighbourIds = useMemo(() => nearestSongs(data.songs, selectedId, space, dim, 8).map(n => n.id), [data, selectedId, space, dim])` (null when no selection or the toggle is off). In `drawFrame`, after the dots and before the selection ring, draw one thin line (1px, `--text-secondary`, alpha 0.35; in 3D multiply by `dotAlpha` of the mean `k` of the two ends) from the selected point to each neighbour found among the current frame's points (a neighbour absent from the frame is skipped). Do not recompute neighbours per frame.

- [ ] **Step 3: Labels.** Pick `spaceMeta.labels2d` or `labels3d`. 2D centre -> screen with `projectPoint(centre, extentsFor(data.songs, space), size, transform.view)`; 3D centre -> `projectCloud([centre], orbit.camera, size)[0]` (alpha from `dotAlpha(k)`; 2D alpha 0.9). Build items `{ text: truncateLabel(label), x, y, count }`, run `placeLabels` with `ctx.measureText` as `measure` and `{ w: size.w, h: size.h }` as bounds, and draw each as centred text in `--text-secondary` using the `--font-body` token (weight 600, 12px) with a thin stroke in `--bg-canvas` as a halo for legibility over dots. Draw labels after the lines and ring, before the gizmo. Skip labels while a tween is running (the frame loop knows) and when the toggle is off; no per-frame allocation beyond the item list.

- [ ] **Step 4: Style** (`components.css`): only if the toggles need spacing beyond the existing `.explore-maptools-pill` rules.

- [ ] **Step 5: Verify.** `cd frontend && npm run lint` (0 errors) and `npm run build` (clean). Touch `ExploreMap.jsx`, then in Chrome (backend and `npm run dev` up; check the process tree first, do not assume a restart is needed): labels show in 2D and 3D, hide with the toggle (URL gets `labels=0`), fewer collide when zoomed out and more appear when zoomed in; selecting a song draws 8 lines, `Lines` hides them; a space switch tweens without labels flickering at wrong positions. Record anything not seen by eye.

- [ ] **Step 6: Commit** `frontend/src/components/explore/ExploreMap.jsx frontend/src/components/explore/MapToolbar.jsx frontend/src/styles/components.css` as `feat(explore): cluster labels and neighbour lines`.

### Task 7: Year strip

**Files:**
- Create: `frontend/src/components/explore/YearStrip.jsx`
- Modify: `frontend/src/components/explore/ExploreMap.jsx`, `frontend/src/styles/components.css`

**Interfaces:**
- Consumes: `yearBounds`, `deriveYear`, `formatYear`, `yearState` (Task 5).
- Produces: `YearStrip({ bounds: {min,max,missing}, year: number|null, onYear(year: number|null), reduceMotion })`: a strip along the bottom edge of `.explore-plot`, leaving the bottom-right corner clear for the gizmo: a **Play/Pause** button, a range input from `bounds.min` to `bounds.max` (the thumb at `max` means all years), a label (`All years`, or `Up to 1999`), and, when `bounds.missing > 0`, the note `N songs have no release year`. Play steps the cutoff one year every ~350ms starting from `min` (or from the current cutoff), stops and calls `onYear(null)` at `max`, stops on pause, on any manual change and on unmount (the interval is cleared in every case).

- [ ] **Step 1: Build `YearStrip.jsx`** with the behaviour above (controlled by props; the only local state is whether it is playing). It renders nothing when `bounds` is `null`.

- [ ] **Step 2: Wire it in `ExploreMap.jsx`.** `bounds = useMemo(() => yearBounds(data.songs), [data])`, `year = deriveYear(params, bounds)`, `onYear = y => setParam('yr', formatYear(y, bounds))`. In `drawFrame` a song's `yearState` of `'out'` draws in the dimmed colour and is not lit (so not pickable); `'unknown'` (only possible with a cutoff) draws at half alpha in its own colour and stays pickable; `year === null` changes nothing.

- [ ] **Step 3: Style** `.explore-yearstrip` (tokens only; a pill like the toolbar; the range uses `accent-color` with the site accent; the note in `--text-secondary`).

- [ ] **Step 4: Verify.** Lint 0 errors, build clean. In Chrome: dragging the thumb dims later songs and the URL gets `yr=`; at the end the param disappears; Play sweeps and stops; songs with no year are faint while a cutoff is set; the note shows the count; a junk link `?yr=2020-2021` shows all years.

- [ ] **Step 5: Commit** the three files as `feat(explore): year scrubber with play`.

### Task 8: Guided walk

**Files:**
- Modify: `frontend/src/components/explore/SelectedSongCard.jsx`, `frontend/src/components/explore/ExploreMap.jsx`, `frontend/src/components/explore/useOrbitCamera.js`, `frontend/src/components/explore/useMapTransform.js`, `frontend/src/styles/components.css`

**Interfaces:**
- Consumes: `walkBase`, `walkNext`, `walkBack` (Task 4); `outsideCore`, `viewCentredOn`, `panCentredOn` (Task 4); the map's `positionsRef` (current screen positions).
- Produces: `SelectedSongCard` gains an optional prop `walk: { step: number, canBack: boolean, canNext: boolean, onNext(), onBack() }`: a **Next similar** and a **Back** button under the song meta, and `Step N` text once a walk has started (N = path length). `useOrbitCamera` also returns `moveTo(camera)` (the existing eased move, now exported). `useMapTransform({ size, params, onCommit, hasMeasuredRef, reduceMotion })` also returns `moveTo(view)`: an eased move of the 2D view (380ms ease-out via `easeOutCubic`, snapping under reduced motion, cancelled by any new gesture, committing the final view once).

- [ ] **Step 1: Hooks.** Export `moveTo` from `useOrbitCamera`; add `moveTo` to `useMapTransform` mirroring it (pass `reduceMotion` from `ExploreMap`). Cancel an in-flight move on pointer-down and on wheel.

- [ ] **Step 2: Walk state in `ExploreMap.jsx`.** `const [walkPath, setWalkPath] = useState([])` (component state, not the URL). Effective path = `walkBase(walkPath, selectedId)`. **Next similar:** `walkNext(data.songs, space, dim, walkPath, selectedId)`; on a result set the path, `setParam('song', String(id))`, then find the target in `positionsRef.current`; if `outsideCore(point, size)` ease the camera or view there (3D `orbit.moveTo(panCentredOn(orbit.camera, point, size))`, 2D `transform.moveTo(viewCentredOn(transform.view, point, size))`), otherwise leave the camera alone (an unzoomed map already shows everything). **Back:** `walkBack(...)`, same select-and-centre. Clearing the selection (the card's x or Escape) needs no extra code: the base path resets itself because the last element no longer matches.

- [ ] **Step 3: Card UI.** Render the buttons only when a song is selected; `canNext` false when `walkNext` would return `null`; `canBack` true when the base path has more than one element. Buttons use existing site button classes or small additions in `components.css` (tokens only).

- [ ] **Step 4: Verify.** Lint 0 errors, build clean. In Chrome: select a song, press **Next similar** repeatedly: the selection hops to near neighbours, never repeating; **Back** retraces; clicking a different dot restarts at Step 1; Escape clears; zoomed in, a hop to an off-centre song eases it to the middle (2D and 3D); a pre-existing shared `song=` link works.

- [ ] **Step 5: Commit** the changed files as `feat(explore): guided walk (next similar / back)`.

### Task 9: Smoke, docs and finish

**Files:**
- Modify: `CLAUDE.md` (the `services/explore.js` and `src/components/explore` bullets), `docs/PROJECT_STATE.md` (Current State, Next Tasks, Changelog), `docs/PROJECT_PLAN.md`, `docs/PRD.md` (the Explore feature entry)

- [ ] **Step 1: Full verification.** `cd backend && node --test --test-concurrency=1` (0 failures), `cd frontend && node --test src/components/explore/*.test.js src/utils/*.test.js` (0 failures), lint 0 errors, build clean. Record the counts.
- [ ] **Step 2: Live check of all four features together** in Chrome in 2D and 3D, on Thematic and Sound, with Colour by Themes active: labels readable and not overlapping, year play plus a selected song's lines plus a walk step all at once, a pre-Round-2 link unchanged apart from labels, payload size noted. Record what was not seen by eye (touch, phone width).
- [ ] **Step 3: Update docs** per the End-Session Guide: `CLAUDE.md` (`exploreRegions.js`, `labels2d/labels3d`, the new frontend modules and URL params `yr`, `labels`, `lines`), `PROJECT_STATE.md` (Current State entry, a changelog line, Next Tasks: curator smoke of Round 2, then the artist location map brainstorm), `PROJECT_PLAN.md`, `PRD.md`.
- [ ] **Step 4: Commit** the docs as `docs: explorer round 2 session notes`. Do not merge or push; the curator smoke and the finishing choice come next.
