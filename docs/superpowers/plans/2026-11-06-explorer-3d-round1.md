# Explorer upgrade, Round 1 (3D map + Themes colouring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3D view (orbit/pan/zoom, depth cues, gizmo, camera presets, drift, animated 2D<->3D transitions) and four "Colour by" theme entries to the Explore map.

**Architecture:** The server serves per-space normalised 3D coordinates and per-song theme buckets in the existing single map payload. The browser projects the 3D cloud onto the existing 2D canvas with pure perspective maths (`camera3d.js`), driven by a new orbit hook beside the existing 2D pan/zoom hook; the existing last-frame tween animates every view change.

**Tech Stack:** Node/Express + PostgreSQL (`node:test`), React + Vite, plain 2D canvas, `node --test` for pure frontend modules. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-explorer-3d-design.md` (Round 1 section). Round 2 (labels, year scrubber, neighbour lines, guided walk) gets its own plan after Round 1 is smoked.

## Global Constraints

- No charting/3D dependency; hand-rolled canvas only.
- Read-only: nothing writes to `song_coordinates`, embeddings or any analysis table.
- Existing Explore URLs (`space`, `colour`, `codes`, `q`, `song`, `view`) behave exactly as today; absent `dim` = `2d`.
- Public map gate unchanged: `status='included' AND published=true` plus `ELIGIBLE`; still **one** payload response.
- Palette: at most 7 categorical slots (`--explore-cat-1..7`) plus the neutral; styling uses site tokens only (`--bg-*`, `--text-*`, `--accent-*`, `--space-*`, `--border-hairline`, `--radius-*`); the pilot's colours/fonts are NOT used.
- `prefers-reduced-motion`: no drift; camera moves and tweens snap.
- Theme colouring uses the public dimension columns `themes`, `topics`(=targets), `advocacy`(=actions), `moral_frames`; **never `tactics`**. Colour bucket = sub-dimension with the most distinct codes; tie -> `MIXED`; none -> `NOT_CODED`.
- 3D normalisation: centre on bbox midpoint, divide by `R = max(spanX,spanY,spanZ)/2 * 1.15`, 4 decimal places.
- Dev conventions: backend tests `cd backend && node --test test/<file>`; frontend pure tests `cd frontend && node --test src/components/explore/`; lint `cd frontend && npm run lint` (0 errors); build `cd frontend && npm run build`. Stage explicit paths only (never `git add backend`); commit messages via `git commit -F <file>` ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `taskkill /IM node.exe`. Do not create temp scripts inside `backend/`.
- Branch: `session-explorer-3d` (already created from `main`).

## Review Focus

1. A stale/hand-edited URL (`dim=3d` on a space with no 3D data, `cam=` junk, pitch beyond +/-90, zoom out of range) must fall back to the default view, never a blank or NaN plot. (Task 4)
2. A degenerate cloud (one point, all points identical, a flat axis) must normalise without NaN/Infinity; a song missing 3D coordinates in a space is skipped, not drawn at NaN. (Tasks 1, 3)
3. Overlapping dots in 3D: a click picks the dot nearest the camera, and cancelling a pointer mid-orbit (pointercancel/leave) leaves no stuck drag and writes nothing to the URL. (Tasks 3, 5)
4. Themes: spotlighting a sub-dimension lights every song that touches it even when its colour bucket is another sub-dimension or `MIXED`; codes outside the codebook and `tactics`-only songs read as `NOT_CODED`. (Tasks 2, 4)
5. A theme legend never exceeds the palette (<= 4 sub-dimensions + Mixed + Not coded) and every dot's colour is explained by a legend entry. (Task 2)

---

### Task 1: Backend 3D coordinates

**Files:**
- Modify: `backend/services/explore.js` (`discoverSpaces`, `mapRows`, `mapPayload`, exports)
- Test: `backend/test/explore.test.js` (existing file, sentinel `ZZZEXP`; its `addCoords` fixture already writes `*_3d` columns)

**Interfaces:**
- Produces: `normaliseCloud(points: Array<[number,number,number]|null>): Array<[number,number,number]|null>`; `column3dFor(key: string, allColumns: string[]): string|null`; `discoverSpaces` entries gain `column3d: string|null`; payload `spaces[i].has3d: boolean`; payload `songs[i].coords3: { [spaceKey]: [x,y,z] }` (key present only when that song has three finite numbers).

- [ ] **Step 1: Write failing tests** in `explore.test.js`:
  - `normaliseCloud centres, scales uniformly and keeps nulls`: input `[[0,0,0],[10,0,0],[0,4,0],null]`; expect point 2's x = `(10-5)/5.75` (~0.8696), point 3's y = `(4-2)/5.75` (~0.3478) (same divisor on both axes), index 3 stays `null`, every value rounded to 4 dp, every `|v| <= 1`.
  - `normaliseCloud survives degenerate input`: `[]` -> `[]`; one point and N identical points -> every point `[0,0,0]` (no NaN/Infinity).
  - `column3dFor pairs a 2d column with its 3d sibling`: `('thematic',['thematic_2d','thematic_3d'])` -> `'thematic_3d'`; `('foo',['foo_2d'])` -> `null`; a key not matching `/^[a-z][a-z0-9_]*$/` -> `null`.
  - `mapPayload serves normalised coords3 and has3d`: for the `addCoords` fixture song, `song.coords3.thematic` has 3 finite numbers each in [-1,1], `p.spaces.find(s=>s.key==='thematic').has3d === true`, and `'semantic'` is absent from `coords3` (hidden space).
- [ ] **Step 2: Run** `cd backend && node --test test/explore.test.js` -> the four new tests fail (undefined exports).
- [ ] **Step 3: Implement** in `explore.js`: `normaliseCloud` and `column3dFor` as above (pure, exported); `discoverSpaces` selects all `song_coordinates` columns once and sets `column3d` via `column3dFor` (hidden spaces still filtered); `mapRows` also selects `sc.<column3d>` aliased by its column name when present; `mapPayload` builds `coords3` per space by running `normaliseCloud` over all rows' 3D arrays for that space (arrays with fewer than 3 finite numbers count as `null`) and attaches `has3d` to each space. Existing `coords` and 2D behaviour unchanged.
- [ ] **Step 4: Run** the file again -> all pass, including the pre-existing tests.
- [ ] **Step 5: Measure payload size.** Run a one-off `node -e` (from the scratchpad directory, absolute requires, loading dotenv by absolute path) that prints `JSON.stringify(await explore.mapPayload(pool)).length`. Expected: roughly 0.5-0.6 MB (it was ~393 KB); if over ~700 KB, drop `coords3` precision to 3 dp and note it in the commit message.
- [ ] **Step 6: Commit** `backend/services/explore.js backend/test/explore.test.js` as `feat(explore): serve normalised 3D coordinates`.

### Task 2: Backend theme colour-by

**Files:**
- Modify: `backend/services/explore.js` (`COLOUR_DIMENSIONS`, `mapRows`, `codeFor`, `labelFor`, `legendFor`, `mapPayload`, exports)
- Test: `backend/test/explore.test.js` (extend its `addAnalysis` fixture helper with optional `themes`/`topics`/`advocacy`/`moral_frames`/`tactics` JSON arguments, defaulting to `'[]'`)

**Interfaces:**
- Consumes: `analysis.SUBDIM[col]` (code -> `{sub_dimension, group}`), `analysis.taxonomy.hierarchy[key].sub_dimensions` (ordered, with `label`), `analysis.subDimensionLabel(col, subId)`.
- Produces: `MIXED = 'MIXED'`; `THEME_DIMENSIONS = [{key:'themes',label:'Themes',col:'themes'},{key:'targets',label:'Targets & species',col:'topics'},{key:'actions',label:'Actions & advocacy',col:'advocacy'},{key:'moral_frames',label:'Moral frames',col:'moral_frames'}]` (each also appended to `COLOUR_DIMENSIONS` with `source:'theme'`); `themeSubCounts(col: string, codes: unknown): Map<string, number>`; `themeBucket(counts: Map<string,number>): string`; payload `songs[i].codes[key]` = bucket for each theme key; `songs[i].subs[key]: string[]` (sorted sub-dimension ids; the key is omitted when empty).

- [ ] **Step 1: Write failing tests** (real codes from `taxonomy.json`: `captivity`, `slaughter` and `animal_suffering` are in sub-dimension `cruelty_suffering`; `speciesism` and `apathy_denial` in `psychology_barriers`; `commodification` in `commercial_ecological`):
  - `themeSubCounts counts distinct codebook codes per sub-dimension`: `('themes', [{code:'captivity'},{code:'captivity'},{code:'slaughter'},{code:'speciesism'},{code:'not_a_code'},{},null])` -> `cruelty_suffering` 2, `psychology_barriers` 1, nothing else; `('themes', null)` and `('themes', 'junk')` -> empty Map.
  - `themeBucket`: a unique maximum returns that sub id; a tie returns `'MIXED'`; empty returns `NOT_CODED`; a single code returns its sub id.
  - `theme colour-by via mapPayload` (DB): three fixture songs - A `themes:[captivity,slaughter,speciesism]`, B `[captivity,speciesism]`, C `[]` with `tactics` populated only. Expect `codes.themes` A=`cruelty_suffering`, B=`MIXED`, C=`NOT_CODED`; `subs.themes` A=`['cruelty_suffering','psychology_barriers']`, C has no `themes` key in `subs`. The `themes` legend: every entry `count > 0`, entries in taxonomy sub-dimension order with labels from the hierarchy (e.g. `Bodily Harm, Confinement & Suffering`), `MIXED` (label `Mixed`) after them, `NOT_CODED` last, total entries `<= 6`; same `<= 6` assertion for the other three theme dimensions. `GET`-level: `codes` has no key from `tactics`.
- [ ] **Step 2: Run** `node --test test/explore.test.js` -> new tests fail.
- [ ] **Step 3: Implement.** `themeSubCounts` filters through `analysis.SUBDIM[col]` (same codebook gate as every public read) and counts distinct codes per sub id; `themeBucket` returns the strictly highest, else `MIXED`/`NOT_CODED`. `mapRows` selects `sla.themes, sla.topics, sla.advocacy, sla.moral_frames`. `codeFor`/`labelFor`/`legendFor` get a `source === 'theme'` branch (legend counts the buckets; zero-count entries omitted; order = hierarchy order, then `MIXED`, then `NOT_CODED`; label of a sub id = hierarchy `label`). `mapPayload` attaches `subs`. Keep the existing "legend and colour must agree" invariant (no top-N logic is needed for themes).
- [ ] **Step 4: Run** the file -> all pass. Then `cd backend && node --test --test-concurrency=1` to confirm the whole suite is still green (expected: the previous 558 plus the new tests, 0 failures).
- [ ] **Step 5: Commit** the two files as `feat(explore): colour by theme sub-dimension`.

### Task 3: Camera maths (pure)

**Files:**
- Create: `frontend/src/components/explore/camera3d.js`, `frontend/src/components/explore/camera3d.test.js` (plain ESM with explicit `.js` import extensions, like its neighbours)

**Interfaces:**
- Produces (all pure, degrees for angles, pixels for pan):
  - `DEFAULT_CAMERA = { yaw: 35, pitch: 20, zoom: 1, panX: 0, panY: 0 }`; `PRESETS = { iso:{yaw:35,pitch:20}, top:{yaw:0,pitch:90}, front:{yaw:0,pitch:0}, side:{yaw:90,pitch:0} }`; `MIN_ZOOM = 0.5`; `MAX_ZOOM = 8`.
  - `clampCamera(cam): cam` (pitch to [-90,90], zoom to [MIN_ZOOM,MAX_ZOOM], yaw wrapped to [-180,180)).
  - `activePreset(cam): 'iso'|'top'|'front'|'side'|null` (matches yaw/pitch within 0.5 deg AND zoom 1 AND zero pan).
  - `projectCloud(coords3: Array<[number,number,number]|null>, cam, size:{w,h}): Array<{x:number,y:number,depth:number,k:number}|null>`: rotate by yaw (about Y) then pitch (about X); `z_cam = r.z + CAM_DIST` (`CAM_DIST = 4.2`, fixed); `f = FOCAL * min(w,h) * zoom`; `x = w/2 + r.x*f/z_cam + panX`; `y = h/2 - r.y*f/z_cam + panY`; `depth = z_cam`; `k = CAM_DIST / z_cam` (>1 near, <1 far); `null` in -> `null` out. **Plan call:** zoom scales the focal length, not the camera distance (the spec's "distance / zoom" would put dots behind the camera at high zoom). Tune `FOCAL` so the whole unit cube fits inside the plot with >= 5% margin at every preset while the real cloud still fills most of it.
  - `rotate(p:[number,number,number], yaw:number, pitch:number): [number,number,number]`.
  - `interpolateCamera(a, b, t): cam` (linear; yaw along the shortest arc).
  - `sortBackToFront(points)`: copy sorted by `depth` descending (nulls removed).
  - `dotRadius(base:number, k:number): number` (`base * clamp(k, 0.55, 1.6)`); `dotAlpha(k:number): number` (linear 0.35 at `k<=0.75` to 0.95 at `k>=1.25`).
  - `gizmoAxes(cam): Array<{axis:'x'|'y'|'z', x:number, y:number, depth:number}>` (unit axes rotated; `y` already flipped for screen space).
  - `pickPoint(points, mx, my, grabPx): point|null`: among points within `grabPx` of the pointer, the one with smallest `depth` (nearest the camera); ties and points lacking `depth` fall back to the smallest screen distance.
- [ ] **Step 1: Write failing tests** `camera3d.test.js`: `fit` (random 500-point cloud in [-1,1]^3 and the 8 cube corners project inside `{w:800,h:520}` with >= 5% margin for each of the four presets, zoom 1); `yaw 0 pitch 0 maps +x right, +y up, and nearer points get larger k`; `top preset: +y points toward the camera (k > 1)`; `null in, null out`; `interpolateCamera(yaw 170 -> -170, t .5)` gives `+-180` (shortest arc), `t 0`/`t 1` return endpoints; `clampCamera` pitch 120 -> 90, zoom 99 -> 8, yaw 190 -> -170; `activePreset` positive for each preset and null after a pan or zoom; `sortBackToFront` farthest first and drops nulls; `dotRadius`/`dotAlpha` monotonic in k with the stated bounds; `gizmoAxes` at preset front has x ~ (1,0), y ~ (0,-1); **`pickPoint` with two points 1px apart picks the smaller `depth`**, returns `null` outside `grabPx`, and with no `depth` field picks the nearest on screen.
- [ ] **Step 2: Run** `cd frontend && node --test src/components/explore/camera3d.test.js` -> FAIL (module missing).
- [ ] **Step 3: Implement** `camera3d.js` to the signatures above.
- [ ] **Step 4: Run** `node --test src/components/explore/` -> all pass (existing geometry/url tests too).
- [ ] **Step 5: Commit** `frontend/src/components/explore/camera3d.js frontend/src/components/explore/camera3d.test.js` as `feat(explore): 3D camera maths`.

### Task 4: URL state for view, camera and theme spotlight

**Files:**
- Modify: `frontend/src/components/explore/exploreUrlState.js`
- Test: `frontend/src/components/explore/exploreUrlState.test.js`

**Interfaces:**
- Consumes: `DEFAULT_CAMERA`, `PRESETS`, `MIN_ZOOM`, `MAX_ZOOM`, `activePreset`, `clampCamera` from `camera3d.js`.
- Produces: `deriveDim(params, spaceHas3d:boolean): '2d'|'3d'`; `deriveCamera(params): cam`; `formatCamera(cam): string`; `songPassesSpotlight(song, colour:string, spotlit:Set<string>): boolean`.

- [ ] **Step 1: Write failing tests:** `deriveDim`: `dim=3d` + has3d -> `'3d'`; `dim=3d` + no 3D data -> `'2d'`; absent/junk (`dim=4d`) -> `'2d'`. `deriveCamera`: absent -> `DEFAULT_CAMERA`; `cam=top` -> top preset camera (zoom 1, pan 0); `cam=10,45,2,30,-20` -> exactly those; junk (`cam=banana`, `cam=1,2,3`, `cam=NaN,0,1,0,0`), pitch 120 and zoom 99 -> `DEFAULT_CAMERA` (never partial). `formatCamera`: default -> `''`; a preset camera -> its name; free camera round-trips through `deriveCamera` (yaw/pitch 1 dp, zoom 2 dp, pan whole px). `songPassesSpotlight`: empty set -> true; plain dimension matches `codes[colour]`; **a theme song with `codes.themes='MIXED'` and `subs.themes=['cruelty_suffering','psychology_barriers']` passes a spotlight of `{psychology_barriers}`, passes `{MIXED}`, fails `{commercial_ecological}`**; a song with no `subs` falls back to its bucket.
- [ ] **Step 2: Run** `node --test src/components/explore/exploreUrlState.test.js` -> new tests fail.
- [ ] **Step 3: Implement** the four functions; leave every existing function untouched. `cam` is `<preset>` or `yaw,pitch,zoom,panX,panY`; validation goes through `clampCamera` only to reject, not to repair (invalid -> `DEFAULT_CAMERA`).
- [ ] **Step 4: Run** `node --test src/components/explore/` -> all pass.
- [ ] **Step 5: Commit** both files as `feat(explore): URL state for 3D view and theme spotlight`.

### Task 5: Orbit camera hook

**Files:**
- Create: `frontend/src/components/explore/useOrbitCamera.js`

**Interfaces:**
- Consumes: `camera3d.js` (`clampCamera`, `interpolateCamera`, `PRESETS`, `DEFAULT_CAMERA`, `MIN_ZOOM`, `MAX_ZOOM`), `deriveCamera`/`formatCamera` from `exploreUrlState.js`.
- Produces: `useOrbitCamera({ size, params, onCommit, active, reduceMotion }): { camera, isDragging, drift, setDrift(boolean), onPointerDown, onPointerMove(e): boolean, onPointerUp, onPointerCancel, onKeyDown, onContextMenu, didDrag(): boolean, attachWheel(el): (() => void)|undefined, zoomIn, zoomOut, reset, goToPreset(name) }`.

Behaviour to implement (mirror the structure and the commit/resync patterns of `useMapTransform.js`; reuse its 4 px drag threshold, `ZOOM_STEP` 1.5 and 300 ms wheel-settle):
- [ ] **Step 1: Implement** the hook: plain left-drag orbits (yaw += dx*0.4 deg, pitch -= dy*0.4 deg, then `clampCamera`); right-drag or Shift+left-drag pans (`panX/panY` in px); wheel zooms by `exp(-deltaY*0.002)` clamped to [`MIN_ZOOM`,`MAX_ZOOM`]; arrow keys orbit 5 deg per press (`onKeyDown`, preventing page scroll); `onContextMenu` calls `preventDefault`; `zoomIn`/`zoomOut`/`reset` act on zoom/whole camera (`reset` -> `DEFAULT_CAMERA`). `goToPreset(name)` eases from the current camera to `{...PRESETS[name], zoom:1, panX:0, panY:0}` over 380 ms with ease-out via `requestAnimationFrame` (snaps immediately when `reduceMotion`); a new gesture cancels an in-flight move. Drift (state, default off, not in the URL): while `drift && active && !isDragging && !document.hidden && !reduceMotion`, advance yaw ~6 deg/s via `requestAnimationFrame`; pointer-down pauses it for the gesture; it never commits to the URL. The camera is written to the URL (`onCommit(formatCamera(camera))`) once at pointer-up-after-drag, 300 ms after the last wheel notch, and when a preset move finishes - never per frame. A URL change from outside (pasted link, Back) resyncs the camera, using the same `committedRef` comparison as `useMapTransform`. `onPointerCancel` clears drag state and writes nothing. All listeners/timers/rAF handles are cleaned up on unmount and when `active` turns false.
- [ ] **Step 2: Lint** `cd frontend && npm run lint` -> 0 errors. (No automated test: the hook is imperative pointer/animation plumbing; the maths it calls is tested in Task 3/4 and the gesture behaviour is checked in Task 7's smoke.)
- [ ] **Step 3: Commit** `frontend/src/components/explore/useOrbitCamera.js` as `feat(explore): orbit camera hook`.

### Task 6: Draw the 3D map and the toolbar

**Files:**
- Modify: `frontend/src/components/explore/ExploreMap.jsx`, `frontend/src/styles/components.css`
- Create: `frontend/src/components/explore/MapToolbar.jsx`

**Interfaces:**
- Consumes: Tasks 3-5 exports; payload fields `spaces[i].has3d`, `songs[i].coords3`, `songs[i].subs`.
- Produces: `MapToolbar({ dim, has3d, onDim(dim), activePreset, onPreset(name), drift, onDrift(boolean), reduceMotion })` - a floating, horizontally centred pill at the top of `.explore-plot`: `2D | 3D` as `aria-pressed` buttons (3D disabled with a `title` when `!has3d`); in 3D only: `Iso`, `Top`, `Front`, `Side` (`aria-pressed` on the active preset) and a `Drift` toggle (hidden when `reduceMotion`). Styled with tokens only; wraps on narrow widths; sits clear of the existing top-right `.explore-zoom` buttons.

- [ ] **Step 1: Wire view state in `ExploreMap.jsx`.** `dim = deriveDim(params, !!spaceMeta?.has3d)`; call both `useMapTransform` and `useOrbitCamera` (hooks cannot be conditional; `active = dim === '3d'`); the wheel effect, pointer handlers, zoom buttons and Reset use the active hook; in 3D, add `onContextMenu`/`onKeyDown` handlers and `tabIndex={0}` to the canvas. `MapToolbar` switches `dim` through `setParam('dim', dim === '3d' ? '3d' : null)`.
- [ ] **Step 2: Draw.** In 3D, positions come from `projectCloud(songs.map(s => s.coords3?.[space] ?? null), camera, size)` zipped back to `{id, song, x, y, depth, k}` (songs with `null` skipped), passed through `sortBackToFront`; in 2D, points are as today with `depth: 0, k: 1`. Dots use `dotRadius(DOT_RADIUS, k)` and `dotAlpha(k)` in 3D (2D values unchanged). Spotlight uses `songPassesSpotlight(p.song, colour, spotlit)` in both views. Hover and click use `pickPoint(positionsRef.current, mx, my, 12)` instead of the local `nearest`. Draw the axis gizmo (bottom-right, 3D only) from `gizmoAxes(camera)` with `X`/`Y`/`Z` labels in `--text-secondary` and the positive ends in `--text-primary`. Update the canvas `aria-label` to say "3D" when applicable.
- [ ] **Step 3: Animate.** Add `dim` to the dependency list of the tween-trigger effect so switching 2D<->3D (and space) starts the existing last-frame tween; move `easeOutCubic` into `mapGeometry.js` (export it) and import it in `ExploreMap.jsx` and `useOrbitCamera.js` instead of duplicating it. Camera movement (orbit, drift, preset easing) must NOT start a tween - only `space`/`dim` changes do.
- [ ] **Step 4: Style.** Add `.explore-maptools` rules to `components.css` next to the existing `.explore-zoom` block (tokens only; reuse the `.explore-chip` look for buttons).
- [ ] **Step 5: Verify.** `cd frontend && npm run lint` (0 errors) and `npm run build` (clean). Then touch `ExploreMap.jsx` (Vite stale-transform hazard), start backend (`cd backend; npm run dev`, check how :5000 was launched first) and frontend (`npm run dev`), load `/explore` and confirm 2D is unchanged, then `/explore?dim=3d`, orbit/pan/zoom, each preset, Drift, 2D<->3D glide, a space switch while in 3D, and click-select in an overlapping region. Report what was and was not checked.
- [ ] **Step 6: Commit** `frontend/src/components/explore/ExploreMap.jsx frontend/src/components/explore/MapToolbar.jsx frontend/src/components/explore/mapGeometry.js frontend/src/components/explore/useOrbitCamera.js frontend/src/styles/components.css` as `feat(explore): 3D view with camera presets, drift and gizmo`.

### Task 7: Smoke, hand-off note and docs

**Files:**
- Create: `docs/ANALYSIS_UMAP_HANDOFF.md`
- Modify: `CLAUDE.md` (the `services/explore.js` and `src/components/explore` bullets), `docs/PROJECT_STATE.md` (Current State entry, Next Tasks, Changelog), `docs/PROJECT_PLAN.md`, `docs/PRD.md` (§11 Explore inventory)

- [ ] **Step 1: Full verification.** `cd backend && node --test --test-concurrency=1` (0 failures), `cd frontend && node --test src/components/explore/ src/utils/` (0 failures), lint 0 errors, build clean. Report exact counts.
- [ ] **Step 2: Theme colouring smoke** in the running app: Colour by Themes / Targets & species / Actions & advocacy / Moral frames each show a legend of <= 6 entries with counts; click a sub-dimension to spotlight; confirm songs coloured Mixed still light up when one of their sub-dimensions is chosen; confirm a 2D link from before this branch (e.g. `/explore?space=audio&colour=genre`) renders as before.
- [ ] **Step 3: Write `docs/ANALYSIS_UMAP_HANDOFF.md`** (one page, for the curator's separate analysis project): separate `n_components=2` and `3` UMAP fits per space (not a 2D layout lifted into 3D); `min_dist=0.15`, `n_neighbors` 25-30; cosine metric for thematic/semantic/holistic; `StandardScaler` + Euclidean for the 6-D Sound space; note the site normalises the 3D cloud itself; note the site only reads `*_2d`/`*_3d` columns and picks up new spaces automatically.
- [ ] **Step 4: Update docs** per the End-Session Guide: `CLAUDE.md` (explore.js now serves `coords3`, `has3d`, theme buckets/`subs`, `normaliseCloud`; frontend gains `camera3d.js`, `useOrbitCamera.js`, `MapToolbar.jsx`, new URL params `dim` and `cam`), `PROJECT_STATE.md` (entry with the curator smoke steps written out in full, Round 2 as NEXT), `PROJECT_PLAN.md`, `PRD.md`.
- [ ] **Step 5: Commit and push** the docs and hand-off note as `docs: explorer round 1 session notes and UMAP hand-off`; then `git push -u origin session-explorer-3d`. Do not merge: the curator smokes first.
